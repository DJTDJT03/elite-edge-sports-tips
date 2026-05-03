/**
 * Elite Edge Sports Tips — Web Push Notification Service
 *
 * Sends browser push notifications via the Web Push API.
 * Requires VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY env vars.
 *
 * Generate VAPID keys: npx web-push generate-vapid-keys
 */

'use strict';

var webpush = null;

try {
  webpush = require('web-push');
} catch(e) {
  // web-push not installed — push disabled
}

class PushService {
  constructor() {
    this.isAvailable = !!(webpush && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

    if (this.isAvailable) {
      webpush.setVapidDetails(
        'mailto:' + (process.env.ADMIN_EMAIL || 'contact@eliteedgesports.co.uk'),
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
      );
      console.log('[Push] Web Push configured');
    } else {
      console.log('[Push] Web Push not configured — set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY');
    }
  }

  get publicKey() {
    return process.env.VAPID_PUBLIC_KEY || '';
  }

  /**
   * Send a push notification to a subscription.
   * @param {object} subscription - PushSubscription object {endpoint, keys: {p256dh, auth}}
   * @param {object} payload - {title, body, url, icon, tag}
   */
  async send(subscription, payload) {
    if (!this.isAvailable || !webpush) return false;
    if (!subscription || !subscription.endpoint) return false;

    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      return true;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Subscription expired or invalid — should be removed from DB
        return 'expired';
      }
      console.error('[Push] Send failed:', err.message);
      return false;
    }
  }

  /**
   * Send to all subscriptions for a user.
   * @param {object} db - Database module
   * @param {string} userId - User ID
   * @param {object} payload - Notification payload
   */
  async sendToUser(db, userId, payload) {
    if (!this.isAvailable) return;
    var subs = await db.getPushSubscriptions(userId);
    for (var i = 0; i < subs.length; i++) {
      var result = await this.send(subs[i].subscription, payload);
      if (result === 'expired') {
        await db.removePushSubscription(subs[i].id);
      }
    }
  }

  /**
   * Broadcast to all subscribers.
   * @param {object} db - Database module
   * @param {object} payload - Notification payload
   * @param {string} [audience] - 'all', 'premium', 'vip'
   */
  async broadcast(db, payload, audience) {
    if (!this.isAvailable) return;
    var subs = await db.getAllPushSubscriptions(audience);
    var sent = 0;
    var expired = 0;
    for (var i = 0; i < subs.length; i++) {
      var result = await this.send(subs[i].subscription, payload);
      if (result === true) sent++;
      if (result === 'expired') {
        await db.removePushSubscription(subs[i].id);
        expired++;
      }
    }
    if (sent > 0) console.log('[Push] Broadcast: ' + sent + ' sent, ' + expired + ' expired');
  }
}

module.exports = new PushService();
