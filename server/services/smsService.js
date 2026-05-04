/**
 * Elite Edge Sports Tips — SMS Service (Twilio)
 *
 * Sends SMS via Twilio for welcome messages, tip alerts, and low-credit warnings.
 * Graceful no-op when Twilio credentials are not configured.
 *
 * Required env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 */

'use strict';

class SmsService {
  constructor() {
    this.isAvailable = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
    this.client = null;
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER || '';

    if (this.isAvailable) {
      try {
        this.client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        console.log('[SMS] Twilio configured — SMS enabled');
      } catch(e) {
        this.isAvailable = false;
        console.log('[SMS] Twilio package not installed — run npm install twilio to enable SMS');
      }
    } else {
      console.log('[SMS] Twilio not configured — SMS disabled (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER)');
    }
  }

  /**
   * Send an SMS message.
   * @param {string} to - Phone number in E.164 format (e.g. +447123456789)
   * @param {string} body - Message text (max 160 chars for single SMS)
   */
  async send(to, body) {
    if (!this.isAvailable || !this.client) return null;
    if (!to || !body) return null;

    // Normalise UK numbers: 07xxx -> +447xxx
    var normalised = this._normaliseUK(to);
    if (!normalised) {
      console.log('[SMS] Invalid number, skipping:', to);
      return null;
    }

    try {
      var msg = await this.client.messages.create({
        body: body,
        from: this.fromNumber,
        to: normalised,
      });
      console.log('[SMS] Sent to', normalised, '— SID:', msg.sid);
      return msg.sid;
    } catch (err) {
      console.error('[SMS] Send failed to', normalised, ':', err.message);
      return null;
    }
  }

  /**
   * Welcome SMS — sent on registration.
   */
  async sendWelcome(name, mobile) {
    var body = 'Welcome to Elite Edge Sports Tips, ' + (name || 'there').split(' ')[0] + '! ' +
      'Your 5 free credits are ready. Join our Telegram for instant alerts: https://t.me/EliteEdgeTips ' +
      '— Elite Edge';
    return this.send(mobile, body);
  }

  /**
   * Low credits SMS — sent when credits drop to 2 or fewer.
   */
  async sendLowCredits(name, mobile, credits) {
    var body = (name || 'Hi').split(' ')[0] + ', you have ' + credits + ' credit' + (credits !== 1 ? 's' : '') + ' left on Elite Edge. ' +
      "Today's tips are waiting — top up from £1.99: https://eliteedgesports.co.uk/#/buy-credits";
    return this.send(mobile, body);
  }

  /**
   * Big winner SMS — sent when a backed tip wins at good odds.
   */
  async sendBigWinner(name, mobile, selection, odds) {
    var body = 'WINNER! ' + selection + ' @ ' + odds + ' — congratulations ' + (name || '').split(' ')[0] + '! ' +
      'See full results: https://eliteedgesports.co.uk/#/results — Elite Edge';
    return this.send(mobile, body);
  }

  /**
   * Trial ending SMS — sent 2 days before trial expires.
   */
  async sendTrialEnding(name, mobile, daysLeft) {
    var body = (name || 'Hi').split(' ')[0] + ', your Elite Edge free trial ends in ' + daysLeft + ' day' + (daysLeft !== 1 ? 's' : '') + '. ' +
      'Subscribe to keep full access from £9.99/mo: https://eliteedgesports.co.uk/#/pricing';
    return this.send(mobile, body);
  }

  /**
   * Normalise UK phone numbers to E.164 format.
   * 07xxx -> +447xxx, 447xxx -> +447xxx, +447xxx -> +447xxx
   */
  _normaliseUK(number) {
    if (!number) return null;
    var cleaned = String(number).replace(/[\s\-\(\)\.]/g, '');

    // Already E.164
    if (/^\+44\d{10}$/.test(cleaned)) return cleaned;

    // 07xxx format
    if (/^07\d{9}$/.test(cleaned)) return '+44' + cleaned.substring(1);

    // 447xxx without +
    if (/^44\d{10}$/.test(cleaned)) return '+' + cleaned;

    // International number with + (non-UK)
    if (/^\+\d{10,15}$/.test(cleaned)) return cleaned;

    return null;
  }
}

module.exports = new SmsService();
