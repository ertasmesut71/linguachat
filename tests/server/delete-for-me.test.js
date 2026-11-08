/**
 * "Delete for me" — hides a message from ONE user's view only.
 *
 * NOTE ON SCOPE: these tests run against the in-memory mock store, which mirrors
 * the production store's behavior. The production raw SQL (hidden_messages table)
 * is NOT executed here — that needs a live PostgreSQL and is covered by the manual
 * runtime test plan.
 */

const request = require("supertest");
const { buildApp } = require("../helpers/buildApp");

async function register(app, email, name) {
  const r = await request(app).post("/api/auth/register").send({
    email, password: "testpass123", displayName: name, primaryLang: "en",
  });
  return { token: r.body.data.accessToken, user: r.body.data.user };
}
const auth = (u) => ({ Authorization: `Bearer ${u.token}` });

async function directChat(app, from, to) {
  const r = await request(app).post("/api/chats/direct").set(auth(from)).send({ otherUserId: to.user.id });
  return r.body.data.chat;
}
async function send(app, from, chatId, content) {
  const r = await request(app).post(`/api/chats/${chatId}/messages`).set(auth(from)).send({ content });
  expect(r.status).toBe(201);
  return r.body.data.message;
}
async function list(app, who, chatId) {
  const r = await request(app).get(`/api/chats/${chatId}/messages`).set(auth(who));
  expect(r.status).toBe(200);
  return r.body.data.messages;
}
const ids = (msgs) => msgs.map((m) => m.id);

describe("Delete for me — direct chat", () => {
  let app, alice, bob, chat;

  beforeEach(async () => {
    ({ app } = buildApp());
    alice = await register(app, "alice@t.io", "Alice");
    bob = await register(app, "bob@t.io", "Bob");
    chat = await directChat(app, alice, bob);
  });

  test("received message can be hidden; it disappears for the hider only", async () => {
    const m = await send(app, alice, chat.id, "hello bob");

    const hide = await request(app).post(`/api/messages/${m.id}/hide`).set(auth(bob));
    expect(hide.status).toBe(200);
    expect(hide.body.data).toMatchObject({ messageId: m.id, hidden: true });

    expect(ids(await list(app, bob, chat.id))).not.toContain(m.id);   // hidden for Bob
    expect(ids(await list(app, alice, chat.id))).toContain(m.id);     // sender still sees it
  });

  test("hidden state persists across repeated fetches (reload) and later messages", async () => {
    const m1 = await send(app, alice, chat.id, "first");
    await request(app).post(`/api/messages/${m1.id}/hide`).set(auth(bob));

    await list(app, bob, chat.id);                                  // first reload
    const m2 = await send(app, alice, chat.id, "second");           // new traffic after hiding
    const afterReload = ids(await list(app, bob, chat.id));         // second reload
    expect(afterReload).not.toContain(m1.id);
    expect(afterReload).toContain(m2.id);
  });

  test("hiding twice is idempotent", async () => {
    const m = await send(app, alice, chat.id, "once");
    const a = await request(app).post(`/api/messages/${m.id}/hide`).set(auth(bob));
    const b = await request(app).post(`/api/messages/${m.id}/hide`).set(auth(bob));
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(ids(await list(app, bob, chat.id))).not.toContain(m.id);
  });

  test("original content and translations are untouched for everyone else", async () => {
    const m = await send(app, alice, chat.id, "keep my words intact");
    await request(app).post(`/api/messages/${m.id}/hide`).set(auth(bob));
    const seenByAlice = (await list(app, alice, chat.id)).find((x) => x.id === m.id);
    expect(seenByAlice.content).toBe("keep my words intact");
    expect(seenByAlice.deletedAt).toBeFalsy();
  });

  test("sidebar preview (lastMessage) never shows a message the user hid", async () => {
    await send(app, alice, chat.id, "older visible");
    const newest = await send(app, alice, chat.id, "newest — to be hidden");
    await request(app).post(`/api/messages/${newest.id}/hide`).set(auth(bob));

    const bobChats = (await request(app).get("/api/chats").set(auth(bob))).body.data.chats;
    const aliceChats = (await request(app).get("/api/chats").set(auth(alice))).body.data.chats;
    expect(bobChats.find((c) => c.id === chat.id).lastMessage.content).toBe("older visible");
    expect(aliceChats.find((c) => c.id === chat.id).lastMessage.content).toBe("newest — to be hidden");
  });

  test("sidebar preview is empty when the user hid every message", async () => {
    const m = await send(app, alice, chat.id, "only message");
    await request(app).post(`/api/messages/${m.id}/hide`).set(auth(bob));
    const bobChats = (await request(app).get("/api/chats").set(auth(bob))).body.data.chats;
    expect(bobChats.find((c) => c.id === chat.id).lastMessage).toBeNull();
  });

  test("search never returns a message the user hid (other user still finds it)", async () => {
    const m = await send(app, alice, chat.id, "zebra crossing");
    await request(app).post(`/api/messages/${m.id}/hide`).set(auth(bob));

    const bobHits = await request(app).get("/api/search").query({ q: "zebra", chatId: chat.id }).set(auth(bob));
    const aliceHits = await request(app).get("/api/search").query({ q: "zebra", chatId: chat.id }).set(auth(alice));
    expect(ids(bobHits.body.data.results)).not.toContain(m.id);
    expect(ids(aliceHits.body.data.results)).toContain(m.id);
  });

  test("a non-member cannot hide a message in someone else's chat (403)", async () => {
    const mallory = await register(app, "mallory@t.io", "Mallory");
    const m = await send(app, alice, chat.id, "private");
    const r = await request(app).post(`/api/messages/${m.id}/hide`).set(auth(mallory));
    expect(r.status).toBe(403);
    expect(ids(await list(app, bob, chat.id))).toContain(m.id);      // nothing changed for Bob
  });

  test("unknown message → 404, unauthenticated → 401", async () => {
    const unknown = await request(app).post("/api/messages/00000000-0000-4000-8000-000000000000/hide").set(auth(bob));
    expect(unknown.status).toBe(404);
    const m = await send(app, alice, chat.id, "x");
    const anon = await request(app).post(`/api/messages/${m.id}/hide`);
    expect(anon.status).toBe(401);
  });

  test("the sender can also hide their own message for themselves without affecting the recipient", async () => {
    const m = await send(app, alice, chat.id, "mine");
    const r = await request(app).post(`/api/messages/${m.id}/hide`).set(auth(alice));
    expect(r.status).toBe(200);
    expect(ids(await list(app, alice, chat.id))).not.toContain(m.id);
    expect(ids(await list(app, bob, chat.id))).toContain(m.id);
  });
});

