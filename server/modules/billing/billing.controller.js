const billingService = require("./billing.service");

const billingController = {
  /**
   * POST /api/billing/create-checkout-session
   */
  async createCheckoutSession(req, res, next) {
    try {
      const session = await billingService.createCheckoutSession(req.userId, req.user?.email || null);
      res.json({ status: "success", data: session });
    } catch (err) { next(err); }
  },

  /**
   * POST /api/billing/webhook — called by Stripe, body must be raw.
   */
  async webhook(req, res, next) {
    try {
      const result = await billingService.handleWebhook(req.body, req.headers["stripe-signature"]);
      res.json(result);
    } catch (err) { next(err); }
  },
};

module.exports = billingController;
