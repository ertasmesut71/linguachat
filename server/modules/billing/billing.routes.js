const express = require("express");
const { authenticate } = require("../../middleware/authenticate");
const billingController = require("./billing.controller");

const router = express.Router();

router.post("/create-checkout-session", authenticate, billingController.createCheckoutSession);

// Stripe signs the exact bytes it sends, so this route needs the raw body.
// index.js also registers express.raw for this path before the global JSON parser.
router.post("/webhook", express.raw({ type: "application/json" }), billingController.webhook);

module.exports = router;
