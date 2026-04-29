module.exports = function(deps) {
  const router = require('express').Router();
  const { db, authenticate, helpers, rateLimiterFns, emailService, JWT_SECRET } = deps;
  const bcrypt = require('bcryptjs');
  const jwt = require('jsonwebtoken');
  const crypto = require('crypto');

  // ---------------------------------------------------------------------------
  // REGISTER
  // ---------------------------------------------------------------------------
  router.post('/register', async (req, res) => {
    try {
      let { email, password, name, agreementTimestamp } = req.body;
      if (!email || !password || !name) {
        return res.status(400).json({ error: 'Name, email, and password are required' });
      }
      email = email.trim().toLowerCase(); // Normalize email

      // Password strength validation
      const pwError = helpers.validatePassword(password);
      if (pwError) return res.status(400).json({ error: pwError });

      const existing = await db.getUserByEmail(email);
      if (existing) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      const hashed = await bcrypt.hash(password, 10);
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
      const userAgent = req.headers['user-agent'] || '';
      const sessionId = helpers.generateSessionId();
      const now = new Date().toISOString();
      const deviceHash = helpers.hashDeviceFingerprint(ip, userAgent);

      const userData = {
        id: `usr_${Date.now()}`,
        email,
        password: hashed,
        name,
        role: 'free',
        subscription: 'free',
        subscriptionExpiry: null,
        trialActive: false,
        trialStart: null,
        trialEnd: null,
        joined: new Date().toISOString().split('T')[0],
        bank: 100,
        agreementTimestamp: agreementTimestamp || now,
        agreementText: 'I confirm I am 18+ and understand this service provides statistical analysis only, not betting advice. I accept full responsibility for any betting decisions I make.',
        sessionId,
        failedAttempts: 0,
        lockUntil: null,
        flagged: false,
        lastLogin: { ip, userAgent, timestamp: now, sessionId },
        loginHistory: [{ ip, userAgent, timestamp: now, sessionId }],
        trustedDevices: [deviceHash],
        emailPrefs: { dailyBulletin: true, weeklySummary: true, marketing: true, bigWins: true },
      };

      const user = await db.createUser(userData);
      const users = await db.getUsers();

      const token = jwt.sign(
        { id: user.id, email: user.email, name: user.name, role: user.role, subscription: user.subscription, sessionId },
        JWT_SECRET, { expiresIn: '30d' }
      );
      const tokenExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days

      // Send welcome email (async, non-blocking)
      emailService.sendWelcome({ name: user.name, email: user.email }).catch(function(err) {
        console.error('[Email] Welcome email failed:', err.message);
      });

      // Send admin notification of new subscriber (async, non-blocking)
      var adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'darren@ecocleaningsystems.co.uk';
      emailService.sendAdminNewSubscriber({
        adminEmail: adminEmail,
        newUser: { name: user.name, email: user.email, joined: user.joined, ip: ip },
        totalUsers: users.length
      }).catch(function(err) {
        console.error('[Email] Admin notification failed:', err.message);
      });

      res.json({ token, tokenExpiry, user: { id: user.id, email: user.email, name: user.name, role: user.role, subscription: user.subscription, joined: user.joined, trialActive: user.trialActive, trialEnd: user.trialEnd } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // LOGIN
  // ---------------------------------------------------------------------------
  router.post('/login', async (req, res) => {
    try {
      let { email, password } = req.body;
      email = (email || '').trim().toLowerCase(); // Normalize for case-insensitive lookup
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
      const userAgent = req.headers['user-agent'] || '';

      // Rate limit check
      if (rateLimiterFns.checkAuthRateLimit(ip)) {
        return res.status(429).json({ error: 'Too many login attempts. Please try again in 15 minutes.' });
      }

      const user = await db.getUserByEmail(email);
      if (!user) {
        rateLimiterFns.recordAuthAttempt(ip);
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Account lockout check
      if (user.lockUntil && new Date(user.lockUntil) > new Date()) {
        const mins = Math.ceil((new Date(user.lockUntil) - new Date()) / 60000);
        return res.status(423).json({ error: `Account temporarily locked. Please try again in ${mins} minute${mins !== 1 ? 's' : ''}.` });
      }

      // Support both hashed and plain-text passwords for demo
      let valid = false;
      try { valid = await bcrypt.compare(password, user.password); } catch {}

      // Migrate any legacy plain-text passwords to bcrypt on first successful login
      if (!valid && user.passwordPlain) {
        valid = password === user.passwordPlain;
        if (valid) {
          await db.updateUser(user.id, {
            password: await bcrypt.hash(password, 10),
            passwordPlain: undefined
          });
        }
      }

      if (!valid) {
        rateLimiterFns.recordAuthAttempt(ip);
        // Account lockout: increment failed attempts
        const failedAttempts = (user.failedAttempts || 0) + 1;
        if (failedAttempts >= 5) {
          await db.updateUser(user.id, {
            failedAttempts,
            lockUntil: new Date(Date.now() + 30 * 60 * 1000).toISOString()
          });
          return res.status(423).json({ error: 'Account temporarily locked due to too many failed attempts. Please try again in 30 minutes.' });
        }
        await db.updateUser(user.id, { failedAttempts });
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Successful login — reset counters
      rateLimiterFns.resetAuthRateLimit(ip);

      // Generate new session (invalidates any previous session)
      const sessionId = helpers.generateSessionId();
      const now = new Date().toISOString();

      // Device fingerprinting
      const deviceHash = helpers.hashDeviceFingerprint(ip, userAgent);
      const loginEntry = { ip, userAgent, timestamp: now, sessionId };

      // Maintain login history (last 10)
      let loginHistory = user.loginHistory || [];
      loginHistory = [loginEntry, ...loginHistory];
      if (loginHistory.length > 10) loginHistory = loginHistory.slice(0, 10);

      // Trusted devices tracking
      let trustedDevices = user.trustedDevices || [];
      const isNewDevice = !trustedDevices.includes(deviceHash);
      if (isNewDevice) {
        trustedDevices = [...trustedDevices, deviceHash];
        console.log(`[Auth] New device login for ${user.email} from IP: ${ip}`);
      }

      // Suspicious activity flag (3+ IPs in 24h)
      const flagged = helpers.checkSuspiciousActivity(user) ? true : user.flagged;
      if (flagged && !user.flagged) {
        console.log(`[Auth] FLAGGED: ${user.email} has 3+ different IPs in 24 hours`);
      }

      console.log(`[Auth] Login: ${user.email} | IP: ${ip} | Session: ${sessionId.slice(0, 8)}...`);

      await db.updateUser(user.id, {
        failedAttempts: 0,
        lockUntil: null,
        sessionId,
        lastLogin: loginEntry,
        loginHistory,
        trustedDevices,
        flagged
      });

      const token = jwt.sign(
        { id: user.id, email: user.email, name: user.name, role: user.role, subscription: user.subscription, sessionId },
        JWT_SECRET, { expiresIn: '30d' }
      );
      const tokenExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
      res.json({
        token,
        tokenExpiry,
        user: { id: user.id, email: user.email, name: user.name, role: user.role, subscription: user.subscription, joined: user.joined, subscriptionExpiry: user.subscriptionExpiry, trialActive: user.trialActive, trialEnd: user.trialEnd },
        isNewDevice
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // START FREE TRIAL — separate from registration
  // ---------------------------------------------------------------------------
  router.post('/start-trial', authenticate, async (req, res) => {
    try {
      var user = await db.getUserById(req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Check if user already had a trial
      if (user.trialStart) {
        return res.status(400).json({ error: 'You have already used your free trial.' });
      }

      // Check if already premium
      if (user.subscription === 'premium') {
        return res.status(400).json({ error: 'You already have premium access.' });
      }

      // Activate 7-day trial
      var trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await db.updateUser(user.id, {
        subscription: 'premium',
        subscriptionExpiry: trialEnd,
        trialActive: true,
        trialStart: new Date().toISOString(),
        trialEnd: trialEnd,
      });

      console.log('[Trial] Started 7-day trial for ' + user.email);

      res.json({
        message: 'Your 7-day free trial has started! You now have full premium access.',
        trialEnd: trialEnd,
        subscription: 'premium',
        trialActive: true,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // GET CURRENT USER
  // ---------------------------------------------------------------------------
  router.get('/me', authenticate, async (req, res) => {
    const user = await db.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      user: {
        id: user.id, email: user.email, name: user.name, role: user.role,
        subscription: user.subscription, subscriptionExpiry: user.subscriptionExpiry,
        joined: user.joined,
        lastLogin: user.lastLogin,
        loginHistory: (user.loginHistory || []).slice(0, 5),
        trialActive: user.trialActive,
        trialStart: user.trialStart,
        trialEnd: user.trialEnd,
        paymentGraceEnd: user.paymentGraceEnd || null,
        stripeCustomerId: user.stripeCustomerId || null,
      }
    });
  });

  // ---------------------------------------------------------------------------
  // CHANGE PASSWORD
  // ---------------------------------------------------------------------------
  router.post('/change-password', authenticate, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new password are required' });
      }
      const pwError = helpers.validatePassword(newPassword);
      if (pwError) return res.status(400).json({ error: pwError });

      const user = await db.getUserById(req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      let valid = false;
      try { valid = await bcrypt.compare(currentPassword, user.password); } catch {}
      if (!valid && user.passwordPlain) { valid = currentPassword === user.passwordPlain; }
      if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

      await db.updateUser(user.id, {
        password: await bcrypt.hash(newPassword, 10),
        passwordPlain: undefined
      });

      res.json({ message: 'Password changed successfully' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // LOG OUT ALL DEVICES (invalidate session)
  // ---------------------------------------------------------------------------
  router.post('/logout-all', authenticate, async (req, res) => {
    const user = await db.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    await db.updateUser(user.id, { sessionId: helpers.generateSessionId() });
    res.json({ message: 'All sessions have been logged out. Please log in again.' });
  });

  // ---------------------------------------------------------------------------
  // DELETE ACCOUNT
  // ---------------------------------------------------------------------------
  router.delete('/account', authenticate, async (req, res) => {
    const deleted = await db.deleteUser(req.user.id);
    if (!deleted) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'Account deleted successfully' });
  });

  // ---------------------------------------------------------------------------
  // UPDATE PROFILE (name and email)
  // ---------------------------------------------------------------------------
  router.put('/profile', authenticate, async (req, res) => {
    try {
      const { name, email } = req.body;

      // Validate name
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Name is required' });
      }
      if (name.trim().length > 100) {
        return res.status(400).json({ error: 'Name must be 100 characters or fewer' });
      }

      // Validate email
      if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        return res.status(400).json({ error: 'A valid email address is required' });
      }

      const user = await db.getUserById(req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const normalizedEmail = email.trim().toLowerCase();
      const emailChanged = normalizedEmail !== user.email;

      // If email is changing, check uniqueness
      if (emailChanged) {
        const existing = await db.getUserByEmail(normalizedEmail);
        if (existing) {
          return res.status(400).json({ error: 'That email address is already in use' });
        }
      }

      const updates = { name: name.trim(), email: normalizedEmail };
      await db.updateUser(user.id, updates);

      // Send notification if email changed
      if (emailChanged) {
        emailService.sendNotification({
          to: normalizedEmail,
          subject: 'Email Address Updated',
          text: 'Your email has been updated to ' + normalizedEmail
        }).catch(function(err) {
          console.error('[Email] Email change notification failed:', err.message);
        });
      }

      res.json({
        user: {
          id: user.id, email: normalizedEmail, name: name.trim(), role: user.role,
          subscription: user.subscription, subscriptionExpiry: user.subscriptionExpiry,
          joined: user.joined, trialActive: user.trialActive, trialEnd: user.trialEnd
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // UPDATE PREFERENCES (odds format etc.)
  // ---------------------------------------------------------------------------
  router.put('/preferences', authenticate, async (req, res) => {
    const user = await db.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const updates = {};
    if (req.body.oddsFormat) updates.oddsFormat = req.body.oddsFormat;
    if (req.body.alertPrefs !== undefined) updates.alertPrefs = req.body.alertPrefs;
    await db.updateUser(user.id, updates);
    res.json({ message: 'Preferences updated' });
  });

  // ---------------------------------------------------------------------------
  // ALERT PREFERENCES
  // ---------------------------------------------------------------------------
  router.get('/alert-prefs', authenticate, async (req, res) => {
    const user = await db.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const prefs = user.alertPrefs || { highConfidence: false, steamers: false, preRace: false, bigOdds: false, newTips: false };
    res.json({ alertPrefs: prefs });
  });

  router.put('/alert-prefs', authenticate, async (req, res) => {
    const user = await db.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const allowed = ['highConfidence', 'steamers', 'preRace', 'bigOdds', 'newTips'];
    const alertPrefs = user.alertPrefs || { highConfidence: false, steamers: false, preRace: false, bigOdds: false, newTips: false };
    for (var key of allowed) {
      if (req.body[key] !== undefined) alertPrefs[key] = !!req.body[key];
    }
    await db.updateUser(user.id, { alertPrefs });
    res.json({ message: 'Alert preferences updated', alertPrefs });
  });

  // ---------------------------------------------------------------------------
  // EMAIL PREFERENCES
  // ---------------------------------------------------------------------------
  router.get('/email-prefs', authenticate, async (req, res) => {
    const user = await db.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const prefs = user.emailPrefs || { dailyBulletin: true, weeklySummary: true, marketing: true, bigWins: true };
    res.json({ emailPrefs: prefs });
  });

  router.put('/email-prefs', authenticate, async (req, res) => {
    const user = await db.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const allowed = ['dailyBulletin', 'weeklySummary', 'marketing', 'bigWins'];
    const emailPrefs = user.emailPrefs || { dailyBulletin: true, weeklySummary: true, marketing: true, bigWins: true };
    for (var key of allowed) {
      if (req.body[key] !== undefined) emailPrefs[key] = !!req.body[key];
    }
    await db.updateUser(user.id, { emailPrefs });
    res.json({ message: 'Email preferences updated', emailPrefs });
  });

  // ---------------------------------------------------------------------------
  // RESET PASSWORD (using JWT token from email link)
  // ---------------------------------------------------------------------------
  router.post('/reset-password', async (req, res) => {
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
      if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

      let payload;
      try {
        payload = jwt.verify(token, JWT_SECRET);
      } catch (e) {
        return res.status(400).json({ error: 'Reset link is invalid or has expired. Please request a new one.' });
      }

      if (payload.purpose !== 'password_reset') {
        return res.status(400).json({ error: 'Invalid reset token' });
      }

      const user = await db.getUserByEmail(payload.email);
      if (!user) return res.status(400).json({ error: 'Account not found' });

      await db.updateUser(user.id, {
        password: await bcrypt.hash(newPassword, 10),
        passwordPlain: undefined,
        mustResetPassword: undefined,
        sessionId: crypto.randomBytes(16).toString('hex')
      });

      res.json({ success: true, message: 'Password has been reset successfully. You can now log in with your new password.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // FORGOT PASSWORD
  // ---------------------------------------------------------------------------
  router.post('/forgot-password', async (req, res) => {
    try {
      let { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Email is required' });
      email = email.trim().toLowerCase();

      const user = await db.getUserByEmail(email);

      // Always return success message to prevent email enumeration
      const message = 'If an account exists with this email, a password reset link has been sent.';

      if (user) {
        // Generate a JWT reset token (30 min expiry) — survives Railway redeploys
        const resetToken = jwt.sign(
          { email: user.email, purpose: 'password_reset' },
          JWT_SECRET,
          { expiresIn: '30m' }
        );
        const resetLink = `https://eliteedgesports.co.uk/#/reset-password?token=${resetToken}`;
        console.log('[Auth] Password reset requested for ' + user.email + ' — generating token and sending email');

        // Send reset email via emailService — surface errors for debugging
        let emailResult = null;
        try {
          if (!emailService) throw new Error('emailService is null');
          if (!emailService.sendPasswordReset) throw new Error('sendPasswordReset method missing');
          emailResult = await emailService.sendPasswordReset(user.email, resetLink);
          console.log('[Auth] Password reset email result:', JSON.stringify(emailResult));
        } catch (emailErr) {
          console.error('[Auth] Failed to send password reset email:', emailErr.message, emailErr.stack);
          return res.status(500).json({ error: 'Email send failed: ' + emailErr.message });
        }

        // If the email service returned a failure status, surface it
        if (emailResult && emailResult.status === 'failed') {
          return res.status(500).json({ error: 'Email failed to send: ' + (emailResult.error || 'unknown') });
        }

        return res.json({ message });
      }

      res.json({ message });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
