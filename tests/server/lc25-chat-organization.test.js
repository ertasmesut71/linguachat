/**
 * LinguaChat25 — chat organization fix round.
 *
 * The in-memory store is a stand-in, so anything that depends on the production
 * query is also pinned against server/db/store.js with a fake PrismaClient.
 * That checks the query we build, not how PostgreSQL executes it.
 */
const fs = require("fs");
const path = require("path");

const request = require("supertest");
const { buildApp } = require("../helpers/buildApp");

const ROOT = path.resolve(__dirname, "../..");
const readSource = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

const auth = (user) => ({ Authorization: `Bearer ${user.token}` });
const tick = () => new Promise((r) => setTimeout(r, 5));

async function register(app, name) {
  const r = await request(app)
    .post("/api/auth/register")
    .send({ email: `lc25org_${name}@test.dev`, password: "Pass1234!", displayName: name });
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { token: r.body.data.accessToken, id: r.body.data.user.id };
}

async function send(app, user, chatId, content) {
  await tick(); // createdAt must be strictly after the previous timestamp
  const r = await request(app).post(`/api/chats/${chatId}/messages`).set(auth(user)).send({ content });
  if (r.status !== 201) throw new Error(`send failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data.message;
}

async function unreadOf(app, user, chatId) {
  const r = await request(app).get("/api/chats").set(auth(user));
  return r.body.data.chats.find((c) => c.id === chatId).unreadCount;
}

/** Loads the REAL production store with a fake PrismaClient. */
function loadProductionStore(fakePrisma) {
  jest.resetModules();
  jest.dontMock(path.join(ROOT, "server/db/store.js"));
  jest.doMock("@prisma/client", () => ({ PrismaClient: jest.fn(() => fakePrisma) }));
  return require(path.join(ROOT, "server/db/store.js"));
}

function fakeMembership({ chatId, lastReadAt, clearedAt = null, chat = {} }) {
  return {
    chatId, lastReadAt, clearedAt, archivedAt: null,
    chat: { id: chatId, type: "direct", members: [], messages: [], ...chat },
  };
}

describe("LC25 startup script", () => {
  const script = readSource("docker-entrypoint.sh");

  test("never passes --accept-data-loss and has no db push fallback", () => {
    expect(script).not.toContain("--accept-data-loss");
    expect(script).not.toContain("db push");
  });

  test("still runs migrate deploy, with errors visible", () => {
    expect(script).toContain("npx prisma migrate deploy");
    expect(script).not.toContain("2>/dev/null");
    expect(script).toMatch(/^set -e$/m);
  });
});

describe("LC25 unread count (API)", () => {
  let app, alice, bob, chat;

  beforeEach(async () => {
    ({ app } = buildApp());
    alice = await register(app, "alice");
    bob = await register(app, "bob");
    const r = await request(app).post("/api/chats/direct").set(auth(alice)).send({ otherUserId: bob.id });
    chat = r.body.data.chat;
  });

  test("counts only other people's messages newer than lastReadAt", async () => {
    await send(app, alice, chat.id, "one");
    await send(app, alice, chat.id, "two");
    await send(app, bob, chat.id, "my own reply");

    expect(await unreadOf(app, bob, chat.id)).toBe(2);
    expect(await unreadOf(app, alice, chat.id)).toBe(1);
  });

  test("opening the chat (mark seen) resets it", async () => {
    await send(app, alice, chat.id, "one");
    await tick();
    await request(app).post(`/api/chats/${chat.id}/seen`).set(auth(bob)).expect(200);

    expect(await unreadOf(app, bob, chat.id)).toBe(0);
  });

  test("Mark All as Read persists across a refetch", async () => {
    await send(app, alice, chat.id, "one");
    await tick();
    await request(app).post("/api/chats/read-all").set(auth(bob)).expect(200);

    expect(await unreadOf(app, bob, chat.id)).toBe(0);
    await send(app, alice, chat.id, "two");
    expect(await unreadOf(app, bob, chat.id)).toBe(1);
  });

  test("deleted and hidden messages do not count", async () => {
    const gone = await send(app, alice, chat.id, "deleted");
    const hidden = await send(app, alice, chat.id, "hidden");
    await send(app, alice, chat.id, "visible");
    await request(app).delete(`/api/messages/${gone.id}`).set(auth(alice)).expect(200);
    await request(app).post(`/api/messages/${hidden.id}/hide`).set(auth(bob)).expect(200);

    expect(await unreadOf(app, bob, chat.id)).toBe(1);
  });
});

describe("LC25 unread count (production store query)", () => {
  const T1 = new Date("2026-11-01T10:00:00Z");
  const T2 = new Date("2026-11-02T10:00:00Z");

  function fake(count) {
    return {
      $queryRawUnsafe: jest.fn(async () => []),
      chatMember: {
        findMany: jest.fn(async () => [
          fakeMembership({ chatId: "c1", lastReadAt: T1 }),
          fakeMembership({ chatId: "c2", lastReadAt: T1, clearedAt: T2 }),
          fakeMembership({ chatId: "c3", lastReadAt: T2, clearedAt: T1 }),
        ]),
      },
      message: { count },
    };
  }

  test("maps counts per chat; a chat without rows is 0", async () => {
    const count = jest.fn(async ({ where }) => (where.chatId === "c1" ? 4 : 0));
    const store = loadProductionStore(fake(count));
    const chats = await store.listUserChats("me");

    expect(chats.find((c) => c.id === "c1").unreadCount).toBe(4);
    expect(chats.find((c) => c.id === "c2").unreadCount).toBe(0);
    expect(count).toHaveBeenCalledTimes(3);
  });

  test("queries with sender, deleted and later-of(lastReadAt, clearedAt) filters", async () => {
    const count = jest.fn(async () => 0);
    const store = loadProductionStore(fake(count));
    await store.listUserChats("me");

    // Exact match: with no hidden messages the where clause has no `id` key at all.
    const base = {
      senderId: { not: "me" },
      deletedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
    };
    expect(count.mock.calls.map(([args]) => args.where)).toEqual([
      { ...base, chatId: "c1", createdAt: { gt: T1 } },
      { ...base, chatId: "c2", createdAt: { gt: T2 } },
      { ...base, chatId: "c3", createdAt: { gt: T2 } },
    ]);
  });

  test("a failing count keeps the chat list and logs the error", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const store = loadProductionStore(fake(jest.fn(async () => { throw new Error("db down"); })));
    const chats = await store.listUserChats("me");

    expect(chats).toHaveLength(3);
    expect(chats.every((c) => c.unreadCount === 0)).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("unread count failed"), "db down");
    spy.mockRestore();
  });
});

describe("LC25 expired messages stay stored but are filtered", () => {
  let app, store, alice, bob, chat;

  beforeEach(async () => {
    ({ app, store } = buildApp());
    alice = await register(app, "alice");
    bob = await register(app, "bob");
    const r = await request(app).post("/api/chats/direct").set(auth(alice)).send({ otherUserId: bob.id });
    chat = r.body.data.chat;
  });

  /** Sends a starred + pinned message that has already expired. */
  async function expiredStarredPinned() {
    const live = await send(app, alice, chat.id, "still alive");
    const msg = await send(app, alice, chat.id, "vanishing secret");
    for (const m of [live, msg]) {
      await request(app).post(`/api/messages/${m.id}/star`).set(auth(alice)).expect(200);
      const r = await request(app).post(`/api/chats/${chat.id}/pin`).set(auth(alice)).send({ messageId: m.id });
      expect(r.status).toBeLessThan(300);
    }
    store._raw.messages.get(msg.id).expiresAt = new Date(Date.now() - 1000).toISOString();
    return { live, msg };
  }

  test("starred list omits it, the row is still in the store", async () => {
    const { live, msg } = await expiredStarredPinned();
    const r = await request(app).get("/api/starred").set(auth(alice)).expect(200);

    expect(r.body.data.messages.map((m) => m.id)).toEqual([live.id]);
    expect(await store.findMessageById(msg.id)).toMatchObject({ id: msg.id, content: "vanishing secret" });
  });

  test("pinned list omits it and exposes expiresAt for live pins", async () => {
    const { live } = await expiredStarredPinned();
    const r = await request(app).get(`/api/chats/${chat.id}/pinned`).set(auth(alice)).expect(200);

    expect(r.body.data.pins.map((p) => p.messageId)).toEqual([live.id]);
    expect(r.body.data.pins[0]).toHaveProperty("expiresAt", null);
  });

  test("messages sent under a timer carry expiresAt for the client", async () => {
    await request(app).patch(`/api/chats/${chat.id}`).set(auth(alice)).send({ disappearingTimer: 3600 }).expect(200);
    const msg = await send(app, alice, chat.id, "timed");
    expect(Date.parse(msg.expiresAt)).toBeGreaterThan(Date.now());
  });
});

describe("LC25 expired messages (production queries and client wiring)", () => {
  function rawFake() {
    return { $queryRawUnsafe: jest.fn(async () => []) };
  }

  test("starred and pinned SQL filter on expires_at and never delete", async () => {
    const fake = rawFake();
    const store = loadProductionStore(fake);
    await store.getStarredMessages("me");
    await store.getPinnedMessages("c1");

    const [starredSql, pinnedSql] = fake.$queryRawUnsafe.mock.calls.map((c) => c[0]);
    for (const sql of [starredSql, pinnedSql]) {
      expect(sql).toContain("(m.expires_at IS NULL OR m.expires_at > NOW())");
      expect(sql).not.toMatch(/\bDELETE\b/i);
    }
    expect(pinnedSql).toContain('m.expires_at AS "expiresAt"');
  });

  test("the client prunes on an interval that stops on logout, and removes no data on the server", () => {
    const src = readSource("client/src/store/chatStore.js");
    expect(src).toContain("setInterval(() => get().pruneExpiredMessages(), EXPIRY_CHECK_MS)");
    const prune = src.slice(src.indexOf("pruneExpiredMessages: ("), src.indexOf("// ═══ CHATS ═══"));
    expect(prune).not.toContain("api.delete");
    const disconnect = src.slice(src.indexOf("disconnectSocket:"), src.indexOf("pruneExpiredMessages: ("));
    expect(disconnect).toContain("clearInterval(expiryTimer)");
    expect(src).toContain("expiresAt: p.expiresAt");
  });
});

describe("LC25 disappearing timer permissions", () => {
  let app, store, owner, admin, member, group;

  const setTimer = (user, chatId, value) =>
    request(app).patch(`/api/chats/${chatId}`).set(auth(user)).send({ disappearingTimer: value });

  beforeEach(async () => {
    ({ app, store } = buildApp());
    owner = await register(app, "owner");
    admin = await register(app, "admin");
    member = await register(app, "member");
    const r = await request(app).post("/api/chats/group").set(auth(owner))
      .send({ name: "Team", memberIds: [admin.id, member.id] });
    group = r.body.data.chat;
    await store.updateChatMember(group.id, admin.id, { role: "admin" });
  });

  test("group owner and admin can set it, a plain member gets 403 and nothing changes", async () => {
    await setTimer(owner, group.id, 3600).expect(200);
    await setTimer(admin, group.id, 300).expect(200);
    await setTimer(member, group.id, 30).expect(403);

    expect((await store.findChatById(group.id)).disappearingTimer).toBe(300);
  });

  test("a plain member cannot turn it off either", async () => {
    await setTimer(owner, group.id, 3600).expect(200);
    await setTimer(member, group.id, null).expect(403);

    expect((await store.findChatById(group.id)).disappearingTimer).toBe(3600);
  });

  test("a non-member still gets 403", async () => {
    const outsider = await register(app, "outsider");
    await setTimer(outsider, group.id, 30).expect(403);
  });

  test("either side of a direct chat can set it, and clear it", async () => {
    const r = await request(app).post("/api/chats/direct").set(auth(owner)).send({ otherUserId: member.id });
    const direct = r.body.data.chat;

    await setTimer(member, direct.id, 3600).expect(200);
    await setTimer(owner, direct.id, null).expect(200);
    expect((await store.findChatById(direct.id)).disappearingTimer).toBeNull();
  });

  test("a plain member can still set their own per-chat settings", async () => {
    await request(app).patch(`/api/chats/${group.id}/my-settings`).set(auth(member)).send({ muted: true }).expect(200);
  });
});

describe("LC25 disappearing timer is exposed", () => {
  test("production listUserChats returns the timer, null when off", async () => {
    const store = loadProductionStore({
      $queryRawUnsafe: jest.fn(async () => []),
      chatMember: {
        findMany: jest.fn(async () => [
          fakeMembership({ chatId: "on", lastReadAt: new Date(), chat: { disappearingTimer: 3600 } }),
          fakeMembership({ chatId: "off", lastReadAt: new Date(), chat: { disappearingTimer: null } }),
        ]),
      },
      message: { count: jest.fn(async () => 0) },
    });
    const chats = await store.listUserChats("me");

    expect(chats.find((c) => c.id === "on").disappearingTimer).toBe(3600);
    expect(chats.find((c) => c.id === "off").disappearingTimer).toBeNull();
  });

  test("settings reads the current value and locks the control for non-managers", () => {
    const src = readSource("client/src/components/chat/ChatSettings.jsx");
    expect(src).toContain("res.data?.chat?.disappearingTimer");
    expect(src).toContain("disabled={timerLoading || (isGroup && !isAdmin)}");
  });
});
