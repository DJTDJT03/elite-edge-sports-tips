/**
 * Elite Edge Sports Tips — Email Publishing Service
 *
 * Handles tip bulletin composition, formatting, and delivery.
 * Includes automated email workflows: welcome, premium upgrade,
 * daily bulletin, weekly summary, re-engagement, expiry warning, big win.
 *
 * Designed with pluggable transport — swap between SendGrid, Mailchimp,
 * AWS SES, or any SMTP provider by implementing the transport interface.
 *
 * Transport options (uncomment and configure):
 *   - SendGrid: @sendgrid/mail
 *   - Mailchimp Transactional: @mailchimp/mailchimp_transactional
 *   - AWS SES: @aws-sdk/client-ses
 *   - Nodemailer SMTP: nodemailer
 */

class EmailService {
  constructor() {
    this.transport = null;
    this.fromAddress = 'tips@eliteedgesports.co.uk';
    this.fromName = 'Elite Edge Sports Tips';
    this.sentEmails = []; // In-memory log for demo
    this.scheduledEmails = [];

    // Initialize transport based on environment
    this._initTransport();
  }

  _initTransport() {
    /**
     * SENDGRID SETUP:
     * 1. npm install @sendgrid/mail
     * 2. Set env: SENDGRID_API_KEY=SG.xxxxx
     *
     * const sgMail = require('@sendgrid/mail');
     * sgMail.setApiKey(process.env.SENDGRID_API_KEY);
     * this.transport = {
     *   name: 'sendgrid',
     *   send: async (msg) => sgMail.send(msg),
     * };
     */

    /**
     * MAILCHIMP TRANSACTIONAL SETUP:
     * 1. npm install @mailchimp/mailchimp_transactional
     * 2. Set env: MAILCHIMP_API_KEY=xxxxx
     *
     * const mailchimp = require('@mailchimp/mailchimp_transactional')(process.env.MAILCHIMP_API_KEY);
     * this.transport = {
     *   name: 'mailchimp',
     *   send: async (msg) => mailchimp.messages.send({ message: msg }),
     * };
     */

    /**
     * NODEMAILER SMTP SETUP:
     * 1. npm install nodemailer
     * 2. Configure SMTP settings
     *
     * const nodemailer = require('nodemailer');
     * const transporter = nodemailer.createTransport({
     *   host: process.env.SMTP_HOST,
     *   port: process.env.SMTP_PORT || 587,
     *   auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
     * });
     * this.transport = {
     *   name: 'smtp',
     *   send: async (msg) => transporter.sendMail(msg),
     * };
     */

    // Auto-detect: if SMTP credentials are set, use Nodemailer; otherwise console
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        var nodemailer = require('nodemailer');
        var transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT) || 587,
          secure: parseInt(process.env.SMTP_PORT) === 465,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          }
        });
        this.fromAddress = process.env.SMTP_USER;
        this.transport = {
          name: 'smtp',
          send: async (msg) => {
            var result = await transporter.sendMail({
              from: '"' + (this.fromName) + '" <' + this.fromAddress + '>',
              to: msg.to,
              subject: msg.subject,
              text: msg.text || '',
              html: msg.html || ''
            });
            console.log('[EmailService] SENT to: ' + msg.to + ', subject: ' + msg.subject + ', messageId: ' + result.messageId);
            return result;
          }
        };
        console.log('[EmailService] Initialized with SMTP transport (' + process.env.SMTP_HOST + ')');
      } catch (err) {
        console.error('[EmailService] SMTP setup failed:', err.message);
        console.log('[EmailService] Falling back to console transport');
        this._initConsoleTransport();
      }
    } else {
      this._initConsoleTransport();
    }
  }

  _initConsoleTransport() {
    this.transport = {
      name: 'console',
      send: async (msg) => {
        console.log('[EmailService] SEND to: ' + msg.to + ', subject: ' + msg.subject);
        console.log('[EmailService] Preview: ' + (msg.text || '').substring(0, 200) + '...');
        return { messageId: 'demo_' + Date.now(), status: 'logged' };
      },
    };
    console.log('[EmailService] Initialized with console transport (set SMTP_HOST, SMTP_USER, SMTP_PASS to send real emails)');
  }

  // -----------------------------------------------------------------------
  // Shared HTML wrapper for all automated emails
  // -----------------------------------------------------------------------
  _wrapHTML(bodyContent, preheader) {
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${preheader ? `<span style="display:none;font-size:1px;color:#0a0e1a;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</span>` : ''}
</head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#141828;">
    <tr>
      <td style="padding:24px;text-align:center;border-bottom:2px solid #d4a843;">
        <h1 style="color:#d4a843;margin:0;font-size:24px;">Elite Edge Sports Tips</h1>
        <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Premium Betting Intelligence</p>
      </td>
    </tr>
    <tr>
      <td style="padding:24px;">
        ${bodyContent}
      </td>
    </tr>
    <tr>
      <td style="padding:20px 24px;text-align:center;background:#0a0e1a;border-top:1px solid #2a2e3d;">
        <p style="color:#64748b;font-size:11px;margin:0 0 8px;">Elite Edge Sports Tips Ltd.</p>
        <p style="color:#64748b;font-size:11px;margin:0 0 8px;">123 Business Address, London, UK (placeholder)</p>
        <p style="color:#64748b;font-size:11px;margin:0 0 8px;">
          <a href="https://eliteedgesports.co.uk/#/unsubscribe" style="color:#94a3b8;text-decoration:underline;">Unsubscribe</a>
          &nbsp;|&nbsp;
          <a href="https://eliteedgesports.co.uk/#/account" style="color:#94a3b8;text-decoration:underline;">Email Preferences</a>
        </p>
        <p style="color:#64748b;font-size:11px;margin:0 0 4px;">This is entertainment and statistical analysis only. We do not provide financial or betting advice.</p>
        <p style="color:#64748b;font-size:11px;margin:0;">18+ | <a href="https://www.begambleaware.org" style="color:#94a3b8;">BeGambleAware.org</a> | Please gamble responsibly.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  // -----------------------------------------------------------------------
  // Internal send helper (logs + records)
  // -----------------------------------------------------------------------
  async _sendEmail({ to, subject, html, text, emailType }) {
    try {
      const result = await this.transport.send({
        to,
        from: `${this.fromName} <${this.fromAddress}>`,
        subject,
        html,
        text,
      });
      const record = {
        id: `email_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        to,
        subject,
        emailType: emailType || 'automated',
        sentAt: new Date().toISOString(),
        messageId: result.messageId,
        status: 'sent',
      };
      this.sentEmails.push(record);
      return record;
    } catch (err) {
      console.error(`[EmailService] Failed to send ${emailType} to ${to}:`, err.message);
      return { to, status: 'failed', error: err.message };
    }
  }

  // -----------------------------------------------------------------------
  // 1. WELCOME EMAIL (on registration)
  // -----------------------------------------------------------------------
  async sendWelcome({ name, email }) {
    const subject = 'Welcome to Elite Edge Sports Tips \uD83C\uDFC7\u26BD';

    const html = this._wrapHTML(`
        <h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ${this._esc(name)},</h2>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Welcome to <strong style="color:#d4a843;">Elite Edge</strong> &mdash; the UK's premium data-driven betting intelligence platform.</p>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Your account is now active. Here's what you get as a free member:</p>
        <table cellpadding="0" cellspacing="0" style="margin:16px 0;">
          <tr><td style="color:#22c55e;padding:4px 10px 4px 0;font-size:14px;">&#10003;</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Daily NAP of the Day (our strongest selection)</td></tr>
          <tr><td style="color:#22c55e;padding:4px 10px 4px 0;font-size:14px;">&#10003;</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Free Weekly 5-Fold Football Accumulator</td></tr>
          <tr><td style="color:#22c55e;padding:4px 10px 4px 0;font-size:14px;">&#10003;</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Full verified results history</td></tr>
          <tr><td style="color:#22c55e;padding:4px 10px 4px 0;font-size:14px;">&#10003;</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Performance tracking dashboard</td></tr>
        </table>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Want the full edge? Premium members also get:</p>
        <table cellpadding="0" cellspacing="0" style="margin:16px 0;">
          <tr><td style="color:#d4a843;padding:4px 10px 4px 0;font-size:14px;">&#128274;</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">2-4 additional premium selections daily</td></tr>
          <tr><td style="color:#d4a843;padding:4px 10px 4px 0;font-size:14px;">&#128274;</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Deep statistical analysis on every tip</td></tr>
          <tr><td style="color:#d4a843;padding:4px 10px 4px 0;font-size:14px;">&#128274;</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Staking recommendations</td></tr>
          <tr><td style="color:#d4a843;padding:4px 10px 4px 0;font-size:14px;">&#128274;</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Daily email bulletins before 9am</td></tr>
          <tr><td style="color:#d4a843;padding:4px 10px 4px 0;font-size:14px;">&#128274;</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Exclusive Telegram alerts</td></tr>
          <tr><td style="color:#d4a843;padding:4px 10px 4px 0;font-size:14px;">&#128274;</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Priority support</td></tr>
        </table>
        <div style="text-align:center;margin:24px 0;">
          <a href="https://eliteedgesports.co.uk/#/pricing" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">Start Your Free Month</a>
        </div>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;"><strong>Your login details:</strong><br>Email: ${this._esc(email)}<br>(Password: the one you chose at registration)</p>
        <div style="background:#1e2235;padding:16px;border-radius:8px;margin:20px 0;border-left:3px solid #f59e0b;">
          <p style="color:#f59e0b;font-size:13px;font-weight:700;margin:0 0 8px;">IMPORTANT REMINDER</p>
          <p style="color:#94a3b8;font-size:12px;margin:0;line-height:1.5;">This service provides statistical analysis and entertainment content ONLY. We do not provide financial or betting advice. All betting is at your own risk. Please gamble responsibly. 18+ | BeGambleAware.org</p>
        </div>
        <p style="color:#cbd5e1;font-size:14px;">Best of luck,<br><strong style="color:#d4a843;">The Elite Edge Team</strong></p>
        <p style="color:#94a3b8;font-size:13px;margin:16px 0 0;">eliteedgesports.co.uk</p>
    `, 'Welcome to Elite Edge - your account is now active');

    const text = `Hi ${name},

Welcome to Elite Edge -- the UK's premium data-driven betting intelligence platform.

Your account is now active. Here's what you get as a free member:

- Daily NAP of the Day (our strongest selection)
- Free Weekly 5-Fold Football Accumulator
- Full verified results history
- Performance tracking dashboard

Want the full edge? Premium members also get:

- 2-4 additional premium selections daily
- Deep statistical analysis on every tip
- Staking recommendations
- Daily email bulletins before 9am
- Exclusive Telegram alerts
- Priority support

Start your free month: https://eliteedgesports.co.uk/#/pricing

Your login details:
Email: ${email}
(Password: the one you chose at registration)

IMPORTANT REMINDER:
This service provides statistical analysis and entertainment content ONLY.
We do not provide financial or betting advice. All betting is at your own risk.
Please gamble responsibly. 18+ | BeGambleAware.org

Best of luck,
The Elite Edge Team

eliteedgesports.co.uk

---
18+ | Entertainment only | BeGambleAware.org
Unsubscribe: https://eliteedgesports.co.uk/#/unsubscribe`;

    return this._sendEmail({ to: email, subject, html, text, emailType: 'welcome' });
  }

  // -----------------------------------------------------------------------
  // 2. PREMIUM UPGRADE WELCOME
  // -----------------------------------------------------------------------
  async sendPremiumWelcome({ name, email, chargeDate }) {
    const chargeDateStr = chargeDate || this._formatDateUK(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
    const subject = "You're Premium! Here's Everything You've Unlocked \uD83C\uDFC6";

    const html = this._wrapHTML(`
        <h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ${this._esc(name)},</h2>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Welcome to <strong style="color:#d4a843;">Elite Edge Premium</strong> &mdash; you've just joined the sharpest minds in betting intelligence.</p>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Here's what you now have access to:</p>
        <table cellpadding="0" cellspacing="0" style="margin:16px 0;">
          <tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:15px;">&#127943;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;">2-4 premium racing &amp; football selections daily</td></tr>
          <tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:15px;">&#128202;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;">Full deep-dive analysis with edge calculations</td></tr>
          <tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:15px;">&#128231;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;">Daily tip bulletin delivered before 9am</td></tr>
          <tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:15px;">&#128241;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;">Instant Telegram alerts</td></tr>
          <tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:15px;">&#127919;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;">Staking recommendations based on Kelly Criterion</td></tr>
          <tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:15px;">&#128172;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;">Priority support</td></tr>
        </table>
        <div style="background:#1a2e1a;padding:16px;border-radius:8px;margin:20px 0;border-left:3px solid #22c55e;">
          <p style="color:#22c55e;font-size:14px;font-weight:700;margin:0;">YOUR FIRST MONTH IS FREE &mdash; you won't be charged until ${this._esc(chargeDateStr)}.</p>
        </div>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;"><strong style="color:#ffffff;">Quick start guide:</strong></p>
        <table cellpadding="0" cellspacing="0" style="margin:12px 0;">
          <tr><td style="color:#d4a843;padding:4px 10px 4px 0;font-size:14px;font-weight:700;">1.</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Check the Dashboard every morning for today's selections</td></tr>
          <tr><td style="color:#d4a843;padding:4px 10px 4px 0;font-size:14px;font-weight:700;">2.</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Join our Telegram: t.me/EliteEdgeTips</td></tr>
          <tr><td style="color:#d4a843;padding:4px 10px 4px 0;font-size:14px;font-weight:700;">3.</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Tips are published by 9am daily</td></tr>
          <tr><td style="color:#d4a843;padding:4px 10px 4px 0;font-size:14px;font-weight:700;">4.</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Results auto-update throughout the day</td></tr>
        </table>
        <p style="color:#94a3b8;font-size:13px;line-height:1.5;">If you ever need help: <a href="mailto:support@eliteedgesports.co.uk" style="color:#d4a843;">support@eliteedgesports.co.uk</a></p>
        <div style="background:#1e2235;padding:14px;border-radius:8px;margin:20px 0;">
          <p style="color:#94a3b8;font-size:12px;margin:0;">Remember: This is entertainment and statistical analysis only. Bet responsibly. 18+ | BeGambleAware.org</p>
        </div>
        <p style="color:#cbd5e1;font-size:14px;">Welcome aboard,<br><strong style="color:#d4a843;">The Elite Edge Team</strong></p>
    `, 'Welcome to Premium - full access unlocked');

    const text = `Hi ${name},

Welcome to Elite Edge Premium -- you've just joined the sharpest minds in betting intelligence.

Here's what you now have access to:

- 2-4 premium racing & football selections daily
- Full deep-dive analysis with edge calculations
- Daily tip bulletin delivered before 9am
- Instant Telegram alerts
- Staking recommendations based on Kelly Criterion
- Priority support

YOUR FIRST MONTH IS FREE -- you won't be charged until ${chargeDateStr}.

Quick start guide:
1. Check the Dashboard every morning for today's selections
2. Join our Telegram: t.me/EliteEdgeTips
3. Tips are published by 9am daily
4. Results auto-update throughout the day

If you ever need help: support@eliteedgesports.co.uk

Remember: This is entertainment and statistical analysis only.
Bet responsibly. 18+ | BeGambleAware.org

Welcome aboard,
The Elite Edge Team

---
18+ | Entertainment only | BeGambleAware.org
Unsubscribe: https://eliteedgesports.co.uk/#/unsubscribe`;

    return this._sendEmail({ to: email, subject, html, text, emailType: 'premium_welcome' });
  }

  // -----------------------------------------------------------------------
  // 3. DAILY TIP BULLETIN (premium only, auto-generated)
  // -----------------------------------------------------------------------
  async sendDailyBulletin({ name, email, nap, premiumTips, yesterdayResults }) {
    const today = this._formatDateUK(new Date());
    const subject = `Today's Elite Edge Selections \u2014 ${today}`;

    const napHTML = nap ? `
        <div style="background:#1e2235;padding:16px;border-radius:8px;margin:16px 0;border-left:3px solid #d4a843;">
          <p style="color:#d4a843;font-size:12px;font-weight:700;text-transform:uppercase;margin:0 0 8px;">&#127919; NAP OF THE DAY</p>
          <h3 style="color:#ffffff;margin:0 0 4px;font-size:18px;">${this._esc(nap.selection)} @ ${nap.odds}</h3>
          <p style="color:#94a3b8;font-size:13px;margin:0;">${this._esc(nap.event)} | Confidence: ${nap.confidence}/10</p>
        </div>` : '';

    let premiumHTML = '';
    if (premiumTips && premiumTips.length > 0) {
      const tipRows = premiumTips.map((tip, i) => `
          <tr>
            <td style="padding:12px 0;border-bottom:1px solid #2a2e3d;">
              <span style="color:#d4a843;font-weight:700;">${i + 1}.</span>
              <span style="color:#ffffff;font-weight:600;">${this._esc(tip.selection)}</span>
              <span style="color:#22c55e;font-weight:700;"> @ ${tip.odds}</span>
              <span style="color:#94a3b8;"> &mdash; ${this._esc(tip.event)}</span>
              ${tip.analysis && tip.analysis.summary ? `<br><span style="color:#94a3b8;font-size:12px;">${this._esc(tip.analysis.summary.substring(0, 120))}</span>` : ''}
            </td>
          </tr>`).join('');

      premiumHTML = `
        <div style="margin:20px 0;">
          <p style="color:#ffffff;font-size:14px;font-weight:700;margin:0 0 12px;">PREMIUM SELECTIONS:</p>
          <table width="100%" cellpadding="0" cellspacing="0">${tipRows}</table>
        </div>`;
    }

    let resultsLine = '';
    if (yesterdayResults) {
      const won = yesterdayResults.filter(r => r.result === 'won').length;
      const total = yesterdayResults.length;
      const pnl = yesterdayResults.reduce((sum, r) => sum + (r.pnl || 0), 0);
      resultsLine = `<p style="color:#94a3b8;font-size:13px;margin:16px 0 0;">&#128202; Yesterday's Results: ${won} won from ${total} tips | P/L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} units</p>`;
    }

    const html = this._wrapHTML(`
        <h2 style="color:#ffffff;margin:0 0 8px;font-size:18px;">Good morning ${this._esc(name)},</h2>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Here are today's selections from the Elite Edge model:</p>
        ${napHTML}
        ${premiumHTML}
        ${resultsLine}
        <div style="text-align:center;margin:24px 0;">
          <a href="https://eliteedgesports.co.uk" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">Full Analysis</a>
        </div>
        <p style="color:#cbd5e1;font-size:14px;">Good luck today,<br><strong style="color:#d4a843;">The Elite Edge Team</strong></p>
    `, 'Today\'s selections are ready');

    // Plain text version
    const napText = nap ? `NAP OF THE DAY\n${nap.selection} @ ${nap.odds}\n${nap.event} | Confidence: ${nap.confidence}/10\n` : '';
    const premText = premiumTips && premiumTips.length > 0
      ? 'PREMIUM SELECTIONS:\n' + premiumTips.map((t, i) => `${i + 1}. ${t.selection} @ ${t.odds} -- ${t.event}`).join('\n') + '\n'
      : '';
    const resText = yesterdayResults
      ? `Yesterday's Results: ${yesterdayResults.filter(r => r.result === 'won').length} won from ${yesterdayResults.length} tips | P/L: ${yesterdayResults.reduce((s, r) => s + (r.pnl || 0), 0).toFixed(2)} units\n`
      : '';

    const text = `Good morning ${name},

Here are today's selections from the Elite Edge model:

${napText}
${premText}
${resText}
Full analysis: https://eliteedgesports.co.uk

Good luck today,
The Elite Edge Team

18+ | Entertainment only | BeGambleAware.org
Unsubscribe: https://eliteedgesports.co.uk/#/unsubscribe`;

    return this._sendEmail({ to: email, subject, html, text, emailType: 'daily_bulletin' });
  }

  // -----------------------------------------------------------------------
  // 4. WEEKLY RESULTS SUMMARY (every Sunday 8pm)
  // -----------------------------------------------------------------------
  async sendWeeklySummary({ name, email, weekStats, overallStats, bestWinner, weeklyAcca }) {
    const wonCount = weekStats ? weekStats.won : 0;
    const subject = `Weekly Report \u2014 ${wonCount} Winner${wonCount !== 1 ? 's' : ''} This Week \uD83D\uDCCA`;

    const weekStrikeRate = weekStats && weekStats.total > 0 ? ((weekStats.won / weekStats.total) * 100).toFixed(1) : '0.0';
    const overallStrikeRate = overallStats && overallStats.total > 0 ? ((overallStats.won / overallStats.total) * 100).toFixed(1) : '0.0';
    const overallROI = overallStats ? (overallStats.roi || 0).toFixed(1) : '0.0';

    let bestWinnerHTML = '';
    if (bestWinner) {
      bestWinnerHTML = `
        <div style="background:#1a2e1a;padding:16px;border-radius:8px;margin:16px 0;border-left:3px solid #22c55e;">
          <p style="color:#22c55e;font-size:12px;font-weight:700;text-transform:uppercase;margin:0 0 4px;">BEST WINNER THIS WEEK</p>
          <p style="color:#ffffff;font-size:16px;font-weight:700;margin:0;">${this._esc(bestWinner.selection)} @ ${bestWinner.odds} &#10003;</p>
        </div>`;
    }

    let accaHTML = '';
    if (weeklyAcca && weeklyAcca.accaSelections) {
      const accaRows = weeklyAcca.accaSelections.map(s =>
        `<tr><td style="color:#cbd5e1;font-size:13px;padding:4px 0;">${this._esc(s.match)} &mdash; ${this._esc(s.selection)} @ ${s.odds}</td></tr>`
      ).join('');
      accaHTML = `
        <div style="margin:20px 0;">
          <p style="color:#d4a843;font-size:14px;font-weight:700;margin:0 0 12px;">FREE WEEKEND ACCA:</p>
          <table cellpadding="0" cellspacing="0">${accaRows}</table>
          <p style="color:#22c55e;font-size:14px;font-weight:700;margin:8px 0 0;">Combined odds: ${weeklyAcca.odds}</p>
        </div>`;
    }

    const html = this._wrapHTML(`
        <h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ${this._esc(name)},</h2>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Here's your Elite Edge weekly performance summary:</p>

        <div style="background:#1e2235;padding:16px;border-radius:8px;margin:16px 0;">
          <p style="color:#d4a843;font-size:12px;font-weight:700;text-transform:uppercase;margin:0 0 12px;">THIS WEEK</p>
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="color:#94a3b8;font-size:13px;padding:4px 0;">Tips:</td><td style="color:#ffffff;font-size:13px;font-weight:700;padding:4px 0;">${weekStats ? weekStats.total : 0}</td>
              <td style="color:#94a3b8;font-size:13px;padding:4px 0;">Won:</td><td style="color:#22c55e;font-size:13px;font-weight:700;padding:4px 0;">${wonCount}</td>
            </tr>
            <tr>
              <td style="color:#94a3b8;font-size:13px;padding:4px 0;">Strike Rate:</td><td style="color:#ffffff;font-size:13px;font-weight:700;padding:4px 0;">${weekStrikeRate}%</td>
              <td style="color:#94a3b8;font-size:13px;padding:4px 0;">P/L:</td><td style="color:${weekStats && weekStats.pnl >= 0 ? '#22c55e' : '#ef4444'};font-size:13px;font-weight:700;padding:4px 0;">${weekStats && weekStats.pnl >= 0 ? '+' : ''}${weekStats ? weekStats.pnl.toFixed(2) : '0.00'} units</td>
            </tr>
          </table>
        </div>

        <div style="background:#1e2235;padding:16px;border-radius:8px;margin:16px 0;">
          <p style="color:#d4a843;font-size:12px;font-weight:700;text-transform:uppercase;margin:0 0 12px;">OVERALL RECORD</p>
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="color:#94a3b8;font-size:13px;padding:4px 0;">Total Tips:</td><td style="color:#ffffff;font-size:13px;font-weight:700;padding:4px 0;">${overallStats ? overallStats.total : 0}</td>
              <td style="color:#94a3b8;font-size:13px;padding:4px 0;">Strike Rate:</td><td style="color:#ffffff;font-size:13px;font-weight:700;padding:4px 0;">${overallStrikeRate}%</td>
            </tr>
            <tr>
              <td style="color:#94a3b8;font-size:13px;padding:4px 0;">Running Bank:</td><td style="color:#ffffff;font-size:13px;font-weight:700;padding:4px 0;">${overallStats ? overallStats.bank.toFixed(2) : '100.00'} units</td>
              <td style="color:#94a3b8;font-size:13px;padding:4px 0;">ROI:</td><td style="color:${overallStats && overallStats.roi >= 0 ? '#22c55e' : '#ef4444'};font-size:13px;font-weight:700;padding:4px 0;">${overallROI}%</td>
            </tr>
          </table>
        </div>

        ${bestWinnerHTML}
        ${accaHTML}

        <div style="text-align:center;margin:24px 0;">
          <a href="https://eliteedgesports.co.uk/#/results" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">Full Results</a>
        </div>
        <p style="color:#cbd5e1;font-size:14px;">See you Monday,<br><strong style="color:#d4a843;">The Elite Edge Team</strong></p>
    `, `${wonCount} winners this week`);

    const text = `Hi ${name},

Here's your Elite Edge weekly performance summary:

THIS WEEK:
Tips: ${weekStats ? weekStats.total : 0} | Won: ${wonCount} | Strike Rate: ${weekStrikeRate}%
P/L: ${weekStats && weekStats.pnl >= 0 ? '+' : ''}${weekStats ? weekStats.pnl.toFixed(2) : '0.00'} units

OVERALL RECORD:
Total Tips: ${overallStats ? overallStats.total : 0} | Strike Rate: ${overallStrikeRate}%
Running Bank: ${overallStats ? overallStats.bank.toFixed(2) : '100.00'} units | ROI: ${overallROI}%

${bestWinner ? `BEST WINNER THIS WEEK:\n${bestWinner.selection} @ ${bestWinner.odds}\n` : ''}
${weeklyAcca && weeklyAcca.accaSelections ? 'FREE WEEKEND ACCA:\n' + weeklyAcca.accaSelections.map(s => `${s.match} -- ${s.selection} @ ${s.odds}`).join('\n') + '\nCombined odds: ' + weeklyAcca.odds + '\n' : ''}
Full results: https://eliteedgesports.co.uk/#/results

See you Monday,
The Elite Edge Team

18+ | Entertainment only | BeGambleAware.org
Unsubscribe: https://eliteedgesports.co.uk/#/unsubscribe`;

    return this._sendEmail({ to: email, subject, html, text, emailType: 'weekly_summary' });
  }

  // -----------------------------------------------------------------------
  // 5. INACTIVITY RE-ENGAGEMENT (7 days no login)
  // -----------------------------------------------------------------------
  async sendReengagement({ name, email, tipsPublished, winners, profit, bigWinner }) {
    const subject = "We've missed you \u2014 here's what you're missing \uD83D\uDC40";

    const bigWinHTML = bigWinner ? `
        <div style="background:#1a2e1a;padding:16px;border-radius:8px;margin:16px 0;border-left:3px solid #22c55e;">
          <p style="color:#22c55e;font-size:12px;font-weight:700;margin:0 0 4px;">OUR LATEST BIG WINNER</p>
          <p style="color:#ffffff;font-size:16px;font-weight:700;margin:0;">${this._esc(bigWinner.selection)} @ ${bigWinner.odds} &#10003;</p>
        </div>` : '';

    const html = this._wrapHTML(`
        <h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ${this._esc(name)},</h2>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">You haven't checked Elite Edge in a while. Here's what happened since your last visit:</p>
        <div style="background:#1e2235;padding:16px;border-radius:8px;margin:16px 0;">
          <table cellpadding="0" cellspacing="0">
            <tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:15px;">&#128202;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;">Tips published: <strong style="color:#ffffff;">${tipsPublished || 0}</strong></td></tr>
            <tr><td style="color:#22c55e;padding:6px 10px 6px 0;font-size:15px;">&#10003;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;">Winners: <strong style="color:#22c55e;">${winners || 0}</strong></td></tr>
            <tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:15px;">&#128176;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;">Profit: <strong style="color:#22c55e;">+${(profit || 0).toFixed(2)} units</strong></td></tr>
          </table>
        </div>
        ${bigWinHTML}
        <div style="text-align:center;margin:24px 0;">
          <a href="https://eliteedgesports.co.uk" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">Check Today's Selections</a>
        </div>
        <p style="color:#cbd5e1;font-size:14px;"><strong style="color:#d4a843;">The Elite Edge Team</strong></p>
    `, 'You have missed some winners');

    const text = `Hi ${name},

You haven't checked Elite Edge in a while. Here's what happened since your last visit:

Tips published: ${tipsPublished || 0}
Winners: ${winners || 0}
Profit: +${(profit || 0).toFixed(2)} units

${bigWinner ? `Our latest big winner:\n${bigWinner.selection} @ ${bigWinner.odds}\n` : ''}
Don't miss out -- check today's selections: https://eliteedgesports.co.uk

The Elite Edge Team

18+ | Entertainment only | BeGambleAware.org
Unsubscribe: https://eliteedgesports.co.uk/#/unsubscribe`;

    return this._sendEmail({ to: email, subject, html, text, emailType: 'reengagement' });
  }

  // -----------------------------------------------------------------------
  // 6. SUBSCRIPTION EXPIRY WARNING (3 days before)
  // -----------------------------------------------------------------------
  async sendExpiryWarning({ name, email, expiryDate, tipsReceived, winners, pnl }) {
    const expiryStr = this._formatDateUK(new Date(expiryDate));
    const subject = 'Your Premium access expires in 3 days \u23F0';

    const html = this._wrapHTML(`
        <h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ${this._esc(name)},</h2>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Your Elite Edge Premium subscription expires on <strong style="color:#d4a843;">${this._esc(expiryStr)}</strong>.</p>

        <div style="background:#1e2235;padding:16px;border-radius:8px;margin:16px 0;">
          <p style="color:#d4a843;font-size:12px;font-weight:700;text-transform:uppercase;margin:0 0 12px;">SINCE JOINING</p>
          <table cellpadding="0" cellspacing="0">
            <tr><td style="color:#94a3b8;font-size:13px;padding:4px 0;width:130px;">Tips received:</td><td style="color:#ffffff;font-size:13px;font-weight:700;">${tipsReceived || 0}</td></tr>
            <tr><td style="color:#94a3b8;font-size:13px;padding:4px 0;">Winners:</td><td style="color:#22c55e;font-size:13px;font-weight:700;">${winners || 0}</td></tr>
            <tr><td style="color:#94a3b8;font-size:13px;padding:4px 0;">P/L:</td><td style="color:${pnl >= 0 ? '#22c55e' : '#ef4444'};font-size:13px;font-weight:700;">${pnl >= 0 ? '+' : ''}${(pnl || 0).toFixed(2)} units</td></tr>
          </table>
        </div>

        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Don't lose access to:</p>
        <table cellpadding="0" cellspacing="0" style="margin:12px 0;">
          <tr><td style="color:#ef4444;padding:4px 10px 4px 0;font-size:14px;">&#10060;</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Premium selections (2-4 daily)</td></tr>
          <tr><td style="color:#ef4444;padding:4px 10px 4px 0;font-size:14px;">&#10060;</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Deep analysis</td></tr>
          <tr><td style="color:#ef4444;padding:4px 10px 4px 0;font-size:14px;">&#10060;</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Email bulletins</td></tr>
          <tr><td style="color:#ef4444;padding:4px 10px 4px 0;font-size:14px;">&#10060;</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Telegram alerts</td></tr>
        </table>

        <div style="text-align:center;margin:24px 0;">
          <a href="https://eliteedgesports.co.uk/#/pricing" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">Renew Now</a>
        </div>
        <p style="color:#cbd5e1;font-size:14px;"><strong style="color:#d4a843;">The Elite Edge Team</strong></p>
    `, 'Your Premium expires in 3 days');

    const text = `Hi ${name},

Your Elite Edge Premium subscription expires on ${expiryStr}.

Since joining, here's your record:
Tips received: ${tipsReceived || 0}
Winners: ${winners || 0}
P/L: ${pnl >= 0 ? '+' : ''}${(pnl || 0).toFixed(2)} units

Don't lose access to:
- Premium selections (2-4 daily)
- Deep analysis
- Email bulletins
- Telegram alerts

Renew now: https://eliteedgesports.co.uk/#/pricing

The Elite Edge Team

18+ | Entertainment only | BeGambleAware.org
Unsubscribe: https://eliteedgesports.co.uk/#/unsubscribe`;

    return this._sendEmail({ to: email, subject, html, text, emailType: 'expiry_warning' });
  }

  // -----------------------------------------------------------------------
  // 7. BIG WIN CELEBRATION (odds >= 6.0)
  // -----------------------------------------------------------------------
  async sendBigWin({ name, email, selection, event, odds, summary }) {
    const subject = `\uD83C\uDF89 WINNER! ${selection} @ ${odds} \u2014 Another Elite Edge success`;

    const twitterText = encodeURIComponent(`Another winner from @EliteEdgeTips! ${selection} @ ${odds} - WON! #betting #winner`);
    const twitterLink = `https://twitter.com/intent/tweet?text=${twitterText}`;

    const html = this._wrapHTML(`
        <h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ${this._esc(name)},</h2>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Another big winner for Elite Edge subscribers!</p>

        <div style="background:#1a2e1a;padding:20px;border-radius:8px;margin:16px 0;border-left:4px solid #22c55e;text-align:center;">
          <p style="color:#22c55e;font-size:14px;font-weight:700;margin:0 0 8px;">&#10003; WINNER</p>
          <h3 style="color:#ffffff;margin:0 0 8px;font-size:22px;">${this._esc(selection)}</h3>
          <p style="color:#94a3b8;font-size:14px;margin:0 0 8px;">&#128205; ${this._esc(event)}</p>
          <p style="color:#22c55e;font-size:24px;font-weight:700;margin:0;">@ ${odds} &mdash; WON</p>
        </div>

        ${summary ? `<p style="color:#cbd5e1;font-size:14px;line-height:1.6;">${this._esc(summary)}</p>` : ''}
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;"><strong>This is what data-driven analysis delivers.</strong></p>

        <div style="text-align:center;margin:24px 0;">
          <a href="https://eliteedgesports.co.uk/#/results" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;margin-right:8px;">Full Results</a>
          <a href="${twitterLink}" style="display:inline-block;padding:12px 32px;background:#1da1f2;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">Share on Twitter</a>
        </div>
        <p style="color:#cbd5e1;font-size:14px;"><strong style="color:#d4a843;">The Elite Edge Team</strong></p>
    `, `WINNER: ${selection} @ ${odds}`);

    const text = `Hi ${name},

Another big winner for Elite Edge subscribers!

WINNER: ${selection}
Event: ${event}
Odds: ${odds} -- WON

${summary || ''}

This is what data-driven analysis delivers.

Full results: https://eliteedgesports.co.uk/#/results

The Elite Edge Team

Share this win: ${twitterLink}
18+ | Entertainment only | BeGambleAware.org
Unsubscribe: https://eliteedgesports.co.uk/#/unsubscribe`;

    return this._sendEmail({ to: email, subject, html, text, emailType: 'big_win' });
  }

  // -----------------------------------------------------------------------
  // Original bulletin methods (compose + send)
  // -----------------------------------------------------------------------

  /**
   * Compose a tip bulletin email
   * @param {Object} options
   * @param {string} options.subject — Email subject line
   * @param {string} options.summary — Editor's intro/summary
   * @param {Array} options.tips — Array of tip objects to include
   * @param {string} options.targetAudience — 'all' | 'premium' | 'free'
   * @returns {Object} Composed email ready to send/preview
   */
  composeBulletin({ subject, summary, tips, targetAudience = 'premium' }) {
    const html = this._buildBulletinHTML(subject, summary, tips);
    const text = this._buildBulletinText(subject, summary, tips);

    return {
      subject,
      summary,
      tips: tips.map(t => t.id),
      targetAudience,
      html,
      text,
      composedAt: new Date().toISOString(),
    };
  }

  /**
   * Send a composed bulletin to target subscribers
   * @param {Object} bulletin — Output from composeBulletin()
   * @param {Array} subscribers — Array of { email, name, subscription } objects
   * @returns {Object} Send result
   */
  async sendBulletin(bulletin, subscribers) {
    const targets = subscribers.filter(s => {
      if (bulletin.targetAudience === 'all') return true;
      if (bulletin.targetAudience === 'premium') return s.subscription === 'premium';
      if (bulletin.targetAudience === 'free') return s.subscription === 'free';
      return true;
    });

    const results = [];
    for (const sub of targets) {
      try {
        const result = await this.transport.send({
          to: sub.email,
          from: `${this.fromName} <${this.fromAddress}>`,
          subject: bulletin.subject,
          html: bulletin.html,
          text: bulletin.text,
        });
        results.push({ email: sub.email, status: 'sent', messageId: result.messageId });
      } catch (err) {
        results.push({ email: sub.email, status: 'failed', error: err.message });
      }
    }

    const record = {
      id: `email_${Date.now()}`,
      subject: bulletin.subject,
      targetAudience: bulletin.targetAudience,
      recipientCount: targets.length,
      sentCount: results.filter(r => r.status === 'sent').length,
      failedCount: results.filter(r => r.status === 'failed').length,
      sentAt: new Date().toISOString(),
      results,
    };

    this.sentEmails.push(record);
    return record;
  }

  /**
   * Schedule a bulletin for future delivery
   */
  scheduleBulletin(bulletin, subscribers, sendAt) {
    const scheduled = {
      id: `sched_${Date.now()}`,
      bulletin,
      subscriberCount: subscribers.length,
      sendAt: new Date(sendAt).toISOString(),
      status: 'scheduled',
      createdAt: new Date().toISOString(),
    };

    this.scheduledEmails.push(scheduled);

    // In production, use a job queue (Bull, Agenda, or node-cron):
    // queue.add('send-bulletin', { bulletin, subscribers }, { delay: delayMs });

    const delayMs = new Date(sendAt) - Date.now();
    if (delayMs > 0 && delayMs < 86400000) { // Only auto-send if within 24h
      setTimeout(async () => {
        scheduled.status = 'sending';
        await this.sendBulletin(bulletin, subscribers);
        scheduled.status = 'sent';
      }, delayMs);
    }

    return scheduled;
  }

  getSentEmails() {
    return this.sentEmails;
  }

  getScheduledEmails() {
    return this.scheduledEmails;
  }

  // -----------------------------------------------------------------------
  // HTML email template (for manual bulletins)
  // -----------------------------------------------------------------------
  _buildBulletinHTML(subject, summary, tips) {
    const tipRows = tips.map(tip => `
      <tr>
        <td style="padding:16px;border-bottom:1px solid #2a2e3d;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <span style="color:#d4a843;font-weight:700;font-size:12px;text-transform:uppercase;">${tip.sport === 'racing' ? 'HORSE RACING' : 'FOOTBALL'}</span>
              <h3 style="color:#ffffff;margin:4px 0 2px;font-size:16px;">${tip.selection}</h3>
              <p style="color:#94a3b8;margin:0;font-size:13px;">${tip.event} &bull; ${tip.market}</p>
            </div>
            <div style="text-align:right;">
              <div style="color:#22c55e;font-size:20px;font-weight:700;">${tip.odds}</div>
              <div style="color:#d4a843;font-size:12px;">Edge: ${(tip.edge * 100).toFixed(1)}%</div>
              <div style="color:#94a3b8;font-size:12px;">Confidence: ${tip.confidence}/10</div>
            </div>
          </div>
          <p style="color:#cbd5e1;font-size:13px;margin:8px 0 0;line-height:1.5;">${tip.analysis?.summary || ''}</p>
        </td>
      </tr>
    `).join('');

    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#141828;">
    <tr>
      <td style="padding:24px;text-align:center;border-bottom:2px solid #d4a843;">
        <h1 style="color:#d4a843;margin:0;font-size:24px;">Elite Edge Sports Tips</h1>
        <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Premium Betting Intelligence</p>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 24px;">
        <h2 style="color:#ffffff;margin:0 0 8px;font-size:18px;">${subject}</h2>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">${summary}</p>
      </td>
    </tr>
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${tipRows}
      </table>
    </td></tr>
    <tr>
      <td style="padding:24px;text-align:center;border-top:1px solid #2a2e3d;">
        <a href="#" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">View All Tips</a>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 24px;text-align:center;background:#0a0e1a;">
        <p style="color:#64748b;font-size:11px;margin:0 0 4px;">Elite Edge Sports Tips Ltd. 123 Business Address, London, UK (placeholder)</p>
        <p style="color:#64748b;font-size:11px;margin:0 0 4px;"><a href="https://eliteedgesports.co.uk/#/unsubscribe" style="color:#94a3b8;text-decoration:underline;">Unsubscribe</a></p>
        <p style="color:#64748b;font-size:11px;margin:0 0 4px;">This is entertainment and statistical analysis only.</p>
        <p style="color:#64748b;font-size:11px;margin:0;">Gamble responsibly. 18+ | <a href="https://www.begambleaware.org" style="color:#94a3b8;">BeGambleAware.org</a></p>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  _buildBulletinText(subject, summary, tips) {
    const tipLines = tips.map(tip =>
      `${tip.sport === 'racing' ? 'RACING' : 'FOOTBALL'}: ${tip.selection} @ ${tip.odds} | ${tip.event} | ${tip.market} | Confidence: ${tip.confidence}/10 | Edge: ${(tip.edge * 100).toFixed(1)}%\n${tip.analysis?.summary || ''}`
    ).join('\n\n---\n\n');

    return `ELITE EDGE SPORTS TIPS\n${subject}\n\n${summary}\n\n${tipLines}\n\n---\nView all tips at eliteedgesports.co.uk\n\n18+ | Entertainment only | BeGambleAware.org\nUnsubscribe: https://eliteedgesports.co.uk/#/unsubscribe`;
  }

  // -----------------------------------------------------------------------
  // Utility helpers
  // -----------------------------------------------------------------------
  _esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  _formatDateUK(date) {
    if (!date) return '';
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }
}

module.exports = new EmailService();
