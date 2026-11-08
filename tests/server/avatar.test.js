/**
 * Avatar upload (POST /api/users/me/avatar).
 *
 * buildApp() calls jest.resetModules() internally to wire fresh modules per test.
 * That means top-level require() of server modules gets the OLD cache copy, which
 * jest.spyOn() then modifies — but the controller uses a NEWER copy loaded after
 * resetModules(). Solution: require the modules AFTER buildApp() inside beforeEach,
 * then spy on those same post-reset instances.
 */

const request = require("supertest");
const { buildApp } = require("../helpers/buildApp");

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function register(app, email, name = "User") {
  const r = await request(app).post("/api/auth/register").send({
    email, password: "testpass123", displayName: name, primaryLang: "en",
  });
  return { token: r.body.data.accessToken, user: r.body.data.user };
}
const auth = (u) => ({ Authorization: `Bearer ${u.token}` });
const upload = (app, u, body) =>
  request(app).post("/api/users/me/avatar").set(auth(u)).send(body);

describe("Avatar upload", () => {
  let app, store, me, mediaService, pubsub;

  beforeEach(async () => {
    // buildApp() calls jest.resetModules() — require AFTER so we get the live copies
    ({ app, store } = buildApp());
    const path = require("path");
    mediaService = require(path.resolve(__dirname, "../../server/modules/media/media.service"));
    pubsub = require(path.resolve(__dirname, "../../server/utils/pubsub"));
    me = await register(app, "av@t.io");
  });

  afterEach(() => jest.restoreAllMocks());

  // ─── success path ────────────────────────────────────────────────────────

  test("valid PNG → 200, avatarUrl persisted, visible after reload and to other users", async () => {
    const res = await upload(app, me, { data: PNG_B64, mimeType: "image/png" });
    expect(res.status).toBe(200);
    const url = res.body.data.avatarUrl;
    expect(url).toMatch(/^\/api\/media\/[0-9a-f-]{36}$/);
    expect(res.body.data.user.avatarUrl).toBe(url);

    const reload = await request(app).get("/api/users/me/profile").set(auth(me));
    expect(reload.body.data.user.avatarUrl).toBe(url);

    const other = await register(app, "other@t.io", "Other");
    const asOther = await request(app).get(`/api/users/${me.user.id}`).set(auth(other));
    expect(asOther.body.data.user.avatarUrl).toBe(url);
  });

  test("stored avatar servable via header or ?token=, NOT anonymously", async () => {
    const { body } = await upload(app, me, { data: PNG_B64, mimeType: "image/png" });
    const url = body.data.avatarUrl;

    const withHeader = await request(app).get(url).set(auth(me));
    expect(withHeader.status).toBe(200);
    expect(withHeader.headers["content-type"]).toMatch(/image\/png/);

    const withQuery = await request(app).get(`${url}?token=${encodeURIComponent(me.token)}`);
    expect(withQuery.status).toBe(200);

    const anonymous = await request(app).get(url);
    expect(anonymous.status).toBe(401);
  });

  test("uploading avatar publishes ws:profile-updated with the new avatarUrl", async () => {
    const publishSpy = jest.spyOn(pubsub, "publish");

    const res = await upload(app, me, { data: PNG_B64, mimeType: "image/png" });
    expect(res.status).toBe(200);

    const calls = publishSpy.mock.calls.filter(
      ([ch, p]) => ch === "ws:profile-updated" && p.userId === me.user.id
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const [, evt] = calls[calls.length - 1];
    expect(evt.avatarUrl).toBe(res.body.data.avatarUrl);
    expect(Object.keys(evt).sort()).toEqual(
      ["avatarUrl", "bio", "displayName", "primaryLang", "status", "userId"]
    );
  });

  // ─── validation ──────────────────────────────────────────────────────────

  test.each([
    ["text/plain"], ["application/pdf"], ["image/svg+xml"], ["image/avif"], ["image/heic"],
  ])("unsupported type %s → 400 (never a 500)", async (mimeType) => {
    const res = await upload(app, me, { data: PNG_B64, mimeType });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/JPEG, PNG, WebP or GIF/);
  });

  test("oversized avatar (> 5 MB) → 400", async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 1).toString("base64");
    const res = await upload(app, me, { data: big, mimeType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/under 5 MB/);
  });

  test("missing fields and empty image → 400; unauthenticated → 401", async () => {
    expect((await upload(app, me, { mimeType: "image/png" })).status).toBe(400);
    expect((await upload(app, me, { data: PNG_B64 })).status).toBe(400);
    expect((await upload(app, me, { data: "", mimeType: "image/png" })).status).toBe(400);
    const anon = await request(app)
      .post("/api/users/me/avatar").send({ data: PNG_B64, mimeType: "image/png" });
    expect(anon.status).toBe(401);
  });

  // ─── controlled failures ─────────────────────────────────────────────────

  test("S3/MinIO storage failure → 503, cause logged, no internals in response", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(mediaService, "upload").mockRejectedValue(
      Object.assign(new Error("Access Denied: license required"), {
        name: "S3ServiceException", Code: "AccessDenied", $metadata: { httpStatusCode: 403 },
      })
    );

    const res = await upload(app, me, { data: PNG_B64, mimeType: "image/png" });
    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/Avatar storage is temporarily unavailable/);
    expect(JSON.stringify(res.body)).not.toMatch(/AccessDenied|license|S3ServiceException/);

    const logged = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toMatch(/\[avatar\] upload failed: S3ServiceException/);
    expect(logged).toMatch(/storage HTTP 403/);
    expect(logged).toMatch(/AccessDenied/);

    const profile = await request(app).get("/api/users/me/profile").set(auth(me));
    expect(profile.body.data.user.avatarUrl || null).toBeNull();
  });

  test("security-scan rejection → 400 with the media layer's message", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(mediaService, "upload").mockRejectedValue(
      new Error("File rejected by security scan: test")
    );
    const res = await upload(app, me, { data: PNG_B64, mimeType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/rejected by security scan/);
  });

  test("failed database write is never reported as success", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(store, "updateUser").mockResolvedValueOnce(null);
    const res = await upload(app, me, { data: PNG_B64, mimeType: "image/png" });
    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/Could not save your avatar/);
    expect(errSpy.mock.calls.map((c) => c.join(" ")).join("\n"))
      .toMatch(/saving avatarUrl to the user record failed/);
  });
});
