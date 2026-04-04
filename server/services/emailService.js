/**
 * Elite Edge Sports Tips — Email Publishing Service
 *
 * Handles tip bulletin composition, formatting, and delivery.
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
    this.fromAddress = 'tips@eliteedgesports.com';
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

    // Default: console transport (logs to server console for demo)
    this.transport = {
      name: 'console',
      send: async (msg) => {
        console.log(`[EmailService] SEND to: ${msg.to}, subject: ${msg.subject}`);
        console.log(`[EmailService] Preview: ${msg.text?.substring(0, 200)}...`);
        return { messageId: `demo_${Date.now()}`, status: 'logged' };
      },
    };

    console.log(`[EmailService] Initialized with ${this.transport.name} transport`);
  }

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
  // HTML email template
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
        <p style="color:#64748b;font-size:11px;margin:0;">Elite Edge Sports Tips Ltd. Gamble responsibly. 18+</p>
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

    return `ELITE EDGE SPORTS TIPS\n${subject}\n\n${summary}\n\n${tipLines}\n\n---\nView all tips at eliteedgesports.com\nGamble responsibly. 18+`;
  }
}

module.exports = new EmailService();
