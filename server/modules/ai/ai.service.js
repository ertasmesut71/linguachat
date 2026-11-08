const config = require("../../config");
const store = require("../../db/store");
const documentsService = require("./documents.service");

class AiService {
  /**
   * Generate 3 contextual smart reply suggestions based on recent messages.
   */
  async getSmartReplies(chatId, userId, { count = 3 } = {}) {
    const messages = await store.listMessages(chatId, { limit: 8, forUserId: userId });
    if (messages.length === 0) return [];

    const user = await store.findUserById(userId);
    const userLang = user?.primaryLang || "en";

    const context = [];
    for (const msg of messages) {
      const sender = await store.findUserById(msg.senderId);
      context.push(`${sender?.displayName || "Unknown"}: ${msg.content}`);
    }

    const prompt = `Given this chat conversation:\n${context.join("\n")}\n\nGenerate exactly ${count} short, natural reply suggestions that "${user?.displayName}" might send next. Write them in ${this._langName(userLang)}. Return ONLY a JSON array of ${count} strings. No markdown, no explanation. Example: ["reply1","reply2","reply3"]`;

    if (!config.anthropic.apiKey) {
      return this._mockSmartReplies(userLang);
    }

    try {
      const text = await this._callClaude(prompt, 300);
      const cleaned = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) return parsed.slice(0, count);
      return this._mockSmartReplies(userLang);
    } catch {
      return this._mockSmartReplies(userLang);
    }
  }

  /**
   * Generate a concise summary of a chat conversation.
   */
  async summarizeChat(chatId, userId, { maxMessages = 50 } = {}) {
    const membership = await store.findChatMember(chatId, userId);
    if (!membership) throw new Error("Not a member");

    const messages = await store.listMessages(chatId, { limit: maxMessages, forUserId: userId });
    if (messages.length === 0) return "No messages to summarize.";

    const user = await store.findUserById(userId);
    const userLang = user?.primaryLang || "en";

    const lines = [];
    for (const msg of messages) {
      const sender = await store.findUserById(msg.senderId);
      const type = msg.type === "voice" ? " [voice]"
        : msg.type === "image" ? " [image]"
        : msg.type === "video" ? " [video]"
        : msg.type === "file" ? " [file]"
        : "";
      lines.push(`${sender?.displayName || "Unknown"}${type}: ${msg.content}`);
    }

    const prompt = `Summarize this chat conversation in ${this._langName(userLang)}. Write 3-5 concise bullet points covering the key topics, decisions, and action items. Be specific, not generic.\n\nConversation:\n${lines.join("\n")}`;

    if (!config.anthropic.apiKey) {
      return `• ${messages.length} messages exchanged between participants\n• Topics discussed include the content of the conversation\n• [Set ANTHROPIC_API_KEY for real AI summaries]`;
    }

    try {
      return await this._callClaude(prompt, 500);
    } catch {
      return "Summary generation failed. Please try again.";
    }
  }

  /**
   * Rewrite a message in a different tone.
   * Supported tones: formal, casual, professional, enthusiastic, concise, polite, friendly, warm.
   */
  async rewriteTone(text, tone, lang) {
    if (!text?.trim()) return text;

    const toneDescriptions = {
      formal:       "formal and professional, suitable for business communication",
      casual:       "casual and friendly, like texting a close friend",
      professional: "polished and diplomatic, suitable for colleagues",
      enthusiastic: "energetic and enthusiastic, showing excitement",
      concise:      "extremely brief and to the point, minimal words",
      polite:       "very polite and courteous, with respectful language",
      friendly:     "friendly and approachable, like writing to a friendly colleague",
      warm:         "warm, personable, and caring, with a human touch and genuine feeling",
    };

    const toneDesc = toneDescriptions[tone] || tone;
    const prompt = `Rewrite this message in a ${toneDesc} tone in ${this._langName(lang)}. Return ONLY the rewritten text, nothing else.\n\nOriginal: "${text}"`;

    if (!config.anthropic.apiKey) {
      return `[${tone.toUpperCase()}] ${text}`;
    }

    try {
      return await this._callClaude(prompt, 500);
    } catch {
      return text;
    }
  }

  /**
   * Fix grammar and spelling in a message.
   */
  async fixGrammar(text, lang) {
    if (!text?.trim()) return { corrected: text, hasChanges: false };

    const prompt = `Fix any grammar, spelling, or punctuation errors in this ${this._langName(lang)} text. If the text is already correct, return it unchanged. Return ONLY the corrected text, nothing else. Do not add explanations.\n\nText: "${text}"`;

    if (!config.anthropic.apiKey) {
      return { corrected: text, hasChanges: false };
    }

    try {
      const corrected = await this._callClaude(prompt, 500);
      return {
        corrected: corrected.trim(),
        hasChanges: corrected.trim() !== text.trim(),
      };
    } catch {
      return { corrected: text, hasChanges: false };
    }
  }

  /**
   * Extract action items (tasks, to-dos, follow-ups) from a recent chat.
   * Delegates to documents.service for the actual Claude call.
   */
  async extractChatTasks(chatId, userId, { maxMessages = 60 } = {}) {
    const membership = await store.findChatMember(chatId, userId);
    if (!membership) throw new Error("Not a member");

    const messages = await store.listMessages(chatId, { limit: maxMessages, forUserId: userId });
    if (messages.length === 0) return [];

    const user = await store.findUserById(userId);
    const userLang = user?.primaryLang || "en";

    const lines = [];
    for (const msg of messages) {
      if (msg.type === "system") continue;
      const sender = await store.findUserById(msg.senderId);
      lines.push(`${sender?.displayName || "Unknown"}: ${msg.content}`);
    }

    return documentsService.extractTasksFromText(lines.join("\n"), userLang);
  }

  // ─── Internal ───

  async _callClaude(prompt, maxTokens = 1000) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.anthropic.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.anthropic.model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) throw new Error(`Claude API ${resp.status}`);
    const data = await resp.json();
    return data.content?.[0]?.text?.trim() || "";
  }

  _langName(code) {
    const names = { en:"English",tr:"Turkish",es:"Spanish",fr:"French",de:"German",ja:"Japanese",zh:"Chinese",ar:"Arabic",ko:"Korean",pt:"Portuguese",ru:"Russian",hi:"Hindi",it:"Italian",nl:"Dutch" };
    return names[code] || code;
  }

  _mockSmartReplies(lang) {
    const mocks = {
      en: ["Sounds good!", "Let me check and get back to you.", "Thanks for the update!"],
      tr: ["Kulağa hoş geliyor!", "Kontrol edip döneyim.", "Güncelleme için teşekkürler!"],
      es: ["¡Suena bien!", "Déjame revisar y te aviso.", "¡Gracias por la actualización!"],
      fr: ["Ça a l'air bien !", "Je vérifie et je reviens vers toi.", "Merci pour la mise à jour !"],
      ja: ["いいですね！", "確認して折り返します。", "更新ありがとうございます！"],
      zh: ["听起来不错！", "我查一下再回复你。", "谢谢更新！"],
    };
    return mocks[lang] || mocks.en;
  }
}

module.exports = new AiService();
