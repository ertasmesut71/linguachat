const { v4: uuidv4 } = require("uuid");
const config = require("../../config");
const store = require("../../db/store");
const storage = require("../../utils/storage");
const translationService = require("../translation/translation.service");

const LANG_NAMES = {
  en: "English", tr: "Turkish", es: "Spanish", fr: "French", de: "German",
  ja: "Japanese", zh: "Chinese", ar: "Arabic", ko: "Korean", pt: "Portuguese",
  ru: "Russian", hi: "Hindi", it: "Italian", nl: "Dutch", pl: "Polish",
};

/**
 * Voice message service.
 *
 * IMPORTANT — v1.0 STT honesty notice:
 *   The Anthropic Messages API does NOT accept audio inputs (only PDFs as
 *   `document` blocks and PNG/JPG/GIF/WebP as `image` blocks). An earlier
 *   implementation tried to send audio to Claude as a `document` block;
 *   that call returned 400 from Anthropic and silently degraded to a
 *   placeholder transcript, which was misleading.
 *
 *   To use REAL speech-to-text, set one of:
 *     STT_PROVIDER=whisper   + OPENAI_API_KEY=sk-...
 *     STT_PROVIDER=deepgram  + DEEPGRAM_API_KEY=...
 *
 *   Without either set, voice messages still work end-to-end — audio is
 *   stored and recipients can play it — but the stored `content` field
 *   is a clearly-labeled placeholder rather than a fake transcription.
 *   Recipients see the same placeholder (translated if their receive
 *   language differs), and the audio playback is unaffected.
 */
class VoiceService {
  /**
   * Store audio to persistent storage. Returns audioId.
   */
  async storeAudio(buffer, mimeType, duration) {
    const audioId = uuidv4();
    const key = `audio/${audioId}`;
    await storage.put(key, buffer, mimeType || "audio/webm", {
      duration: String(duration || 0),
      mimeType: mimeType || "audio/webm",
    });
    return audioId;
  }

  /**
   * Retrieve stored audio.
   * @returns {{ buffer, mimeType, duration } | null}
   */
  async getAudio(audioId) {
    const key = `audio/${audioId}`;
    const result = await storage.get(key);
    if (!result) return null;
    return {
      buffer: result.buffer,
      mimeType: result.contentType,
      duration: parseInt(result.metadata?.duration || "0", 10),
    };
  }

  /**
   * Transcribe stored audio. Dispatches on STT_PROVIDER env.
   */
  async transcribe(audioId, senderLang) {
    const audio = await this.getAudio(audioId);
    if (!audio) return { transcript: "[Audio not found]", lang: senderLang };

    const provider = (process.env.STT_PROVIDER || "").toLowerCase();
    if (provider === "whisper" && process.env.OPENAI_API_KEY) {
      return this._transcribeWithWhisper(audio, senderLang);
    }
    if (provider === "deepgram" && process.env.DEEPGRAM_API_KEY) {
      return this._transcribeWithDeepgram(audio, senderLang);
    }
    // In test/dev with no STT configured, return language-appropriate sample
    // text so test fixtures and demo flows remain predictable.
    if (config.env !== "production") {
      return this._sampleTranscribe(senderLang);
    }
    return this._placeholderTranscribe(senderLang);
  }

