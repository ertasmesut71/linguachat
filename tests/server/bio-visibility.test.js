const request = require("supertest");
const { buildApp } = require("../helpers/buildApp");

describe("Bio Visibility", () => {
  let app;
  beforeEach(() => { ({ app } = buildApp()); });

  test("other user's bio is included in chat member data", async () => {
    // Register Elif + set bio
    const r1 = await request(app).post("/api/auth/register").send({
      email: "elif@t.io", password: "testpass123", displayName: "Elif", primaryLang: "tr",
    });
    const elifToken = r1.body.data.accessToken;
    const elifId = r1.body.data.user.id;

    const bioUp = await request(app).patch("/api/users/me/profile")
      .set("Authorization", `Bearer ${elifToken}`)
      .send({ bio: "İstanbul'dan selamlar" });
    expect(bioUp.body.data.user.bio).toBe("İstanbul'dan selamlar");

    // Register Alex
    const r2 = await request(app).post("/api/auth/register").send({
      email: "alex@t.io", password: "testpass123", displayName: "Alex", primaryLang: "en",
    });
    const alexToken = r2.body.data.accessToken;

    // Create direct chat
    await request(app).post("/api/chats/direct")
      .set("Authorization", `Bearer ${alexToken}`)
      .send({ otherUserId: elifId });

    // Alex fetches chats
    const chats = await request(app).get("/api/chats")
      .set("Authorization", `Bearer ${alexToken}`);

    const elifChat = chats.body.data.chats[0];
    const elifMember = elifChat.members.find(m => m.userId === elifId);

    console.log("MEMBER_USER_KEYS:", Object.keys(elifMember?.user || {}));
    console.log("MEMBER_BIO:", JSON.stringify(elifMember?.user?.bio));

    expect(elifMember.user.bio).toBe("İstanbul'dan selamlar");
  });

  test("empty bio returns empty string, not undefined", async () => {
    const r1 = await request(app).post("/api/auth/register").send({
      email: "a@t.io", password: "testpass123", displayName: "A",
    });
    const r2 = await request(app).post("/api/auth/register").send({
      email: "b@t.io", password: "testpass123", displayName: "B",
    });
    await request(app).post("/api/chats/direct")
      .set("Authorization", `Bearer ${r2.body.data.accessToken}`)
      .send({ otherUserId: r1.body.data.user.id });

    const chats = await request(app).get("/api/chats")
      .set("Authorization", `Bearer ${r2.body.data.accessToken}`);
    const member = chats.body.data.chats[0].members.find(m => m.userId === r1.body.data.user.id);
    expect(member.user.bio).toBeDefined();
    expect(typeof member.user.bio).toBe("string");
  });

  test("password hash not exposed in member user data", async () => {
    const r1 = await request(app).post("/api/auth/register").send({
      email: "c@t.io", password: "testpass123", displayName: "C",
    });
    const r2 = await request(app).post("/api/auth/register").send({
      email: "d@t.io", password: "testpass123", displayName: "D",
    });
    await request(app).post("/api/chats/direct")
      .set("Authorization", `Bearer ${r2.body.data.accessToken}`)
      .send({ otherUserId: r1.body.data.user.id });

    const chats = await request(app).get("/api/chats")
      .set("Authorization", `Bearer ${r2.body.data.accessToken}`);
    const member = chats.body.data.chats[0].members.find(m => m.userId === r1.body.data.user.id);
    expect(member.user.passwordHash).toBeUndefined();
  });
});
