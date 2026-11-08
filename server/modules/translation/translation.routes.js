const { Router } = require("express");
const { z } = require("zod");
const { validate } = require("../../middleware/validate");
const { authenticate } = require("../../middleware/authenticate");
const ctrl = require("./translation.controller");

const router = Router();
router.use(authenticate);

const LANGS = [
  "en","tr","es","fr","de","ja","zh","ar","ko","pt","ru","hi",
  "it","nl","pl","sv","da","fi","no","el","cs","ro","hu","th","vi","id","ms","uk",
];

router.post("/", validate(z.object({
  text: z.string().min(1).max(10000),
  sourceLang: z.enum(LANGS),
  targetLang: z.enum(LANGS),
})), ctrl.translateText);

router.post("/message/:messageId", validate(z.object({
  targetLang: z.enum(LANGS),
})), ctrl.translateMessage);

router.get("/message/:messageId", ctrl.getMessageTranslations);

module.exports = router;
