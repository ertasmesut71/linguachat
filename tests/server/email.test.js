/**
 * Tests for server/utils/email.js.
 *
 * Strategy: we mock "nodemailer" at the module level with jest.mock() so
 * the real `require("nodemailer")` inside server/utils/email.js returns
 * our mock. No real SMTP connections. No DNS lookups.
 *
 * We capture:
 *   - the options passed to createTransport (to assert host/port/secure/auth)
 *   - the message passed to transport.sendMail (to assert recipient, subject,
 *     body text/html, and link construction)
 */

// ─── Module-level mock — MUST be declared before requiring server/utils/email ───
// The `__sentMessages` / `__transportOpts` arrays are attached to the mock
// module itself so tests can read them after each call.
jest.mock("nodemailer", () => {
  const state = {
    transportOpts: [],
    sentMessages: [],
  };

  const createTransport = jest.fn((opts) => {
    state.transportOpts.push(opts);
    return {
      sendMail: jest.fn(async (msg) => {
        state.sentMessages.push(msg);
        return {
          messageId: `<test-${Date.now()}-${Math.random()}>`,
          envelope: { from: msg.from, to: [msg.to] },
        };
      }),
      verify: jest.fn(async () => true),
    };
  });

  return {
    createTransport,
    // expose internal state to the test file
    __state: state,
    __reset: () => {
      state.transportOpts.length = 0;
      state.sentMessages.length = 0;
      createTransport.mockClear();
    },
  };
});

const nodemailer = require("nodemailer");
const emailModule = require("../../server/utils/email");