describe("Delete for me — group chat", () => {
  test("hiding for one member leaves the sender and every other member unaffected", async () => {
    const { app } = buildApp();
    const alice = await register(app, "ga@t.io", "Alice");
    const bob = await register(app, "gb@t.io", "Bob");
    const carol = await register(app, "gc@t.io", "Carol");
    const g = await request(app).post("/api/chats/group").set(auth(alice))
      .send({ name: "Trio", memberIds: [bob.user.id, carol.user.id] });
    const groupId = g.body.data.chat.id;

    const m = await send(app, alice, groupId, "hi group");
    const hide = await request(app).post(`/api/messages/${m.id}/hide`).set(auth(bob));
    expect(hide.status).toBe(200);

    expect(ids(await list(app, bob, groupId))).not.toContain(m.id);
    expect(ids(await list(app, carol, groupId))).toContain(m.id);
    expect(ids(await list(app, alice, groupId))).toContain(m.id);
  });
});

describe("Own-message delete is unchanged (regression)", () => {
  test("sender delete is still a global soft-delete; a non-admin recipient still cannot globally delete", async () => {
    const { app } = buildApp();
    const alice = await register(app, "da@t.io", "Alice");
    const bob = await register(app, "db@t.io", "Bob");
    const chat = await directChat(app, alice, bob);

    const keep = await send(app, alice, chat.id, "alice message A");
    const forbidden = await request(app).delete(`/api/messages/${keep.id}`).set(auth(bob));
    expect(forbidden.status).toBe(403);                                   // recipient: no global delete
    expect(ids(await list(app, alice, chat.id))).toContain(keep.id);

    const del = await request(app).delete(`/api/messages/${keep.id}`).set(auth(alice));
    expect(del.status).toBe(200);                                         // sender: global delete works
    expect(ids(await list(app, alice, chat.id))).not.toContain(keep.id);
    expect(ids(await list(app, bob, chat.id))).not.toContain(keep.id);    // gone for everyone (existing semantics)
  });
});
