const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const { createMemoryStore } = require("../helpers/buildApp");
const { signAccessToken } = require("../../server/utils/jwt");

/**
 * End-to-end WebSocket test of D2 sync:since replay.
 *
 * Spins up a real WS server on an ephemeral port with the shared in-memory
 * store. Verifies the D2 contract: missed messages are replayed as
 * "message:new" events; own-sent messages are excluded; invalid timestamps
 * clamp to a 14-day floor; sync:truncated fires when > 200 messages missed
 * in a single chat; chatIds filter works and silently drops chats the user
 * is not a member of.
 */

describe("WebSocket D2 sync:since", () => {
  let httpServer;
  let wsAddress;
  let store;
  let alice, bob;
  let chat;

  async function setupServer() {
    jest.resetModules();
    store = createMemoryStore();
    jest.doMock(path.resolve(__dirname, "../../server/db/store.js"), () => store, { virtual: false });

    const { createSocketServer } = require("../../server/ws/socketServer");
    httpServer = http.createServer();
    createSocketServer(httpServer);

    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const { port } = httpServer.address();
    wsAddress = `ws://127.0.0.1:${port}/ws`;
  }

  async function seed() {
    alice = await store.createUser({ email: "a@t.io", passwordHash: "x", displayName: "Alice", primaryLang: "en" });
    bob   = await store.createUser({ email: "b@t.io", passwordHash: "x", displayName: "Bob",   primaryLang: "ja" });
    chat = await store.createChat({ type: "direct", createdBy: alice.id });
    await store.addChatMember({ chatId: chat.id, userId: alice.id, receiveLang: "en", autoTranslate: true });
    await store.addChatMember({ chatId: chat.id, userId: bob.id,   receiveLang: "ja", autoTranslate: true });
  }

  function openSocket(userId) {
    const token = signAccessToken({ id: userId, role: "user" });
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${wsAddress}?token=${encodeURIComponent(token)}`);
      ws._events = [];
      ws.on("message", (raw) => {
        try { ws._events.push(JSON.parse(raw.toString())); } catch {}
      });
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
    });
  }

  function sendWs(ws, event, payload) {
    ws.send(JSON.stringify({ event, payload }));
  }

  /**
   * Clean single-poll wait: resolves with the first matching event, or
   * rejects with a clear list of seen events on timeout.
   */
  function waitForEvent(ws, eventName, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function poll() {
        const found = ws._events.find((e) => e.event === eventName);
        if (found) return resolve(found);
        if (Date.now() - start > timeoutMs) {
          const seen = ws._events.map((e) => e.event).join(",") || "(none)";
          return reject(new Error(`Timed out waiting for ${eventName}; saw: ${seen}`));
        }
        setTimeout(poll, 25);
      })();
    });
  }

  afterEach(async () => {
    if (httpServer && httpServer.listening) {
      await new Promise((resolve) => httpServer.close(() => resolve()));
    }
  });

  test("replays missed messages in chronological order", async () => {
    await setupServer();
    await seed();

    // Two messages from Bob, forced to specific older timestamps.
    const t1 = new Date(Date.now() - 60_000).toISOString();
    const t2 = new Date(Date.now() - 30_000).toISOString();
    const m1 = await store.createMessage({ chatId: chat.id, senderId: bob.id, type: "text", content: "ohayō" });
    const m2 = await store.createMessage({ chatId: chat.id, senderId: bob.id, type: "text", content: "nani shiteru?" });
    store._raw.messages.get(m1.id).createdAt = t1;
    store._raw.messages.get(m2.id).createdAt = t2;

    const alSock = await openSocket(alice.id);
    const since = new Date(Date.parse(t1) - 1000).toISOString();
    sendWs(alSock, "sync:since", { lastSeenAt: since });

    const complete = await waitForEvent(alSock, "sync:complete");
    expect(complete.payload.totalMessages).toBe(2);
    expect(complete.payload.chatsSynced).toBeGreaterThanOrEqual(1);

    const replayed = alSock._events.filter((e) => e.event === "message:new");
    expect(replayed.length).toBe(2);
    // Chronological order — m1 (older) before m2 (newer)
    expect(replayed[0].payload.message.id).toBe(m1.id);
    expect(replayed[1].payload.message.id).toBe(m2.id);
    expect(replayed[0].payload._replayed).toBe(true);

    alSock.close();
  });

  test("does NOT replay the user's own messages", async () => {
    await setupServer();
    await seed();

    await store.createMessage({ chatId: chat.id, senderId: alice.id, type: "text", content: "my own message" });
    await store.createMessage({ chatId: chat.id, senderId: bob.id,   type: "text", content: "from bob" });

    const alSock = await openSocket(alice.id);
    sendWs(alSock, "sync:since", { lastSeenAt: new Date(Date.now() - 120_000).toISOString() });

    const complete = await waitForEvent(alSock, "sync:complete");
    expect(complete.payload.totalMessages).toBe(1);

    const newEvents = alSock._events.filter((e) => e.event === "message:new");
    expect(newEvents.length).toBe(1);
    expect(newEvents[0].payload.message.content).toBe("from bob");

    alSock.close();
  });

  test("clamps missing lastSeenAt to 14-day lookback floor", async () => {
    await setupServer();
    await seed();

    await store.createMessage({ chatId: chat.id, senderId: bob.id, type: "text", content: "recent" });

    const alSock = await openSocket(alice.id);
    sendWs(alSock, "sync:since", {}); // no lastSeenAt — server must clamp

    const complete = await waitForEvent(alSock, "sync:complete");
    expect(complete.payload.totalMessages).toBe(1);

    const sinceMs = Date.parse(complete.payload.since);
    const diffDays = (Date.now() - sinceMs) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(13);
    expect(diffDays).toBeLessThan(15);

    alSock.close();
  });

  test("emits sync:truncated when > 200 messages missed in a single chat", async () => {
    await setupServer();
    await seed();

    for (let i = 0; i < 205; i++) {
      await store.createMessage({ chatId: chat.id, senderId: bob.id, type: "text", content: `msg ${i}` });
    }

    const alSock = await openSocket(alice.id);
    sendWs(alSock, "sync:since", { lastSeenAt: new Date(Date.now() - 120_000).toISOString() });

    const truncated = await waitForEvent(alSock, "sync:truncated");
    expect(truncated.payload.chatIds).toContain(chat.id);
    expect(truncated.payload.capPerChat).toBe(200);

    const complete = await waitForEvent(alSock, "sync:complete");
    expect(complete.payload.totalMessages).toBe(200);

    alSock.close();
  });

  test("limits sync to explicitly requested chatIds when provided", async () => {
    await setupServer();
    await seed();

    const chat2 = await store.createChat({ type: "direct", createdBy: alice.id });
    await store.addChatMember({ chatId: chat2.id, userId: alice.id });
    await store.addChatMember({ chatId: chat2.id, userId: bob.id });
    await store.createMessage({ chatId: chat.id,  senderId: bob.id, type: "text", content: "chat1" });
    await store.createMessage({ chatId: chat2.id, senderId: bob.id, type: "text", content: "chat2" });

    const alSock = await openSocket(alice.id);
    sendWs(alSock, "sync:since", {
      lastSeenAt: new Date(Date.now() - 120_000).toISOString(),
      chatIds: [chat.id],
    });

    const complete = await waitForEvent(alSock, "sync:complete");
    expect(complete.payload.totalMessages).toBe(1);

    const newEvents = alSock._events.filter((e) => e.event === "message:new");
    expect(newEvents.length).toBe(1);
    expect(newEvents[0].payload.message.content).toBe("chat1");

    alSock.close();
  });

  test("silently filters chats the user is not a member of (probe attempt)", async () => {
    await setupServer();
    await seed();

    const carol = await store.createUser({ email: "c@t.io", passwordHash: "x", displayName: "Carol", primaryLang: "es" });
    const chatC = await store.createChat({ type: "direct", createdBy: bob.id });
    await store.addChatMember({ chatId: chatC.id, userId: bob.id });
    await store.addChatMember({ chatId: chatC.id, userId: carol.id });
    await store.createMessage({ chatId: chatC.id, senderId: bob.id, type: "text", content: "secret" });

    const alSock = await openSocket(alice.id);
    sendWs(alSock, "sync:since", {
      lastSeenAt: new Date(Date.now() - 120_000).toISOString(),
      chatIds: [chatC.id], // Alice is not in this chat
    });

    const complete = await waitForEvent(alSock, "sync:complete");
    expect(complete.payload.totalMessages).toBe(0);
    expect(complete.payload.chatsSynced).toBe(0);

    const newEvents = alSock._events.filter((e) => e.event === "message:new");
    expect(newEvents.length).toBe(0);

    alSock.close();
  });
});
