module.exports = function(deps) {
  const router = require('express').Router();
  const { db, authenticate, helpers, rateLimiterFns, emailService, smsService, JWT_SECRET } = deps;
  const bcrypt = require('bcryptjs');
  const jwt = require('jsonwebtoken');
  const crypto = require('crypto');

  // ---------------------------------------------------------------------------
  // REGISTER
  // ---------------------------------------------------------------------------
  router.post('/register', async (req, res) => {
    try {
      let { email, password, name, firstName, surname, dateOfBirth, mobile, agreementTimestamp } = req.body;
      firstName = (firstName || '').trim();
      surname = (surname || '').trim();
      dateOfBirth = (dateOfBirth || '').trim();
      var cleanMobile = mobile ? String(mobile).replace(/[^\d\+]/g, '') : '';
      // Backward-compat: if a single name was sent, split it
      if ((!firstName || !surname) && name) {
        var parts = name.trim().split(/\s+/);
        firstName = firstName || parts[0] || '';
        surname = surname || parts.slice(1).join(' ') || '';
      }

      if (!firstName || !surname) return res.status(400).json({ error: 'First name and surname are required' });
      if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
      if (!dateOfBirth) return res.status(400).json({ error: 'Date of birth is required' });
      if (!cleanMobile || cleanMobile.replace(/\D/g, '').length < 7) return res.status(400).json({ error: 'A valid mobile number is required' });

      // Age check — must be 18+
      var dob = new Date(dateOfBirth);
      if (isNaN(dob.getTime())) return res.status(400).json({ error: 'Please enter a valid date of birth' });
      var ageMs = Date.now() - dob.getTime();
      var age = Math.floor(ageMs / (365.25 * 24 * 60 * 60 * 1000));
      if (age < 18) return res.status(400).json({ error: 'You must be 18 or over to register.' });
      if (age > 120) return res.status(400).json({ error: 'Please enter a valid date of birth' });

      name = firstName + ' ' + surname;
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

      const crypto = require('crypto');
      // Generate email verification token
      const verifyToken = crypto.randomBytes(32).toString('hex');
      // Generate unique referral code
      const referralCode = name.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '').substring(0, 6) + '_' + Date.now().toString(36).slice(-4);

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
        emailVerified: false,
        emailVerifyToken: verifyToken,
        credits: 3,
        creditsMonthlyAllowance: 0,
        referralCode: referralCode,
        referredBy: req.body.referralCode || null,
        referralCount: 0,
        mobile: cleanMobile || null,
        firstName: firstName,
        surname: surname,
        dateOfBirth: dateOfBirth,
      };

      const user = await db.createUser(userData);
      const users = await db.getUsers();

      const token = jwt.sign(
        { id: user.id, email: user.email, name: user.name, role: user.role, subscription: user.subscription, sessionId },
        JWT_SECRET, { expiresIn: '30d' }
      );
      const tokenExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days

      // Record signup credits
      await db.recordCreditTransaction({ userId: user.id, amount: 3, balanceAfter: 3, type: 'signup_bonus', description: 'Welcome bonus — 3 free credits' });

      // Reward referrer if this user was referred
      if (req.body.referralCode) {
        try {
          var allUsers = await db.getUsers();
          var referrer = allUsers.find(function(u) { return u.referralCode === req.body.referralCode; });
          if (referrer) {
            await db.addCredits(referrer.id, 3, 'referral_signup', 'Referral: ' + user.name + ' signed up');
            await db.updateUser(referrer.id, { referralCount: (referrer.referralCount || 0) + 1 });
            console.log('[Referral] +3 credits to ' + referrer.email + ' for referring ' + user.email);
          }
        } catch (refErr) { /* non-fatal */ }
      }

      // Send welcome email with verification link (async, non-blocking)
      var verifyUrl = 'https://eliteedgesports.co.uk/api/auth/verify-email?token=' + verifyToken;
      emailService.sendWelcomeWithVerification({ name: user.name, email: user.email, verifyUrl: verifyUrl }).catch(function(err) {
        console.error('[Email] Welcome email failed:', err.message);
      });

      // Send welcome SMS with Telegram link (async, non-blocking)
      if (mobile && smsService && smsService.isAvailable) {
        smsService.sendWelcome(user.name, mobile).catch(function(err) {
          console.error('[SMS] Welcome SMS failed:', err.message);
        });
      }

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

      // Verify password (bcrypt only — no plain-text fallback)
      let valid = false;
      try { valid = await bcrypt.compare(password, user.password); } catch {}

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

      // Login streak tracking
      var todayDate = new Date().toISOString().split('T')[0];
      var lastLoginDate = user.lastLoginDate || user.last_login_date || null;
      var currentStreak = user.loginStreak || user.login_streak || 0;
      var bestStreak = user.bestLoginStreak || user.best_login_streak || 0;
      var streakReward = null;

      if (lastLoginDate) {
        var lastDate = new Date(lastLoginDate + 'T12:00:00');
        var today = new Date(todayDate + 'T12:00:00');
        var diffDays = Math.round((today - lastDate) / (24 * 60 * 60 * 1000));

        if (diffDays === 1) {
          // Consecutive day — extend streak
          currentStreak++;
        } else if (diffDays === 0) {
          // Same day — no change
        } else {
          // Missed a day — reset streak
          currentStreak = 1;
        }
      } else {
        currentStreak = 1;
      }
      if (currentStreak > bestStreak) bestStreak = currentStreak;

      // Award streak rewards
      var streakMilestones = { 3: 1, 7: 3, 14: 5, 30: 10, 60: 20, 100: 50 };
      if (streakMilestones[currentStreak] && (!user.streakRewardClaimed || user.streakRewardClaimed !== todayDate)) {
        var reward = streakMilestones[currentStreak];
        try {
          await db.addCredits(user.id, reward, 'streak_reward', currentStreak + '-day login streak bonus');
          streakReward = { days: currentStreak, credits: reward };
          console.log('[Auth] Streak reward: +' + reward + ' credits for ' + currentStreak + '-day streak to ' + user.email);
        } catch(e) {}
      }

      await db.updateUser(user.id, {
        failedAttempts: 0,
        lockUntil: null,
        sessionId,
        lastLogin: loginEntry,
        loginHistory,
        trustedDevices,
        flagged,
        loginStreak: currentStreak,
        lastLoginDate: todayDate,
        bestLoginStreak: bestStreak,
        streakRewardClaimed: streakMilestones[currentStreak] ? todayDate : (user.streakRewardClaimed || null),
      });

      const token = jwt.sign(
        { id: user.id, email: user.email, name: user.name, role: user.role, subscription: user.subscription, sessionId },
        JWT_SECRET, { expiresIn: '30d' }
      );
      const tokenExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
      res.json({
        token,
        tokenExpiry,
        user: { id: user.id, email: user.email, name: user.name, role: user.role, subscription: user.subscription, joined: user.joined, subscriptionExpiry: user.subscriptionExpiry, trialActive: user.trialActive, trialEnd: user.trialEnd, credits: user.credits },
        isNewDevice,
        loginStreak: currentStreak,
        bestStreak: bestStreak,
        streakReward: streakReward,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // START FREE TRIAL — separate from registration
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // EMAIL VERIFICATION
  // ---------------------------------------------------------------------------
  router.get('/verify-email', async (req, res) => {
    try {
      var token = req.query.token;
      if (!token) return res.redirect('/?error=missing_token');

      // Find user by verify token
      var users = await db.getUsers();
      var user = users.find(function(u) { return u.emailVerifyToken === token; });
      if (!user) return res.redirect('/?error=invalid_token');

      await db.updateUser(user.id, {
        emailVerified: true,
        emailVerifyToken: null,
      });

      console.log('[Auth] Email verified for:', user.email);
      res.redirect('/#/pricing?verified=true');
    } catch (err) {
      console.error('[Auth] Email verification error:', err.message);
      res.redirect('/?error=verification_failed');
    }
  });

  // ---------------------------------------------------------------------------
  // START FREE TRIAL — redirects to Stripe Checkout with 14-day trial
  // Card required upfront. Auto-charges after 14 days if not cancelled.
  // ---------------------------------------------------------------------------
  router.post('/start-trial', authenticate, async (req, res) => {
    try {
      var user = await db.getUserById(req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (user.trialStart) {
        return res.status(400).json({ error: 'You have already used your free trial.' });
      }

      if (user.subscription === 'premium' || user.subscription === 'vip') {
        return res.status(400).json({ error: 'You already have premium access.' });
      }

      var stripeService = deps.stripeService;
      if (!stripeService || !stripeService.isAvailable) {
        return res.status(503).json({ error: 'Payment system not configured. Please try again later.' });
      }

      // Create Stripe Checkout with 14-day trial — card required, auto-charges after trial
      var plan = req.body.plan || 'premium-monthly';
      var prices = await stripeService.ensureProducts();
      var priceMap = {
        'starter-monthly': prices.starterMonthlyId,
        'starter-annual': prices.starterAnnualId,
        'premium-monthly': prices.premiumMonthlyId,
        'premium-annual': prices.premiumAnnualId,
        'vip-monthly': prices.vipMonthlyId,
        'vip-annual': prices.vipAnnualId,
      };
      var priceId = priceMap[plan] || prices.premiumMonthlyId;
      var tier = plan.startsWith('vip') ? 'vip' : plan.startsWith('starter') ? 'starter' : 'premium';

      var baseUrl = req.headers.origin || req.protocol + '://' + req.get('host');

      var stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      var session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer_email: user.email,
        metadata: { userId: user.id, tier: tier, isTrial: 'true' },
        subscription_data: {
          trial_period_days: 14,
          metadata: { userId: user.id, tier: tier },
        },
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: baseUrl + '/api/stripe/success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: baseUrl + '/#/pricing',
        allow_promotion_codes: true,
        consent_collection: { terms_of_service: 'none' },
      });

      // Mark trial as started (Stripe webhook will confirm subscription)
      await db.updateUser(user.id, {
        trialStart: new Date().toISOString(),
      });

      // Reward referrer with +5 bonus if this user was referred and starting trial
      if (user.referredBy) {
        try {
          var trialUsers = await db.getUsers();
          var trialReferrer = trialUsers.find(function(u) { return u.referralCode === user.referredBy; });
          if (trialReferrer) {
            await db.addCredits(trialReferrer.id, 5, 'referral_trial', 'Referral bonus: ' + user.name + ' started trial');
            console.log('[Referral] +5 trial bonus to ' + trialReferrer.email);
          }
        } catch (refErr) { /* non-fatal */ }
      }

      console.log('[Trial] Stripe checkout created for 14-day trial:', user.email, '— plan:', plan);
      res.json({ url: session.url });
    } catch (err) {
      console.error('[Trial] Error:', err.message);
      res.status(500).json({ error: 'Unable to start trial. Please try again.' });
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
        credits: user.credits || 0,
        creditsMonthlyAllowance: user.creditsMonthlyAllowance || 0,
        creditsResetDate: user.creditsResetDate || null,
        referralCode: user.referralCode || null,
        referralCount: user.referralCount || 0,
      }
    });
  });

  // ---------------------------------------------------------------------------
  // CREDIT HISTORY
  // ---------------------------------------------------------------------------
  router.get('/credits/history', authenticate, async (req, res) => {
    try {
      var history = await db.getCreditHistory(req.user.id, 30);
      var user = await db.getUserById(req.user.id);
      res.json({
        credits: user ? user.credits : 0,
        monthlyAllowance: user ? user.creditsMonthlyAllowance : 0,
        resetDate: user ? user.creditsResetDate : null,
        history: history,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // REFERRAL INFO
  // ---------------------------------------------------------------------------
  router.get('/referral', authenticate, async (req, res) => {
    try {
      var user = await db.getUserById(req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json({
        referralCode: user.referralCode,
        referralCount: user.referralCount || 0,
        referralLink: 'https://eliteedgesports.co.uk/?ref=' + (user.referralCode || ''),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // SHARE TIP ON SOCIAL — earn 1 credit (max 1/day)
  // ---------------------------------------------------------------------------
  router.post('/credits/share', authenticate, async (req, res) => {
    try {
      var user = await db.getUserById(req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Check if already shared today
      var history = await db.getCreditHistory(req.user.id, 10);
      var today = new Date().toISOString().split('T')[0];
      var sharedToday = history.some(function(h) {
        return h.type === 'social_share' && h.createdAt && h.createdAt.toISOString().split('T')[0] === today;
      });
      if (sharedToday) return res.json({ credits: user.credits, message: 'Already earned share credit today' });

      var newBalance = await db.addCredits(req.user.id, 1, 'social_share', 'Shared tip on social media');
      res.json({ credits: newBalance, message: '+1 credit for sharing!' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
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
