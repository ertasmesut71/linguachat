const { Router } = require("express");
const { z } = require("zod");
const { validate } = require("../../middleware/validate");
const { authenticate } = require("../../middleware/authenticate");
const ctrl = require("./admin.controller");

const router = Router();
router.use(authenticate);

const userIdSchema = z.object({ userId: z.string().uuid() });

router.post("/:chatId/promote", validate(userIdSchema), ctrl.promote);
router.post("/:chatId/demote", validate(userIdSchema), ctrl.demote);
router.post("/:chatId/mute", validate(userIdSchema), ctrl.mute);
router.post("/:chatId/unmute", validate(userIdSchema), ctrl.unmute);
router.delete("/:chatId/members/:userId", ctrl.kick);
router.delete("/:chatId/messages/:messageId", ctrl.deleteMessage);

module.exports = router;
