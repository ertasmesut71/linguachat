/**
 * LinguaChat25 — realtime delete sync.
 *
 * Runs the REST routes and the real WebSocket server against the same in-memory
 * store: DELETE /api/messages/:id must push "message:deleted" to chat members,
 * while POST /api/messages/:id/hide (delete-for-me) must stay private.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const request = require("supertest");
const WebSocket = require("ws");
const { buildApp } = require("../helpers/buildApp");

const NEGATIVE_WAIT_MS = 300;

describe("LC25 realtime delete", () => {
  let app, store, httpServer, wsAddress, alice, bob, outsider, chat, sockets;

  const auth = (user) => ({ Authorization: `Bearer ${user.token}` });

  async function register(name) {
    const r = await request(app)
      .post("/api/auth/register")
      .send({ email: `lc25_${name}@test.dev`, password: "Pass1234!", displayName: name });
    if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
    return { token: r.body.data.accessToken, id: r.body.data.user.id };
  }

  function openSocket(user) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${wsAddress}?token=${encodeURIComponent(user.token)}`);
      ws._events = [];
      ws.on("message", (raw) => { ws._events.push(JSON.parse(raw.toString())); });
      ws.on("error", reject);
      // presence:init is sent only after the server has registered the connection.
      const ready = setInterval(() => {
        if (ws._events.some((e) => e.event === "presence:init")) { clearInterval(ready); resolve(ws); }
      }, 10);
      sockets.push(ws);
    });
  }

  function waitForEvent(ws, name, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function poll() {
        const found = ws._events.find((e) => e.event === name);
        if (found) return resolve(found);
        if (Date.now() - start > timeoutMs) return reject(new Error(`Timed out waiting for ${name}`));
        setTimeout(poll, 20);
      })();
    });
  }

  const deletedEvents = (ws) => ws._events.filter((e) => e.event === "message:deleted");
  const settle = () => new Promise((r) => setTimeout(r, NEGATIVE_WAIT_MS));

  async function sendMessage(user, content) {
    const r = await request(app).post(`/api/chats/${chat.id}/messages`).set(auth(user)).send({ content });
    if (r.status !== 201) throw new Error(`send failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data.message;
  }

  beforeEach(async () => {
    sockets = [];
    ({ app, store } = buildApp());
    const { createSocketServer } = require("../../server/ws/socketServer");
    httpServer = http.createServer();
    createSocketServer(httpServer);
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    wsAddress = `ws://127.0.0.1:${httpServer.address().port}/ws`;

    alice = await register("alice");
    bob = await register("bob");
    outsider = await register("outsider");
    const r = await request(app).post("/api/chats/direct").set(auth(alice)).send({ otherUserId: bob.id });
    chat = r.body.data.chat;
  });

  afterEach(async () => {
    sockets.forEach((ws) => ws.terminate());
    if (httpServer.listening) await new Promise((r) => httpServer.close(() => r()));
  });

  test("DELETE pushes message:deleted to the receiver without a refetch", async () => {
    const msg = await sendMessage(alice, "secret");
    const bobWs = await openSocket(bob);

    const r = await request(app).delete(`/api/messages/${msg.id}`).set(auth(alice));
    expect(r.status).toBe(200);

    const { payload } = await waitForEvent(bobWs, "message:deleted");
    expect(payload).toEqual({ chatId: chat.id, messageId: msg.id, deletedAt: expect.any(String) });
    expect(Number.isNaN(Date.parse(payload.deletedAt))).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("secret");

    const stored = await store.findMessageById(msg.id);
    expect(new Date(payload.deletedAt).toISOString()).toBe(new Date(stored.deletedAt).toISOString());
  });

  test("DELETE also reaches the sender's own connections, once each", async () => {
    const msg = await sendMessage(alice, "multi-device");
    const aliceWs = await openSocket(alice);
    const bobWs = await openSocket(bob);

    await request(app).delete(`/api/messages/${msg.id}`).set(auth(alice)).expect(200);
    await waitForEvent(aliceWs, "message:deleted");
    await waitForEvent(bobWs, "message:deleted");
    await settle();

    expect(deletedEvents(aliceWs)).toHaveLength(1);
    expect(deletedEvents(bobWs)).toHaveLength(1);
  });

  test("a non-member connection does not receive the event", async () => {
    const msg = await sendMessage(alice, "members only");
    const outsiderWs = await openSocket(outsider);
    const bobWs = await openSocket(bob);

    await request(app).delete(`/api/messages/${msg.id}`).set(auth(alice)).expect(200);
    await waitForEvent(bobWs, "message:deleted");
    await settle();

    expect(deletedEvents(outsiderWs)).toHaveLength(0);
  });

  test("a rejected DELETE emits nothing and leaves the message intact", async () => {
    const msg = await sendMessage(alice, "not yours");
    const aliceWs = await openSocket(alice);
    const bobWs = await openSocket(bob);

    await request(app).delete(`/api/messages/${msg.id}`).set(auth(bob)).expect(403);
    await settle();

    expect(deletedEvents(aliceWs)).toHaveLength(0);
    expect(deletedEvents(bobWs)).toHaveLength(0);
    expect((await store.findMessageById(msg.id)).deletedAt).toBeFalsy();
  });

  test("a soft-delete that did not persist emits nothing", async () => {
    const msg = await sendMessage(alice, "db failure");
    const bobWs = await openSocket(bob);
    store.softDeleteMessage = async () => null; // production store returns null on a DB error

    await request(app).delete(`/api/messages/${msg.id}`).set(auth(alice));
    await settle();

    expect(deletedEvents(bobWs)).toHaveLength(0);
  });

  test("delete-for-me (hide) emits no global event", async () => {
    const msg = await sendMessage(alice, "hide only for bob");
    const aliceWs = await openSocket(alice);
    const bobWs = await openSocket(bob);

    await request(app).post(`/api/messages/${msg.id}/hide`).set(auth(bob)).expect(200);
    await settle();

    expect(deletedEvents(aliceWs)).toHaveLength(0);
    expect(deletedEvents(bobWs)).toHaveLength(0);
    expect((await store.findMessageById(msg.id)).deletedAt).toBeFalsy();
  });

  describe("reconnect sync", () => {
    const syncSince = (ws, payload) => ws.send(JSON.stringify({ event: "sync:since", payload }));
    const deleteAs = (user, msg) => request(app).delete(`/api/messages/${msg.id}`).set(auth(user)).expect(200);

    test("replays a deletion that happened while the receiver was offline", async () => {
      const msg = await sendMessage(alice, "offline secret");
      const lastSeenAt = new Date(Date.now() - 1000).toISOString();
      await deleteAs(alice, msg); // no socket open for bob: the live event is missed

      const bobWs = await openSocket(bob);
      expect(deletedEvents(bobWs)).toHaveLength(0);
      syncSince(bobWs, { lastSeenAt });
      await waitForEvent(bobWs, "sync:complete");

      const events = deletedEvents(bobWs);
      expect(events).toHaveLength(1);
      expect(events[0].payload).toEqual({ chatId: chat.id, messageId: msg.id, deletedAt: expect.any(String) });
      expect(JSON.stringify(events[0].payload)).not.toContain("offline secret");
    });

    test("emits deletions before sync:complete", async () => {
      const msg = await sendMessage(alice, "order");
      const lastSeenAt = new Date(Date.now() - 1000).toISOString();
      await deleteAs(alice, msg);

      const bobWs = await openSocket(bob);
      syncSince(bobWs, { lastSeenAt });
      await waitForEvent(bobWs, "sync:complete");

      const names = bobWs._events.map((e) => e.event);
      expect(names.indexOf("message:deleted")).toBeLessThan(names.indexOf("sync:complete"));
    });

    test("does not replay deletions older than lastSeenAt", async () => {
      const msg = await sendMessage(alice, "old news");
      await deleteAs(alice, msg);
      await new Promise((r) => setTimeout(r, 10));
      const lastSeenAt = new Date().toISOString();

      const bobWs = await openSocket(bob);
      syncSince(bobWs, { lastSeenAt });
      await waitForEvent(bobWs, "sync:complete");

      expect(deletedEvents(bobWs)).toHaveLength(0);
    });

    test("a non-member gets nothing, even when naming the chat", async () => {
      const msg = await sendMessage(alice, "members only");
      const lastSeenAt = new Date(Date.now() - 1000).toISOString();
      await deleteAs(alice, msg);

      const outsiderWs = await openSocket(outsider);
      syncSince(outsiderWs, { lastSeenAt, chatIds: [chat.id] });
      await waitForEvent(outsiderWs, "sync:complete");

      expect(deletedEvents(outsiderWs)).toHaveLength(0);
    });

    test("includes archived chats, whose messages may still be loaded", async () => {
      const msg = await sendMessage(alice, "archived");
      const lastSeenAt = new Date(Date.now() - 1000).toISOString();
      await request(app).patch(`/api/chats/${chat.id}/my-settings`).set(auth(bob)).send({ archived: true }).expect(200);
      await deleteAs(alice, msg);

      const bobWs = await openSocket(bob);
      syncSince(bobWs, { lastSeenAt });
      await waitForEvent(bobWs, "sync:complete");

      expect(deletedEvents(bobWs)).toHaveLength(1);
    });

    test("a hide (delete-for-me) is not replayed as a global deletion", async () => {
      const msg = await sendMessage(alice, "hidden by bob");
      const lastSeenAt = new Date(Date.now() - 1000).toISOString();
      await request(app).post(`/api/messages/${msg.id}/hide`).set(auth(bob)).expect(200);

      const aliceWs = await openSocket(alice);
      syncSince(aliceWs, { lastSeenAt });
      await waitForEvent(aliceWs, "sync:complete");

      expect(deletedEvents(aliceWs)).toHaveLength(0);
    });
  });
});

describe("LC25 reconnect sync (production query and client anchor)", () => {
  test("the query is scoped to the user's memberships, read-only and capped", async () => {
    jest.resetModules();
    const storePath = path.resolve(__dirname, "../../server/db/store.js");
    jest.dontMock(storePath);
    const findMany = jest.fn(async () => []);
    jest.doMock("@prisma/client", () => ({ PrismaClient: jest.fn(() => ({ message: { findMany } })) }));
    const productionStore = require(storePath);
    const since = new Date("2026-11-01T00:00:00Z");

    await productionStore.listDeletedMessagesSince("me", since, { chatIds: ["c1"] });

    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      deletedAt: { gt: since },
      chat: { members: { some: { userId: "me" } } },
      chatId: { in: ["c1"] },
    });
    expect(args.select).toEqual({ id: true, chatId: true, deletedAt: true });
    expect(args.take).toBe(500);
  });

  test("a fresh session anchors on connect so the first drop still syncs", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../client/src/api/socket.js"), "utf8");
    const onOpen = src.slice(src.indexOf("this.ws.onopen"), src.indexOf("this.ws.onmessage"));
    expect(onOpen).toContain("if (!this._syncAnchor) this.setSyncAnchor(new Date().toISOString());");
    // Must come after the sync decision, or a fresh login would sync on its very first connect.
    expect(onOpen.indexOf("this.requestSync()")).toBeLessThan(onOpen.indexOf("setSyncAnchor"));
  });
});

// The client store is ESM/JSX-side code that Jest does not transform here, so
// these pin the handler's contract at source level.
describe("LC25 client wiring (source-level)", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../client/src/store/chatStore.js"), "utf8");
  const handler = src.slice(
    src.indexOf('socket.on("message:deleted"'),
    src.indexOf('socket.on("message:translation-updated"'),
  );

  test("registers a message:deleted listener that marks the message deleted", () => {
    expect(handler).toContain('socket.on("message:deleted"');
    expect(handler).toMatch(/content: "This message was deleted", deletedAt/);
  });

  test("the echo and the optimistic update both skip an already-deleted message", () => {
    expect(handler).toContain("m.id === messageId && !m.deletedAt");
    const local = src.slice(src.indexOf("deleteMessage: async"), src.indexOf("setReplyTo:"));
    expect(local).toContain("m.id === messageId && !m.deletedAt");
  });

  test("drops the translation and clears pinned and sidebar copies of the text", () => {
    expect(handler).toContain("translation: null, _allTranslations: null");
    expect(handler).toContain("pinnedMessages: s.pinnedMessages.filter((p) => p.id !== messageId)");
    expect(handler).toContain("c.lastMessage?.id === messageId");
    expect(handler).toContain("get().fetchChats()");
  });
});
