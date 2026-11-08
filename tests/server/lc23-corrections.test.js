/**
 * LinguaChat23 — Correction Round RC1 Tests (45 tests)
 *
 * Fix A — Saved Messages UI Labeling
 * Fix B — Draft Clearing Bug
 * Fix C — Archive UX (Archived view, unarchive path)
 * Fix D — Per-chat Themes (localStorage)
 * Fix E — Disappearing Messages (expiresAt filtering)
 * Fix F — Mark All as Read (POST /chats/read-all)
 * Fix G — Custom Lists (CRUD + membership)
 * Regression — existing behavior not broken
 */

const request = require("supertest");
const { buildApp } = require("../helpers/buildApp");

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function register(app, suffix) {
  const r = await request(app)
    .post("/api/auth/register")
    .send({ email: `lc23_${suffix}@test.dev`, password: "Pass1234!", displayName: `LC23_${suffix}` });
  if (r.status !== 201) throw new Error(`register failed ${r.status}: ${JSON.stringify(r.body)}`);
  return { token: r.body.data.accessToken, userId: r.body.data.user.id };
}

async function directChat(app, token, otherId) {
  const r = await request(app)
    .post("/api/chats/direct")
    .set("Authorization", `Bearer ${token}`)
    .send({ otherUserId: otherId });
  if (r.status > 201) throw new Error(`directChat failed ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data.chat;
}

async function selfChat(app, token) {
  const r = await request(app)
    .post("/api/chats/self")
    .set("Authorization", `Bearer ${token}`)
    .send({});
  if (r.status > 201) throw new Error(`selfChat failed ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data.chat;
}

async function sendMsg(app, token, chatId, content) {
  const r = await request(app)
    .post(`/api/chats/${chatId}/messages`)
    .set("Authorization", `Bearer ${token}`)
    .send({ content });
  if (r.status > 201) throw new Error(`sendMsg failed ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data.message || r.body.data;
}

async function listChats(app, token, query = "") {
  const r = await request(app)
    .get(`/api/chats${query}`)
    .set("Authorization", `Bearer ${token}`);
  if (r.status !== 200) throw new Error(`listChats failed ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data.chats;
}

async function archiveChat(app, token, chatId, archived) {
  const r = await request(app)
    .patch(`/api/chats/${chatId}/my-settings`)
    .set("Authorization", `Bearer ${token}`)
    .send({ archived });
  if (r.status !== 200) throw new Error(`archiveChat failed ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data;
}

// ─── FIX A — Saved Messages / Self-chat Labeling ─────────────────────────────

describe("Fix A — Self-chat / Saved Messages", () => {
  let app, alice;
  beforeAll(async () => {
    ({ app } = buildApp());
    alice = await register(app, "a_selfchat");
  });

  test("A1: POST /chats/self returns a chat with exactly 1 member", async () => {
    const chat = await selfChat(app, alice.token);
    expect(chat).toBeDefined();
    expect(chat.members).toHaveLength(1);
  });

  test("A2: Self-chat member is the requesting user", async () => {
    const chat = await selfChat(app, alice.token);
    expect(chat.members[0].userId).toBe(alice.userId);
  });

  test("A3: Self-chat type is 'direct'", async () => {
    const chat = await selfChat(app, alice.token);
    expect(chat.type).toBe("direct");
  });

  test("A4: Self-chat has name 'Saved Messages'", async () => {
    const chat = await selfChat(app, alice.token);
    expect(chat.name).toBe("Saved Messages");
  });

  test("A5: Calling POST /chats/self twice returns the same chat (idempotent)", async () => {
    const c1 = await selfChat(app, alice.token);
    const c2 = await selfChat(app, alice.token);
    expect(c1.id).toBe(c2.id);
  });

  test("A6: Self-chat appears in chat list with 1 member", async () => {
    await selfChat(app, alice.token);
    const chats = await listChats(app, alice.token);
    const sc = chats.find((c) => c.members?.length === 1);
    expect(sc).toBeDefined();
    expect(sc.name).toBe("Saved Messages");
  });

  test("A7: Self-chat does not appear as member of a normal direct chat", async () => {
    const bob = await register(app, "a_bob");
    await selfChat(app, alice.token);
    const dc = await directChat(app, alice.token, bob.userId);
    expect(dc.members).toHaveLength(2);
  });
});

// ─── FIX B — Draft Clearing ───────────────────────────────────────────────────

/**
 * Fix B is a client-side localStorage concern; we test the server invariant:
 * the server never stores or returns a draft field. All draft state is localStorage.
 * We also verify the message endpoint works with empty content (rejected).
 */
describe("Fix B — Draft clearing (server invariants)", () => {
  let app, alice, bob, chat;
  beforeAll(async () => {
    ({ app } = buildApp());
    alice = await register(app, "b_alice");
    bob = await register(app, "b_bob");
    chat = await directChat(app, alice.token, bob.userId);
  });

  test("B1: Chat list items have no 'draft' field from server", async () => {
    const chats = await listChats(app, alice.token);
    const c = chats.find((c) => c.id === chat.id);
    expect(c).toBeDefined();
    expect(c.draft).toBeUndefined();
  });

  test("B2: Sending empty message returns 400", async () => {
    const r = await request(app)
      .post(`/api/chats/${chat.id}/messages`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ content: "" });
    expect(r.status).toBe(400);
  });

  test("B3: Sending whitespace-only message returns 400", async () => {
    const r = await request(app)
      .post(`/api/chats/${chat.id}/messages`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ content: "   " });
    expect(r.status).toBe(400);
  });
});

// ─── FIX C — Archive UX ───────────────────────────────────────────────────────

describe("Fix C — Archive UX", () => {
  let app, alice, bob, chat;
  beforeAll(async () => {
    ({ app } = buildApp());
    alice = await register(app, "c_alice");
    bob = await register(app, "c_bob");
    chat = await directChat(app, alice.token, bob.userId);
  });

  test("C1: Chat appears in default list before archiving", async () => {
    const chats = await listChats(app, alice.token);
    expect(chats.some((c) => c.id === chat.id)).toBe(true);
  });

  test("C2: Archiving removes chat from default list", async () => {
    await archiveChat(app, alice.token, chat.id, true);
    const chats = await listChats(app, alice.token);
    expect(chats.some((c) => c.id === chat.id)).toBe(false);
  });

  test("C3: Archived chat appears with ?includeArchived=true", async () => {
    const all = await listChats(app, alice.token, "?includeArchived=true");
    expect(all.some((c) => c.id === chat.id)).toBe(true);
  });

  test("C4: myArchivedAt is set for the archived user on includeArchived response", async () => {
    const all = await listChats(app, alice.token, "?includeArchived=true");
    const c = all.find((c) => c.id === chat.id);
    expect(c).toBeDefined();
    expect(c.myArchivedAt).toBeTruthy();
  });

  test("C5: myArchivedAt is null for the non-archiving participant", async () => {
    const bobChats = await listChats(app, bob.token);
    const c = bobChats.find((c) => c.id === chat.id);
    expect(c).toBeDefined();
    // Bob didn't archive, so myArchivedAt should be null/undefined
    expect(c.myArchivedAt ?? null).toBeNull();
  });

  test("C6: Unarchiving restores chat to default list", async () => {
    await archiveChat(app, alice.token, chat.id, false);
    const chats = await listChats(app, alice.token);
    expect(chats.some((c) => c.id === chat.id)).toBe(true);
  });

  test("C7: After unarchiving, myArchivedAt is null", async () => {
    const all = await listChats(app, alice.token, "?includeArchived=true");
    const c = all.find((c) => c.id === chat.id);
    expect(c?.myArchivedAt ?? null).toBeNull();
  });

  test("C8: Archiving is per-user (bob's list unaffected)", async () => {
    await archiveChat(app, alice.token, chat.id, true);
    const bobChats = await listChats(app, bob.token);
    expect(bobChats.some((c) => c.id === chat.id)).toBe(true);
    // cleanup
    await archiveChat(app, alice.token, chat.id, false);
  });
});

// ─── FIX D — Per-chat Themes (localStorage, server unaffected) ───────────────

/**
 * Theme state lives entirely in localStorage — no server round-trip.
 * We verify the server does NOT expose or persist a theme field.
 */
describe("Fix D — Per-chat Themes (server invariants)", () => {
  let app, alice, bob, chat;
  beforeAll(async () => {
    ({ app } = buildApp());
    alice = await register(app, "d_alice");
    bob = await register(app, "d_bob");
    chat = await directChat(app, alice.token, bob.userId);
  });

  test("D1: Chat list entry has no 'theme' field from server", async () => {
    const chats = await listChats(app, alice.token);
    const c = chats.find((c) => c.id === chat.id);
    expect(c?.theme).toBeUndefined();
  });

  test("D2: GET /chats/:id has no 'theme' field", async () => {
    const r = await request(app)
      .get(`/api/chats/${chat.id}`)
      .set("Authorization", `Bearer ${alice.token}`);
    expect(r.status).toBe(200);
    expect(r.body.data.chat?.theme).toBeUndefined();
  });
});

// ─── FIX E — Disappearing Messages ───────────────────────────────────────────

describe("Fix E — Disappearing Messages", () => {
  let app, alice, bob, chat;
  beforeAll(async () => {
    ({ app } = buildApp());
    alice = await register(app, "e_alice");
    bob = await register(app, "e_bob");
    chat = await directChat(app, alice.token, bob.userId);
  });

  test("E1: Can set disappearingTimer on a chat", async () => {
    const r = await request(app)
      .patch(`/api/chats/${chat.id}`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ disappearingTimer: 60 });
    expect(r.status).toBe(200);
  });

  test("E2: Chat reflects disappearingTimer after update", async () => {
    const r = await request(app)
      .get(`/api/chats/${chat.id}`)
      .set("Authorization", `Bearer ${alice.token}`);
    expect(r.status).toBe(200);
    expect(r.body.data.chat.disappearingTimer).toBe(60);
  });

  test("E3: Messages sent after setting timer have expiresAt set", async () => {
    const before = Date.now();
    const msg = await sendMsg(app, alice.token, chat.id, "Will expire");
    expect(msg.expiresAt).toBeTruthy();
    const expiresAt = new Date(msg.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(before + 50 * 1000); // at least 50s from now
  });

  test("E4: Can turn off disappearingTimer (set to null)", async () => {
    const r = await request(app)
      .patch(`/api/chats/${chat.id}`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ disappearingTimer: null });
    expect(r.status).toBe(200);
    const r2 = await request(app)
      .get(`/api/chats/${chat.id}`)
      .set("Authorization", `Bearer ${alice.token}`);
    expect([null, 0, undefined].includes(r2.body.data.chat?.disappearingTimer ?? null)).toBe(true);
  });

  test("E5: Messages sent after disabling timer have no expiresAt", async () => {
    const msg = await sendMsg(app, alice.token, chat.id, "No expiry");
    expect(msg.expiresAt ?? null).toBeNull();
  });
});

// ─── FIX F — Mark All as Read ─────────────────────────────────────────────────

describe("Fix F — Mark All as Read", () => {
  let app, alice, bob;
  beforeAll(async () => {
    ({ app } = buildApp());
    alice = await register(app, "f_alice");
    bob = await register(app, "f_bob");
  });

  test("F1: POST /chats/read-all returns 200", async () => {
    const r = await request(app)
      .post("/api/chats/read-all")
      .set("Authorization", `Bearer ${alice.token}`);
    expect(r.status).toBe(200);
  });

  test("F2: POST /chats/read-all without auth returns 401", async () => {
    const r = await request(app).post("/api/chats/read-all");
    expect(r.status).toBe(401);
  });

  test("F3: POST /chats/read-all returns markedCount field", async () => {
    const r = await request(app)
      .post("/api/chats/read-all")
      .set("Authorization", `Bearer ${alice.token}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveProperty("markedCount");
  });
});