describe("email utility", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    // Clean SMTP env between tests
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
    delete process.env.CLIENT_URL;

    emailModule._resetTransportCacheForTests();
    nodemailer.__reset();
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
    emailModule._resetTransportCacheForTests();
  });

  describe("sendMail() — log-only fallback (no SMTP_HOST)", () => {
    test("resolves { sent:false, logged:true, messageId:null } without invoking nodemailer", async () => {
      const res = await emailModule.sendMail({
        to: "user@test.io",
        subject: "Hello",
        text: "Body",
      });
      expect(res).toEqual({ sent: false, logged: true, messageId: null });
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    test("throws if required fields are missing", async () => {
      await expect(emailModule.sendMail({})).rejects.toThrow(/requires/);
      await expect(emailModule.sendMail({ to: "a@b.io" })).rejects.toThrow(/requires/);
      await expect(emailModule.sendMail({ to: "a@b.io", subject: "x" })).rejects.toThrow(/requires/);
    });

    test("getTransport() returns null when SMTP_HOST is unset", () => {
      expect(emailModule.getTransport()).toBeNull();
    });
  });

  describe("sendMail() — with SMTP_HOST set", () => {
    test("builds a transport with parsed host/port/secure/auth and sends the message", async () => {
      process.env.SMTP_HOST = "smtp.example.com";
      process.env.SMTP_PORT = "465";
      process.env.SMTP_SECURE = "true";
      process.env.SMTP_USER = "alice";
      process.env.SMTP_PASS = "secret";
      process.env.SMTP_FROM = "LinguaChat <support@example.com>";

      const res = await emailModule.sendMail({
        to: "bob@example.com",
        subject: "Hi Bob",
        text: "hello",
        html: "<p>hello</p>",
      });

      expect(res.sent).toBe(true);
      expect(res.logged).toBe(false);
      expect(res.messageId).toEqual(expect.any(String));

      // Transport options were parsed correctly
      expect(nodemailer.__state.transportOpts).toHaveLength(1);
      expect(nodemailer.__state.transportOpts[0]).toEqual({
        host: "smtp.example.com",
        port: 465,
        secure: true,
        auth: { user: "alice", pass: "secret" },
      });

      // Message was sent to the mock transport
      expect(nodemailer.__state.sentMessages).toHaveLength(1);
      expect(nodemailer.__state.sentMessages[0]).toMatchObject({
        from: "LinguaChat <support@example.com>",
        to: "bob@example.com",
        subject: "Hi Bob",
        text: "hello",
        html: "<p>hello</p>",
      });
    });

    test("omits auth when SMTP_USER / SMTP_PASS are not set, defaults port 587 + secure=false", async () => {
      process.env.SMTP_HOST = "smtp.internal";
      // no SMTP_PORT, no SMTP_SECURE, no SMTP_USER, no SMTP_PASS

      await emailModule.sendMail({ to: "x@y.io", subject: "s", text: "t" });

      expect(nodemailer.__state.transportOpts[0]).toEqual({
        host: "smtp.internal",
        port: 587,
        secure: false,
        auth: undefined,
      });
    });

    test("uses the default sender if SMTP_FROM is unset", async () => {
      process.env.SMTP_HOST = "smtp.internal";

      await emailModule.sendMail({ to: "x@y.io", subject: "s", text: "t" });
      expect(nodemailer.__state.sentMessages[0].from)
        .toBe("LinguaChat <no-reply@linguachat.local>");
    });

    test("caller can override `from` per-message", async () => {
      process.env.SMTP_HOST = "smtp.internal";

      await emailModule.sendMail({
        to: "x@y.io", subject: "s", text: "t", from: "ops@example.com",
      });
      expect(nodemailer.__state.sentMessages[0].from).toBe("ops@example.com");
    });
  });

  describe("sendPasswordResetEmail()", () => {
    test("composes a reset link containing the raw token (log-only path)", async () => {
      // No SMTP_HOST → log-only path; we still verify the function succeeds
      // and resolves with { sent:false, logged:true }. We do NOT inspect
      // stdout here because log-only intentionally skips console output
      // when NODE_ENV === "test".
      const res = await emailModule.sendPasswordResetEmail({
        to: "user@test.io",
        token: "raw-reset-token-abc123",
        expiresAt: "2099-12-31T23:00:00.000Z",
        appUrl: "https://chat.example.com/",
      });

      expect(res).toEqual({ sent: false, logged: true, messageId: null });
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    test("sends the reset email via SMTP when configured, with correct link, subject, and token", async () => {
      process.env.SMTP_HOST = "smtp.example.com";

      await emailModule.sendPasswordResetEmail({
        to: "user@test.io",
        token: "raw-reset-token-abc123",
        expiresAt: "2099-12-31T23:00:00.000Z",
        appUrl: "https://chat.example.com/",
      });

      expect(nodemailer.__state.sentMessages).toHaveLength(1);
      const msg = nodemailer.__state.sentMessages[0];

      expect(msg.to).toBe("user@test.io");
      expect(msg.subject).toMatch(/reset/i);
      expect(msg.text).toContain("raw-reset-token-abc123");
      expect(msg.text).toContain(
        "https://chat.example.com/reset-password?token=raw-reset-token-abc123"
      );
      expect(msg.html).toContain("raw-reset-token-abc123");
      expect(msg.html).toMatch(
        /href="https:\/\/chat\.example\.com\/reset-password\?token=raw-reset-token-abc123"/
      );
    });

    test("URL-encodes tokens containing special characters", async () => {
      process.env.SMTP_HOST = "smtp.example.com";

      await emailModule.sendPasswordResetEmail({
        to: "user@test.io",
        token: "a+b/c=d&e",
        appUrl: "https://app.io",
      });

      const msg = nodemailer.__state.sentMessages[0];
      // encodeURIComponent encodes +, /, =, &
      expect(msg.text).toContain("token=a%2Bb%2Fc%3Dd%26e");
      expect(msg.html).toContain("token=a%2Bb%2Fc%3Dd%26e");
    });

    test("trims trailing slashes from appUrl to avoid double slashes", async () => {
      process.env.SMTP_HOST = "smtp.example.com";

      await emailModule.sendPasswordResetEmail({
        to: "u@t.io",
        token: "x",
        appUrl: "https://app.io///",
      });

      const msg = nodemailer.__state.sentMessages[0];
      expect(msg.text).toContain("https://app.io/reset-password?token=x");
      expect(msg.text).not.toContain("app.io//reset-password");
    });

    test("falls back to CLIENT_URL env when appUrl is not passed", async () => {
      process.env.SMTP_HOST = "smtp.example.com";
      process.env.CLIENT_URL = "https://lingua.example.com";

      await emailModule.sendPasswordResetEmail({
        to: "u@t.io",
        token: "abc",
      });

      const msg = nodemailer.__state.sentMessages[0];
      expect(msg.text).toContain("https://lingua.example.com/reset-password?token=abc");
    });

    test("throws without required to/token", async () => {
      await expect(emailModule.sendPasswordResetEmail({})).rejects.toThrow(/requires/);
      await expect(emailModule.sendPasswordResetEmail({ to: "a@b.io" })).rejects.toThrow(/requires/);
      await expect(emailModule.sendPasswordResetEmail({ token: "x" })).rejects.toThrow(/requires/);
    });
  });

  describe("transport caching", () => {
    test("reuses a cached transport across calls", async () => {
      process.env.SMTP_HOST = "smtp.example.com";

      await emailModule.sendMail({ to: "a@b.io", subject: "1", text: "1" });
      await emailModule.sendMail({ to: "a@b.io", subject: "2", text: "2" });

      expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
      expect(nodemailer.__state.sentMessages).toHaveLength(2);
    });

    test("rebuilds the transport when SMTP config changes", async () => {
      process.env.SMTP_HOST = "smtp.one.com";
      await emailModule.sendMail({ to: "a@b.io", subject: "1", text: "1" });

      process.env.SMTP_HOST = "smtp.two.com";
      await emailModule.sendMail({ to: "a@b.io", subject: "2", text: "2" });

      expect(nodemailer.createTransport).toHaveBeenCalledTimes(2);
      expect(nodemailer.__state.transportOpts[0].host).toBe("smtp.one.com");
      expect(nodemailer.__state.transportOpts[1].host).toBe("smtp.two.com");
    });
  });
});
