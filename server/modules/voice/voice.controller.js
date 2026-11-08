const voiceService = require("./voice.service");
const storage = require("../../utils/storage");
const config = require("../../config");
const ApiError = require("../../utils/ApiError");
const store = require("../../db/store");

function buildPublicSignedUrl(signedUrl) {
  if (!config.storage.publicUrl || !signedUrl) return null;
  try {
    const u = new URL(signedUrl);
    const pub = new URL(config.storage.publicUrl);
    u.protocol = pub.protocol;
    u.host = pub.host;
    return u.toString();
  } catch {
    return null;
  }
}

const voiceController = {
  async uploadAudio(req, res, next) {
    try {
      const { audio, mimeType, duration } = req.body;
      if (!audio) throw ApiError.badRequest("No audio data provided");

      const buffer = Buffer.from(audio, "base64");
      if (buffer.length > 25 * 1024 * 1024) {
        throw ApiError.badRequest("Audio file too large (max 25MB)");
      }

      const audioId = await voiceService.storeAudio(buffer, mimeType, duration);
      res.status(201).json({
        status: "success",
        data: { audioId, audioUrl: `/api/voice/audio/${audioId}` },
      });
    } catch (err) {
      next(err);
    }
  },

  async getAudio(req, res, next) {
    try {
      const { audioId } = req.params;

      // Optional redirect to public signed URL if configured
      if (config.storage.publicUrl) {
        const signedUrl = await storage.getSignedUrl(`audio/${audioId}`);
        const publicUrl = buildPublicSignedUrl(signedUrl);
        if (publicUrl) {
          return res.redirect(302, publicUrl);
        }
      }

      // Stream from storage
      const audio = await voiceService.getAudio(audioId);
      if (!audio) throw ApiError.notFound("Audio");

      res.set({
        "Content-Type": audio.mimeType || "audio/webm",
        "Content-Length": audio.buffer.length,
        "Cache-Control": "private, max-age=86400",
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
      });
      res.send(audio.buffer);
    } catch (err) {
      next(err);
    }
  },

  async transcribe(req, res, next) {
    try {
      const { audioId, lang } = req.body;
      if (!audioId) throw ApiError.badRequest("audioId required");
      const result = await voiceService.transcribe(audioId, lang || "en");
      res.json({ status: "success", data: result });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Feature C — POST /api/voice/messages/:messageId/retranslate
   * Re-translates the stored originalTranscript into the caller's current
   * receiveLang without re-uploading audio or re-running STT.
   */
  async retranslate(req, res, next) {
    try {
      const { messageId } = req.params;
      if (!messageId) throw ApiError.badRequest("messageId required");
      const message = await store.findMessageById(messageId);
      if (!message) throw ApiError.notFound("Message");
      const membership = await store.findChatMember(message.chatId, req.userId);
      if (!membership) throw ApiError.forbidden("Not a member");

      const result = await voiceService.retranslate(messageId, req.userId, message.chatId);
      res.json({ status: "success", data: result });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Feature D — POST /api/voice/messages/:messageId/source-lang
   * Override the detected STT source language and re-translate.
   * Body: { sourceLang: "tr" }
   */
  async overrideSourceLang(req, res, next) {
    try {
      const { messageId } = req.params;
      const { sourceLang } = req.body;
      if (!messageId) throw ApiError.badRequest("messageId required");
      if (!sourceLang) throw ApiError.badRequest("sourceLang required");
      const message = await store.findMessageById(messageId);
      if (!message) throw ApiError.notFound("Message");
      const membership = await store.findChatMember(message.chatId, req.userId);
      if (!membership) throw ApiError.forbidden("Not a member");

      const result = await voiceService.retranscribeAndTranslate(
        messageId, sourceLang, req.userId, message.chatId
      );
      res.json({ status: "success", data: result });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = voiceController;
