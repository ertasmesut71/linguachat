const request = require("supertest");
const { buildApp } = require("../helpers/buildApp");

describe("Auth API", () => {
  let app;

  const VALID_USER = {
    email: "alice@test.io",
    password: "verysecure123",
    displayName: "Alice",
    primaryLang: "en",
  };

  beforeEach(() => {
    ({ app } = buildApp());
  });

  describe("POST /api/auth/register", () => {
    test("creates a new user and returns accessToken", async () => {
      const res = await request(app).post("/api/auth/register").send(VALID_USER);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("success");
      expect(res.body.data.accessToken).toEqual(expect.any(String));
      expect(res.body.data.user.email).toBe(VALID_USER.email);
      expect(res.body.data.user.passwordHash).toBeUndefined();
      expect(res.body.data.user.id).toEqual(expect.any(String));
    });

    test("sets httpOnly refreshToken cookie", async () => {
      const res = await request(app).post("/api/auth/register").send(VALID_USER);
      const cookies = res.headers["set-cookie"] || [];
      const rt = cookies.find((c) => c.startsWith("refreshToken="));
      expect(rt).toBeDefined();
      expect(rt).toMatch(/HttpOnly/i);
    });

    test("rejects duplicate email", async () => {
      await request(app).post("/api/auth/register").send(VALID_USER);
      const res = await request(app).post("/api/auth/register").send(VALID_USER);
      expect([400, 409]).toContain(res.status);
    });

    test("rejects weak password (< 8 chars)", async () => {
      const res = await request(app).post("/api/auth/register").send({
        ...VALID_USER, password: "short",
      });
      expect(res.status).toBe(400);
    });

    test("rejects invalid email", async () => {
      const res = await request(app).post("/api/auth/register").send({
        ...VALID_USER, email: "not-an-email",
      });
      expect(res.status).toBe(400);
    });

    test("rejects unsupported language", async () => {
      const res = await request(app).post("/api/auth/register").send({
        ...VALID_USER, email: "b@test.io", primaryLang: "xyz",
      });
      expect(res.status).toBe(400);
    });

    test("stores primaryLang correctly", async () => {
      const res = await request(app).post("/api/auth/register").send({
        ...VALID_USER, email: "jp@test.io", primaryLang: "ja",
      });
      expect(res.status).toBe(201);
      expect(res.body.data.user.primaryLang).toBe("ja");
    });
  });

  describe("POST /api/auth/login", () => {
    beforeEach(async () => {
      await request(app).post("/api/auth/register").send(VALID_USER);
    });

    test("authenticates with correct credentials", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: VALID_USER.email, password: VALID_USER.password,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toEqual(expect.any(String));
      expect(res.body.data.user.email).toBe(VALID_USER.email);
    });

    test("rejects wrong password with 401", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: VALID_USER.email, password: "wrongpassword",
      });
      expect(res.status).toBe(401);
    });

    test("rejects unknown email with 401", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: "nobody@test.io", password: VALID_USER.password,
      });
      expect(res.status).toBe(401);
    });

    test("rejects missing password with 400", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: VALID_USER.email,
      });
      expect(res.status).toBe(400);
    });

    test("login issues new refresh cookie each time", async () => {
      const a = await request(app).post("/api/auth/login").send({
        email: VALID_USER.email, password: VALID_USER.password,
      });
      const b = await request(app).post("/api/auth/login").send({
        email: VALID_USER.email, password: VALID_USER.password,
      });
      const getCookie = (r) => (r.headers["set-cookie"] || []).find((c) => c.startsWith("refreshToken="));
      expect(getCookie(a)).toBeDefined();
      expect(getCookie(b)).toBeDefined();
    });
  });

  describe("GET /api/auth/me", () => {
    let token;

    beforeEach(async () => {
      const reg = await request(app).post("/api/auth/register").send(VALID_USER);
      token = reg.body.data.accessToken;
    });

    test("returns current user with valid Bearer token", async () => {
      const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe(VALID_USER.email);
    });

    test("returns 401 without a token", async () => {
      const res = await request(app).get("/api/auth/me");
      expect(res.status).toBe(401);
    });

    test("returns 401 with a malformed token", async () => {
      const res = await request(app).get("/api/auth/me").set("Authorization", "Bearer not-a-real-token");
      expect(res.status).toBe(401);
    });
  });
});
