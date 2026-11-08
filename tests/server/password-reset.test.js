const request = require("supertest");
const { buildApp } = require("../helpers/buildApp");

/**
 * D3 password reset flow tests.
 *
 * Covers:
 *  - POST /api/auth/request-password-reset always returns 200 + same message
 *    regardless of whether the email exists (no account enumeration)
 *  - In non-production env, the dev token is exposed so the test can proceed
 *  - POST /api/auth/reset-password rejects invalid/expired/used/short-password
 *  - Successful reset allows login with the new password
 *  - Successful reset invalidates the user's existing refresh tokens
 *  - Requesting a new token invalidates all prior outstanding tokens
 */

async function register(app, email = "reset@t.io", password = "originalpass123") {
  const r = await request(app).post("/api/auth/register").send({
    email, password, displayName: "Reset User", primaryLang: "en",
  });
  return { token: r.body.data.accessToken, user: r.body.data.user, cookies: r.headers["set-cookie"] };
}

describe("Password reset (D3)", () => {
  let app, store;

  beforeEach(() => {
    ({ app, store } = buildApp());
  });

  describe("POST /api/auth/request-password-reset", () => {
    test("returns generic success message when email exists", async () => {
      await register(app, "known@t.io");
      const res = await request(app).post("/api/auth/request-password-reset")
        .send({ email: "known@t.io" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("success");
      expect(res.body.message).toMatch(/if an account/i);
    });

    test("returns IDENTICAL generic success when email does NOT exist (no enumeration)", async () => {
      const res = await request(app).post("/api/auth/request-password-reset")
        .send({ email: "nobody@t.io" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("success");
      expect(res.body.message).toMatch(/if an account/i);
      // No dev token for non-existent accounts
      expect(res.body.dev).toBeUndefined();
    });

    test("includes dev token in non-production env for existing account", async () => {
      await register(app, "devtok@t.io");
      const res = await request(app).post("/api/auth/request-password-reset")
        .send({ email: "devtok@t.io" });
      expect(res.body.dev).toBeDefined();
      expect(res.body.dev.token).toEqual(expect.any(String));
      expect(res.body.dev.token.length).toBeGreaterThan(20);
      expect(res.body.dev.expiresAt).toEqual(expect.any(String));
    });

    test("rejects invalid email format with 400", async () => {
      const res = await request(app).post("/api/auth/request-password-reset")
        .send({ email: "not-an-email" });
      expect(res.status).toBe(400);
    });

    test("rejects missing email with 400", async () => {
      const res = await request(app).post("/api/auth/request-password-reset").send({});
      expect(res.status).toBe(400);
    });

    test("requesting a new token invalidates prior outstanding tokens", async () => {
      const { user } = await register(app, "rotate@t.io");
      const r1 = await request(app).post("/api/auth/request-password-reset")
        .send({ email: "rotate@t.io" });
      const oldToken = r1.body.dev.token;

      // Request a second token
      const r2 = await request(app).post("/api/auth/request-password-reset")
        .send({ email: "rotate@t.io" });
      const newToken = r2.body.dev.token;
      expect(newToken).not.toBe(oldToken);

      // Old token must now fail
      const resetWithOld = await request(app).post("/api/auth/reset-password")
        .send({ token: oldToken, newPassword: "brandnew123" });
      expect(resetWithOld.status).toBe(400);
      expect(resetWithOld.body.message).toMatch(/used|invalid|expired/i);

      // New token works
      const resetWithNew = await request(app).post("/api/auth/reset-password")
        .send({ token: newToken, newPassword: "brandnew456" });
      expect(resetWithNew.status).toBe(200);
    });
  });

  describe("POST /api/auth/reset-password", () => {
    test("allows login with new password after successful reset", async () => {
      await register(app, "flow@t.io", "originalpass123");
      const r = await request(app).post("/api/auth/request-password-reset")
        .send({ email: "flow@t.io" });
      const resetToken = r.body.dev.token;

      const reset = await request(app).post("/api/auth/reset-password")
        .send({ token: resetToken, newPassword: "newstrongpass789" });
      expect(reset.status).toBe(200);

      // Old password no longer works
      const oldLogin = await request(app).post("/api/auth/login")
        .send({ email: "flow@t.io", password: "originalpass123" });
      expect(oldLogin.status).toBe(401);

      // New password works
      const newLogin = await request(app).post("/api/auth/login")
        .send({ email: "flow@t.io", password: "newstrongpass789" });
      expect(newLogin.status).toBe(200);
      expect(newLogin.body.data.accessToken).toEqual(expect.any(String));
    });

    test("rejects reuse of a consumed token", async () => {
      await register(app, "reuse@t.io");
      const r = await request(app).post("/api/auth/request-password-reset")
        .send({ email: "reuse@t.io" });
      const resetToken = r.body.dev.token;

      const first = await request(app).post("/api/auth/reset-password")
        .send({ token: resetToken, newPassword: "firstchange123" });
      expect(first.status).toBe(200);

      const second = await request(app).post("/api/auth/reset-password")
        .send({ token: resetToken, newPassword: "secondattempt123" });
      expect(second.status).toBe(400);
      expect(second.body.message).toMatch(/used|invalid/i);
    });

    test("rejects an invalid / unknown token", async () => {
      const res = await request(app).post("/api/auth/reset-password")
        .send({ token: "x".repeat(32), newPassword: "validpass123" });
      expect(res.status).toBe(400);
    });

    test("rejects a weak new password", async () => {
      await register(app, "weak@t.io");
      const r = await request(app).post("/api/auth/request-password-reset")
        .send({ email: "weak@t.io" });
      const resetToken = r.body.dev.token;

      const res = await request(app).post("/api/auth/reset-password")
        .send({ token: resetToken, newPassword: "short" });
      expect(res.status).toBe(400);
    });

    test("rejects an expired token", async () => {
      const { user } = await register(app, "expired@t.io");
      const r = await request(app).post("/api/auth/request-password-reset")
        .send({ email: "expired@t.io" });
      const resetToken = r.body.dev.token;

      // Rewind the stored expiry by 2 hours
      const tokens = [...store._raw.passwordResetTokens.values()];
      const rec = tokens.find((t) => t.userId === user.id);
      expect(rec).toBeDefined();
      rec.expiresAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

      const res = await request(app).post("/api/auth/reset-password")
        .send({ token: resetToken, newPassword: "newvalid123" });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/expired/i);
    });

    test("revokes all active refresh tokens on successful reset", async () => {
      const { user } = await register(app, "revoke@t.io", "originalpass123");

      // Capture the state: refresh tokens exist
      const before = [...store._raw.refreshTokens.values()].filter((t) => t.userId === user.id && !t.revoked);
      expect(before.length).toBeGreaterThan(0);

      const r = await request(app).post("/api/auth/request-password-reset")
        .send({ email: "revoke@t.io" });
      const resetToken = r.body.dev.token;

      await request(app).post("/api/auth/reset-password")
        .send({ token: resetToken, newPassword: "freshpass456" });

      // All prior refresh tokens must now be revoked
      const after = [...store._raw.refreshTokens.values()].filter((t) => t.userId === user.id && !t.revoked);
      expect(after.length).toBe(0);
    });

    test("rejects missing fields with 400", async () => {
      const a = await request(app).post("/api/auth/reset-password").send({});
      expect(a.status).toBe(400);

      const b = await request(app).post("/api/auth/reset-password").send({ token: "x".repeat(40) });
      expect(b.status).toBe(400);

      const c = await request(app).post("/api/auth/reset-password").send({ newPassword: "thispass123" });
      expect(c.status).toBe(400);
    });
  });
});
