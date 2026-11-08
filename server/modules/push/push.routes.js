const { Router } = require("express");
const { authenticate } = require("../../middleware/authenticate");
const controller = require("./push.controller");

const router = Router();

// All push endpoints require authentication — a device must identify who
// it belongs to before it can receive targeted notifications.
router.get("/vapid-public-key", authenticate, controller.getVapidPublicKey);
router.post("/subscribe", authenticate, controller.subscribe);
router.delete("/subscribe", authenticate, controller.unsubscribe);

module.exports = router;
