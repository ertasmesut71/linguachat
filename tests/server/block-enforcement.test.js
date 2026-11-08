/**
 * P0 #2 — Block enforcement tests.
 *
 * Verifies that blocking actually prevents message delivery,
 * not just creates a database record.
 */

const request = require("supertest");
const { buildApp } = require("../helpers/buildApp");

async function registerUser(app, opts) {
  const r = await request(app).post("/api/auth/register").send({
    email: opts.email, password: "testpass123", displayName: opts.name, primaryLang: opts.lang || "en",
  });
  return { token: r.body.data.accessToken, user: r.body.data.user };
}

async function startDirectChat(app, token, otherUserId) {
  const r = await request(app).post("/api/chats/direct")
    .set("Authorization", `Bearer ${token}`)
    .send({ otherUserId });
  return r.body.data.chat;
}

describe("Block Enforcement — Direct Messages", () => {
  let app, store;

  beforeEach(() => {
    ({ app, store } = buildApp());
  });

  test("B01: messages work before blocking", async () => {
    const alice = await registerUser(app, { email: "a@t.io", name: "Alice" });
    const bob = await registerUser(app, { email: "b@t.io", name: "Bob" });
    const chat = await startDirectChat(app, alice.token, bob.user.id);

    const res = await request(app).post(`/api/chats/${chat.id}/messages`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ content: "Hello Bob" });
    expect(res.status).toBe(201);
  });

  test("B02+B03: blocked user cannot send HTTP direct message", async () => {
    const alice = await registerUser(app, { email: "a2@t.io", name: "Alice2" });
    const bob = await registerUser(app, { email: "b2@t.io", name: "Bob2" });
    const chat = await startDirectChat(app, alice.token, bob.user.id);

    // Alice blocks Bob
    await store.blockUser(alice.user.id, bob.user.id);

    // Bob tries to send → rejected
    const res = await request(app).post(`/api/chats/${chat.id}/messages`)
      .set("Authorization", `Bearer ${bob.token}`)
      .send({ content: "Can you see this?" });
    expect(res.status).toBe(403);
  });

  test("B04: blocker also cannot send to blocked user (bidirectional)", async () => {
    const alice = await registerUser(app, { email: "a3@t.io", name: "Alice3" });
    const bob = await registerUser(app, { email: "b3@t.io", name: "Bob3" });
    const chat = await startDirectChat(app, alice.token, bob.user.id);

    await store.blockUser(alice.user.id, bob.user.id);

    // Alice (blocker) tries to send to Bob → rejected
    const res = await request(app).post(`/api/chats/${chat.id}/messages`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ content: "I blocked you but sending anyway" });
    expect(res.status).toBe(403);
  });

  test("B05: unblock restores messaging", async () => {
    const alice = await registerUser(app, { email: "a4@t.io", name: "Alice4" });
    const bob = await registerUser(app, { email: "b4@t.io", name: "Bob4" });
    const chat = await startDirectChat(app, alice.token, bob.user.id);

    await store.blockUser(alice.user.id, bob.user.id);

    // Blocked → fails
    const r1 = await request(app).post(`/api/chats/${chat.id}/messages`)
      .set("Authorization", `Bearer ${bob.token}`)
      .send({ content: "blocked" });
    expect(r1.status).toBe(403);

    // Unblock
    await store.unblockUser(alice.user.id, bob.user.id);

    // Now works
    const r2 = await request(app).post(`/api/chats/${chat.id}/messages`)
      .set("Authorization", `Bearer ${bob.token}`)
      .send({ content: "unblocked!" });
    expect(r2.status).toBe(201);
  });

  test("B10: group messaging unaffected by block between members", async () => {
    const alice = await registerUser(app, { email: "a5@t.io", name: "Alice5" });
    const bob = await registerUser(app, { email: "b5@t.io", name: "Bob5" });

    // Create group
    const gr = await request(app).post("/api/chats/group")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ name: "Test Group", memberIds: [bob.user.id] });
    const groupId = gr.body.data.chat.id;

    // Alice blocks Bob
    await store.blockUser(alice.user.id, bob.user.id);

    // Bob sends to group → should still work (block is direct-chat only)
    const res = await request(app).post(`/api/chats/${groupId}/messages`)
      .set("Authorization", `Bearer ${bob.token}`)
      .send({ content: "Group message works" });
    expect(res.status).toBe(201);
  });

  test("B12: blocking does not affect unrelated users", async () => {
    const alice = await registerUser(app, { email: "a6@t.io", name: "Alice6" });
    const bob = await registerUser(app, { email: "b6@t.io", name: "Bob6" });
    const carol = await registerUser(app, { email: "c6@t.io", name: "Carol6" });
    const chat = await startDirectChat(app, alice.token, carol.user.id);

    // Alice blocks Bob (unrelated to Alice↔Carol chat)
    await store.blockUser(alice.user.id, bob.user.id);

    // Carol sends to Alice → works
    const res = await request(app).post(`/api/chats/${chat.id}/messages`)
      .set("Authorization", `Bearer ${carol.token}`)
      .send({ content: "Hi Alice from Carol" });
    expect(res.status).toBe(201);
  });

  test("blocked message is not persisted", async () => {
    const alice = await registerUser(app, { email: "a7@t.io", name: "Alice7" });
    const bob = await registerUser(app, { email: "b7@t.io", name: "Bob7" });
    const chat = await startDirectChat(app, alice.token, bob.user.id);

    // Count messages before
    const before = await request(app).get(`/api/chats/${chat.id}/messages`)
      .set("Authorization", `Bearer ${alice.token}`);
    const countBefore = before.body.data.messages.length;

    await store.blockUser(alice.user.id, bob.user.id);

    // Blocked send
    await request(app).post(`/api/chats/${chat.id}/messages`)
      .set("Authorization", `Bearer ${bob.token}`)
      .send({ content: "This should not persist" });

    // Count messages after — should be same
    await store.unblockUser(alice.user.id, bob.user.id);
    const after = await request(app).get(`/api/chats/${chat.id}/messages`)
      .set("Authorization", `Bearer ${alice.token}`);
    expect(after.body.data.messages.length).toBe(countBefore);
  });

  test("isBlockedEitherWay works correctly", async () => {
    const alice = await registerUser(app, { email: "a8@t.io", name: "A8" });
    const bob = await registerUser(app, { email: "b8@t.io", name: "B8" });

    expect(await store.isBlockedEitherWay(alice.user.id, bob.user.id)).toBe(false);

    await store.blockUser(alice.user.id, bob.user.id);
    expect(await store.isBlockedEitherWay(alice.user.id, bob.user.id)).toBe(true);
    expect(await store.isBlockedEitherWay(bob.user.id, alice.user.id)).toBe(true); // reverse

    await store.unblockUser(alice.user.id, bob.user.id);
    expect(await store.isBlockedEitherWay(alice.user.id, bob.user.id)).toBe(false);
  });
});
