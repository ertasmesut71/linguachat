/**
 * Conversation mute tests.
 * Verifies per-user per-chat mute preference via existing member settings API.
 */

const request = require("supertest");
const { buildApp } = require("../helpers/buildApp");

async function registerUser(app, opts) {
  const r = await request(app).post("/api/auth/register").send({
    email: opts.email, password: "testpass123", displayName: opts.name, primaryLang: opts.lang || "en",
  });
  return { token: r.body.data.accessToken, user: r.body.data.user };
}

async function createDirectChat(app, token, otherUserId) {
  const r = await request(app).post("/api/chats/direct")
    .set("Authorization", `Bearer ${token}`)
    .send({ otherUserId });
  return r.body.data.chat;
}

describe("Conversation Mute", () => {
  let app;

  beforeEach(() => {
    ({ app } = buildApp());
  });

  test("GET my-settings returns muted=false by default", async () => {
    const alice = await registerUser(app, { email: "a@t.io", name: "Alice" });
    const bob = await registerUser(app, { email: "b@t.io", name: "Bob" });
    const chat = await createDirectChat(app, alice.token, bob.user.id);

    const res = await request(app).get(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${alice.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.settings.muted).toBe(false);
  });

  test("PATCH my-settings muted=true persists", async () => {
    const alice = await registerUser(app, { email: "a2@t.io", name: "Alice2" });
    const bob = await registerUser(app, { email: "b2@t.io", name: "Bob2" });
    const chat = await createDirectChat(app, alice.token, bob.user.id);

    const patch = await request(app).patch(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ muted: true });
    expect(patch.status).toBe(200);

    const get = await request(app).get(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${alice.token}`);
    expect(get.body.data.settings.muted).toBe(true);
  });

  test("PATCH my-settings muted=false unmutes", async () => {
    const alice = await registerUser(app, { email: "a3@t.io", name: "Alice3" });
    const bob = await registerUser(app, { email: "b3@t.io", name: "Bob3" });
    const chat = await createDirectChat(app, alice.token, bob.user.id);

    await request(app).patch(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ muted: true });

    await request(app).patch(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ muted: false });

    const get = await request(app).get(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${alice.token}`);
    expect(get.body.data.settings.muted).toBe(false);
  });

  test("muting one user does not mute the other", async () => {
    const alice = await registerUser(app, { email: "a4@t.io", name: "Alice4" });
    const bob = await registerUser(app, { email: "b4@t.io", name: "Bob4" });
    const chat = await createDirectChat(app, alice.token, bob.user.id);

    await request(app).patch(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ muted: true });

    const bobSettings = await request(app).get(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${bob.token}`);
    expect(bobSettings.body.data.settings.muted).toBe(false);
  });

  test("muted chat still receives messages", async () => {
    const alice = await registerUser(app, { email: "a5@t.io", name: "Alice5" });
    const bob = await registerUser(app, { email: "b5@t.io", name: "Bob5" });
    const chat = await createDirectChat(app, alice.token, bob.user.id);

    await request(app).patch(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ muted: true });

    // Bob sends a message — it should still be persisted
    const msg = await request(app).post(`/api/chats/${chat.id}/messages`)
      .set("Authorization", `Bearer ${bob.token}`)
      .send({ content: "Hello muted Alice" });
    expect(msg.status).toBe(201);

    // Alice can still retrieve the message
    const history = await request(app).get(`/api/chats/${chat.id}/messages`)
      .set("Authorization", `Bearer ${alice.token}`);
    expect(history.body.data.messages.some((m) => m.content === "Hello muted Alice")).toBe(true);
  });

  test("group mute works", async () => {
    const alice = await registerUser(app, { email: "a6@t.io", name: "Alice6" });
    const bob = await registerUser(app, { email: "b6@t.io", name: "Bob6" });

    const gr = await request(app).post("/api/chats/group")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ name: "Test Group", memberIds: [bob.user.id] });
    const groupId = gr.body.data.chat.id;

    const patch = await request(app).patch(`/api/chats/${groupId}/my-settings`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ muted: true });
    expect(patch.status).toBe(200);

    const get = await request(app).get(`/api/chats/${groupId}/my-settings`)
      .set("Authorization", `Bearer ${alice.token}`);
    expect(get.body.data.settings.muted).toBe(true);
  });

  test("receiveLang still works alongside mute", async () => {
    const alice = await registerUser(app, { email: "a7@t.io", name: "Alice7" });
    const bob = await registerUser(app, { email: "b7@t.io", name: "Bob7" });
    const chat = await createDirectChat(app, alice.token, bob.user.id);

    await request(app).patch(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ muted: true, receiveLang: "tr" });

    const get = await request(app).get(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${alice.token}`);
    expect(get.body.data.settings.muted).toBe(true);
    expect(get.body.data.settings.receiveLang).toBe("tr");
  });

  test("invalid muted value rejected", async () => {
    const alice = await registerUser(app, { email: "a8@t.io", name: "Alice8" });
    const bob = await registerUser(app, { email: "b8@t.io", name: "Bob8" });
    const chat = await createDirectChat(app, alice.token, bob.user.id);

    const res = await request(app).patch(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ muted: "yes" });
    expect(res.status).toBe(400);
  });
});
