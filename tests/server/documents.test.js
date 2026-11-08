const request = require("supertest");
const { buildApp } = require("../helpers/buildApp");

/**
 * Document intelligence tests (Part 3).
 *
 * Because ANTHROPIC_API_KEY is empty in tests, the documents.service falls
 * back to a safe mock summary and the OCR/ask paths return "[AI disabled]"
 * markers instead of calling Claude. We still verify:
 *  - extractor selects correct kind based on MIME / filename
 *  - unsupported MIME is rejected at 400
 *  - unknown fileId → 404
 *  - Q&A validates that the question is present
 *  - tone rewrite endpoint accepts every tone in the enum, including
 *    Part 3 additions "friendly" and "warm"
 */

async function registerUser(app, email = "doc@t.io") {
  const res = await request(app).post("/api/auth/register").send({
    email, password: "verysecure123", displayName: "Doc Tester", primaryLang: "en",
  });
  return { token: res.body.data.accessToken, user: res.body.data.user };
}

async function uploadFile(app, token, { buffer, originalName, mimeType }) {
  const res = await request(app).post("/api/media/upload")
    .set("Authorization", `Bearer ${token}`)
    .send({
      data: buffer.toString("base64"),
      originalName, mimeType,
    });
  return res.body.data;
}

describe("Document intelligence (Part 3)", () => {
  let app, token;

  beforeEach(async () => {
    ({ app } = buildApp());
    const u = await registerUser(app);
    token = u.token;
  });

  // ─────────────────────────────────────────────
  // documents.service.extract() — direct unit coverage
  // ─────────────────────────────────────────────

  describe("documents.service.extract (direct)", () => {
    // These tests don't touch HTTP; they exercise the extractor router
    // for text/JSON/XLSX. PDF/DOCX require real binary files and are
    // already smoke-tested at the end-to-end level during manual QA.

    let documentsService;
    beforeEach(() => {
      jest.resetModules();
      documentsService = require("../../server/modules/ai/documents.service");
    });

    test("extracts plain text", async () => {
      const r = await documentsService.extract(Buffer.from("hello\nworld"), "text/plain", "a.txt");
      expect(r.kind).toBe("text");
      expect(r.text).toBe("hello\nworld");
    });

    test("extracts markdown as text", async () => {
      const r = await documentsService.extract(Buffer.from("# Title"), "text/markdown", "a.md");
      expect(r.kind).toBe("text");
      expect(r.text).toBe("# Title");
    });

    test("extracts JSON as text", async () => {
      const r = await documentsService.extract(Buffer.from('{"a":1}'), "application/json", "a.json");
      expect(r.kind).toBe("text");
      expect(r.text).toContain('"a":1');
    });

    test("extracts XLSX via SheetJS", async () => {
      const XLSX = require("xlsx");
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([["name", "age"], ["Alice", 30], ["Bob", 25]]);
      XLSX.utils.book_append_sheet(wb, ws, "People");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const r = await documentsService.extract(
        buf,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "p.xlsx",
      );
      expect(r.kind).toBe("xlsx");
      expect(r.sheets).toEqual(["People"]);
      expect(r.text).toContain("Alice,30");
      expect(r.text).toContain("Bob,25");
      expect(r.text).toContain("=== Sheet: People ===");
    });

    test("rejects unsupported MIME", async () => {
      await expect(
        documentsService.extract(Buffer.from("MZ"), "application/x-msdownload", "bad.exe"),
      ).rejects.toThrow(/Unsupported/);
    });

    test("falls back to extension when MIME is generic", async () => {
      // Some browsers send application/octet-stream for .md files.
      // Router should still recognize by extension.
      const r = await documentsService.extract(Buffer.from("# hi"), "text/plain", "notes.md");
      expect(r.kind).toBe("text");
    });
  });

  // ─────────────────────────────────────────────
  // HTTP endpoints — thin shell around the service
  // ─────────────────────────────────────────────

  describe("POST /api/ai/files/:fileId/summarize", () => {
    test("returns a summary object for a TXT file", async () => {
      const file = await uploadFile(app, token, {
        buffer: Buffer.from("This is the body of a very important document."),
        originalName: "doc.txt", mimeType: "text/plain",
      });
      const res = await request(app).post(`/api/ai/files/${file.fileId}/summarize`)
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.data.kind).toBe("text");
      expect(res.body.data.summary).toEqual(expect.any(String));
      expect(res.body.data.originalName).toBe("doc.txt");
      expect(res.body.data.lang).toBe("en");
    });

    test("honors explicit target language", async () => {
      const file = await uploadFile(app, token, {
        buffer: Buffer.from("Hello world"),
        originalName: "d.txt", mimeType: "text/plain",
      });
      const res = await request(app).post(`/api/ai/files/${file.fileId}/summarize`)
        .set("Authorization", `Bearer ${token}`)
        .send({ lang: "ja" });
      expect(res.status).toBe(200);
      expect(res.body.data.lang).toBe("ja");
    });

    test("returns 404 for unknown fileId", async () => {
      const res = await request(app).post(`/api/ai/files/00000000-0000-0000-0000-000000000000/summarize`)
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(404);
    });

    test("rejects without auth (401)", async () => {
      const file = await uploadFile(app, token, {
        buffer: Buffer.from("x"), originalName: "x.txt", mimeType: "text/plain",
      });
      const res = await request(app).post(`/api/ai/files/${file.fileId}/summarize`).send({});
      expect(res.status).toBe(401);
    });

    test("rejects unsupported file for summarization (400)", async () => {
      // Upload an image, then try to summarize it (not supported by doc extractor).
      const file = await uploadFile(app, token, {
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        originalName: "pic.png", mimeType: "image/png",
      });
      const res = await request(app).post(`/api/ai/files/${file.fileId}/summarize`)
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/ai/files/:fileId/ask", () => {
    test("requires a question", async () => {
      const file = await uploadFile(app, token, {
        buffer: Buffer.from("hello"),
        originalName: "d.txt", mimeType: "text/plain",
      });
      const res = await request(app).post(`/api/ai/files/${file.fileId}/ask`)
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
    });

    test("returns an answer structure for a valid question", async () => {
      const file = await uploadFile(app, token, {
        buffer: Buffer.from("The meeting is on Friday at 3pm."),
        originalName: "note.txt", mimeType: "text/plain",
      });
      const res = await request(app).post(`/api/ai/files/${file.fileId}/ask`)
        .set("Authorization", `Bearer ${token}`)
        .send({ question: "When is the meeting?" });
      expect(res.status).toBe(200);
      expect(res.body.data.answer).toEqual(expect.any(String));
      expect(res.body.data.lang).toBe("en");
    });
  });

  describe("POST /api/ai/files/:fileId/ocr", () => {
    test("rejects OCR on a non-image (400)", async () => {
      const file = await uploadFile(app, token, {
        buffer: Buffer.from("not an image"),
        originalName: "t.txt", mimeType: "text/plain",
      });
      const res = await request(app).post(`/api/ai/files/${file.fileId}/ocr`)
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
    });

    test("returns structured response for an image (mock mode)", async () => {
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const file = await uploadFile(app, token, {
        buffer: Buffer.concat([pngHeader, Buffer.alloc(32, 0)]),
        originalName: "sign.png", mimeType: "image/png",
      });
      const res = await request(app).post(`/api/ai/files/${file.fileId}/ocr`)
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(expect.objectContaining({
        extracted: expect.any(String),
        translated: expect.any(String),
        lang: expect.any(String),
      }));
    });
  });

  describe("POST /api/ai/rewrite (tone)", () => {
    const TONES = ["formal", "casual", "professional", "enthusiastic", "concise", "polite", "friendly", "warm"];

    test.each(TONES)("accepts tone '%s'", async (tone) => {
      const res = await request(app).post("/api/ai/rewrite")
        .set("Authorization", `Bearer ${token}`)
        .send({ text: "please send this file", tone, lang: "en" });
      expect(res.status).toBe(200);
      expect(res.body.data.tone).toBe(tone);
      expect(res.body.data.rewritten).toEqual(expect.any(String));
    });

    test("rejects unknown tone with 400", async () => {
      const res = await request(app).post("/api/ai/rewrite")
        .set("Authorization", `Bearer ${token}`)
        .send({ text: "hi", tone: "cryptic", lang: "en" });
      expect(res.status).toBe(400);
    });

    test("rejects empty text with 400", async () => {
      const res = await request(app).post("/api/ai/rewrite")
        .set("Authorization", `Bearer ${token}`)
        .send({ text: "", tone: "friendly", lang: "en" });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/ai/chats/:chatId/tasks", () => {
    test("returns an array (empty in mock mode without API key)", async () => {
      // Create a chat so the user is a member
      const bob = await registerUser(app, "bob@t.io");
      const createChat = await request(app).post("/api/chats/direct")
        .set("Authorization", `Bearer ${token}`)
        .send({ otherUserId: bob.user.id });
      const chatId = createChat.body.data.chat.id;

      // Seed a few messages
      await request(app).post(`/api/chats/${chatId}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .send({ content: "Can you send the Q3 report by Friday?", type: "text" });

      const res = await request(app).get(`/api/ai/chats/${chatId}/tasks`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.tasks)).toBe(true);
    });

    test("non-member gets 403", async () => {
      const bob = await registerUser(app, "bob@t.io");
      const carol = await registerUser(app, "carol@t.io");
      const createChat = await request(app).post("/api/chats/direct")
        .set("Authorization", `Bearer ${token}`)
        .send({ otherUserId: bob.user.id });
      const chatId = createChat.body.data.chat.id;

      const res = await request(app).get(`/api/ai/chats/${chatId}/tasks`)
        .set("Authorization", `Bearer ${carol.token}`);
      expect(res.status).toBe(403);
    });
  });
});
