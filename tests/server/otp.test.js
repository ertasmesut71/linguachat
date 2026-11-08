/**
 * OTP / SMS verification tests.
 *
 * Uses the in-memory mock store. SMS provider is "test" mode (no real SMS sent).
 * In non-production, the OTP code is returned in the API response for testing.
 */

const request = require("supertest");
const { buildApp } = require("../helpers/buildApp");

async function registerPhone(app, phone, displayName = "OTP User") {
  const r = await request(app).post("/api/auth/register").send({
    phoneNumber: phone, password: "otptest123", displayName, primaryLang: "en",
  });
  return { token: r.body.data.accessToken, user: r.body.data.user };
}

describe("OTP API", () => {
  let app;

  beforeEach(() => {
    ({ app } = buildApp());
  });

  // ─── Request OTP ───

  test("POST /otp/request returns code in dev mode", async () => {
    await registerPhone(app, "+90 555 100 2000");
    const res = await request(app).post("/api/auth/otp/request").send({
      phone: "+90 555 100 2000", purpose: "verify",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(true);
    expect(res.body.data.provider).toBe("test");
    expect(res.body.data.dev.code).toMatch(/^\d{6}$/);
    expect(res.body.data.phone).toBe("905551002000");
  });

  test("POST /otp/request fails with invalid phone", async () => {
    const res = await request(app).post("/api/auth/otp/request").send({
      phone: "123", purpose: "verify",
    });
    expect(res.status).toBe(400);
  });

  test("POST /otp/request for login fails if phone not registered", async () => {
    const res = await request(app).post("/api/auth/otp/request").send({
      phone: "+90 555 999 9999", purpose: "login",
    });
    expect(res.status).toBe(404);
  });

  test("POST /otp/request for login succeeds if phone is registered", async () => {
    await registerPhone(app, "+49 30 11111111");
    const res = await request(app).post("/api/auth/otp/request").send({
      phone: "+49 30 11111111", purpose: "login",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.dev.code).toMatch(/^\d{6}$/);
  });

  // ─── Verify OTP ───

  test("POST /otp/verify succeeds with correct code", async () => {
    await registerPhone(app, "+90 555 200 3000");
    const req1 = await request(app).post("/api/auth/otp/request").send({
      phone: "+90 555 200 3000", purpose: "verify",
    });
    const code = req1.body.data.dev.code;

    const res = await request(app).post("/api/auth/otp/verify").send({
      phone: "+90 555 200 3000", code, purpose: "verify",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.verified).toBe(true);
  });

  test("POST /otp/verify fails with wrong code", async () => {
    await registerPhone(app, "+90 555 300 4000");
    await request(app).post("/api/auth/otp/request").send({
      phone: "+90 555 300 4000", purpose: "verify",
    });

    const res = await request(app).post("/api/auth/otp/verify").send({
      phone: "+90 555 300 4000", code: "000000", purpose: "verify",
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("Invalid verification code");
  });

  test("OTP can only be used once", async () => {
    await registerPhone(app, "+90 555 400 5000");
    const req1 = await request(app).post("/api/auth/otp/request").send({
      phone: "+90 555 400 5000", purpose: "verify",
    });
    const code = req1.body.data.dev.code;

    // First use succeeds
    const res1 = await request(app).post("/api/auth/otp/verify").send({
      phone: "+90 555 400 5000", code, purpose: "verify",
    });
    expect(res1.status).toBe(200);

    // Second use fails
    const res2 = await request(app).post("/api/auth/otp/verify").send({
      phone: "+90 555 400 5000", code, purpose: "verify",
    });
    expect(res2.status).toBe(400);
    expect(res2.body.message).toContain("No pending");
  });

  test("new OTP request invalidates previous code", async () => {
    await registerPhone(app, "+90 555 500 6000");
    const req1 = await request(app).post("/api/auth/otp/request").send({
      phone: "+90 555 500 6000", purpose: "verify",
    });
    const oldCode = req1.body.data.dev.code;

    // Request a new code
    const req2 = await request(app).post("/api/auth/otp/request").send({
      phone: "+90 555 500 6000", purpose: "verify",
    });
    const newCode = req2.body.data.dev.code;

    // Old code should fail
    const res1 = await request(app).post("/api/auth/otp/verify").send({
      phone: "+90 555 500 6000", code: oldCode, purpose: "verify",
    });
    expect(res1.status).toBe(400);

    // New code should succeed
    const res2 = await request(app).post("/api/auth/otp/verify").send({
      phone: "+90 555 500 6000", code: newCode, purpose: "verify",
    });
    expect(res2.status).toBe(200);
  });

  // ─── OTP Login ───

  test("OTP login returns auth tokens after verification", async () => {
    await registerPhone(app, "+90 555 600 7000", "OTP Login User");
    const req1 = await request(app).post("/api/auth/otp/request").send({
      phone: "+90 555 600 7000", purpose: "login",
    });
    const code = req1.body.data.dev.code;

    const res = await request(app).post("/api/auth/otp/verify").send({
      phone: "+90 555 600 7000", code, purpose: "login",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.verified).toBe(true);
    expect(res.body.data.loginCompleted).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.displayName).toBe("OTP Login User");
  });

  // ─── Rate limiting ───

  test("rate limits OTP requests (max 5 per 10 min)", async () => {
    await registerPhone(app, "+90 555 700 8000");
    for (let i = 0; i < 5; i++) {
      const r = await request(app).post("/api/auth/otp/request").send({
        phone: "+90 555 700 8000", purpose: "verify",
      });
      expect(r.status).toBe(200);
    }
    // 6th should be rate-limited
    const res = await request(app).post("/api/auth/otp/request").send({
      phone: "+90 555 700 8000", purpose: "verify",
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("Too many OTP requests");
  });
});
