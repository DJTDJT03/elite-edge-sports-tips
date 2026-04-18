/**
 * Elite Edge Sports Tips — Stripe Service
 *
 * Handles Stripe subscription payments: product/price creation,
 * checkout sessions, billing portal, webhooks, and subscription management.
 *
 * STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set as env vars.
 */

const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

class StripeService {
  constructor() {
    this.isAvailable = !!process.env.STRIPE_SECRET_KEY;
    if (this.isAvailable) {
      console.log('[Stripe] Configured');
    } else {
      console.log('[Stripe] No STRIPE_SECRET_KEY — payments disabled');
    }
    this._priceIds = null; // cached after first lookup/creation
  }

  /**
   * Lazily creates or retrieves the Elite Edge product and price IDs.
   * Caches result after first call.
   */
  async ensureProducts() {
    if (this._priceIds) return this._priceIds;
    if (!stripe) throw new Error('Stripe not configured');

    // Find or create the product
    let productId;
    const existingProducts = await stripe.products.list({ limit: 100 });
    const found = existingProducts.data.find(p => p.name === 'Elite Edge Premium');
    if (found) {
      productId = found.id;
      console.log('[Stripe] Found existing product:', productId);
    } else {
      const product = await stripe.products.create({
        name: 'Elite Edge Premium',
        description: 'Full access to all premium tips, analysis, and features',
      });
      productId = product.id;
      console.log('[Stripe] Created product:', productId);
    }

    // Find or create monthly price (£19.99/month)
    let monthlyPriceId;
    const existingPrices = await stripe.prices.list({ product: productId, limit: 100 });
    const monthlyPrice = existingPrices.data.find(
      p => p.active && p.recurring && p.recurring.interval === 'month' && p.unit_amount === 1999 && p.currency === 'gbp'
    );
    if (monthlyPrice) {
      monthlyPriceId = monthlyPrice.id;
      console.log('[Stripe] Found existing monthly price:', monthlyPriceId);
    } else {
      const mp = await stripe.prices.create({
        product: productId,
        unit_amount: 1999,
        currency: 'gbp',
        recurring: { interval: 'month' },
      });
      monthlyPriceId = mp.id;
      console.log('[Stripe] Created monthly price:', monthlyPriceId);
    }

    // Find or create annual price (£199.99/year)
    let annualPriceId;
    const annualPrice = existingPrices.data.find(
      p => p.active && p.recurring && p.recurring.interval === 'year' && p.unit_amount === 19999 && p.currency === 'gbp'
    );
    if (annualPrice) {
      annualPriceId = annualPrice.id;
      console.log('[Stripe] Found existing annual price:', annualPriceId);
    } else {
      const ap = await stripe.prices.create({
        product: productId,
        unit_amount: 19999,
        currency: 'gbp',
        recurring: { interval: 'year' },
      });
      annualPriceId = ap.id;
      console.log('[Stripe] Created annual price:', annualPriceId);
    }

    this._priceIds = { monthlyPriceId, annualPriceId, productId };
    return this._priceIds;
  }

  /**
   * Creates a Stripe Checkout session for a subscription.
   * @param {string} userId - Internal user ID
   * @param {string} userEmail - User email
   * @param {string} plan - 'monthly' or 'annual'
   * @param {string} successUrl - URL to redirect on success
   * @param {string} cancelUrl - URL to redirect on cancel
   */
  async createCheckoutSession(userId, userEmail, plan, successUrl, cancelUrl) {
    if (!stripe) throw new Error('Stripe not configured');

    const prices = await this.ensureProducts();
    const priceId = plan === 'annual' ? prices.annualPriceId : prices.monthlyPriceId;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: userEmail,
      metadata: { userId: userId },
      subscription_data: { trial_period_days: 0 },
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl + '?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
    });

    return session;
  }

  /**
   * Creates a billing portal session for managing subscription.
   * @param {string} customerId - Stripe customer ID
   * @param {string} returnUrl - URL to redirect after portal
   */
  async createPortalSession(customerId, returnUrl) {
    if (!stripe) throw new Error('Stripe not configured');

    return stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }

  /**
   * Processes Stripe webhook events.
   * @param {Buffer} payload - Raw request body
   * @param {string} sig - Stripe signature header
   * @returns {object} The verified event
   */
  async handleWebhook(payload, sig) {
    if (!stripe) throw new Error('Stripe not configured');

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET not configured');
    }

    const event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
    return event;
  }

  /**
   * Cancels a subscription at the end of the current period.
   * @param {string} subscriptionId - Stripe subscription ID
   */
  async cancelSubscription(subscriptionId) {
    if (!stripe) throw new Error('Stripe not configured');
    return stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
  }

  /**
   * Retrieves subscription details.
   * @param {string} subscriptionId - Stripe subscription ID
   */
  async getSubscription(subscriptionId) {
    if (!stripe) throw new Error('Stripe not configured');
    return stripe.subscriptions.retrieve(subscriptionId);
  }

  /**
   * Retrieves a checkout session by ID.
   * @param {string} sessionId - Stripe checkout session ID
   */
  async getCheckoutSession(sessionId) {
    if (!stripe) throw new Error('Stripe not configured');
    return stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });
  }
}

module.exports = new StripeService();
