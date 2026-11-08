const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const { createMemoryStore } = require("../helpers/buildApp");
const { signAccessToken } = require("../../server/utils/jwt");

/**
 * Real WebSocket server + in-memory store, two behaviours:
 *
 *  1. Reconnect (sync:since) must NOT replay a message the user hid with
 *     "Delete for me" — otherwise it would "reappear" after every reconnect.
 *  2. The server side of real-time profile/avatar updates: an event published on
 *     the "ws:profile-updated" channel (exactly what the profile editor and the
 *     avatar upload publish) reaches OTHER connected users as
 *     "user:profile-updated" with the new avatarUrl, and never echoes to the sender.
 */
describe("WebSocket — hidden messages and profile real-time", () => {
  let httpServer, wsAddress, store, alice, bob, chat;

  async function setupServer() {
    jest.resetModules();
    store = createMemoryStore();
    jest.doMock(path.resolve(__dirname, "../../server/db/store.js"), () => store, { virtual: false });
    const { createSocketServer } = require("../../server/ws/socketServer");
    httpServer = http.createServer();
    createSocketServer(httpServer);
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    wsAddress = `ws://127.0.0.1:${httpServer.address().port}/ws`;
  }

  async function seed() {
    alice = await store.createUser({ email: "a@t.io", passwordHash: "x", displayName: "Alice", primaryLang: "en" });
    bob = await store.createUser({ email: "b@t.io", passwordHash: "x", displayName: "Bob", primaryLang: "en" });
    chat = await store.createChat({ type: "direct", createdBy: alice.id });
    await store.addChatMember({ chatId: chat.id, userId: alice.id, receiveLang: "en", autoTranslate: true });
    await store.addChatMember({ chatId: chat.id, userId: bob.id, receiveLang: "en", autoTranslate: true });
  }

  function openSocket(userId) {
    const token = signAccessToken({ id: userId, role: "user" });
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${wsAddress}?token=${encodeURIComponent(token)}`);
      ws._events = [];
      ws.on("message", (raw) => { try { ws._events.push(JSON.parse(raw.toString())); } catch {} });
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
    });
  }

  function waitForEvent(ws, name, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function poll() {
        const found = ws._events.find((e) => e.event === name);
        if (found) return resolve(found);
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`Timed out waiting for ${name}; saw: ${ws._events.map((e) => e.event).join(",") || "(none)"}`));
        }
        setTimeout(poll, 25);
      })();
    });
  }

  afterEach(async () => {
    if (httpServer && httpServer.listening) await new Promise((r) => httpServer.close(() => r()));
  });

  test("reconnect sync does not restore a message the user hid (others' messages still replay)", async () => {
    await setupServer();
    await seed();

    const m1 = await store.createMessage({ chatId: chat.id, senderId: alice.id, type: "text", content: "keep me" });
    const m2 = await store.createMessage({ chatId: chat.id, senderId: alice.id, type: "text", content: "hidden by bob" });
    const m3 = await store.createMessage({ chatId: chat.id, senderId: alice.id, type: "text", content: "keep me too" });
    await store.hideMessageForUser(m2.id, bob.id);

    const bobSock = await openSocket(bob.id);
    bobSock.send(JSON.stringify({ event: "sync:since", payload: { lastSeenAt: new Date(Date.now() - 120_000).toISOString() } }));
    const complete = await waitForEvent(bobSock, "sync:complete");

    const replayed = bobSock._events.filter((e) => e.event === "message:new").map((e) => e.payload.message.id);
    expect(replayed).toEqual([m1.id, m3.id]);          // m2 is NOT restored
    expect(replayed).not.toContain(m2.id);
    expect(complete.payload.totalMessages).toBe(2);
    bobSock.close();
  });

  test("another member's reconnect still replays the same message (hiding is per-user)", async () => {
    await setupServer();
    await seed();
    const m = await store.createMessage({ chatId: chat.id, senderId: bob.id, type: "text", content: "from bob" });
    await store.hideMessageForUser(m.id, bob.id);       // Bob hides his own message for himself

    const aliceSock = await openSocket(alice.id);
    aliceSock.send(JSON.stringify({ event: "sync:since", payload: { lastSeenAt: new Date(Date.now() - 120_000).toISOString() } }));
    await waitForEvent(aliceSock, "sync:complete");
    const replayed = aliceSock._events.filter((e) => e.event === "message:new").map((e) => e.payload.message.id);
    expect(replayed).toContain(m.id);
    aliceSock.close();
  });

  test("avatar/profile update published on ws:profile-updated reaches other connected users, not the sender", async () => {
    await setupServer();
    await seed();
    const pubsub = require("../../server/utils/pubsub");

    const aliceSock = await openSocket(alice.id);
    const bobSock = await openSocket(bob.id);

    pubsub.publish("ws:profile-updated", {
      userId: alice.id, displayName: "Alice", bio: "hi",
      avatarUrl: "/api/media/new-avatar-id", primaryLang: "en", status: "online",
    });

    const evt = await waitForEvent(bobSock, "user:profile-updated");
    expect(evt.payload).toMatchObject({ userId: alice.id, avatarUrl: "/api/media/new-avatar-id", displayName: "Alice" });
    // public fields only
    expect(Object.keys(evt.payload).sort()).toEqual(["avatarUrl", "bio", "displayName", "primaryLang", "status", "userId"]);

    await new Promise((r) => setTimeout(r, 150));
    expect(aliceSock._events.some((e) => e.event === "user:profile-updated")).toBe(false);  // no echo to sender

    aliceSock.close(); bobSock.close();
  });
});
