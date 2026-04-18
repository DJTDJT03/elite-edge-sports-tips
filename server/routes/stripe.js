/**
 * Elite Edge Sports Tips — Stripe Routes
 *
 * Handles checkout session creation, success redirect,
 * webhooks, billing portal, and subscription status.
 */

module.exports = function(deps) {
  const router = require('express').Router();
  const { db, authenticate, stripeService } = deps;
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
      if (!plan || !['monthly', 'annual'].includes(plan)) {
        return res.status(400).json({ error: 'Invalid plan. Choose monthly or annual.' });
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

      // Update user to premium
      const stripeCustomerId = typeof session.customer === 'string'
        ? session.customer
        : (session.customer && session.customer.id) || null;
      const stripeSubscriptionId = typeof session.subscription === 'string'
        ? session.subscription
        : (session.subscription && session.subscription.id) || null;

      await db.updateUser(user.id, {
        subscription: 'premium',
        subscriptionExpiry: expiryDate.toISOString(),
        trialActive: false,
        stripeCustomerId: stripeCustomerId,
        stripeSubscriptionId: stripeSubscriptionId,
      });

      console.log('[Stripe] User upgraded to premium:', user.email, '— expires:', expiryDate.toISOString());
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
            const user = await db.getUserById(session.metadata.userId);
            if (user && user.subscription !== 'premium') {
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
              await db.updateUser(user.id, {
                subscription: 'premium',
                subscriptionExpiry: expiry.toISOString(),
                trialActive: false,
                stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
                stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : null,
              });
              console.log('[Stripe] Webhook: activated premium for', user.email);
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
              await db.updateUser(user.id, {
                subscription: 'premium',
                subscriptionExpiry: expiry.toISOString(),
              });
              console.log('[Stripe] Webhook: renewal success for', user.email, '— new expiry:', expiry.toISOString());
            }
          }
          break;
        }

        case 'customer.subscription.deleted': {
          // Subscription cancelled — downgrade to free
          const sub = event.data.object;
          const users = await db.getUsers();
          const user = users.find(u => u.stripeSubscriptionId === sub.id);
          if (user) {
            await db.updateUser(user.id, {
              subscription: 'free',
              stripeSubscriptionId: null,
            });
            console.log('[Stripe] Webhook: subscription cancelled for', user.email);
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
            const status = sub.cancel_at_period_end ? user.subscription : 'premium';
            await db.updateUser(user.id, {
              subscription: status,
              subscriptionExpiry: expiry.toISOString(),
            });
            console.log('[Stripe] Webhook: subscription updated for', user.email);
          }
          break;
        }

        case 'invoice.payment_failed': {
          // Payment failed — log and notify
          const invoice = event.data.object;
          const users = await db.getUsers();
          const user = users.find(u => u.stripeSubscriptionId === invoice.subscription);
          if (user) {
            console.log('[Stripe] Webhook: payment failed for', user.email);
            // Could send email notification here via emailService
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

  return router;
};
