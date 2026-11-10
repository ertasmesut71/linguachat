const Stripe = require("stripe");
const store = require("../../db/store");
const ApiError = require("../../utils/ApiError");

const SUCCESS_URL = "https://linguachat.onrender.com/payment/success?session_id={CHECKOUT_SESSION_ID}";
const CANCEL_URL = "https://linguachat.onrender.com/payment/cancel";

let stripeClient = null;

// Created on first use so the server still boots when Stripe is not configured.
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw ApiError.unavailable("Billing is not configured");
  if (!stripeClient) stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

class BillingService {
  /**
   * Start a Stripe Checkout session for the personal subscription.
   * The userId is stored on the session and on the subscription so the
   * webhook can find the user again.
   * @returns {{ id: string, url: string }}
   */
  async createCheckoutSession(userId, email) {
    if (!process.env.STRIPE_PRICE_PERSONAL) throw ApiError.unavailable("Billing is not configured");
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRICE_PERSONAL, quantity: 1 }],
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      client_reference_id: userId,
      ...(email ? { customer_email: email } : {}),
      metadata: { userId },
      subscription_data: { metadata: { userId } },
    });
    return { id: session.id, url: session.url };
  }

  /**
   * Verify and handle a Stripe webhook event.
   * @param {Buffer} rawBody   the unparsed request body
   * @param {string} signature the Stripe-Signature header
   * @returns {{ received: true, type: string, handled: boolean }}
   */
  async handleWebhook(rawBody, signature) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw ApiError.unavailable("Billing webhook is not configured");
    if (!signature) throw ApiError.badRequest("Missing Stripe signature");

    let event;
    try {
      event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      throw ApiError.badRequest(`Webhook signature verification failed: ${err.message}`);
    }

    const statusByEvent = {
      "customer.subscription.created": "active",
      "customer.subscription.deleted": "free",
    };
    const newStatus = statusByEvent[event.type];
    if (!newStatus) return { received: true, type: event.type, handled: false };

    const userId = event.data?.object?.metadata?.userId;
    if (!userId) return { received: true, type: event.type, handled: false };

    await store.updateUser(userId, { subscriptionStatus: newStatus });
    return { received: true, type: event.type, handled: true };
  }
}

module.exports = new BillingService();
