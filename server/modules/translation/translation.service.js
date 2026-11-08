const config = require("../../config");
const store = require("../../db/store");

const LANG_NAMES = {
  en:"English",tr:"Turkish",es:"Spanish",fr:"French",de:"German",
  ja:"Japanese",zh:"Chinese",ar:"Arabic",ko:"Korean",pt:"Portuguese",
  ru:"Russian",hi:"Hindi",it:"Italian",nl:"Dutch",pl:"Polish",
  sv:"Swedish",da:"Danish",fi:"Finnish",no:"Norwegian",el:"Greek",
  cs:"Czech",ro:"Romanian",hu:"Hungarian",th:"Thai",vi:"Vietnamese",
  id:"Indonesian",ms:"Malay",uk:"Ukrainian",
};

function langName(code) { return LANG_NAMES[code] || code; }

class TranslationService {
  constructor() {
    this._textCache = new Map();
    this._inflight = new Map();
  }

  /**
   * Translate a message for all recipients at send time.
   * @param {string} messageId
   * @param {string} content
   * @param {string} senderLang
   * @param {string} chatId
   * @param {string} senderId — EXPLICITLY skip this user
   * @param {object} [opts]
   * @param {boolean} [opts.forceTranslate=false] — translate even when autoTranslate is off
   *   (used for voice messages: the transcript should always be translated if languages differ)
   * @returns {{ [recipientUserId]: { translatedText, sourceLang, targetLang } }}
   */
  async translateForRecipients(messageId, content, senderLang, chatId, senderId, opts = {}) {
    const { forceTranslate = false } = opts;
    const members = await store.getChatMembers(chatId);
    const results = {};
    const tasks = [];

    for (const member of members) {
      // Explicit sender skip — never translate for the person who sent the message
      if (member.userId === senderId) continue;

      const membership = await store.findChatMember(chatId, member.userId);
      if (!membership) continue;
      // Voice messages always translate if languages differ; text messages respect autoTranslate
      if (!forceTranslate && !membership.autoTranslate) continue;

      const receiveLang = await store.getEffectiveReceiveLang(chatId, member.userId);
      if (receiveLang === senderLang) continue;

      tasks.push({ userId: member.userId, targetLang: receiveLang });
    }

    // Deduplicate by target language
    const langGroups = {};
    for (const task of tasks) {
      if (!langGroups[task.targetLang]) langGroups[task.targetLang] = [];
      langGroups[task.targetLang].push(task.userId);
    }

    const promises = Object.entries(langGroups).map(async ([targetLang, userIds]) => {
      const cached = await store.findTranslation(messageId, targetLang);
      if (cached) {
        for (const uid of userIds) results[uid] = { translatedText: cached.translatedText, sourceLang: senderLang, targetLang };
        return;
      }
      const translatedText = await this._translate(content, senderLang, targetLang);
      await store.createTranslation({ messageId, sourceLang: senderLang, targetLang, translatedText });
      for (const uid of userIds) results[uid] = { translatedText, sourceLang: senderLang, targetLang };
    });

    await Promise.allSettled(promises);
    return results;
  }

  async translate(text, sourceLang, targetLang) {
    if (!text?.trim() || sourceLang === targetLang) return { translatedText: text, sourceLang, targetLang, cached: false };
    const translatedText = await this._translate(text, sourceLang, targetLang);
    return { translatedText, sourceLang, targetLang, cached: false };
  }

  async translateMessage(messageId, targetLang) {
    const msg = await store.findMessageById(messageId);
    if (!msg) return null;
    const cached = await store.findTranslation(messageId, targetLang);
    if (cached) return cached;
    const sender = await store.findUserById(msg.senderId);
    const sourceLang = sender?.primaryLang || "en";
    if (sourceLang === targetLang) return null;
    const translatedText = await this._translate(msg.content, sourceLang, targetLang);
    return store.createTranslation({ messageId, sourceLang, targetLang, translatedText });
  }

  async getMessageTranslations(messageId) {
    return store.getMessageTranslations(messageId);
  }

  // ─── Internal ───

  async _translate(text, sourceLang, targetLang) {
    const cacheKey = `${text.slice(0, 100)}|${text.length}|${sourceLang}|${targetLang}`;
    if (this._textCache.has(cacheKey)) return this._textCache.get(cacheKey);
    if (this._inflight.has(cacheKey)) return this._inflight.get(cacheKey);

    const promise = config.anthropic.apiKey
      ? this._claudeTranslate(text, sourceLang, targetLang)
      : this._mockTranslate(text, targetLang);

    this._inflight.set(cacheKey, promise);
    try {
      const result = await promise;
      if (this._textCache.size >= 500) this._textCache.delete(this._textCache.keys().next().value);
      this._textCache.set(cacheKey, result);
      return result;
    } finally {
      this._inflight.delete(cacheKey);
    }
  }

  async _claudeTranslate(text, sourceLang, targetLang) {
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": config.anthropic.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: config.anthropic.model, max_tokens: 2048,
          messages: [{ role: "user", content: `Translate from ${langName(sourceLang)} to ${langName(targetLang)}. Return ONLY the translated text, nothing else. Preserve tone, formality, and emoji.\n\n${text}` }],
        }),
      });
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();
      return data.content?.[0]?.text?.trim() || text;
    } catch (err) {
      console.error("Translation error:", err.message);
      return `[${targetLang.toUpperCase()}] ${text}`;
    }
  }

  async _mockTranslate(text, targetLang) {
    await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
    return `[${targetLang.toUpperCase()}] ${text}`;
  }
}

module.exports = new TranslationService();
