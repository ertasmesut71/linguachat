const aiService = require("./ai.service");
const documentsService = require("./documents.service");
const ApiError = require("../../utils/ApiError");
const store = require("../../db/store");

/**
 * Resolve the target language for a document-intelligence response.
 * Priority:
 *   1. Explicit `lang` body/query param
 *   2. Active chat's membership receiveLang (if chatId given)
 *   3. User's primaryLang
 *   4. "en"
 */
async function resolveTargetLang(req, chatId) {
  const explicit = req.body?.lang || req.query?.lang;
  if (explicit && typeof explicit === "string") return explicit;
  if (chatId) {
    try {
      const rl = await store.getEffectiveReceiveLang(chatId, req.userId);
      if (rl) return rl;
    } catch {}
  }
  return req.user?.primaryLang || "en";
}

const aiController = {
  // ───────── Existing ─────────

  async smartReplies(req, res, next) {
    try {
      const { chatId } = req.params;
      const replies = await aiService.getSmartReplies(chatId, req.userId);
      res.json({ status: "success", data: { replies } });
    } catch (err) { next(err); }
  },

  async summarize(req, res, next) {
    try {
      const { chatId } = req.params;
      const summary = await aiService.summarizeChat(chatId, req.userId);
      res.json({ status: "success", data: { summary } });
    } catch (err) { next(err); }
  },

  async rewriteTone(req, res, next) {
    try {
      const { text, tone, lang } = req.body;
      if (!text?.trim()) throw ApiError.badRequest("Text is required");
      if (!tone) throw ApiError.badRequest("Tone is required");
      const result = await aiService.rewriteTone(text, tone, lang || "en");
      res.json({ status: "success", data: { original: text, rewritten: result, tone } });
    } catch (err) { next(err); }
  },

  async fixGrammar(req, res, next) {
    try {
      const { text, lang } = req.body;
      if (!text?.trim()) throw ApiError.badRequest("Text is required");
      const result = await aiService.fixGrammar(text, lang || "en");
      res.json({ status: "success", data: result });
    } catch (err) { next(err); }
  },

  // ───────── Part 3: Document intelligence ─────────

  /**
   * POST /api/ai/files/:fileId/summarize
   * Body: { lang?, chatId? }
   */
  async summarizeFile(req, res, next) {
    try {
      const { fileId } = req.params;
      if (!fileId) throw ApiError.badRequest("fileId required");
      const targetLang = await resolveTargetLang(req, req.body?.chatId);
      const result = await documentsService.summarizeFile(fileId, targetLang);
      res.json({ status: "success", data: result });
    } catch (err) {
      if (err.message === "File not found") return next(ApiError.notFound("File"));
      if (err.message?.startsWith("Unsupported document type")) return next(ApiError.badRequest(err.message));
      if (err.message?.includes("extraction failed")) return next(ApiError.badRequest(err.message));
      next(err);
    }
  },

  /**
   * POST /api/ai/files/:fileId/ask
   * Body: { question, lang?, chatId? }
   */
  async askFile(req, res, next) {
    try {
      const { fileId } = req.params;
      const { question } = req.body || {};
      if (!fileId) throw ApiError.badRequest("fileId required");
      if (!question?.trim()) throw ApiError.badRequest("Question is required");
      const targetLang = await resolveTargetLang(req, req.body?.chatId);
      const result = await documentsService.askFile(fileId, question, targetLang);
      res.json({ status: "success", data: result });
    } catch (err) {
      if (err.message === "File not found") return next(ApiError.notFound("File"));
      if (err.message?.startsWith("Unsupported document type")) return next(ApiError.badRequest(err.message));
      if (err.message?.includes("extraction failed")) return next(ApiError.badRequest(err.message));
      next(err);
    }
  },

  /**
   * POST /api/ai/files/:fileId/ocr
   * Body: { lang?, chatId? }
   */
  async ocrFile(req, res, next) {
    try {
      const { fileId } = req.params;
      if (!fileId) throw ApiError.badRequest("fileId required");
      const targetLang = await resolveTargetLang(req, req.body?.chatId);
      const result = await documentsService.ocrImage(fileId, targetLang);
      res.json({ status: "success", data: result });
    } catch (err) {
      if (err.message === "File not found") return next(ApiError.notFound("File"));
      if (err.message?.includes("OCR only supported")) return next(ApiError.badRequest(err.message));
      next(err);
    }
  },

  /**
   * GET /api/ai/chats/:chatId/tasks
   * Returns action items extracted from the last N messages.
   */
  async chatTasks(req, res, next) {
    try {
      const { chatId } = req.params;
      const tasks = await aiService.extractChatTasks(chatId, req.userId);
      res.json({ status: "success", data: { tasks } });
    } catch (err) {
      if (err.message === "Not a member") return next(ApiError.forbidden("Not a member"));
      next(err);
    }
  },
};

module.exports = aiController;
