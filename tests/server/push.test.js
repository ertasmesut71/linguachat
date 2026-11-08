/**
 * E2 — Web Push tests.
 *
 * Two module-cache pitfalls solved here:
 *
 * 1. pushUtil must be required AFTER buildApp() so it resolves
 *    require("../db/store") to the mocked in-memory store — not the
 *    real Prisma store.
 *
 * 2. web-push mock state must live OUTSIDE jest.mock's factory function.
 *    buildApp() calls jest.resetModules(), which causes a NEW mock
 *    instance from the factory on next require. If state lived inside
 *    the factory, the test file's reference and push.js's reference
 *    would point at different objects. By lifting state out, all
 *    instances share one object.
 */

// ─── Shared mock state (survives jest.resetModules) ───
const _pushMock = {
  notifications: [],
  transportOpts: [],
  errorForEndpoints: new Map(),
  reset() {
    this.notifications.length = 0;
    this.transportOpts.length = 0;
    this.errorForEndpoints.clear();
  },
};

jest.mock("web-push", () => ({
  setVapidDetails: jest.fn((subj, pub, priv) => _pushMock.transportOpts.push({ subj, pub, priv })),
  generateVAPIDKeys: jest.fn(() => ({
    publicKey: "MOCK_PUB_" + Math.random().toString(36).slice(2),
    privateKey: "MOCK_PRIV_" + Math.random().toString(36).slice(2),
  })),
  sendNotification: jest.fn(async (sub, payload) => {
    _pushMock.notifications.push({ sub, payload });
    const perEp = _pushMock.errorForEndpoints.get(sub.endpoint);
    if (perEp) {
      _pushMock.errorForEndpoints.delete(sub.endpoint);
      const err = new Error("Mock push error");
      err.statusCode = perEp.statusCode;
      throw err;
    }
    return { statusCode: 201 };
  }),
}));

const path = require("path");
const request = require("supertest");
const webpush = require("web-push");
const { buildApp } = require("../helpers/buildApp");

function getPushUtil() {
  return require(path.resolve(__dirname, "../../server/utils/push"));
}

async function registerUser(app, email) {
  const r = await request(app).post("/api/auth/register").send({
    email, password: "verysecure123", displayName: email.split("@")[0], primaryLang: "en",
  });
  return { token: r.body.data.accessToken, user: r.body.data.user };
}

const SUB = {
  endpoint: "https://push.example.com/abc123",
  keys: { p256dh: "BPp256dh_sample_key", auth: "auth_sample" },
};

