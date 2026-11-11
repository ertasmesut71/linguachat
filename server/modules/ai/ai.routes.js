const { Router } = require("express");
const { z } = require("zod");
const { validate } = require("../../middleware/validate");
const { authenticate } = require("../../middleware/authenticate");
const { requirePremium } = require("../../middleware/requirePremium");
const ctrl = require("./ai.controller");

const router = Router();
router.use(authenticate);

// ─── Existing routes (preserved) ───

router.get("/chats/:chatId/smart-replies", ctrl.smartReplies);
router.get("/chats/:chatId/summary", ctrl.summarize);

router.post("/rewrite", validate(z.object({
  text: z.string().min(1).max(5000),
  tone: z.enum(["formal", "casual", "professional", "enthusiastic", "concise", "polite", "friendly", "warm"]),
  lang: z.string().min(2).max(10).optional(),
})), ctrl.rewriteTone);

router.post("/grammar", validate(z.object({
  text: z.string().min(1).max(5000),
  lang: z.string().min(2).max(10).optional(),
})), ctrl.fixGrammar);

// ─── Part 3: Document intelligence ───

router.post("/files/:fileId/summarize", validate(z.object({
  lang: z.string().min(2).max(10).optional(),
  chatId: z.string().uuid().optional(),
})), ctrl.summarizeFile);

router.post("/files/:fileId/ask", validate(z.object({
  question: z.string().min(1).max(5000),
  lang: z.string().min(2).max(10).optional(),
  chatId: z.string().uuid().optional(),
})), ctrl.askFile);

router.post("/files/:fileId/ocr", validate(z.object({
  lang: z.string().min(2).max(10).optional(),
  chatId: z.string().uuid().optional(),
})), ctrl.ocrFile);

router.get("/chats/:chatId/tasks", ctrl.chatTasks);

module.exports = router;
