const request = require("supertest");
const { buildApp } = require("../helpers/buildApp");

/**
 * D8 — QR-based desktop login pairing flow.
 *
 * Roles in this test:
 *   - "desktop" creates a pairing request and polls for approval
 *   - "alice" is logged in on her phone and approves the desktop's code
 *
 * Covers: create → approve → poll happy path, plus all the error paths
 * (wrong nonce, expired, double-consume, unauthenticated approve, etc).
 */

async function registerUser(app, email, password = "verysecure123") {
  const r = await request(app).post("/api/auth/register").send({
    email, password, displayName: email.split("@")[0], primaryLang: "en",
  });
  return { token: r.body.data.accessToken, user: r.body.data.user };
}

describe("Pairing API (D8 QR desktop login)", () => {
  let app, store;

  beforeEach(() => {
    ({ app, store } = buildApp());
  });

  describe("POST /api/auth/pairing/create", () => {
    test("creates a pairing request returning {code, nonce, expiresAt}", async () => {
      const res = await request(app).post("/api/auth/pairing/create")
        .send({ deviceLabel: "Chrome on macOS" });
      expect(res.status).toBe(200);
      expect(res.body.data.code).toEqual(expect.any(String));
      expect(res.body.data.code.length).toBeGreaterThanOrEqual(8);
      expect(res.body.data.nonce).toEqual(expect.any(String));
      expect(res.body.data.nonce.length).toBeGreaterThanOrEqual(16);
      expect(res.body.data.expiresAt).toEqual(expect.any(String));
      // Expiry should be in the future, ~5 minutes
      const ms = Date.parse(res.body.data.expiresAt) - Date.now();
      expect(ms).toBeGreaterThan(4 * 60 * 1000);
      expect(ms).toBeLessThan(6 * 60 * 1000);
    });

    test("two creates produce different codes and different nonces", async () => {
      const a = await request(app).post("/api/auth/pairing/create").send({});
      const b = await request(app).post("/api/auth/pairing/create").send({});
      expect(a.body.data.code).not.toBe(b.body.data.code);
      expect(a.body.data.nonce).not.toBe(b.body.data.nonce);
    });

    test("works without a deviceLabel (optional)", async () => {
      const res = await request(app).post("/api/auth/pairing/create").send({});
      expect(res.status).toBe(200);
      expect(res.body.data.code).toEqual(expect.any(String));
    });

    test("rejects oversized deviceLabel with 400", async () => {
      const res = await request(app).post("/api/auth/pairing/create")
        .send({ deviceLabel: "x".repeat(500) });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/auth/pairing/approve", () => {
    let alice;
    let pairing;

    beforeEach(async () => {
      alice = await registerUser(app, "alice@t.io");
      const r = await request(app).post("/api/auth/pairing/create")
        .send({ deviceLabel: "Desktop" });
      pairing = r.body.data;
    });

    test("authenticated user can approve a valid code", async () => {
      const res = await request(app).post("/api/auth/pairing/approve")
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ code: pairing.code });
      expect(res.status).toBe(200);
      expect(res.body.data.ok).toBe(true);
    });

    test("requires authentication (401 without token)", async () => {
      const res = await request(app).post("/api/auth/pairing/approve")
        .send({ code: pairing.code });
      expect(res.status).toBe(401);
    });

    test("rejects unknown code with 400", async () => {
      const res = await request(app).post("/api/auth/pairing/approve")
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ code: "ZZZZZZZZ" });
      expect(res.status).toBe(400);
    });

    test("rejects approving an already-approved code with 400", async () => {
      await request(app).post("/api/auth/pairing/approve")
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ code: pairing.code });
      const res = await request(app).post("/api/auth/pairing/approve")
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ code: pairing.code });
      expect(res.status).toBe(400);
    });

    test("rejects malformed code with 400 (validation)", async () => {
      const res = await request(app).post("/api/auth/pairing/approve")
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ code: "x" });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/auth/pairing/poll", () => {
    let alice;
    let pairing;

    beforeEach(async () => {
      alice = await registerUser(app, "alice@t.io");
      const r = await request(app).post("/api/auth/pairing/create")
        .send({ deviceLabel: "Desktop" });
      pairing = r.body.data;
    });

    test("returns {status: 'pending'} while not yet approved", async () => {
      const res = await request(app).post("/api/auth/pairing/poll")
        .send({ code: pairing.code, nonce: pairing.nonce });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("pending");
    });

    test("returns accessToken + refreshToken + user after approval", async () => {
      // Mobile approves
      await request(app).post("/api/auth/pairing/approve")
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ code: pairing.code });

      // Desktop polls and gets credentials
      const res = await request(app).post("/api/auth/pairing/poll")
        .send({ code: pairing.code, nonce: pairing.nonce });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("approved");
      expect(res.body.data.accessToken).toEqual(expect.any(String));
      expect(res.body.data.refreshToken).toEqual(expect.any(String));
      expect(res.body.data.user.id).toBe(alice.user.id);
      expect(res.body.data.user.email).toBe(alice.user.email);
      expect(res.body.data.user.passwordHash).toBeUndefined();
    });

    test("second poll after consumption is rejected with 400", async () => {
      await request(app).post("/api/auth/pairing/approve")
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ code: pairing.code });
      const first = await request(app).post("/api/auth/pairing/poll")
        .send({ code: pairing.code, nonce: pairing.nonce });
      expect(first.status).toBe(200);

      const second = await request(app).post("/api/auth/pairing/poll")
        .send({ code: pairing.code, nonce: pairing.nonce });
      expect(second.status).toBe(400);
      expect(second.body.message).toMatch(/already|completed|expired/i);
    });

    test("wrong nonce is rejected with 401 (and doesn't leak whether the code exists)", async () => {
      const res = await request(app).post("/api/auth/pairing/poll")
        .send({ code: pairing.code, nonce: "wrongnonce_aaaaaaaaaaaaaa" });
      expect(res.status).toBe(401);

      // Same response shape for an unknown code — both must say "Invalid pairing credentials"
      const res2 = await request(app).post("/api/auth/pairing/poll")
        .send({ code: "ABCDEFGH", nonce: "anyvalue_abcdef0123456789" });
      expect(res2.status).toBe(401);
      expect(res2.body.message).toBe(res.body.message);
    });

    test("expired token is rejected with 400", async () => {
      // Rewind expiry by 10 minutes via the in-memory store
      const tokenRec = store._raw.pairingTokens.get(pairing.code);
      expect(tokenRec).toBeDefined();
      tokenRec.expiresAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      const res = await request(app).post("/api/auth/pairing/poll")
        .send({ code: pairing.code, nonce: pairing.nonce });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/expired/i);
    });

    test("approving an expired token is rejected with 400", async () => {
      const tokenRec = store._raw.pairingTokens.get(pairing.code);
      tokenRec.expiresAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      const res = await request(app).post("/api/auth/pairing/approve")
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ code: pairing.code });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/expired/i);
    });

    test("rejects missing fields with 400", async () => {
      const a = await request(app).post("/api/auth/pairing/poll").send({});
      expect(a.status).toBe(400);

      const b = await request(app).post("/api/auth/pairing/poll").send({ code: pairing.code });
      expect(b.status).toBe(400);

      const c = await request(app).post("/api/auth/pairing/poll").send({ nonce: pairing.nonce });
      expect(c.status).toBe(400);
    });
  });

  describe("End-to-end flow", () => {
    test("desktop creates → mobile approves → desktop polls → desktop has working session", async () => {
      const alice = await registerUser(app, "e2e@t.io");

      // Step 1 — desktop creates
      const create = await request(app).post("/api/auth/pairing/create")
        .send({ deviceLabel: "Firefox on Linux" });
      const { code, nonce } = create.body.data;

      // Step 2 — desktop polls before approval; sees pending
      const poll1 = await request(app).post("/api/auth/pairing/poll")
        .send({ code, nonce });
      expect(poll1.body.data.status).toBe("pending");

      // Step 3 — mobile approves
      const approve = await request(app).post("/api/auth/pairing/approve")
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ code });
      expect(approve.status).toBe(200);

      // Step 4 — desktop polls again; gets tokens
      const poll2 = await request(app).post("/api/auth/pairing/poll")
        .send({ code, nonce });
      expect(poll2.body.data.status).toBe("approved");
      const desktopAccessToken = poll2.body.data.accessToken;

      // Step 5 — desktop uses the access token to call /api/auth/me
      const me = await request(app).get("/api/auth/me")
        .set("Authorization", `Bearer ${desktopAccessToken}`);
      expect(me.status).toBe(200);
      expect(me.body.data.user.email).toBe(alice.user.email);
    });
  });
});
