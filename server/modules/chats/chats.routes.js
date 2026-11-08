const { Router } = require("express");
const { z } = require("zod");
const { validate } = require("../../middleware/validate");
const { authenticate } = require("../../middleware/authenticate");
const ctrl = require("./chats.controller");

const router = Router();
router.use(authenticate);

const LANGS = [
  "en","tr","es","fr","de","ja","zh","ar","ko","pt","ru","hi",
  "it","nl","pl","sv","da","fi","no","el","cs","ro","hu","th","vi","id","ms","uk",
];

// Pack G: Mark all chats as read (before /:id routes to avoid conflict)
router.post("/read-all", ctrl.markAllRead);

// Pack H: Saved Messages / Self-chat
router.post("/self", ctrl.createSelfChat);

// Pack C: Custom Lists
router.get("/lists", ctrl.listCustomLists);
router.post("/lists", validate(z.object({ name: z.string().min(1).max(100) })), ctrl.createCustomList);
router.patch("/lists/:listId", validate(z.object({ name: z.string().min(1).max(100) })), ctrl.renameCustomList);
router.delete("/lists/:listId", ctrl.deleteCustomList);
router.post("/lists/:listId/chats", validate(z.object({ chatId: z.string().uuid() })), ctrl.addChatToList);
router.delete("/lists/:listId/chats/:chatId", ctrl.removeChatFromList);

router.get("/", ctrl.listChats);
router.post("/direct", validate(z.object({ otherUserId: z.string().uuid() })), ctrl.createDirectChat);

router.post("/group", validate(z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  memberIds: z.array(z.string().uuid()).min(1).max(100),
})), ctrl.createGroupChat);

router.get("/:id", ctrl.getChat);
router.patch("/:id", validate(z.object({
  name: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  // Pack E: disappearing messages (null=off, seconds value for timer)
  disappearingTimer: z.number().int().nullable().optional(),
})), ctrl.updateChat);
router.post("/:id/read", ctrl.markRead);

router.get("/:id/my-settings", ctrl.getMySettings);
router.patch("/:id/my-settings", validate(z.object({
  receiveLang: z.enum(LANGS).optional(),
  autoTranslate: z.boolean().optional(),
  muted: z.boolean().optional(),
  // Pack A: archive
  archived: z.boolean().optional(),
  // Pack B: favorite
  favorited: z.boolean().optional(),
})), ctrl.updateMySettings);

router.post("/:id/members", validate(z.object({ userId: z.string().uuid() })), ctrl.addMember);
router.delete("/:id/members/:userId", ctrl.removeMember);

module.exports = router;