describe("Push API (E2)", () => {
  let app, store;

  beforeEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    _pushMock.reset();
    webpush.setVapidDetails.mockClear();
    webpush.sendNotification.mockClear();
    ({ app, store } = buildApp());
  });

  // ─── VAPID public key ───

  test("GET /vapid-public-key → 503 when not configured", async () => {
    const u = await registerUser(app, "a@t.io");
    const res = await request(app).get("/api/push/vapid-public-key")
      .set("Authorization", `Bearer ${u.token}`);
    expect(res.status).toBe(503);
  });

  test("GET /vapid-public-key → returns key when configured", async () => {
    process.env.VAPID_PUBLIC_KEY = "BKpub_xxxx";
    process.env.VAPID_PRIVATE_KEY = "priv_yyyy";
    const u = await registerUser(app, "a@t.io");
    const res = await request(app).get("/api/push/vapid-public-key")
      .set("Authorization", `Bearer ${u.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.publicKey).toBe("BKpub_xxxx");
  });

  test("GET /vapid-public-key → 401 without auth", async () => {
    const res = await request(app).get("/api/push/vapid-public-key");
    expect(res.status).toBe(401);
  });

  // ─── Subscribe ───

  test("POST /subscribe persists subscription", async () => {
    const u = await registerUser(app, "a@t.io");
    const res = await request(app).post("/api/push/subscribe")
      .set("Authorization", `Bearer ${u.token}`).send(SUB);
    expect(res.status).toBe(201);
    expect(res.body.data.endpoint).toBe(SUB.endpoint);
    expect(store._raw.pushSubscriptions.get(SUB.endpoint).userId).toBe(u.user.id);
  });

  test("POST /subscribe is idempotent", async () => {
    const u = await registerUser(app, "a@t.io");
    await request(app).post("/api/push/subscribe")
      .set("Authorization", `Bearer ${u.token}`).send(SUB);
    await request(app).post("/api/push/subscribe")
      .set("Authorization", `Bearer ${u.token}`)
      .send({ endpoint: SUB.endpoint, keys: { p256dh: "NEW_p256dh", auth: "NEW_auth" } });
    expect(store._raw.pushSubscriptions.size).toBe(1);
    expect(store._raw.pushSubscriptions.get(SUB.endpoint).p256dh).toBe("NEW_p256dh");
  });

  test("POST /subscribe → 400 without endpoint", async () => {
    const u = await registerUser(app, "a@t.io");
    const res = await request(app).post("/api/push/subscribe")
      .set("Authorization", `Bearer ${u.token}`).send({ keys: SUB.keys });
    expect(res.status).toBe(400);
  });

  test("POST /subscribe → 400 without keys", async () => {
    const u = await registerUser(app, "a@t.io");
    const res = await request(app).post("/api/push/subscribe")
      .set("Authorization", `Bearer ${u.token}`).send({ endpoint: SUB.endpoint });
    expect(res.status).toBe(400);
  });

  test("POST /subscribe → 401 without auth", async () => {
    const res = await request(app).post("/api/push/subscribe").send(SUB);
    expect(res.status).toBe(401);
  });

  // ─── Unsubscribe ───

  test("DELETE /subscribe removes owned subscription", async () => {
    const u = await registerUser(app, "a@t.io");
    await request(app).post("/api/push/subscribe")
      .set("Authorization", `Bearer ${u.token}`).send(SUB);
    const res = await request(app).delete("/api/push/subscribe")
      .set("Authorization", `Bearer ${u.token}`).send({ endpoint: SUB.endpoint });
    expect(res.status).toBe(200);
    expect(store._raw.pushSubscriptions.has(SUB.endpoint)).toBe(false);
  });

  test("DELETE /subscribe → 404 for another user", async () => {
    const alice = await registerUser(app, "alice@t.io");
    const bob = await registerUser(app, "bob@t.io");
    await request(app).post("/api/push/subscribe")
      .set("Authorization", `Bearer ${alice.token}`).send(SUB);
    const res = await request(app).delete("/api/push/subscribe")
      .set("Authorization", `Bearer ${bob.token}`).send({ endpoint: SUB.endpoint });
    expect(res.status).toBe(404);
    expect(store._raw.pushSubscriptions.has(SUB.endpoint)).toBe(true);
  });

  test("DELETE /subscribe → 400 without endpoint", async () => {
    const u = await registerUser(app, "a@t.io");
    const res = await request(app).delete("/api/push/subscribe")
      .set("Authorization", `Bearer ${u.token}`).send({});
    expect(res.status).toBe(400);
  });

  test("DELETE /subscribe → 401 without auth", async () => {
    const res = await request(app).delete("/api/push/subscribe").send({ endpoint: SUB.endpoint });
    expect(res.status).toBe(401);
  });

  // ─── sendPushToUser ───

  describe("sendPushToUser()", () => {
    let pushUtil;

    beforeEach(() => {
      process.env.VAPID_PUBLIC_KEY = "BKpub_xxxx";
      process.env.VAPID_PRIVATE_KEY = "priv_yyyy";
      _pushMock.reset();
      webpush.sendNotification.mockClear();
      pushUtil = getPushUtil();
      pushUtil._resetForTests();
    });

    test("skips when VAPID not configured", async () => {
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
      pushUtil._resetForTests();
      const alice = await registerUser(app, "alice@t.io");
      await request(app).post("/api/push/subscribe")
        .set("Authorization", `Bearer ${alice.token}`).send(SUB);
      const result = await pushUtil.sendPushToUser(alice.user.id, { title: "hi" });
      expect(result.skipped).toBe(true);
      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });

    test("fans out to all user subscriptions", async () => {
      const alice = await registerUser(app, "alice@t.io");
      await request(app).post("/api/push/subscribe")
        .set("Authorization", `Bearer ${alice.token}`).send(SUB);
      await request(app).post("/api/push/subscribe")
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ endpoint: "https://push.example.com/second", keys: SUB.keys });

      const result = await pushUtil.sendPushToUser(alice.user.id, { title: "Hello" });
      expect(result).toEqual({ sent: 2, dead: 0, failed: 0, skipped: false });
      expect(_pushMock.notifications).toHaveLength(2);
      expect(JSON.parse(_pushMock.notifications[0].payload)).toEqual({ title: "Hello" });
    });

    test("auto-deletes on 410 (Gone)", async () => {
      const alice = await registerUser(app, "alice@t.io");
      await request(app).post("/api/push/subscribe")
        .set("Authorization", `Bearer ${alice.token}`).send(SUB);
      _pushMock.errorForEndpoints.set(SUB.endpoint, { statusCode: 410 });

      const result = await pushUtil.sendPushToUser(alice.user.id, { title: "x" });
      expect(result.dead).toBe(1);
      expect(result.sent).toBe(0);
      expect(store._raw.pushSubscriptions.has(SUB.endpoint)).toBe(false);
    });

    test("auto-deletes on 404", async () => {
      const alice = await registerUser(app, "alice@t.io");
      await request(app).post("/api/push/subscribe")
        .set("Authorization", `Bearer ${alice.token}`).send(SUB);
      _pushMock.errorForEndpoints.set(SUB.endpoint, { statusCode: 404 });

      const result = await pushUtil.sendPushToUser(alice.user.id, { title: "x" });
      expect(result.dead).toBe(1);
      expect(store._raw.pushSubscriptions.has(SUB.endpoint)).toBe(false);
    });

    test("keeps subscription on transient 500 error", async () => {
      const alice = await registerUser(app, "alice@t.io");
      await request(app).post("/api/push/subscribe")
        .set("Authorization", `Bearer ${alice.token}`).send(SUB);
      _pushMock.errorForEndpoints.set(SUB.endpoint, { statusCode: 500 });

      const result = await pushUtil.sendPushToUser(alice.user.id, { title: "x" });
      expect(result.failed).toBe(1);
      expect(result.dead).toBe(0);
      expect(store._raw.pushSubscriptions.has(SUB.endpoint)).toBe(true);
    });

    test("returns zeros for user with no subscriptions", async () => {
      const alice = await registerUser(app, "alice@t.io");
      const result = await pushUtil.sendPushToUser(alice.user.id, { title: "x" });
      expect(result).toEqual({ sent: 0, dead: 0, failed: 0, skipped: false });
    });
  });

  // ─── generateVapidKeys ───

  test("generateVapidKeys returns {publicKey, privateKey}", () => {
    const pushUtil = getPushUtil();
    const keys = pushUtil.generateVapidKeys();
    expect(keys.publicKey).toEqual(expect.any(String));
    expect(keys.privateKey).toEqual(expect.any(String));
  });
});
