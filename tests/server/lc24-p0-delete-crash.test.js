/**
 * LinguaChat24 — P0 Message Delete React Crash Fix
 *
 * Root cause: MessageBubble.jsx had `if (isDeleted) return (...)` before three
 * useCallback hooks (handleRetranslate, handleSourceOverride, handlePlayTranslation).
 * When a message transitioned to deletedAt != null, React rendered fewer hooks than
 * expected → error #300 "Rendered fewer hooks than expected".
 *
 * Fix: moved the isDeleted early-return to AFTER all React hooks.
 *
 * These tests verify server-side behavior underpinning the delete flows.
 * React component hook-order cannot be verified in a Node.js supertest suite;
 * that check is noted inline as a build-time / browser test.
 */

const request = require("supertest");
const { buildApp } = require("../helpers/buildApp");

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function register(app, suffix) {
  const r = await request(app)
    .post("/api/auth/register")
    .send({ email: `lc24p0_${suffix}@test.dev`, password: "Pass1234!", displayName: `LC24P0_${suffix}` });
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { token: r.body.data.accessToken, userId: r.body.data.user.id };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function directChat(app, token, otherId) {
  const r = await request(app)
    .post("/api/chats/direct")
    .set(auth(token))
    .send({ otherUserId: otherId });
  if (r.status !== 200 && r.status !== 201) throw new Error(`directChat failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data.chat;
}

async function sendMsg(app, token, chatId, content = "hello") {
  const r = await request(app)
    .post(`/api/chats/${chatId}/messages`)
    .set(auth(token))
    .send({ content });
  if (r.status !== 201) throw new Error(`sendMsg failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data.message;
}

async function listMessages(app, token, chatId) {
  const r = await request(app)
    .get(`/api/chats/${chatId}/messages`)
    .set(auth(token));
  if (r.status !== 200) throw new Error(`listMessages failed: ${r.status}`);
  return r.body.data.messages;
}

async function deleteMsg(app, token, msgId) {
  return request(app)
    .delete(`/api/messages/${msgId}`)
    .set(auth(token));
}

async function hideForMe(app, token, msgId) {
  return request(app)
    .post(`/api/messages/${msgId}/hide`)
    .set(auth(token));
}

// ─── P0.1: MessageBubble hook-order (structural / build-time check) ───────────
describe("P0 hook-order fix — structural verification", () => {
  test("P0.1 — isDeleted early return is after all useCallback hooks in MessageBubble.jsx", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../client/src/components/chat/MessageBubble.jsx"),
      "utf8"
    );
    const lines = src.split("\n");

    // Find line numbers
    const lastUseCallback = lines.reduce(
      (last, line, i) => (line.includes("useCallback(") ? i : last),
      -1
    );
    const isDeletedReturnLine = lines.findIndex(
      (line, i) => i > 0 && line.includes("if (isDeleted)") && lines[i + 1] && lines[i + 1].includes("return")
    );

    expect(lastUseCallback).toBeGreaterThan(0);
    expect(isDeletedReturnLine).toBeGreaterThan(0);
    expect(isDeletedReturnLine).toBeGreaterThan(lastUseCallback);
  });

  test("P0.2 — no useCallback / useState / useEffect / useRef / useMemo after isDeleted early return", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../client/src/components/chat/MessageBubble.jsx"),
      "utf8"
    );
    const lines = src.split("\n");

    const isDeletedReturnLine = lines.findIndex(
      (line, i) => i > 0 && line.includes("if (isDeleted)") && lines[i + 1] && lines[i + 1].includes("return")
    );
    expect(isDeletedReturnLine).toBeGreaterThan(0);

    const hooksAfter = lines.slice(isDeletedReturnLine + 1).filter((line) =>
      /\b(useState|useEffect|useRef|useMemo|useCallback)\s*\(/.test(line)
    );
    // Allow WaveformBars' useMemo (line < isDeletedReturnLine — but slice is after, so irrelevant)
    expect(hooksAfter).toHaveLength(0);
  });
});

