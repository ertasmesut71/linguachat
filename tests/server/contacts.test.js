/**
 * Device contacts sync / bulk phone match tests.
 */

const request = require("supertest");
const { buildApp } = require("../helpers/buildApp");

async function registerUser(app, opts) {
  const r = await request(app).post("/api/auth/register").send({
    email: opts.email || undefined,
    phoneNumber: opts.phone || undefined,
    password: "testpass123",
    displayName: opts.name,
    primaryLang: opts.lang || "en",
  });
  return { token: r.body.data.accessToken, user: r.body.data.user };
}

describe("Contacts Match API", () => {
  let app;

  beforeEach(() => {
    ({ app } = buildApp());
  });

  test("POST /contacts/match returns matched registered users", async () => {
    const alice = await registerUser(app, { phone: "+90 555 111 2222", name: "Alice" });
    const bob = await registerUser(app, { phone: "+49 30 99887766", name: "Bob" });
    const searcher = await registerUser(app, { email: "searcher@test.io", name: "Searcher" });

    const res = await request(app).post("/api/contacts/match")
      .set("Authorization", `Bearer ${searcher.token}`)
      .send({
        contacts: [
          { name: "My friend Alice", phone: "+90 555 111 2222" },
          { name: "Bob from Berlin", phone: "+49-30-99887766" },
          { name: "Unknown Person", phone: "+1 555 000 0000" },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.matched).toHaveLength(2);
    expect(res.body.data.matched.map((u) => u.displayName).sort()).toEqual(["Alice", "Bob"]);
    expect(res.body.data.unmatched).toBe(1);
    expect(res.body.data.total).toBe(3);
  });

  test("returns contactName from the submitted contact list", async () => {
    await registerUser(app, { phone: "+90 555 333 4444", name: "DB Name" });
    const searcher = await registerUser(app, { email: "s2@test.io", name: "Searcher2" });

    const res = await request(app).post("/api/contacts/match")
      .set("Authorization", `Bearer ${searcher.token}`)
      .send({ contacts: [{ name: "My Phonebook Name", phone: "+90 555 333 4444" }] });

    expect(res.body.data.matched[0].contactName).toBe("My Phonebook Name");
    expect(res.body.data.matched[0].displayName).toBe("DB Name");
  });

  test("does not return the requesting user in results", async () => {
    const me = await registerUser(app, { phone: "+90 555 999 8888", name: "Me" });

    const res = await request(app).post("/api/contacts/match")
      .set("Authorization", `Bearer ${me.token}`)
      .send({ contacts: [{ name: "Myself", phone: "+90 555 999 8888" }] });

    expect(res.body.data.matched).toHaveLength(0);
  });

  test("does not leak email in match results", async () => {
    await registerUser(app, { phone: "+90 555 777 6666", name: "Private", email: "private@secret.io" });
    const searcher = await registerUser(app, { email: "s3@test.io", name: "Searcher3" });

    const res = await request(app).post("/api/contacts/match")
      .set("Authorization", `Bearer ${searcher.token}`)
      .send({ contacts: [{ name: "X", phone: "+90 555 777 6666" }] });

    const match = res.body.data.matched[0];
    expect(match.displayName).toBe("Private");
    expect(match.email).toBeUndefined(); // privacy: no email leaked
  });

  test("handles empty contacts array", async () => {
    const user = await registerUser(app, { email: "e1@test.io", name: "Empty" });
    const res = await request(app).post("/api/contacts/match")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ contacts: [] });
    expect(res.status).toBe(200);
    expect(res.body.data.matched).toHaveLength(0);
  });

  test("handles invalid phone numbers gracefully", async () => {
    const user = await registerUser(app, { email: "e2@test.io", name: "Invalid" });
    const res = await request(app).post("/api/contacts/match")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ contacts: [{ name: "Bad", phone: "abc" }, { name: "Short", phone: "12" }] });
    expect(res.status).toBe(200);
    expect(res.body.data.matched).toHaveLength(0);
    expect(res.body.data.total).toBe(2);
  });

  test("requires authentication", async () => {
    const res = await request(app).post("/api/contacts/match")
      .send({ contacts: [{ name: "X", phone: "+1234567890" }] });
    expect(res.status).toBe(401);
  });

  test("caps at 500 contacts", async () => {
    const user = await registerUser(app, { email: "e3@test.io", name: "Cap" });
    const bigList = Array.from({ length: 600 }, (_, i) => ({ name: `C${i}`, phone: `+1555000${String(i).padStart(4, "0")}` }));
    const res = await request(app).post("/api/contacts/match")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ contacts: bigList });
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(500);
  });

  test("handles duplicate phone numbers in input", async () => {
    await registerUser(app, { phone: "+90 555 444 3333", name: "Dupe" });
    const searcher = await registerUser(app, { email: "s4@test.io", name: "Searcher4" });
    const res = await request(app).post("/api/contacts/match")
      .set("Authorization", `Bearer ${searcher.token}`)
      .send({ contacts: [
        { name: "A", phone: "+90 555 444 3333" },
        { name: "B", phone: "+90-555-444-3333" },
      ] });
    expect(res.body.data.matched).toHaveLength(1);
  });
});