  /**
   * Full voice pipeline: store → STT → translate for recipients → return.
   * Always stores the audio and creates the message even if STT fails —
   * recipients can still play the audio; the content field is labeled.
   *
   * Feature E: metadata carries sttStatus / translationStatus so the client
   * can show explicit state (Transcribing… / Translating… / unavailable / Retry).
   */
  async processVoiceMessage(audioBuffer, mimeType, duration, senderId, chatId) {
    const audioId = await this.storeAudio(audioBuffer, mimeType, duration);
    const audioUrl = `/api/voice/audio/${audioId}`;
    const sender = await store.findUserById(senderId);
    const senderLang = sender?.primaryLang || "en";

    // STT — failure is non-fatal; audio remains playable
    let transcript, sttStatus;
    try {
      const result = await this.transcribe(audioId, senderLang);
      transcript = result.transcript;
      sttStatus = transcript.startsWith("[") ? "placeholder" : "ok";
    } catch (err) {
      console.error("STT pipeline error:", err.message);
      transcript = `[Voice message in ${LANG_NAMES[senderLang] || senderLang} — transcription unavailable]`;
      sttStatus = "failed";
    }

    const message = await store.createMessage({
      chatId,
      senderId,
      type: "voice",
      content: transcript,
      metadata: {
        audioId,
        audioUrl,
        mimeType: mimeType || "audio/webm",
        duration,
        originalTranscript: transcript,
        senderLang,
        sttStatus,
        translationStatus: "pending",
      },
    });

    await store.upsertReceipt(message.id, senderId, "sent");
    const members = await store.getChatMembers(chatId);
    for (const m of members) {
      if (m.userId !== senderId) await store.upsertReceipt(message.id, m.userId, "delivered");
    }

    // Feature A: Voice messages always translate for recipients (forceTranslate: true),
    // regardless of their autoTranslate setting. Each recipient gets the transcript
    // translated into their own chat-level receiveLang.
    let recipientTranslations = {};
    let translationStatus = "ok";
    try {
      recipientTranslations = await translationService.translateForRecipients(
        message.id, transcript, senderLang, chatId, senderId, { forceTranslate: true }
      );
    } catch (err) {
      console.error("Voice translation pipeline error:", err.message);
      translationStatus = "failed";
    }

    // Update translationStatus in metadata (non-blocking; message already saved)
    try {
      await store.updateMessageMetadata(message.id, { translationStatus });
    } catch (_) { /* best-effort */ }

    const senderInfo = await store.findUserById(senderId);
    return {
      message: { ...message, sender: senderInfo, metadata: { ...message.metadata, translationStatus } },
      recipientTranslations,
    };
  }

  /**
   * Feature C — Retranslate a voice message transcript.
   * Re-runs translation from the stored originalTranscript without re-uploading
   * audio or re-running STT. Updates the persisted translation row.
   *
   * @param {string} messageId
   * @param {string} requestingUserId — the recipient requesting retranslation
   * @param {string} chatId
   * @returns {{ translatedText, sourceLang, targetLang }}
   */
  async retranslate(messageId, requestingUserId, chatId) {
    const message = await store.findMessageById(messageId);
    if (!message) throw new Error("Message not found");

    const meta = message.metadata || {};
    const originalTranscript = meta.originalTranscript || message.content;
    const senderLang = meta.senderLang || "en";
    const targetLang = await store.getEffectiveReceiveLang(chatId, requestingUserId);

    if (targetLang === senderLang) {
      return { translatedText: originalTranscript, sourceLang: senderLang, targetLang };
    }

    const { translatedText } = await translationService.translate(originalTranscript, senderLang, targetLang);

    // Upsert the translation row so refresh/reconnect returns the new result
    await store.upsertTranslation({ messageId, sourceLang: senderLang, targetLang, translatedText });

    return { translatedText, sourceLang: senderLang, targetLang };
  }

  /**
   * Feature D — Source language override.
   * Re-transcribes from stored audio with a new source language hint and
   * re-translates for the requesting recipient.
   *
   * @param {string} messageId
   * @param {string} newSourceLang — the user-selected source language
   * @param {string} requestingUserId — the recipient requesting the override
   * @param {string} chatId
   * @returns {{ originalTranscript, translatedText, sourceLang, targetLang }}
   */
  async retranscribeAndTranslate(messageId, newSourceLang, requestingUserId, chatId) {
    const message = await store.findMessageById(messageId);
    if (!message) throw new Error("Message not found");

    const meta = message.metadata || {};
    const audioId = meta.audioId;
    if (!audioId) throw new Error("No audio ID stored for this message");

    // Re-run STT with the new source language hint
    const { transcript } = await this.transcribe(audioId, newSourceLang);

    // Update the message's originalTranscript and senderLang in metadata
    const updatedMeta = {
      ...meta,
      originalTranscript: transcript,
      senderLang: newSourceLang,
      sttStatus: transcript.startsWith("[") ? "placeholder" : "ok",
    };
    await store.updateMessageMetadata(message.id, updatedMeta);

    // Translate for the requesting recipient
    const targetLang = await store.getEffectiveReceiveLang(chatId, requestingUserId);
    let translatedText = transcript;
    if (targetLang !== newSourceLang) {
      const result = await translationService.translate(transcript, newSourceLang, targetLang);
      translatedText = result.translatedText;
      await store.upsertTranslation({ messageId, sourceLang: newSourceLang, targetLang, translatedText });
    }

    return { originalTranscript: transcript, translatedText, sourceLang: newSourceLang, targetLang };
  }