// ─── FIX G — Custom Lists ─────────────────────────────────────────────────────

describe("Fix G — Custom Lists", () => {
  let app, alice, bob, chatAB;
  beforeAll(async () => {
    ({ app } = buildApp());
    alice = await register(app, "g_alice");
    bob = await register(app, "g_bob");
    chatAB = await directChat(app, alice.token, bob.userId);
  });

  test("G1: GET /chats/lists returns empty array initially", async () => {
    const r = await request(app)
      .get("/api/chats/lists")
      .set("Authorization", `Bearer ${alice.token}`);
    expect(r.status).toBe(200);
    expect(r.body.data.lists).toEqual([]);
  });

  test("G2: POST /chats/lists creates a list", async () => {
    const r = await request(app)
      .post("/api/chats/lists")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ name: "Work" });
    expect(r.status).toBe(201);
    expect(r.body.data.list.name).toBe("Work");
  });

  test("G3: GET /chats/lists returns created list", async () => {
    const r = await request(app)
      .get("/api/chats/lists")
      .set("Authorization", `Bearer ${alice.token}`);
    expect(r.status).toBe(200);
    expect(r.body.data.lists.some((l) => l.name === "Work")).toBe(true);
  });

  let listId;
  test("G4: Created list has an id", async () => {
    const r = await request(app)
      .get("/api/chats/lists")
      .set("Authorization", `Bearer ${alice.token}`);
    const list = r.body.data.lists.find((l) => l.name === "Work");
    expect(list).toBeDefined();
    expect(list.id).toBeTruthy();
    listId = list.id;
  });

  test("G5: PATCH /chats/lists/:id renames the list", async () => {
    const r = await request(app)
      .patch(`/api/chats/lists/${listId}`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ name: "Work Renamed" });
    expect(r.status).toBe(200);
    expect(r.body.data.list.name).toBe("Work Renamed");
  });

  test("G6: POST /chats/lists/:id/chats adds a chat to list", async () => {
    const r = await request(app)
      .post(`/api/chats/lists/${listId}/chats`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ chatId: chatAB.id });
    expect(r.status).toBe(200);
  });

  test("G7: Added chat appears in list's chatIds", async () => {
    const r = await request(app)
      .get("/api/chats/lists")
      .set("Authorization", `Bearer ${alice.token}`);
    const list = r.body.data.lists.find((l) => l.id === listId);
    expect(list).toBeDefined();
    expect(list.chatIds).toContain(chatAB.id);
  });

  test("G8: DELETE /chats/lists/:id/chats/:chatId removes chat from list", async () => {
    const r = await request(app)
      .delete(`/api/chats/lists/${listId}/chats/${chatAB.id}`)
      .set("Authorization", `Bearer ${alice.token}`);
    expect(r.status).toBe(200);
    const r2 = await request(app)
      .get("/api/chats/lists")
      .set("Authorization", `Bearer ${alice.token}`);
    const list = r2.body.data.lists.find((l) => l.id === listId);
    expect(list.chatIds || []).not.toContain(chatAB.id);
  });

  test("G9: Non-member cannot add a chat they don't belong to", async () => {
    const carol = await register(app, "g_carol");
    const r = await request(app)
      .post(`/api/chats/lists/${listId}/chats`)
      .set("Authorization", `Bearer ${carol.token}`)
      .send({ chatId: chatAB.id });
    // Should be 403 or 404 (not member of chatAB)
    expect([403, 404]).toContain(r.status);
  });

  test("G10: DELETE /chats/lists/:id deletes the list", async () => {
    const r = await request(app)
      .delete(`/api/chats/lists/${listId}`)
      .set("Authorization", `Bearer ${alice.token}`);
    expect(r.status).toBe(200);
    const r2 = await request(app)
      .get("/api/chats/lists")
      .set("Authorization", `Bearer ${alice.token}`);
    expect(r2.body.data.lists.some((l) => l.id === listId)).toBe(false);
  });

  test("G11: POST /chats/lists name required (empty name rejected)", async () => {
    const r = await request(app)
      .post("/api/chats/lists")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ name: "" });
    expect(r.status).toBe(400);
  });

  test("G12: Lists are user-scoped (bob cannot see alice's list)", async () => {
    // Create a list as alice
    const cr = await request(app)
      .post("/api/chats/lists")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ name: "Alice Only" });
    const aliceListId = cr.body.data.list.id;
    // Bob's lists should not include alice's
    const r = await request(app)
      .get("/api/chats/lists")
      .set("Authorization", `Bearer ${bob.token}`);
    expect(r.body.data.lists.some((l) => l.id === aliceListId)).toBe(false);
  });
});

