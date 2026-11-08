const request = require("supertest");
const { buildApp } = require("../helpers/buildApp");

/**
 * Message tests verify:
 *  - POST /api/chats/:chatId/messages (text, with optional metadata)
 *  - GET  /api/chats/:chatId/messages (listing with limit/before)
 *  - POST /api/chats/:chatId/seen (mark all)
 *  - POST /api/messages/:messageId/seen (mark one)
 *  - Membership gate: non-members can't send or read
 *  - Sanitization: <script> stripped before storage
 *  - Metadata preserved for image/file messages (Part 2 integration)
 */

async function registerUser(app, email) {
  const res = await request(app).post("/api/auth/register").send({
    email, password: "verysecure123",
    displayName: email.split("@")[0],
    primaryLang: "en",
  });
  return { token: res.body.data.accessToken, user: res.body.data.user };
}

async function createDirectChat(app, token, otherUserId) {
  const res = await request(app).post("/api/chats/direct")
    .set("Authorization", `Bearer ${token}`)
    .send({ otherUserId });
  return res.body.data?.chat;
}

describe("Messages API", () => {
  let app;
  let alice, bob, carol;    // { token, user }
  let chat;                 // direct chat between alice and bob

  beforeEach(async () => {
    ({ app } = buildApp());
    alice = await registerUser(app, "alice@t.io");
    bob   = await registerUser(app, "bob@t.io");
    carol = await registerUser(app, "carol@t.io");   // not in the chat
    chat = await createDirectChat(app, alice.token, bob.user.id);
  });

  describe("POST /api/chats/:chatId/messages (send)", () => {
    test("sends a text message with 201", async () => {
      const res = await request(app).post(`/api/chats/${chat.id}/messages`)
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ content: "hello bob", type: "text" });
      expect(res.status).toBe(201);
      expect(res.body.data.message.content).toBe("hello bob");
      expect(res.body.data.message.type).toBe("text");
      expect(res.body.data.message.senderId).toBe(alice.user.id);
      expect(res.body.data.message.chatId).toBe(chat.id);
    });

    test("sanitizes HTML/script injection before storage", async () => {
      const malicious = "<script>alert(1)</script>hello<b>world</b>";
      const res = await request(app).post(`/api/chats/${chat.id}/messages`)
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ content: malicious, type: "text" });
      expect(res.status).toBe(201);
      const stored = res.body.data.message.content;
      expect(stored).not.toContain("<script>");
      expect(stored).not.toContain("<b>");
      expect(stored).toContain("hello");
      expect(stored).toContain("world");
    });

    test("preserves image metadata (Part 2)", async () => {
      const meta = {
        url: "/api/media/fake-uuid",
        fileId: "fake-uuid",
        originalName: "photo.png",
        mimeType: "image/png",
        size: 1024,
        isImage: true,
      };
      const res = await request(app).post(`/api/chats/${chat.id}/messages`)
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ content: "photo.png", type: "image", metadata: meta });
      expect(res.status).toBe(201);
      expect(res.body.data.message.type).toBe("image");
      expect(res.body.data.message.metadata.url).toBe(meta.url);
      expect(res.body.data.message.metadata.fileId).toBe("fake-uuid");
      expect(res.body.data.message.metadata.isImage).toBe(true);
    });

    test("accepts Part 2 'video' message type", async () => {
      const res = await request(app).post(`/api/chats/${chat.id}/messages`)
        .set("Authorization", `Bearer ${alice.token}`)
        .send({
          content: "clip.mp4", type: "video",
          metadata: { url: "/api/media/x", fileId: "x", originalName: "clip.mp4", mimeType: "video/mp4", isVideo: true },
        });
      expect(res.status).toBe(201);
      expect(res.body.data.message.type).toBe("video");
    });

    test("rejects invalid message type with 400", async () => {
      const res = await request(app).post(`/api/chats/${chat.id}/messages`)
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ content: "x", type: "garbage" });
      expect(res.status).toBe(400);
    });

    test("non-member cannot send a message (403)", async () => {
      const res = await request(app).post(`/api/chats/${chat.id}/messages`)
        .set("Authorization", `Bearer ${carol.token}`)
        .send({ content: "I should not be here", type: "text" });
      expect(res.status).toBe(403);
    });

    test("rejects empty text message with 400", async () => {
      const res = await request(app).post(`/api/chats/${chat.id}/messages`)
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ content: "   ", type: "text" });
      expect(res.status).toBe(400);
    });

    test("rejects without auth (401)", async () => {
      const res = await request(app).post(`/api/chats/${chat.id}/messages`)
        .send({ content: "hi", type: "text" });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/chats/:chatId/messages (list)", () => {
    beforeEach(async () => {
      // Seed three messages
      for (const text of ["first", "second", "third"]) {
        await request(app).post(`/api/chats/${chat.id}/messages`)
          .set("Authorization", `Bearer ${alice.token}`)
          .send({ content: text, type: "text" });
      }
    });

    test("returns messages in chronological order", async () => {
      const res = await request(app).get(`/api/chats/${chat.id}/messages`)
        .set("Authorization", `Bearer ${alice.token}`);
      expect(res.status).toBe(200);
      const msgs = res.body.data.messages;
      expect(msgs.length).toBe(3);
      expect(msgs[0].content).toBe("first");
      expect(msgs[1].content).toBe("second");
      expect(msgs[2].content).toBe("third");
    });

    test("respects ?limit=N", async () => {
      const res = await request(app).get(`/api/chats/${chat.id}/messages?limit=2`)
        .set("Authorization", `Bearer ${alice.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.messages.length).toBe(2);
    });

    test("attaches sender object to each message", async () => {
      const res = await request(app).get(`/api/chats/${chat.id}/messages`)
        .set("Authorization", `Bearer ${alice.token}`);
      const m = res.body.data.messages[0];
      expect(m.sender).toBeDefined();
      expect(m.sender.id).toBe(alice.user.id);
      expect(m.sender.passwordHash).toBeUndefined();
    });

    test("non-member cannot read messages (403)", async () => {
      const res = await request(app).get(`/api/chats/${chat.id}/messages`)
        .set("Authorization", `Bearer ${carol.token}`);
      expect(res.status).toBe(403);
    });

    test("requires auth (401)", async () => {
      const res = await request(app).get(`/api/chats/${chat.id}/messages`);
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/chats/:chatId/seen (mark all as seen)", () => {
    let messageIds;

    beforeEach(async () => {
      messageIds = [];
      for (const text of ["m1", "m2", "m3"]) {
        const r = await request(app).post(`/api/chats/${chat.id}/messages`)
          .set("Authorization", `Bearer ${alice.token}`)
          .send({ content: text, type: "text" });
        messageIds.push(r.body.data.message.id);
      }
    });

    test("bob marks alice's messages as seen", async () => {
      const res = await request(app).post(`/api/chats/${chat.id}/seen`)
        .set("Authorization", `Bearer ${bob.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.markedSeen).toBe(3);
    });

    test("non-member gets 403", async () => {
      const res = await request(app).post(`/api/chats/${chat.id}/seen`)
        .set("Authorization", `Bearer ${carol.token}`);
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/messages/:messageId/seen", () => {
    let messageId;

    beforeEach(async () => {
      const r = await request(app).post(`/api/chats/${chat.id}/messages`)
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ content: "a single message", type: "text" });
      messageId = r.body.data.message.id;
    });

    test("marks a single message as seen by recipient", async () => {
      const res = await request(app).post(`/api/messages/${messageId}/seen`)
        .set("Authorization", `Bearer ${bob.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("seen");
      expect(res.body.data.userId).toBe(bob.user.id);
    });

    test("404 for unknown message id", async () => {
      const res = await request(app).post(`/api/messages/00000000-0000-0000-0000-000000000000/seen`)
        .set("Authorization", `Bearer ${bob.token}`);
      expect(res.status).toBe(404);
    });

    test("non-member gets 403 on seen", async () => {
      const res = await request(app).post(`/api/messages/${messageId}/seen`)
        .set("Authorization", `Bearer ${carol.token}`);
      expect(res.status).toBe(403);
    });
  });
});
