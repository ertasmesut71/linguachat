/**
 * Contact invite flow tests.
 *
 * Verifies that POST /contacts/match now returns unmatchedContacts[]
 * alongside matched[], preserving all existing behavior.
 */

const request = require("supertest");
const { buildApp } = require("../helpers/buildApp");

async function registerUser(app, opts) {
  const r = await request(app).post("/api/auth/register").send({
    email: opts.email || undefined,
    phoneNumber: opts.phone || undefined,
    password: "testpass123",
    displayName: opts.name,
  });
  return { token: r.body.data.accessToken, user: r.body.data.user };
}

describe("Contact Invite — Unmatched Contacts", () => {
  let app;

  beforeEach(() => {
    ({ app } = buildApp());
  });

  test("returns unmatchedContacts for unregistered phones", async () => {
    await registerUser(app, { phone: "+90 555 111 2222", name: "Alice" });
    const searcher = await registerUser(app, { email: "s@test.io", name: "Searcher" });

    const res = await request(app).post("/api/contacts/match")
      .set("Authorization", `Bearer ${searcher.token}`)
      .send({ contacts: [
        { name: "Alice", phone: "+90 555 111 2222" },
        { name: "Bob Unregistered", phone: "+49 30 00000001" },
        { name: "Carol Unregistered", phone: "+1 555 000 0002" },
      ]});

    expect(res.status).toBe(200);
    expect(res.body.data.matched).toHaveLength(1);
    expect(res.body.data.matched[0].displayName).toBe("Alice");
    expect(res.body.data.unmatchedContacts).toHaveLength(2);
    expect(res.body.data.unmatchedContacts.map((c) => c.contactName).sort()).toEqual(["Bob Unregistered", "Carol Unregistered"]);
    expect(res.body.data.unmatched).toBe(2);
  });

  test("registered phone NEVER appears in unmatchedContacts", async () => {
    await registerUser(app, { phone: "+90 555 222 3333", name: "Reg" });
    const searcher = await registerUser(app, { email: "s2@test.io", name: "S2" });

    const res = await request(app).post("/api/contacts/match")
      .set("Authorization", `Bearer ${searcher.token}`)
      .send({ contacts: [{ name: "X", phone: "+90 555 222 3333" }] });

    expect(res.body.data.matched).toHaveLength(1);
    expect(res.body.data.unmatchedContacts).toHaveLength(0);
  });

  test("requesting user's own phone does not appear in unmatchedContacts", async () => {
    const me = await registerUser(app, { phone: "+90 555 444 5555", name: "Me" });

    const res = await request(app).post("/api/contacts/match")
      .set("Authorization", `Bearer ${me.token}`)
      .send({ contacts: [{ name: "Myself", phone: "+90 555 444 5555" }] });

    // Not in matched (self-excluded) and not in unmatched (own phone)
    expect(res.body.data.matched).toHaveLength(0);
    expect(res.body.data.unmatchedContacts).toHaveLength(0);
  });

  test("duplicate formatting variants produce one unmatched entry", async () => {
    const searcher = await registerUser(app, { email: "s3@test.io", name: "S3" });

    const res = await request(app).post("/api/contacts/match")
      .set("Authorization", `Bearer ${searcher.token}`)
      .send({ contacts: [
        { name: "Dup A", phone: "+90 555 666 7777" },
        { name: "Dup B", phone: "+90-555-666-7777" },
        { name: "Dup C", phone: "905556667777" },
      ]});

    // All three normalize to the same number → one entry
    expect(res.body.data.unmatchedContacts).toHaveLength(1);
    expect(res.body.data.unmatchedContacts[0].phoneNumber).toBe("905556667777");
  });

  test("invalid phones are skipped — not in matched or unmatched", async () => {
    const searcher = await registerUser(app, { email: "s4@test.io", name: "S4" });

    const res = await request(app).post("/api/contacts/match")
      .set("Authorization", `Bearer ${searcher.token}`)
      .send({ contacts: [
        { name: "Bad", phone: "abc" },
        { name: "Short", phone: "12" },
      ]});

    expect(res.body.data.matched).toHaveLength(0);
    expect(res.body.data.unmatchedContacts).toHaveLength(0);
    expect(res.body.data.total).toBe(2);
  });

  test("no fake users created for unmatched contacts", async () => {
    const searcher = await registerUser(app, { email: "s5@test.io", name: "S5" });

    await request(app).post("/api/contacts/match")
      .set("Authorization", `Bearer ${searcher.token}`)
      .send({ contacts: [{ name: "Ghost", phone: "+90 555 888 9999" }] });

    // Try to find the unmatched phone — should not exist as a user
    const search = await request(app).get("/api/users/search?q=5558889999")
      .set("Authorization", `Bearer ${searcher.token}`);
    expect(search.body.data.users).toHaveLength(0);
  });

  test("empty contacts array returns empty unmatchedContacts", async () => {
    const user = await registerUser(app, { email: "e1@test.io", name: "E1" });
    const res = await request(app).post("/api/contacts/match")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ contacts: [] });

    expect(res.body.data.unmatchedContacts).toHaveLength(0);
  });

  test("unmatchedContacts includes contactName and phoneNumber", async () => {
    const searcher = await registerUser(app, { email: "s6@test.io", name: "S6" });

    const res = await request(app).post("/api/contacts/match")
      .set("Authorization", `Bearer ${searcher.token}`)
      .send({ contacts: [{ name: "Jane Doe", phone: "+44 20 1234 5678" }] });

    expect(res.body.data.unmatchedContacts[0]).toEqual({
      contactName: "Jane Doe",
      phoneNumber: "442012345678",
    });
  });
});
