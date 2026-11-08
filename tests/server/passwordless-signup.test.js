/**
 * Passwordless phone registration via OTP.
 *
 * Tests the full flow:
 *   request signup OTP → verify → user created → tokens issued
 * Plus purpose isolation, edge cases, and regression safety.
 */

const request = require("supertest");
const { buildApp } = require("../helpers/buildApp");

describe("Passwordless Phone Registration", () => {
  let app;

  beforeEach(() => {
    ({ app } = buildApp());
  });

  // ─── Happy path ───

  test("request signup OTP for a new phone number", async () => {
    const res = await request(app).post("/api/auth/otp/request").send({
      phone: "+90 555 900 1000", purpose: "signup",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(true);
    expect(res.body.data.dev.code).toMatch(/^\d{6}$/);
  });

  test("verify signup OTP creates user and returns tokens", async () => {
    // Request OTP
    const req1 = await request(app).post("/api/auth/otp/request").send({
      phone: "+90 555 900 2000", purpose: "signup",
    });
    const code = req1.body.data.dev.code;

    // Verify → creates account
    const res = await request(app).post("/api/auth/otp/verify").send({
      phone: "+90 555 900 2000", code, purpose: "signup",
      displayName: "Passwordless User", primaryLang: "tr",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.signupCompleted).toBe(true);
    expect(res.body.data.verified).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.phoneNumber).toBe("905559002000");
    expect(res.body.data.user.displayName).toBe("Passwordless User");
    expect(res.body.data.user.primaryLang).toBe("tr");
  });

  test("new user can access authenticated endpoint", async () => {
    const req1 = await request(app).post("/api/auth/otp/request").send({
      phone: "+90 555 900 3000", purpose: "signup",
    });
    const res = await request(app).post("/api/auth/otp/verify").send({
      phone: "+90 555 900 3000", code: req1.body.data.dev.code, purpose: "signup",
      displayName: "Auth Test",
    });
    const token = res.body.data.accessToken;

    const me = await request(app).get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.displayName).toBe("Auth Test");
  });

  test("default displayName uses phone number when not provided", async () => {
    const req1 = await request(app).post("/api/auth/otp/request").send({
      phone: "+90 555 900 4000", purpose: "signup",
    });
    const res = await request(app).post("/api/auth/otp/verify").send({
      phone: "+90 555 900 4000", code: req1.body.data.dev.code, purpose: "signup",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.user.displayName).toBe("+905559004000");
  });

  // ─── OTP validation ───

  test("wrong code rejected", async () => {
    await request(app).post("/api/auth/otp/request").send({
      phone: "+90 555 900 5000", purpose: "signup",
    });
    const res = await request(app).post("/api/auth/otp/verify").send({
      phone: "+90 555 900 5000", code: "000000", purpose: "signup",
      displayName: "Bad Code",
    });
    expect(res.status).toBe(400);
  });

  test("used OTP cannot be reused", async () => {
    const req1 = await request(app).post("/api/auth/otp/request").send({
      phone: "+90 555 900 6000", purpose: "signup",
    });
    const code = req1.body.data.dev.code;

    // First use succeeds
    const res1 = await request(app).post("/api/auth/otp/verify").send({
      phone: "+90 555 900 6000", code, purpose: "signup", displayName: "First",
    });
    expect(res1.status).toBe(201);

    // Second use fails (code consumed + phone now registered)
    const res2 = await request(app).post("/api/auth/otp/verify").send({
      phone: "+90 555 900 6000", code, purpose: "signup", displayName: "Second",
    });
    expect(res2.status).toBeGreaterThanOrEqual(400);
  });

  // ─── Duplicate phone protection ───

  test("signup OTP request rejected for already-registered phone", async () => {
    // Register via password first
    await request(app).post("/api/auth/register").send({
      phoneNumber: "+90 555 900 7000", password: "existing123",
      displayName: "Existing", primaryLang: "en",
    });

    const res = await request(app).post("/api/auth/otp/request").send({
      phone: "+90 555 900 7000", purpose: "signup",
    });
    expect(res.status).toBe(409);
  });

  // ─── Purpose isolation ───

  test("login OTP cannot be used for signup", async () => {
    // Register first so login OTP works
    await request(app).post("/api/auth/register").send({
      phoneNumber: "+90 555 900 8000", password: "pw12345678",
      displayName: "ExistUser",
    });

    const req1 = await request(app).post("/api/auth/otp/request").send({
      phone: "+90 555 900 8000", purpose: "login",
    });
    const code = req1.body.data.dev.code;

    // Try to use login code for signup → purpose mismatch → no_code
    const res = await request(app).post("/api/auth/otp/verify").send({
      phone: "+90 555 900 8000", code, purpose: "signup", displayName: "Hacker",
    });
    // Should fail: either no code for signup purpose, or phone already registered
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("signup OTP cannot be used for login", async () => {
    const req1 = await request(app).post("/api/auth/otp/request").send({
      phone: "+90 555 900 9000", purpose: "signup",
    });
    const code = req1.body.data.dev.code;

    // Try to use signup code for login → fails (phone not registered for login)
    const res = await request(app).post("/api/auth/otp/verify").send({
      phone: "+90 555 900 9000", code, purpose: "login",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  // ─── Password login guard for passwordless accounts ───

  test("password login against passwordless account fails safely", async () => {
    // Create passwordless account via OTP signup
    const req1 = await request(app).post("/api/auth/otp/request").send({
      phone: "+90 555 800 1000", purpose: "signup",
    });
    await request(app).post("/api/auth/otp/verify").send({
      phone: "+90 555 800 1000", code: req1.body.data.dev.code, purpose: "signup",
      displayName: "NoPassword",
    });

    // Try password login → should fail safely (no bcrypt crash)
    const res = await request(app).post("/api/auth/login").send({
      identifier: "+90 555 800 1000", password: "anypassword",
    });
    expect(res.status).toBe(401);
    expect(res.body.message).toContain("passwordless");
  });

  // ─── Existing flows preserved ───

  test("email + password registration still works", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: "preserved@test.io", password: "emailpass123",
      displayName: "Email User",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe("preserved@test.io");
  });

  test("phone + password registration still works", async () => {
    const res = await request(app).post("/api/auth/register").send({
      phoneNumber: "+90 555 800 2000", password: "phonepass123",
      displayName: "Phone PW User",
    });
    expect(res.status).toBe(201);
  });

  test("existing OTP login still works", async () => {
    await request(app).post("/api/auth/register").send({
      phoneNumber: "+90 555 800 3000", password: "loginpw123",
      displayName: "OTP Login User",
    });
    const req1 = await request(app).post("/api/auth/otp/request").send({
      phone: "+90 555 800 3000", purpose: "login",
    });
    const res = await request(app).post("/api/auth/otp/verify").send({
      phone: "+90 555 800 3000", code: req1.body.data.dev.code, purpose: "login",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.loginCompleted).toBe(true);
  });

  test("email + password login still works", async () => {
    await request(app).post("/api/auth/register").send({
      email: "logintest@test.io", password: "loginpass123",
      displayName: "Login Test",
    });
    const res = await request(app).post("/api/auth/login").send({
      identifier: "logintest@test.io", password: "loginpass123",
    });
    expect(res.status).toBe(200);
  });

  test("rate limiting still works for signup OTPs", async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/auth/otp/request").send({
        phone: "+90 555 800 4000", purpose: "signup",
      });
    }
    const res = await request(app).post("/api/auth/otp/request").send({
      phone: "+90 555 800 4000", purpose: "signup",
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("Too many");
  });
});
