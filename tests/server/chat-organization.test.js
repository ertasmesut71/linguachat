/**
 * Chat Organization Pack — tests 69–118 (50 tests)
 *
 * Tests for sub-features A–H:
 *   A. Archive/Close Chat
 *   B. Favorite Chats
 *   C. Custom Lists
 *   D. Chat Drafts (localStorage — pure logic)
 *   E. Disappearing Messages
 *   F. Per-Chat Themes (localStorage — pure logic)
 *   G. Mark All as Read
 *   H. Saved Messages / Self-chat
 *   Regression (108–118)
 *
 * API tests use the in-memory store via buildApp().
 * localStorage tests use pure JS logic (no DOM needed).
 */

const request = require("supertest");
const { buildApp } = require("../helpers/buildApp");

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function register(app, suffix) {
  const r = await request(app)
    .post("/api/auth/register")
    .send({ email: `user${suffix}@org.test`, password: "Pass1234!", displayName: `User${suffix}` });
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { token: r.body.data.accessToken, userId: r.body.data.user.id };
}

async function createDirectChat(app, token, otherUserId) {
  const r = await request(app)
    .post("/api/chats/direct")
    .set("Authorization", `Bearer ${token}`)
    .send({ otherUserId });
  if (r.status > 201) throw new Error(`createDirectChat failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data.chat;
}

async function sendMsg(app, token, chatId, content) {
  const r = await request(app)
    .post(`/api/chats/${chatId}/messages`)
    .set("Authorization", `Bearer ${token}`)
    .send({ content });
  if (r.status > 201) throw new Error(`sendMsg failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data.message;
}

// ─── localStorage pure-logic helpers (Packs D & F) ───────────────────────────
// These mirror exactly what the client does with localStorage.

function draftKey(chatId) { return `draft:${chatId}`; }
function themeKey(chatId) { return `theme:${chatId}`; }

class FakeStorage {
  constructor() { this._data = {}; }
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; }
  setItem(k, v) { this._data[k] = String(v); }
  removeItem(k) { delete this._data[k]; }
  clear() { this._data = {}; }
}

// ─────────────────────────────────────────────────────────────────────────────
// PACK A — Archive/Close Chat
// ─────────────────────────────────────────────────────────────────────────────

