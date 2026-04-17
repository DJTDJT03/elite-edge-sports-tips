/**
 * Elite Edge Sports Tips — Alert Engine
 *
 * Checks conditions and triggers personalised in-app + email notifications
 * based on each user's alertPrefs settings.
 *
 * Supported alert types:
 *   - highConfidence: tip with confidence >= 9
 *   - bigOdds: tip with odds >= 6.0
 *   - newTips: every new tip published
 *   - steamers: odds movement steamer detected
 *   - preRace: 30-minute pre-race reminder
 */

class AlertEngine {
  constructor() {
    this.alertQueue = []; // pending alerts to send
    this.lastEmailSent = {}; // userId -> timestamp, for batching
    this.sentPreRaceAlerts = {}; // tipId -> Set of userIds, avoid duplicate pre-race alerts
  }

  /**
   * checkNewTip — called when a new tip is created/published
   * Checks highConfidence, bigOdds, and newTips preferences for each user.
   */
  async checkNewTip(tip, users, db, emailService) {
    if (!tip || !users || !Array.isArray(users)) return;

    for (var i = 0; i < users.length; i++) {
      var user = users[i];
      var prefs = user.alertPrefs || {};

      // High Confidence alert: confidence >= 9
      if (prefs.highConfidence && tip.confidence >= 9) {
        var hcMsg = 'Elite confidence tip just published: ' + (tip.selection || 'Unknown') + ' at ' + (tip.odds || '');
        this.alertQueue.push({
          userId: user.id,
          userEmail: user.email,
          userName: user.name,
          type: 'high_confidence',
          message: hcMsg,
          tipId: tip.id,
          channel: 'both', // in-app + email
        });
      }

      // Big Odds alert: odds >= 6.0
      if (prefs.bigOdds && tip.odds >= 6.0) {
        var edgePct = tip.edge ? (tip.edge * 100).toFixed(1) : '0.0';
        var boMsg = 'Big price selection: ' + (tip.selection || 'Unknown') + ' at ' + (tip.odds || '') + ' — ' + edgePct + '% edge';
        this.alertQueue.push({
          userId: user.id,
          userEmail: user.email,
          userName: user.name,
          type: 'big_odds',
          message: boMsg,
          tipId: tip.id,
          channel: 'both',
        });
      }

      // New Tips alert: every new tip
      if (prefs.newTips) {
        // Avoid duplicate if already queued via highConfidence or bigOdds
        var alreadyQueued = this.alertQueue.some(function(a) {
          return a.userId === user.id && a.tipId === tip.id;
        });
        if (!alreadyQueued) {
          var ntMsg = 'New tip published: ' + (tip.selection || 'Unknown');
          this.alertQueue.push({
            userId: user.id,
            userEmail: user.email,
            userName: user.name,
            type: 'new_tip',
            message: ntMsg,
            tipId: tip.id,
            channel: 'both',
          });
        }
      }
    }

    // Process queue immediately
    await this.processQueue(db, emailService);
  }

  /**
   * checkSteamer — called when odds movement tracker detects a steamer
   * In-app notification only (steamers are time-sensitive).
   */
  async checkSteamer(movementData, users, db) {
    if (!movementData || !users || !Array.isArray(users)) return;

    var runner = movementData.runner || movementData.selection || 'Unknown';
    var openPrice = movementData.openingPrice || movementData.open || '?';
    var currentPrice = movementData.currentPrice || movementData.current || '?';
    var changePct = movementData.changePercent || movementData.change || '?';

    for (var i = 0; i < users.length; i++) {
      var user = users[i];
      var prefs = user.alertPrefs || {};

      if (prefs.steamers) {
        var stMsg = 'STEAMER ALERT: ' + runner + ' shortening from ' + openPrice + ' to ' + currentPrice + ' (' + changePct + '%)';
        this.alertQueue.push({
          userId: user.id,
          type: 'steamer',
          message: stMsg,
          tipId: null,
          channel: 'inapp', // in-app only — steamers are time-sensitive
        });
      }
    }

    // Process in-app notifications immediately
    await this.processQueue(db, null);
  }

