/**
 * Elite Edge Sports Tips — Win-Back Campaign Service
 *
 * Three-step automated sequence for subscribers who have cancelled, aimed at
 * recovering lost revenue. Mirrors the dripCampaign.js pattern.
 *
 *   Day 1   — Goodbye: gracious, door left open, feedback ask
 *   Day 7   — What you've missed: this week's results
 *   Day 21  — The offer: discount code to tempt them back
 *
 * Churn is captured in routes/stripe.js (customer.subscription.deleted), which
 * stamps churnedAt + churnedTier and resets winbacksSent. Reactivation clears
 * churnedAt, so a returning subscriber automatically drops out of the sequence.
 *
 * Called every 15 minutes by the scheduler.
 */

class WinbackCampaign {
  constructor() {
    // Days since churn -> which email to send
    this.sequence = [
      { day: 1, type: 'goodbye' },
      { day: 7, type: 'missing' },
      { day: 21, type: 'offer' },
    ];

    // Offer configurable without a deploy. The matching coupon/promotion code
    // must exist in the Stripe dashboard (promotion codes are enabled at checkout).
    this.promoCode = process.env.WINBACK_PROMO_CODE || 'WELCOMEBACK';
    this.offerText = process.env.WINBACK_OFFER_TEXT || '50% off your first month';
    this.resubUrl = 'https://eliteedgesports.co.uk/#/pricing';
  }

  // ---------------------------------------------------------------------------
  // Main entry point — called every 15 minutes by scheduler
  // ---------------------------------------------------------------------------
  async checkAndSend(users, db, emailService) {
    if (!users || !Array.isArray(users)) return;

    var now = Date.now();
    var dayMs = 24 * 60 * 60 * 1000;

    // Gather this week's results once — reused for the day-7 "missing" email.
    var recentResults = [];
    var recentWon = [];
    var recentProfit = 0;
    var bigWinner = null;
    try {
      var allResults = await db.getResults();
      recentResults = (allResults || []).filter(function (r) {
        return (now - new Date(r.date).getTime()) < 7 * dayMs;
      });
      recentWon = recentResults.filter(function (r) { return r.result === 'won'; });
      recentProfit = recentResults.reduce(function (sum, r) { return sum + (r.pnl > 0 ? r.pnl : 0); }, 0);
      bigWinner = recentWon.slice().sort(function (a, b) { return (b.odds || 0) - (a.odds || 0); })[0] || null;
    } catch (e) {
      console.error('[Winback] Could not load results for "missing" email:', e.message);
    }

    var sentCount = 0;

    for (var i = 0; i < users.length; i++) {
      var user = users[i];

      // Only target genuinely churned subscribers still on the free plan.
      if (!user.churnedAt) continue;
      if (user.subscription !== 'free') continue;   // resubscribed — clears via stripe webhook
      if (user.trialActive) continue;
      if (user.role === 'admin') continue;
      if (user.emailPrefs && user.emailPrefs.marketing === false) continue;

      var churnDate = new Date(user.churnedAt);
      if (isNaN(churnDate.getTime())) continue;

      var daysSinceChurn = Math.floor((now - churnDate.getTime()) / dayMs);
      var winbacksSent = user.winbacksSent || [];

      for (var s = 0; s < this.sequence.length; s++) {
        var step = this.sequence[s];

        if (daysSinceChurn < step.day) continue;          // not due yet
        if (winbacksSent.indexOf(step.type) !== -1) continue; // already sent

        try {
          if (step.type === 'goodbye') {
            await emailService.sendWinbackGoodbye({
              name: user.name, email: user.email, resubUrl: this.resubUrl,
            });
          } else if (step.type === 'missing') {
            await emailService.sendWinbackMissing({
              name: user.name, email: user.email,
              tipsPublished: recentResults.length,
              winners: recentWon.length,
              profit: recentProfit,
              bigWinner: bigWinner,
              resubUrl: this.resubUrl,
            });
          } else if (step.type === 'offer') {
            await emailService.sendWinbackOffer({
              name: user.name, email: user.email,
              promoCode: this.promoCode,
              offerText: this.offerText,
              resubUrl: this.resubUrl,
            });
          }

          winbacksSent.push(step.type);
          await db.updateUser(user.id, { winbacksSent: winbacksSent });

          sentCount++;
          console.log('[Winback] Sent "' + step.type + '" to ' + user.email + ' (day ' + step.day + ' since churn)');
        } catch (err) {
          console.error('[Winback] Failed to send "' + step.type + '" to ' + user.email + ':', err.message);
        }
      }
    }

    if (sentCount > 0) {
      console.log('[Winback] Total win-back emails sent this cycle: ' + sentCount);
    }
  }
}

module.exports = WinbackCampaign;
