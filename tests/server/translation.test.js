const { createMemoryStore } = require("../helpers/buildApp");

/**
 * translateForRecipients tests.
 *
 * These run with ANTHROPIC_API_KEY="" so the translation service uses the
 * mock "[LANG] text" fallback. That's ideal for testing: the mock is
 * deterministic, fast, and lets us inspect per-recipient routing without
 * hitting the real API.
 *
 * We verify:
 *  - the SENDER is explicitly skipped even if their receiveLang differs
 *    (this was the regression fixed in the hardening step)
 *  - a recipient whose receiveLang equals senderLang gets NO translation
 *  - a recipient with autoTranslate=false gets NO translation
 *  - recipients with different languages each get their own translation
 *  - the translations are cached in the store after the first call
 */

describe("translateForRecipients (hardening fix)", () => {
  let store;
  let translationService;

  beforeEach(() => {
    jest.resetModules();
    process.env.ANTHROPIC_API_KEY = "";     // force mock mode for determinism

    store = createMemoryStore();
    // Inject the in-memory store into the translation service's require tree
    jest.doMock(require.resolve("../../server/db/store"), () => store, { virtual: false });

    translationService = require("../../server/modules/translation/translation.service");
  });

  async function seedChatFixture() {
    // Create 4 users with different primary languages
    const alice  = await store.createUser({ email: "a@t.io", passwordHash: "x", displayName: "Alice", primaryLang: "en" });
    const bob    = await store.createUser({ email: "b@t.io", passwordHash: "x", displayName: "Bob",   primaryLang: "ja" });
    const carlos = await store.createUser({ email: "c@t.io", passwordHash: "x", displayName: "Carlos",primaryLang: "es" });
    const dave   = await store.createUser({ email: "d@t.io", passwordHash: "x", displayName: "Dave",  primaryLang: "fr" });

    const chat = await store.createChat({ type: "group", name: "Global", createdBy: alice.id });

    // alice sends in English, so members whose receiveLang != "en" get translations
    await store.addChatMember({ chatId: chat.id, userId: alice.id,  receiveLang: "en", autoTranslate: true });
    await store.addChatMember({ chatId: chat.id, userId: bob.id,    receiveLang: "ja", autoTranslate: true });
    await store.addChatMember({ chatId: chat.id, userId: carlos.id, receiveLang: "es", autoTranslate: true });
    await store.addChatMember({ chatId: chat.id, userId: dave.id,   receiveLang: "fr", autoTranslate: true });

    return { alice, bob, carlos, dave, chat };
  }

  test("sender is explicitly skipped, even with a non-matching receiveLang", async () => {
    const { alice, bob, chat } = await seedChatFixture();

    // Alice's receiveLang is "en" same as her primaryLang. We want to prove
    // that even if it were different, the sender would not be translated FOR.
    // Simulate that by changing alice's own receiveLang to "ja".
    await store.updateChatMember(chat.id, alice.id, { receiveLang: "ja" });

    const msg = await store.createMessage({
      chatId: chat.id, senderId: alice.id, type: "text", content: "Hello team",
    });

    const results = await translationService.translateForRecipients(
      msg.id, "Hello team", /* senderLang */ "en", chat.id, /* senderId */ alice.id,
    );

    // Alice (sender) MUST NOT appear in results
    expect(results[alice.id]).toBeUndefined();
    // Bob (ja) SHOULD appear
    expect(results[bob.id]).toBeDefined();
    expect(results[bob.id].translatedText).toMatch(/^\[JA\]/);
    expect(results[bob.id].sourceLang).toBe("en");
    expect(results[bob.id].targetLang).toBe("ja");
  });

  test("recipient whose receiveLang equals senderLang is skipped", async () => {
    const { alice, chat } = await seedChatFixture();

    // Add a 5th member who speaks English (same as alice)
    const english2 = await store.createUser({
      email: "e@t.io", passwordHash: "x", displayName: "Eve", primaryLang: "en",
    });
    await store.addChatMember({ chatId: chat.id, userId: english2.id, receiveLang: "en", autoTranslate: true });

    const msg = await store.createMessage({
      chatId: chat.id, senderId: alice.id, type: "text", content: "Hi Eve",
    });
    const results = await translationService.translateForRecipients(
      msg.id, "Hi Eve", "en", chat.id, alice.id,
    );

    // Eve's receiveLang === senderLang ("en"), so no entry
    expect(results[english2.id]).toBeUndefined();
  });

  test("recipient with autoTranslate=false is skipped", async () => {
    const { alice, bob, chat } = await seedChatFixture();
    await store.updateChatMember(chat.id, bob.id, { autoTranslate: false });

    const msg = await store.createMessage({
      chatId: chat.id, senderId: alice.id, type: "text", content: "disable test",
    });
    const results = await translationService.translateForRecipients(
      msg.id, "disable test", "en", chat.id, alice.id,
    );

    expect(results[bob.id]).toBeUndefined();
  });

  test("each recipient gets translation in their own target language", async () => {
    const { alice, bob, carlos, dave, chat } = await seedChatFixture();

    const msg = await store.createMessage({
      chatId: chat.id, senderId: alice.id, type: "text", content: "good morning",
    });
    const results = await translationService.translateForRecipients(
      msg.id, "good morning", "en", chat.id, alice.id,
    );

    expect(Object.keys(results).sort()).toEqual([bob.id, carlos.id, dave.id].sort());
    expect(results[bob.id].targetLang).toBe("ja");
    expect(results[carlos.id].targetLang).toBe("es");
    expect(results[dave.id].targetLang).toBe("fr");
    expect(results[bob.id].translatedText).toMatch(/^\[JA\]/);
    expect(results[carlos.id].translatedText).toMatch(/^\[ES\]/);
    expect(results[dave.id].translatedText).toMatch(/^\[FR\]/);
  });

  test("translations are persisted to the store after first call", async () => {
    const { alice, bob, chat } = await seedChatFixture();

    const msg = await store.createMessage({
      chatId: chat.id, senderId: alice.id, type: "text", content: "cache test",
    });
    await translationService.translateForRecipients(
      msg.id, "cache test", "en", chat.id, alice.id,
    );

    const cached = await store.findTranslation(msg.id, "ja");
    expect(cached).toBeDefined();
    expect(cached.translatedText).toMatch(/^\[JA\]/);
    expect(cached.sourceLang).toBe("en");
  });

  test("returns empty result set when sender is the only member", async () => {
    const user = await store.createUser({ email: "solo@t.io", passwordHash: "x", displayName: "Solo", primaryLang: "en" });
    const chat = await store.createChat({ type: "direct", createdBy: user.id });
    await store.addChatMember({ chatId: chat.id, userId: user.id, receiveLang: "en", autoTranslate: true });

    const msg = await store.createMessage({
      chatId: chat.id, senderId: user.id, type: "text", content: "hello void",
    });
    const results = await translationService.translateForRecipients(
      msg.id, "hello void", "en", chat.id, user.id,
    );
    expect(results).toEqual({});
  });
});

describe("translate (single pair)", () => {
  let translationService;

  beforeEach(() => {
    jest.resetModules();
    process.env.ANTHROPIC_API_KEY = "";
    translationService = require("../../server/modules/translation/translation.service");
  });

  test("returns input unchanged when source == target", async () => {
    const r = await translationService.translate("hello", "en", "en");
    expect(r.translatedText).toBe("hello");
  });

  test("returns mock-translated text for different languages", async () => {
    const r = await translationService.translate("hello", "en", "ja");
    expect(r.translatedText).toMatch(/^\[JA\]/);
    expect(r.sourceLang).toBe("en");
    expect(r.targetLang).toBe("ja");
  });

  test("returns empty string unchanged", async () => {
    const r = await translationService.translate("", "en", "ja");
    expect(r.translatedText).toBe("");
  });
});
