const request = require("supertest");
const { buildApp } = require("../helpers/buildApp");

/**
 * Supertest returns response bodies differently depending on content-type:
 *  - application/json  → parsed into res.body (object)
 *  - text/*            → raw string in res.text
 *  - everything else   → empty res.body unless we install a binary parser
 *
 * For media endpoints we mostly want to verify:
 *  - status code
 *  - headers (content-type, content-disposition, content-length, nosniff)
 *  - body bytes when meaningful (for text/plain: use res.text)
 *
 * Using a custom parser for binary cases is overkill for what we need to prove
 * (that the Part 1 auth gate works and the Part 2 tiers are enforced). So we
 * check content-length + status + headers, and read res.text for text/plain.
 */

describe("Media API", () => {
  let app;
  let token;

  beforeEach(async () => {
    ({ app } = buildApp());
    const res = await request(app).post("/api/auth/register").send({
      email: "media@test.io", password: "verysecure123",
      displayName: "Media Tester", primaryLang: "en",
    });
    token = res.body.data.accessToken;
  });

  async function uploadBase64({ buffer, originalName, mimeType, auth = token, extraFields = {} }) {
    const req = request(app).post("/api/media/upload");
    if (auth) req.set("Authorization", `Bearer ${auth}`);
    const payload = {
      data: buffer.toString("base64"),
      ...(originalName !== undefined ? { originalName } : {}),
      ...(mimeType !== undefined ? { mimeType } : {}),
      ...extraFields,
    };
    return req.send(payload);
  }

  async function uploadMultipart({ buffer, originalName, mimeType, auth = token }) {
    const req = request(app).post("/api/media/upload-stream");
    if (auth) req.set("Authorization", `Bearer ${auth}`);
    return req.attach("file", buffer, { filename: originalName, contentType: mimeType });
  }

  // ═══════════════════════════════════════════════
  // UPLOADS
  // ═══════════════════════════════════════════════

  describe("Uploads", () => {
    test("uploads a small PNG via base64", async () => {
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const buf = Buffer.concat([pngHeader, Buffer.alloc(1024, 0)]);
      const res = await uploadBase64({ buffer: buf, originalName: "pic.png", mimeType: "image/png" });
      expect(res.status).toBe(201);
      expect(res.body.data.fileId).toEqual(expect.any(String));
      expect(res.body.data.url).toMatch(/^\/api\/media\//);
      expect(res.body.data.isImage).toBe(true);
      expect(res.body.data.messageType).toBe("image");
    });

    test("uploads a PDF via base64", async () => {
      const buf = Buffer.from("%PDF-1.4\n%%EOF\n");
      const res = await uploadBase64({ buffer: buf, originalName: "doc.pdf", mimeType: "application/pdf" });
      expect(res.status).toBe(201);
      expect(res.body.data.kind).toBe("document");
      expect(res.body.data.messageType).toBe("file");
    });

    test("uploads via multipart/form-data", async () => {
      const buf = Buffer.from("hello world");
      const res = await uploadMultipart({ buffer: buf, originalName: "hello.txt", mimeType: "text/plain" });
      expect(res.status).toBe(201);
      expect(res.body.data.fileId).toEqual(expect.any(String));
      expect(res.body.data.originalName).toBe("hello.txt");
    });

    test("rejects upload without auth", async () => {
      const res = await uploadBase64({
        buffer: Buffer.from("x"), originalName: "x.txt", mimeType: "text/plain", auth: null,
      });
      expect(res.status).toBe(401);
    });

    test("rejects disallowed MIME type (.exe)", async () => {
      const res = await uploadBase64({
        buffer: Buffer.from("MZ"), originalName: "evil.exe",
        mimeType: "application/x-msdownload",
      });
      expect(res.status).toBe(400);
    });

    test("rejects oversized image (>15MB)", async () => {
      const big = Buffer.alloc(16 * 1024 * 1024, 0xff);
      const res = await uploadBase64({
        buffer: big, originalName: "big.jpg", mimeType: "image/jpeg",
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/limit/i);
    });

    test("rejects oversized document (>25MB) via multipart", async () => {
      // Use multipart because base64-encoded 26MB would exceed the 30MB JSON
      // limit before reaching the size-tier check. Multipart streams via
      // multer and goes directly to the per-MIME tier check in the service.
      const big = Buffer.alloc(26 * 1024 * 1024, 0x20);
      const res = await uploadMultipart({
        buffer: big, originalName: "big.pdf", mimeType: "application/pdf",
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/limit/i);
    });

    test("missing originalName is rejected", async () => {
      // Send with undefined originalName (helper omits the field entirely)
      const res = await uploadBase64({
        buffer: Buffer.from("x"),
        originalName: undefined,
        mimeType: "text/plain",
      });
      expect(res.status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════
  // GET — PART 1 AUTH GATE
  // ═══════════════════════════════════════════════

  describe("GET /api/media/:fileId — authenticated access (Part 1)", () => {
    let fileId;
    const body = Buffer.from("the contents of a plain text file");

    beforeEach(async () => {
      const res = await uploadBase64({
        buffer: body, originalName: "notes.txt", mimeType: "text/plain",
      });
      fileId = res.body.data.fileId;
    });

    test("serves file with Bearer header", async () => {
      const res = await request(app).get(`/api/media/${fileId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/plain/);
      // For text/plain, supertest provides res.text
      expect(res.text).toBe(body.toString());
    });

    test("serves file with ?token= query string (Part 1 fix)", async () => {
      const res = await request(app).get(`/api/media/${fileId}?token=${encodeURIComponent(token)}`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/plain/);
      expect(res.text).toBe(body.toString());
    });

    test("returns 401 without any auth", async () => {
      const res = await request(app).get(`/api/media/${fileId}`);
      expect(res.status).toBe(401);
    });

    test("returns 401 with a malformed token in query", async () => {
      const res = await request(app).get(`/api/media/${fileId}?token=not-a-real-token`);
      expect(res.status).toBe(401);
    });

    test("returns 404 for unknown fileId", async () => {
      const res = await request(app).get(`/api/media/00000000-0000-0000-0000-000000000000`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    test("sets Content-Disposition: inline with original filename", async () => {
      const res = await request(app).get(`/api/media/${fileId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.headers["content-disposition"]).toMatch(/inline/i);
      expect(res.headers["content-disposition"]).toMatch(/notes\.txt/);
    });

    test("sets X-Content-Type-Options: nosniff (security)", async () => {
      const res = await request(app).get(`/api/media/${fileId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    });

    test("sets Content-Length header matching the body", async () => {
      const res = await request(app).get(`/api/media/${fileId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.headers["content-length"]).toBe(String(body.length));
    });
  });

  // ═══════════════════════════════════════════════
  // DOWNLOAD
  // ═══════════════════════════════════════════════

  describe("GET /api/media/:fileId/download", () => {
    let fileId;
    const body = Buffer.from("spreadsheet bytes");

    beforeEach(async () => {
      const res = await uploadBase64({
        buffer: body, originalName: "report.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      fileId = res.body.data.fileId;
    });

    test("forces attachment download with original filename", async () => {
      const res = await request(app).get(`/api/media/${fileId}/download`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.headers["content-disposition"]).toMatch(/attachment/i);
      expect(res.headers["content-disposition"]).toMatch(/report\.xlsx/);
      expect(res.headers["content-length"]).toBe(String(body.length));
    });

    test("works with ?token= query (Part 1 — needed for <a href>)", async () => {
      const res = await request(app).get(`/api/media/${fileId}/download?token=${encodeURIComponent(token)}`);
      expect(res.status).toBe(200);
      expect(res.headers["content-length"]).toBe(String(body.length));
    });

    test("returns 401 without auth", async () => {
      const res = await request(app).get(`/api/media/${fileId}/download`);
      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════
  // LIMITS
  // ═══════════════════════════════════════════════

  describe("GET /api/media/limits", () => {
    test("reports per-MIME size tiers", async () => {
      const res = await request(app).get("/api/media/limits")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.sizeLimits.image).toBe(15 * 1024 * 1024);
      expect(res.body.data.sizeLimits.video).toBe(100 * 1024 * 1024);
      expect(res.body.data.sizeLimits.document).toBe(25 * 1024 * 1024);
    });
  });
});
