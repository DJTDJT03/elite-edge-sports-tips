/**
 * Elite Edge Sports Tips — Stripe Routes
 *
 * Handles checkout session creation, success redirect,
 * webhooks, billing portal, and subscription status.
 */

module.exports = function(deps) {
  const router = require('express').Router();
  const { db, authenticate, requireAdmin, stripeService, emailService } = deps;
  const express = require('express');

  // ---------------------------------------------------------------------------
  // POST /api/stripe/create-checkout — create a Stripe Checkout session
  // ---------------------------------------------------------------------------
  router.post('/stripe/create-checkout', authenticate, async (req, res) => {
    try {
      if (!stripeService.isAvailable) {
        return res.status(503).json({ error: 'Payment system not configured' });
      }

      const { plan } = req.body;
      if (!plan || !['starter-monthly', 'starter-annual', 'premium-monthly', 'premium-annual', 'vip-monthly', 'vip-annual'].includes(plan)) {
        return res.status(400).json({ error: 'Invalid plan.' });
      }

      const user = await db.getUserById(req.user.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Build success/cancel URLs
      const baseUrl = req.headers.origin || req.protocol + '://' + req.get('host');
      const successUrl = baseUrl + '/api/stripe/success';
      const cancelUrl = baseUrl + '/#/pricing';

      const session = await stripeService.createCheckoutSession(
        user.id,
        user.email,
        plan,
        successUrl,
        cancelUrl
      );

      console.log('[Stripe] Checkout session created for', user.email, '— plan:', plan);
      res.json({ url: session.url });
    } catch (err) {
      console.error('[Stripe] Checkout error:', err.message);
      res.status(500).json({ error: 'Unable to create checkout session' });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/stripe/success — handle successful checkout redirect
  // ---------------------------------------------------------------------------
  router.get('/stripe/success', async (req, res) => {
    try {
      const sessionId = req.query.session_id;
      if (!sessionId) {
        return res.redirect('/#/pricing?error=missing_session');
      }

      const session = await stripeService.getCheckoutSession(sessionId);
      if (!session || session.payment_status !== 'paid') {
        return res.redirect('/#/pricing?error=payment_incomplete');
      }

      // Find the user by metadata.userId or customer_email
      let user = null;
      if (session.metadata && session.metadata.userId) {
        user = await db.getUserById(session.metadata.userId);
      }
      if (!user && session.customer_email) {
        user = await db.getUserByEmail(session.customer_email);
      }

      if (!user) {
        console.error('[Stripe] Success callback: user not found for session', sessionId);
        return res.redirect('/#/pricing?error=user_not_found');
      }

      // Idempotency: check if this session was already processed
      if (user.stripeSubscriptionId) {
        var subId = typeof session.subscription === 'string' ? session.subscription : (session.subscription && session.subscription.id);
        if (user.stripeSubscriptionId === subId) {
          console.log('[Stripe] Success callback: session already processed for', user.email);
          return res.redirect('/#/account?upgraded=true');
        }
      }

      // Determine subscription period from the Stripe subscription
      const subscription = session.subscription;
      let expiryDate = new Date();
      if (subscription && subscription.current_period_end) {
        expiryDate = new Date(subscription.current_period_end * 1000);
      } else {
        // Fallback: check plan from price interval
        const lineItems = await require('stripe')(process.env.STRIPE_SECRET_KEY)
          .checkout.sessions.listLineItems(sessionId);
        const item = lineItems.data[0];
        if (item && item.price && item.price.recurring && item.price.recurring.interval === 'year') {
          expiryDate.setFullYear(expiryDate.getFullYear() + 1);
        } else {
          expiryDate.setMonth(expiryDate.getMonth() + 1);
        }
      }

      // Determine tier from session metadata (defaults to 'premium' for backward compat)
      const tier = (session.metadata && session.metadata.tier === 'vip') ? 'vip' : 'premium';

      // Update user subscription
      const stripeCustomerId = typeof session.customer === 'string'
        ? session.customer
        : (session.customer && session.customer.id) || null;
      const stripeSubscriptionId = typeof session.subscription === 'string'
        ? session.subscription
        : (session.subscription && session.subscription.id) || null;

      // Set monthly credit allowance based on tier
      var creditAllowance = tier === 'vip' ? 999999 : tier === 'premium' ? 250 : tier === 'starter' ? 50 : 0;
      var nextResetDate = new Date();
      nextResetDate.setMonth(nextResetDate.getMonth() + 1);

      // Detect if this is a trial signup (14-day trial via Stripe)
      var isTrial = session.metadata && session.metadata.isTrial === 'true';
      var subObj = session.subscription;
      var trialEndDate = null;
      if (typeof subObj === 'object' && subObj.trial_end) {
        trialEndDate = new Date(subObj.trial_end * 1000);
      } else if (isTrial) {
        trialEndDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      }

      // Win-back attribution: was this a churned subscriber coming back?
      var winbackFields = {};
      if (user.churnedAt) {
        winbackFields = {
          reactivatedAt: new Date().toISOString(),
          winbackReactivation: true,
          churnedAt: null,
          churnedTier: null,
          winbacksSent: [],
        };
        console.log('[Stripe] Win-back: churned user reactivated —', user.email, '(churned ' + user.churnedAt + ', offered ' + (user.churnedTier || '?') + ', returned ' + tier + ')');
      }

      await db.updateUser(user.id, Object.assign({
        subscription: tier,
        subscriptionExpiry: expiryDate.toISOString(),
        trialActive: !!trialEndDate,
        trialStart: trialEndDate ? new Date().toISOString() : undefined,
        trialEnd: trialEndDate ? trialEndDate.toISOString() : undefined,
        stripeCustomerId: stripeCustomerId,
        stripeSubscriptionId: stripeSubscriptionId,
        credits: creditAllowance,
        creditsMonthlyAllowance: creditAllowance,
        creditsResetDate: nextResetDate.toISOString().split('T')[0],
      }, winbackFields));

      // Record the credit grant
      await db.recordCreditTransaction({ userId: user.id, amount: creditAllowance, balanceAfter: creditAllowance, type: 'subscription_grant', description: tier + ' plan — ' + creditAllowance + ' monthly credits' });

      // Send trial confirmation email with charge date
      if (trialEndDate && emailService) {
        var chargeDate = trialEndDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        emailService.sendTrialConfirmation({
          name: user.name, email: user.email, tier: tier,
          trialEndDate: chargeDate,
          price: tier === 'vip' ? '£39.99' : '£19.99',
          portalUrl: 'https://eliteedgesports.co.uk/#/account',
        }).catch(function(err) { console.error('[Email] Trial confirmation failed:', err.message); });
      }

      console.log('[Stripe] User ' + (isTrial ? 'started 14-day trial' : 'upgraded') + ' to ' + tier + ':', user.email);
      res.redirect('/#/account?upgraded=true');
    } catch (err) {
      console.error('[Stripe] Success handler error:', err.message);
      res.redirect('/#/pricing?error=processing');
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/stripe/webhook — handle Stripe webhook events
  // IMPORTANT: This route receives raw body, not parsed JSON
  // ---------------------------------------------------------------------------
  router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
      if (!stripeService.isAvailable) {
        return res.status(503).send('Stripe not configured');
      }

      const sig = req.headers['stripe-signature'];
      if (!sig) {
        return res.status(400).send('Missing stripe-signature header');
      }

      let event;
      try {
        event = await stripeService.handleWebhook(req.body, sig);
      } catch (err) {
        console.error('[Stripe] Webhook signature verification failed:', err.message);
        return res.status(400).send('Webhook signature verification failed');
      }

      console.log('[Stripe] Webhook event:', event.type);

      switch (event.type) {
        case 'checkout.session.completed': {
          // This is handled by the success redirect, but also handle async payments
          const session = event.data.object;
          if (session.payment_status === 'paid' && session.metadata && session.metadata.userId) {
            const tier = (session.metadata.tier === 'vip') ? 'vip' : (session.metadata.tier === 'starter') ? 'starter' : 'premium';
            const user = await db.getUserById(session.metadata.userId);
            // Idempotency: skip if already processed this subscription
            var webhookSubId = typeof session.subscription === 'string' ? session.subscription : (session.subscription && session.subscription.id);
            if (user && user.stripeSubscriptionId === webhookSubId) {
              console.log('[Stripe] Webhook: checkout already processed for', user.email);
              break;
            }
            if (user && user.subscription !== tier) {
              const sub = session.subscription
                ? await stripeService.getSubscription(
                    typeof session.subscription === 'string' ? session.subscription : session.subscription.id
                  )
                : null;
              let expiry = new Date();
              if (sub && sub.current_period_end) {
                expiry = new Date(sub.current_period_end * 1000);
              } else {
                expiry.setMonth(expiry.getMonth() + 1);
              }
              // Win-back attribution (mirrors the success-redirect handler)
              var wbFields = {};
              if (user.churnedAt) {
                wbFields = {
                  reactivatedAt: new Date().toISOString(),
                  winbackReactivation: true,
                  churnedAt: null,
                  churnedTier: null,
                  winbacksSent: [],
                };
                console.log('[Stripe] Win-back (webhook): churned user reactivated —', user.email);
              }
              await db.updateUser(user.id, Object.assign({
                subscription: tier,
                subscriptionExpiry: expiry.toISOString(),
                trialActive: false,
                stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
                stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : null,
              }, wbFields));
              console.log('[Stripe] Webhook: activated ' + tier + ' for', user.email);
            }
          }
          break;
        }

        case 'invoice.payment_succeeded': {
          // Renewal successful — extend subscription expiry
          const invoice = event.data.object;
          if (invoice.subscription) {
            const sub = await stripeService.getSubscription(invoice.subscription);
            if (sub && sub.metadata && sub.metadata.userId) {
              // Not always available — try customer-based lookup
            }
            // Find user by stripeSubscriptionId
            const users = await db.getUsers();
            const user = users.find(u => u.stripeSubscriptionId === invoice.subscription);
            if (user && sub) {
              const expiry = new Date(sub.current_period_end * 1000);
              // Preserve the user's current tier on renewal (premium or vip)
              const currentTier = (user.subscription === 'vip') ? 'vip' : 'premium';
              await db.updateUser(user.id, {
                subscription: currentTier,
                subscriptionExpiry: expiry.toISOString(),
                // Clear any dunning flags on successful payment
                paymentFailedAt: null,
                paymentGraceEnd: null,
                dunningStage: 0,
              });
              console.log('[Stripe] Webhook: renewal success for', user.email, '(' + currentTier + ') — new expiry:', expiry.toISOString());
            }
          }
          break;
        }

        case 'customer.subscription.deleted': {
          // Subscription cancelled — downgrade to free + start win-back sequence
          const sub = event.data.object;
          const users = await db.getUsers();
          const user = users.find(u => u.stripeSubscriptionId === sub.id);
          if (user) {
            // Record the tier they're leaving from so the win-back offer can pitch it back
            var churnedTier = (user.subscription === 'vip' || user.subscription === 'premium' || user.subscription === 'starter')
              ? user.subscription
              : 'premium';
            await db.updateUser(user.id, {
              subscription: 'free',
              stripeSubscriptionId: null,
              churnedAt: new Date().toISOString(),
              churnedTier: churnedTier,
              winbacksSent: [],
            });
            console.log('[Stripe] Webhook: subscription cancelled for', user.email, '— win-back sequence armed (was ' + churnedTier + ')');
          }
          break;
        }

        case 'customer.subscription.updated': {
          // Plan changed
          const sub = event.data.object;
          const users = await db.getUsers();
          const user = users.find(u => u.stripeSubscriptionId === sub.id);
          if (user && sub.current_period_end) {
            const expiry = new Date(sub.current_period_end * 1000);
            // Preserve the user's current tier on update (premium or vip)
            const currentTier = (user.subscription === 'vip') ? 'vip' : 'premium';
            const status = sub.cancel_at_period_end ? user.subscription : currentTier;
            await db.updateUser(user.id, {
              subscription: status,
              subscriptionExpiry: expiry.toISOString(),
            });
            console.log('[Stripe] Webhook: subscription updated for', user.email);
          }
          break;
        }

        case 'invoice.payment_failed': {
          // Payment failed — send dunning email + set grace period
          const invoice = event.data.object;
          const users = await db.getUsers();
          const user = users.find(u => u.stripeSubscriptionId === invoice.subscription);
          if (user) {
            console.log('[Stripe] Webhook: payment failed for', user.email);

            // Set 3-day grace period — paymentFailedAt tracks when it first failed
            var gracePeriodEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
            await db.updateUser(user.id, {
              paymentFailedAt: new Date().toISOString(),
              paymentGraceEnd: gracePeriodEnd,
            });

            // Send dunning email with payment update link
            try {
              var portalUrl = 'https://eliteedgesports.co.uk/#/account';
              if (user.stripeCustomerId && stripeService.isAvailable) {
                try {
                  var portal = await stripeService.createPortalSession(user.stripeCustomerId, portalUrl);
                  portalUrl = portal.url;
                } catch (e) { /* fallback to account page */ }
              }
              await emailService.sendPaymentFailed({
                name: user.name, email: user.email, portalUrl: portalUrl,
              });
              console.log('[Stripe] Dunning email sent to', user.email, '— grace until', gracePeriodEnd);
            } catch (emailErr) {
              console.error('[Stripe] Dunning email failed:', emailErr.message);
            }
          }
          break;
        }
      }

      // Always return 200 to Stripe (prevents retries)
      res.json({ received: true });
    } catch (err) {
      console.error('[Stripe] Webhook processing error:', err.message);
      // Still return 200 to prevent Stripe retries on our errors
      res.json({ received: true });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/stripe/portal — open billing portal
  // ---------------------------------------------------------------------------
  router.post('/stripe/portal', authenticate, async (req, res) => {
    try {
      if (!stripeService.isAvailable) {
        return res.status(503).json({ error: 'Payment system not configured' });
      }

      const user = await db.getUserById(req.user.id);
      if (!user || !user.stripeCustomerId) {
        return res.status(400).json({ error: 'No billing account found. Please subscribe first.' });
      }

      const baseUrl = req.headers.origin || req.protocol + '://' + req.get('host');
      const returnUrl = baseUrl + '/#/account';

      const session = await stripeService.createPortalSession(user.stripeCustomerId, returnUrl);
      res.json({ url: session.url });
    } catch (err) {
      console.error('[Stripe] Portal error:', err.message);
      res.status(500).json({ error: 'Unable to open billing portal' });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/stripe/status — current subscription status
  // ---------------------------------------------------------------------------
  router.get('/stripe/status', authenticate, async (req, res) => {
    try {
      const user = await db.getUserById(req.user.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const result = {
        subscription: user.subscription,
        subscriptionExpiry: user.subscriptionExpiry,
        stripeCustomerId: user.stripeCustomerId || null,
        stripeSubscriptionId: user.stripeSubscriptionId || null,
        stripeStatus: null,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
      };

      // Fetch live status from Stripe if subscription exists
      if (user.stripeSubscriptionId && stripeService.isAvailable) {
        try {
          const sub = await stripeService.getSubscription(user.stripeSubscriptionId);
          result.stripeStatus = sub.status;
          result.cancelAtPeriodEnd = sub.cancel_at_period_end;
          result.currentPeriodEnd = sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null;
        } catch (e) {
          console.log('[Stripe] Could not fetch subscription status:', e.message);
        }
      }

      res.json(result);
    } catch (err) {
      console.error('[Stripe] Status error:', err.message);
      res.status(500).json({ error: 'Unable to fetch subscription status' });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/stripe/health — admin: confirm the secret key is valid + reachable
  // ---------------------------------------------------------------------------
  router.get('/stripe/health', authenticate, requireAdmin, async (req, res) => {
    var key = process.env.STRIPE_SECRET_KEY || '';
    if (!key) return res.json({ ok: false, configured: false, message: 'STRIPE_SECRET_KEY not set in environment' });
    var mode = key.indexOf('sk_live') === 0 ? 'live' : key.indexOf('sk_test') === 0 ? 'test' : 'unknown';
    try {
      var stripe = require('stripe')(key);
      // Lightweight authenticated call — fails immediately if the key is invalid
      var balance = await stripe.balance.retrieve();
      res.json({
        ok: true,
        configured: true,
        reachable: true,
        mode: mode,
        livemode: !!balance.livemode,
        webhookSecretSet: !!process.env.STRIPE_WEBHOOK_SECRET,
        message: 'Stripe key is valid and talking to Stripe (' + mode + ' mode).',
      });
    } catch (err) {
      res.json({
        ok: false,
        configured: true,
        reachable: false,
        mode: mode,
        webhookSecretSet: !!process.env.STRIPE_WEBHOOK_SECRET,
        error: err.message,
        message: 'Stripe rejected the key — it may be invalid, revoked, or rolled. Update STRIPE_SECRET_KEY in Railway.',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/stripe/buy-credits — one-time credit pack purchase
  // ---------------------------------------------------------------------------
  var CREDIT_PACKS = [
    { id: 'credits-3', credits: 3, amount: 199, label: '3 Credits — £1.99' },
    { id: 'credits-10', credits: 10, amount: 499, label: '10 Credits — £4.99' },
    { id: 'credits-25', credits: 25, amount: 899, label: '25 Credits — £8.99' },
  ];

  router.post('/stripe/buy-credits', authenticate, async (req, res) => {
    try {
      if (!stripeService.isAvailable) return res.status(503).json({ error: 'Payment system not configured' });

      var packId = req.body.pack;
      var pack = CREDIT_PACKS.find(function(p) { return p.id === packId; });
      if (!pack) return res.status(400).json({ error: 'Invalid credit pack' });

      var user = await db.getUserById(req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      var baseUrl = req.headers.origin || req.protocol + '://' + req.get('host');

      var stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      var session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: user.email,
        metadata: { userId: user.id, type: 'credit_purchase', credits: String(pack.credits), packId: pack.id },
        line_items: [{
          price_data: {
            currency: 'gbp',
            product_data: { name: pack.label },
            unit_amount: pack.amount,
          },
          quantity: 1,
        }],
        success_url: baseUrl + '/api/stripe/credits-success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: baseUrl + '/#/buy-credits',
      });

      res.json({ url: session.url });
    } catch (err) {
      console.error('[Stripe] Buy credits error:', err.message);
      res.status(500).json({ error: 'Unable to create checkout' });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/stripe/credits-success — credit pack purchase success
  // ---------------------------------------------------------------------------
  router.get('/stripe/credits-success', async (req, res) => {
    try {
      var sessionId = req.query.session_id;
      if (!sessionId) return res.redirect('/#/buy-credits?error=missing_session');

      var stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      var session = await stripe.checkout.sessions.retrieve(sessionId);
      if (!session || session.payment_status !== 'paid') return res.redirect('/#/buy-credits?error=payment_incomplete');

      var userId = session.metadata && session.metadata.userId;
      var credits = parseInt(session.metadata && session.metadata.credits) || 0;
      if (!userId || !credits) return res.redirect('/#/buy-credits?error=invalid');

      var user = await db.getUserById(userId);
      if (!user) return res.redirect('/#/buy-credits?error=user_not_found');

      // Add credits
      await db.addCredits(userId, credits, 'purchase', 'Purchased ' + credits + ' credits');

      console.log('[Stripe] Credit purchase: +' + credits + ' credits for ' + user.email);
      res.redirect('/#/account?credits_added=' + credits);
    } catch (err) {
      console.error('[Stripe] Credits success error:', err.message);
      res.redirect('/#/buy-credits?error=processing');
    }
  });

  return router;
};
