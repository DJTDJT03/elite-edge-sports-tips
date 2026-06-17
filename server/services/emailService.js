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

    // PRIORITY 1: Resend (HTTP-based, works on Railway/Vercel/Heroku)
    if (process.env.RESEND_API_KEY) {
      this._initResendTransport();
      return;
    }

    // PRIORITY 2: SendGrid (HTTP-based)
    if (process.env.SENDGRID_API_KEY) {
      this._initSendGridTransport();
      return;
    }

    // PRIORITY 3: SMTP via Nodemailer (blocked by Railway/Vercel — last resort)
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

  // Resend HTTP API transport — works on Railway (no SMTP needed)
  _initResendTransport() {
    var self = this;
    var fromEmail = process.env.EMAIL_FROM || 'tips@eliteedgesports.co.uk';
    self.fromAddress = fromEmail;
    self.transport = {
      name: 'resend',
      send: async (msg) => {
        return new Promise(function(resolve, reject) {
          var https = require('https');
          var payload = JSON.stringify({
            from: '"' + self.fromName + '" <' + self.fromAddress + '>',
            to: Array.isArray(msg.to) ? msg.to : [msg.to],
            subject: msg.subject,
            html: msg.html || '',
            text: msg.text || ''
          });
          var req = https.request({
            hostname: 'api.resend.com',
            path: '/emails',
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          }, function(res) {
            var body = '';
            res.on('data', function(c) { body += c; });
            res.on('end', function() {
              try {
                var data = JSON.parse(body);
                if (res.statusCode >= 200 && res.statusCode < 300) {
                  console.log('[EmailService] Resend SENT to: ' + msg.to + ', subject: ' + msg.subject + ', id: ' + (data.id || '?'));
                  resolve({ messageId: data.id, status: 'sent' });
                } else {
                  console.error('[EmailService] Resend FAILED to: ' + msg.to + ', status: ' + res.statusCode + ', body: ' + body);
                  reject(new Error('Resend ' + res.statusCode + ': ' + body));
                }
              } catch (e) { reject(e); }
            });
          });
          req.on('error', function(err) {
            console.error('[EmailService] Resend network error:', err.message);
            reject(err);
          });
          req.setTimeout(15000, function() { req.destroy(); reject(new Error('Resend timeout')); });
          req.write(payload);
          req.end();
        });
      }
    };
    console.log('[EmailService] Initialized with Resend HTTP transport (' + fromEmail + ')');
  }

  // SendGrid HTTP API transport — works on Railway
  _initSendGridTransport() {
    var self = this;
    var fromEmail = process.env.EMAIL_FROM || 'tips@eliteedgesports.co.uk';
    self.fromAddress = fromEmail;
    self.transport = {
      name: 'sendgrid',
      send: async (msg) => {
        return new Promise(function(resolve, reject) {
          var https = require('https');
          var payload = JSON.stringify({
            personalizations: [{ to: [{ email: msg.to }] }],
            from: { email: self.fromAddress, name: self.fromName },
            subject: msg.subject,
            content: [
              { type: 'text/plain', value: msg.text || ' ' },
              { type: 'text/html', value: msg.html || ' ' }
            ]
          });
          var req = https.request({
            hostname: 'api.sendgrid.com',
            path: '/v3/mail/send',
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + process.env.SENDGRID_API_KEY,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          }, function(res) {
            var body = '';
            res.on('data', function(c) { body += c; });
            res.on('end', function() {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                console.log('[EmailService] SendGrid SENT to: ' + msg.to + ', subject: ' + msg.subject);
                resolve({ messageId: res.headers['x-message-id'] || 'sendgrid_' + Date.now(), status: 'sent' });
              } else {
                console.error('[EmailService] SendGrid FAILED to: ' + msg.to + ', status: ' + res.statusCode + ', body: ' + body);
                reject(new Error('SendGrid ' + res.statusCode + ': ' + body));
              }
            });
          });
          req.on('error', function(err) { reject(err); });
          req.setTimeout(15000, function() { req.destroy(); reject(new Error('SendGrid timeout')); });
          req.write(payload);
          req.end();
        });
      }
    };
    console.log('[EmailService] Initialized with SendGrid HTTP transport (' + fromEmail + ')');
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
        <p style="color:#64748b;font-size:11px;margin:0 0 12px;">Elite Edge Sports Tips Ltd.</p>
        <p style="color:#64748b;font-size:11px;margin:0 0 12px;">
          <a href="https://x.com/EliteEdgeLtd" style="color:#94a3b8;text-decoration:none;margin:0 8px;">X/Twitter</a>
          &bull;
          <a href="https://www.instagram.com/eliteedgeltd/" style="color:#94a3b8;text-decoration:none;margin:0 8px;">Instagram</a>
          &bull;
          <a href="https://www.linkedin.com/company/elite-edge-sports-ltd/" style="color:#94a3b8;text-decoration:none;margin:0 8px;">LinkedIn</a>
          &bull;
          <a href="https://t.me/EliteEdgeSportsTips" style="color:#94a3b8;text-decoration:none;margin:0 8px;">Telegram</a>
        </p>
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
  // 1b. WELCOME WITH EMAIL VERIFICATION
  // -----------------------------------------------------------------------
  async sendWelcomeWithVerification({ name, email, verifyUrl }) {
    const subject = 'Verify your email — Welcome to Elite Edge Sports Tips';

    const html = this._wrapHTML(`
        <h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ${this._esc(name)},</h2>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Welcome to <strong style="color:#d4a843;">Elite Edge Sports Tips</strong> — the UK's most advanced multi-sport betting intelligence platform.</p>

        <div style="background:linear-gradient(135deg,rgba(34,197,94,0.1),rgba(34,197,94,0.03));border:2px solid rgba(34,197,94,0.3);border-radius:10px;padding:20px;margin:20px 0;text-align:center;">
          <p style="color:#22c55e;font-weight:700;font-size:16px;margin:0 0 8px;">Step 1: Verify Your Email</p>
          <p style="color:#cbd5e1;font-size:13px;margin:0 0 16px;">Click the button below to verify your email address and unlock your account.</p>
          <a href="${verifyUrl}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">Verify My Email</a>
        </div>

        <div style="background:linear-gradient(135deg,rgba(212,168,67,0.1),rgba(212,168,67,0.03));border:2px solid rgba(212,168,67,0.3);border-radius:10px;padding:20px;margin:20px 0;text-align:center;">
          <p style="color:#d4a843;font-weight:700;font-size:16px;margin:0 0 8px;">Step 2: Start Your 14-Day Free Trial</p>
          <p style="color:#cbd5e1;font-size:13px;margin:0 0 8px;">After verifying, start your free trial to unlock:</p>
          <table cellpadding="0" cellspacing="0" style="margin:12px auto;text-align:left;">
            <tr><td style="color:#22c55e;padding:3px 8px 3px 0;font-size:13px;">&#10003;</td><td style="color:#cbd5e1;font-size:13px;padding:3px 0;">Up to 9 daily tips across 6 sports</td></tr>
            <tr><td style="color:#22c55e;padding:3px 8px 3px 0;font-size:13px;">&#10003;</td><td style="color:#cbd5e1;font-size:13px;padding:3px 0;">Full AI analysis on every selection</td></tr>
            <tr><td style="color:#22c55e;padding:3px 8px 3px 0;font-size:13px;">&#10003;</td><td style="color:#cbd5e1;font-size:13px;padding:3px 0;">Smart Acca Generator + Value Bet Scanner</td></tr>
            <tr><td style="color:#22c55e;padding:3px 8px 3px 0;font-size:13px;">&#10003;</td><td style="color:#cbd5e1;font-size:13px;padding:3px 0;">Daily email bulletins with live intelligence</td></tr>
          </table>
          <p style="color:#94a3b8;font-size:12px;margin:12px 0 0;">14 days completely free. Cancel anytime before your trial ends.</p>
        </div>

        <div style="background:#141824;border:1px solid #2a2d45;border-radius:10px;padding:20px;margin:20px 0;">
          <p style="color:#d4a843;font-weight:700;font-size:15px;margin:0 0 12px;">How Credits Work</p>
          <p style="color:#cbd5e1;font-size:13px;line-height:1.6;margin:0 0 12px;">Elite Edge uses a credit system to access premium tips and tools. Here's what you need to know:</p>
          <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:12px;">
            <tr><td style="color:#d4a843;padding:6px 0;font-size:13px;font-weight:700;border-bottom:1px solid #2a2d45;">Your Plan</td><td style="color:#cbd5e1;padding:6px 0;font-size:13px;text-align:right;border-bottom:1px solid #2a2d45;">Monthly Credits</td></tr>
            <tr><td style="color:#cbd5e1;padding:6px 0;font-size:13px;">Free</td><td style="color:#cbd5e1;padding:6px 0;font-size:13px;text-align:right;">5 credits (one-time welcome bonus)</td></tr>
            <tr><td style="color:#cbd5e1;padding:6px 0;font-size:13px;">Starter (£9.99/mo)</td><td style="color:#cbd5e1;padding:6px 0;font-size:13px;text-align:right;">40 credits/month</td></tr>
            <tr><td style="color:#cbd5e1;padding:6px 0;font-size:13px;">Premium (£19.99/mo)</td><td style="color:#cbd5e1;padding:6px 0;font-size:13px;text-align:right;">120 credits/month</td></tr>
            <tr><td style="color:#cbd5e1;padding:6px 0;font-size:13px;">VIP (£39.99/mo)</td><td style="color:#d4a843;padding:6px 0;font-size:13px;font-weight:700;text-align:right;">Unlimited</td></tr>
          </table>
          <p style="color:#94a3b8;font-size:12px;line-height:1.5;margin:0 0 8px;"><strong style="color:#cbd5e1;">What costs credits:</strong> Viewing a premium tip costs 1 credit. Your credit balance is shown in the top menu bar.</p>
          <p style="color:#94a3b8;font-size:12px;line-height:1.5;margin:0 0 8px;"><strong style="color:#cbd5e1;">Running low?</strong> Buy credit packs from £1.99 or upgrade your plan for more monthly credits.</p>
          <p style="color:#94a3b8;font-size:12px;line-height:1.5;margin:0;"><strong style="color:#cbd5e1;">Earn free credits:</strong> Refer a friend (+3 credits when they sign up, +5 when they start a trial). Share tips on social media (+1/day).</p>
        </div>

        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;"><strong>Your login details:</strong><br>Email: ${this._esc(email)}</p>

        <div style="background:linear-gradient(135deg,rgba(34,158,217,0.1),rgba(34,158,217,0.03));border:2px solid rgba(34,158,217,0.3);border-radius:10px;padding:20px;margin:20px 0;text-align:center;">
          <p style="color:#229ED9;font-weight:700;font-size:16px;margin:0 0 8px;">Step 3: Join Us on Telegram</p>
          <p style="color:#cbd5e1;font-size:13px;margin:0 0 16px;">Get instant tip alerts, live winner notifications, and community chat — straight to your phone.</p>
          <a href="https://t.me/EliteEdgeSportsTips" style="display:inline-block;padding:12px 28px;background:#229ED9;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">Join Elite Edge on Telegram</a>
          <p style="color:#64748b;font-size:11px;margin:12px 0 0;">90%+ of our subscribers are on Telegram. Don't miss a winner.</p>
        </div>

        <div style="background:#1e2235;padding:16px;border-radius:8px;margin:20px 0;border-left:3px solid #f59e0b;">
          <p style="color:#f59e0b;font-size:13px;font-weight:700;margin:0 0 8px;">IMPORTANT</p>
          <p style="color:#94a3b8;font-size:12px;margin:0;line-height:1.5;">This service provides statistical analysis and entertainment content ONLY. We do not provide financial or betting advice. All betting is at your own risk. Please gamble responsibly. 18+ | BeGambleAware.org</p>
        </div>
        <p style="color:#cbd5e1;font-size:14px;">Welcome aboard,<br><strong style="color:#d4a843;">The Elite Edge Team</strong></p>
    `, 'Verify your email to get started');

    const text = `Hi ${name},

Welcome to Elite Edge Sports Tips!

STEP 1: Verify your email
Click this link: ${verifyUrl}

STEP 2: Start your 14-day free trial
After verifying, start your free trial to unlock all premium features.
14 days completely free. Cancel anytime.

HOW CREDITS WORK:
Elite Edge uses credits to access premium tips.
- Free: 5 credits (one-time welcome bonus)
- Starter (£9.99/mo): 40 credits/month
- Premium (£19.99/mo): 120 credits/month
- VIP (£39.99/mo): Unlimited

Viewing a premium tip costs 1 credit.
Buy more credit packs from £1.99, or upgrade for more monthly credits.
Earn free credits: refer a friend (+3), share on social (+1/day).

Your login email: ${email}

STEP 3: Join us on Telegram
Get instant tip alerts and winner notifications: https://t.me/EliteEdgeSportsTips
90%+ of our subscribers are on Telegram.

IMPORTANT: This service provides statistical analysis and entertainment content ONLY.
18+ | BeGambleAware.org

The Elite Edge Team`;

    return this._sendEmail({ to: email, subject, html, text, emailType: 'welcome_verification' });
  }

  // -----------------------------------------------------------------------
  // 1c. TRIAL CONFIRMATION — sent when Stripe trial starts (card on file)
  // -----------------------------------------------------------------------
  async sendTrialConfirmation({ name, email, tier, trialEndDate, price, portalUrl }) {
    const subject = 'Your 14-day free trial has started — Elite Edge Sports Tips';

    const html = this._wrapHTML(`
        <h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ${this._esc(name)},</h2>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Great news — your <strong style="color:#d4a843;">14-day free trial</strong> of Elite Edge ${this._esc(tier === 'vip' ? 'VIP' : 'Premium')} is now active!</p>

        <div style="background:#141824;border:1px solid var(--border,#2a2d45);border-radius:10px;padding:20px;margin:20px 0;">
          <table cellpadding="0" cellspacing="0" style="width:100%;">
            <tr><td style="color:#8b8d93;font-size:13px;padding:6px 0;">Plan:</td><td style="color:#d4a843;font-size:13px;font-weight:700;text-align:right;padding:6px 0;">Elite Edge ${this._esc(tier === 'vip' ? 'VIP' : 'Premium')}</td></tr>
            <tr><td style="color:#8b8d93;font-size:13px;padding:6px 0;">Trial period:</td><td style="color:#ffffff;font-size:13px;font-weight:700;text-align:right;padding:6px 0;">14 days (FREE)</td></tr>
            <tr><td style="color:#8b8d93;font-size:13px;padding:6px 0;">Trial ends:</td><td style="color:#ffffff;font-size:13px;font-weight:700;text-align:right;padding:6px 0;">${this._esc(trialEndDate)}</td></tr>
            <tr><td colspan="2" style="border-top:1px solid #2a2d45;padding-top:10px;margin-top:6px;"></td></tr>
            <tr><td style="color:#8b8d93;font-size:13px;padding:6px 0;">First payment:</td><td style="color:#fbbf24;font-size:13px;font-weight:700;text-align:right;padding:6px 0;">${this._esc(price)}/month on ${this._esc(trialEndDate)}</td></tr>
          </table>
        </div>

        <div style="background:rgba(251,191,36,0.08);border-left:3px solid #fbbf24;padding:16px;border-radius:0 8px 8px 0;margin:20px 0;">
          <p style="color:#fbbf24;font-size:13px;font-weight:700;margin:0 0 8px;">BILLING INFORMATION</p>
          <p style="color:#cbd5e1;font-size:13px;margin:0;line-height:1.6;">Your card will <strong>not</strong> be charged during the trial period. If you enjoy the service, you don't need to do anything — your subscription will begin automatically on <strong>${this._esc(trialEndDate)}</strong> at <strong>${this._esc(price)}/month</strong>.</p>
          <p style="color:#cbd5e1;font-size:13px;margin:8px 0 0;line-height:1.6;">If you decide it's not for you, simply cancel before <strong>${this._esc(trialEndDate)}</strong> and you will not be charged. No questions asked.</p>
        </div>

        <div style="text-align:center;margin:24px 0;">
          <a href="${portalUrl || 'https://eliteedgesports.co.uk/#/account'}" style="display:inline-block;padding:12px 28px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:13px;">Manage Subscription / Cancel Anytime</a>
        </div>

        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Enjoy your trial!</p>
        <p style="color:#cbd5e1;font-size:14px;"><strong style="color:#d4a843;">The Elite Edge Team</strong></p>

        <div style="background:#1e2235;padding:12px;border-radius:8px;margin:20px 0;">
          <p style="color:#94a3b8;font-size:11px;margin:0;line-height:1.5;">18+ | Entertainment & statistical analysis only | BeGambleAware.org<br>You can cancel your subscription at any time from your account page or by contacting us at contact@eliteedgesports.co.uk</p>
        </div>
    `, 'Your 14-day free trial is active');

    const text = `Hi ${name},

Your 14-day free trial of Elite Edge ${tier === 'vip' ? 'VIP' : 'Premium'} is now active!

Plan: Elite Edge ${tier === 'vip' ? 'VIP' : 'Premium'}
Trial period: 14 days (FREE)
Trial ends: ${trialEndDate}
First payment: ${price}/month on ${trialEndDate}

BILLING INFORMATION:
Your card will NOT be charged during the trial period.
If you enjoy the service, your subscription begins automatically on ${trialEndDate} at ${price}/month.
If you decide it's not for you, cancel before ${trialEndDate} and you will not be charged.

Manage subscription: ${portalUrl || 'https://eliteedgesports.co.uk/#/account'}

18+ | Entertainment only | BeGambleAware.org
Cancel anytime: contact@eliteedgesports.co.uk`;

    return this._sendEmail({ to: email, subject, html, text, emailType: 'trial_confirmation' });
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
          <tr><td style="color:#d4a843;padding:4px 10px 4px 0;font-size:14px;font-weight:700;">2.</td><td style="color:#cbd5e1;font-size:14px;padding:4px 0;">Join our Telegram: t.me/EliteEdgeSportsTips</td></tr>
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
2. Join our Telegram: t.me/EliteEdgeSportsTips
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

    const napHTML = nap ? (() => {
      const napOdds = parseFloat(nap.odds) || 0;
      const isNapValue = napOdds >= 8.0; // 7/1+
      const isNapBigPrice = napOdds >= 10.0; // 9/1+
      const napIsRacing = !nap.sport || nap.sport === 'racing';
      const napEwAdvice = napIsRacing && napOdds >= 6.0; // 5/1+ suggest EW
      return `
        <div style="background:#1e2235;padding:16px;border-radius:8px;margin:16px 0;border-left:3px solid #d4a843;">
          <p style="color:#d4a843;font-size:12px;font-weight:700;text-transform:uppercase;margin:0 0 8px;">&#127919; NAP OF THE DAY</p>
          <h3 style="color:#ffffff;margin:0 0 4px;font-size:18px;">${this._esc(nap.selection)} @ ${nap.odds}</h3>
          <p style="color:#94a3b8;font-size:13px;margin:0;">${this._esc(nap.event)} | Confidence: ${nap.confidence}/10${nap.analysis && nap.analysis.consensus ? ' | ' + nap.analysis.consensus : ''}</p>
          ${nap.analysis && nap.analysis.debate ? `<div style="margin-top:10px;padding:10px;background:#151929;border-radius:6px;">
            <p style="color:#d4a843;font-size:11px;font-weight:700;margin:0 0 6px;">AGENT ANALYSIS:</p>
            ${nap.analysis.debate.map(d => `<p style="color:#94a3b8;font-size:12px;margin:2px 0;line-height:1.5;"><strong style="color:#fff;">${this._esc(d.agent)}:</strong> ${this._esc(d.pick)} &mdash; ${this._esc((d.reasoning || '').substring(0, 120))}</p>`).join('')}
            ${nap.analysis.gptVerdict ? `<p style="color:#60a5fa;font-size:12px;margin:6px 0 0;">&#129302; <strong>GPT Arbiter:</strong> ${this._esc(nap.analysis.gptVerdict)}${nap.analysis.gptReasoning ? ' &mdash; ' + this._esc(nap.analysis.gptReasoning.substring(0, 100)) : ''}</p>` : ''}
          </div>` : ''}
          ${isNapValue ? `<p style="color:#f59e0b;font-size:12px;font-weight:700;margin:8px 0 0;"><span style="background:#f59e0b;color:#0a0e1a;padding:2px 6px;border-radius:3px;font-size:10px;margin-right:6px;">VALUE PICK</span> This is a value selection at a bigger price &mdash; not a banker. Our model has identified a significant edge in the pricing.</p>` : ''}
          ${napEwAdvice ? `<p style="color:#3b82f6;font-size:12px;font-weight:600;margin:${isNapValue ? '4' : '8'}px 0 0;">&#9432; Advised each-way (E/W) at this price</p>` : ''}
          ${nap.analysis ? (() => {
            var a = nap.analysis;
            var sections = [];
            if (a.form) sections.push('<strong>FORM:</strong> ' + this._esc(String(a.form).substring(0, 200)));
            if (a.headToHead || a.h2h) sections.push('<strong>H2H:</strong> ' + this._esc(String(a.headToHead || a.h2h).substring(0, 200)));
            if (a.injuries) sections.push('<strong>INJURIES:</strong> ' + this._esc(String(a.injuries).substring(0, 200)));
            if (a.tacticianInsight) sections.push('<strong>TACTICAL:</strong> ' + this._esc(String(a.tacticianInsight).substring(0, 200)));
            if (a.riskNotes) sections.push('<strong>RISK:</strong> ' + this._esc(String(a.riskNotes).substring(0, 150)));
            if (a.latestInjuryNews) sections.push('<strong style="color:#22c55e;">BREAKING INJURY NEWS:</strong> ' + this._esc(String(a.latestInjuryNews).substring(0, 200)));
            if (a.latestTeamNews) sections.push('<strong style="color:#22c55e;">TEAM NEWS:</strong> ' + this._esc(String(a.latestTeamNews).substring(0, 200)));
            if (sections.length > 0) {
              return '<div style="margin-top:12px;padding:12px;background:#151929;border-radius:6px;border-left:3px solid #d4a843;"><p style="color:#d4a843;font-size:11px;font-weight:700;margin:0 0 8px;">DETAILED ANALYSIS:</p>' + sections.map(s => '<p style="color:#cbd5e1;font-size:12px;margin:4px 0;line-height:1.6;">' + s + '</p>').join('') + '</div>';
            }
            return '';
          })() : ''}
        </div>`;
    })() : '';

    let premiumHTML = '';
    if (premiumTips && premiumTips.length > 0) {
      const tipRows = premiumTips.map((tip, i) => {
        const tipOdds = parseFloat(tip.odds) || 0;
        const isValue = tipOdds >= 8.0; // 7/1+
        const tipIsRacing = !tip.sport || tip.sport === 'racing';
        const ewAdvice = tipIsRacing && tipOdds >= 6.0; // 5/1+ suggest EW
        return `
          <tr>
            <td style="padding:12px 0;border-bottom:1px solid #2a2e3d;">
              <span style="color:#d4a843;font-weight:700;">${i + 1}.</span>
              <span style="color:#ffffff;font-weight:600;">${this._esc(tip.selection)}</span>
              <span style="color:#22c55e;font-weight:700;"> @ ${tip.odds}</span>
              ${ewAdvice ? '<span style="color:#3b82f6;font-weight:700;font-size:11px;"> E/W</span>' : ''}
              <span style="color:#94a3b8;"> &mdash; ${this._esc(tip.event)}</span>
              ${isValue ? '<br><span style="background:#f59e0b;color:#0a0e1a;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;">VALUE PICK</span> <span style="color:#f59e0b;font-size:11px;">Bigger price &mdash; not a banker. Model edge identified in the pricing.</span>' : ''}
              ${tip.analysis && tip.analysis.consensus ? `<br><span style="background:${tip.analysis.consensus === 'UNANIMOUS' ? '#22c55e' : '#d4a843'};color:#0a0e1a;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;">${tip.analysis.consensus}</span> <span style="color:#94a3b8;font-size:11px;">${(tip.analysis.agentsAgreeing || []).join(' + ')} agree on this pick</span>` : ''}
              ${tip.analysis && tip.analysis.debate ? tip.analysis.debate.map(d => `<br><span style="color:#64748b;font-size:11px;"><strong style="color:#d4a843;">${this._esc(d.agent)}:</strong> ${this._esc(d.pick)} (${d.market}) &mdash; ${this._esc((d.reasoning || '').substring(0, 100))}</span>`).join('') : ''}
              ${tip.analysis && tip.analysis.gptVerdict ? `<br><span style="color:#60a5fa;font-size:11px;">&#129302; ${this._esc(tip.analysis.gptVerdict)}${tip.analysis.gptReasoning ? ': ' + this._esc(tip.analysis.gptReasoning.substring(0, 80)) : ''}</span>` : ''}
              ${tip.analysis ? (() => {
                var a = tip.analysis;
                var sections = [];
                if (a.form) sections.push('<strong style="color:#d4a843;">FORM:</strong> ' + this._esc(String(a.form).substring(0, 150)));
                if (a.headToHead || a.h2h) sections.push('<strong style="color:#d4a843;">H2H:</strong> ' + this._esc(String(a.headToHead || a.h2h).substring(0, 150)));
                if (a.injuries) sections.push('<strong style="color:#d4a843;">INJURIES:</strong> ' + this._esc(String(a.injuries).substring(0, 150)));
                if (a.tacticianInsight) sections.push('<strong style="color:#d4a843;">TACTICAL:</strong> ' + this._esc(String(a.tacticianInsight).substring(0, 150)));
                if (a.latestInjuryNews) sections.push('<strong style="color:#22c55e;">BREAKING:</strong> ' + this._esc(String(a.latestInjuryNews).substring(0, 150)));
                if (a.latestTeamNews) sections.push('<strong style="color:#22c55e;">TEAM NEWS:</strong> ' + this._esc(String(a.latestTeamNews).substring(0, 150)));
                if (a.summary && !a.debate) sections.push(this._esc(String(a.summary).substring(0, 200)));
                if (sections.length > 0) {
                  return '<div style="margin-top:8px;padding:8px 10px;background:#151929;border-radius:4px;border-left:2px solid #2a2e3d;">' + sections.map(s => '<p style="color:#94a3b8;font-size:11px;margin:3px 0;line-height:1.5;">' + s + '</p>').join('') + '</div>';
                }
                return '';
              })() : ''}
            </td>
          </tr>`;
      }).join('');

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
    const napOddsVal = nap ? (parseFloat(nap.odds) || 0) : 0;
    const napText = nap ? `NAP OF THE DAY\n${nap.selection} @ ${nap.odds}${(!nap.sport || nap.sport === 'racing') && napOddsVal >= 6.0 ? ' (Advised E/W)' : ''}\n${nap.event} | Confidence: ${nap.confidence}/10\n${napOddsVal >= 8.0 ? 'VALUE PICK — This is a value selection at a bigger price, not a banker. Our model has identified an edge in the pricing.\n' : ''}` : '';
    const premText = premiumTips && premiumTips.length > 0
      ? 'PREMIUM SELECTIONS:\n' + premiumTips.map((t, i) => {
          const tOdds = parseFloat(t.odds) || 0;
          const isRacing = !t.sport || t.sport === 'racing';
          let line = `${i + 1}. ${t.selection} @ ${t.odds}`;
          if (isRacing && tOdds >= 6.0) line += ' (E/W)';
          line += ` -- ${t.event}`;
          if (tOdds >= 8.0) line += ' [VALUE PICK - not a banker, model edge in pricing]';
          return line;
        }).join('\n') + '\n'
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
  // WIN-BACK 1 — Goodbye (day 1 after cancellation)
  // Gracious, no hard sell. Door left open + a quick feedback ask.
  // -----------------------------------------------------------------------
  async sendWinbackGoodbye({ name, email, resubUrl }) {
    const url = resubUrl || 'https://eliteedgesports.co.uk/#/pricing';
    const subject = 'Sorry to see you go';

    const html = this._wrapHTML(`
        <h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ${this._esc(name)},</h2>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Your subscription's been cancelled and you're back on the free plan. No charges from here on — that's all sorted.</p>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Genuinely, thanks for giving us a go. If something wasn't right — the tips, the price, anything — I'd like to know. Just hit reply and tell me straight. I read every one.</p>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">You'll still get the free picks, and the door's open whenever you fancy coming back.</p>
        <div style="text-align:center;margin:24px 0;">
          <a href="${url}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">See What's On</a>
        </div>
        <p style="color:#cbd5e1;font-size:14px;"><strong style="color:#d4a843;">Darren &amp; the Elite Edge Team</strong></p>
    `, 'No charges from here. Thanks for giving us a go.');

    const text = `Hi ${name},

Your subscription's been cancelled and you're back on the free plan. No charges from here on -- that's all sorted.

Genuinely, thanks for giving us a go. If something wasn't right -- the tips, the price, anything -- I'd like to know. Just hit reply and tell me straight. I read every one.

You'll still get the free picks, and the door's open whenever you fancy coming back: ${url}

Darren & the Elite Edge Team

18+ | Entertainment only | BeGambleAware.org
Unsubscribe: https://eliteedgesports.co.uk/#/unsubscribe`;

    return this._sendEmail({ to: email, subject, html, text, emailType: 'winback_goodbye' });
  }

  // -----------------------------------------------------------------------
  // WIN-BACK 2 — What you've missed (day 7 after cancellation)
  // -----------------------------------------------------------------------
  async sendWinbackMissing({ name, email, tipsPublished, winners, profit, bigWinner, resubUrl }) {
    const url = resubUrl || 'https://eliteedgesports.co.uk/#/pricing';
    const subject = "Here's what you've missed this week";

    const bigWinHTML = bigWinner ? `
        <div style="background:#1a2e1a;padding:16px;border-radius:8px;margin:16px 0;border-left:3px solid #22c55e;">
          <p style="color:#22c55e;font-size:12px;font-weight:700;margin:0 0 4px;">PICK OF THE WEEK</p>
          <p style="color:#ffffff;font-size:16px;font-weight:700;margin:0;">${this._esc(bigWinner.selection)} @ ${bigWinner.odds} &#10003;</p>
        </div>` : '';

    const html = this._wrapHTML(`
        <h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ${this._esc(name)},</h2>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">No sales pitch — just a quick look at what the lads have been up to since you left:</p>
        <div style="background:#1e2235;padding:16px;border-radius:8px;margin:16px 0;">
          <table cellpadding="0" cellspacing="0">
            <tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:15px;">&#128202;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;">Tips published: <strong style="color:#ffffff;">${tipsPublished || 0}</strong></td></tr>
            <tr><td style="color:#22c55e;padding:6px 10px 6px 0;font-size:15px;">&#10003;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;">Winners: <strong style="color:#22c55e;">${winners || 0}</strong></td></tr>
            <tr><td style="color:#d4a843;padding:6px 10px 6px 0;font-size:15px;">&#128176;</td><td style="color:#cbd5e1;font-size:14px;padding:6px 0;">Profit: <strong style="color:#22c55e;">+${(profit || 0).toFixed(2)} units</strong></td></tr>
          </table>
        </div>
        ${bigWinHTML}
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">If you want back in on the full card, you know where we are.</p>
        <div style="text-align:center;margin:24px 0;">
          <a href="${url}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">Come Back</a>
        </div>
        <p style="color:#cbd5e1;font-size:14px;"><strong style="color:#d4a843;">Darren &amp; the Elite Edge Team</strong></p>
    `, "A week of results since you left");

    const text = `Hi ${name},

No sales pitch -- just a quick look at what the lads have been up to since you left:

Tips published: ${tipsPublished || 0}
Winners: ${winners || 0}
Profit: +${(profit || 0).toFixed(2)} units
${bigWinner ? `\nPick of the week: ${bigWinner.selection} @ ${bigWinner.odds}\n` : ''}
If you want back in on the full card, you know where we are: ${url}

Darren & the Elite Edge Team

18+ | Entertainment only | BeGambleAware.org
Unsubscribe: https://eliteedgesports.co.uk/#/unsubscribe`;

    return this._sendEmail({ to: email, subject, html, text, emailType: 'winback_missing' });
  }

  // -----------------------------------------------------------------------
  // WIN-BACK 3 — The offer (day 21 after cancellation)
  // promoCode applied at checkout (Stripe promotion codes are enabled).
  // -----------------------------------------------------------------------
  async sendWinbackOffer({ name, email, promoCode, offerText, resubUrl }) {
    const url = resubUrl || 'https://eliteedgesports.co.uk/#/pricing';
    const code = promoCode || 'WELCOMEBACK';
    const offer = offerText || '50% off your first month';
    const subject = `A little something to tempt you back — ${offer}`;

    const html = this._wrapHTML(`
        <h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ${this._esc(name)},</h2>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">I'll keep it short. We'd love to have you back, so here's ${this._esc(offer)} if you fancy another crack at it.</p>
        <div style="background:#1e2235;padding:20px;border-radius:8px;margin:16px 0;text-align:center;border:1px dashed #d4a843;">
          <p style="color:#94a3b8;font-size:12px;font-weight:700;text-transform:uppercase;margin:0 0 8px;">Use code at checkout</p>
          <p style="color:#d4a843;font-size:26px;font-weight:800;letter-spacing:3px;margin:0;">${this._esc(code)}</p>
        </div>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Same daily selections, same analysis, same honest record — wins and losses, all of it. No tie-in, cancel any time.</p>
        <div style="text-align:center;margin:24px 0;">
          <a href="${url}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">Claim the Offer</a>
        </div>
        <p style="color:#cbd5e1;font-size:14px;"><strong style="color:#d4a843;">Darren &amp; the Elite Edge Team</strong></p>
    `, this._esc(offer) + ' with code ' + this._esc(code));

    const text = `Hi ${name},

I'll keep it short. We'd love to have you back, so here's ${offer} if you fancy another crack at it.

Use code at checkout: ${code}

Same daily selections, same analysis, same honest record -- wins and losses, all of it. No tie-in, cancel any time.

Claim the offer: ${url}

Darren & the Elite Edge Team

18+ | Entertainment only | BeGambleAware.org
Unsubscribe: https://eliteedgesports.co.uk/#/unsubscribe`;

    return this._sendEmail({ to: email, subject, html, text, emailType: 'winback_offer' });
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

  // Referral milestone reward — 1 free month of Premium (or bonus credits if already paid).
  async sendReferralReward({ name, email, rewardType, friendName }) {
    const isMonth = rewardType !== 'bonus_credits';
    const headline = isMonth ? "You've earned a FREE month of Premium!" : "You've earned 50 bonus credits!";
    const subject = '🎉 ' + headline;
    const body = isMonth
      ? "You've now referred 3 friends to Elite Edge — so your next month of Premium is on us. Full access to every tip, full analysis and AI match previews for the next 30 days, starting right now."
      : "You've now referred 3 friends to Elite Edge. As you're already on Premium, we've dropped 50 bonus credits into your account instead — enjoy!";
    const html = this._wrapHTML(`
        <h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ${this._esc(name)},</h2>
        <div style="background:#1f1a0a;padding:22px;border-radius:8px;margin:16px 0;border-left:4px solid #d4a843;text-align:center;">
          <p style="color:#d4a843;font-size:18px;font-weight:800;margin:0 0 10px;">&#127881; ${this._esc(headline)}</p>
          <p style="color:#cbd5e1;font-size:14px;line-height:1.6;margin:0;">${this._esc(body)}</p>
        </div>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Keep sharing your link — <strong>every 3 friends who join earns you another free month</strong>.</p>
        <div style="text-align:center;margin:24px 0;">
          <a href="https://eliteedgesports.co.uk/#/refer" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">Your Referral Link</a>
        </div>
        <p style="color:#cbd5e1;font-size:14px;"><strong style="color:#d4a843;">The Elite Edge Team</strong></p>
    `, headline);
    const text = `Hi ${name},\n\n${headline}\n\n${body}\n\nKeep sharing — every 3 friends who join earns you another free month.\nYour link: https://eliteedgesports.co.uk/#/refer\n\nThe Elite Edge Team\n18+ | Please gamble responsibly | BeGambleAware.org`;
    return this._sendEmail({ to: email, subject, html, text, emailType: 'referral_reward' });
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
  // -----------------------------------------------------------------------
  // Password Reset Email
  // -----------------------------------------------------------------------
  // -----------------------------------------------------------------------
  // Admin notification — new subscriber registered
  // -----------------------------------------------------------------------
  async sendAdminNewSubscriber({ adminEmail, newUser, totalUsers }) {
    const subject = '🎉 New Elite Edge Subscriber: ' + newUser.name;
    const html = this._wrapHTML(`
      <h2 style="color:#d4a843;margin-bottom:16px;">New Subscriber Alert</h2>
      <p>A new user has just registered for Elite Edge Sports Tips.</p>
      <div style="background:#1a1a2e;border:1px solid #2a2d45;border-radius:10px;padding:20px;margin:20px 0;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="color:#9ca3af;padding:6px 0;">Name:</td><td style="color:#fff;font-weight:600;text-align:right;">${this._esc(newUser.name)}</td></tr>
          <tr><td style="color:#9ca3af;padding:6px 0;">Email:</td><td style="color:#fff;text-align:right;">${this._esc(newUser.email)}</td></tr>
          <tr><td style="color:#9ca3af;padding:6px 0;">Joined:</td><td style="color:#fff;text-align:right;">${this._esc(newUser.joined)}</td></tr>
          <tr><td style="color:#9ca3af;padding:6px 0;">IP:</td><td style="color:#fff;text-align:right;font-size:12px;">${this._esc(newUser.ip || 'unknown')}</td></tr>
          <tr><td colspan="2" style="border-top:1px solid #2a2d45;padding-top:8px;"></td></tr>
          <tr><td style="color:#9ca3af;padding:6px 0;">Total subscribers:</td><td style="color:#d4a843;font-weight:700;text-align:right;font-size:16px;">${totalUsers}</td></tr>
        </table>
      </div>
      <div style="text-align:center;margin:20px 0;">
        <a href="https://eliteedgesports.co.uk/#/admin" style="display:inline-block;background:#d4a843;color:#0a0e1a;padding:10px 24px;border-radius:8px;font-weight:700;text-decoration:none;font-size:13px;">View Admin Dashboard</a>
      </div>
    `, 'New subscriber: ' + newUser.name);
    const text = `New Elite Edge subscriber: ${newUser.name} (${newUser.email}) joined ${newUser.joined}. Total: ${totalUsers}`;
    return this._sendEmail({ to: adminEmail, subject, html, text, emailType: 'admin_new_subscriber' });
  }

  // Last Man Standing — reminder to make your pick for the next round
  async sendLmsPickReminder({ name, email, competitionName, roundLabel, prizePot }) {
    const url = 'https://eliteedgesports.co.uk/#/last-man-standing';
    const subject = '⏰ Make your Last Man Standing pick — ' + (roundLabel || 'next round');
    const html = this._wrapHTML(`
        <h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ${this._esc(name)},</h2>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">You're still standing in <strong style="color:#d4a843;">${this._esc(competitionName || 'Last Man Standing')}</strong> — but you haven't made your pick for <strong style="color:#d4a843;">${this._esc(roundLabel || 'the next round')}</strong> yet.</p>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Pick before kick-off or you're out. Remember: your team has to <strong>win</strong> — a draw and you're gone. And you can't pick a team you've already used.</p>
        ${prizePot ? '<p style="color:#cbd5e1;font-size:14px;">Still ' + '&pound;' + Math.round(prizePot) + ' in the pot.</p>' : ''}
        <div style="text-align:center;margin:24px 0;">
          <a href="${url}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">Make Your Pick</a>
        </div>
        <p style="color:#cbd5e1;font-size:14px;"><strong style="color:#d4a843;">Elite Edge — Last Man Standing</strong></p>
    `, 'Don\'t get caught out — make your pick');
    const text = `Hi ${name},

You're still standing in ${competitionName || 'Last Man Standing'} — but you haven't picked for ${roundLabel || 'the next round'} yet.

Pick before kick-off or you're out. Your team has to win (a draw and you're gone), and you can't reuse a team.

Make your pick: ${url}

Elite Edge — Last Man Standing
18+ | Entertainment only | BeGambleAware.org`;
    return this._sendEmail({ to: email, subject, html, text, emailType: 'lms_pick_reminder' });
  }

  async sendPasswordReset(email, resetLink) {
    const subject = 'Elite Edge Sports Tips — Reset Your Password';
    const html = this._wrapHTML(`
      <h2 style="color:#d4a843;margin-bottom:16px;">Reset Your Password</h2>
      <p>We received a request to reset your password for your Elite Edge Sports Tips account.</p>
      <p>Click the button below to set a new password. This link will expire in <strong>30 minutes</strong>.</p>
      <div style="text-align:center;margin:30px 0;">
        <a href="${resetLink}" style="display:inline-block;background:#d4a843;color:#0a0e1a;padding:14px 32px;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px;">Reset My Password</a>
      </div>
      <p style="color:#9ca3af;font-size:12px;">Or copy and paste this link into your browser:</p>
      <p style="color:#9ca3af;font-size:11px;word-break:break-all;background:#0a0e1a;padding:10px;border-radius:6px;border:1px solid #2a2d45;">${resetLink}</p>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px;">If you did not request this password reset, you can safely ignore this email. Your password will not be changed unless you click the link above.</p>
      <p style="color:#9ca3af;font-size:12px;">For security questions, contact us at <a href="mailto:admin@eliteedgesports.co.uk" style="color:#d4a843;">admin@eliteedgesports.co.uk</a>.</p>
    `, 'Reset your Elite Edge password');
    const text = `Reset your Elite Edge Sports Tips password by clicking this link (expires in 30 minutes): ${resetLink}\n\nIf you did not request this reset, please ignore this email.`;
    return this._sendEmail({ to: email, subject, html, text, emailType: 'password_reset' });
  }

  // -----------------------------------------------------------------------
  // DUNNING — Payment failed notification
  // -----------------------------------------------------------------------
  async sendPaymentFailed({ name, email, portalUrl }) {
    const subject = 'Action Required — Your Elite Edge payment failed';
    const html = this._wrapHTML(`
      <h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ${this._esc(name)},</h2>
      <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">We were unable to process your latest payment for your Elite Edge subscription.</p>

      <div style="background:#2a1a1a;padding:20px;border-radius:8px;margin:16px 0;border-left:4px solid #dc2626;">
        <p style="color:#fca5a5;font-size:14px;font-weight:700;margin:0 0 8px;">Payment Failed</p>
        <p style="color:#cbd5e1;font-size:14px;margin:0;">Your subscription will remain active for <strong>3 more days</strong> to give you time to update your payment details.</p>
      </div>

      <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Please update your payment method to continue receiving:</p>
      <ul style="color:#cbd5e1;font-size:14px;line-height:1.8;">
        <li>Daily AI-powered racing &amp; football tips</li>
        <li>Full analysis from our 3 specialist analysts</li>
        <li>Premium features &amp; exclusive content</li>
      </ul>

      <div style="text-align:center;margin:24px 0;">
        <a href="${portalUrl || 'https://eliteedgesports.co.uk/#/account'}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">Update Payment Method</a>
      </div>

      <p style="color:#94a3b8;font-size:12px;">If you believe this is an error, please contact us at <a href="mailto:admin@eliteedgesports.co.uk" style="color:#d4a843;">admin@eliteedgesports.co.uk</a>.</p>
      <p style="color:#cbd5e1;font-size:14px;"><strong style="color:#d4a843;">The Elite Edge Team</strong></p>
    `, 'Payment update required');

    const text = `Hi ${name},

We were unable to process your latest payment for your Elite Edge subscription.

Your subscription will remain active for 3 more days. Please update your payment method.

Update: ${portalUrl || 'https://eliteedgesports.co.uk/#/account'}

The Elite Edge Team
18+ | Entertainment only | BeGambleAware.org`;

    return this._sendEmail({ to: email, subject, html, text, emailType: 'payment_failed' });
  }

  // -----------------------------------------------------------------------
  // DUNNING — Final warning before downgrade
  // -----------------------------------------------------------------------
  async sendPaymentFinalWarning({ name, email, portalUrl }) {
    const subject = 'FINAL NOTICE — Your Elite Edge access expires tomorrow';
    const html = this._wrapHTML(`
      <h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ${this._esc(name)},</h2>
      <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">This is your final reminder — your Elite Edge subscription will be <strong style="color:#fca5a5;">downgraded tomorrow</strong> unless you update your payment method.</p>

      <div style="background:#2a1a1a;padding:20px;border-radius:8px;margin:16px 0;border-left:4px solid #f59e0b;">
        <p style="color:#fbbf24;font-size:16px;font-weight:700;margin:0 0 8px;">Last Chance</p>
        <p style="color:#cbd5e1;font-size:14px;margin:0;">After tomorrow you'll lose access to premium tips, analysis, and all subscriber features.</p>
      </div>

      <div style="text-align:center;margin:24px 0;">
        <a href="${portalUrl || 'https://eliteedgesports.co.uk/#/account'}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">Update Payment Now</a>
      </div>

      <p style="color:#cbd5e1;font-size:14px;"><strong style="color:#d4a843;">The Elite Edge Team</strong></p>
    `, 'Final payment warning');

    const text = `Hi ${name},

FINAL WARNING: Your Elite Edge subscription will be downgraded tomorrow unless you update your payment method.

Update: ${portalUrl || 'https://eliteedgesports.co.uk/#/account'}

The Elite Edge Team`;

    return this._sendEmail({ to: email, subject, html, text, emailType: 'payment_final_warning' });
  }

  // -----------------------------------------------------------------------
  // LOW CREDITS WARNING
  // -----------------------------------------------------------------------
  async sendLowCredits({ name, email, credits, subscription }) {
    const subject = 'You have ' + credits + ' credit' + (credits !== 1 ? 's' : '') + ' remaining — Elite Edge';
    const isStarter = subscription === 'starter';
    const upgradeTier = isStarter ? 'Premium (120 credits/month)' : 'Starter (40 credits/month)';
    const upgradePrice = isStarter ? '£19.99' : '£9.99';

    const html = this._wrapHTML(`
      <h2 style="color:#ffffff;margin:0 0 16px;font-size:20px;">Hi ${this._esc(name)},</h2>
      <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">You have <strong style="color:#fbbf24;">${credits} credit${credits !== 1 ? 's' : ''}</strong> remaining on your Elite Edge account.</p>
      <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Today's tips are waiting — don't miss out on the next winner.</p>

      <div style="text-align:center;margin:24px 0;">
        <a href="https://eliteedgesports.co.uk/#/buy-credits" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;margin-right:8px;">Buy More Credits</a>
        <a href="https://eliteedgesports.co.uk/#/pricing" style="display:inline-block;padding:14px 28px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Upgrade to ${upgradeTier.split(' ')[0]} — ${upgradePrice}/mo</a>
      </div>

      <p style="color:#94a3b8;font-size:12px;">Tip: Refer a friend and earn 3 free credits when they sign up.</p>
      <p style="color:#cbd5e1;font-size:14px;"><strong style="color:#d4a843;">The Elite Edge Team</strong></p>
    `, 'Credits running low');

    const text = `Hi ${name}, you have ${credits} credit${credits !== 1 ? 's' : ''} remaining. Buy more: https://eliteedgesports.co.uk/#/buy-credits or upgrade: https://eliteedgesports.co.uk/#/pricing`;

    return this._sendEmail({ to: email, subject, html, text, emailType: 'low_credits' });
  }

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
