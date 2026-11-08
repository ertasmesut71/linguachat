/**
 * Google Contacts sync tests.
 *
 * Tests the /api/contacts/google-sync endpoint validation
 * and the google.service.js logic with mocked People API responses.
 */

const request = require("supertest");
const { buildApp } = require("../helpers/buildApp");

// Mock global fetch for Google People API
const originalFetch = global.fetch;

function mockPeopleApi(contacts) {
  global.fetch = async (url, opts) => {
    if (url.includes("people.googleapis.com")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          connections: contacts.map((c) => ({
            names: [{ displayName: c.name }],
            phoneNumbers: c.phones.map((p) => ({ value: p })),
          })),
        }),
      };
    }
    return originalFetch(url, opts);
  };
}

function mockPeopleApiError(status, body) {
  global.fetch = async (url) => {
    if (url.includes("people.googleapis.com")) {
      return {
        ok: false,
        status,
        text: async () => body || "",
      };
    }
    return originalFetch(url);
  };
}

afterEach(() => {
  global.fetch = originalFetch;
});

async function registerUser(app, opts) {
  const r = await request(app).post("/api/auth/register").send({
    email: opts.email || undefined,
    phoneNumber: opts.phone || undefined,
    password: "testpass123",
    displayName: opts.name,
  });
  return { token: r.body.data.accessToken, user: r.body.data.user };
}

describe("Google Contacts Sync API", () => {
  let app;

  beforeEach(() => {
    ({ app } = buildApp());
  });

  test("POST /contacts/google-sync → 401 without auth", async () => {
    const res = await request(app).post("/api/contacts/google-sync")
      .send({ accessToken: "fake-token" });
    expect(res.status).toBe(401);
  });

  test("POST /contacts/google-sync → 400 without accessToken", async () => {
    const user = await registerUser(app, { email: "g1@test.io", name: "G1" });
    const res = await request(app).post("/api/contacts/google-sync")
      .set("Authorization", `Bearer ${user.token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("access token");
  });

  test("matches registered users from Google contacts", async () => {
    const alice = await registerUser(app, { phone: "+90 555 111 2222", name: "Alice" });
    const bob = await registerUser(app, { phone: "+49 30 99887766", name: "Bob" });
    const searcher = await registerUser(app, { email: "gs@test.io", name: "Searcher" });

    mockPeopleApi([
      { name: "Alice Contact", phones: ["+90 555 111 2222"] },
      { name: "Bob Berlin", phones: ["+49-30-99887766"] },
      { name: "Unknown", phones: ["+1 555 000 0000"] },
      { name: "No Phone", phones: [] },
    ]);

    const res = await request(app).post("/api/contacts/google-sync")
      .set("Authorization", `Bearer ${searcher.token}`)
      .send({ accessToken: "valid-google-token" });

    expect(res.status).toBe(200);
    expect(res.body.data.matched).toHaveLength(2);
    expect(res.body.data.matched.map((u) => u.displayName).sort()).toEqual(["Alice", "Bob"]);
    expect(res.body.data.matched[0].contactName).toBeTruthy(); // preserves Google contact name
    expect(res.body.data.unmatched).toBeGreaterThanOrEqual(1);
  });

  test("excludes requesting user from results", async () => {
    const me = await registerUser(app, { phone: "+90 555 999 8888", name: "Me" });

    mockPeopleApi([
      { name: "Myself", phones: ["+90 555 999 8888"] },
    ]);

    const res = await request(app).post("/api/contacts/google-sync")
      .set("Authorization", `Bearer ${me.token}`)
      .send({ accessToken: "valid-token" });

    expect(res.body.data.matched).toHaveLength(0);
  });

  test("does not leak email in results", async () => {
    await registerUser(app, { phone: "+90 555 777 6666", name: "Private", email: "private@test.io" });
    const searcher = await registerUser(app, { email: "gs2@test.io", name: "S2" });

    mockPeopleApi([{ name: "X", phones: ["+90 555 777 6666"] }]);

    const res = await request(app).post("/api/contacts/google-sync")
      .set("Authorization", `Bearer ${searcher.token}`)
      .send({ accessToken: "valid-token" });

    expect(res.body.data.matched[0].email).toBeUndefined();
  });

  test("handles Google API 401 error gracefully", async () => {
    const user = await registerUser(app, { email: "g3@test.io", name: "G3" });
    mockPeopleApiError(401, "Invalid token");

    const res = await request(app).post("/api/contacts/google-sync")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ accessToken: "expired-token" });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain("expired or invalid");
  });

  test("returns empty when no contacts have phones", async () => {
    const user = await registerUser(app, { email: "g4@test.io", name: "G4" });
    mockPeopleApi([
      { name: "Email Only", phones: [] },
    ]);

    const res = await request(app).post("/api/contacts/google-sync")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ accessToken: "valid-token" });

    expect(res.status).toBe(200);
    expect(res.body.data.matched).toHaveLength(0);
  });
});