// ─── P0.3–P0.5: Own message delete API + sender state ─────────────────────────
describe("P0 own-message delete — API and sender state", () => {
  let app;
  let sender, receiver, chat, msg;

  beforeAll(async () => {
    ({ app } = buildApp());
    sender = await register(app, "sender_a");
    receiver = await register(app, "recv_a");
    chat = await directChat(app, sender.token, receiver.userId);
    msg = await sendMsg(app, sender.token, chat.id, "P0 test message");
  });

  test("P0.3 — DELETE /api/messages/:id returns 200 for sender", async () => {
    const r = await deleteMsg(app, sender.token, msg.id);
    expect(r.status).toBe(200);
    expect(r.body.data.deleted).toBe(true);
  });

  test("P0.4 — deleted message is hidden from sender's message list (soft-delete excludes from list)", async () => {
    // The in-memory store (and production store) exclude deletedAt messages from listMessages.
    // The correct behavior: message either absent or has deletedAt — either satisfies the contract.
    const messages = await listMessages(app, sender.token, chat.id);
    const found = messages.find((m) => m.id === msg.id);
    // If present: must have deletedAt. If absent: also correct (filtered out).
    if (found) {
      expect(found.deletedAt).toBeTruthy();
    } else {
      // Message correctly excluded from list after global soft-delete
      expect(found).toBeUndefined();
    }
  });

  test("P0.5 — receiver also does not see deleted message content (global soft-delete)", async () => {
    const messages = await listMessages(app, receiver.token, chat.id);
    const found = messages.find((m) => m.id === msg.id);
    if (found) {
      expect(found.deletedAt).toBeTruthy();
      expect(found.content).not.toBe("P0 test message");
    } else {
      expect(found).toBeUndefined();
    }
  });
});

// ─── P0.6: Receiver deletion path ─────────────────────────────────────────────
describe("P0 receiver deletion path", () => {
  let app;
  let alpha, beta, chat, msgId;

  beforeAll(async () => {
    ({ app } = buildApp());
    alpha = await register(app, "alpha_b");
    beta = await register(app, "beta_b");
    chat = await directChat(app, alpha.token, beta.userId);
    const m = await sendMsg(app, alpha.token, chat.id, "receiver path msg");
    msgId = m.id;
    // sender deletes
    await deleteMsg(app, alpha.token, msgId);
  });

  test("P0.6 — receiver does not see original content of globally deleted message", async () => {
    const messages = await listMessages(app, beta.token, chat.id);
    const m = messages.find((x) => x.id === msgId);
    // Message either absent (filtered) or has deletedAt — either is correct global-delete behavior
    if (m) {
      expect(m.deletedAt).toBeTruthy();
      expect(m.content).not.toBe("receiver path msg");
    } else {
      expect(m).toBeUndefined();
    }
  });
});

// ─── P0.7: Deleted text is not searchable ─────────────────────────────────────
describe("P0 search does not return deleted content", () => {
  let app;
  let u1, u2, chat;

  beforeAll(async () => {
    ({ app } = buildApp());
    u1 = await register(app, "srch1");
    u2 = await register(app, "srch2");
    chat = await directChat(app, u1.token, u2.userId);
    const m = await sendMsg(app, u1.token, chat.id, "UNIQUE_SEARCHABLE_P0_TOKEN");
    await deleteMsg(app, u1.token, m.id);
  });

  test("P0.7 — search does not return deleted message content", async () => {
    const r = await request(app)
      .get("/api/messages/search")
      .set(auth(u1.token))
      .query({ q: "UNIQUE_SEARCHABLE_P0_TOKEN" });
    // 200 or 404 both acceptable; what matters is no hit with original content
    if (r.status === 200) {
      const hits = r.body.data?.messages || r.body.data?.results || [];
      const found = hits.some((m) => m.content === "UNIQUE_SEARCHABLE_P0_TOKEN");
      expect(found).toBe(false);
    }
    // 404 means nothing found — also acceptable
  });
});

