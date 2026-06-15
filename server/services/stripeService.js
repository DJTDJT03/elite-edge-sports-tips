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
   * Lazily creates or retrieves the Elite Edge products and price IDs.
   * Caches result after first call.
   * Returns: { premiumMonthlyId, premiumAnnualId, vipMonthlyId, vipAnnualId, premiumProductId, vipProductId }
   */
  async ensureProducts() {
    if (this._priceIds) return this._priceIds;
    if (!stripe) throw new Error('Stripe not configured');

    const existingProducts = await stripe.products.list({ limit: 100 });

    // --- Premium product (£19.99/month, £199.99/year) ---
    let premiumProductId;
    const foundPremium = existingProducts.data.find(p => p.name === 'Elite Edge Premium');
    if (foundPremium) {
      premiumProductId = foundPremium.id;
      console.log('[Stripe] Found existing Premium product:', premiumProductId);
    } else {
      const product = await stripe.products.create({
        name: 'Elite Edge Premium',
        description: 'Full access to all premium tips, analysis, and features',
      });
      premiumProductId = product.id;
      console.log('[Stripe] Created Premium product:', premiumProductId);
    }

    const premiumPrices = await stripe.prices.list({ product: premiumProductId, limit: 100 });

    let premiumMonthlyId;
    const pmPrice = premiumPrices.data.find(
      p => p.active && p.recurring && p.recurring.interval === 'month' && p.unit_amount === 1999 && p.currency === 'gbp'
    );
    if (pmPrice) {
      premiumMonthlyId = pmPrice.id;
      console.log('[Stripe] Found existing Premium monthly price:', premiumMonthlyId);
    } else {
      const mp = await stripe.prices.create({
        product: premiumProductId, unit_amount: 1999, currency: 'gbp', recurring: { interval: 'month' },
      });
      premiumMonthlyId = mp.id;
      console.log('[Stripe] Created Premium monthly price:', premiumMonthlyId);
    }

    let premiumAnnualId;
    const paPrice = premiumPrices.data.find(
      p => p.active && p.recurring && p.recurring.interval === 'year' && p.unit_amount === 19999 && p.currency === 'gbp'
    );
    if (paPrice) {
      premiumAnnualId = paPrice.id;
      console.log('[Stripe] Found existing Premium annual price:', premiumAnnualId);
    } else {
      const ap = await stripe.prices.create({
        product: premiumProductId, unit_amount: 19999, currency: 'gbp', recurring: { interval: 'year' },
      });
      premiumAnnualId = ap.id;
      console.log('[Stripe] Created Premium annual price:', premiumAnnualId);
    }

    // --- Starter product (£9.99/month, £99.99/year) ---
    let starterProductId;
    const foundStarter = existingProducts.data.find(p => p.name === 'Elite Edge Starter');
    if (foundStarter) {
      starterProductId = foundStarter.id;
      console.log('[Stripe] Found existing Starter product:', starterProductId);
    } else {
      const product = await stripe.products.create({
        name: 'Elite Edge Starter',
        description: '3 daily tips with selection and odds across multiple sports',
      });
      starterProductId = product.id;
      console.log('[Stripe] Created Starter product:', starterProductId);
    }

    const starterPrices = await stripe.prices.list({ product: starterProductId, limit: 100 });

    let starterMonthlyId;
    const smPrice = starterPrices.data.find(
      p => p.active && p.recurring && p.recurring.interval === 'month' && p.unit_amount === 999 && p.currency === 'gbp'
    );
    if (smPrice) {
      starterMonthlyId = smPrice.id;
    } else {
      const mp = await stripe.prices.create({
        product: starterProductId, unit_amount: 999, currency: 'gbp', recurring: { interval: 'month' },
      });
      starterMonthlyId = mp.id;
    }

    let starterAnnualId;
    const saPrice = starterPrices.data.find(
      p => p.active && p.recurring && p.recurring.interval === 'year' && p.unit_amount === 9999 && p.currency === 'gbp'
    );
    if (saPrice) {
      starterAnnualId = saPrice.id;
    } else {
      const ap = await stripe.prices.create({
        product: starterProductId, unit_amount: 9999, currency: 'gbp', recurring: { interval: 'year' },
      });
      starterAnnualId = ap.id;
    }
    console.log('[Stripe] Starter prices ready');

    // --- VIP product (£39.99/month, £399.99/year) ---
    let vipProductId;
    const foundVip = existingProducts.data.find(p => p.name === 'Elite Edge VIP');
    if (foundVip) {
      vipProductId = foundVip.id;
      console.log('[Stripe] Found existing VIP product:', vipProductId);
    } else {
      const product = await stripe.products.create({
        name: 'Elite Edge VIP',
        description: 'Elite VIP access with early tips, AI replay analysis, and priority support',
      });
      vipProductId = product.id;
      console.log('[Stripe] Created VIP product:', vipProductId);
    }

    const vipPrices = await stripe.prices.list({ product: vipProductId, limit: 100 });

    let vipMonthlyId;
    const vmPrice = vipPrices.data.find(
      p => p.active && p.recurring && p.recurring.interval === 'month' && p.unit_amount === 3999 && p.currency === 'gbp'
    );
    if (vmPrice) {
      vipMonthlyId = vmPrice.id;
      console.log('[Stripe] Found existing VIP monthly price:', vipMonthlyId);
    } else {
      const mp = await stripe.prices.create({
        product: vipProductId, unit_amount: 3999, currency: 'gbp', recurring: { interval: 'month' },
      });
      vipMonthlyId = mp.id;
      console.log('[Stripe] Created VIP monthly price:', vipMonthlyId);
    }

    let vipAnnualId;
    const vaPrice = vipPrices.data.find(
      p => p.active && p.recurring && p.recurring.interval === 'year' && p.unit_amount === 39999 && p.currency === 'gbp'
    );
    if (vaPrice) {
      vipAnnualId = vaPrice.id;
      console.log('[Stripe] Found existing VIP annual price:', vipAnnualId);
    } else {
      const ap = await stripe.prices.create({
        product: vipProductId, unit_amount: 39999, currency: 'gbp', recurring: { interval: 'year' },
      });
      vipAnnualId = ap.id;
      console.log('[Stripe] Created VIP annual price:', vipAnnualId);
    }

    this._priceIds = { starterMonthlyId, starterAnnualId, premiumMonthlyId, premiumAnnualId, vipMonthlyId, vipAnnualId, starterProductId, premiumProductId, vipProductId };
    return this._priceIds;
  }

  /**
   * Creates a Stripe Checkout session for a subscription.
   * @param {string} userId - Internal user ID
   * @param {string} userEmail - User email
   * @param {string} plan - 'starter-monthly', 'starter-annual', 'premium-monthly', 'premium-annual', 'vip-monthly', or 'vip-annual'
   * @param {string} successUrl - URL to redirect on success
   * @param {string} cancelUrl - URL to redirect on cancel
   */
  async createCheckoutSession(userId, userEmail, plan, successUrl, cancelUrl) {
    if (!stripe) throw new Error('Stripe not configured');

    const prices = await this.ensureProducts();
    const priceMap = {
      'starter-monthly': prices.starterMonthlyId,
      'starter-annual': prices.starterAnnualId,
      'premium-monthly': prices.premiumMonthlyId,
      'premium-annual': prices.premiumAnnualId,
      'vip-monthly': prices.vipMonthlyId,
      'vip-annual': prices.vipAnnualId,
    };
    const priceId = priceMap[plan];
    if (!priceId) throw new Error('Invalid plan: ' + plan);

    const tier = plan.startsWith('vip') ? 'vip' : plan.startsWith('starter') ? 'starter' : 'premium';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: userEmail,
      metadata: { userId: userId, tier: tier },
      subscription_data: {},
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

  /**
   * Reconciliation: given an email, find their live Stripe subscription and
   * work out which tier they're actually paying for. Used to fix accounts where
   * payment succeeded but provisioning (webhook/redirect) didn't run.
   * @returns {object|null} { tier, subscriptionId, customerId, currentPeriodEnd, status, priceId } or null
   */
  /**
   * Maps a Stripe subscription object to our tier via its price ID.
   * @returns {'starter'|'premium'|'vip'|null}
   */
  async tierFromSubscription(sub) {
    if (!sub) return null;
    const priceId = sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id;
    if (!priceId) return null;
    const prices = await this.ensureProducts();
    if (priceId === prices.vipMonthlyId || priceId === prices.vipAnnualId) return 'vip';
    if (priceId === prices.starterMonthlyId || priceId === prices.starterAnnualId) return 'starter';
    if (priceId === prices.premiumMonthlyId || priceId === prices.premiumAnnualId) return 'premium';
    return null;
  }

  async findSubscriptionByEmail(email) {
    if (!stripe) throw new Error('Stripe not configured');
    const customers = await stripe.customers.list({ email: email, limit: 20 });
    const prices = await this.ensureProducts();
    for (const c of customers.data) {
      const subs = await stripe.subscriptions.list({ customer: c.id, status: 'all', limit: 20 });
      const live = subs.data.find(function (s) { return ['active', 'trialing', 'past_due'].includes(s.status); });
      if (!live) continue;
      const priceId = live.items && live.items.data[0] && live.items.data[0].price && live.items.data[0].price.id;
      let tier = 'premium';
      if (priceId === prices.vipMonthlyId || priceId === prices.vipAnnualId) tier = 'vip';
      else if (priceId === prices.starterMonthlyId || priceId === prices.starterAnnualId) tier = 'starter';
      else if (priceId === prices.premiumMonthlyId || priceId === prices.premiumAnnualId) tier = 'premium';
      return { tier: tier, subscriptionId: live.id, customerId: c.id, currentPeriodEnd: live.current_period_end, status: live.status, priceId: priceId };
    }
    return null;
  }
}

module.exports = new StripeService();
