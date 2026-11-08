/**
 * Phone-number-centric auth tests.
 *
 * Covers:
 *   - phone number normalization
 *   - register with phone (no email)
 *   - register with both email + phone
 *   - login by phone
 *   - login by email (preserved)
 *   - duplicate phone prevention
 *   - phone-based user search
 */

const request = require("supertest");
const { buildApp } = require("../helpers/buildApp");
const { normalizePhone, isValidPhone, formatPhoneDisplay } = require("../../server/utils/phone");

describe("Phone normalization", () => {
  test("strips non-digit characters", () => {
    expect(normalizePhone("+90 555 123 4567")).toBe("905551234567");
    expect(normalizePhone("(212) 555-1234")).toBe("2125551234");
    expect(normalizePhone("+1-800-FLOWERS")).toBeNull(); // letters stripped, only 4 digits — below 7-digit minimum
    expect(normalizePhone("+1-800-356-9377")).toBe("18003569377");
  });

  test("returns null for invalid input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("abc")).toBeNull(); // no digits
    expect(normalizePhone("12345")).toBeNull(); // too short (< 7)
    expect(normalizePhone("1234567890123456")).toBeNull(); // too long (> 15)
  });

  test("accepts valid lengths", () => {
    expect(normalizePhone("1234567")).toBe("1234567"); // 7 digits OK
    expect(normalizePhone("123456789012345")).toBe("123456789012345"); // 15 digits OK
  });

  test("isValidPhone validates normalized strings", () => {
    expect(isValidPhone("905551234567")).toBe(true);
    expect(isValidPhone("1234567")).toBe(true);
    expect(isValidPhone("12345")).toBe(false);
    expect(isValidPhone("")).toBe(false);
    expect(isValidPhone(null)).toBe(false);
  });

  test("formatPhoneDisplay prepends +", () => {
    expect(formatPhoneDisplay("905551234567")).toBe("+905551234567");
    expect(formatPhoneDisplay("")).toBe("");
    expect(formatPhoneDisplay(null)).toBe("");
  });
});

describe("Phone auth API", () => {
  let app;

  beforeEach(() => {
    ({ app } = buildApp());
  });

  // ─── Register by phone ───

  test("register with phone number (no email)", async () => {
    const res = await request(app).post("/api/auth/register").send({
      phoneNumber: "+90 555 123 4567",
      password: "securepass123",
      displayName: "Phone User",
      primaryLang: "tr",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.user.phoneNumber).toBe("905551234567");
    expect(res.body.data.user.email).toBeNull();
    expect(res.body.data.user.displayName).toBe("Phone User");
    expect(res.body.data.accessToken).toBeTruthy();
  });

  test("register with both email and phone", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: "dual@test.io",
      phoneNumber: "+1 202 555 0100",
      password: "securepass123",
      displayName: "Dual User",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe("dual@test.io");
    expect(res.body.data.user.phoneNumber).toBe("12025550100");
  });

  test("register fails without email or phone", async () => {
    const res = await request(app).post("/api/auth/register").send({
      password: "securepass123",
      displayName: "No Identity",
    });
    expect(res.status).toBe(400);
  });

  test("register fails with invalid phone format", async () => {
    const res = await request(app).post("/api/auth/register").send({
      phoneNumber: "123",
      password: "securepass123",
      displayName: "Bad Phone",
    });
    expect(res.status).toBe(400);
  });

  test("register fails with duplicate phone", async () => {
    await request(app).post("/api/auth/register").send({
      phoneNumber: "+90 555 999 8888",
      password: "securepass123",
      displayName: "First",
    });
    const res = await request(app).post("/api/auth/register").send({
      phoneNumber: "+90 555 999 8888",
      password: "otherpass123",
      displayName: "Second",
    });
    expect(res.status).toBe(409);
  });

  // ─── Login by phone ───

  test("login with phone number", async () => {
    await request(app).post("/api/auth/register").send({
      phoneNumber: "+90 555 111 2222",
      password: "logintest123",
      displayName: "Phone Login",
    });
    const res = await request(app).post("/api/auth/login").send({
      identifier: "+905551112222",
      password: "logintest123",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.user.displayName).toBe("Phone Login");
    expect(res.body.data.accessToken).toBeTruthy();
  });

  test("login with phone using spaces/dashes", async () => {
    await request(app).post("/api/auth/register").send({
      phoneNumber: "+49 30 12345678",
      password: "germanpass123",
      displayName: "Berlin User",
    });
    const res = await request(app).post("/api/auth/login").send({
      identifier: "+49-30-12345678",
      password: "germanpass123",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.user.displayName).toBe("Berlin User");
  });

  test("login by phone fails with wrong password", async () => {
    await request(app).post("/api/auth/register").send({
      phoneNumber: "+90 555 333 4444",
      password: "correctpass123",
      displayName: "WrongPW",
    });
    const res = await request(app).post("/api/auth/login").send({
      identifier: "+905553334444",
      password: "wrongpassword",
    });
    expect(res.status).toBe(401);
  });

  // ─── Email auth preserved ───

  test("register with email still works", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: "classic@test.io",
      password: "emailpass123",
      displayName: "Email User",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe("classic@test.io");
  });

  test("login with email still works (via identifier)", async () => {
    await request(app).post("/api/auth/register").send({
      email: "login@test.io",
      password: "emaillogin123",
      displayName: "Email Login",
    });
    const res = await request(app).post("/api/auth/login").send({
      identifier: "login@test.io",
      password: "emaillogin123",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe("login@test.io");
  });

  test("login with email via legacy email field still works", async () => {
    await request(app).post("/api/auth/register").send({
      email: "legacy@test.io",
      password: "legacypass123",
      displayName: "Legacy",
    });
    const res = await request(app).post("/api/auth/login").send({
      email: "legacy@test.io",
      password: "legacypass123",
    });
    expect(res.status).toBe(200);
  });

  // ─── Phone-based user search ───

  test("search finds user by phone number", async () => {
    const reg = await request(app).post("/api/auth/register").send({
      phoneNumber: "+90 555 777 6666",
      password: "searchtest123",
      displayName: "Findable",
    });
    const token = reg.body.data.accessToken;

    // Register another user who will search
    const reg2 = await request(app).post("/api/auth/register").send({
      email: "searcher@test.io",
      password: "searcherpass",
      displayName: "Searcher",
    });
    const token2 = reg2.body.data.accessToken;

    const res = await request(app)
      .get("/api/users/search?q=5557776666")
      .set("Authorization", `Bearer ${token2}`);
    expect(res.status).toBe(200);
    expect(res.body.data.users.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.users.some((u) => u.displayName === "Findable")).toBe(true);
  });
});