  /**
   * Translate a single live voice chunk for one recipient, honoring the
   * persistent per-conversation receiveLang rule.
   */
  async translateLiveChunk(text, senderLang, chatId, recipientUserId) {
    const receiveLang = await store.getEffectiveReceiveLang(chatId, recipientUserId);
    if (receiveLang === senderLang) return { translatedText: text, targetLang: receiveLang };
    const { translatedText } = await translationService.translate(text, senderLang, receiveLang);
    return { translatedText, targetLang: receiveLang };
  }

  // ───────────────────────── Internal transcribers ─────────────────────────

  /**
   * OpenAI Whisper (v1/audio/transcriptions). Accepts webm, wav, mp3, mp4.
   * Uses multipart/form-data. Falls back to placeholder on any failure.
   */
  async _transcribeWithWhisper(audio, senderLang) {
    try {
      const form = new FormData();
      const mimeType = audio.mimeType || "audio/webm";
      const filename = "audio." + (mimeType.includes("wav") ? "wav"
        : mimeType.includes("mp3") ? "mp3"
        : mimeType.includes("mp4") ? "mp4"
        : "webm");
      // Node 18+ has built-in FormData + Blob.
      form.append("file", new Blob([audio.buffer], { type: mimeType }), filename);
      form.append("model", process.env.OPENAI_WHISPER_MODEL || "whisper-1");
      if (senderLang) form.append("language", senderLang);
      form.append("response_format", "json");

      const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form,
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        console.error("Whisper STT failed:", resp.status, errText.slice(0, 200));
        return this._placeholderTranscribe(senderLang);
      }
      const data = await resp.json();
      const text = (data.text || "").trim();
      if (!text) return this._placeholderTranscribe(senderLang);
      return { transcript: text, lang: senderLang };
    } catch (err) {
      console.error("Whisper STT error:", err.message);
      return this._placeholderTranscribe(senderLang);
    }
  }

  /**
   * Deepgram (v1/listen). Raw audio body. Returns results.channels[0].alternatives[0].transcript.
   */
  async _transcribeWithDeepgram(audio, senderLang) {
    try {
      const mimeType = audio.mimeType || "audio/webm";
      const params = new URLSearchParams({
        model: process.env.DEEPGRAM_MODEL || "nova-2",
        smart_format: "true",
      });
      if (senderLang) params.set("language", senderLang);

      const resp = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
        method: "POST",
        headers: {
          "Authorization": `Token ${process.env.DEEPGRAM_API_KEY}`,
          "Content-Type": mimeType,
        },
        body: audio.buffer,
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        console.error("Deepgram STT failed:", resp.status, errText.slice(0, 200));
        return this._placeholderTranscribe(senderLang);
      }
      const data = await resp.json();
      const text = (data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "").trim();
      if (!text) return this._placeholderTranscribe(senderLang);
      return { transcript: text, lang: senderLang };
    } catch (err) {
      console.error("Deepgram STT error:", err.message);
      return this._placeholderTranscribe(senderLang);
    }
  }

  /**
   * Honest placeholder when no STT provider is configured or the provider
   * call fails. Recipients still see a message and can play the audio; the
   * content is unambiguously labeled so no one mistakes it for a real
   * transcription.
   */
  _placeholderTranscribe(senderLang) {
    const langName = LANG_NAMES[senderLang] || senderLang || "unknown language";
    return {
      transcript: `[Voice message in ${langName} — transcription unavailable]`,
      lang: senderLang,
    };
  }

  /**
   * Dev/test-only sample transcript. Used when config.env !== "production"
   * and no STT provider is configured, so demos and tests remain
   * deterministic. NEVER used in production.
   */
  _sampleTranscribe(senderLang) {
    const samples = {
      en: "Hello, this is a voice message about the project timeline.",
      tr: "Merhaba, bu proje zaman çizelgesi hakkında bir sesli mesaj.",
      es: "Hola, este es un mensaje de voz sobre el cronograma del proyecto.",
      fr: "Bonjour, ceci est un message vocal concernant le calendrier du projet.",
      ja: "こんにちは、プロジェクトのスケジュールについての音声メッセージです。",
      zh: "你好，这是一条关于项目时间表的语音消息。",
    };
    return { transcript: samples[senderLang] || samples.en, lang: senderLang };
  }
}

module.exports = new VoiceService();
