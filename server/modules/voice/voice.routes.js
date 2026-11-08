const { Router } = require("express");
const { authenticate } = require("../../middleware/authenticate");
const { voiceLimiter } = require("../../middleware/rateLimit");
const ctrl = require("./voice.controller");

const router = Router();

// Authenticated audio streaming (token can come from query string for <audio src>).
router.get("/audio/:audioId", authenticate, ctrl.getAudio);

// Upload + transcribe
router.post("/upload", authenticate, voiceLimiter, ctrl.uploadAudio);
router.post("/transcribe", authenticate, ctrl.transcribe);

// Feature C: Retranslate existing voice message transcript
router.post("/messages/:messageId/retranslate", authenticate, ctrl.retranslate);

// Feature D: Source language override + retranslate
router.post("/messages/:messageId/source-lang", authenticate, ctrl.overrideSourceLang);

module.exports = router;