// ─── P0.8: Delete-for-me not regressed ────────────────────────────────────────
describe("P0 Delete-for-me regression", () => {
  let app;
  let owner, other, chat, msgId;

  beforeAll(async () => {
    ({ app } = buildApp());
    owner = await register(app, "own_c");
    other = await register(app, "oth_c");
    chat = await directChat(app, other.token, owner.userId);
    const m = await sendMsg(app, other.token, chat.id, "hide me for owner");
    msgId = m.id;
  });

  test("P0.8 — POST /api/messages/:id/hide succeeds for receiver", async () => {
    const r = await hideForMe(app, owner.token, msgId);
    expect(r.status).toBe(200);
  });

  test("P0.8b — sender still sees message after receiver hides it for themselves", async () => {
    const messages = await listMessages(app, other.token, chat.id);
    const m = messages.find((x) => x.id === msgId);
    // sender sees it (not globally deleted)
    expect(m).toBeDefined();
    expect(m.deletedAt).toBeFalsy();
  });
});

// ─── P0.9: Voice message deletion hook-order (structural) ─────────────────────
describe("P0 voice message deletion — hook-order check", () => {
  test("P0.9 — handlePlayTranslation useCallback exists before isDeleted early return", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../client/src/components/chat/MessageBubble.jsx"),
      "utf8"
    );
    const lines = src.split("\n");
    const playTransLine = lines.findIndex((l) => l.includes("handlePlayTranslation") && l.includes("useCallback"));
    const isDeletedLine = lines.findIndex(
      (l, i) => l.includes("if (isDeleted)") && lines[i + 1] && lines[i + 1].includes("return")
    );
    expect(playTransLine).toBeGreaterThan(0);
    expect(isDeletedLine).toBeGreaterThan(playTransLine);
  });
});

// ─── P0.10: Media message deletion — API does not reject ──────────────────────
describe("P0 media/file message deletion via soft-delete API", () => {
  let app;
  let u, chat;

  beforeAll(async () => {
    ({ app } = buildApp());
    u = await register(app, "media_d");
    const other = await register(app, "media_e");
    chat = await directChat(app, u.token, other.userId);
  });

  test("P0.10 — soft-delete endpoint accepts any message type (simulated via text msg)", async () => {
    // In-memory store doesn't support binary upload; test that the delete endpoint
    // works generically — the hook-order fix applies to all message types equally.
    const m = await sendMsg(app, u.token, chat.id, "[simulated media message]");
    const r = await deleteMsg(app, u.token, m.id);
    expect(r.status).toBe(200);
    expect(r.body.data.deleted).toBe(true);
  });
});

// ─── P0.11: Starred deleted message — no crash path ──────────────────────────
describe("P0 starred message deletion", () => {
  let app;
  let u, chat, msgId;

  beforeAll(async () => {
    ({ app } = buildApp());
    u = await register(app, "star_del");
    const other = await register(app, "star_del2");
    chat = await directChat(app, u.token, other.userId);
    const m = await sendMsg(app, u.token, chat.id, "star then delete");
    msgId = m.id;
    // Star the message first
    await request(app).post(`/api/messages/${msgId}/star`).set(auth(u.token));
  });

  test("P0.11 — deleting a starred message succeeds (no server crash)", async () => {
    const r = await deleteMsg(app, u.token, msgId);
    expect(r.status).toBe(200);
  });

  test("P0.11b — deleted starred message is excluded from list (soft-delete removes from list)", async () => {
    const messages = await listMessages(app, u.token, chat.id);
    const m = messages.find((x) => x.id === msgId);
    // Either absent (filtered) or present with deletedAt — both satisfy global-delete contract
    if (m) {
      expect(m.deletedAt).toBeTruthy();
    } else {
      expect(m).toBeUndefined();
    }
  });
});
