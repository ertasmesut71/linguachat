const { Router } = require("express");
const { z } = require("zod");
const { validate } = require("../../middleware/validate");
const { authenticate } = require("../../middleware/authenticate");
const ctrl = require("./messages.controller");

const router = Router();
router.use(authenticate);

router.post("/chats/:chatId/messages", validate(z.object({
  content: z.string().max(10000).default(""),
  type: z.enum(["text", "voice", "image", "video", "file", "system"]).default("text"),
  metadata: z.record(z.any()).optional().default({}),
  replyToId: z.string().uuid().optional().nullable(),
})), ctrl.sendMessage);

router.get("/chats/:chatId/messages", ctrl.listMessages);
router.post("/chats/:chatId/seen", ctrl.markAllSeen);
router.post("/messages/:messageId/seen", ctrl.markSeen);
router.delete("/messages/:messageId", ctrl.deleteMessage);
router.post("/messages/:messageId/hide", ctrl.hideMessageForMe);

// ─── Feature A: Starred Messages ───
router.post("/messages/:messageId/star", ctrl.starMessage);
router.delete("/messages/:messageId/star", ctrl.unstarMessage);
router.get("/starred", ctrl.getStarredMessages);

// ─── Feature B: Pinned Messages ───
router.post("/chats/:chatId/pin", ctrl.pinMessage);
router.delete("/chats/:chatId/pin/:messageId", ctrl.unpinMessage);
router.get("/chats/:chatId/pinned", ctrl.getPinnedMessages);

// ─── Feature C: Edit Message ───
router.patch("/messages/:messageId", validate(z.object({
  content: z.string().min(1).max(10000),
})), ctrl.editMessage);

// ─── Feature E: Bulk Actions ───
router.post("/messages/bulk", validate(z.object({
  messageIds: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(["star", "unstar", "delete_for_me"]),
})), ctrl.bulkAction);

// ─── Feature F: Clear Chat ───
router.post("/chats/:chatId/clear", ctrl.clearChat);

// ─── Feature G: Delete Chat (user-local) ───
router.delete("/chats/:chatId/local", ctrl.deleteLocalChat);

module.exports = router;