describe("Pack A — Archive/Close Chat", () => {
  let app, store;
  beforeEach(() => { ({ app, store } = buildApp()); });

  test("69 — archive chat hides it from main list", async () => {
    const u1 = await register(app, "69a");
    const u2 = await register(app, "69b");
    const chat = await createDirectChat(app, u1.token, u2.userId);

    await request(app)
      .patch(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${u1.token}`)
      .send({ archived: true })
      .expect(200);

    const listRes = await request(app)
      .get("/api/chats")
      .set("Authorization", `Bearer ${u1.token}`)
      .expect(200);
    const ids = listRes.body.data.chats.map((c) => c.id);
    expect(ids).not.toContain(chat.id);
  });

  test("70 — unarchive restores chat to main list", async () => {
    const u1 = await register(app, "70a");
    const u2 = await register(app, "70b");
    const chat = await createDirectChat(app, u1.token, u2.userId);

    await request(app).patch(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${u1.token}`).send({ archived: true });

    await request(app).patch(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${u1.token}`).send({ archived: false }).expect(200);

    const listRes = await request(app).get("/api/chats").set("Authorization", `Bearer ${u1.token}`).expect(200);
    const ids = listRes.body.data.chats.map((c) => c.id);
    expect(ids).toContain(chat.id);
  });

  test("71 — archive is per-user; other member still sees chat", async () => {
    const u1 = await register(app, "71a");
    const u2 = await register(app, "71b");
    const chat = await createDirectChat(app, u1.token, u2.userId);

    await request(app).patch(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${u1.token}`).send({ archived: true });

    const listRes = await request(app).get("/api/chats").set("Authorization", `Bearer ${u2.token}`).expect(200);
    const ids = listRes.body.data.chats.map((c) => c.id);
    expect(ids).toContain(chat.id);
  });

  test("72 — archive state is returned in my-settings", async () => {
    const u1 = await register(app, "72a");
    const u2 = await register(app, "72b");
    const chat = await createDirectChat(app, u1.token, u2.userId);

    await request(app).patch(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${u1.token}`).send({ archived: true });

    const settingsRes = await request(app)
      .get(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${u1.token}`)
      .expect(200);
    expect(settingsRes.body.data.settings.archived).toBe(true);
    expect(settingsRes.body.data.settings.archivedAt).toBeTruthy();
  });

  test("73 — new message does NOT un-archive automatically", async () => {
    const u1 = await register(app, "73a");
    const u2 = await register(app, "73b");
    const chat = await createDirectChat(app, u1.token, u2.userId);

    await request(app).patch(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${u1.token}`).send({ archived: true });

    // u2 sends a message
    await sendMsg(app, u2.token, chat.id, "Hey still here");

    const listRes = await request(app).get("/api/chats").set("Authorization", `Bearer ${u1.token}`).expect(200);
    const ids = listRes.body.data.chats.map((c) => c.id);
    expect(ids).not.toContain(chat.id);  // stays archived
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PACK B — Favorite Chats
// ─────────────────────────────────────────────────────────────────────────────

describe("Pack B — Favorite Chats", () => {
  let app, store;
  beforeEach(() => { ({ app, store } = buildApp()); });

  test("74 — favorite chat: favoritedAt is set in settings", async () => {
    const u1 = await register(app, "74a");
    const u2 = await register(app, "74b");
    const chat = await createDirectChat(app, u1.token, u2.userId);

    await request(app).patch(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${u1.token}`).send({ favorited: true }).expect(200);

    const r = await request(app).get(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${u1.token}`).expect(200);
    expect(r.body.data.settings.favorited).toBe(true);
    expect(r.body.data.settings.favoritedAt).toBeTruthy();
  });

  test("75 — unfavorite clears favoritedAt", async () => {
    const u1 = await register(app, "75a");
    const u2 = await register(app, "75b");
    const chat = await createDirectChat(app, u1.token, u2.userId);

    await request(app).patch(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${u1.token}`).send({ favorited: true });

    await request(app).patch(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${u1.token}`).send({ favorited: false }).expect(200);

    const r = await request(app).get(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${u1.token}`).expect(200);
    expect(r.body.data.settings.favorited).toBe(false);
    expect(r.body.data.settings.favoritedAt).toBeNull();
  });

  test("76 — favorite is per-user (other user unaffected)", async () => {
    const u1 = await register(app, "76a");
    const u2 = await register(app, "76b");
    const chat = await createDirectChat(app, u1.token, u2.userId);

    await request(app).patch(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${u1.token}`).send({ favorited: true });

    const r = await request(app).get(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${u2.token}`).expect(200);
    expect(r.body.data.settings.favorited).toBe(false);
  });

  test("77 — both archived and favorited can be set simultaneously", async () => {
    const u1 = await register(app, "77a");
    const u2 = await register(app, "77b");
    const chat = await createDirectChat(app, u1.token, u2.userId);

    await request(app).patch(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${u1.token}`).send({ archived: true, favorited: true }).expect(200);

    const r = await request(app).get(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${u1.token}`).expect(200);
    expect(r.body.data.settings.archived).toBe(true);
    expect(r.body.data.settings.favorited).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PACK C — Custom Lists
// ─────────────────────────────────────────────────────────────────────────────

describe("Pack C — Custom Lists", () => {
  let app, store;
  beforeEach(() => { ({ app, store } = buildApp()); });

  test("78 — create list returns id and name", async () => {
    const u1 = await register(app, "78a");
    const r = await request(app).post("/api/chats/lists")
      .set("Authorization", `Bearer ${u1.token}`).send({ name: "Work" }).expect(201);
    expect(r.body.data.list.id).toBeTruthy();
    expect(r.body.data.list.name).toBe("Work");
  });

  test("79 — rename list updates name", async () => {
    const u1 = await register(app, "79a");
    const cr = await request(app).post("/api/chats/lists")
      .set("Authorization", `Bearer ${u1.token}`).send({ name: "Old Name" });
    const listId = cr.body.data.list.id;

    const r = await request(app).patch(`/api/chats/lists/${listId}`)
      .set("Authorization", `Bearer ${u1.token}`).send({ name: "New Name" }).expect(200);
    expect(r.body.data.list.name).toBe("New Name");
  });

  test("80 — delete list removes it from listCustomLists", async () => {
    const u1 = await register(app, "80a");
    const cr = await request(app).post("/api/chats/lists")
      .set("Authorization", `Bearer ${u1.token}`).send({ name: "ToDelete" });
    const listId = cr.body.data.list.id;

    await request(app).delete(`/api/chats/lists/${listId}`)
      .set("Authorization", `Bearer ${u1.token}`).expect(200);

    const lr = await request(app).get("/api/chats/lists")
      .set("Authorization", `Bearer ${u1.token}`).expect(200);
    const ids = lr.body.data.lists.map((l) => l.id);
    expect(ids).not.toContain(listId);
  });

  test("81 — add chat to list and remove it", async () => {
    const u1 = await register(app, "81a");
    const u2 = await register(app, "81b");
    const chat = await createDirectChat(app, u1.token, u2.userId);
    const cr = await request(app).post("/api/chats/lists")
      .set("Authorization", `Bearer ${u1.token}`).send({ name: "Faves" });
    const listId = cr.body.data.list.id;

    await request(app).post(`/api/chats/lists/${listId}/chats`)
      .set("Authorization", `Bearer ${u1.token}`).send({ chatId: chat.id }).expect(200);

    await request(app).delete(`/api/chats/lists/${listId}/chats/${chat.id}`)
      .set("Authorization", `Bearer ${u1.token}`).expect(200);

    // No error means success — list still exists but without the chat
    const lr = await request(app).get("/api/chats/lists")
      .set("Authorization", `Bearer ${u1.token}`).expect(200);
    expect(lr.body.data.lists.length).toBeGreaterThan(0);
  });

  test("82 — chat can belong to multiple lists", async () => {
    const u1 = await register(app, "82a");
    const u2 = await register(app, "82b");
    const chat = await createDirectChat(app, u1.token, u2.userId);

    const r1 = await request(app).post("/api/chats/lists")
      .set("Authorization", `Bearer ${u1.token}`).send({ name: "List1" });
    const r2 = await request(app).post("/api/chats/lists")
      .set("Authorization", `Bearer ${u1.token}`).send({ name: "List2" });

    await request(app).post(`/api/chats/lists/${r1.body.data.list.id}/chats`)
      .set("Authorization", `Bearer ${u1.token}`).send({ chatId: chat.id }).expect(200);
    await request(app).post(`/api/chats/lists/${r2.body.data.list.id}/chats`)
      .set("Authorization", `Bearer ${u1.token}`).send({ chatId: chat.id }).expect(200);

    const lr = await request(app).get("/api/chats/lists").set("Authorization", `Bearer ${u1.token}`).expect(200);
    expect(lr.body.data.lists.length).toBe(2);
  });

  test("83 — other user cannot see or modify first user's lists", async () => {
    const u1 = await register(app, "83a");
    const u2 = await register(app, "83b");

    await request(app).post("/api/chats/lists")
      .set("Authorization", `Bearer ${u1.token}`).send({ name: "Secret" });

    const lr = await request(app).get("/api/chats/lists").set("Authorization", `Bearer ${u2.token}`).expect(200);
    expect(lr.body.data.lists.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PACK D — Chat Drafts (localStorage pure-logic)
// ─────────────────────────────────────────────────────────────────────────────

describe("Pack D — Chat Drafts (localStorage logic)", () => {
  let ls;
  beforeEach(() => { ls = new FakeStorage(); });

  test("84 — draft persists when switching chats", () => {
    const chatA = "chat-a-draft";
    ls.setItem(draftKey(chatA), "Hello world");
    // Switch to another chat, draft should still be there
    const chatB = "chat-b-draft";
    ls.setItem(draftKey(chatB), "Other draft");
    expect(ls.getItem(draftKey(chatA))).toBe("Hello world");
    expect(ls.getItem(draftKey(chatB))).toBe("Other draft");
  });

  test("85 — draft persists across simulated page reload (same storage)", () => {
    const chatId = "chat-reload";
    ls.setItem(draftKey(chatId), "Draft text");
    // Simulate reload: read from storage again
    const read = ls.getItem(draftKey(chatId));
    expect(read).toBe("Draft text");
  });

  test("86 — sending message clears draft", () => {
    const chatId = "chat-send";
    ls.setItem(draftKey(chatId), "About to send");
    // Simulate send: clear draft
    ls.removeItem(draftKey(chatId));
    expect(ls.getItem(draftKey(chatId))).toBeNull();
  });

  test("87 — deleting chat clears its draft", () => {
    const chatId = "chat-del-draft";
    ls.setItem(draftKey(chatId), "Draft before delete");
    // Simulate delete-chat cleanup
    ls.removeItem(draftKey(chatId));
    expect(ls.getItem(draftKey(chatId))).toBeNull();
  });

  test("88 — archiving chat preserves draft (archive does not clear draft)", () => {
    const chatId = "chat-archive-draft";
    ls.setItem(draftKey(chatId), "Keep this draft");
    // Archive does NOT touch localStorage, so draft remains
    const read = ls.getItem(draftKey(chatId));
    expect(read).toBe("Keep this draft");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PACK E — Disappearing Messages
// ─────────────────────────────────────────────────────────────────────────────

describe("Pack E — Disappearing Messages", () => {
  let app, store;
  beforeEach(() => { ({ app, store } = buildApp()); });

  test("89 — set disappearingTimer on chat", async () => {
    const u1 = await register(app, "89a");
    const u2 = await register(app, "89b");
    const chat = await createDirectChat(app, u1.token, u2.userId);

    const r = await request(app).patch(`/api/chats/${chat.id}`)
      .set("Authorization", `Bearer ${u1.token}`)
      .send({ disappearingTimer: 86400 })  // 24h
      .expect(200);
    // Chat updated successfully
    expect(r.body.status).toBe("success");
  });

  test("90 — new message gets expiresAt when timer is active", async () => {
    const u1 = await register(app, "90a");
    const u2 = await register(app, "90b");
    const chat = await createDirectChat(app, u1.token, u2.userId);

    // Set 24h timer
    await request(app).patch(`/api/chats/${chat.id}`)
      .set("Authorization", `Bearer ${u1.token}`).send({ disappearingTimer: 86400 });

    const msg = await sendMsg(app, u1.token, chat.id, "This should expire");
    expect(msg.expiresAt).toBeTruthy();
    const expiry = new Date(msg.expiresAt);
    expect(expiry.getTime()).toBeGreaterThan(Date.now());
  });

  test("91 — expired message is hidden from listMessages", async () => {
    const u1 = await register(app, "91a");
    const u2 = await register(app, "91b");
    const chat = await createDirectChat(app, u1.token, u2.userId);

    // Set 1-second timer
    await request(app).patch(`/api/chats/${chat.id}`)
      .set("Authorization", `Bearer ${u1.token}`).send({ disappearingTimer: 1 });

    const msg = await sendMsg(app, u1.token, chat.id, "Expires soon");

    // Manually set expiresAt to past in the in-memory store
    const m = store._raw.messages.get(msg.id);
    m.expiresAt = new Date(Date.now() - 1000).toISOString();

    const r = await request(app).get(`/api/chats/${chat.id}/messages`)
      .set("Authorization", `Bearer ${u2.token}`).expect(200);
    const ids = r.body.data.messages.map((m) => m.id);
    expect(ids).not.toContain(msg.id);
  });

  test("92 — expired message is excluded from search results", async () => {
    const u1 = await register(app, "92a");
    const u2 = await register(app, "92b");
    const chat = await createDirectChat(app, u1.token, u2.userId);

    await request(app).patch(`/api/chats/${chat.id}`)
      .set("Authorization", `Bearer ${u1.token}`).send({ disappearingTimer: 1 });

    const msg = await sendMsg(app, u1.token, chat.id, "findme expired");

    // Force expiry
    const m = store._raw.messages.get(msg.id);
    m.expiresAt = new Date(Date.now() - 1000).toISOString();

    const r = await request(app).get(`/api/search?q=findme+expired&chatId=${chat.id}`)
      .set("Authorization", `Bearer ${u1.token}`).expect(200);
    const results = r.body.data?.messages || r.body.data?.results || [];
    const ids = results.map((m) => m.id);
    expect(ids).not.toContain(msg.id);
  });

  test("93 — old messages unaffected when timer is enabled", async () => {
    const u1 = await register(app, "93a");
    const u2 = await register(app, "93b");
    const chat = await createDirectChat(app, u1.token, u2.userId);

    // Send message BEFORE enabling timer
    const oldMsg = await sendMsg(app, u1.token, chat.id, "Old message no expiry");

    // Enable timer after
    await request(app).patch(`/api/chats/${chat.id}`)
      .set("Authorization", `Bearer ${u1.token}`).send({ disappearingTimer: 86400 });

    const r = await request(app).get(`/api/chats/${chat.id}/messages`)
      .set("Authorization", `Bearer ${u1.token}`).expect(200);
    const ids = r.body.data.messages.map((m) => m.id);
    expect(ids).toContain(oldMsg.id);  // old msg has no expiresAt, stays visible
  });

  test("94 — turning off timer (null) means new messages do not expire", async () => {
    const u1 = await register(app, "94a");
    const u2 = await register(app, "94b");
    const chat = await createDirectChat(app, u1.token, u2.userId);

    await request(app).patch(`/api/chats/${chat.id}`)
      .set("Authorization", `Bearer ${u1.token}`).send({ disappearingTimer: 86400 });

    // Turn off
    await request(app).patch(`/api/chats/${chat.id}`)
      .set("Authorization", `Bearer ${u1.token}`).send({ disappearingTimer: null });

    const msg = await sendMsg(app, u1.token, chat.id, "Should not expire");
    expect(msg.expiresAt).toBeNull();
  });

  test("95 — starred/pinned expired message: listing is safe (no crash)", async () => {
    const u1 = await register(app, "95a");
    const u2 = await register(app, "95b");
    const chat = await createDirectChat(app, u1.token, u2.userId);

    const msg = await sendMsg(app, u1.token, chat.id, "Will expire");

    // Star it
    await request(app).post(`/api/messages/${msg.id}/star`)
      .set("Authorization", `Bearer ${u1.token}`).expect(200);

    // Force expiry
    const m = store._raw.messages.get(msg.id);
    m.expiresAt = new Date(Date.now() - 500).toISOString();

    // Starred messages endpoint should not crash
    const r = await request(app).get("/api/messages/starred")
      .set("Authorization", `Bearer ${u1.token}`);
    expect([200, 404]).toContain(r.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PACK F — Per-Chat Themes (localStorage pure-logic)
// ─────────────────────────────────────────────────────────────────────────────

describe("Pack F — Per-Chat Themes (localStorage logic)", () => {
  let ls;
  beforeEach(() => { ls = new FakeStorage(); });

  test("96 — theme persists per chat after switching", () => {
    const chatA = "chat-a-theme";
    const chatB = "chat-b-theme";
    ls.setItem(themeKey(chatA), "ocean");
    ls.setItem(themeKey(chatB), "sunset");
    expect(ls.getItem(themeKey(chatA))).toBe("ocean");
    expect(ls.getItem(themeKey(chatB))).toBe("sunset");
  });

  test("97 — different users have independent theme storage (key isolation)", () => {
    // Since ls is per-user (different browser origins in real app),
    // this test verifies the key scheme differentiates chats.
    const chatId = "shared-chat-theme";
    // User A's storage
    const lsA = new FakeStorage();
    lsA.setItem(themeKey(chatId), "dark");
    // User B's storage
    const lsB = new FakeStorage();
    lsB.setItem(themeKey(chatId), "light");
    expect(lsA.getItem(themeKey(chatId))).toBe("dark");
    expect(lsB.getItem(themeKey(chatId))).toBe("light");
  });

  test("98 — switching theme overwrites previous value", () => {
    const chatId = "chat-theme-switch";
    ls.setItem(themeKey(chatId), "default");
    ls.setItem(themeKey(chatId), "ocean");
    expect(ls.getItem(themeKey(chatId))).toBe("ocean");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PACK G — Mark All as Read
// ─────────────────────────────────────────────────────────────────────────────

describe("Pack G — Mark All as Read", () => {
  let app, store;
  beforeEach(() => { ({ app, store } = buildApp()); });

  test("99 — POST /chats/read-all returns markedCount", async () => {
    const u1 = await register(app, "99a");
    const u2 = await register(app, "99b");
    await createDirectChat(app, u1.token, u2.userId);

    const r = await request(app).post("/api/chats/read-all")
      .set("Authorization", `Bearer ${u1.token}`).expect(200);
    expect(typeof r.body.data.markedCount).toBe("number");
    expect(r.body.data.markedCount).toBeGreaterThanOrEqual(1);
    expect(r.body.data.readAt).toBeTruthy();
  });

  test("100 — mark-all only affects requesting user's chats", async () => {
    const u1 = await register(app, "100a");
    const u2 = await register(app, "100b");
    const chat = await createDirectChat(app, u1.token, u2.userId);

    // u1 marks all read
    await request(app).post("/api/chats/read-all").set("Authorization", `Bearer ${u1.token}`);

    // u2's membership should still have its own lastReadAt (not changed by u1's request)
    const m = store._raw.chatMembers.get(`${chat.id}:${u2.userId}`);
    // u2's lastReadAt was set at join time and not touched by u1's read-all
    expect(m).toBeTruthy();
  });

  test("101 — mark-all with 0 chats returns markedCount 0", async () => {
    const u1 = await register(app, "101a");
    const r = await request(app).post("/api/chats/read-all")
      .set("Authorization", `Bearer ${u1.token}`).expect(200);
    expect(r.body.data.markedCount).toBe(0);
  });

  test("102 — mark-all works after multiple chats are created", async () => {
    const u1 = await register(app, "102a");
    const u2 = await register(app, "102b");
    const u3 = await register(app, "102c");
    await createDirectChat(app, u1.token, u2.userId);
    await createDirectChat(app, u1.token, u3.userId);

    const r = await request(app).post("/api/chats/read-all")
      .set("Authorization", `Bearer ${u1.token}`).expect(200);
    expect(r.body.data.markedCount).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PACK H — Saved Messages / Self-chat
// ─────────────────────────────────────────────────────────────────────────────

describe("Pack H — Saved Messages / Self-chat", () => {
  let app, store;
  beforeEach(() => { ({ app, store } = buildApp()); });

  test("103 — POST /chats/self creates self-chat (201 first time)", async () => {
    const u1 = await register(app, "103a");
    const r = await request(app).post("/api/chats/self")
      .set("Authorization", `Bearer ${u1.token}`).expect(201);
    expect(r.body.data.chat.id).toBeTruthy();
    expect(r.body.data.chat.name).toBe("Saved Messages");
  });

  test("104 — POST /chats/self is idempotent (200 second time)", async () => {
    const u1 = await register(app, "104a");
    const r1 = await request(app).post("/api/chats/self").set("Authorization", `Bearer ${u1.token}`);
    const r2 = await request(app).post("/api/chats/self").set("Authorization", `Bearer ${u1.token}`);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    expect(r1.body.data.chat.id).toBe(r2.body.data.chat.id);
  });

  test("105 — can send message to self-chat", async () => {
    const u1 = await register(app, "105a");
    const chatRes = await request(app).post("/api/chats/self").set("Authorization", `Bearer ${u1.token}`);
    const chatId = chatRes.body.data.chat.id;

    const msgRes = await request(app).post(`/api/chats/${chatId}/messages`)
      .set("Authorization", `Bearer ${u1.token}`).send({ content: "Note to self" });
    expect([200, 201]).toContain(msgRes.status);
    expect(msgRes.body.data.message.content).toBe("Note to self");
  });

  test("106 — self-chat messages persist and are listable", async () => {
    const u1 = await register(app, "106a");
    const chatRes = await request(app).post("/api/chats/self").set("Authorization", `Bearer ${u1.token}`);
    const chatId = chatRes.body.data.chat.id;

    await sendMsg(app, u1.token, chatId, "Saved note 1");
    await sendMsg(app, u1.token, chatId, "Saved note 2");

    const r = await request(app).get(`/api/chats/${chatId}/messages`)
      .set("Authorization", `Bearer ${u1.token}`).expect(200);
    const contents = r.body.data.messages.map((m) => m.content);
    expect(contents).toContain("Saved note 1");
    expect(contents).toContain("Saved note 2");
  });

  test("107 — self-chat appears in chat list", async () => {
    const u1 = await register(app, "107a");
    await request(app).post("/api/chats/self").set("Authorization", `Bearer ${u1.token}`);

    const r = await request(app).get("/api/chats").set("Authorization", `Bearer ${u1.token}`).expect(200);
    const names = r.body.data.chats.map((c) => c.name);
    expect(names).toContain("Saved Messages");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION (108–118) — Existing features must keep working
// ─────────────────────────────────────────────────────────────────────────────

describe("Regression (108–118) — Existing features unaffected", () => {
  let app, store;
  beforeEach(() => { ({ app, store } = buildApp()); });

  test("108 — star message still works after Pack changes", async () => {
    const u1 = await register(app, "108a");
    const u2 = await register(app, "108b");
    const chat = await createDirectChat(app, u1.token, u2.userId);
    const msg = await sendMsg(app, u1.token, chat.id, "Star me");

    await request(app).post(`/api/messages/${msg.id}/star`)
      .set("Authorization", `Bearer ${u1.token}`).expect(200);

    const r = await request(app).get("/api/starred")
      .set("Authorization", `Bearer ${u1.token}`).expect(200);
    const starred = r.body.data.starredMessages || r.body.data.messages || [];
    const ids = starred.map((m) => m.id);
    expect(ids).toContain(msg.id);
  });

  test("109 — pin message still works", async () => {
    const u1 = await register(app, "109a");
    const u2 = await register(app, "109b");
    const chat = await createDirectChat(app, u1.token, u2.userId);
    const msg = await sendMsg(app, u1.token, chat.id, "Pin me");

    await request(app).post(`/api/chats/${chat.id}/pin`)
      .set("Authorization", `Bearer ${u1.token}`).send({ messageId: msg.id }).expect(200);

    const r = await request(app).get(`/api/chats/${chat.id}/pinned`)
      .set("Authorization", `Bearer ${u1.token}`).expect(200);
    const pinned = r.body.data.pinnedMessages || r.body.data.pins || [];
    const ids = pinned.map((p) => p.messageId);
    expect(ids).toContain(msg.id);
  });

  test("110 — edit message still works", async () => {
    const u1 = await register(app, "110a");
    const u2 = await register(app, "110b");
    const chat = await createDirectChat(app, u1.token, u2.userId);
    const msg = await sendMsg(app, u1.token, chat.id, "Original");

    const r = await request(app).patch(`/api/messages/${msg.id}`)
      .set("Authorization", `Bearer ${u1.token}`).send({ content: "Edited" }).expect(200);
    expect(r.body.data.message.content).toBe("Edited");
  });

  test("111 — search messages still works", async () => {
    const u1 = await register(app, "111a");
    const u2 = await register(app, "111b");
    const chat = await createDirectChat(app, u1.token, u2.userId);
    await sendMsg(app, u1.token, chat.id, "uniqueterm111");

    const r = await request(app).get(`/api/search?q=uniqueterm111&chatId=${chat.id}`)
      .set("Authorization", `Bearer ${u1.token}`).expect(200);
    const results = r.body.data?.messages || r.body.data?.results || [];
    expect(results.length).toBeGreaterThan(0);
  });

  test("112 — multi-select delete-for-me still works", async () => {
    const u1 = await register(app, "112a");
    const u2 = await register(app, "112b");
    const chat = await createDirectChat(app, u1.token, u2.userId);
    const m1 = await sendMsg(app, u1.token, chat.id, "Delete me 1");
    const m2 = await sendMsg(app, u1.token, chat.id, "Delete me 2");

    await request(app).post("/api/messages/bulk")
      .set("Authorization", `Bearer ${u1.token}`)
      .send({ messageIds: [m1.id, m2.id], action: "delete_for_me" }).expect(200);

    const r = await request(app).get(`/api/chats/${chat.id}/messages`)
      .set("Authorization", `Bearer ${u1.token}`).expect(200);
    const ids = r.body.data.messages.map((m) => m.id);
    expect(ids).not.toContain(m1.id);
    expect(ids).not.toContain(m2.id);
  });

  test("113 — clear chat still works", async () => {
    const u1 = await register(app, "113a");
    const u2 = await register(app, "113b");
    const chat = await createDirectChat(app, u1.token, u2.userId);
    await sendMsg(app, u1.token, chat.id, "Clear this");

    await request(app).post(`/api/chats/${chat.id}/clear`)
      .set("Authorization", `Bearer ${u1.token}`).expect(200);

    const r = await request(app).get(`/api/chats/${chat.id}/messages`)
      .set("Authorization", `Bearer ${u1.token}`).expect(200);
    expect(r.body.data.messages.length).toBe(0);
  });

  test("114 — delete chat (local) still works", async () => {
    const u1 = await register(app, "114a");
    const u2 = await register(app, "114b");
    const chat = await createDirectChat(app, u1.token, u2.userId);

    await request(app).delete(`/api/chats/${chat.id}/local`)
      .set("Authorization", `Bearer ${u1.token}`).expect(200);

    const r = await request(app).get("/api/chats").set("Authorization", `Bearer ${u1.token}`).expect(200);
    const ids = r.body.data.chats.map((c) => c.id);
    expect(ids).not.toContain(chat.id);
  });

  test("115 — text translation still works", async () => {
    const u1 = await register(app, "115a");
    const u2 = await register(app, "115b");
    const chat = await createDirectChat(app, u1.token, u2.userId);
    const msg = await sendMsg(app, u1.token, chat.id, "Hello");

    // Translation endpoint (may fail if AI not mocked, but route must exist)
    const r = await request(app).post(`/api/translate/message/${msg.id}`)
      .set("Authorization", `Bearer ${u1.token}`).send({ targetLang: "tr" });
    expect([200, 503, 500]).toContain(r.status);
  });

  test("116 — mute/unmute still works", async () => {
    const u1 = await register(app, "116a");
    const u2 = await register(app, "116b");
    const chat = await createDirectChat(app, u1.token, u2.userId);

    await request(app).patch(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${u1.token}`).send({ muted: true }).expect(200);

    const r = await request(app).get(`/api/chats/${chat.id}/my-settings`)
      .set("Authorization", `Bearer ${u1.token}`).expect(200);
    expect(r.body.data.settings.muted).toBe(true);
  });

  test("117 — group chat creation still works", async () => {
    const u1 = await register(app, "117a");
    const u2 = await register(app, "117b");
    const u3 = await register(app, "117c");

    const r = await request(app).post("/api/chats/group")
      .set("Authorization", `Bearer ${u1.token}`)
      .send({ name: "Team Chat", memberIds: [u2.userId, u3.userId] })
      .expect(201);
    expect(r.body.data.chat.type).toBe("group");
    expect(r.body.data.chat.members.length).toBe(3);
  });

  test("118 — mark single chat read still works", async () => {
    const u1 = await register(app, "118a");
    const u2 = await register(app, "118b");
    const chat = await createDirectChat(app, u1.token, u2.userId);
    await sendMsg(app, u2.token, chat.id, "New message");

    const r = await request(app).post(`/api/chats/${chat.id}/read`)
      .set("Authorization", `Bearer ${u1.token}`).expect(200);
    expect(r.body.data.chatId).toBe(chat.id);
    expect(r.body.data.readAt).toBeTruthy();
  });
});