  /**
   * checkPreRace — called for tips with races starting in the next 30-35 minutes
   * In-app notification only.
   */
  async checkPreRace(tips, users, db) {
    if (!tips || !Array.isArray(tips) || tips.length === 0) return;
    if (!users || !Array.isArray(users)) return;

    for (var ti = 0; ti < tips.length; ti++) {
      var tip = tips[ti];

      // Initialize sent set for this tip if needed
      if (!this.sentPreRaceAlerts[tip.id]) {
        this.sentPreRaceAlerts[tip.id] = {};
      }

      for (var ui = 0; ui < users.length; ui++) {
        var user = users[ui];
        var prefs = user.alertPrefs || {};

        if (prefs.preRace) {
          // Avoid sending duplicate pre-race alerts
          if (this.sentPreRaceAlerts[tip.id][user.id]) continue;
          this.sentPreRaceAlerts[tip.id][user.id] = true;

          var meeting = tip.meeting || tip.venue || 'Unknown';
          var race = tip.event || tip.raceTime || '';
          var prMsg = '30 min to post: ' + (tip.selection || 'Unknown') + ' in ' + race + ' at ' + meeting + '. Our tip: ' + (tip.odds || '') + ', confidence ' + (tip.confidence || '?') + '/10';
          this.alertQueue.push({
            userId: user.id,
            type: 'pre_race',
            message: prMsg,
            tipId: tip.id,
            channel: 'inapp', // in-app only
          });
        }
      }
    }

    await this.processQueue(db, null);
  }

  /**
   * processQueue — sends all queued alerts
   * Creates in-app notifications immediately.
   * Batches email notifications (max 1 email per user per 15 min).
   */
  async processQueue(db, emailService) {
    if (this.alertQueue.length === 0) return;

    var queue = this.alertQueue.slice();
    this.alertQueue = [];

    var now = Date.now();
    var EMAIL_COOLDOWN = 15 * 60 * 1000; // 15 minutes

    for (var i = 0; i < queue.length; i++) {
      var alert = queue[i];

      // 1. Always create in-app notification
      try {
        await db.createNotification({
          id: 'alert_' + Date.now() + '_' + i,
          type: alert.type || 'alert',
          message: alert.message,
          tipId: alert.tipId || null,
          timestamp: new Date().toISOString(),
        });
      } catch (e) {
        console.error('[AlertEngine] Failed to create notification:', e.message);
      }

      // 2. Send email if channel allows and cooldown has passed
      if (alert.channel === 'both' && emailService && alert.userEmail) {
        var lastSent = this.lastEmailSent[alert.userId] || 0;
        if (now - lastSent > EMAIL_COOLDOWN) {
          try {
            await emailService.sendGeneric({
              to: alert.userEmail,
              subject: 'Elite Edge Alert: ' + (alert.type || '').replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); }),
              text: 'Hi ' + (alert.userName || 'there') + ',\n\n' + alert.message + '\n\nView your tips at https://eliteedgesports.co.uk\n\n— Elite Edge Sports Tips',
            });
            this.lastEmailSent[alert.userId] = now;
          } catch (e) {
            console.error('[AlertEngine] Failed to send alert email to ' + alert.userEmail + ':', e.message);
          }
        }
      }
    }

    // Clean up old sentPreRaceAlerts (entries older than 2 hours)
    var alertKeys = Object.keys(this.sentPreRaceAlerts);
    if (alertKeys.length > 100) {
      // Keep only the most recent 50
      var toRemove = alertKeys.slice(0, alertKeys.length - 50);
      for (var ri = 0; ri < toRemove.length; ri++) {
        delete this.sentPreRaceAlerts[toRemove[ri]];
      }
    }
  }
}

// Export singleton
module.exports = new AlertEngine();