// ─── Regression — Existing behavior ──────────────────────────────────────────

describe("Regression — Core behaviors", () => {
  let app, alice, bob, chat;
  beforeAll(async () => {
    ({ app } = buildApp());
    alice = await register(app, "reg_alice");
    bob = await register(app, "reg_bob");
    chat = await directChat(app, alice.token, bob.userId);
  });

  test("R1: Register returns accessToken", async () => {
    const carol = await register(app, "reg_carol");
    expect(carol.token).toBeTruthy();
  });

  test("R2: Direct chat has 2 members for a normal direct chat", async () => {
    expect(chat.members).toHaveLength(2);
  });

  test("R3: Sending a message succeeds", async () => {
    const msg = await sendMsg(app, alice.token, chat.id, "Hello");
    expect(msg.id).toBeTruthy();
    expect(msg.content).toBe("Hello");
  });

  test("R4: GET /api/messages returns sent message", async () => {
    await sendMsg(app, alice.token, chat.id, "Visible");
    const r = await request(app)
      .get(`/api/chats/${chat.id}/messages`)
      .set("Authorization", `Bearer ${alice.token}`);
    expect(r.status).toBe(200);
    expect(r.body.data.messages.some((m) => m.content === "Visible")).toBe(true);
  });

  test("R5: Unauthenticated request returns 401", async () => {
    const r = await request(app).get("/api/chats");
    expect(r.status).toBe(401);
  });

  test("R6: Chat list excludes archived chats by default", async () => {
    await archiveChat(app, alice.token, chat.id, true);
    const chats = await listChats(app, alice.token);
    expect(chats.some((c) => c.id === chat.id)).toBe(false);
    await archiveChat(app, alice.token, chat.id, false);
  });

  test("R7: Self-chat is idempotent across multiple calls", async () => {
    const c1 = await selfChat(app, alice.token);
    const c2 = await selfChat(app, alice.token);
    const c3 = await selfChat(app, alice.token);
    expect(c1.id).toBe(c2.id);
    expect(c2.id).toBe(c3.id);
  });
});
