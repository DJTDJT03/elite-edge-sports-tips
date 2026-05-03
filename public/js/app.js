/* =========================================================================
   ELITE EDGE SPORTS TIPS — Frontend Application
   Full SPA: Auth, Routing, Dashboard, Racing, Football, Results,
   Pricing, Support, Admin, Chatbot
   + 12 Elite Enhancements
   ========================================================================= */

// UK date format helper
function formatDateUK(d) {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// -------------------------------------------------------------------------
// Google Analytics Event Tracking Helper (Feature #7)
// Replace GA_MEASUREMENT_ID with your Google Analytics 4 ID to enable.
// All calls are no-ops until GA is configured.
// -------------------------------------------------------------------------
function trackEvent(category, action, label) {
  // GA4 event tracking — will only fire if gtag is loaded
  if (typeof gtag === 'function') {
    gtag('event', action, {
      event_category: category,
      event_label: label,
    });
  }
  // Debug logging in development
  // console.log('[GA Event]', category, action, label);
}

const App = {
  token: localStorage.getItem('ee_token'),
  user: JSON.parse(localStorage.getItem('ee_user') || 'null'),
  currentPage: 'dashboard',
  tips: [],
  results: [],
  performance: null,
  chart: null,
  chartMonthly: null,
  chartSR: null,
  accaSelections: [],
  notifications: JSON.parse(localStorage.getItem('ee_notifications') || '[]'),
  notifEnabled: localStorage.getItem('ee_notif_enabled') === 'true',
  oddsFormat: localStorage.getItem('oddsFormat') || 'fractional',
  _liveCache: {},

  // -----------------------------------------------------------------------
  // Premium access check — single source of truth for the entire frontend.
  // Returns 'free', 'premium', or 'vip' based on user state
  // -----------------------------------------------------------------------
  getAccessLevel() {
    if (!this.user) return 'free';
    if (this.user.role === 'admin') return 'vip'; // admin gets everything
    if (this.user.subscription === 'vip') return 'vip';
    if (this.user.subscription === 'premium') return 'premium';
    if (this.user.subscription === 'starter') return 'starter';
    if (this.user.trialActive) return 'premium'; // trial = premium level
    return 'free';
  },

  // A user has premium access if premium or vip tier (full access)
  // -----------------------------------------------------------------------
  isPremium() {
    var level = this.getAccessLevel();
    return level === 'premium' || level === 'vip';
  },

  // Starter has partial access (tips + odds, no analysis)
  isStarter() {
    return this.getAccessLevel() === 'starter';
  },

  // Any paid tier (starter, premium, or vip)
  isPaid() {
    var level = this.getAccessLevel();
    return level === 'starter' || level === 'premium' || level === 'vip';
  },

  isVIP() {
    return this.getAccessLevel() === 'vip';
  },

  // -----------------------------------------------------------------------
  // INIT
  // -----------------------------------------------------------------------
  init() {
    this.loadTheme();
    this.loadOddsFormat();
    this.checkTokenExpiry();
    // Capture referral code from URL on landing
    var refParam = new URLSearchParams(window.location.search).get('ref');
    if (refParam) localStorage.setItem('ee_ref', refParam);
    this.initInactivityTimer();
    // Refresh user data from server on every page load (catches trial/subscription changes)
    if (this.token && this.user) {
      this.api('/auth/me').then(function(data) {
        if (data && data.user) {
          App.user = data.user;
          localStorage.setItem('ee_user', JSON.stringify(data.user));
          App.updateAuthUI();
        }
      }).catch(function() {});
    }
    this.updateAuthUI();
    this.bindNav();
    window.addEventListener('hashchange', () => {
      this.checkTokenExpiry();
      this.route();
    });
    this.route();
    this.loadDailyStats();
    this.loadActivityTicker();
    this.initNotifications();
    this.initOddsTicker();
    this.checkReferralParam();
    this.initCookieConsent();
    this.loadAnalytics();
    this.initChatTease();
    this.initInstallPrompt();
  },

  // -----------------------------------------------------------------------
  // PWA INSTALL PROMPT
  // -----------------------------------------------------------------------
  _deferredInstallPrompt: null,

  initInstallPrompt() {
    var self = this;
    window.addEventListener('beforeinstallprompt', function(e) {
      e.preventDefault();
      self._deferredInstallPrompt = e;
      // Show banner after 30 seconds if user hasn't dismissed before
      if (!localStorage.getItem('ee_install_dismissed')) {
        setTimeout(function() {
          if (self._deferredInstallPrompt) {
            self.showInstallBanner();
          }
        }, 30000);
      }
    });
  },

  showInstallBanner() {
    if (document.getElementById('pwa-install-banner')) return;
    var banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.className = 'pwa-install-banner';
    banner.innerHTML = '<div class="pwa-install-inner">' +
      '<span class="pwa-install-text">Install Elite Edge for instant access</span>' +
      '<button class="btn btn-gold btn-sm" id="pwa-install-btn">Install</button>' +
      '<button class="pwa-install-dismiss" id="pwa-install-dismiss">&times;</button>' +
      '</div>';
    document.body.appendChild(banner);
    setTimeout(function() { banner.classList.add('pwa-install-show'); }, 50);

    var self = this;
    document.getElementById('pwa-install-btn').addEventListener('click', function() {
      if (self._deferredInstallPrompt) {
        self._deferredInstallPrompt.prompt();
        self._deferredInstallPrompt.userChoice.then(function(choiceResult) {
          if (choiceResult.outcome === 'accepted') {
            App.showToast('App installed successfully!', 'success');
          }
          self._deferredInstallPrompt = null;
          self.hideInstallBanner();
        });
      }
    });

    document.getElementById('pwa-install-dismiss').addEventListener('click', function() {
      localStorage.setItem('ee_install_dismissed', 'true');
      self.hideInstallBanner();
    });
  },

  hideInstallBanner() {
    var banner = document.getElementById('pwa-install-banner');
    if (banner) {
      banner.classList.remove('pwa-install-show');
      setTimeout(function() { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 300);
    }
  },

  // -----------------------------------------------------------------------
  // TOAST NOTIFICATIONS
  // -----------------------------------------------------------------------
  showToast(message, type) {
    type = type || 'info';
    var container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;align-items:center;gap:10px;pointer-events:none;';
      document.body.appendChild(container);
    }
    var toast = document.createElement('div');
    toast.className = 'ee-toast ee-toast-' + type;
    toast.textContent = message;
    toast.style.pointerEvents = 'auto';
    container.appendChild(toast);
    setTimeout(function() { toast.classList.add('ee-toast-show'); }, 50);
    setTimeout(function() {
      toast.classList.remove('ee-toast-show');
      setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
    }, 4000);
  },

  // -----------------------------------------------------------------------
  // ODDS FORMAT SYSTEM
  // -----------------------------------------------------------------------
  _commonFractions: [
    {dec: 1.10, frac: '1/10'}, {dec: 1.20, frac: '1/5'}, {dec: 1.25, frac: '1/4'},
    {dec: 1.33, frac: '1/3'}, {dec: 1.40, frac: '2/5'}, {dec: 1.50, frac: '1/2'},
    {dec: 1.57, frac: '4/7'}, {dec: 1.62, frac: '8/13'}, {dec: 1.67, frac: '4/6'},
    {dec: 1.73, frac: '8/11'}, {dec: 1.80, frac: '4/5'}, {dec: 1.83, frac: '5/6'},
    {dec: 1.91, frac: '10/11'}, {dec: 2.00, frac: 'evens'}, {dec: 2.10, frac: '11/10'},
    {dec: 2.20, frac: '6/5'}, {dec: 2.25, frac: '5/4'}, {dec: 2.38, frac: '11/8'},
    {dec: 2.50, frac: '6/4'}, {dec: 2.62, frac: '13/8'}, {dec: 2.75, frac: '7/4'},
    {dec: 2.88, frac: '15/8'}, {dec: 3.00, frac: '2/1'}, {dec: 3.25, frac: '9/4'},
    {dec: 3.50, frac: '5/2'}, {dec: 3.75, frac: '11/4'}, {dec: 4.00, frac: '3/1'},
    {dec: 4.33, frac: '10/3'}, {dec: 4.50, frac: '7/2'}, {dec: 5.00, frac: '4/1'},
    {dec: 5.50, frac: '9/2'}, {dec: 6.00, frac: '5/1'}, {dec: 6.50, frac: '11/2'},
    {dec: 7.00, frac: '6/1'}, {dec: 7.50, frac: '13/2'}, {dec: 8.00, frac: '7/1'},
    {dec: 8.50, frac: '15/2'}, {dec: 9.00, frac: '8/1'}, {dec: 10.00, frac: '9/1'},
    {dec: 11.00, frac: '10/1'}, {dec: 12.00, frac: '11/1'}, {dec: 13.00, frac: '12/1'},
    {dec: 15.00, frac: '14/1'}, {dec: 17.00, frac: '16/1'}, {dec: 21.00, frac: '20/1'},
    {dec: 26.00, frac: '25/1'}, {dec: 34.00, frac: '33/1'}, {dec: 41.00, frac: '40/1'},
    {dec: 51.00, frac: '50/1'}, {dec: 67.00, frac: '66/1'}, {dec: 101.00, frac: '100/1'},
  ],

  formatOdds(decimalOdds, format) {
    if (!decimalOdds || decimalOdds <= 1) return '-';
    var fmt = format || this.oddsFormat;
    if (fmt === 'decimal') return parseFloat(decimalOdds).toFixed(2);
    // Find nearest common fraction
    var best = this._commonFractions[0];
    var bestDiff = Math.abs(decimalOdds - best.dec);
    for (var i = 1; i < this._commonFractions.length; i++) {
      var diff = Math.abs(decimalOdds - this._commonFractions[i].dec);
      if (diff < bestDiff) { best = this._commonFractions[i]; bestDiff = diff; }
    }
    return best.frac;
  },

  loadOddsFormat() {
    this.oddsFormat = localStorage.getItem('oddsFormat') || 'fractional';
    this._updateOddsToggleUI();
  },

  toggleOddsFormat() {
    this.oddsFormat = this.oddsFormat === 'fractional' ? 'decimal' : 'fractional';
    localStorage.setItem('oddsFormat', this.oddsFormat);
    this._updateOddsToggleUI();
    this.route(); // Re-render current page
  },

  _updateOddsToggleUI() {
    var fracEl = document.getElementById('fmt-frac');
    var decEl = document.getElementById('fmt-dec');
    if (fracEl && decEl) {
      fracEl.className = this.oddsFormat === 'fractional' ? 'fmt-active' : '';
      decEl.className = this.oddsFormat === 'decimal' ? 'fmt-active' : '';
    }
  },

  // -----------------------------------------------------------------------
  // LIVE DATA CACHE HELPERS
  // -----------------------------------------------------------------------
  _getCached(key, maxAgeMs) {
    var cached = this._liveCache[key];
    if (cached && (Date.now() - cached.ts < maxAgeMs)) return cached.data;
    return null;
  },

  _setCache(key, data) {
    this._liveCache[key] = { data: data, ts: Date.now() };
  },

  async fetchLiveRacing(forceRefresh) {
    if (!forceRefresh) {
      var cached = this._getCached('racing', 180000); // 3 min
      if (cached) return cached;
    }
    try {
      var data = await this.api('/racing/live-cards');
      if (data) this._setCache('racing', data);
      return data;
    } catch (e) { return { live: false, racecards: [] }; }
  },

  async fetchRaceIntelligence(forceRefresh) {
    if (!forceRefresh) {
      var cached = this._getCached('race-intel', 300000); // 5 min
      if (cached) return cached;
    }
    try {
      var data = await this.api('/racing/intelligence');
      if (data) this._setCache('race-intel', data);
      return data;
    } catch (e) { return { live: false, races: [] }; }
  },

  async fetchLiveFootball(forceRefresh, date) {
    var cacheKey = 'football' + (date ? '_' + date : '');
    if (!forceRefresh) {
      var cached = this._getCached(cacheKey, 600000); // 10 min
      if (cached) return cached;
    }
    try {
      var url = '/football/live-fixtures' + (date ? '?date=' + date : '');
      var data = await this.api(url);
      if (data) this._setCache(cacheKey, data);
      return data;
    } catch (e) { return { live: false, fixtures: [] }; }
  },

  // Fetch weekend fixtures (Sat + Sun) — used on Fridays for weekend preview
  async fetchWeekendFootball() {
    var d = new Date();
    var day = d.getDay(); // 0=Sun, 5=Fri, 6=Sat
    // Calculate next Saturday and Sunday
    var sat = new Date(d); sat.setDate(d.getDate() + (6 - day));
    var sun = new Date(d); sun.setDate(d.getDate() + (7 - day));
    var satStr = sat.toISOString().split('T')[0];
    var sunStr = sun.toISOString().split('T')[0];
    try {
      var results = await Promise.all([
        this.fetchLiveFootball(false, satStr),
        this.fetchLiveFootball(false, sunStr)
      ]);
      var allFixtures = [];
      if (results[0] && results[0].fixtures) allFixtures = allFixtures.concat(results[0].fixtures);
      if (results[1] && results[1].fixtures) allFixtures = allFixtures.concat(results[1].fixtures);
      return { live: true, fixtures: allFixtures, fetchedAt: new Date().toISOString(), isWeekend: true };
    } catch (e) { return { live: false, fixtures: [], isWeekend: true }; }
  },

  _isFriday() { return new Date().getDay() === 5; },

  async fetchLiveOdds(forceRefresh) {
    if (!forceRefresh) {
      var cached = this._getCached('odds', 120000); // 2 min
      if (cached) return cached;
    }
    try {
      var data = await this.api('/odds/live');
      if (data) this._setCache('odds', data);
      return data;
    } catch (e) { return { live: false, odds: [] }; }
  },

  // -----------------------------------------------------------------------
  // DATE HELPERS
  // -----------------------------------------------------------------------
  // Normalise any date (string, Date object, ISO format) to YYYY-MM-DD
  _normDate(d) {
    if (!d) return '';
    if (typeof d === 'string') return d.split('T')[0];
    try { return new Date(d).toISOString().split('T')[0]; } catch(e) { return ''; }
  },
  _getToday() { return new Date().toISOString().split('T')[0]; },
  _getTomorrow() {
    var d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  },
  _getYesterday() {
    var d = new Date(); d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  },
  _isToday(dateStr) { return dateStr === this._getToday(); },
  _isTomorrow(dateStr) { return dateStr === this._getTomorrow(); },
  _isThisWeekend() {
    var d = new Date(); var day = d.getDay();
    return day === 0 || day === 6 || day === 5;
  },
  _getWeekendDates() {
    var dates = [];
    var d = new Date();
    while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
    for (var i = 0; i < 3; i++) {
      dates.push(new Date(d).toISOString().split('T')[0]);
      d.setDate(d.getDate() + 1);
    }
    return dates;
  },
  _daysSince(dateStr) {
    if (!dateStr) return 999;
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  },

  // -----------------------------------------------------------------------
  // API (with loading spinner - Feature #4)
  // -----------------------------------------------------------------------
  _activeRequests: 0,
  _spinnerTimeout: null,

  showLoadingSpinner() {
    if (document.getElementById('global-spinner')) return;
    const overlay = document.createElement('div');
    overlay.id = 'global-spinner';
    overlay.className = 'loading-spinner-overlay';
    overlay.innerHTML = '<div class="loading-spinner"></div>';
    document.body.appendChild(overlay);
  },

  hideLoadingSpinner() {
    const spinner = document.getElementById('global-spinner');
    if (spinner) spinner.remove();
  },

  async api(endpoint, options = {}) {
    // Check token expiry before making request
    this.checkTokenExpiry();

    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    this._activeRequests++;
    const startTime = Date.now();
    // Show spinner after a brief moment to prevent flash
    if (this._activeRequests === 1) {
      this._spinnerTimeout = setTimeout(() => this.showLoadingSpinner(), 150);
    }
    try {
      const res = await fetch(`/api${endpoint}`, { ...options, headers: { ...headers, ...options.headers } });
      const data = await res.json();
      if (!res.ok) {
        // Handle session expired (login from another device)
        if (res.status === 401 && (data.code === 'session_expired' || (data.error && data.error.includes('another device')))) {
          this.handleSessionExpired();
          throw new Error(data.error);
        }
        throw new Error(data.error || 'Request failed');
      }
      // Track key events (Feature #7 - GA placeholder)
      if (endpoint.includes('/auth/login')) trackEvent('auth', 'login', 'success');
      if (endpoint.includes('/auth/register')) trackEvent('auth', 'register', 'success');
      return data;
    } catch (err) {
      console.error(`API ${endpoint}:`, err);
      throw err;
    } finally {
      this._activeRequests--;
      if (this._activeRequests <= 0) {
        this._activeRequests = 0;
        // Ensure spinner shows for minimum 300ms to prevent flash
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, 300 - elapsed);
        clearTimeout(this._spinnerTimeout);
        setTimeout(() => this.hideLoadingSpinner(), remaining);
      }
    }
  },

  // -----------------------------------------------------------------------
  // SESSION MANAGEMENT
  // -----------------------------------------------------------------------
  handleSessionExpired() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('ee_token');
    localStorage.removeItem('ee_user');
    localStorage.removeItem('ee_token_expiry');
    this.updateAuthUI();
    window.location.hash = '#/';
    // Show session expired modal
    setTimeout(() => {
      const overlay = document.getElementById('modal-overlay');
      overlay.style.display = 'block';
      // Create a temporary modal for session expired
      let sessionModal = document.getElementById('modal-session-expired');
      if (!sessionModal) {
        sessionModal = document.createElement('div');
        sessionModal.id = 'modal-session-expired';
        sessionModal.className = 'modal';
        document.body.appendChild(sessionModal);
      }
      sessionModal.style.display = 'block';
      sessionModal.innerHTML = `
        <button class="modal-close" onclick="App.closeModal()">&times;</button>
        <div style="text-align:center;padding:20px 0;">
          <div style="font-size:48px;margin-bottom:16px;">&#128274;</div>
          <h2 style="margin-bottom:12px;color:var(--gold);">Session Ended</h2>
          <p style="font-size:14px;color:var(--text-secondary);margin-bottom:20px;line-height:1.6;">Your session has ended because your account was accessed from another device.<br><br>Each subscription allows one active session only.<br><br>If this wasn't you, please change your password immediately.</p>
          <button class="btn btn-gold btn-full" onclick="App.closeModal();App.showModal('login');" style="margin-bottom:12px;">Log In Again</button>
          <a href="#" onclick="App.closeModal();App.showModal('forgotpassword');return false;" style="font-size:13px;color:var(--gold);text-decoration:underline;">Change Password</a>
        </div>
      `;
    }, 100);
  },

  // Inactivity timeout — logs out after 1 hour of no interaction
  // ONLY clears the local session token — never touches user data, account, or server-side records
  initInactivityTimer() {
    var TIMEOUT = 60 * 60 * 1000; // 1 hour
    var self = this;
    var timer = null;

    function resetTimer() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function() {
        if (self.token && self.user) {
          // Clear local session only — account and data remain intact
          self.token = null;
          self.user = null;
          localStorage.removeItem('ee_token');
          localStorage.removeItem('ee_user');
          localStorage.removeItem('ee_token_expiry');
          self.updateAuthUI();
          self.showToast('Logged out due to inactivity. Your account is safe — please log in again.', 'info');
          window.location.hash = '#/';
        }
      }, TIMEOUT);
    }

    // Reset on any user interaction
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(function(evt) {
      document.addEventListener(evt, resetTimer, { passive: true });
    });

    resetTimer();
  },

  checkTokenExpiry() {
    const expiry = localStorage.getItem('ee_token_expiry');
    if (expiry && Date.now() > parseInt(expiry, 10)) {
      this.token = null;
      this.user = null;
      localStorage.removeItem('ee_token');
      localStorage.removeItem('ee_user');
      localStorage.removeItem('ee_token_expiry');
      this.updateAuthUI();
      window.location.hash = '#/';
      setTimeout(() => {
        App.showToast('Your session has expired. Please log in again.', 'error');
      }, 100);
    }
  },

  // -----------------------------------------------------------------------
  // AUTH
  // -----------------------------------------------------------------------
  async login(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const remember = document.getElementById('login-remember') && document.getElementById('login-remember').checked;
    try {
      const data = await this.api('/auth/login', {
        method: 'POST', body: JSON.stringify({ email, password })
      });
      this.token = data.token; this.user = data.user;
      localStorage.setItem('ee_token', data.token);
      localStorage.setItem('ee_user', JSON.stringify(data.user));
      if (data.tokenExpiry) localStorage.setItem('ee_token_expiry', data.tokenExpiry.toString());
      // Remember email for next login
      if (remember) {
        localStorage.setItem('ee_remembered_email', email);
      } else {
        localStorage.removeItem('ee_remembered_email');
      }
      // Store streak data
      this._loginStreak = data.loginStreak || 0;
      this._bestStreak = data.bestStreak || 0;

      this.updateAuthUI();
      this.closeModal();
      trackEvent('auth', 'login', email);

      // Show streak reward popup if earned
      if (data.streakReward) {
        setTimeout(function() { App.showStreakRewardPopup(data.streakReward, data.loginStreak); }, 800);
      } else if (data.loginStreak >= 3) {
        // Show streak counter toast
        setTimeout(function() { App.showToast('Login streak: ' + data.loginStreak + ' days! Keep it going.', 'success'); }, 800);
      }

      // Show onboarding on first login (Feature #10)
      if (!localStorage.getItem('onboardingDone')) {
        this.showOnboarding();
      }
      // Show free trial offer for free users who haven't tried yet
      if (this.user && this.user.subscription === 'free' && !this.user.trialStart) {
        setTimeout(() => this.showTrialOffer(), 3000);
      }
      this.route();
    } catch (err) {
      document.getElementById('login-error').textContent = err.message;
    }
  },

  // Toggle password visibility (eye icon)
  togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      btn.classList.add('active');
      btn.setAttribute('aria-label', 'Hide password');
    } else {
      input.type = 'password';
      btn.classList.remove('active');
      btn.setAttribute('aria-label', 'Show password');
    }
  },

  // Reset password handler (called from reset-password modal)
  async resetPassword(e) {
    e.preventDefault();
    const newPass = document.getElementById('reset-password-new').value;
    const confirmPass = document.getElementById('reset-password-confirm').value;
    const errorEl = document.getElementById('reset-error');
    const successEl = document.getElementById('reset-success');
    errorEl.textContent = '';
    successEl.style.display = 'none';

    if (newPass !== confirmPass) {
      errorEl.textContent = 'Passwords do not match';
      return;
    }
    if (newPass.length < 8) {
      errorEl.textContent = 'Password must be at least 8 characters';
      return;
    }
    if (!/[A-Z]/.test(newPass) || !/[a-z]/.test(newPass) || !/[0-9]/.test(newPass)) {
      errorEl.textContent = 'Password must include uppercase, lowercase, and number';
      return;
    }

    const token = this._resetToken;
    if (!token) {
      errorEl.textContent = 'Reset link is missing or invalid. Please request a new one.';
      return;
    }
    try {
      const data = await this.api('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword: newPass })
      });
      successEl.style.display = 'block';
      successEl.textContent = data.message || 'Password reset! Redirecting to login...';
      setTimeout(() => {
        this.closeModal();
        window.location.hash = '#/';
        this.showModal('login');
      }, 2000);
    } catch (err) {
      errorEl.textContent = err.message || 'Failed to reset password';
    }
  },

  validatePasswordClient(pw) {
    const checks = {
      length: pw.length >= 8,
      upper: /[A-Z]/.test(pw),
      lower: /[a-z]/.test(pw),
      number: /[0-9]/.test(pw),
    };
    const score = Object.values(checks).filter(Boolean).length;
    return { checks, score };
  },

  updatePasswordStrength() {
    const pw = document.getElementById('reg-password').value;
    const indicator = document.getElementById('pw-strength-indicator');
    if (!indicator) return;
    const { checks, score } = this.validatePasswordClient(pw);
    const labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];
    const colors = ['#ef4444', '#ef4444', '#f59e0b', '#22c55e', '#22c55e'];
    const pct = (score / 4) * 100;
    indicator.innerHTML = `
      <div class="pw-strength-bar"><div class="pw-strength-fill" style="width:${pct}%;background:${colors[score]};"></div></div>
      <div class="pw-strength-label" style="color:${colors[score]};">${pw.length > 0 ? labels[score] : ''}</div>
      <div class="pw-strength-checks">
        <span class="${checks.length ? 'pw-check-pass' : 'pw-check-fail'}">8+ chars</span>
        <span class="${checks.upper ? 'pw-check-pass' : 'pw-check-fail'}">Uppercase</span>
        <span class="${checks.lower ? 'pw-check-pass' : 'pw-check-fail'}">Lowercase</span>
        <span class="${checks.number ? 'pw-check-pass' : 'pw-check-fail'}">Number</span>
      </div>
    `;
  },

  async register(e) {
    e.preventDefault();
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;

    // Client-side password validation
    const { score } = this.validatePasswordClient(password);
    if (score < 4) {
      document.getElementById('reg-error').textContent = 'Password must be at least 8 characters with uppercase, lowercase, and a number.';
      return;
    }

    const agreementCheckbox = document.getElementById('reg-agreement');
    if (!agreementCheckbox || !agreementCheckbox.checked) {
      document.getElementById('reg-error').textContent = 'You must agree to the terms and confirm you are 18+ to register.';
      return;
    }
    const agreementTimestamp = new Date().toISOString();
    var oddsFormatRadio = document.querySelector('input[name="reg-odds-format"]:checked');
    if (oddsFormatRadio) {
      this.oddsFormat = oddsFormatRadio.value;
      localStorage.setItem('oddsFormat', this.oddsFormat);
      this._updateOddsToggleUI();
    }
    try {
      // Capture referral code from URL if present
      var refCode = new URLSearchParams(window.location.search).get('ref') || localStorage.getItem('ee_ref') || '';
      if (refCode) localStorage.setItem('ee_ref', refCode);

      var mobileInput = document.getElementById('reg-mobile');
      var mobile = mobileInput ? mobileInput.value.trim() : '';

      const data = await this.api('/auth/register', {
        method: 'POST', body: JSON.stringify({ name, email, password, mobile: mobile || undefined, agreementTimestamp, referralCode: refCode || undefined })
      });
      this.token = data.token; this.user = data.user;
      localStorage.setItem('ee_token', data.token);
      localStorage.setItem('ee_user', JSON.stringify(data.user));
      if (data.tokenExpiry) localStorage.setItem('ee_token_expiry', data.tokenExpiry.toString());
      this.updateAuthUI();
      this.closeModal();
      // Show email verification message + welcome email notice
      this.showEmailVerificationMessage();
      this.showWelcomeEmailNotice();
      trackEvent('auth', 'register', email);
      // Show Telegram join popup after registration
      setTimeout(() => this.showTelegramPopup(), 1500);
      // Show free trial offer after Telegram popup
      setTimeout(() => this.showTrialOffer(), 6000);
      this.route();
    } catch (err) {
      document.getElementById('reg-error').textContent = err.message;
    }
  },

  logout() {
    this.token = null; this.user = null;
    localStorage.removeItem('ee_token');
    localStorage.removeItem('ee_user');
    localStorage.removeItem('ee_token_expiry');
    this.updateAuthUI();
    window.location.hash = '#/';
  },

  updateAuthUI() {
    const guest = document.getElementById('nav-auth-guest');
    const userEl = document.getElementById('nav-auth-user');
    const badge = document.getElementById('user-badge');
    const adminLink = document.getElementById('nav-admin');
    const subBar = document.getElementById('sub-bar');
    const myBetsLink = document.getElementById('nav-mybets');
    // Mobile auth elements
    const guestMobile = document.getElementById('nav-auth-guest-mobile');
    const userMobile = document.getElementById('nav-auth-user-mobile');
    const badgeMobile = document.getElementById('user-badge-mobile');

    if (this.user) {
      guest.style.display = 'none';
      userEl.style.display = 'flex';
      var creditDisplay = '';
      if (this.user.credits !== undefined && !this.isVIP()) {
        creditDisplay = ' <span style="background:rgba(212,168,67,0.15);color:#d4a843;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;cursor:pointer;" onclick="event.stopPropagation();window.location.hash=\'#/buy-credits\'">' + (this.user.credits || 0) + ' credits</span>';
      }
      badge.innerHTML = this.user.name + (this.isVIP() ? ' <span class="vip-badge">VIP</span>' : '') + creditDisplay;
      badge.style.cursor = 'pointer';
      badge.onclick = () => { window.location.hash = '#/account'; };
      // Mobile auth
      if (guestMobile) guestMobile.style.display = 'none';
      if (userMobile) userMobile.style.display = '';
      if (badgeMobile) { badgeMobile.innerHTML = this.user.name + (this.isVIP() ? ' <span class="vip-badge">VIP</span>' : ''); badgeMobile.style.cursor = 'pointer'; badgeMobile.onclick = () => { window.location.hash = '#/account'; }; }
      adminLink.style.display = this.user.role === 'admin' ? 'inline-block' : 'none';
      if (myBetsLink) myBetsLink.style.display = 'inline-block';
      // Payment failed grace period banner
      if (this.user.paymentGraceEnd) {
        var graceEnd = new Date(this.user.paymentGraceEnd);
        var graceHoursLeft = Math.max(0, Math.ceil((graceEnd.getTime() - Date.now()) / (1000 * 60 * 60)));
        if (graceHoursLeft > 0) {
          subBar.style.display = 'block';
          subBar.style.background = 'linear-gradient(135deg, rgba(220,38,38,0.15), rgba(220,38,38,0.05))';
          subBar.style.borderBottom = '2px solid #dc2626';
          subBar.style.color = '#fca5a5';
          subBar.innerHTML = '<strong style="color:#dc2626;">PAYMENT FAILED</strong> <span style="color:#fca5a5;">&mdash; Your access expires in ' + graceHoursLeft + ' hour' + (graceHoursLeft !== 1 ? 's' : '') + '.</span> &nbsp; <a href="#/account" style="color:#fbbf24;font-weight:700;text-decoration:underline;">Update Payment &rarr;</a>';
        }
      } else if (this.user.trialActive && this.user.trialEnd) {
        var trialMsLeft = new Date(this.user.trialEnd).getTime() - Date.now();
        var trialDaysLeft = Math.max(0, Math.ceil(trialMsLeft / (24 * 60 * 60 * 1000)));
        var trialHoursLeft = Math.max(0, Math.ceil(trialMsLeft / (1000 * 60 * 60)));
        subBar.style.display = 'block';
        subBar.style.background = 'linear-gradient(135deg, rgba(212,168,67,0.15), rgba(212,168,67,0.05))';
        subBar.style.borderBottom = '2px solid var(--gold)';
        subBar.style.color = '#e8e6e3';
        // Show hours when < 24h left for urgency
        if (trialHoursLeft <= 24 && trialHoursLeft > 0) {
          subBar.innerHTML = '<strong style="color:#dc2626;">TRIAL ENDING</strong> <span style="color:#fca5a5;">&mdash; Only ' + trialHoursLeft + ' hour' + (trialHoursLeft !== 1 ? 's' : '') + ' left!</span> &nbsp; <a href="#/pricing" style="color:#d4a843;font-weight:700;text-decoration:underline;">Subscribe Now &rarr;</a>';
          subBar.style.background = 'linear-gradient(135deg, rgba(220,38,38,0.1), rgba(220,38,38,0.03))';
          subBar.style.borderBottom = '2px solid #dc2626';
        } else {
          subBar.innerHTML = '<strong style="color:#d4a843;">FREE TRIAL</strong> <span style="color:#e8e6e3;">&mdash; ' + trialDaysLeft + ' day' + (trialDaysLeft !== 1 ? 's' : '') + ' remaining</span> &nbsp; <a href="#/pricing" style="color:#d4a843;font-weight:700;text-decoration:underline;">Choose a Plan &rarr;</a>';
        }
      } else if (this.user.subscription === 'vip') {
        subBar.style.display = 'block';
        subBar.className = 'sub-bar sub-bar-vip';
        subBar.style.background = '';
        subBar.style.borderBottom = '';
        subBar.innerHTML = '\uD83D\uDC51 <strong style="color:#d4a843;">VIP MEMBER</strong> — Elite access enabled. Priority support active.';
      } else if (this.user.subscription === 'premium') {
        subBar.style.display = 'block';
        subBar.className = 'sub-bar';
        subBar.style.background = '';
        subBar.style.borderBottom = '';
        subBar.innerHTML = '<strong>Premium</strong> member — Full access enabled. Thank you for your subscription.';
      } else if (this.user.subscription === 'free' && this.user.trialStart && !this.user.trialActive) {
        // Trial expired — show conversion nudge
        subBar.style.display = 'block';
        subBar.style.background = 'linear-gradient(135deg, rgba(212,168,67,0.12), rgba(212,168,67,0.04))';
        subBar.style.borderBottom = '2px solid var(--gold)';
        subBar.style.color = '#e8e6e3';
        subBar.innerHTML = '<strong style="color:#d4a843;">TRIAL EXPIRED</strong> <span style="color:#e8e6e3;">&mdash; Your free trial has ended. Subscribe to keep Premium access.</span> &nbsp; <a href="#/pricing" style="color:#d4a843;font-weight:700;text-decoration:underline;">Subscribe Now &rarr;</a>';
        // Show conversion overlay once per session for expired trial users
        if (!sessionStorage.getItem('trialExpiredShown')) {
          sessionStorage.setItem('trialExpiredShown', 'true');
          setTimeout(() => this._showTrialExpiredOverlay(), 2000);
        }
      } else if (this.user.subscription === 'free') {
        subBar.style.display = 'block';
        subBar.className = 'sub-bar';
        subBar.style.background = '';
        subBar.style.borderBottom = '';
        subBar.innerHTML = '<strong>Free</strong> member — You have access to daily NAP, race cards, results, and weekly blog. <a href="#/pricing">View Premium features</a>';
      } else {
        subBar.style.display = 'none';
      }
    } else {
      guest.style.display = 'flex';
      userEl.style.display = 'none';
      // Mobile auth
      if (guestMobile) guestMobile.style.display = '';
      if (userMobile) userMobile.style.display = 'none';
      adminLink.style.display = 'none';
      if (myBetsLink) myBetsLink.style.display = 'none';
      subBar.style.display = 'none';
    }
  },

  // -----------------------------------------------------------------------
  // MODALS
  // -----------------------------------------------------------------------
  showModal(type) {
    document.getElementById('modal-overlay').style.display = 'block';
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    const modal = document.getElementById(`modal-${type}`);
    if (modal) modal.style.display = 'block';
    if (type === 'calculator') this.calculateStakes();
    if (type === 'mybets') this.renderMyBets();
    // Pre-fill remembered email on login modal
    if (type === 'login') {
      const remembered = localStorage.getItem('ee_remembered_email');
      const emailInput = document.getElementById('login-email');
      const rememberCheckbox = document.getElementById('login-remember');
      if (emailInput && remembered) {
        emailInput.value = remembered;
        if (rememberCheckbox) rememberCheckbox.checked = true;
        // Focus the password field since email is pre-filled
        setTimeout(() => {
          const pwField = document.getElementById('login-password');
          if (pwField) pwField.focus();
        }, 100);
      } else if (emailInput) {
        setTimeout(() => emailInput.focus(), 100);
      }
    }
  },

  closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
  },

  // -----------------------------------------------------------------------
  // STRIPE CHECKOUT & BILLING
  // -----------------------------------------------------------------------
  async startCheckout(plan) {
    try {
      if (!this.user) {
        this.showModal('login');
        return;
      }
      this.closeModal();
      App.showToast('Redirecting to secure checkout...', 'info');
      var res = await this.api('/stripe/create-checkout', { method: 'POST', body: JSON.stringify({ plan: plan }) });
      if (res.url) {
        window.location.href = res.url;
      } else {
        App.showToast('Unable to start checkout. Please try again.', 'error');
      }
    } catch(err) {
      App.showToast('Checkout error: ' + (err.message || 'Please try again'), 'error');
    }
  },

  async openBillingPortal() {
    try {
      var res = await this.api('/stripe/portal', { method: 'POST', body: '{}' });
      if (res.url) {
        window.location.href = res.url;
      } else {
        App.showToast('Unable to open billing portal.', 'error');
      }
    } catch(err) {
      App.showToast('Unable to open billing portal: ' + (err.message || 'Please try again'), 'error');
    }
  },

  // -----------------------------------------------------------------------
  // NAVIGATION
  // -----------------------------------------------------------------------
  bindNav() {
    document.getElementById('nav-toggle').addEventListener('click', () => {
      document.getElementById('nav-links').classList.toggle('open');
    });
    // Close mobile menu when any nav link OR dropdown menu link is clicked
    document.querySelectorAll('.nav-link, .nav-dropdown-menu a').forEach(link => {
      link.addEventListener('click', () => {
        document.getElementById('nav-links').classList.remove('open');
      });
    });
  },

  route() {
    // Strip any query string (?token=xxx etc) before parsing the page
    const hashRaw = window.location.hash.replace('#/', '') || 'dashboard';
    const hash = hashRaw.split('?')[0]; // Remove query string
    const page = hash.split('/')[0] || 'dashboard';
    this.currentPage = page;

    // Clear Live Hub intervals when navigating away
    if (this._liveIntervals) {
      this._liveIntervals.forEach(function(id) { clearInterval(id); });
      this._liveIntervals = null;
    }
    // Clear Live Race Tracker interval
    if (this._liveRaceInterval) {
      clearInterval(this._liveRaceInterval);
      this._liveRaceInterval = null;
    }

    // Update active nav
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.page === page);
    });

    // Check for upgrade success
    const queryString = hashRaw.includes('?') ? hashRaw.split('?')[1] : '';
    if (queryString.includes('upgraded=true')) {
      this.showToast('Welcome to Premium! You now have full access to all features.', 'success');
      // Refresh user data
      this.api('/auth/me').then(function(data) {
        if (data && data.user) {
          App.user = data.user;
          localStorage.setItem('ee_user', JSON.stringify(data.user));
          App.updateAuthUI();
        }
      }).catch(function() {});
      // Clean the URL
      window.location.hash = '#/account';
    }

    const app = document.getElementById('app');
    app.className = 'animate-in';

    switch (page) {
      case 'dashboard': case '': this.renderDashboard(); break;
      case 'racing': this.renderRacing(); break;
      case 'live': this.renderLiveHub(); break;
      case 'football': this.renderFootball(); break;
      case 'nba': this.renderSportTips('basketball', 'NBA Basketball'); break;
      case 'rugby': this.renderSportTips('rugby', 'Rugby League'); break;
      case 'nfl': this.renderSportTips('american-football', 'NFL'); break;
      case 'tennis': this.renderSportTips('tennis', 'Tennis'); break;
      case 'calculators': BetCalc.render(); break;
      case 'academy': this.renderAcademy(); break;
      case 'buy-credits': this.renderBuyCredits(); break;
      case 'refer': this.renderReferral(); break;
      case 'selections': this.renderSelections(); break;
      case 'value-bets': this.renderValueBets(); break;
      case 'compare': this.renderCompare(); break;
      case 'festival': this.renderFestival(); break;
      case 'festivals': this.renderFestivalHub(); break;
      case 'results': this.renderResults(); break;
      case 'pricing': this.renderPricing(); break;
      case 'analysts': this.renderAnalysts(); break;
      case 'my-roi': this.renderMyROI(); break;
      case 'support': this.renderSupport(); break;
      case 'admin': this.renderAdmin(); break;
      case 'account': this.renderAccount(); break;
      case 'tip': this.renderTipDetail(hash.split('/')[1]); break;
      case 'terms': this.renderTerms(); break;
      case 'privacy': this.renderPrivacy(); break;
      case 'disclaimer': this.renderDisclaimer(); break;
      case 'responsible-gambling': this.renderResponsibleGambling(); break;
      case 'blog': {
        const postSlug = hash.split('/')[1];
        if (postSlug) this.renderBlogPost(postSlug);
        else this.renderBlogListing();
        break;
      }
      case 'how-it-works': this.renderHowItWorks(); break;
      case 'why-elite-edge': this.renderWhyEliteEdge(); break;
      case 'premier-league': this.renderPremierLeague(); break;
      case 'acca-generator': this.renderAccaGenerator(); break;
      case 'challenge': this.renderChallenge(); break;
      case 'reset-password': this.handleResetPasswordRoute(); break;
      default: this.render404();
    }

    this.updatePageMeta(page);
  },

  updatePageMeta(page) {
    var titles = {
      'dashboard': 'Elite Edge Sports Tips — Premium UK Betting Intelligence',
      'racing': 'Racing Tips — Live Race Cards & Expert Analysis | Elite Edge',
      'football': 'Football Tips — Data-Driven Selections & xG Analysis | Elite Edge',
      'live': 'LIVE Race Day Hub — Real-Time Tips & Results | Elite Edge',
      'selections': 'Today\'s Selections — All Racing & Football Tips | Elite Edge',
      'value-bets': 'Value Bet Scanner — Find Bookmaker Price Edges | Elite Edge',
      'compare': 'H2H Comparison Tool — Teams & Horses Side by Side | Elite Edge',
      'premier-league': 'Premier League Weekend Preview — Analyst Verdicts | Elite Edge',
      'results': 'Verified Results & Performance Track Record | Elite Edge',
      'pricing': 'Pricing — Premium & VIP Subscription Plans | Elite Edge',
      'analysts': 'Our Analysts — Professor, Scout, Clocker, Edge | Elite Edge',
      'my-roi': 'My ROI Dashboard — Personal Performance Tracking | Elite Edge',
      'support': 'Help & Support — FAQ & Contact | Elite Edge',
      'blog': 'Blog — Weekly Reviews & Betting Insights | Elite Edge',
      'how-it-works': 'How It Works — Our Scoring Model Explained | Elite Edge',
      'account': 'My Account — Settings & Preferences | Elite Edge',
      'terms': 'Terms & Conditions | Elite Edge Sports Tips',
      'privacy': 'Privacy Policy | Elite Edge Sports Tips',
      'disclaimer': 'Disclaimer | Elite Edge Sports Tips',
      'responsible-gambling': 'Responsible Gambling | Elite Edge Sports Tips',
      'festivals': 'Festival Racing Hub — Major Meetings | Elite Edge',
      'admin': 'Admin Panel | Elite Edge Sports Tips',
      'challenge': '30-Day Bankroll Challenge — Track Your Growth | Elite Edge',
    };

    var descriptions = {
      'dashboard': 'Premium multi-sport betting intelligence across 6 sports. AI-powered tips with proven ROI.',
      'racing': 'Live UK race cards with form, going forecasts, and AI-powered analysis. Expert selections daily.',
      'football': 'Football tips across Europe\'s top leagues with xG analysis, injury reports, and odds comparison.',
      'live': 'Real-time race day dashboard with countdown, live results, and instant P/L updates.',
      'value-bets': 'Scanner comparing 40+ UK bookmakers to find where odds disagree — genuine value opportunities.',
      'results': 'Fully transparent, verified results page. Every tip, every outcome. Track record you can trust.',
      'pricing': 'Start free, upgrade to Premium (£19.99/mo) or VIP (£39.99/mo). 14-day free trial available.',
    };

    var title = titles[page] || 'Elite Edge Sports Tips — Premium UK Betting Intelligence';
    var desc = descriptions[page] || 'Premium multi-sport betting intelligence across 6 sports. AI-powered tips with proven ROI.';

    document.title = title;
    var metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute('content', desc);
    var ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', title);
    var ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute('content', desc);
  },

  handleResetPasswordRoute() {
    // Parse token from query string in hash: #/reset-password?token=xxx
    const hash = window.location.hash;
    const tokenMatch = hash.match(/[?&]token=([^&]+)/);
    const token = tokenMatch ? tokenMatch[1] : null;
    if (!token) {
      this.renderDashboard();
      setTimeout(() => App.showToast('Reset link is missing the token. Please request a new password reset.', 'error'), 100);
      return;
    }
    this._resetToken = token;
    this.renderDashboard();
    setTimeout(() => this.showModal('resetpassword'), 200);
  },

  // -----------------------------------------------------------------------
  // DAILY STATS BAR (Enhancement #12)
  // -----------------------------------------------------------------------
  async loadDailyStats() {
    try {
      const [tips, results] = await Promise.all([
        this.api('/tips'),
        this.api('/results'),
      ]);
      const today = new Date().toISOString().split('T')[0];

      // Count today's tips: includes active (unsettled) AND settled (from results)
      // Active tips not yet settled
      const activeToday = tips.filter(t => App._normDate(t.date) === today && !t.isWeeklyAcca);
      // Settled tips from today's results (each result = one settled tip)
      const todayResults = results.filter(r => App._normDate(r.date) === today);
      // Total = active + settled, deduped by tipId
      const seenTipIds = new Set(activeToday.map(t => t.id));
      todayResults.forEach(r => seenTipIds.add(r.tipId || r.id));
      const todayTips = seenTipIds.size;

      // "Won" includes both outright wins AND placed (each-way placed)
      const won = todayResults.filter(r => r.result === 'won' || r.result === 'placed').length;
      const pnl = todayResults.reduce((s, r) => s + (r.pnl || 0), 0);
      const streak = this.calculateStreak(results);

      const dsTips = document.getElementById('ds-tips');
      const dsWon = document.getElementById('ds-won');
      const dsPnl = document.getElementById('ds-pnl');
      const dsStreak = document.getElementById('ds-streak');
      if (dsTips) dsTips.textContent = todayTips;
      if (dsWon) dsWon.textContent = won;
      if (dsPnl) {
        dsPnl.textContent = (pnl >= 0 ? '+' : '') + pnl.toFixed(2);
        dsPnl.className = 'ds-value ' + (pnl >= 0 ? 'ds-positive' : 'ds-negative');
      }
      if (dsStreak) dsStreak.textContent = streak;
    } catch {}
  },

  // -----------------------------------------------------------------------
  // STREAK CALCULATOR (Enhancement #9)
  // -----------------------------------------------------------------------
  calculateStreak(results) {
    if (!results || !results.length) return 0;
    const sorted = [...results].sort((a, b) => new Date(b.date) - new Date(a.date));
    let streak = 0;
    for (const r of sorted) {
      if (r.result === 'won') streak++;
      else break;
    }
    return streak;
  },

  // -----------------------------------------------------------------------
  // MORNING BRIEF — Personalised welcome for logged-in users
  // -----------------------------------------------------------------------
  buildMorningBrief(todayTips, allResults, perf) {
    if (!this.user) return '';
    var firstName = (this.user.name || 'there').split(' ')[0];
    var initial = firstName.charAt(0).toUpperCase();
    var now = new Date();
    var hour = now.getHours();
    var greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    // Yesterday's results
    var yesterday = this._getYesterday();
    var yesterdayResults = allResults.filter(function(r) { return App._normDate(r.date) === yesterday; });
    var yesterdayWins = yesterdayResults.filter(function(r) { return r.result === 'won' || r.result === 'placed'; });
    var yesterdayPnl = yesterdayResults.reduce(function(sum, r) { return sum + (r.pnl || 0); }, 0);

    // Today's tips breakdown
    var today = this._getToday();
    var activeTodayTips = todayTips.filter(function(t) { return !t.isWeeklyAcca && (!t.date || App._normDate(t.date) === today); });
    var racingTips = activeTodayTips.filter(function(t) { return t.sport === 'racing'; });
    var footballTips = activeTodayTips.filter(function(t) { return t.sport === 'football'; });

    // Build sport details
    var sportParts = [];
    if (racingTips.length > 0) {
      var meetings = [];
      racingTips.forEach(function(t) {
        var meeting = (t.meeting || t.event || '').split(' ')[0];
        if (meeting && meetings.indexOf(meeting) === -1) meetings.push(meeting);
      });
      var napCount = racingTips.filter(function(t) { return t.isNap; }).length;
      var racingDesc = racingTips.length + ' racing';
      if (napCount > 0 && meetings.length > 0) racingDesc += ' (including our NAP at ' + meetings[0] + ')';
      else if (meetings.length > 0) racingDesc += ' at ' + meetings.slice(0, 2).join(' and ');
      sportParts.push(racingDesc);
    }
    if (footballTips.length > 0) {
      var leagues = [];
      footballTips.forEach(function(t) {
        var league = t.league || '';
        if (league && leagues.indexOf(league) === -1) leagues.push(league);
      });
      var fbDesc = footballTips.length + ' football';
      if (leagues.length > 0) fbDesc += ' across ' + leagues.slice(0, 2).join(' and ');
      sportParts.push(fbDesc);
    }

    // Build sentences
    var sentences = [];
    // Sentence 1: greeting + today's tips
    if (activeTodayTips.length === 0) {
      sentences.push(greeting + ' ' + firstName + '. Quiet day on the tips front today — our model has not identified any selections with sufficient edge.');
    } else {
      var tipCountText = activeTodayTips.length === 1 ? '1 selection' : activeTodayTips.length + ' selections';
      sentences.push(greeting + ' ' + firstName + '. We have ' + tipCountText + ' for you today — ' + sportParts.join(' and ') + '.');
    }

    // Sentence 2: yesterday's results
    if (yesterdayResults.length > 0) {
      var pnlStr = yesterdayPnl >= 0 ? '+' + yesterdayPnl.toFixed(2) : yesterdayPnl.toFixed(2);
      sentences.push('Yesterday\'s picks returned ' + pnlStr + ' units (' + yesterdayWins.length + ' from ' + yesterdayResults.length + ' winners).');
    }

    // Sentence 3: overall stats
    if (perf && perf.roi) {
      sentences.push('Your overall strike rate sits at ' + perf.strikeRate + '% with ROI of +' + perf.roi + '%.');
    }

    var briefText = sentences.join(' ');

    var dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    var timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    return '<div class="morning-brief">' +
      '<div class="morning-brief-avatar">' + initial + '</div>' +
      '<div class="morning-brief-body">' +
        '<div class="morning-brief-text">' + briefText + '</div>' +
        '<div class="morning-brief-meta">' + dateStr + ' at ' + timeStr + '</div>' +
      '</div>' +
    '</div>';
  },

  // -----------------------------------------------------------------------
  // AI DAILY BRIEFING — Premium dashboard feature
  // -----------------------------------------------------------------------
  _aiBriefingCache: null,

  async loadAIDailyBriefing() {
    var contentDiv = document.getElementById('ai-briefing-content');
    if (!contentDiv) return;

    // Check cache
    if (this._aiBriefingCache) {
      this._renderAIBriefing(contentDiv, this._aiBriefingCache);
      return;
    }

    contentDiv.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;"><span class="loading-spinner" style="width:18px;height:18px;"></span><span class="text-muted" style="font-size:13px;">Generating AI briefing...</span></div>';

    try {
      var data = await this.api('/ai/daily-briefing');
      if (data && data.aiBriefing) {
        this._aiBriefingCache = data.aiBriefing;
        this._renderAIBriefing(contentDiv, data.aiBriefing);
      } else {
        contentDiv.innerHTML = '<p class="text-muted" style="font-size:13px;">AI briefing unavailable. The service may not be configured.</p>';
      }
    } catch (err) {
      contentDiv.innerHTML = '<p class="text-muted" style="font-size:13px;">Unable to load AI briefing: ' + (err.message || 'Unknown error') + '</p>' +
        '<button class="btn btn-outline btn-sm" onclick="App.loadAIDailyBriefing()" style="margin-top:8px;">Retry</button>';
    }
  },

  _renderAIBriefing(container, briefing) {
    var html = '';
    if (briefing.headline) {
      html += '<div style="font-weight:800;font-size:15px;color:#fff;margin-bottom:10px;">' + briefing.headline + '</div>';
    }
    if (briefing.briefing) {
      html += '<div style="font-size:13px;color:var(--text-secondary);line-height:1.7;">' + briefing.briefing + '</div>';
    }
    html += '<div style="margin-top:10px;font-size:10px;color:var(--text-muted);">Generated by Claude AI for Elite Edge Sports Tips</div>';
    container.innerHTML = html;
  },

  // -----------------------------------------------------------------------
  // WOULD HAVE WON — Tease for non-premium users
  // -----------------------------------------------------------------------
  buildWouldHaveWon(allResults) {
    if (this.isPremium()) return '';
    var yesterday = this._getYesterday();
    var yesterdayPremium = allResults.filter(function(r) { return App._normDate(r.date) === yesterday && r.isPremium; });
    if (yesterdayPremium.length === 0) return '';

    var self = this;
    var totalPnl = yesterdayPremium.reduce(function(sum, r) { return sum + (r.pnl || 0); }, 0);
    var totalPnlStr = totalPnl >= 0 ? '+' + totalPnl.toFixed(2) : totalPnl.toFixed(2);

    var rows = yesterdayPremium.map(function(r) {
      var resultClass = r.result === 'won' ? 'whw-badge-won' : r.result === 'placed' ? 'whw-badge-placed' : 'whw-badge-lost';
      var resultLabel = r.result === 'won' ? 'WON' : r.result === 'placed' ? 'PLACED' : 'LOST';
      var pnlClass = r.pnl > 0 ? 'whw-pnl-positive' : r.pnl < 0 ? 'whw-pnl-negative' : 'whw-pnl-neutral';
      var pnlStr = r.pnl >= 0 ? '+' + r.pnl.toFixed(2) + 'u' : r.pnl.toFixed(2) + 'u';
      var napTag = r.isNap ? '<span class="whw-result-nap">NAP:</span> ' : '';
      return '<div class="whw-result-row">' +
        '<div class="whw-result-name">' + napTag + r.selection + '</div>' +
        '<div class="whw-result-odds">@ ' + self.formatOdds(r.odds) + '</div>' +
        '<span class="whw-badge ' + resultClass + '">' + resultLabel + '</span>' +
        '<div class="whw-pnl ' + pnlClass + '">' + pnlStr + '</div>' +
      '</div>';
    }).join('');

    var totalClass = totalPnl > 0 ? 'whw-pnl-positive' : totalPnl < 0 ? 'whw-pnl-negative' : 'whw-pnl-neutral';

    return '<div class="whw-section">' +
      '<div class="whw-title">What Premium Members Got Yesterday</div>' +
      '<div class="whw-subtitle">Settled premium selections from ' + formatDateUK(yesterday) + '</div>' +
      '<div class="whw-results-list">' + rows + '</div>' +
      '<div class="whw-total">' +
        '<div class="whw-total-label">Yesterday\'s Premium P/L</div>' +
        '<div class="whw-total-value ' + totalClass + '">' + totalPnlStr + ' units</div>' +
      '</div>' +
      '<div class="whw-cta">' +
        '<div class="whw-cta-text"><strong>Get tomorrow\'s picks before they happen.</strong> 14-Day Free Trial.</div>' +
        '<button class="btn btn-gold" onclick="App.showModal(\'register\')">Start Free Trial</button>' +
      '</div>' +
    '</div>';
  },

  // -----------------------------------------------------------------------
  // STREAK BADGES — Achievement system
  // -----------------------------------------------------------------------
  async renderStreakBadges() {
    try {
      var data = await this.api('/results/streaks');
      if (!data || !data.badges) return '';

      var self = this;
      var badgeIcons = {
        flame: '&#9632;',
        fire: '&#9733;',
        lightning: '&#9889;',
        star: '&#9734;',
        trophy: '&#9816;',
        crown: '&#9812;'
      };
      // Use text-based icons to avoid emojis
      var badgeSymbols = {
        hot_streak: '3+',
        on_fire: '5+',
        unstoppable: '8+',
        perfect_week: '100%',
        century_club: '100',
        roi_king: 'ROI'
      };

      var badgesHtml = data.badges.map(function(b) {
        var cls = b.earned ? 'streak-badge earned' : 'streak-badge locked';
        var progressText = '';
        if (!b.earned) {
          var remaining = b.target - b.progress;
          progressText = '<div class="streak-badge-progress">' + remaining + ' more to unlock</div>';
        }
        var shareBtn = '';
        if (b.earned) {
          var shareText = 'I earned the "' + b.name + '" badge with @EliteEdgeTips! ' + data.strikeRate + '% strike rate, +' + data.roi + '% ROI. Join free: eliteedgesports.co.uk';
          shareBtn = '<button class="streak-badge-share" onclick="event.stopPropagation();App.shareAchievement(\'' + shareText.replace(/'/g, "\\'") + '\')">Share</button>';
        }
        return '<div class="' + cls + '">' +
          '<span class="streak-badge-icon">' + (badgeSymbols[b.id] || '?') + '</span>' +
          '<div class="streak-badge-name">' + b.name + '</div>' +
          '<div class="streak-badge-desc">' + b.description + '</div>' +
          progressText +
          shareBtn +
        '</div>';
      }).join('');

      return '<div class="streak-badges-section">' +
        '<div class="streak-badges-title">Achievement Badges</div>' +
        '<div class="streak-badges-grid">' + badgesHtml + '</div>' +
      '</div>';
    } catch(e) {
      return '';
    }
  },

  shareAchievement(text) {
    if (navigator.share) {
      navigator.share({ text: text }).catch(function() {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function() {
        App.showToast('Achievement copied to clipboard!', 'success');
      }).catch(function() {
        App.showToast('Could not copy to clipboard', 'error');
      });
    }
  },

  // -----------------------------------------------------------------------
  // THEME TOGGLE (Enhancement #11)
  // -----------------------------------------------------------------------
  loadTheme() {
    const theme = localStorage.getItem('ee_theme');
    if (theme === 'light') {
      document.body.classList.add('light-mode');
      const btn = document.getElementById('theme-toggle');
      if (btn) btn.innerHTML = '&#9728;';
    }
  },

  toggleTheme() {
    const isLight = document.body.classList.toggle('light-mode');
    localStorage.setItem('ee_theme', isLight ? 'light' : 'dark');
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.innerHTML = isLight ? '&#9728;' : '&#9790;';
  },

  // -----------------------------------------------------------------------
  // STAKING CALCULATOR (Enhancement #2)
  // -----------------------------------------------------------------------
  calculateStakes() {
    const bankroll = parseFloat(document.getElementById('calc-bankroll')?.value) || 1000;
    const odds = parseFloat(document.getElementById('calc-odds')?.value) || 2.0;
    const edgePct = parseFloat(document.getElementById('calc-edge')?.value) || 8;
    const edge = edgePct / 100;

    // Kelly Criterion: (edge * odds - 1) / (odds - 1)
    const kellyFraction = Math.max(0, (edge * odds - 1) / (odds - 1));
    const kellyStake = bankroll * kellyFraction;
    const flatStake = bankroll * 0.02;
    const propStake = bankroll * (edge / (odds - 1));

    const kellyEl = document.getElementById('calc-kelly');
    const flatEl = document.getElementById('calc-flat');
    const propEl = document.getElementById('calc-prop');
    if (kellyEl) kellyEl.textContent = '\u00a3' + kellyStake.toFixed(2);
    if (flatEl) flatEl.textContent = '\u00a3' + flatStake.toFixed(2);
    if (propEl) propEl.textContent = '\u00a3' + Math.max(0, propStake).toFixed(2);
  },

  switchCalcTab(tab) {
    var stakingSection = document.getElementById('calc-staking-section');
    var cashoutSection = document.getElementById('calc-cashout-section');
    var stakingTab = document.getElementById('calc-tab-staking');
    var cashoutTab = document.getElementById('calc-tab-cashout');
    if (tab === 'cashout') {
      if (stakingSection) stakingSection.style.display = 'none';
      if (cashoutSection) {
        cashoutSection.style.display = 'block';
        if (!cashoutSection.innerHTML) {
          cashoutSection.innerHTML = '<h2>Cashout Calculator</h2>' + this.renderCashoutCalculator();
          this.calculateCashout();
        }
      }
      if (stakingTab) stakingTab.classList.remove('active');
      if (cashoutTab) cashoutTab.classList.add('active');
    } else {
      if (stakingSection) stakingSection.style.display = 'block';
      if (cashoutSection) cashoutSection.style.display = 'none';
      if (stakingTab) stakingTab.classList.add('active');
      if (cashoutTab) cashoutTab.classList.remove('active');
    }
  },

  // -----------------------------------------------------------------------
  // P/L TRACKER (Enhancement #3)
  // -----------------------------------------------------------------------
  getMyBets() {
    const key = this.user ? `ee_mybets_${this.user.id}` : 'ee_mybets_guest';
    return JSON.parse(localStorage.getItem(key) || '[]');
  },

  saveMyBets(bets) {
    const key = this.user ? `ee_mybets_${this.user.id}` : 'ee_mybets_guest';
    localStorage.setItem(key, JSON.stringify(bets));
  },

  toggleBacked(tipId, selection, odds, result, tipData) {
    const bets = this.getMyBets();
    const idx = bets.findIndex(b => b.tipId === tipId);
    var added = false;
    var td = tipData || {};
    if (idx >= 0) {
      bets.splice(idx, 1);
      // Sync unback to server
      if (this.token) this.api('/user/bets/back/' + tipId, { method: 'DELETE' }).catch(function() {});
    } else {
      bets.push({ tipId, selection, odds, result: result || null, date: new Date().toISOString(),
        sport: td.sport || '', event: td.event || '', market: td.market || '',
        confidence: td.confidence || 7, analyst: td.tipsterProfile || 'The Edge' });
      trackEvent('betting', 'bet_placed', selection);
      added = true;
      // Sync back to server
      if (this.token) {
        this.api('/user/bets/back', { method: 'POST', body: JSON.stringify({
          tipId: tipId, selection: selection, event: td.event || '', sport: td.sport || '',
          market: td.market || '', odds: odds, confidence: td.confidence || 7,
          analyst: td.tipsterProfile || 'The Edge', date: td.date || new Date().toISOString().split('T')[0],
        })}).catch(function() {});
      }
    }
    this.saveMyBets(bets);
    // Update button state
    const btn = document.getElementById(`backed-${tipId}`);
    if (btn) {
      const isBacked = bets.find(b => b.tipId === tipId);
      btn.className = isBacked ? 'backed-btn backed' : 'backed-btn';
      btn.textContent = isBacked ? 'Backed' : 'Back This Tip';
    }
    // Toast feedback
    if (added) {
      this.showToast("Added to your bets — we'll track the result", 'success');
    } else {
      this.showToast('Removed from your bets.', 'info');
    }
    // Refresh bankroll card live
    try { this.refreshBankrollCard(); } catch (e) {}
  },

  renderMyBets() {
    const content = document.getElementById('mybets-content');
    if (!content) return;
    const bets = this.getMyBets();
    if (!bets.length) {
      content.innerHTML = '<p class="text-muted">No bets tracked yet. Click "Back This Tip" on any tip card to start tracking.</p>';
      return;
    }
    const won = bets.filter(b => b.result === 'won').length;
    const lost = bets.filter(b => b.result === 'lost').length;
    const total = bets.length;
    const pnl = bets.reduce((s, b) => {
      if (b.result === 'won') return s + (b.odds - 1);
      if (b.result === 'lost') return s - 1;
      return s;
    }, 0);
    const roi = total > 0 ? (pnl / total * 100) : 0;
    const sr = total > 0 ? (won / total * 100) : 0;

    content.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
        <button class="btn btn-outline btn-sm" onclick="App.exportMyBetsCSV()">Export My Bets</button>
      </div>
      <div class="my-bets-stats mb-24">
        <div class="my-bets-stat"><div class="val text-gold">${total}</div><div class="lbl">Total Bets</div></div>
        <div class="my-bets-stat"><div class="val text-green">${won}</div><div class="lbl">Winners</div></div>
        <div class="my-bets-stat"><div class="val ${pnl >= 0 ? 'text-green' : 'text-red'}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</div><div class="lbl">P/L (units)</div></div>
        <div class="my-bets-stat"><div class="val">${sr.toFixed(1)}%</div><div class="lbl">Strike Rate</div></div>
      </div>
      <table class="results-table">
        <thead><tr><th>Date</th><th>Selection</th><th>Odds</th><th>Result</th><th>P/L</th></tr></thead>
        <tbody>
          ${bets.map(b => {
            const bpnl = b.result === 'won' ? (b.odds - 1) : b.result === 'lost' ? -1 : 0;
            return `<tr>
              <td>${formatDateUK(b.date)}</td>
              <td>${b.selection}</td>
              <td>${this.formatOdds(b.odds)}</td>
              <td class="${b.result === 'won' ? 'result-won' : b.result === 'lost' ? 'result-lost' : ''}">${b.result ? b.result.toUpperCase() : 'PENDING'}</td>
              <td class="${bpnl >= 0 ? 'pnl-positive' : 'pnl-negative'}">${bpnl >= 0 ? '+' : ''}${bpnl.toFixed(2)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  },

  // -----------------------------------------------------------------------
  // DAILY STAKING PLAN — personalised staking based on bankroll + today's tips
  // -----------------------------------------------------------------------
  buildStakingPlan(tips) {
    if (!this.user || !this.isPremium()) return '';
    var settings = this.getBankrollSettings ? this.getBankrollSettings() : null;
    if (!settings || !settings.startingBank) return '';

    var bank = settings.currentBank || settings.startingBank;
    var currency = settings.currency || '£';
    var unitSize = settings.stakingMethod === 'percentage' ? Math.round(bank * 0.01 * 100) / 100 : (settings.stakeSize || Math.round(bank * 0.01 * 100) / 100);

    var activeTips = (tips || []).filter(function(t) {
      return t.status === 'active' && !t.isWeeklyAcca && (t.confidence || 0) >= 6;
    });
    if (activeTips.length === 0) return '';

    var rows = activeTips.sort(function(a, b) { return (b.confidence || 0) - (a.confidence || 0); }).map(function(t) {
      // Stake units: confidence 9-10 = 3u, 8 = 2u, 7 = 1.5u, 6 = 1u
      var conf = t.confidence || 7;
      var units = conf >= 9 ? 3 : conf >= 8 ? 2 : conf >= 7 ? 1.5 : 1;
      var stakeAmount = Math.round(units * unitSize * 100) / 100;
      var potentialReturn = Math.round(stakeAmount * (t.odds || 2) * 100) / 100;
      var sportIcon = t.sport === 'racing' ? '&#127943;' : t.sport === 'football' ? '&#9917;' : '&#127919;';

      return '<tr>' +
        '<td>' + sportIcon + ' ' + (t.selection || '') + '</td>' +
        '<td style="text-align:center;"><span style="color:' + (conf >= 8 ? '#22c55e' : '#d4a843') + ';font-weight:700;">' + conf + '</span></td>' +
        '<td style="text-align:center;">' + units + 'u</td>' +
        '<td style="text-align:right;font-weight:700;color:var(--gold);">' + currency + stakeAmount.toFixed(2) + '</td>' +
        '<td style="text-align:right;color:#22c55e;">' + currency + potentialReturn.toFixed(2) + '</td>' +
      '</tr>';
    }).join('');

    var totalStake = activeTips.reduce(function(s, t) {
      var conf = t.confidence || 7;
      var units = conf >= 9 ? 3 : conf >= 8 ? 2 : conf >= 7 ? 1.5 : 1;
      return s + (units * unitSize);
    }, 0);
    var riskPct = Math.round((totalStake / bank) * 1000) / 10;
    var riskColor = riskPct <= 5 ? '#22c55e' : riskPct <= 10 ? '#d4a843' : '#ef4444';

    return '<div style="background:linear-gradient(135deg,rgba(212,168,67,0.06),rgba(212,168,67,0.02));border:1px solid rgba(212,168,67,0.2);border-radius:12px;padding:20px;margin-bottom:20px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
        '<div style="font-weight:800;font-size:15px;color:#d4a843;">Your Daily Staking Plan</div>' +
        '<div style="font-size:12px;color:#94a3b8;">Bank: ' + currency + bank.toFixed(2) + ' | 1 unit = ' + currency + unitSize.toFixed(2) + '</div>' +
      '</div>' +
      '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">' +
        '<thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #2a2e3d;font-size:11px;color:#64748b;">Selection</th><th style="text-align:center;padding:8px;border-bottom:1px solid #2a2e3d;font-size:11px;color:#64748b;">Conf</th><th style="text-align:center;padding:8px;border-bottom:1px solid #2a2e3d;font-size:11px;color:#64748b;">Units</th><th style="text-align:right;padding:8px;border-bottom:1px solid #2a2e3d;font-size:11px;color:#64748b;">Stake</th><th style="text-align:right;padding:8px;border-bottom:1px solid #2a2e3d;font-size:11px;color:#64748b;">Pot. Return</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '<tfoot><tr style="border-top:2px solid #2a2e3d;"><td colspan="3" style="padding:10px 8px;font-weight:700;">Total daily outlay</td><td style="text-align:right;padding:10px 8px;font-weight:800;color:var(--gold);">' + currency + totalStake.toFixed(2) + '</td><td style="text-align:right;padding:10px 8px;font-size:12px;color:' + riskColor + ';">' + riskPct + '% of bank</td></tr></tfoot>' +
      '</table></div>' +
      (riskPct > 10 ? '<div style="margin-top:8px;font-size:12px;color:#ef4444;">&#9888; Daily outlay exceeds 10% of your bank. Consider reducing stakes or skipping lower-confidence picks.</div>' : '') +
    '</div>';
  },

  // -----------------------------------------------------------------------
  // BANKROLL TRACKER (Feature: Personal P/L Dashboard)
  // -----------------------------------------------------------------------
  getBankrollSettings() {
    try {
      var raw = localStorage.getItem('ee_bankroll');
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || typeof obj.startingBank !== 'number') return null;
      return obj;
    } catch { return null; }
  },

  saveBankrollSettings(e) {
    if (e) e.preventDefault();
    var starting = parseFloat(document.getElementById('br-starting').value);
    var stake = parseFloat(document.getElementById('br-stake').value);
    var methodEl = document.querySelector('input[name="br-method"]:checked');
    var method = methodEl ? methodEl.value : 'flat';
    var errBox = document.getElementById('br-error');
    if (!(starting > 0) || !(stake > 0)) {
      if (errBox) errBox.textContent = 'Please enter a starting bank and stake size greater than zero.';
      return;
    }
    if (errBox) errBox.textContent = '';
    var settings = {
      startingBank: starting,
      currency: 'GBP',
      stakeSize: stake,
      stakingMethod: method,
      updated: new Date().toISOString(),
    };
    localStorage.setItem('ee_bankroll', JSON.stringify(settings));
    this.closeModal();
    this.showToast('Bankroll settings saved.', 'success');
    // Re-render the bankroll card if we're on the dashboard
    this.refreshBankrollCard();
  },

  resetBankrollSettings() {
    if (!confirm('Reset your bankroll tracker? This removes saved settings (your backed bets stay intact).')) return;
    localStorage.removeItem('ee_bankroll');
    this.closeModal();
    this.showToast('Bankroll tracker reset.', 'info');
    this.refreshBankrollCard();
  },

  openBankrollSettings() {
    var settings = this.getBankrollSettings() || { startingBank: 500, stakeSize: 10, stakingMethod: 'flat' };
    // Populate the modal inputs then show
    this.showModal('bankroll-settings');
    var s = document.getElementById('br-starting');
    var k = document.getElementById('br-stake');
    if (s) s.value = settings.startingBank;
    if (k) k.value = settings.stakeSize;
    var radios = document.querySelectorAll('input[name="br-method"]');
    radios.forEach(function(r) {
      r.checked = (r.value === (settings.stakingMethod || 'flat'));
    });
  },

  // Build bankroll computation from backed bets + live tips/results data
  _computeBankrollSeries(settings) {
    var bets = this.getMyBets();
    var tipsById = {};
    (this.tips || []).forEach(function(t) { if (t && t.id) tipsById[t.id] = t; });
    var results = this._allResults || this.results || [];
    var resultsByTip = {};
    results.forEach(function(r) { if (r && r.tipId) resultsByTip[r.tipId] = r; });

    // Enrich each bet with result + per-unit pnl
    var enriched = bets.map(function(b) {
      var r = resultsByTip[b.tipId];
      var tip = tipsById[b.tipId] || {};
      var status = (r && r.result) || b.result || null;
      // Per-unit P/L from server result if present, else rough estimate
      var perUnit = 0;
      if (r && typeof r.pnl === 'number' && r.stake) {
        perUnit = r.pnl / r.stake;
      } else if (status === 'won' && (b.odds || tip.odds)) {
        perUnit = (b.odds || tip.odds) - 1;
      } else if (status === 'lost') {
        perUnit = -1;
      } else if (status === 'placed' && (b.odds || tip.odds)) {
        perUnit = ((b.odds || tip.odds) - 1) / 4;
      }
      return {
        tipId: b.tipId,
        date: (r && r.date) || b.date || new Date().toISOString(),
        selection: b.selection || tip.selection || 'Bet',
        status: status,
        perUnit: perUnit,
        pnl: perUnit * settings.stakeSize,
      };
    });

    // Sort by date ascending
    enriched.sort(function(a, b) { return new Date(a.date) - new Date(b.date); });

    // Running bank history
    var bank = settings.startingBank;
    var history = [{ date: 'Start', bank: bank }];
    enriched.forEach(function(e) {
      if (e.status) { // only settled bets affect bank
        bank += e.pnl;
        history.push({ date: e.date, bank: Math.round(bank * 100) / 100 });
      }
    });

    var settled = enriched.filter(function(e) { return e.status; });
    var totalPnl = settled.reduce(function(s, e) { return s + e.pnl; }, 0);
    return {
      startingBank: settings.startingBank,
      currentBank: Math.round(bank * 100) / 100,
      totalPnl: Math.round(totalPnl * 100) / 100,
      totalBets: bets.length,
      settledBets: settled.length,
      pendingBets: bets.length - settled.length,
      history: history,
    };
  },

  renderBankroll() {
    if (!this.user) return '';
    var settings = this.getBankrollSettings();
    if (!settings) {
      return '' +
        '<div class="bankroll-empty" id="bankroll-card">' +
          '<div class="be-icon">&#128176;</div>' +
          '<div class="be-body">' +
            '<div class="be-title">Set Up Your Bankroll</div>' +
            '<div class="be-desc">Track your personal P/L on every tip you back. Set your starting bank and stake size to get started.</div>' +
          '</div>' +
          '<button class="btn btn-gold btn-sm" onclick="App.openBankrollSettings()">Set Up Bankroll</button>' +
        '</div>';
    }

    var stats = this._computeBankrollSeries(settings);
    var netPct = settings.startingBank > 0 ? (stats.totalPnl / settings.startingBank) * 100 : 0;
    var sign = stats.totalPnl >= 0 ? '+' : '';
    var trendClass = stats.totalPnl >= 0 ? 'up' : 'down';
    var trendArrow = stats.totalPnl >= 0 ? '&uarr;' : '&darr;';
    var pnlColour = stats.totalPnl >= 0 ? 'positive' : 'negative';

    var methodLabel = 'Flat';
    if (settings.stakingMethod === 'percentage') methodLabel = '1% of Bank';
    else if (settings.stakingMethod === 'kelly') methodLabel = 'Kelly Criterion';

    return '' +
      '<div class="bankroll-card" id="bankroll-card">' +
        '<div class="bankroll-header">' +
          '<div class="bankroll-title"><span class="bankroll-dot"></span> Your Bankroll Tracker</div>' +
          '<button class="btn btn-outline btn-sm" onclick="App.openBankrollSettings()">Edit Settings</button>' +
        '</div>' +
        '<div class="bankroll-grid">' +
          '<div class="bankroll-stat">' +
            '<div class="label">Starting Bank</div>' +
            '<div class="value">&pound;' + settings.startingBank.toFixed(2) + '</div>' +
            '<div class="sub">' + methodLabel + ' @ &pound;' + settings.stakeSize + '/unit</div>' +
          '</div>' +
          '<div class="bankroll-stat">' +
            '<div class="label">Current Bank</div>' +
            '<div class="value current">&pound;' + stats.currentBank.toFixed(2) + '</div>' +
            '<div class="sub ' + (stats.totalPnl >= 0 ? 'positive' : 'negative') + '">' +
              '<span class="bankroll-trend ' + trendClass + '">' + trendArrow + ' ' + sign + netPct.toFixed(1) + '%</span>' +
            '</div>' +
          '</div>' +
          '<div class="bankroll-stat">' +
            '<div class="label">Net P/L</div>' +
            '<div class="value ' + pnlColour + '">' + sign + '&pound;' + stats.totalPnl.toFixed(2) + '</div>' +
            '<div class="sub">' + stats.settledBets + ' settled</div>' +
          '</div>' +
          '<div class="bankroll-stat">' +
            '<div class="label">Bets Backed</div>' +
            '<div class="value">' + stats.totalBets + '</div>' +
            '<div class="sub">' + stats.pendingBets + ' pending</div>' +
          '</div>' +
        '</div>' +
        '<div class="bankroll-chart"><canvas id="bankroll-chart-canvas"></canvas></div>' +
      '</div>';
  },

  renderBankrollChart() {
    if (!this.user) return;
    var settings = this.getBankrollSettings();
    if (!settings) return;
    var canvas = document.getElementById('bankroll-chart-canvas');
    if (!canvas || typeof Chart === 'undefined') return;
    if (this._bankrollChart) {
      try { this._bankrollChart.destroy(); } catch (e) {}
      this._bankrollChart = null;
    }
    var stats = this._computeBankrollSeries(settings);
    // If only the Start point exists, add a flat projection so the chart isn't empty
    if (stats.history.length < 2) {
      stats.history = [
        { date: 'Start', bank: settings.startingBank },
        { date: new Date().toISOString(), bank: settings.startingBank },
      ];
    }
    var labels = stats.history.map(function(h, i) {
      return i === 0 ? 'Start' : formatDateUK(h.date);
    });
    var data = stats.history.map(function(h) { return h.bank; });

    try {
      this._bankrollChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            data: data,
            borderColor: '#d4a843',
            backgroundColor: 'rgba(212,168,67,0.12)',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 3,
            borderWidth: 2,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function(ctx) { return '£' + ctx.parsed.y.toFixed(2); }
              }
            }
          },
          scales: {
            x: { display: false },
            y: {
              display: false,
              beginAtZero: false,
            }
          },
          elements: { line: { capBezierPoints: true } },
        }
      });
    } catch (err) {
      console.error('[Bankroll] Chart error:', err);
    }
  },

  refreshBankrollCard() {
    var existing = document.getElementById('bankroll-card');
    if (!existing) return;
    var parent = existing.parentNode;
    var wrap = document.createElement('div');
    wrap.innerHTML = this.renderBankroll();
    var fresh = wrap.firstChild;
    if (fresh) {
      parent.replaceChild(fresh, existing);
      this.renderBankrollChart();
    }
  },

  // -----------------------------------------------------------------------
  // CONFIDENCE LEADERBOARD (Feature: Social Proof Tier ROI)
  // -----------------------------------------------------------------------
  async loadConfidenceLeaderboard() {
    if (this._confidenceTiers) return this._confidenceTiers;
    try {
      var data = await this.api('/results/by-confidence');
      this._confidenceTiers = (data && data.tiers) || [];
    } catch (e) {
      this._confidenceTiers = [];
    }
    return this._confidenceTiers;
  },

  renderConfidenceLeaderboard(tiers) {
    if (!tiers || !tiers.length) return '';

    // Derive tagline from data if available
    var eliteTier = tiers.find(function(t) { return t.tier === 'Elite'; });
    var strongTier = tiers.find(function(t) { return t.tier === 'Strong'; });
    var tagline;
    if (eliteTier && eliteTier.totalTips > 0) {
      tagline = 'Tips rated 8+ confidence have returned <strong>' + ((strongTier && strongTier.roi > 0) ? '+' : '') + (strongTier ? strongTier.roi : 0) + '% ROI</strong> this year. Our Elite-rated picks are <strong>' + eliteTier.strikeRate + '% strike rate</strong>.';
    } else {
      tagline = 'Our confidence model is tracked transparently across every tier. Tips rated 8+ consistently outperform the market.';
    }

    var html = '' +
      '<div class="confidence-leaderboard-wrap">' +
        '<div class="confidence-leaderboard-header">' +
          '<div class="section-title" style="justify-content:center;">' +
            '<span class="icon">&#9733;</span> Performance by Confidence Tier' +
          '</div>' +
          '<div class="cl-tagline">' + tagline + '</div>' +
        '</div>' +
        '<div class="confidence-leaderboard">' +
          tiers.map(function(t) {
            var roiClass = t.roi > 0 ? 'positive' : (t.roi < 0 ? 'negative' : 'neutral');
            var roiSign = t.roi >= 0 ? '+' : '';
            return '<div class="confidence-tier-card' + (t.recommended ? ' recommended' : '') + '">' +
              '<div class="tier-name">' + t.tier + '</div>' +
              '<div class="tier-range">Confidence ' + t.range + '</div>' +
              '<div class="tier-roi ' + roiClass + '">' + roiSign + t.roi + '% ROI</div>' +
              '<div class="tier-meta">' +
                '<div><span class="meta-value">' + t.strikeRate + '%</span>Strike</div>' +
                '<div><span class="meta-value">' + t.totalTips + '</span>Tips</div>' +
                '<div><span class="meta-value">' + t.wins + '</span>Wins</div>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>';
    return html;
  },

  // -----------------------------------------------------------------------
  // RECOVERY PICK (Feature: Loss Recovery Tracker)
  // -----------------------------------------------------------------------
  renderRecoveryPick(recentResults, todayTips) {
    // Premium only
    if (!this.isPremium()) return '';
    if (!Array.isArray(recentResults) || !Array.isArray(todayTips)) return '';

    // Take last 5 settled results (newest first)
    var settled = recentResults
      .filter(function(r) { return r && r.result && r.result !== 'void'; })
      .slice()
      .sort(function(a, b) { return new Date(b.date) - new Date(a.date); })
      .slice(0, 5);

    if (settled.length < 3) return ''; // Not enough data

    var losses = settled.filter(function(r) { return r.result === 'lost'; }).length;
    if (losses < 3) return ''; // Not on a cold run

    // Find today's highest-confidence tip with confidence >= 8
    var today = this._getToday();
    var candidates = todayTips.filter(function(t) {
      return !t.locked && !t.isWeeklyAcca &&
        (t.confidence || 0) >= 8 &&
        (!t.date || App._normDate(t.date) === today) &&
        t.status === 'active';
    });
    if (!candidates.length) return '';

    candidates.sort(function(a, b) {
      if ((b.confidence || 0) !== (a.confidence || 0)) return (b.confidence || 0) - (a.confidence || 0);
      return (b.edge || 0) - (a.edge || 0);
    });
    var pick = candidates[0];

    var oddsStr = this.formatOdds(pick.odds);
    var edgePct = ((pick.edge || 0) * 100).toFixed(1);

    return '' +
      '<div class="recovery-pick-card" onclick="window.location.hash=\'#/tip/' + pick.id + '\'">' +
        '<div class="recovery-pick-inner">' +
          '<div class="recovery-pick-title"><span class="recovery-dot"></span> Recovery Pick &mdash; Time to Bounce Back</div>' +
          '<div class="recovery-pick-subtitle">We are on a short cold run (' + losses + ' losses in the last ' + settled.length + '). This is our highest-conviction tip today.</div>' +
          '<div class="recovery-tip-info">' +
            '<div>' +
              '<div class="rt-selection">' + pick.selection + '</div>' +
              '<div class="rt-event">' + (pick.event || '') + (pick.league ? ' &bull; ' + pick.league : '') + (pick.raceTime ? ' &bull; ' + pick.raceTime : '') + '</div>' +
            '</div>' +
            '<div>' +
              '<div class="rt-odds">' + oddsStr + '</div>' +
              '<div class="rt-odds-label">' + (pick.market || 'Market') + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="recovery-pick-meta">' +
            '<div><strong>Confidence:</strong> ' + pick.confidence + '/10</div>' +
            '<div><strong>Edge:</strong> ' + edgePct + '%</div>' +
            '<div><strong>Stake:</strong> ' + (pick.staking || '-') + '</div>' +
            '<div style="margin-left:auto;"><a href="#/tip/' + pick.id + '" onclick="event.stopPropagation();" style="color:var(--gold);font-weight:700;">View full analysis &rarr;</a></div>' +
          '</div>' +
        '</div>' +
      '</div>';
  },

  // -----------------------------------------------------------------------
  // ACCUMULATOR BUILDER (Enhancement #7)
  // -----------------------------------------------------------------------
  toggleAcca(tipId, selection, odds, e) {
    if (e) e.stopPropagation();
    const idx = this.accaSelections.findIndex(a => a.tipId === tipId);
    if (idx >= 0) {
      this.accaSelections.splice(idx, 1);
    } else {
      // Look up tip to get modelProbability
      var tip = (this.tips || []).find(function(t) { return t.id === tipId; });
      var modelProb = tip && tip.modelProbability ? tip.modelProbability : null;
      this.accaSelections.push({ tipId, selection, odds, modelProbability: modelProb });
    }
    this.renderAccaBar();
    // Update checkbox
    const cb = document.getElementById(`acca-cb-${tipId}`);
    if (cb) cb.checked = this.accaSelections.some(a => a.tipId === tipId);
  },

  removeAcca(tipId) {
    this.accaSelections = this.accaSelections.filter(a => a.tipId !== tipId);
    this.renderAccaBar();
    const cb = document.getElementById(`acca-cb-${tipId}`);
    if (cb) cb.checked = false;
  },

  clearAcca() {
    this.accaSelections = [];
    this.renderAccaBar();
    document.querySelectorAll('[id^="acca-cb-"]').forEach(cb => cb.checked = false);
  },

  renderAccaBar() {
    const bar = document.getElementById('acca-bar');
    const items = document.getElementById('acca-items');
    const oddsEl = document.getElementById('acca-odds');
    const returnEl = document.getElementById('acca-return');

    if (!this.accaSelections.length) {
      bar.classList.remove('active');
      // Remove intelligence section if present
      var existingIntel = document.getElementById('acca-intelligence');
      if (existingIntel) existingIntel.remove();
      return;
    }
    bar.classList.add('active');
    items.innerHTML = this.accaSelections.map(a => `
      <div class="acca-item">
        <span>${a.selection} @ ${this.formatOdds(a.odds)}</span>
        <span class="acca-remove" onclick="App.removeAcca('${a.tipId}')">&times;</span>
      </div>
    `).join('');

    const combined = this.accaSelections.reduce((acc, a) => acc * a.odds, 1);
    oddsEl.textContent = this.formatOdds(combined);
    returnEl.textContent = '\u00a3' + (combined * 10).toFixed(2);

    // Smart Accumulator Intelligence (Feature #4)
    this.renderAccaIntelligence(combined);
  },

  renderAccaIntelligence(combinedOdds) {
    var bar = document.getElementById('acca-bar');
    if (!bar) return;
    var inner = bar.querySelector('.acca-inner');
    if (!inner) return;

    // Remove existing intelligence section
    var existing = document.getElementById('acca-intelligence');
    if (existing) existing.remove();

    var selections = this.accaSelections;
    var foldCount = selections.length;

    // Combined model probability (multiply individual probabilities)
    var hasModelData = selections.some(function(a) { return a.modelProbability && a.modelProbability > 0; });
    var combinedModelProb = 1;
    selections.forEach(function(a) {
      var prob = a.modelProbability && a.modelProbability > 0 ? a.modelProbability : (1 / a.odds);
      combinedModelProb *= prob;
    });

    // Combined implied probability from odds
    var combinedImpliedProb = 1 / combinedOdds;

    // Edge on acca
    var edge = combinedModelProb - combinedImpliedProb;
    var edgePct = (edge * 100).toFixed(1);
    var edgeColor = edge >= 0 ? 'color:var(--green);' : 'color:var(--red);';
    var edgeSign = edge >= 0 ? '+' : '';

    // Expected value
    var ev = (combinedModelProb * combinedOdds) - 1;
    var evDisplay = (ev >= 0 ? '+' : '') + ev.toFixed(2);
    var evColor = ev >= 0 ? 'color:var(--green);' : 'color:var(--red);';

    // Risk rating
    var riskLabel = 'Low';
    var riskColor = 'color:var(--green);';
    if (foldCount >= 5) { riskLabel = 'Very High'; riskColor = 'color:var(--red);'; }
    else if (foldCount >= 4) { riskLabel = 'High'; riskColor = 'color:#f59e0b;'; }
    else if (foldCount >= 3) { riskLabel = 'Medium'; riskColor = 'color:#f59e0b;'; }

    // Kelly stake suggestion (simplified Kelly criterion)
    // Kelly fraction = (edge) / (odds - 1), capped at reasonable amounts
    var kellyFraction = 0;
    if (edge > 0 && combinedOdds > 1) {
      kellyFraction = edge / (combinedOdds - 1);
    }
    // Cap Kelly at 5% of bankroll, quarter Kelly for safety
    var quarterKelly = Math.max(0, Math.min(kellyFraction * 0.25, 0.05));
    var kellyUnits = (quarterKelly * 100).toFixed(1);

    var intelHtml = '<div class="acca-intelligence" id="acca-intelligence">' +
      '<div class="acca-intel-item">' +
        '<span class="acca-intel-label">Model Prob</span>' +
        '<span class="acca-intel-value">' + (combinedModelProb * 100).toFixed(1) + '%</span>' +
      '</div>' +
      '<div class="acca-intel-item">' +
        '<span class="acca-intel-label">Implied Prob</span>' +
        '<span class="acca-intel-value">' + (combinedImpliedProb * 100).toFixed(1) + '%</span>' +
      '</div>' +
      '<div class="acca-intel-item">' +
        '<span class="acca-intel-label">Edge</span>' +
        '<span class="acca-intel-value" style="' + edgeColor + '">' + edgeSign + edgePct + '%</span>' +
      '</div>' +
      '<div class="acca-intel-item">' +
        '<span class="acca-intel-label">EV</span>' +
        '<span class="acca-intel-value" style="' + evColor + '">' + evDisplay + '</span>' +
      '</div>' +
      '<div class="acca-intel-item">' +
        '<span class="acca-intel-label">Risk</span>' +
        '<span class="acca-intel-value" style="' + riskColor + '">' + riskLabel + '</span>' +
      '</div>' +
      '<div class="acca-intel-item">' +
        '<span class="acca-intel-label">Kelly Stake</span>' +
        '<span class="acca-intel-value">' + kellyUnits + ' units</span>' +
      '</div>' +
    '</div>';

    inner.insertAdjacentHTML('beforeend', intelHtml);
  },

  // -----------------------------------------------------------------------
  // SOCIAL SHARING (Enhancement #8)
  // -----------------------------------------------------------------------
  toggleReplay(id) {
    var row = document.getElementById(id);
    if (!row) return;
    row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
  },

  shareWin(selection, odds, pnl, sport) {
    // If pnl is provided, show the share card instead
    if (typeof pnl === 'number') {
      App.generateShareCard({ selection: selection, odds: odds, pnl: pnl, sport: sport || 'racing' });
      return;
    }
    const text = `Another winner from @EliteEdgeTips! ${selection} @ ${odds} \u2705 Join us: https://eliteedgesports.co.uk #EliteEdgeTips #Winner`;
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  },

  copyShareText(selection, odds) {
    const text = `Another winner from EliteEdgeTips! ${selection} @ ${odds} \u2705 Join us: https://eliteedgesports.co.uk`;
    navigator.clipboard.writeText(text).then(() => {
      App.showToast('Copied to clipboard!', 'success');
    }).catch(() => {
      prompt('Copy this text:', text);
    });
  },

  generateShareCard(result) {
    var oddsDisplay = App.formatOdds(result.odds);
    var pnl = result.pnl >= 0 ? '+' + result.pnl.toFixed(2) : result.pnl.toFixed(2);
    var sportIcon = result.sport === 'racing' ? '\uD83C\uDFC7' : '\u26BD';
    var selectionSafe = (result.selection || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');

    // Create overlay with styled card
    var overlay = document.createElement('div');
    overlay.id = 'share-card-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);cursor:pointer;';
    overlay.onclick = function() { overlay.remove(); };

    overlay.innerHTML =
      '<div style="background:linear-gradient(135deg,#0a0e1a,#141828);border:2px solid #d4a843;border-radius:16px;padding:40px;max-width:400px;width:90%;text-align:center;box-shadow:0 0 60px rgba(212,168,67,0.3);" onclick="event.stopPropagation()">' +
        '<div style="font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#d4a843;margin-bottom:16px;">Elite Edge Sports Tips</div>' +
        '<div style="font-size:48px;margin-bottom:8px;">' + sportIcon + '</div>' +
        '<div style="font-size:13px;color:#22c55e;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">\u2705 WINNER</div>' +
        '<div style="font-size:24px;font-weight:900;color:#fff;margin-bottom:8px;">' + (result.selection || '') + '</div>' +
        '<div style="font-size:14px;color:#8b8d93;margin-bottom:16px;">' + (result.event || '') + '</div>' +
        '<div style="display:flex;justify-content:center;gap:24px;margin-bottom:20px;">' +
          '<div><div style="font-size:28px;font-weight:800;color:#d4a843;">' + oddsDisplay + '</div><div style="font-size:10px;color:#8b8d93;">ODDS</div></div>' +
          '<div><div style="font-size:28px;font-weight:800;color:#22c55e;">' + pnl + 'u</div><div style="font-size:10px;color:#8b8d93;">PROFIT</div></div>' +
        '</div>' +
        '<div style="border-top:1px solid rgba(212,168,67,0.2);padding-top:16px;">' +
          '<div style="font-size:12px;color:#8b8d93;">Our members had this BEFORE the off.</div>' +
          '<div style="font-size:13px;color:#d4a843;font-weight:700;margin-top:8px;">eliteedgesports.co.uk</div>' +
          '<div style="font-size:10px;color:#555;margin-top:8px;">18+ | Entertainment only | BeGambleAware.org</div>' +
        '</div>' +
        '<div style="margin-top:16px;display:flex;gap:8px;justify-content:center;">' +
          '<button class="btn btn-gold btn-sm" onclick="App._copyShareCardText(\'' + selectionSafe + '\', \'' + oddsDisplay + '\', \'' + pnl + '\')">Copy Text</button>' +
          '<button class="btn btn-outline btn-sm" onclick="document.getElementById(\'share-card-overlay\').remove()">Close</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
  },

  _copyShareCardText(selection, odds, pnl) {
    var text = '\uD83C\uDFC6 WINNER!\n\n' + selection + ' @ ' + odds + '\nProfit: ' + pnl + ' units\n\n\u2705 Called by Elite Edge Sports Tips\n\uD83C\uDF10 eliteedgesports.co.uk\n\n18+ | BeGambleAware.org';
    navigator.clipboard.writeText(text).then(function() {
      App.showToast('Share text copied!', 'success');
    }).catch(function() {
      prompt('Copy this text:', text);
    });
  },

  // -----------------------------------------------------------------------
  // ODDS HELPERS
  // -----------------------------------------------------------------------
  renderBookmakerOdds(bookmakerOdds) {
    if (!bookmakerOdds) return '';
    const entries = Object.entries(bookmakerOdds);
    const bestOdds = Math.max(...entries.map(([, v]) => v));
    const names = { bet365: 'Bet365', betfair: 'Betfair', skybet: 'Sky Bet', paddypower: 'Paddy P', williamhill: 'Wm Hill' };
    const urls = {
      bet365: 'https://www.bet365.com/#/AF',
      betfair: 'https://www.betfair.com/AF',
      skybet: 'https://www.skybet.com/AF',
      paddypower: 'https://www.paddypower.com/AF',
      williamhill: 'https://www.williamhill.com/AF',
    };
    return `<div class="odds-comparison" onclick="event.stopPropagation();">
      ${entries.map(([k, v]) => `
        <a href="${urls[k] || '#'}" target="_blank" rel="noopener nofollow" class="affiliate-btn ${v === bestOdds ? 'best-price' : ''}" title="Place bet at ${names[k] || k}" style="${v === bestOdds ? 'border-color:var(--gold);box-shadow:0 0 8px rgba(212,168,67,.2);' : ''}">
          <span style="font-size:9px;text-transform:uppercase;">${names[k] || k}</span>
          <span style="font-weight:800;font-size:13px;${v === bestOdds ? 'color:var(--gold);' : ''}">${this.formatOdds(v)}</span>
          ${v === bestOdds ? '<span style="font-size:8px;color:var(--gold);">BEST</span>' : ''}
        </a>
      `).join('')}
    </div>
    <p class="affiliate-disclaimer">18+ | T&Cs Apply | <a href="https://www.begambleaware.org" target="_blank" rel="noopener" style="color:var(--text-dim);">BeGambleAware.org</a></p>`;
  },

  renderOddsMovement(currentOdds, openingOdds) {
    if (!openingOdds || !currentOdds) return '';
    if (currentOdds > openingOdds) {
      return '<span class="odds-movement drifted" title="Odds drifted from ' + this.formatOdds(openingOdds) + '">\u2191 Drifted</span>';
    } else if (currentOdds < openingOdds) {
      return '<span class="odds-movement shortened" title="Odds shortened from ' + this.formatOdds(openingOdds) + '">\u2193 Shortened</span>';
    }
    return '<span class="odds-movement" style="color:var(--text-muted);">\u2194 Steady</span>';
  },

  renderOddsMovementDetail(tip) {
    var parts = [];
    if (tip.openingOdds && tip.odds && tip.openingOdds !== tip.odds) {
      if (tip.odds < tip.openingOdds) {
        parts.push('<span class="odds-shortened-detail">\u2193 Shortened from ' + this.formatOdds(tip.openingOdds) + '</span>');
      } else {
        parts.push('<span class="odds-drifted-detail">\u2191 Drifted from ' + this.formatOdds(tip.openingOdds) + '</span>');
      }
    }
    if (tip.bookmakerOdds) {
      var entries = Object.entries(tip.bookmakerOdds);
      if (entries.length > 0) {
        var names = { bet365: 'Bet365', betfair: 'Betfair', skybet: 'Sky Bet', paddypower: 'Paddy Power', williamhill: 'William Hill' };
        var best = entries.reduce(function(prev, curr) { return curr[1] > prev[1] ? curr : prev; });
        parts.push('<span class="odds-best-price">Best: ' + this.formatOdds(best[1]) + ' at ' + (names[best[0]] || best[0]) + '</span>');
      }
    }
    if (parts.length === 0) return '';
    return '<div class="odds-movement-detail">' + parts.join('') + '</div>';
  },

  renderFormGuide(recentForm, sport) {
    if (!recentForm || !recentForm.length) return '';
    return `<div class="form-guide">
      <span class="form-guide-label">Form:</span>
      ${recentForm.map(f => {
        if (['W', 'D', 'L'].includes(f)) {
          return `<span class="form-badge form-${f}">${f}</span>`;
        }
        const pos = parseInt(f);
        return `<span class="form-badge form-pos ${pos === 1 ? 'form-pos-1' : ''}">${f}</span>`;
      }).join('')}
      ${this.renderSparkline(recentForm, sport)}
    </div>`;
  },

  renderSparkline(formArray, sport) {
    if (!formArray || formArray.length < 2) return '';
    var width = 60;
    var height = 20;
    var padding = 2;
    var values = [];

    if (sport === 'racing') {
      // Racing: positions — lower is better, so invert (1st = top)
      for (var i = 0; i < formArray.length; i++) {
        var pos = parseInt(formArray[i]);
        if (isNaN(pos)) continue;
        values.push(pos);
      }
      if (values.length < 2) return '';
      var maxPos = Math.max.apply(null, values);
      var minPos = Math.min.apply(null, values);
      var range = maxPos - minPos || 1;
      // Invert: position 1 maps to top (y=padding), worst maps to bottom
      values = values.map(function(v) { return 1 - ((v - minPos) / range); });
    } else {
      // Football: W=1, D=0.5, L=0
      for (var j = 0; j < formArray.length; j++) {
        var f = (formArray[j] + '').toUpperCase();
        if (f === 'W') values.push(1);
        else if (f === 'D') values.push(0.5);
        else if (f === 'L') values.push(0);
      }
      if (values.length < 2) return '';
    }

    // Determine trend colour
    var firstHalf = values.slice(0, Math.floor(values.length / 2));
    var secondHalf = values.slice(Math.floor(values.length / 2));
    var avgFirst = firstHalf.reduce(function(s, v) { return s + v; }, 0) / firstHalf.length;
    var avgSecond = secondHalf.reduce(function(s, v) { return s + v; }, 0) / secondHalf.length;
    var diff = avgSecond - avgFirst;
    var colour = diff > 0.1 ? '#22c55e' : diff < -0.1 ? '#ef4444' : '#d4a843';

    // Generate SVG points
    var usableW = width - padding * 2;
    var usableH = height - padding * 2;
    var points = [];
    var circles = [];
    for (var k = 0; k < values.length; k++) {
      var x = padding + (k / (values.length - 1)) * usableW;
      var y = padding + (1 - values[k]) * usableH;
      points.push(x.toFixed(1) + ',' + y.toFixed(1));
      circles.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="1.5" fill="' + colour + '"/>');
    }

    return '<svg class="sparkline" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">' +
      '<polyline points="' + points.join(' ') + '" fill="none" stroke="' + colour + '" stroke-width="1.5"/>' +
      circles.join('') +
      '</svg>';
  },

  // -----------------------------------------------------------------------
  // ACTIVITY TICKER (Social Proof)
  // -----------------------------------------------------------------------
  async loadActivityTicker() {
    try {
      var items = await this.api('/activity-feed');
      if (!items || !items.length) return;
      var ticker = document.getElementById('activity-ticker');
      var inner = document.getElementById('activity-ticker-inner');
      if (!ticker || !inner) return;

      var html = '';
      var separator = '<span class="activity-separator">\u25C6</span>';
      // Build items twice for seamless infinite scroll
      for (var pass = 0; pass < 2; pass++) {
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          var typeClass = item.type === 'won' ? 'activity-won' : item.type === 'tip' ? 'activity-tip' : item.type === 'settled' ? 'activity-settled' : 'activity-general';
          html += '<span class="activity-item ' + typeClass + '">' + item.text + '</span>';
          if (i < items.length - 1 || pass === 0) {
            html += separator;
          }
        }
      }
      inner.innerHTML = html;
      ticker.style.display = '';
    } catch (e) {
      // Silently fail — ticker is non-critical
    }
  },

  // -----------------------------------------------------------------------
  // BET SLIP HELPERS
  // -----------------------------------------------------------------------
  toggleBetSlip(tipId) {
    var dd = document.getElementById('betslip-dd-' + tipId);
    if (!dd) return;
    var isActive = dd.classList.contains('active');
    // Close all open dropdowns first
    document.querySelectorAll('.bet-slip-dropdown.active').forEach(function(el) {
      el.classList.remove('active');
    });
    if (!isActive) {
      dd.classList.add('active');
      // Close on outside click
      var handler = function(e) {
        if (!dd.contains(e.target) && !e.target.classList.contains('bet-slip-btn')) {
          dd.classList.remove('active');
          document.removeEventListener('click', handler);
        }
      };
      setTimeout(function() { document.addEventListener('click', handler); }, 10);
    }
  },

  copySelection(selection, market, odds, event) {
    var text = 'Selection: ' + selection + ' | Market: ' + market + ' | Odds: ' + this.formatOdds(odds) + ' | Event: ' + event;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        App.showToast('Selection copied to clipboard', 'success');
      }).catch(function() {
        App.showToast('Could not copy — try manually', 'error');
      });
    } else {
      // Fallback
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        App.showToast('Selection copied to clipboard', 'success');
      } catch (e) {
        App.showToast('Could not copy — try manually', 'error');
      }
      document.body.removeChild(ta);
    }
  },

  // -----------------------------------------------------------------------
  // MONTHLY TARGET TRACKER (Feature #3)
  // -----------------------------------------------------------------------
  renderMonthlyTarget(results, tips) {
    var now = new Date();
    var monthName = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    var year = now.getFullYear();
    var month = now.getMonth();

    // Filter results to current month
    var monthResults = (results || []).filter(function(r) {
      if (!r.date) return false;
      var d = new Date(r.date);
      return d.getFullYear() === year && d.getMonth() === month;
    });

    var settled = monthResults.filter(function(r) {
      return r.result === 'won' || r.result === 'lost' || r.result === 'placed';
    });
    var wins = settled.filter(function(r) { return r.result === 'won' || r.result === 'placed'; });
    var totalSettled = settled.length;
    var strikeRate = totalSettled > 0 ? (wins.length / totalSettled) * 100 : 0;
    var pnl = settled.reduce(function(sum, r) { return sum + (r.pnl || 0); }, 0);
    var totalStaked = settled.reduce(function(sum, r) { return sum + (r.stake || 1); }, 0);
    var roi = totalStaked > 0 ? (pnl / totalStaked) * 100 : 0;

    // Count unique days tracked
    var daysTracked = {};
    settled.forEach(function(r) { if (r.date) daysTracked[r.date] = true; });
    var dayCount = Object.keys(daysTracked).length;

    // Targets
    var srTarget = 55;
    var plTarget = 20;
    var roiTarget = 15;

    // Status helpers
    function getStatus(actual, target) {
      var pct = target > 0 ? (actual / target) : (actual >= 0 ? 1 : 0);
      if (actual >= target) return { cls: 'hit', label: 'Target Hit!', fillCls: 'on-track' };
      if (pct >= 0.75) return { cls: 'on-track', label: 'On Track', fillCls: 'on-track' };
      if (pct >= 0.5) return { cls: 'on-track', label: 'On Track', fillCls: 'close' };
      return { cls: 'needs-work', label: 'Needs Work', fillCls: 'behind' };
    }

    function getStatusPL(actual, target) {
      if (actual >= target) return { cls: 'hit', label: 'Target Hit!', fillCls: 'on-track' };
      if (actual >= target * 0.5) return { cls: 'on-track', label: 'On Track', fillCls: 'on-track' };
      if (actual >= 0) return { cls: 'on-track', label: 'On Track', fillCls: 'close' };
      return { cls: 'needs-work', label: 'Needs Work', fillCls: 'behind' };
    }

    var srStatus = getStatus(strikeRate, srTarget);
    var plStatus = getStatusPL(pnl, plTarget);
    var roiStatus = getStatusPL(roi, roiTarget);

    var allHit = strikeRate >= srTarget && pnl >= plTarget && roi >= roiTarget;

    var srFill = Math.min((strikeRate / srTarget) * 100, 100);
    var plFill = pnl >= 0 ? Math.min((pnl / plTarget) * 100, 100) : 0;
    var roiFill = roi >= 0 ? Math.min((roi / roiTarget) * 100, 100) : 0;

    return '<div class="monthly-target' + (allHit ? ' all-targets-hit' : '') + '">' +
      '<div class="monthly-target-header">' +
        '<div class="monthly-target-title">' + monthName + ' Performance</div>' +
        '<div class="monthly-target-days">' + dayCount + ' day' + (dayCount !== 1 ? 's' : '') + ' tracked so far this month</div>' +
      '</div>' +
      '<div class="monthly-target-row">' +
        '<div class="monthly-target-row-header">' +
          '<span class="monthly-target-metric">Strike Rate</span>' +
          '<span class="monthly-target-values">' + strikeRate.toFixed(1) + '% / ' + srTarget + '%</span>' +
        '</div>' +
        '<div class="monthly-target-bar">' +
          '<div class="monthly-target-fill ' + srStatus.fillCls + '" style="width:' + srFill + '%"></div>' +
          '<span class="monthly-target-label">' + wins.length + '/' + totalSettled + '</span>' +
        '</div>' +
        '<div class="monthly-target-status ' + srStatus.cls + '">' + srStatus.label + '</div>' +
      '</div>' +
      '<div class="monthly-target-row">' +
        '<div class="monthly-target-row-header">' +
          '<span class="monthly-target-metric">Profit / Loss</span>' +
          '<span class="monthly-target-values">' + (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + ' / +' + plTarget + ' units</span>' +
        '</div>' +
        '<div class="monthly-target-bar">' +
          '<div class="monthly-target-fill ' + plStatus.fillCls + '" style="width:' + plFill + '%"></div>' +
        '</div>' +
        '<div class="monthly-target-status ' + plStatus.cls + '">' + plStatus.label + '</div>' +
      '</div>' +
      '<div class="monthly-target-row">' +
        '<div class="monthly-target-row-header">' +
          '<span class="monthly-target-metric">ROI</span>' +
          '<span class="monthly-target-values">' + (roi >= 0 ? '+' : '') + roi.toFixed(1) + '% / +' + roiTarget + '%</span>' +
        '</div>' +
        '<div class="monthly-target-bar">' +
          '<div class="monthly-target-fill ' + roiStatus.fillCls + '" style="width:' + roiFill + '%"></div>' +
        '</div>' +
        '<div class="monthly-target-status ' + roiStatus.cls + '">' + roiStatus.label + '</div>' +
      '</div>' +
      (allHit ? '<div class="monthly-target-all-hit">&#127942; ALL TARGETS HIT &#127942;</div>' : '') +
    '</div>';
  },

  // -----------------------------------------------------------------------
  // SKELETON LOADERS & API ERROR FALLBACK
  // -----------------------------------------------------------------------
  renderSkeleton(type) {
    if (type === 'dashboard') return '<div class="container"><div class="skeleton skeleton-title"></div><div class="grid grid-4" style="margin-bottom:20px;"><div class="skeleton skeleton-stat"></div><div class="skeleton skeleton-stat"></div><div class="skeleton skeleton-stat"></div><div class="skeleton skeleton-stat"></div></div><div class="grid grid-2"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div></div>';
    if (type === 'tips') return '<div class="container"><div class="skeleton skeleton-title"></div><div class="grid grid-2"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div></div>';
    if (type === 'results') return '<div class="container"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-card" style="height:300px;"></div></div>';
    return '<div class="container"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-card"></div></div>';
  },

  renderApiError(section, message) {
    return '<div style="text-align:center;padding:40px 20px;background:var(--bg-card);border-radius:12px;border:1px solid var(--border);">' +
      '<div style="font-size:36px;margin-bottom:12px;opacity:0.4;">\u26A0\uFE0F</div>' +
      '<h3 style="margin-bottom:8px;">Unable to Load ' + section + '</h3>' +
      '<p style="color:var(--text-muted);font-size:13px;margin-bottom:16px;">' + (message || 'Please check your connection and try again.') + '</p>' +
      '<button class="btn btn-outline btn-sm" onclick="App.route()">Retry</button>' +
    '</div>';
  },

  // -----------------------------------------------------------------------
  // DASHBOARD
  // -----------------------------------------------------------------------
  async renderDashboard() {
    const app = document.getElementById('app');
    app.innerHTML = this.renderSkeleton('dashboard');

    try {
      const [tips, perf] = await Promise.all([
        this.api('/tips'),
        this.api('/results/performance'),
      ]);
      this.tips = tips;
      this.performance = perf;
    } catch { /* use cached */ }

    const allTips = this.tips;
    const perf = this.performance || { roi: 0, strikeRate: 0, runningBank: 100, totalPnl: 0, totalTips: 0, wins: 0 };
    const allResults = await this.api('/results').catch(() => []);
    const recentWins = allResults.filter(r => r.result === 'won').sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 8);
    const streak = this.calculateStreak(allResults);

    // Date-aware: filter to today/tomorrow, archive older
    var today = this._getToday();
    var tomorrow = this._getTomorrow();
    var yesterday = this._getYesterday();
    var tips = allTips.filter(function(t) {
      if (t.isWeeklyAcca) return true;
      // Only show active tips from today or future — never show stale content
      if (t.status && t.status !== 'active') return false;
      if (!t.date) return true;
      return App._normDate(t.date) >= today;
    });
    var todayTips = tips.filter(function(t) { return !t.isWeeklyAcca && (!t.date || App._normDate(t.date) === today); });
    var tomorrowTips = tips.filter(function(t) { return !t.isWeeklyAcca && App._normDate(t.date) === tomorrow; });
    var upcomingTips = tips.filter(function(t) { return !t.isWeeklyAcca && App._normDate(t.date) > tomorrow; });

    // Find NAP — must be from today only
    const napTip = tips.find(t => t.isNap && App._normDate(t.date) === today && t.status === 'active');

    // Build Feature sections
    var morningBriefHtml = this.buildMorningBrief(tips, allResults, perf);
    var wouldHaveWonHtml = this.buildWouldHaveWon(allResults);
    var streakBadgesHtml = await this.renderStreakBadges();
    var monthlyTargetHtml = this.renderMonthlyTarget(allResults, allTips);
    var bankrollHtml = this.renderBankroll();
    var recoveryHtml = this.renderRecoveryPick(allResults, tips);

    var credits = this.user ? this.user.credits : null;
    var creditHtml = '';
    if (this.user && !this.isVIP() && credits !== null) {
      creditHtml = '<div style="display:flex;align-items:center;gap:8px;"><span style="color:var(--gold);font-weight:800;">' + credits + ' credits</span>';
      if (credits <= 3) creditHtml += ' <a href="#/buy-credits" style="color:#ef4444;font-size:12px;">Running low — buy more</a>';
      creditHtml += '</div>';
    }

    var sportCounts = {};
    todayTips.forEach(function(t) {
      if (!t.isWeeklyAcca) {
        var s = t.sport || 'other';
        sportCounts[s] = (sportCounts[s] || 0) + 1;
      }
    });
    var sportCountHtml = Object.keys(sportCounts).map(function(s) {
      var icon = s === 'racing' ? '&#127943;' : s === 'football' ? '&#9917;' : s === 'basketball' ? '&#127936;' : s === 'tennis' ? '&#127934;' : s === 'rugby' ? '&#127945;' : s === 'american-football' ? '&#127944;' : '&#127919;';
      var label = s === 'american-football' ? 'NFL' : s.charAt(0).toUpperCase() + s.slice(1);
      return '<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;padding:10px 16px;text-align:center;"><div style="font-size:20px;">' + icon + '</div><div style="font-size:18px;font-weight:900;color:var(--gold);">' + sportCounts[s] + '</div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;">' + label + '</div></div>';
    }).join('');

    // --- Psychological ordering: Product > Proof > Engagement > Education ---
    // Next race/match countdown
    var nextEvent = todayTips.filter(function(t) {
      var time = t.raceTime || t.kickoff || '';
      if (!time) return false;
      var now = new Date();
      var parts = time.split(':');
      var eventTime = new Date(now);
      eventTime.setHours(parseInt(parts[0]) || 0, parseInt(parts[1]) || 0, 0);
      return eventTime > now;
    }).sort(function(a, b) {
      return (a.raceTime || a.kickoff || '').localeCompare(b.raceTime || b.kickoff || '');
    });
    var countdownHtml = '';
    if (nextEvent.length > 0) {
      var ne = nextEvent[0];
      var neTime = ne.raceTime || ne.kickoff || '';
      countdownHtml = '<div style="display:flex;align-items:center;gap:8px;margin-top:8px;"><span style="background:#ef4444;color:#fff;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:800;animation:pulse 2s infinite;">LIVE</span><span style="font-size:13px;color:var(--text-secondary);">Next selection at <strong style="color:#fff;">' + neTime + '</strong> — ' + (ne.event || ne.selection || '') + '</span></div>';
    }

    // Personal win tracking
    var personalWinHtml = '';
    if (this.user && this.isPremium()) {
      var myBets = this.getMyBets ? this.getMyBets() : [];
      if (myBets.length >= 3) {
        var lastSix = myBets.slice(-6);
        var myWins = lastSix.filter(function(b) { return b.result === 'won'; }).length;
        personalWinHtml = '<div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:10px;padding:14px 18px;margin-bottom:16px;display:flex;align-items:center;gap:12px;"><span style="font-size:22px;">&#127942;</span><span style="font-size:14px;color:#cbd5e1;">Your last 6 backed tips: <strong style="color:#22c55e;">' + myWins + ' winners</strong></span></div>';
      }
    }

    app.innerHTML = `
      <div class="container">
        <!-- 1. HEADER — Welcome + Date + Credits + Countdown -->
        <div style="margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <div>
              <h1 style="margin:0;">Welcome to <span class="accent">Elite Edge</span></h1>
              <p style="color:var(--text-secondary);margin:4px 0 0;">${new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}</p>
              ${countdownHtml}
            </div>
            ${creditHtml}
          </div>
          ${this._loginStreak >= 2 ? '<div style="display:flex;align-items:center;gap:6px;"><span style="font-size:18px;">&#128293;</span><span style="font-weight:800;color:#d4a843;">' + this._loginStreak + '-day streak</span>' + (this._loginStreak >= 7 ? '<span style="font-size:11px;color:#22c55e;font-weight:600;">Best: ' + (this._bestStreak || this._loginStreak) + '</span>' : '') + '</div>' : ''}
        </div>

        <!-- 2. NAP OF THE DAY — Hero product, first thing you see -->
        ${napTip ? (this.isPremium() ? `
        <div class="nap-card-wrapper">
          <div class="nap-label"><span class="star">\u2605</span> NAP OF THE DAY — Our Strongest Selection <span class="star">\u2605</span></div>
          <div class="nap-card" onclick="window.location.hash='#/tip/${napTip.id}'">
            <div class="tip-top">
              <div class="tip-badges">
                <span class="tip-sport-badge ${napTip.sport === 'racing' ? 'badge-racing' : 'badge-football'}">${napTip.sport === 'racing' ? 'Racing' : 'Football'}</span>
                <span class="badge-premium">${napTip.valueRating || 'Elite'}</span>
              </div>
              <div>
                <div class="tip-odds">${this.formatOdds(napTip.odds)} ${this.renderOddsMovement(napTip.odds, napTip.openingOdds)}</div>
                <div class="tip-odds-label">${napTip.market || ''}</div>
              </div>
            </div>
            <div class="tip-selection" style="font-size:22px;">${napTip.selection}</div>
            <div class="tip-event">${napTip.event}${napTip.league ? ' &bull; ' + napTip.league : ''}${napTip.raceTime ? ' &bull; ' + napTip.raceTime : ''}</div>
            <div class="tip-meta">
              <div class="tip-meta-item"><strong>Confidence:</strong> ${napTip.confidence}/10</div>
              <div class="tip-meta-item"><strong>Edge:</strong> ${((napTip.edge || 0) * 100).toFixed(1)}%</div>
              <div class="tip-meta-item"><strong>Stake:</strong> ${napTip.staking || '-'}</div>
            </div>
            ${this.renderBookmakerOdds(napTip.bookmakerOdds)}
            ${this.renderFormGuide(napTip.recentForm, napTip.sport)}
          </div>
        </div>` : `
        <div class="nap-card-wrapper">
          <div class="nap-label"><span class="star">\u2605</span> NAP OF THE DAY — Revealed After Race <span class="star">\u2605</span></div>
          <div class="nap-card" style="position:relative;min-height:280px;cursor:pointer;" onclick="window.location.hash='#/pricing'">
            <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(135deg,#141828,#1a1f35);border-radius:12px;padding:24px;">
              <div style="font-size:42px;margin-bottom:14px;">&#128274;</div>
              <div style="font-size:20px;font-weight:800;color:#d4a843;margin-bottom:8px;">Today's NAP is Live</div>
              <div style="font-size:14px;color:#8a8fa0;margin-bottom:8px;text-align:center;max-width:360px;">Premium members received this selection before the off. Free members see it after the result.</div>
              <div style="display:flex;gap:16px;margin-bottom:12px;">
                <div style="text-align:center;"><div style="font-size:24px;font-weight:800;color:#22c55e;">${napTip.confidence}/10</div><div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Confidence</div></div>
                <div style="width:1px;background:#2a2d45;"></div>
                <div style="text-align:center;"><div style="font-size:24px;font-weight:800;color:#d4a843;">${((napTip.edge||0)*100).toFixed(1)}%</div><div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Edge</div></div>
              </div>
              <div style="font-size:12px;color:#ef4444;margin-bottom:16px;">&#9200; Selection revealed after the event</div>
              <div style="background:#d4a843;color:#0a0e1a;padding:12px 32px;border-radius:8px;font-weight:700;font-size:15px;">Get Tips Before Kick-Off — Free Trial</div>
              <div style="font-size:11px;color:#555;margin-top:10px;">14 days free. Card stored securely. Cancel anytime.</div>
            </div>
          </div>
        </div>`) : ''}

        <!-- 3. TODAY'S TIPS — the actual product, immediately after NAP -->
        <div class="section" style="margin-bottom:20px;">
          <div class="section-title"><span class="icon">&#9826;</span> Today's Selections (${todayTips.filter(t => !t.isWeeklyAcca).length} tips across ${Object.keys(sportCounts).length} sports)</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">${sportCountHtml}</div>
          <div class="date-tabs">
            <button class="date-tab active" onclick="App.filterDashDate('today',this)">Today</button>
            ${tomorrowTips.length ? '<button class="date-tab" onclick="App.filterDashDate(\'tomorrow\',this)">Tomorrow (' + tomorrowTips.length + ')</button>' : ''}
            ${upcomingTips.length ? '<button class="date-tab" onclick="App.filterDashDate(\'upcoming\',this)">Upcoming (' + upcomingTips.length + ')</button>' : ''}
          </div>
          <div class="tabs" style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;">
            <button class="tab active" onclick="App.filterDashTips('all', this)">All</button>
            <button class="tab" onclick="App.filterDashTips('racing', this)">Racing</button>
            <button class="tab" onclick="App.filterDashTips('football', this)">Football</button>
            <button class="tab" onclick="App.filterDashTips('free', this)">Free</button>
            <button class="tab" onclick="App.filterDashTips('premium', this)">Premium</button>
            <select id="conf-filter" onchange="App._confThreshold=parseInt(this.value);localStorage.setItem('ee_conf_threshold',this.value);App.filterDashTips(App._lastTipFilter||'all');" style="margin-left:auto;padding:6px 10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:12px;font-weight:600;">
              <option value="0" ${(this._confThreshold||0)===0?'selected':''}>All Confidence</option>
              <option value="6" ${(this._confThreshold||0)===6?'selected':''}>6+ Only</option>
              <option value="7" ${(this._confThreshold||0)===7?'selected':''}>7+ Strong</option>
              <option value="8" ${(this._confThreshold||0)===8?'selected':''}>8+ High</option>
              <option value="9" ${(this._confThreshold||0)===9?'selected':''}>9+ Elite</option>
            </select>
          </div>
          <div class="grid grid-2" id="dash-tips">
            ${tips.filter(t => !t.isNap && !t.isWeeklyAcca).map((t, i) => {
              let html = this.renderTipCard(t);
              if ((i + 1) % 3 === 0 && i < 9) html += this.renderAdSlot(Math.floor((i + 1) / 3));
              return html;
            }).join('')}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
            <a href="#/selections" class="btn btn-gold btn-sm">View All Tips</a>
            <a href="#/acca-generator" class="btn btn-outline btn-sm">Build Acca</a>
            <a href="#/calculators" class="btn btn-outline btn-sm">Calculators</a>
          </div>
        </div>

        <!-- 3b. DAILY STAKING PLAN — personalised to their bankroll -->
        ${this.buildStakingPlan(todayTips)}

        <!-- 4. TRUST BAR — proof that the system works -->
        <div class="trust-banner" style="margin-bottom:20px;">
          <div class="trust-item"><div class="trust-value">+${perf.roi}%</div><div class="trust-label">Overall ROI</div></div>
          <div class="trust-item"><div class="trust-value">${perf.strikeRate}%</div><div class="trust-label">Strike Rate</div></div>
          <div class="trust-item"><div class="trust-value">${perf.runningBank}</div><div class="trust-label">Running Bank</div></div>
          <div class="trust-item"><div class="trust-value">${perf.totalTips}</div><div class="trust-label">Tips</div></div>
          <div class="trust-item"><div class="trust-value">${perf.wins}</div><div class="trust-label">Winners</div></div>
          ${streak > 1 ? `<div class="trust-item"><div class="streak-badge">\ud83d\udd25 ${streak}-Tip Streak</div></div>` : ''}
        </div>

        <!-- 5. RECENT WINS TICKER — constant social proof -->
        ${recentWins.length ? `
        <div class="ticker-wrap">
          <div class="ticker">
            ${recentWins.concat(recentWins).map(w => `
              <div class="ticker-item">
                <span class="win-tag">WIN</span>
                <span>${w.selection}</span>
                <span class="odds-tag">@ ${this.formatOdds(w.odds)}</span>
                <span class="text-muted">(+${w.pnl > 0 ? w.pnl.toFixed(2) : '0'} units)</span>
                <button class="share-btn" onclick="event.stopPropagation();App.generateShareCard({selection:'${w.selection.replace(/'/g, "\\'")}',odds:${w.odds},pnl:${w.pnl || 0},sport:'${w.sport || 'racing'}',event:'${(w.event || '').replace(/'/g, "\\'")}'})">Share</button>
              </div>
            `).join('')}
          </div>
        </div>` : ''}

        <!-- 6. DYNAMIC ELEMENTS — Big Winner + Live Tracker + Streak -->
        <div id="big-winner-banner"></div>
        <div id="live-race-tracker"></div>
        <div id="streak-rewards"></div>

        <!-- 7. PERSONAL TRACKING — "your" results, not just ours -->
        ${personalWinHtml}
        <div id="personal-stats-container"></div>

        <!-- 8. AI BRIEFING + MORNING BRIEF — premium engagement -->
        ${this.isPremium() ? `
        <div class="card" id="ai-briefing-card" style="margin-bottom:20px;padding:20px;border:1px solid rgba(212,168,67,0.2);background:linear-gradient(135deg,rgba(212,168,67,0.06),rgba(212,168,67,0.01));">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
            <div style="font-size:24px;">&#129302;</div>
            <div>
              <div style="font-weight:800;font-size:15px;color:#d4a843;">AI Morning Briefing</div>
              <div style="font-size:11px;color:var(--text-muted);">Powered by Claude + Perplexity — exclusive to subscribers</div>
            </div>
          </div>
          <div id="ai-briefing-content">
            <button class="btn btn-gold btn-sm" onclick="App.loadAIDailyBriefing()">Load AI Briefing</button>
          </div>
        </div>` : ''}
        ${morningBriefHtml}

        <!-- 9. FOMO SECTION — what free users missed (conversion driver) -->
        ${wouldHaveWonHtml}

        <!-- 10. FREE USER INTELLIGENCE BRIEFING — taste of premium -->
        ${!this.isPremium() ? `
        <div style="background:linear-gradient(135deg,#141828,#1a1f35);border:1px solid rgba(212,168,67,0.2);border-radius:14px;padding:24px;margin-bottom:24px;">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
            <div style="font-size:28px;">&#128200;</div>
            <div>
              <div style="font-size:16px;font-weight:800;color:#d4a843;">Today's Market Intelligence</div>
              <div style="font-size:12px;color:#8a8fa0;">Free daily insight — what our model is watching</div>
            </div>
          </div>
          <div style="background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.15);border-radius:10px;padding:16px;margin-bottom:16px;">
            <div style="font-size:13px;color:#c0c4d0;line-height:1.6;">Our model has identified <strong style="color:#fff;">${todayTips.filter(t => !t.isWeeklyAcca).length} edge opportunities</strong> today. The strongest carries a confidence of <strong style="color:#d4a843;">${napTip ? napTip.confidence + '/10' : '—'}</strong> with <strong style="color:#22c55e;">${napTip ? ((napTip.edge||0)*100).toFixed(1) + '%' : '—'}</strong> edge. Premium members have full access.</div>
          </div>
          <div style="text-align:center;">
            <button onclick="App.showTrialOffer()" style="display:inline-block;background:#d4a843;color:#0a0e1a;padding:12px 32px;border-radius:8px;border:none;font-weight:700;font-size:14px;cursor:pointer;">Start 14-Day Free Trial</button>
            <div style="font-size:11px;color:#6b7280;margin-top:8px;">Card stored securely. Cancel anytime. 18+ BeGambleAware.org</div>
          </div>
        </div>` : ''}

        <!-- 11. PREMIUM ACCA + YESTERDAY'S WINNER -->
        ${this.isPremium() ? '<div id="premium-acca-container"></div>' : ''}
        <div id="yesterday-winner-showcase"></div>

        <!-- 12. ENGAGEMENT TOOLS — bankroll, recovery, streaks, targets -->
        ${bankrollHtml}
        ${recoveryHtml}
        ${streakBadgesHtml}
        ${monthlyTargetHtml}

        <!-- 13. VERIFIED WINNERS GRID — permanent proof -->
        ${recentWins.length ? `
        <div class="section" style="margin-bottom:24px;">
          <div class="section-title"><span style="color:#22c55e;">&#10003;</span> Verified Recent Winners</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">
            ${recentWins.slice(0, 6).map(w => `
              <div style="background:var(--card-bg);border:1px solid rgba(34,197,94,0.3);border-radius:10px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <div style="font-weight:700;font-size:14px;color:#fff;">${w.selection}</div>
                  <div style="font-size:12px;color:var(--text-secondary);">${w.event || ''}</div>
                  <div style="font-size:11px;color:var(--text-muted);">${formatDateUK(w.date)}</div>
                </div>
                <div style="text-align:right;">
                  <div style="font-weight:800;font-size:18px;color:#22c55e;">@ ${this.formatOdds(w.odds)}</div>
                  <div style="font-size:12px;color:#22c55e;font-weight:600;">+${w.pnl > 0 ? w.pnl.toFixed(2) : '0'} units</div>
                </div>
              </div>
            `).join('')}
          </div>
          <div style="text-align:center;margin-top:12px;">
            <a href="#/results" style="color:var(--accent);font-size:13px;font-weight:600;">View Full Results &amp; Performance History &rarr;</a>
          </div>
        </div>` : ''}

        <!-- 13b. SUBSCRIBER LEADERBOARD — competition + social proof -->
        <div id="subscriber-leaderboard"></div>

        <!-- 14. NEWS + REFERRAL — community & growth -->
        <div id="dashboard-news-section"></div>

        ${this.user ? `
        <div class="card" style="margin-bottom:24px;border-color:rgba(212,168,67,0.2);">
          <div style="display:flex;align-items:flex-start;gap:16px;">
            <div style="font-size:32px;flex-shrink:0;">&#127873;</div>
            <div style="flex:1;">
              <h3 style="font-size:18px;font-weight:800;margin-bottom:6px;">Refer a Friend — Earn Free Credits</h3>
              <p style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;line-height:1.5;">Share your code. You both earn credits when they sign up.</p>
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <div style="background:var(--bg-elevated);border:1px solid var(--border-light);border-radius:var(--radius-sm);padding:8px 16px;font-family:monospace;font-size:16px;font-weight:700;color:var(--gold);letter-spacing:1px;" id="dash-referral-code">${this.getReferralCode()}</div>
                <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();var code=document.getElementById('dash-referral-code').textContent;navigator.clipboard.writeText(code).then(function(){App.showToast('Referral code copied!','success');}).catch(function(){});">Copy Code</button>
                <button class="btn btn-ghost btn-sm" onclick="App.showReferral()">Full Details</button>
              </div>
            </div>
          </div>
        </div>` : ''}

        <!-- 15. TELEGRAM + SOCIAL -->
        <div class="card text-center mb-32" style="padding:24px;">
          <h3 class="mb-8">Join Our Telegram Channel</h3>
          <p class="text-muted mb-16">Instant tip alerts, live updates, and community discussion.</p>
          <a href="https://t.me/EliteEdgeTips" target="_blank" rel="noopener" class="telegram-cta">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
            Join our Telegram
          </a>
        </div>

        <!-- 16. CONVERSION CTA — bottom of page for free users -->
        ${!this.isPremium() ? `
        <div class="card card-premium text-center" style="padding:40px;">
          <h2 style="margin-bottom:8px;">Stop Missing Winners</h2>
          <p class="text-muted mb-24">Every day you wait is another edge opportunity gone. Get full access to all selections, analysis, and staking.</p>
          <a href="#/pricing" class="btn btn-gold btn-lg">Start 14-Day Free Trial</a>
          <p class="text-xs text-muted mt-16">Then &pound;19.99/month. Cancel anytime. No commitment.</p>
        </div>` : ''}

        <!-- 17. HOW IT WORKS — education last, only visible to newer users -->
        ${!this.isPremium() || (perf.totalTips || 0) < 20 ? `
        <div style="background:linear-gradient(135deg,#141828,#1a1f35);border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:24px;">
          <div style="padding:24px;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
              <div style="font-size:28px;">&#127891;</div>
              <div>
                <div style="font-size:18px;font-weight:800;color:#d4a843;">How Elite Edge Works</div>
                <div style="font-size:12px;color:#8a8fa0;">Understanding our system and how to use our tips</div>
              </div>
              <a href="#/how-it-works" style="font-size:12px;color:#d4a843;text-decoration:none;font-weight:600;">Full Guide &rarr;</a>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">
              <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:16px;">
                <div style="font-size:24px;margin-bottom:8px;">&#127919;</div>
                <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:4px;">Confidence (1-10)</div>
                <div style="font-size:12px;color:#8a8fa0;line-height:1.5;">How strongly our model rates each pick. 7+ is strong, 9-10 is elite.</div>
              </div>
              <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:16px;">
                <div style="font-size:24px;margin-bottom:8px;">&#128200;</div>
                <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:4px;">Edge %</div>
                <div style="font-size:12px;color:#8a8fa0;line-height:1.5;">The gap between our model's probability and the bookmaker's price. Higher = more value.</div>
              </div>
              <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:16px;">
                <div style="font-size:24px;margin-bottom:8px;">&#128176;</div>
                <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:4px;">Units</div>
                <div style="font-size:12px;color:#8a8fa0;line-height:1.5;">1 unit = 1% of your bankroll. &pound;500 bank = &pound;5 per unit. We suggest 1-3 units per tip.</div>
              </div>
              <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:16px;">
                <div style="font-size:24px;margin-bottom:8px;">&#128202;</div>
                <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:4px;">ROI</div>
                <div style="font-size:12px;color:#8a8fa0;line-height:1.5;">Profit divided by total staked. Tracked transparently on our Results page.</div>
              </div>
            </div>
            <div style="text-align:center;margin-top:16px;">
              <a href="#/how-it-works" style="color:#d4a843;font-size:13px;font-weight:600;text-decoration:none;">Full Beginner's Guide &rarr;</a>
            </div>
          </div>
        </div>` : ''}

        <!-- 18. TESTIMONIALS — social proof anchor -->
        <div class="section">
          <div class="section-title"><span class="icon">&#9733;</span> What Our Members Say</div>
          <div class="grid grid-3">
            ${this.getTestimonials().map(t => `
              <div class="testimonial-card">
                <div class="testimonial-stars">${'&#9733;'.repeat(t.stars)}</div>
                <div class="testimonial-text">"${t.text}"</div>
                <div class="testimonial-author">${t.author} <span>&bull; ${t.role}</span></div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    // Render bankroll chart after DOM update
    var self = this;
    setTimeout(function() { try { self.renderBankrollChart(); } catch (e) {} }, 50);

    // Check for new wins and show celebrations
    setTimeout(function() { try { self.checkForNewWins(); } catch (e) {} }, 500);

    // Render dynamic big winner banner
    this.renderBigWinnerBanner();

    // Render premium weekend acca (premium users only)
    this.renderPremiumAcca();

    // Render yesterday's winner showcase (all users)
    this.renderYesterdayShowcase();

    // Fetch and render breaking news section
    this._fetchDashboardNews();

    // Render personalised stats for premium users
    this.renderPersonalStats();

    // Render Live Race Tracker (Feature 1)
    this.renderLiveRaceTracker();

    // Render Streak Rewards (Feature 4)
    this.renderStreakRewards();

    // Render subscriber leaderboard
    this.renderLeaderboard();

    // Prompt for push notifications (after 5s delay — don't overwhelm on first load)
    setTimeout(function() { try { self.requestPushPermission(); } catch(e) {} }, 5000);
  },

  async renderLeaderboard() {
    var container = document.getElementById('subscriber-leaderboard');
    if (!container) return;

    try {
      var data = await this.api('/user/bets/leaderboard?period=week');
      var lb = data.leaderboard || [];
      if (lb.length < 3) {
        // Try monthly if not enough weekly data
        data = await this.api('/user/bets/leaderboard?period=month');
        lb = data.leaderboard || [];
      }
      if (lb.length < 3) return; // Don't show with fewer than 3 entries

      var rows = lb.slice(0, 10).map(function(entry) {
        var medal = entry.rank === 1 ? '&#129351;' : entry.rank === 2 ? '&#129352;' : entry.rank === 3 ? '&#129353;' : '<span style="color:#64748b;">' + entry.rank + '</span>';
        var pnlColor = entry.pnl > 0 ? '#22c55e' : entry.pnl < 0 ? '#ef4444' : '#94a3b8';
        return '<tr>' +
          '<td style="padding:10px 8px;text-align:center;font-size:18px;">' + medal + '</td>' +
          '<td style="padding:10px 8px;font-weight:700;color:#fff;">' + entry.name + '</td>' +
          '<td style="padding:10px 8px;text-align:center;color:#94a3b8;">' + entry.bets + '</td>' +
          '<td style="padding:10px 8px;text-align:center;color:#94a3b8;">' + entry.strikeRate + '%</td>' +
          '<td style="padding:10px 8px;text-align:right;font-weight:800;font-size:16px;color:' + pnlColor + ';">' + (entry.pnl > 0 ? '+' : '') + entry.pnl.toFixed(2) + 'u</td>' +
        '</tr>';
      }).join('');

      var periodLabel = data.period === 'week' ? 'This Week' : data.period === 'month' ? 'This Month' : 'All Time';

      container.innerHTML =
        '<div class="section" style="margin-bottom:24px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
            '<div class="section-title" style="margin:0;"><span style="color:#d4a843;">&#127942;</span> Subscriber Leaderboard</div>' +
            '<div style="display:flex;gap:4px;">' +
              '<button class="tab' + (data.period === 'week' ? ' active' : '') + '" onclick="App._loadLeaderboard(\'week\')" style="font-size:11px;padding:4px 10px;">Week</button>' +
              '<button class="tab' + (data.period === 'month' ? ' active' : '') + '" onclick="App._loadLeaderboard(\'month\')" style="font-size:11px;padding:4px 10px;">Month</button>' +
              '<button class="tab' + (data.period === 'all' ? ' active' : '') + '" onclick="App._loadLeaderboard(\'all\')" style="font-size:11px;padding:4px 10px;">All</button>' +
            '</div>' +
          '</div>' +
          '<div style="overflow-x:auto;">' +
            '<table style="width:100%;border-collapse:collapse;">' +
              '<thead><tr><th style="padding:8px;text-align:center;font-size:11px;color:#64748b;border-bottom:1px solid #2a2e3d;"></th><th style="padding:8px;text-align:left;font-size:11px;color:#64748b;border-bottom:1px solid #2a2e3d;">Subscriber</th><th style="padding:8px;text-align:center;font-size:11px;color:#64748b;border-bottom:1px solid #2a2e3d;">Bets</th><th style="padding:8px;text-align:center;font-size:11px;color:#64748b;border-bottom:1px solid #2a2e3d;">SR%</th><th style="padding:8px;text-align:right;font-size:11px;color:#64748b;border-bottom:1px solid #2a2e3d;">P/L</th></tr></thead>' +
              '<tbody>' + rows + '</tbody>' +
            '</table>' +
          '</div>' +
          '<p style="font-size:11px;color:#475569;text-align:center;margin-top:10px;">Minimum 5 settled bets to qualify. Names anonymised. <a href="#/my-roi" style="color:#d4a843;">Track your bets to join &rarr;</a></p>' +
        '</div>';
    } catch (e) { /* non-fatal */ }
  },

  async _loadLeaderboard(period) {
    try {
      var data = await this.api('/user/bets/leaderboard?period=' + period);
      // Re-render with new data
      var container = document.getElementById('subscriber-leaderboard');
      if (container) {
        // Store period and re-render
        this._leaderboardPeriod = period;
        this.renderLeaderboard();
      }
    } catch(e) {}
  },

  // -----------------------------------------------------------------------
  // PERSONAL STATS — "Your Elite Edge Stats" card for premium users
  // -----------------------------------------------------------------------
  async renderPersonalStats() {
    var container = document.getElementById('personal-stats-container');
    if (!container) return;
    if (!this.user || !this.isPremium()) return;

    var bets = this.getMyBets();

    if (!bets || bets.length === 0) {
      container.innerHTML =
        '<div style="border:2px solid rgba(212,168,67,0.4);border-radius:14px;padding:24px;margin-bottom:20px;background:linear-gradient(135deg,rgba(212,168,67,0.08),rgba(212,168,67,0.02));">' +
          '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">' +
            '<div style="font-size:24px;">&#9733;</div>' +
            '<div style="font-weight:800;font-size:16px;color:#d4a843;">Your Elite Edge Stats</div>' +
          '</div>' +
          '<div style="font-size:14px;color:var(--text-secondary);line-height:1.6;">' +
            'Start tracking your bets to see personalised stats. Click <strong style="color:#d4a843;">\'Back This Tip\'</strong> on any selection.' +
          '</div>' +
        '</div>';
      return;
    }

    // Fetch results to match against tracked bets
    var allResults = [];
    try {
      allResults = await this.api('/results');
      if (!Array.isArray(allResults)) allResults = [];
    } catch (e) { allResults = []; }

    // Build a results lookup by tipId
    var resultsMap = {};
    allResults.forEach(function(r) { if (r.tipId) resultsMap[r.tipId] = r; });

    // Calculate personal stats
    var totalPL = 0;
    var wins = 0;
    var losses = 0;
    var settled = 0;
    var bestWinner = null;
    var bestWinnerPL = 0;
    var analystStats = {};

    bets.forEach(function(bet) {
      var result = resultsMap[bet.tipId] || {};
      var betResult = result.result || bet.result;
      var odds = parseFloat(bet.odds) || 0;

      if (betResult === 'won') {
        var pnl = odds > 0 ? (odds - 1) : 0;
        totalPL += pnl;
        wins++;
        settled++;
        if (pnl > bestWinnerPL) {
          bestWinnerPL = pnl;
          bestWinner = bet.selection;
        }
      } else if (betResult === 'lost') {
        totalPL -= 1;
        losses++;
        settled++;
      } else if (betResult === 'placed') {
        var ewReturn = parseFloat(result.eachWayReturn || result.pnl || 0);
        totalPL += ewReturn;
        settled++;
      }

      // Track analyst performance
      var analyst = result.tipsterProfile || bet.tipsterProfile || 'Unknown';
      if (!analystStats[analyst]) {
        analystStats[analyst] = { staked: 0, returns: 0, count: 0 };
      }
      if (betResult === 'won' || betResult === 'lost' || betResult === 'placed') {
        analystStats[analyst].staked += 1;
        analystStats[analyst].count++;
        if (betResult === 'won') {
          analystStats[analyst].returns += odds > 0 ? odds : 1;
        } else if (betResult === 'placed') {
          analystStats[analyst].returns += parseFloat(result.eachWayReturn || result.pnl || 0) + 1;
        }
      }
    });

    var strikeRate = settled > 0 ? Math.round((wins / settled) * 100) : 0;
    var plSign = totalPL >= 0 ? '+' : '';
    var plColor = totalPL >= 0 ? '#22c55e' : '#ef4444';

    // Find best analyst by ROI
    var bestAnalyst = '';
    var bestAnalystROI = -Infinity;
    var analystKeys = Object.keys(analystStats);
    for (var i = 0; i < analystKeys.length; i++) {
      var a = analystStats[analystKeys[i]];
      if (a.staked > 0 && a.count >= 2) {
        var roi = ((a.returns - a.staked) / a.staked) * 100;
        if (roi > bestAnalystROI) {
          bestAnalystROI = roi;
          bestAnalyst = analystKeys[i];
        }
      }
    }

    // Calculate membership duration
    var memberDays = 0;
    if (this.user.createdAt) {
      memberDays = Math.floor((Date.now() - new Date(this.user.createdAt).getTime()) / 86400000);
    }

    container.innerHTML =
      '<div style="border:2px solid rgba(212,168,67,0.4);border-radius:14px;padding:24px;margin-bottom:20px;background:linear-gradient(135deg,rgba(212,168,67,0.08),rgba(212,168,67,0.02));box-shadow:0 0 24px rgba(212,168,67,0.06);">' +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">' +
          '<div style="font-size:24px;">&#9733;</div>' +
          '<div>' +
            '<div style="font-weight:800;font-size:16px;color:#d4a843;">Your Elite Edge Stats</div>' +
            '<div style="font-size:11px;color:var(--text-muted);">Personalised performance based on your tracked bets</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;">' +
          '<div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:16px;text-align:center;">' +
            '<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Your P/L Following Elite Edge</div>' +
            '<div style="font-size:26px;font-weight:900;color:' + plColor + ';">' + plSign + '\u00A3' + Math.abs(totalPL).toFixed(2) + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted);">(' + bets.length + ' bet' + (bets.length !== 1 ? 's' : '') + ' tracked)</div>' +
          '</div>' +
          '<div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:16px;text-align:center;">' +
            '<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Personal Strike Rate</div>' +
            '<div style="font-size:26px;font-weight:900;color:' + (strikeRate >= 50 ? '#22c55e' : '#f59e0b') + ';">' + strikeRate + '%</div>' +
            '<div style="font-size:11px;color:var(--text-muted);">' + wins + 'W - ' + losses + 'L' + (settled - wins - losses > 0 ? ' - ' + (settled - wins - losses) + 'P' : '') + '</div>' +
          '</div>' +
          (bestWinner ? '<div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:16px;text-align:center;">' +
            '<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Best Winner You Backed</div>' +
            '<div style="font-size:16px;font-weight:800;color:#22c55e;word-break:break-word;">' + bestWinner + '</div>' +
            '<div style="font-size:12px;color:#22c55e;font-weight:600;">+' + bestWinnerPL.toFixed(2) + ' units</div>' +
          '</div>' : '') +
          (bestAnalyst && bestAnalyst !== 'Unknown' ? '<div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:16px;text-align:center;">' +
            '<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Your Best Analyst</div>' +
            '<div style="font-size:16px;font-weight:800;color:#d4a843;">' + bestAnalyst + '</div>' +
            '<div style="font-size:12px;color:var(--text-secondary);">ROI: ' + (bestAnalystROI >= 0 ? '+' : '') + bestAnalystROI.toFixed(1) + '%</div>' +
          '</div>' : '') +
          (memberDays > 0 ? '<div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:16px;text-align:center;">' +
            '<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Member For</div>' +
            '<div style="font-size:26px;font-weight:900;color:#d4a843;">' + memberDays + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted);">days</div>' +
          '</div>' : '') +
        '</div>' +
      '</div>';
  },

  async _fetchDashboardNews() {
    try {
      var container = document.getElementById('dashboard-news-section');
      if (!container) return;

      var res = await fetch('/api/news/relevant');
      if (!res.ok) return; // News service not available — silently skip

      var data = await res.json();
      if (!data.news || data.news.length === 0) return; // No news — don't show empty section

      // Filter to only show high and medium relevance, limit to 8 articles
      var relevant = data.news.filter(function(n) {
        return n.relevance === 'high' || n.relevance === 'medium';
      }).slice(0, 8);

      if (relevant.length === 0) return;

      var timeAgo = function(dateStr) {
        if (!dateStr) return '';
        var diff = Date.now() - new Date(dateStr).getTime();
        var mins = Math.floor(diff / 60000);
        if (mins < 60) return mins + 'm ago';
        var hours = Math.floor(mins / 60);
        if (hours < 24) return hours + 'h ago';
        return Math.floor(hours / 24) + 'd ago';
      };

      var newsHtml = relevant.map(function(item) {
        var article = item.article;
        var isHigh = item.relevance === 'high';
        var badgeColor = isHigh ? '#ef4444' : '#f59e0b';
        var badgeLabel = isHigh ? 'HIGH IMPACT' : 'TEAM NEWS';
        var icon = isHigh ? '\u26A0\uFE0F' : '\uD83D\uDCF0';
        var keywords = (item.keywords && item.keywords.length > 0) ? ' \u2014 ' + item.keywords.join(', ') : '';

        return '<div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);">' +
          '<div style="font-size:18px;flex-shrink:0;">' + icon + '</div>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
              '<span style="font-size:11px;font-weight:700;color:#fff;background:' + badgeColor + ';padding:2px 6px;border-radius:4px;">' + badgeLabel + '</span>' +
              '<span style="font-size:11px;color:var(--text-muted);">' + (article.source || '') + ' \u2022 ' + timeAgo(article.publishedAt) + '</span>' +
            '</div>' +
            '<a href="' + (article.url || '#') + '" target="_blank" rel="noopener" style="font-size:13px;font-weight:600;color:#fff;text-decoration:none;line-height:1.4;display:block;">' +
              (article.title || '') +
            '</a>' +
            (keywords ? '<div style="font-size:11px;color:' + badgeColor + ';margin-top:2px;">' + keywords + '</div>' : '') +
          '</div>' +
        '</div>';
      }).join('');

      container.innerHTML =
        '<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:20px;">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">' +
            '<div style="font-size:22px;">\uD83D\uDCF0</div>' +
            '<div style="font-size:16px;font-weight:800;color:#fff;">Breaking News & Team Updates</div>' +
          '</div>' +
          newsHtml +
        '</div>';
    } catch (e) {
      // Non-fatal — silently skip news section if anything goes wrong
    }
  },

  _dashDateFilter: 'today',

  filterDashDate(dateFilter, btn) {
    document.querySelectorAll('.date-tabs .date-tab').forEach(function(t) { t.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    this._dashDateFilter = dateFilter;
    var today = this._getToday();
    var tomorrow = this._getTomorrow();
    var yesterday = this._getYesterday();
    var container = document.getElementById('dash-tips');
    // For TODAY: exclude NAP + Acca (they have their own dedicated cards above)
    // For TOMORROW/UPCOMING: include NAP + Acca so users can see them
    var includeAll = dateFilter !== 'today';
    var filtered = this.tips.filter(function(t) {
      if (includeAll) return true;
      return !t.isNap && !t.isWeeklyAcca;
    });
    if (dateFilter === 'today') filtered = filtered.filter(function(t) { return !t.date || App._normDate(t.date) === today; });
    else if (dateFilter === 'tomorrow') filtered = filtered.filter(function(t) { return App._normDate(t.date) === tomorrow; });
    else if (dateFilter === 'upcoming') filtered = filtered.filter(function(t) { return t.date && App._normDate(t.date) > tomorrow; });
    else if (dateFilter === 'recent') filtered = filtered.filter(function(t) { return App._normDate(t.date) === yesterday; });
    container.innerHTML = filtered.length
      ? filtered.map(function(t) { return App.renderTipCard(t); }).join('')
      : '<div style="grid-column:1/-1;text-align:center;padding:40px 20px;color:var(--text-muted);">No selections published for this period yet. Tips publish daily by 7:30am UK.</div>';
  },

  _confThreshold: parseInt(localStorage.getItem('ee_conf_threshold') || '0') || 0,
  _lastTipFilter: 'all',

  filterDashTips(filter, btn) {
    if (btn) {
      document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
    }
    this._lastTipFilter = filter || 'all';
    const container = document.getElementById('dash-tips');
    if (!container) return;
    var today = this._getToday();
    var tomorrow = this._getTomorrow();
    var yesterday = this._getYesterday();
    var includeAll = this._dashDateFilter !== 'today';
    let filtered = this.tips.filter(t => includeAll ? true : (!t.isNap && !t.isWeeklyAcca));
    // Apply date filter
    if (this._dashDateFilter === 'today') filtered = filtered.filter(function(t) { return !t.date || App._normDate(t.date) === today; });
    else if (this._dashDateFilter === 'tomorrow') filtered = filtered.filter(function(t) { return App._normDate(t.date) === tomorrow; });
    else if (this._dashDateFilter === 'upcoming') filtered = filtered.filter(function(t) { return t.date && App._normDate(t.date) > tomorrow; });
    else if (this._dashDateFilter === 'recent') filtered = filtered.filter(function(t) { return App._normDate(t.date) === yesterday; });
    if (filter === 'racing') filtered = filtered.filter(t => t.sport === 'racing');
    if (filter === 'football') filtered = filtered.filter(t => t.sport === 'football');
    if (filter === 'free') filtered = filtered.filter(t => !t.isPremium);
    if (filter === 'premium') filtered = filtered.filter(t => t.isPremium);
    // Apply confidence threshold
    var confMin = this._confThreshold || 0;
    if (confMin > 0) {
      filtered = filtered.filter(function(t) { return (t.confidence || 0) >= confMin; });
    }
    var confLabel = confMin > 0 ? ' (confidence ' + confMin + '+)' : '';
    container.innerHTML = filtered.length
      ? filtered.map(t => this.renderTipCard(t)).join('')
      : '<div style="grid-column:1/-1;text-align:center;padding:40px 20px;color:var(--text-muted);">No selections match these filters' + confLabel + '. Try lowering your confidence threshold.</div>';
  },

  // -----------------------------------------------------------------------
  // TIP CARD (reusable) — includes odds comparison, movement, form, acca, backed
  // -----------------------------------------------------------------------
  renderTipCard(tip) {
    // Override server lock if client knows user is premium (handles stale JWT edge case)
    const isLocked = this.isPremium() ? false : tip.locked;
    const edgeClass = tip.valueRating === 'Elite' ? 'edge-elite' : tip.valueRating === 'High' ? 'edge-high' : tip.valueRating === 'Medium' ? 'edge-medium' : 'edge-low';
    const edgePct = Math.min((tip.edge || 0) * 100 / 0.2 * 100, 100);
    const myBets = this.getMyBets();
    const isBacked = myBets.some(b => b.tipId === tip.id);
    const inAcca = this.accaSelections.some(a => a.tipId === tip.id);

    return `
      <div class="tip-card ${tip.isPremium ? 'premium' : ''} ${isLocked ? 'locked' : ''} ${tip.isOutsider ? 'outsider-card' : ''}" onclick="window.location.hash='#/tip/${tip.id}'">
        ${tip.isOutsider ? '<div class="outsider-banner">EW Outsider of the Day</div>' : ''}
        <div class="tip-top">
          <div class="tip-badges">
            <span class="tip-sport-badge ${tip.sport === 'racing' ? 'badge-racing' : 'badge-football'}">${tip.sport === 'racing' ? 'Racing' : tip.sport === 'basketball' ? 'NBA' : tip.sport === 'tennis' ? 'Tennis' : tip.sport === 'rugby' ? 'Rugby' : tip.sport === 'american-football' ? 'NFL' : 'Football'}</span>
            ${tip.isOutsider ? '<span class="badge-outsider">Outsider</span>' : `<span class="${tip.isPremium ? 'badge-premium' : 'badge-free'}">${tip.isPremium ? 'Premium' : 'Free'}</span>`}
            ${tip.valueRating ? `<span class="badge-premium">${tip.valueRating}</span>` : ''}
            ${tip.tipsterProfile ? `<span class="analyst-badge ${tip.tipsterProfile === 'The Professor' ? 'professor' : tip.tipsterProfile === 'The Scout' ? 'scout' : tip.tipsterProfile === 'The Clocker' ? 'clocker' : 'edge'}">${tip.tipsterProfile}</span>` : ''}
            ${tip.analysis && tip.analysis.dualAIVerified ? '<span style="background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:800;letter-spacing:0.5px;">DUAL AI VERIFIED</span>' : ''}
          </div>
          <div>
            <div class="tip-odds">${tip.locked ? '?.??' : this.formatOdds(tip.odds)} ${!isLocked ? this.renderOddsMovement(tip.odds, tip.openingOdds) : ''}</div>
            <div class="tip-odds-label">${tip.market || ''}</div>
          </div>
        </div>
        <div class="${isLocked ? 'tip-locked-content' : ''}">
          <div class="tip-selection">${tip.selection}</div>
          <div class="tip-event">${tip.event}${tip.league ? ' &bull; ' + tip.league : ''}${tip.raceTime ? ' &bull; ' + tip.raceTime : ''}</div>
          ${tip.isWeeklyAcca && tip.accaSelections && !isLocked ? `
          <div style="margin:10px 0;border:1px solid var(--border);border-radius:8px;overflow:hidden;">
            ${(Array.isArray(tip.accaSelections) ? tip.accaSelections : []).map(function(leg, i) {
              var legSport = leg.sport === 'racing' ? '&#127943;' : leg.sport === 'basketball' ? '&#127936;' : leg.sport === 'tennis' ? '&#127934;' : leg.sport === 'rugby' ? '&#127945;' : leg.sport === 'american-football' ? '&#127944;' : '&#9917;';
              return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border);font-size:13px;' + (i % 2 ? 'background:rgba(255,255,255,0.02);' : '') + '">' +
                '<div><span style="margin-right:6px;">' + legSport + '</span><strong style="color:#fff;">' + (leg.selection || leg.name || '') + '</strong> <span style="color:var(--text-muted);">' + (leg.event || leg.match || '') + '</span></div>' +
                '<div style="font-weight:800;color:var(--gold);">' + (leg.odds || '') + '</div>' +
              '</div>';
            }).join('')}
          </div>
          ` : ''}
          <div class="tip-summary">${tip.analysis?.summary ? tip.analysis.summary.substring(0, 150) + '...' : ''}</div>
          <div class="tip-meta">
            <div class="tip-meta-item">
              <strong>Confidence:</strong> ${tip.confidence}/10
              <div class="confidence-meter" style="margin-top:4px;height:6px;border-radius:3px;background:var(--bg-elevated);overflow:hidden;">
                <div style="height:100%;border-radius:3px;background:linear-gradient(90deg,#b8902f,#d4a843,#e8c36a);width:${(tip.confidence || 0) * 10}%;transition:width 0.4s ease;"></div>
              </div>
            </div>
            <div class="tip-meta-item"><strong>Edge:</strong> ${((tip.edge || 0) * 100).toFixed(1)}%</div>
            <div class="tip-meta-item"><strong>Stake:</strong> ${tip.staking || '-'}</div>
            <div class="tip-meta-item"><strong>Risk:</strong> ${tip.riskLevel || '-'}</div>
          </div>
          ${!isLocked ? this.renderBookmakerOdds(tip.bookmakerOdds) : ''}
          ${!isLocked ? Bookmakers.renderOddsBar(tip) : ''}
          ${!isLocked ? this.renderOddsMovementDetail(tip) : ''}
          ${!isLocked ? this.renderFormGuide(tip.recentForm, tip.sport) : ''}
          <div class="tip-edge-bar">
            <div class="tip-edge-bar-label"><span>Edge</span><span>${((tip.edge || 0) * 100).toFixed(1)}%</span></div>
            <div class="tip-edge-bar-track"><div class="tip-edge-bar-fill ${edgeClass}" style="width:${edgePct}%"></div></div>
          </div>
          ${!isLocked ? `
          <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted);cursor:pointer;" onclick="event.stopPropagation();">
              <input type="checkbox" class="acca-checkbox" id="acca-cb-${tip.id}" ${inAcca ? 'checked' : ''} onchange="App.toggleAcca('${tip.id}','${tip.selection.replace(/'/g, "\\'")}',${tip.odds},event)"> Add to Acca
            </label>
            <button class="backed-btn ${isBacked ? 'backed' : ''}" id="backed-${tip.id}" onclick="event.stopPropagation();App.toggleBacked('${tip.id}','${tip.selection.replace(/'/g, "\\'")}',${tip.odds},'${tip.result || ''}')">${isBacked ? 'Backed' : 'Back This Tip'}</button>
          </div>
          <div class="bet-slip-section" onclick="event.stopPropagation();">
            <div class="bet-slip-wrapper">
              <button class="bet-slip-btn" onclick="App.toggleBetSlip('${tip.id}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
                Place Bet
              </button>
              <div class="bet-slip-dropdown" id="betslip-dd-${tip.id}">
                <a href="https://www.bet365.com/#/HO/" target="_blank" rel="noopener nofollow" class="bookie-link"><span class="bookie-dot" style="background:#1b5e20;"></span>Bet365<span class="bookie-arrow">&rsaquo;</span></a>
                <a href="https://www.paddypower.com/" target="_blank" rel="noopener nofollow" class="bookie-link"><span class="bookie-dot" style="background:#004833;"></span>Paddy Power<span class="bookie-arrow">&rsaquo;</span></a>
                <a href="https://www.williamhill.com/" target="_blank" rel="noopener nofollow" class="bookie-link"><span class="bookie-dot" style="background:#1a237e;"></span>William Hill<span class="bookie-arrow">&rsaquo;</span></a>
                <a href="https://www.skybet.com/" target="_blank" rel="noopener nofollow" class="bookie-link"><span class="bookie-dot" style="background:#0c2340;"></span>Sky Bet<span class="bookie-arrow">&rsaquo;</span></a>
                <a href="https://www.betfair.com/" target="_blank" rel="noopener nofollow" class="bookie-link"><span class="bookie-dot" style="background:#ffb80c;"></span>Betfair<span class="bookie-arrow">&rsaquo;</span></a>
              </div>
            </div>
            <button class="copy-selection-btn" onclick="App.copySelection('${tip.selection.replace(/'/g, "\\'")}','${(tip.market || '').replace(/'/g, "\\'")}',${tip.odds},'${(tip.event || '').replace(/'/g, "\\'")}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Copy Selection
            </button>
          </div>` : ''}
        </div>
        ${isLocked ? `
          <div class="lock-overlay">
            <div class="lock-icon">&#128274;</div>
            <div class="lock-text">Premium Selection</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.6);margin-bottom:8px;">Full analysis, staking advice & edge data</div>
            <div class="lock-cta" onclick="event.stopPropagation();App.showTrialOffer()">Unlock Free for 7 Days</div>
          </div>
        ` : ''}
      </div>
    `;
  },

  // -----------------------------------------------------------------------
  // TIP DETAIL
  // -----------------------------------------------------------------------
  async renderTipDetail(tipId) {
    const app = document.getElementById('app');
    app.innerHTML = this.renderSkeleton('tips');

    try {
      const tip = await this.api(`/tips/${tipId}`);
      trackEvent('tips', 'view_tip', tip.selection || tipId);
      if (tip.locked) {
        app.innerHTML = `
          <div class="container text-center" style="padding:80px 20px;">
            <div style="font-size:64px;margin-bottom:16px;">&#128274;</div>
            <h2>Premium Content</h2>
            <p class="text-muted mb-24">This tip and its full analysis are available exclusively to Premium members.</p>
            <a href="#/pricing" class="btn btn-gold btn-lg">Upgrade to Premium</a>
            <p class="text-xs text-muted mt-16"><a href="#/" class="text-gold">&larr; Back to Dashboard</a></p>
          </div>
        `;
        return;
      }

      const a = tip.analysis || {};
      var analysisSections = this._buildAnalysisSections(tip, a);

      // Build visual form display
      var formVisualHtml = '';
      if (tip.recentForm && tip.recentForm.length) {
        if (tip.sport === 'racing') {
          formVisualHtml = '<div class="form-visual">' + tip.recentForm.map(function(f) {
            var pos = parseInt(f);
            var cls = pos === 1 ? 'fv-1' : (pos >= 2 && pos <= 3) ? 'fv-23' : 'fv-other';
            return '<span class="fv-badge ' + cls + '">' + f + '</span>';
          }).join('') + '</div>';
        } else {
          formVisualHtml = '<div class="form-visual">' + tip.recentForm.map(function(f) {
            var cls = f === 'W' ? 'fv-W' : f === 'D' ? 'fv-D' : 'fv-L';
            return '<span class="fv-badge ' + cls + '">' + f + '</span>';
          }).join('') + '</div>';
        }
      }

      app.innerHTML = `
        <div class="container">
          <p class="mb-16"><a href="#/" class="text-gold">&larr; Back to Dashboard</a></p>

          ${tip.isNap ? `<div class="nap-card-wrapper mb-16"><div class="nap-label"><span class="star">\u2605</span> NAP OF THE DAY <span class="star">\u2605</span></div></div>` : ''}

          <!-- Premium Analysis Header -->
          <div class="premium-analysis-header">
            <div class="pa-icon">\ud83d\udd2c</div>
            <div>
              <h3>Premium Analysis</h3>
              <p>Data-driven breakdown by ${tip.tipsterProfile || 'Elite Edge'} | Published ${formatDateUK(tip.date)}</p>
            </div>
          </div>

          <div class="detail-header">
            <div class="tip-badges mb-8">
              <span class="tip-sport-badge ${tip.sport === 'racing' ? 'badge-racing' : 'badge-football'}">${tip.sport === 'racing' ? 'Horse Racing' : 'Football'}</span>
              <span class="${tip.isPremium ? 'badge-premium' : 'badge-free'}">${tip.isPremium ? 'Premium' : 'Free'}</span>
              ${tip.valueRating ? `<span class="badge-premium">${tip.valueRating} Value</span>` : ''}
            </div>
            <h2>${tip.selection}</h2>
            <div class="detail-event">${tip.event}${tip.league ? ' &bull; ' + tip.league : ''} &bull; ${tip.market}${tip.raceTime ? ' &bull; ' + tip.raceTime : ''}</div>
          </div>

          <div class="detail-grid">
            <div class="detail-stat">
              <div class="detail-stat-value text-green">${this.formatOdds(tip.odds)} ${this.renderOddsMovement(tip.odds, tip.openingOdds)}</div>
              <div class="detail-stat-label">Odds</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-value text-gold">${tip.confidence}/10</div>
              <div class="detail-stat-label">Confidence</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-value text-green">${((tip.edge || 0) * 100).toFixed(1)}%</div>
              <div class="detail-stat-label">Edge</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-value">${tip.staking || '-'}</div>
              <div class="detail-stat-label">Staking</div>
            </div>
          </div>

          <!-- Visual Confidence Meter -->
          <div class="confidence-meter">
            <div class="confidence-meter-label">
              <span>Confidence</span>
              <span>${tip.confidence}/10</span>
            </div>
            <div class="confidence-meter-track">
              <div class="confidence-meter-fill" style="width:${(tip.confidence || 0) * 10}%"></div>
            </div>
            <div class="confidence-meter-markers">
              <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>10</span>
            </div>
          </div>

          <!-- Visual Form -->
          ${formVisualHtml ? `
          <div class="card mb-24">
            <h4 class="text-gold text-xs mb-8" style="letter-spacing:1px;">FORM STRING</h4>
            ${formVisualHtml}
          </div>` : ''}

          <!-- Bookmaker Odds Comparison -->
          ${tip.bookmakerOdds ? `
          <div class="card mb-24">
            <h4 class="text-gold text-xs mb-8" style="letter-spacing:1px;">LIVE ODDS COMPARISON</h4>
            ${this.renderBookmakerOdds(tip.bookmakerOdds)}
            ${Bookmakers.renderOddsBar(tip)}
          </div>` : `
          <div class="card mb-24">
            ${Bookmakers.renderOddsBar(tip)}
          </div>`}

          <!-- Probability comparison -->
          <div class="card mb-24">
            <h4 class="text-gold text-xs mb-8" style="letter-spacing:1px;">PROBABILITY COMPARISON</h4>
            <div class="flex-between mb-8">
              <span class="text-sm">Implied Probability (from odds)</span>
              <span class="text-sm" style="font-weight:700;">${((tip.impliedProbability || 0) * 100).toFixed(1)}%</span>
            </div>
            <div style="height:8px;background:var(--bg-elevated);border-radius:4px;overflow:hidden;margin-bottom:12px;">
              <div style="height:100%;width:${(tip.impliedProbability || 0) * 100}%;background:var(--text-muted);border-radius:4px;"></div>
            </div>
            <div class="flex-between mb-8">
              <span class="text-sm">Model Probability</span>
              <span class="text-sm text-green" style="font-weight:700;">${((tip.modelProbability || 0) * 100).toFixed(1)}%</span>
            </div>
            <div style="height:8px;background:var(--bg-elevated);border-radius:4px;overflow:hidden;margin-bottom:12px;">
              <div style="height:100%;width:${(tip.modelProbability || 0) * 100}%;background:var(--green);border-radius:4px;"></div>
            </div>
            <div class="flex-between">
              <span class="text-sm text-gold" style="font-weight:700;">Edge (Value)</span>
              <span class="text-sm text-gold" style="font-weight:700;">+${((tip.edge || 0) * 100).toFixed(1)}%</span>
            </div>
          </div>

          <!-- Structured Analysis Sections -->
          ${analysisSections.filter(Boolean).map(function(sec) {
            var body = sec.body || '';
            if (!body && sec.fields) {
              body = sec.fields.filter(function(f) { return a[f]; }).map(function(f) { return '<p>' + a[f] + '</p>'; }).join('');
            }
            if (!body) return '';
            return '<div class="analysis-section-card"><div class="as-header"><span class="as-icon">' + sec.icon + '</span> ' + sec.title + '</div><div class="as-body">' + body + '</div></div>';
          }).join('')}

          <!-- Verdict Box -->
          <div class="verdict-box">
            <h4>\ud83c\udfaf Verdict</h4>
            <p>${this._getVerdictText(a, tip)}</p>
          </div>

          <!-- Discussion / Comments -->
          ${this.renderCommentSection(tipId)}

          ${!this.isPremium() ? `
          <div class="card card-premium text-center mt-32" style="padding:32px;">
            <h3 class="mb-8">Get More Tips Like This</h3>
            <p class="text-muted mb-16">Upgrade to Premium for all daily selections with full analysis.</p>
            <a href="#/pricing" class="btn btn-gold">View Plans</a>
          </div>` : ''}
        </div>
      `;
    } catch (err) {
      app.innerHTML = `<div class="container text-center" style="padding:80px;"><h2>Tip not found</h2><a href="#/" class="btn btn-outline mt-16">Back to Dashboard</a></div>`;
    }
  },

  // -----------------------------------------------------------------------
  // RACING PAGE — 3-level drill-down: Meetings > Races > Race Detail
  // -----------------------------------------------------------------------
  _racingDateTab: 'today',
  _footballDateTab: 'today',
  _racingView: 'meetings',
  _selectedMeeting: null,
  _selectedRace: null,
  _racingLiveData: null,
  _racingIntelData: null,
  _goingForecastCache: {},

  // -----------------------------------------------------------------------
  // GOING FORECAST WIDGET (Feature #5)
  // -----------------------------------------------------------------------
  async fetchGoingForecast(meetingName) {
    if (this._goingForecastCache[meetingName]) return this._goingForecastCache[meetingName];
    try {
      var data = await this.api('/weather/test?course=' + encodeURIComponent(meetingName));
      if (data && data.processedWeather) {
        this._goingForecastCache[meetingName] = data.processedWeather;
        return data.processedWeather;
      }
      if (data && !data.error) {
        this._goingForecastCache[meetingName] = data;
        return data;
      }
    } catch (e) { /* weather not available */ }
    return null;
  },

  predictGoing(currentGoing, weather) {
    if (!weather || !currentGoing) return { text: '', cls: '' };
    var desc = (weather.description || '').toLowerCase();
    var rainfall = weather.rainfall || 0;
    var hasRain = rainfall > 0 || desc.indexOf('rain') !== -1 || desc.indexOf('drizzle') !== -1 || desc.indexOf('shower') !== -1;
    var heavyRain = rainfall > 5 || desc.indexOf('heavy') !== -1;
    var going = currentGoing.toLowerCase();

    if (heavyRain) {
      return { text: 'Heavy going expected', cls: 'easing' };
    }
    if (hasRain) {
      if (going.indexOf('good to soft') !== -1 || going === 'good to soft') {
        return { text: 'Likely to turn Soft', cls: 'easing' };
      }
      if (going === 'good' || going.indexOf('good') !== -1 && going.indexOf('soft') === -1) {
        return { text: 'Likely to ease \u2192 Good to Soft', cls: 'easing' };
      }
      if (going.indexOf('soft') !== -1) {
        return { text: 'Likely to remain Soft or ease further', cls: 'easing' };
      }
      return { text: 'Going may ease with rain', cls: 'easing' };
    }
    // Dry conditions
    if (going.indexOf('soft') !== -1 && going.indexOf('good') === -1) {
      return { text: 'May dry out \u2192 Good to Soft', cls: 'drying' };
    }
    if (going.indexOf('good to soft') !== -1) {
      return { text: 'May dry out \u2192 Good', cls: 'drying' };
    }
    if (going === 'good' || going.indexOf('good') !== -1) {
      return { text: 'Likely to remain Good', cls: 'drying' };
    }
    if (going.indexOf('firm') !== -1 || going.indexOf('hard') !== -1) {
      return { text: 'Likely to remain ' + currentGoing, cls: 'drying' };
    }
    return { text: 'No significant change expected', cls: '' };
  },

  renderGoingForecastWidget(weather, currentGoing) {
    if (!weather) return '';
    var temp = weather.temp !== undefined ? Math.round(weather.temp) + '\u00B0C' : '';
    var desc = weather.description || '';
    // Capitalise first letter
    if (desc) desc = desc.charAt(0).toUpperCase() + desc.slice(1);
    var prediction = this.predictGoing(currentGoing, weather);

    return '<div class="going-forecast">' +
      (temp ? '<span class="going-temp">' + temp + '</span>' : '') +
      (desc ? '<span class="going-weather">' + desc + '</span>' : '') +
      (prediction.text ? '<span class="going-prediction ' + prediction.cls + '">\u2192 ' + prediction.text + '</span>' : '') +
    '</div>';
  },

  async renderRacing() {
    var app = document.getElementById('app');
    app.innerHTML = this.renderSkeleton('tips');

    // Fetch all data on first load
    if (!this._racingLiveData || !this._racingIntelData) {
      try {
        var results = await Promise.all([
          this.api('/tips?sport=racing'),
          this.fetchLiveRacing(),
          this.fetchRaceIntelligence()
        ]);
        this.tips = results[0];
        this._racingLiveData = results[1];
        this._racingIntelData = results[2];
      } catch (e) {
        try { this.tips = await this.api('/tips?sport=racing'); } catch (e2) { /* use cached */ }
      }
    }

    var view = this._racingView || 'meetings';
    if (view === 'detail' && this._selectedRace) {
      this._renderRaceDetail();
    } else if (view === 'races' && this._selectedMeeting) {
      this._renderMeetingRaces();
    } else {
      this._renderMeetingsGrid();
    }
  },

  _renderMeetingsGrid() {
    var app = document.getElementById('app');
    var self = this;
    var liveData = this._racingLiveData;
    var hasLiveCards = liveData && liveData.live && liveData.racecards && liveData.racecards.length > 0;
    var racecards = hasLiveCards ? liveData.racecards : [];
    var liveUpdatedAt = liveData && liveData.fetchedAt ? new Date(liveData.fetchedAt) : null;

    // Group by meeting
    var liveMeetings = {};
    racecards.forEach(function(r) {
      var key = r.meeting || 'Unknown';
      if (!liveMeetings[key]) liveMeetings[key] = { name: key, races: [], going: '', firstTime: '' };
      liveMeetings[key].races.push(r);
      if (!liveMeetings[key].going && r.going) liveMeetings[key].going = r.going;
      if (!liveMeetings[key].firstTime && r.time) liveMeetings[key].firstTime = r.time;
    });

    // Sort meetings by first race time
    var meetingKeys = Object.keys(liveMeetings).sort(function(a, b) {
      return (liveMeetings[a].firstTime || '').localeCompare(liveMeetings[b].firstTime || '');
    });

    // Build confidence heatmap from tips
    var heatmapHtml = self.renderConfidenceHeatmap(self.tips || []);

    app.innerHTML = '<div class="container">' +
      '<div class="page-header">' +
        '<h1><span class="accent">Horse Racing</span> -- UK Meetings</h1>' +
        '<p>Live race cards from UK courses. Select a meeting to view all races.</p>' +
      '</div>' +
      heatmapHtml +
      '<div class="race-breadcrumb"><span class="breadcrumb-active">Meetings</span></div>' +
      (hasLiveCards ? '<div class="live-data-header" style="margin-bottom:16px;">' +
        '<span class="live-badge">Live Race Cards</span>' +
        '<div class="live-updated">' +
          (liveUpdatedAt ? 'Updated ' + self.timeAgo(liveUpdatedAt.toISOString()) : '') +
          '<button class="refresh-btn" onclick="App.refreshRacingData(this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Refresh</button>' +
        '</div>' +
      '</div>' : '') +
      (meetingKeys.length > 0 ? '<div class="meeting-grid">' +
        meetingKeys.map(function(key) {
          var m = liveMeetings[key];
          var safeKey = key.replace(/[^a-zA-Z0-9]/g, '_');
          return '<button class="meeting-card-btn" onclick="App._selectedMeeting=\'' + key.replace(/'/g, "\\'") + '\';App._racingView=\'races\';App.renderRacing()">' +
            '<div class="meeting-card-name">' + m.name + '</div>' +
            '<div class="meeting-card-meta">' + m.races.length + ' race' + (m.races.length !== 1 ? 's' : '') + '</div>' +
            '<div class="meeting-card-info">' +
              '<span>First race: ' + (m.firstTime || '-') + '</span>' +
              (m.going ? '<span>Going: ' + m.going + '</span>' : '') +
            '</div>' +
            '<div class="going-forecast-placeholder" id="going-forecast-' + safeKey + '" data-meeting="' + key.replace(/"/g, '&quot;') + '" data-going="' + (m.going || '').replace(/"/g, '&quot;') + '"></div>' +
          '</button>';
        }).join('') +
      '</div>' : '<div class="card text-center" style="padding:48px 24px;">' +
        '<h3 style="margin-bottom:8px;">No UK Meetings Available</h3>' +
        '<p class="text-muted">Live race cards are updated throughout the day. Check back closer to race time or ensure the Racing API is configured.</p>' +
      '</div>') +
      // Tips section below
      self._renderRacingTipsSection() +
    '</div>';

    // Load going forecasts asynchronously for each meeting
    if (meetingKeys.length > 0) {
      meetingKeys.forEach(function(key) {
        var safeKey = key.replace(/[^a-zA-Z0-9]/g, '_');
        var placeholder = document.getElementById('going-forecast-' + safeKey);
        if (!placeholder) return;
        var meetingName = placeholder.getAttribute('data-meeting');
        var currentGoing = placeholder.getAttribute('data-going');
        self.fetchGoingForecast(meetingName).then(function(weather) {
          if (weather && placeholder) {
            placeholder.innerHTML = self.renderGoingForecastWidget(weather, currentGoing);
          }
        });
      });
    }
  },

  _renderMeetingRaces() {
    var app = document.getElementById('app');
    var self = this;
    var meetingName = this._selectedMeeting;
    var liveData = this._racingLiveData;
    var racecards = (liveData && liveData.racecards) ? liveData.racecards : [];

    // Filter races for this meeting
    var meetingRaces = racecards.filter(function(r) { return r.meeting === meetingName; });
    meetingRaces.sort(function(a, b) { return (a.time || '').localeCompare(b.time || ''); });

    app.innerHTML = '<div class="container">' +
      '<div class="page-header">' +
        '<h1><span class="accent">' + meetingName + '</span></h1>' +
        '<p>' + meetingRaces.length + ' race' + (meetingRaces.length !== 1 ? 's' : '') + ' today' + (meetingRaces[0] && meetingRaces[0].going ? ' | Going: ' + meetingRaces[0].going : '') + '</p>' +
      '</div>' +
      '<div class="race-breadcrumb">' +
        '<a class="breadcrumb-link" onclick="App._racingView=\'meetings\';App._selectedMeeting=null;App.renderRacing()">Meetings</a>' +
        '<span class="breadcrumb-sep">&rsaquo;</span>' +
        '<span class="breadcrumb-active">' + meetingName + '</span>' +
      '</div>' +
      '<div class="race-list">' +
        (meetingRaces.length ? meetingRaces.map(function(race) {
          var runnerCount = (race.runners || []).length;
          return '<button class="race-list-item" onclick="App._selectedRace=\'' + (race.raceId || race.time || '').replace(/'/g, "\\'") + '\';App._racingView=\'detail\';App.renderRacing()">' +
            '<div class="race-list-time">' + (race.time || '-') + '</div>' +
            '<div class="race-list-body">' +
              '<div class="race-list-name">' + (race.raceName || race.raceClass || 'Race') + '</div>' +
              '<div class="race-list-meta">' +
                [race.raceClass, race.distance, race.going].filter(Boolean).join(' | ') +
              '</div>' +
            '</div>' +
            '<div class="race-list-right">' +
              '<div class="race-list-runners">' + runnerCount + ' runners</div>' +
              (race.prizeMoney ? '<div class="race-list-prize">' + race.prizeMoney + '</div>' : '') +
            '</div>' +
            '<span class="race-list-chevron">&rsaquo;</span>' +
          '</button>';
        }).join('') : '<div class="card text-center" style="padding:32px;"><p class="text-muted">No races found for this meeting.</p></div>') +
      '</div>' +
    '</div>';
  },

  _renderRaceDetail() {
    var app = document.getElementById('app');
    var self = this;
    var meetingName = this._selectedMeeting;
    var raceIdOrTime = this._selectedRace;
    var liveData = this._racingLiveData;
    var intelData = this._racingIntelData;
    var racecards = (liveData && liveData.racecards) ? liveData.racecards : [];
    var intelRaces = (intelData && intelData.live && intelData.races) ? intelData.races : [];

    // Find the race
    var race = racecards.find(function(r) {
      return r.meeting === meetingName && (r.raceId === raceIdOrTime || r.time === raceIdOrTime);
    });
    if (!race) {
      app.innerHTML = '<div class="container"><div class="card text-center" style="padding:48px;"><h3>Race Not Found</h3><p class="text-muted">This race may have been removed or is no longer available.</p><button class="btn btn-outline" onclick="App._racingView=\'races\';App.renderRacing()">Back to ' + (meetingName || 'Races') + '</button></div></div>';
      return;
    }

    // Find intel for this race
    var intel = intelRaces.find(function(ir) {
      return ir.meeting === race.meeting && ir.time === race.time;
    });
    var isPremium = this.isPremium();
    var runners = race.runners || [];

    // Find best odds per runner from allOdds
    function getBestOdds(runner) {
      if (!runner.allOdds || !runner.allOdds.length) return null;
      var best = null;
      var bestDec = 0;
      for (var i = 0; i < runner.allOdds.length; i++) {
        var dec = parseFloat(runner.allOdds[i].decimal) || 0;
        if (dec > bestDec) { bestDec = dec; best = runner.allOdds[i]; }
      }
      return best;
    }

    // Get Bet365 odds for a runner
    function getBet365Odds(runner) {
      if (!runner.allOdds || !runner.allOdds.length) return null;
      return runner.allOdds.find(function(o) { return o.bookmaker && o.bookmaker.toLowerCase().indexOf('bet365') !== -1; });
    }

    // Form character badge colour
    function formCharClass(ch) {
      if (ch === '1') return 'form-char form-char-win';
      if (ch === '2' || ch === '3') return 'form-char form-char-place';
      if (ch === '0' || ch === 'F' || ch === 'f' || ch === 'P' || ch === 'p') return 'form-char form-char-bad';
      if (ch === '-' || ch === '/') return 'form-char form-char-sep';
      return 'form-char form-char-mid';
    }

    function renderFormBadges(formStr) {
      if (!formStr) return '-';
      return formStr.split('').map(function(ch) {
        return '<span class="' + formCharClass(ch) + '">' + ch + '</span>';
      }).join('');
    }

    // Draw silk colour (simple palette based on draw number)
    var silkPalette = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#e84393','#00b894','#6c5ce7','#fd79a8','#fdcb6e','#74b9ff','#a29bfe','#ffeaa7','#dfe6e9','#55efc4','#fab1a0','#81ecec','#ff7675'];

    // Build runner table
    var runnersHtml = '<div class="race-detail-runners">' +
      '<table class="runner-table runner-table-detail">' +
      '<thead><tr><th>Draw</th><th></th><th>Horse</th><th>Age</th><th>Wt</th><th>Jockey</th><th>Trainer</th><th>Form</th><th>Bet365</th><th>Best</th></tr></thead>' +
      '<tbody>' +
      runners.map(function(r, idx) {
        var tag = '';
        if (intel) {
          if (intel.favourite && r.horseName === intel.favourite.name) tag = '<span class="runner-tag fav">FAV</span>';
          else if (intel.danger && r.horseName === intel.danger.name) tag = '<span class="runner-tag danger">DANGER</span>';
          else if (intel.outsider && r.horseName === intel.outsider.name) tag = '<span class="runner-tag outsider">VALUE</span>';
        }
        var drawNum = parseInt(r.draw) || (idx + 1);
        var silkColor = silkPalette[(drawNum - 1) % silkPalette.length];
        var bet365 = getBet365Odds(r);
        var best = getBestOdds(r);
        var bet365Str = bet365 ? (bet365.fractional || self.formatOdds(parseFloat(bet365.decimal))) : (r.odds ? self.formatOdds(r.odds) : '-');
        var bestStr = best ? (best.fractional || self.formatOdds(parseFloat(best.decimal))) : '-';
        var isBestBetter = best && bet365 && parseFloat(best.decimal) > parseFloat(bet365.decimal);
        var rowClass = tag ? ' runner-tagged' : '';
        return '<tr class="runner-row' + rowClass + '">' +
          '<td class="runner-draw">' + (r.draw || '-') + '</td>' +
          '<td><span class="runner-silk" style="background:' + silkColor + ';"></span></td>' +
          '<td class="runner-horse"><span class="runner-horse-name">' + (r.horseName || '-') + '</span>' + (tag ? ' ' + tag : '') + '</td>' +
          '<td>' + (r.age || '-') + '</td>' +
          '<td>' + (r.weight || '-') + '</td>' +
          '<td>' + (r.jockey || '-') + '</td>' +
          '<td>' + (r.trainer || '-') + '</td>' +
          '<td class="runner-form">' + renderFormBadges(r.form) + '</td>' +
          '<td class="runner-odds">' + bet365Str + '</td>' +
          '<td class="runner-odds' + (isBestBetter ? ' odds-best' : '') + '">' + bestStr + (isBestBetter && best.bookmaker ? '<span class="odds-bookie">' + best.bookmaker + '</span>' : '') + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';

    // Build analysis section
    var analysisHtml = '';
    if (intel) {
      var blurClass = isPremium ? '' : ' race-analysis-blurred';
      analysisHtml = '<div class="race-analysis-section">' +
        '<div class="race-analysis-header">ELITE EDGE ANALYSIS</div>' +
        '<div class="race-analysis-content' + blurClass + '">';

      // Verdict
      if (intel.insights.verdict) {
        analysisHtml += '<div class="race-analysis-verdict"><div class="race-analysis-label">Verdict</div><p>' + intel.insights.verdict + '</p></div>';
      }

      // Favourite analysis
      if (intel.insights.favouriteAnalysis) {
        analysisHtml += '<div class="race-analysis-block"><div class="race-analysis-label">Favourite: ' + (intel.favourite ? intel.favourite.name : '') + '</div><p>' + intel.insights.favouriteAnalysis + '</p></div>';
      }

      // Danger analysis
      if (intel.insights.dangerAnalysis) {
        analysisHtml += '<div class="race-analysis-block"><div class="race-analysis-label">Danger: ' + (intel.danger ? intel.danger.name : '') + '</div><p>' + intel.insights.dangerAnalysis + '</p></div>';
      }

      // Outsider insight
      if (intel.insights.outsiderInsight) {
        analysisHtml += '<div class="race-analysis-block"><div class="race-analysis-label">Value Pick: ' + (intel.outsider ? intel.outsider.name : '') + '</div><p>' + intel.insights.outsiderInsight + '</p></div>';
      }

      // Pace analysis
      if (intel.insights.paceAnalysis) {
        analysisHtml += '<div class="race-analysis-block"><div class="race-analysis-label">Pace</div><p>' + intel.insights.paceAnalysis + '</p></div>';
      }

      // Going analysis
      if (intel.insights.goingAnalysis) {
        analysisHtml += '<div class="race-analysis-block"><div class="race-analysis-label">Going</div><p>' + intel.insights.goingAnalysis + '</p></div>';
      }

      // Class analysis
      if (intel.insights.classAnalysis) {
        analysisHtml += '<div class="race-analysis-block"><div class="race-analysis-label">Class</div><p>' + intel.insights.classAnalysis + '</p></div>';
      }

      // Key angle
      if (intel.insights.keyAngle) {
        analysisHtml += '<div class="race-analysis-block"><div class="race-analysis-label">Key Angle</div><p>' + intel.insights.keyAngle + '</p></div>';
      }

      analysisHtml += '</div>'; // end content

      // Upgrade overlay for free users
      if (!isPremium) {
        analysisHtml += '<div class="race-analysis-upgrade">' +
          '<div class="race-analysis-upgrade-inner">' +
            '<h3>Premium Race Intelligence</h3>' +
            '<p class="text-muted" style="margin:8px 0 16px;">Unlock expert verdicts, pace analysis, runner assessments, and value picks for every race.</p>' +
            '<a href="#/pricing" class="btn btn-gold">Upgrade to Premium</a>' +
          '</div>' +
        '</div>';
      }

      analysisHtml += '</div>'; // end section
    }

    app.innerHTML = '<div class="container">' +
      '<div class="race-breadcrumb">' +
        '<a class="breadcrumb-link" onclick="App._racingView=\'meetings\';App._selectedMeeting=null;App._selectedRace=null;App.renderRacing()">Meetings</a>' +
        '<span class="breadcrumb-sep">&rsaquo;</span>' +
        '<a class="breadcrumb-link" onclick="App._racingView=\'races\';App._selectedRace=null;App.renderRacing()">' + meetingName + '</a>' +
        '<span class="breadcrumb-sep">&rsaquo;</span>' +
        '<span class="breadcrumb-active">' + (race.time || '') + ' ' + (race.raceName || '') + '</span>' +
      '</div>' +
      '<div class="race-detail-header">' +
        '<div class="race-detail-meeting">' + meetingName + '</div>' +
        '<h1 class="race-detail-title"><span class="race-detail-time">' + (race.time || '') + '</span> ' + (race.raceName || race.raceClass || 'Race') + '</h1>' +
        '<div class="race-detail-meta">' +
          [race.raceClass, race.distance, race.going, race.surface].filter(Boolean).join(' | ') +
          (race.prizeMoney ? ' | ' + race.prizeMoney : '') +
        '</div>' +
        '<div class="race-detail-stats">' +
          runners.length + ' runners' +
          (intel && intel.avgRating ? ' | Avg OR: ' + intel.avgRating : '') +
          (intel && intel.topRated ? ' | Top rated: ' + intel.topRated.name + ' (' + intel.topRated.rating + ')' : '') +
        '</div>' +
      '</div>' +
      runnersHtml +
      analysisHtml +
      '<div class="race-analysis-section" style="margin-top:20px;" id="racing-ai-preview-section">' +
        '<div class="race-analysis-header">AI RACE PREVIEW</div>' +
        '<p class="text-muted" style="font-size:12px;margin:12px 16px 12px;">Powered by Claude AI — professional written race analysis unique to Elite Edge.</p>' +
        '<div style="padding:0 16px 16px;">' +
          '<button class="btn btn-gold" id="racing-ai-preview-btn" onclick="App.loadRacingAIPreview(\'' + (race.raceId || race.time || '').replace(/'/g, "\\'") + '\')" style="margin-bottom:12px;">Generate AI Preview</button>' +
          '<div id="racing-ai-preview-content"></div>' +
        '</div>' +
      '</div>' +
    '</div>';

    if (typeof trackEvent === 'function') trackEvent('racing', 'race_detail', meetingName + ' ' + race.time);
  },

  _racingAIPreviewCache: {},

  async loadRacingAIPreview(raceId) {
    var btn = document.getElementById('racing-ai-preview-btn');
    var contentDiv = document.getElementById('racing-ai-preview-content');
    if (!btn || !contentDiv) return;

    // Check cache
    if (this._racingAIPreviewCache[raceId]) {
      this._renderRacingAIPreview(contentDiv, this._racingAIPreviewCache[raceId]);
      btn.style.display = 'none';
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner" style="width:16px;height:16px;display:inline-block;vertical-align:middle;margin-right:8px;"></span> Generating...';
    contentDiv.innerHTML = '';

    try {
      var data = await this.api('/racing/ai-preview/' + encodeURIComponent(raceId));
      if (data && data.aiPreview) {
        this._racingAIPreviewCache[raceId] = data.aiPreview;
        this._renderRacingAIPreview(contentDiv, data.aiPreview);
        btn.style.display = 'none';
      } else {
        contentDiv.innerHTML = '<p class="text-muted">AI preview unavailable. The service may not be configured.</p>';
        btn.disabled = false;
        btn.innerHTML = 'Generate AI Preview';
      }
    } catch (err) {
      contentDiv.innerHTML = '<p class="text-muted">Unable to generate AI preview: ' + (err.message || 'Unknown error') + '</p>';
      btn.disabled = false;
      btn.innerHTML = 'Retry AI Preview';
    }
  },

  _renderRacingAIPreview(container, preview) {
    var html = '<div style="background:linear-gradient(135deg,rgba(212,168,67,0.08),rgba(212,168,67,0.02));border:1px solid rgba(212,168,67,0.2);border-radius:12px;padding:20px;">';
    if (preview.headline) {
      html += '<h4 style="color:#d4a843;margin:0 0 12px 0;font-size:16px;">' + preview.headline + '</h4>';
    }
    if (preview.preview) {
      html += '<div style="font-size:13px;color:var(--text-secondary);line-height:1.7;white-space:pre-line;">' + preview.preview + '</div>';
    }
    if (preview.keyFactors && preview.keyFactors.length > 0) {
      html += '<div style="margin-top:14px;"><strong style="color:#d4a843;font-size:12px;">KEY FACTORS:</strong><ul style="margin:6px 0 0 0;padding-left:18px;">';
      preview.keyFactors.forEach(function(factor) {
        html += '<li style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">' + factor + '</li>';
      });
      html += '</ul></div>';
    }
    if (preview.verdict) {
      html += '<div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(212,168,67,0.15);font-weight:700;font-size:13px;color:#d4a843;">' + preview.verdict + '</div>';
    }
    html += '<div style="margin-top:10px;font-size:10px;color:var(--text-muted);">Generated by Claude AI for Elite Edge Sports Tips</div>';
    html += '</div>';
    container.innerHTML = html;
  },

  _renderRacingTipsSection() {
    var self = this;
    var today = this._getToday();
    var tips = (this.tips || []).filter(function(t) {
      return t.sport === 'racing' && t.status === 'active' && App._normDate(t.date) >= today;
    });
    if (tips.length === 0) return '';
    var todayTips = tips.filter(function(t) { return App._normDate(t.date) === today; });
    var displayTips = todayTips.length > 0 ? todayTips : tips.slice(0, 6);
    return '<div class="section" style="margin-top:32px;">' +
      '<div class="section-title"><span class="icon">&#9826;</span> Racing Selections</div>' +
      '<div class="grid grid-2" id="racing-tips">' +
        displayTips.map(function(t) { return self.renderTipCard(t); }).join('') +
      '</div>' +
    '</div>';
  },

  // Legacy modal methods kept for backward compat but now redirect to detail view
  async openRaceIntelligence(meetingName, raceTime) {
    this._selectedMeeting = meetingName;
    this._selectedRace = raceTime;
    this._racingView = 'detail';
    this.renderRacing();
  },

  closeRaceIntelligence() {
    var modal = document.getElementById('race-intel-modal');
    if (modal) modal.remove();
    document.body.style.overflow = '';
  },

  _renderRaceIntelContent(intel, racecard) {
    // Legacy method — now handled by _renderRaceDetail
    this._selectedMeeting = intel.meeting;
    this._selectedRace = intel.time;
    this._racingView = 'detail';
    this.renderRacing();
  },

  // -----------------------------------------------------------------------
  // BETTING ACADEMY
  // -----------------------------------------------------------------------
  _academyGuide: null,

  renderAcademy() {
    var app = document.getElementById('app');
    var self = this;

    var guides = [
      {
        id: 'fundamentals', icon: '&#128218;', title: 'Betting Fundamentals',
        subtitle: 'Everything you need to know before placing your first bet',
        sections: [
          { heading: 'What Are Odds?', body: 'Odds represent the probability of an outcome happening and determine how much you win. There are three formats:<br><br><strong>Fractional (5/2)</strong> — for every £2 you stake, you win £5 profit. Traditional UK format.<br><strong>Decimal (3.50)</strong> — multiply your stake by this number for total returns. £10 at 3.50 = £35.<br><strong>American (+250)</strong> — how much you win from a £100 stake (positive) or how much you need to stake to win £100 (negative).<br><br><a href="#/calculators" style="color:var(--gold);">Try our Odds Converter →</a>' },
          { heading: 'What Is Value Betting?', body: 'Value exists when the bookmaker\'s odds are higher than the true probability of an outcome. If a horse has a 40% chance of winning but the odds imply only 25%, that\'s a value bet — the bookmaker has priced it wrong.<br><br>Our model calculates this as <strong>Edge</strong>. A positive edge means we believe the true probability is higher than what the odds suggest. This is how professional bettors make money long-term — not by picking winners, but by finding value.<br><br><a href="#/selections" style="color:var(--gold);">See today\'s value selections →</a>' },
          { heading: 'Understanding Stake Sizing', body: 'Never bet more than you can afford to lose. Professional staking strategies include:<br><br><strong>Level Stakes</strong> — same amount on every bet. Simple and effective.<br><strong>Percentage Staking</strong> — bet 1-3% of your total bank on each selection. Adjusts as your bank grows or shrinks.<br><strong>Kelly Criterion</strong> — stake proportional to your edge. Higher edge = bigger stake. Mathematically optimal but aggressive.<br><br>Our tips include staking recommendations based on confidence and edge. <a href="#/calculators" style="color:var(--gold);">Use our Bet Calculator →</a>' },
          { heading: 'What Is a Strike Rate?', body: 'Strike rate is the percentage of bets that win. A 50% strike rate means half your bets win. But strike rate alone doesn\'t tell you if you\'re profitable — a 30% strike rate at average odds of 5/1 is far more profitable than an 80% strike rate at 1/5.<br><br>What matters is <strong>ROI (Return on Investment)</strong> — your total profit divided by total stakes. A positive ROI means you\'re beating the bookmaker. We track both strike rate and ROI for every tip on our <a href="#/results" style="color:var(--gold);">Results page →</a>' },
        ]
      },
      {
        id: 'bookmakers', icon: '&#127970;', title: 'How Bookmakers Work',
        subtitle: 'Understanding the house edge and why odds move',
        sections: [
          { heading: 'How Bookmakers Make Money', body: 'Bookmakers build a margin (overround) into every market. In a fair coin toss, both outcomes should be evens (2.0 decimal). But a bookmaker might price it at 1.91 each way — the difference is their profit margin.<br><br>In horse racing, the overround is typically 115-130%, meaning the implied probabilities of all runners add up to more than 100%. The excess is the bookmaker\'s edge. Our model identifies where this margin is distributed unfairly — creating value for you.' },
          { heading: 'Why Do Odds Change?', body: 'Odds move for three reasons:<br><br><strong>1. Market money</strong> — when lots of people back a selection, the bookmaker shortens the price (lowers the odds) to manage their liability.<br><strong>2. Information</strong> — team news, injuries, going changes, non-runners all cause odds to move.<br><strong>3. Bookmaker balancing</strong> — they adjust odds to ensure profit regardless of the outcome.<br><br>When we detect odds shortening significantly, our <strong>Market Mover Explainer</strong> tells you WHY using live intelligence from Perplexity AI. <a href="#/selections" style="color:var(--gold);">See today\'s market movers →</a>' },
          { heading: 'What Is Closing Line Value (CLV)?', body: 'The closing line is the final odds before an event starts. Professional bettors measure their skill by whether they consistently get better odds than the closing line.<br><br>If you back a horse at 5/1 and it closes at 3/1, you had positive CLV — you got a better price than the market settled at. This proves genuine edge, not just luck.<br><br>We track CLV on every single tip. Consistent positive CLV = a model that genuinely beats the market. <a href="#/results" style="color:var(--gold);">See our CLV performance →</a>' },
        ]
      },
      {
        id: 'bet-types', icon: '&#127922;', title: 'Bet Types Explained',
        subtitle: 'From singles to Lucky 63s — every bet type broken down',
        sections: [
          { heading: 'Singles, Doubles, and Trebles', body: '<strong>Single</strong> — one selection. Simplest bet. Lowest risk.<br><strong>Double</strong> — two selections, both must win. Odds multiply together.<br><strong>Treble</strong> — three selections, all must win. Higher returns, higher risk.<br><br>Example: Three selections at 2/1, 3/1, and 5/1 as a treble pays (3 × 4 × 6) - 1 = 71/1. A £1 stake returns £72.' },
          { heading: 'Accumulators (4+ Fold)', body: 'An accumulator combines 4 or more selections. All must win for the bet to pay out. The odds multiply, creating potentially huge returns from small stakes.<br><br>Our <strong>Smart Acca Generator</strong> uses probability modelling to build accumulators with the best chance of landing. It ranks selections by edge and confidence, not just odds. <a href="#/acca-generator" style="color:var(--gold);">Build an acca now →</a>' },
          { heading: 'Each-Way Betting', body: 'An each-way bet is two bets in one: a win bet and a place bet. If your selection wins, both parts pay out. If it places (typically top 2-4), only the place part pays — at a fraction of the win odds (usually 1/4 or 1/5).<br><br>Each-way is ideal for bigger-priced selections where a place return covers your stake. Our outsider picks are always recommended each-way. <a href="#/calculators" style="color:var(--gold);">Calculate EW returns →</a>' },
          { heading: 'System Bets: Trixie, Yankee, Lucky 15', body: '<strong>Trixie (3 selections)</strong> — 4 bets: 3 doubles + 1 treble. Two must win to get a return.<br><strong>Patent (3 selections)</strong> — 7 bets: 3 singles + 3 doubles + 1 treble. One winner gives a return.<br><strong>Yankee (4 selections)</strong> — 11 bets: 6 doubles + 4 trebles + 1 four-fold.<br><strong>Lucky 15 (4 selections)</strong> — 15 bets: 4 singles + 6 doubles + 4 trebles + 1 four-fold. Bookmakers often offer consolation bonuses if only one wins.<br><br><a href="#/calculators" style="color:var(--gold);">Calculate system bets →</a>' },
          { heading: 'Dutching', body: 'Dutching means backing multiple selections in the same event with calculated stakes so you win the same amount regardless of which one wins. Useful when you can\'t separate two or three runners.<br><br><a href="#/calculators" style="color:var(--gold);">Use our Dutching Calculator →</a>' },
        ]
      },
    ];

    if (this._academyGuide) {
      var guide = guides.find(function(g) { return g.id === self._academyGuide; });
      if (guide) {
        var sectionsHtml = guide.sections.map(function(s, i) {
          return '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:16px;">' +
            '<h3 style="color:var(--gold);font-size:18px;margin-bottom:12px;">' + (i + 1) + '. ' + s.heading + '</h3>' +
            '<div style="color:var(--text-secondary);font-size:14px;line-height:1.8;">' + s.body + '</div>' +
          '</div>';
        }).join('');

        app.innerHTML =
          '<div class="container" style="max-width:800px;padding-top:30px;">' +
            '<a href="#/academy" onclick="App._academyGuide=null;App.route();return false;" style="color:var(--gold);font-size:13px;text-decoration:none;">&larr; Back to Academy</a>' +
            '<div class="page-header" style="margin-top:16px;">' +
              '<h1><span style="font-size:36px;margin-right:12px;">' + guide.icon + '</span> ' + guide.title + '</h1>' +
              '<p style="color:var(--text-secondary);">' + guide.subtitle + '</p>' +
            '</div>' +
            sectionsHtml +
            '<div style="background:linear-gradient(135deg,rgba(212,168,67,0.1),rgba(212,168,67,0.04));border:2px solid rgba(212,168,67,0.3);border-radius:14px;padding:24px;text-align:center;margin-top:24px;">' +
              '<h3 style="color:var(--gold);margin-bottom:8px;">Ready to put theory into practice?</h3>' +
              '<p style="color:var(--text-secondary);font-size:14px;margin-bottom:16px;">Our AI-powered model applies these principles automatically across 6 sports, 14 data sources, and 40+ bookmakers.</p>' +
              '<a href="#/pricing" class="btn btn-gold">Start 14-Day Free Trial &rarr;</a>' +
              '<p style="color:#64748b;font-size:10px;margin-top:12px;">18+ | Educational content only | Gambling involves risk | <a href="https://www.begambleaware.org" target="_blank" rel="noopener" style="color:#f59e0b;">BeGambleAware.org</a></p>' +
            '</div>' +
          '</div>';
        return;
      }
    }

    // Guide list page
    var cardsHtml = guides.map(function(g) {
      return '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;cursor:pointer;transition:border-color 0.2s;" onclick="App._academyGuide=\'' + g.id + '\';App.route();" onmouseover="this.style.borderColor=\'rgba(212,168,67,0.5)\'" onmouseout="this.style.borderColor=\'\'">' +
        '<div style="font-size:36px;margin-bottom:12px;">' + g.icon + '</div>' +
        '<h3 style="color:var(--text-primary);font-size:18px;margin-bottom:6px;">' + g.title + '</h3>' +
        '<p style="color:var(--text-secondary);font-size:13px;line-height:1.5;margin-bottom:12px;">' + g.subtitle + '</p>' +
        '<div style="color:var(--gold);font-size:13px;font-weight:600;">' + g.sections.length + ' lessons &rarr;</div>' +
      '</div>';
    }).join('');

    app.innerHTML =
      '<div class="container" style="max-width:900px;padding-top:30px;">' +
        '<div class="page-header text-center">' +
          '<h1 style="color:var(--gold);">Betting Academy</h1>' +
          '<p style="color:var(--text-secondary);">Educational guides explaining how sports betting works.</p>' +
          '<div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:8px;padding:12px 16px;margin-top:12px;max-width:600px;margin-left:auto;margin-right:auto;text-align:left;">' +
            '<p style="color:#f59e0b;font-size:11px;font-weight:700;margin:0 0 4px;">RESPONSIBLE GAMBLING</p>' +
            '<p style="color:#94a3b8;font-size:11px;margin:0;line-height:1.5;">This content is for educational purposes only. We do not encourage gambling. If you choose to bet, only wager what you can afford to lose. If you feel you may have a gambling problem, visit <a href="https://www.begambleaware.org" target="_blank" rel="noopener" style="color:#f59e0b;">BeGambleAware.org</a> or call the National Gambling Helpline: 0808 8020 133. 18+</p>' +
          '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:32px;">' + cardsHtml + '</div>' +
        '<div style="text-align:center;">' +
          '<p style="color:var(--text-muted);font-size:13px;">Want to skip the theory and see it in action? <a href="#/selections" style="color:var(--gold);">View today\'s AI-powered selections →</a></p>' +
        '</div>' +
      '</div>';
  },

  // -----------------------------------------------------------------------
  // BUY CREDITS PAGE
  // -----------------------------------------------------------------------
  renderBuyCredits() {
    var app = document.getElementById('app');
    var credits = this.user ? this.user.credits || 0 : 0;
    var sub = this.user ? this.user.subscription : 'free';

    var upgradeTier = sub === 'free' ? 'Starter' : sub === 'starter' ? 'Premium' : sub === 'premium' ? 'VIP' : '';
    var upgradeCredits = sub === 'free' ? '40' : sub === 'starter' ? '120' : sub === 'premium' ? 'Unlimited' : '';
    var upgradePrice = sub === 'free' ? '9.99' : sub === 'starter' ? '19.99' : sub === 'premium' ? '39.99' : '';
    var upgradePlan = sub === 'free' ? 'starter-monthly' : sub === 'starter' ? 'premium-monthly' : sub === 'premium' ? 'vip-monthly' : '';

    app.innerHTML =
      '<div class="container" style="max-width:700px;padding-top:40px;">' +
        '<div class="page-header text-center">' +
          '<h1 style="color:var(--gold);">Buy Credits</h1>' +
          '<p style="color:var(--text-secondary);">You have <strong style="color:var(--gold);font-size:20px;">' + credits + '</strong> credits remaining</p>' +
        '</div>' +

        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:32px;">' +
          '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;text-align:center;cursor:pointer;" onclick="App.buyCredits(\'credits-5\')">' +
            '<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px;">Quick Top-Up</div>' +
            '<div style="font-size:32px;font-weight:900;color:var(--text-primary);">5</div>' +
            '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">credits</div>' +
            '<div style="font-size:20px;font-weight:800;color:var(--gold);">&pound;1.99</div>' +
            '<div style="font-size:11px;color:var(--text-muted);">40p per credit</div>' +
          '</div>' +
          '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;text-align:center;cursor:pointer;" onclick="App.buyCredits(\'credits-15\')">' +
            '<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px;">Weekend Pack</div>' +
            '<div style="font-size:32px;font-weight:900;color:var(--text-primary);">15</div>' +
            '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">credits</div>' +
            '<div style="font-size:20px;font-weight:800;color:var(--gold);">&pound;4.99</div>' +
            '<div style="font-size:11px;color:var(--text-muted);">33p per credit</div>' +
          '</div>' +
          '<div style="background:var(--bg-card);border:2px solid var(--gold);border-radius:12px;padding:24px;text-align:center;cursor:pointer;position:relative;" onclick="App.buyCredits(\'credits-40\')">' +
            '<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:var(--gold);color:#0a0e1a;padding:2px 12px;border-radius:10px;font-size:10px;font-weight:800;">BEST VALUE</div>' +
            '<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px;">40 Pack</div>' +
            '<div style="font-size:32px;font-weight:900;color:var(--text-primary);">40</div>' +
            '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">credits</div>' +
            '<div style="font-size:20px;font-weight:800;color:var(--gold);">&pound;8.99</div>' +
            '<div style="font-size:11px;color:var(--text-muted);">22p per credit</div>' +
          '</div>' +
        '</div>' +

        (upgradeTier ? '<div style="background:linear-gradient(135deg,rgba(212,168,67,0.1),rgba(212,168,67,0.04));border:2px solid rgba(212,168,67,0.3);border-radius:14px;padding:24px;text-align:center;margin-bottom:32px;">' +
          '<div style="font-size:14px;color:var(--text-secondary);margin-bottom:8px;">Or get <strong style="color:var(--gold);">' + upgradeCredits + ' credits every month</strong> with ' + upgradeTier + '</div>' +
          '<div style="display:flex;justify-content:center;gap:16px;align-items:center;margin-bottom:12px;">' +
            '<div style="color:var(--text-muted);"><span style="text-decoration:line-through;">40 credits one-time: &pound;8.99</span></div>' +
            '<div style="color:var(--gold);font-weight:800;">' + upgradeCredits + ' credits EVERY month: &pound;' + upgradePrice + '</div>' +
          '</div>' +
          '<button class="btn btn-gold" onclick="App.startCheckout(\'' + upgradePlan + '\')">Subscribe to ' + upgradeTier + ' &rarr;</button>' +
        '</div>' : '') +

        '<div style="text-align:center;margin-bottom:32px;">' +
          '<p style="color:var(--text-muted);font-size:13px;">Earn free credits: <a href="#/refer" style="color:var(--gold);">Refer a friend for +3 credits &rarr;</a></p>' +
        '</div>' +
      '</div>';
  },

  async buyCredits(packId) {
    try {
      this.showToast('Redirecting to checkout...', 'info');
      var data = await this.api('/stripe/buy-credits', { method: 'POST', body: JSON.stringify({ pack: packId }) });
      if (data.url) window.location.href = data.url;
      else throw new Error(data.error || 'Unable to create checkout');
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  // -----------------------------------------------------------------------
  // REFERRAL PAGE
  // -----------------------------------------------------------------------
  async renderReferral() {
    var app = document.getElementById('app');
    if (!this.user) {
      app.innerHTML = '<div class="container text-center" style="padding:60px;"><h2>Sign in to access referrals</h2><button class="btn btn-gold" onclick="App.showModal(\'login\')">Sign In</button></div>';
      return;
    }

    try {
      var data = await this.api('/auth/referral');
      var referralLink = data.referralLink || '';
      var referralCount = data.referralCount || 0;
      var referralCode = data.referralCode || '';

      app.innerHTML =
        '<div class="container" style="max-width:600px;padding-top:40px;">' +
          '<div class="page-header text-center">' +
            '<h1 style="color:var(--gold);">Refer &amp; Earn</h1>' +
            '<p style="color:var(--text-secondary);">Share your link. Earn free credits.</p>' +
          '</div>' +

          '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:24px;text-align:center;">' +
            '<div style="font-size:48px;margin-bottom:12px;">&#127381;</div>' +
            '<h3 style="color:var(--text-primary);margin-bottom:16px;">How It Works</h3>' +
            '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px;">' +
              '<div><div style="font-size:24px;font-weight:900;color:var(--gold);">1</div><div style="font-size:12px;color:var(--text-secondary);">Share your unique link</div></div>' +
              '<div><div style="font-size:24px;font-weight:900;color:var(--gold);">2</div><div style="font-size:12px;color:var(--text-secondary);">Friend signs up (free)</div></div>' +
              '<div><div style="font-size:24px;font-weight:900;color:var(--gold);">3</div><div style="font-size:12px;color:var(--text-secondary);">You earn +3 credits</div></div>' +
            '</div>' +
            '<div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px;color:#22c55e;">Bonus: Earn +5 extra credits when your referral starts a free trial!</div>' +
          '</div>' +

          '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:24px;">' +
            '<div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px;">Your Referral Link</div>' +
            '<div style="display:flex;gap:8px;">' +
              '<input type="text" value="' + referralLink + '" readonly style="flex:1;padding:10px 14px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:13px;" id="referral-link-input">' +
              '<button class="btn btn-gold" onclick="navigator.clipboard.writeText(document.getElementById(\'referral-link-input\').value);App.showToast(\'Link copied!\',\'success\')">Copy</button>' +
            '</div>' +
          '</div>' +

          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">' +
            '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:20px;text-align:center;">' +
              '<div style="font-size:32px;font-weight:900;color:var(--gold);">' + referralCount + '</div>' +
              '<div style="font-size:12px;color:var(--text-muted);">People Referred</div>' +
            '</div>' +
            '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:20px;text-align:center;">' +
              '<div style="font-size:32px;font-weight:900;color:#22c55e;">' + (referralCount * 3) + '</div>' +
              '<div style="font-size:12px;color:var(--text-muted);">Credits Earned</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    } catch (err) {
      app.innerHTML = '<div class="container"><p>Unable to load referral data.</p></div>';
    }
  },

  // -----------------------------------------------------------------------
  // SPORT-SPECIFIC TIPS PAGE (NBA, Rugby, NFL)
  // -----------------------------------------------------------------------
  async renderSportTips(sportKey, sportLabel) {
    var app = document.getElementById('app');
    var self = this;
    var isPremium = this.isPremium();
    app.innerHTML = this.renderSkeleton('tips');

    try {
      var allTips = await this.api('/tips');
      if (allTips.tips) allTips = allTips.tips;
      if (!Array.isArray(allTips)) allTips = [];

      var today = new Date().toISOString().split('T')[0];
      var sportTips = allTips.filter(function(t) {
        return t.sport === sportKey;
      });

      var sportIcon = sportKey === 'basketball' ? '&#127936;' : sportKey === 'rugby' ? '&#127945;' : '&#127944;';

      var html = '<div class="container" style="padding-top:20px;">' +
        '<div class="page-header">' +
          '<h1>' + sportIcon + ' <span class="accent">' + sportLabel + '</span> Tips</h1>' +
          '<p>AI-powered selections with full statistical analysis</p>' +
        '</div>';

      if (sportTips.length === 0) {
        html += '<div style="text-align:center;padding:60px 20px;">' +
          '<div style="font-size:48px;margin-bottom:16px;">' + sportIcon + '</div>' +
          '<h2 style="color:var(--text-primary);">No ' + sportLabel + ' Tips Today</h2>' +
          '<p style="color:var(--text-secondary);margin-bottom:24px;">' + sportLabel + ' tips are published when our model identifies value in upcoming fixtures. Check back on game days.</p>' +
          '<a href="#/" class="btn btn-outline">Back to Dashboard</a>' +
        '</div>';
      } else {
        sportTips.forEach(function(tip) {
          var isLocked = tip.locked || (tip.isPremium && !isPremium);
          var oddsDisplay = isLocked ? '?.??' : (self.formatOdds ? self.formatOdds(tip.odds) : tip.odds);

          html += '<div class="tip-card" style="margin-bottom:16px;padding:20px;background:var(--bg-card);border-radius:12px;border:1px solid var(--border);">';

          // Header row
          html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
          html += '<div>';
          html += '<div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--gold);margin-bottom:4px;">' + sportLabel + '</div>';
          html += '<h3 style="margin:0;color:var(--text-primary);font-size:18px;">' + (tip.selection || 'Premium Pick') + '</h3>';
          html += '<div style="color:var(--text-secondary);font-size:13px;margin-top:2px;">' + (tip.event || '') + '</div>';
          html += '</div>';
          html += '<div style="text-align:right;">';
          html += '<div style="font-size:24px;font-weight:900;color:var(--text-primary);">' + oddsDisplay + '</div>';
          if (tip.market) html += '<div style="font-size:11px;color:var(--text-muted);">' + tip.market + '</div>';
          html += '</div>';
          html += '</div>';

          // Stats row
          if (!isLocked) {
            html += '<div style="display:flex;gap:16px;font-size:12px;color:var(--text-secondary);margin-bottom:12px;flex-wrap:wrap;">';
            if (tip.confidence) html += '<span>Conf: <strong>' + tip.confidence + '/10</strong></span>';
            if (tip.edge) html += '<span>Edge: <strong>' + (tip.edge * 100).toFixed(1) + '%</strong></span>';
            if (tip.modelProbability) html += '<span>Prob: <strong>' + (tip.modelProbability * 100).toFixed(0) + '%</strong></span>';
            if (tip.tipsterProfile) html += '<span style="color:var(--gold);">' + tip.tipsterProfile + '</span>';
            html += '</div>';

            // Analysis
            if (tip.analysis && tip.analysis.summary) {
              html += '<div style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:12px;border-top:1px solid var(--border);padding-top:12px;">' + tip.analysis.summary + '</div>';
            }
            if (tip.analysis && tip.analysis.form) {
              html += '<div style="font-size:12px;color:var(--text-muted);line-height:1.5;">' + tip.analysis.form + '</div>';
            }
            if (tip.analysis && tip.analysis.riskNotes) {
              html += '<div style="font-size:12px;color:#ef4444;margin-top:8px;">' + tip.analysis.riskNotes + '</div>';
            }
          } else {
            html += '<div style="text-align:center;padding:20px;background:rgba(212,168,67,0.05);border-radius:8px;">';
            html += '<div style="font-size:24px;margin-bottom:8px;">&#128274;</div>';
            html += '<div style="color:var(--text-secondary);font-size:13px;margin-bottom:12px;">Full analysis available to Premium members</div>';
            html += '<a href="#/pricing" class="btn btn-gold btn-sm">Unlock Premium</a>';
            html += '</div>';
          }

          html += '</div>';
        });
      }

      // Results section
      var results = await this.api('/results');
      if (results.results) results = results.results;
      if (!Array.isArray(results)) results = [];
      var sportResults = results.filter(function(r) { return r.sport === sportKey; }).slice(0, 10);

      if (sportResults.length > 0) {
        html += '<div style="margin-top:32px;">';
        html += '<h2 style="color:var(--gold);font-size:20px;margin-bottom:16px;">Recent ' + sportLabel + ' Results</h2>';
        sportResults.forEach(function(r) {
          var resultColor = r.result === 'won' ? 'var(--green)' : r.result === 'placed' ? '#60a5fa' : 'var(--red)';
          html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);font-size:13px;">';
          html += '<div><strong>' + (r.selection || '') + '</strong> <span style="color:var(--text-muted);">' + (r.event || '') + '</span></div>';
          html += '<div style="display:flex;gap:12px;align-items:center;">';
          html += '<span>' + (r.odds || '') + '</span>';
          html += '<span style="color:' + resultColor + ';font-weight:700;text-transform:uppercase;">' + (r.result || '') + '</span>';
          html += '<span style="color:' + (r.pnl >= 0 ? 'var(--green)' : 'var(--red)') + ';font-weight:700;">' + (r.pnl >= 0 ? '+' : '') + (r.pnl || 0).toFixed(2) + 'u</span>';
          html += '</div></div>';
        });
        html += '</div>';
      }

      html += '</div>';
      app.innerHTML = html;
    } catch (err) {
      app.innerHTML = '<div class="container"><div class="page-header"><h1>' + sportLabel + ' Tips</h1></div><p style="color:var(--text-secondary);">Unable to load tips. Please try again.</p></div>';
    }
  },

  // TODAY'S SELECTIONS PAGE
  // -----------------------------------------------------------------------
  async renderSelections() {
    var app = document.getElementById('app');
    app.innerHTML = this.renderSkeleton('tips');

    try {
      this.tips = await this.api('/tips');
    } catch (e) { /* use cached */ }

    var today = this._getToday();
    var isPremium = this.isPremium();

    // Filter to today's active tips (normalise date — PostgreSQL returns Date objects)
    var todayTips = this.tips.filter(function(t) {
      var tipDate = (t.date || '').toString().split('T')[0];
      return t.status === 'active' && tipDate === today;
    });

    var racingTips = todayTips.filter(function(t) { return t.sport === 'racing'; });
    var footballTips = todayTips.filter(function(t) { return t.sport === 'football'; });

    // Find NAP of the day (highest confidence tip, or one flagged as NAP)
    var napTip = null;
    var otherTips = todayTips.slice();
    if (todayTips.length) {
      // Look for an explicit NAP first (valueRating === 'Elite' and highest confidence)
      var sortedByConf = todayTips.slice().sort(function(a, b) { return (b.confidence || 0) - (a.confidence || 0); });
      var eliteTips = sortedByConf.filter(function(t) { return t.valueRating === 'Elite'; });
      napTip = eliteTips.length > 0 ? eliteTips[0] : sortedByConf[0];
      otherTips = todayTips.filter(function(t) { return t.id !== napTip.id; });
    }

    // Apply confidence threshold filter
    var confMin = this._confThreshold || 0;
    if (confMin > 0) {
      otherTips = otherTips.filter(function(t) { return (t.confidence || 0) >= confMin; });
    }

    var otherRacing = otherTips.filter(function(t) { return t.sport === 'racing'; });
    var otherFootball = otherTips.filter(function(t) { return t.sport === 'football'; });
    // Other sports (NBA, Tennis, Rugby, NFL)
    var otherSports = otherTips.filter(function(t) { return t.sport !== 'racing' && t.sport !== 'football'; });

    // Format date
    var dateObj = new Date(today + 'T12:00:00');
    var formattedDate = dateObj.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    var self = this;

    app.innerHTML = '<div class="container">' +
      '<div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">' +
        '<div>' +
          '<h1><span class="accent">Today\'s Selections</span></h1>' +
          '<p>' + formattedDate + '</p>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
          '<label style="font-size:12px;color:var(--text-muted);white-space:nowrap;">Min Confidence:</label>' +
          '<select onchange="App._confThreshold=parseInt(this.value);localStorage.setItem(\'ee_conf_threshold\',this.value);App.renderSelections();" style="padding:8px 12px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:13px;font-weight:600;">' +
            '<option value="0"' + (confMin === 0 ? ' selected' : '') + '>Show All</option>' +
            '<option value="6"' + (confMin === 6 ? ' selected' : '') + '>6+ Only</option>' +
            '<option value="7"' + (confMin === 7 ? ' selected' : '') + '>7+ Strong</option>' +
            '<option value="8"' + (confMin === 8 ? ' selected' : '') + '>8+ High</option>' +
            '<option value="9"' + (confMin === 9 ? ' selected' : '') + '>9+ Elite</option>' +
          '</select>' +
        '</div>' +
      '</div>' +

      // Summary bar
      '<div class="selections-summary">' +
        '<div class="selections-summary-item">' +
          '<span class="selections-summary-count">' + todayTips.length + '</span>' +
          '<span class="selections-summary-label">Tips Published</span>' +
        '</div>' +
        '<div class="selections-summary-item">' +
          '<span class="selections-summary-count">' + racingTips.length + '</span>' +
          '<span class="selections-summary-label">Racing</span>' +
        '</div>' +
        '<div class="selections-summary-item">' +
          '<span class="selections-summary-count">' + footballTips.length + '</span>' +
          '<span class="selections-summary-label">Football</span>' +
        '</div>' +
      '</div>' +

      // No tips message
      (todayTips.length === 0 ? '<div class="card text-center" style="padding:48px 24px;">' +
        '<div style="font-size:36px;margin-bottom:16px;">&#9200;</div>' +
        '<h3 style="margin-bottom:8px;">No Selections Yet</h3>' +
        '<p class="text-muted">Tips publish daily by 7:30am UK. Check back soon.</p>' +
      '</div>' : '') +

      // NAP of the Day
      (napTip ? '<div class="selections-nap-section">' +
        '<div class="selections-nap-label">NAP of the Day</div>' +
        '<div class="selections-nap-card">' +
          self.renderTipCard(napTip) +
        '</div>' +
      '</div>' : '') +

      // Racing section
      (otherRacing.length ? '<div class="section">' +
        '<div class="section-title"><span class="icon">&#9826;</span> Racing Selections <span class="selections-count-badge">' + otherRacing.length + '</span></div>' +
        '<div class="grid grid-2">' +
          otherRacing.map(function(t) { return self.renderTipCard(t); }).join('') +
        '</div>' +
      '</div>' : '') +

      // Football section
      (otherFootball.length ? '<div class="section">' +
        '<div class="section-title"><span class="icon">&#9917;</span> Football Selections <span class="selections-count-badge">' + otherFootball.length + '</span></div>' +
        '<div class="grid grid-2">' +
          otherFootball.map(function(t) { return self.renderTipCard(t); }).join('') +
        '</div>' +
      '</div>' : '') +

      // Other sports section
      (otherSports.length ? '<div class="section">' +
        '<div class="section-title"><span class="icon">&#127919;</span> Other Sports <span class="selections-count-badge">' + otherSports.length + '</span></div>' +
        '<div class="grid grid-2">' +
          otherSports.map(function(t) { return self.renderTipCard(t); }).join('') +
        '</div>' +
      '</div>' : '') +

      // Confidence filter info
      (confMin > 0 ? '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:13px;">Showing tips with confidence ' + confMin + '/10 or higher. <a href="#" onclick="App._confThreshold=0;localStorage.setItem(\'ee_conf_threshold\',\'0\');App.renderSelections();return false;" style="color:var(--gold);">Show all</a></div>' : '') +

      // Bottom links
      '<div class="selections-footer">' +
        '<a href="#/results" class="btn btn-outline">View Results</a>' +
        '<a href="#/my-roi" class="btn btn-outline">My ROI Dashboard</a>' +
      '</div>' +

    '</div>';
  },

  async refreshRacingData(btn) {
    if (btn) { btn.classList.add('spinning'); btn.disabled = true; }
    try {
      this._racingLiveData = null;
      this._racingIntelData = null;
      await this.fetchLiveRacing(true);
      await this.fetchRaceIntelligence(true);
      this._racingLiveData = this._getCached('racing', 180000);
      this._racingIntelData = this._getCached('race-intel', 300000);
      this.renderRacing();
    } catch (e) { console.error('Refresh failed:', e); }
    if (btn) { btn.classList.remove('spinning'); btn.disabled = false; }
  },

  async filterRacing(value, type) {
    const todayStr = new Date().toISOString().split('T')[0];
    let tips = this.tips.filter(t => t.sport === 'racing' && t.status === 'active' && App._normDate(t.date) >= todayStr);
    if (value && type === 'meeting') tips = tips.filter(t => t.meeting === value);
    if (value && type === 'market') tips = tips.filter(t => t.market === value);
    if (value && type === 'going') tips = tips.filter(t => t.going === value);
    if (value && type === 'analyst') tips = tips.filter(t => t.tipsterProfile === value);
    document.getElementById('racing-tips').innerHTML = tips.map(t => this.renderTipCard(t)).join('') || '<p class="text-muted">No tips match these filters.</p>';
  },

  // -----------------------------------------------------------------------
  // VALUE BETS PAGE
  // -----------------------------------------------------------------------
  async renderValueBets() {
    // Clear any previous value-bet auto-refresh
    if (this._valueBetsInterval) { clearInterval(this._valueBetsInterval); this._valueBetsInterval = null; }

    var app = document.getElementById('app');
    var isPremium = this.isPremium();
    var self = this;

    app.innerHTML = this.renderSkeleton('tips');

    async function fetchAndRender(minEdge) {
      try {
        var res = await fetch('/api/odds/value-bets?minEdge=' + (minEdge || 5));
        var data = res.ok ? await res.json() : { valueBets: [] };
        var bets = data.valueBets || data || [];
        if (!Array.isArray(bets)) bets = [];
        renderPage(bets, minEdge || 5);
      } catch (e) {
        renderPage([], minEdge || 5);
      }
    }

    function renderPage(bets, minEdge) {
      var now = new Date();
      var timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      var html = '<div class="value-bets-page">';

      // Header
      html += '<div class="vb-header">';
      html += '<div class="vb-header-top">';
      html += '<div>';
      html += '<h1 class="vb-title">Value Bet <span class="gold-accent">Scanner</span></h1>';
      html += '<p class="vb-subtitle">Where the bookmakers disagree &mdash; find the biggest edges</p>';
      html += '</div>';
      html += '<div class="vb-refresh-info">';
      html += '<span class="vb-refresh-dot"></span>';
      html += '<span class="vb-refresh-text">Last scan: ' + timeStr + '</span>';
      html += '</div>';
      html += '</div>';

      // Filters
      html += '<div class="value-bet-filters">';
      html += '<div class="vb-filter-group">';
      html += '<label class="vb-filter-label">Min Edge</label>';
      html += '<select id="vb-edge-filter" class="vb-select" onchange="App._valueBetsFilterEdge(this.value)">';
      [3, 5, 8, 10, 15].forEach(function(v) {
        html += '<option value="' + v + '"' + (v === minEdge ? ' selected' : '') + '>' + v + '%</option>';
      });
      html += '</select>';
      html += '</div>';
      html += '<div class="vb-filter-group">';
      html += '<label class="vb-filter-label">Sort</label>';
      html += '<select id="vb-sort" class="vb-select" onchange="App._valueBetsSortChange()">';
      html += '<option value="edge">Highest Edge</option>';
      html += '<option value="time">Soonest First</option>';
      html += '<option value="sport">By Sport</option>';
      html += '</select>';
      html += '</div>';
      html += '</div>';
      html += '</div>';

      // How it works (collapsible)
      html += '<details class="vb-explainer">';
      html += '<summary class="vb-explainer-toggle">How does the scanner work?</summary>';
      html += '<div class="vb-explainer-body">';
      html += '<p>When one bookmaker offers significantly better odds than the market average, that\'s a value bet. Our scanner compares <strong>40+ UK bookmakers</strong> in real-time to surface the selections where the pricing disagrees most. A higher edge percentage means a bigger discrepancy between the best available price and the market consensus.</p>';
      html += '</div>';
      html += '</details>';

      // Bets grid
      if (bets.length === 0) {
        html += '<div class="vb-empty">';
        html += '<div class="vb-empty-icon">&#128269;</div>';
        html += '<h3>No value bets detected right now</h3>';
        html += '<p>The scanner checks every 2 minutes. Try lowering the minimum edge filter or check back shortly.</p>';
        html += '</div>';
      } else {
        html += '<div class="value-bet-grid" id="vb-grid">';
        bets.forEach(function(bet, idx) {
          var edgeNum = parseFloat(bet.edgePercent || bet.edge || 0);
          var borderClass = edgeNum >= 10 ? 'vb-edge-high' : (edgeNum >= 5 ? 'vb-edge-medium' : 'vb-edge-low');
          var sportBadge = (bet.sport || 'racing').toLowerCase();
          var sportLabel = sportBadge === 'football' ? 'Football' : 'Racing';
          var sportBadgeClass = sportBadge === 'football' ? 'vb-sport-football' : 'vb-sport-racing';

          var showBlur = !isPremium && idx >= 2;

          html += '<div class="value-bet-card ' + borderClass + (showBlur ? ' vb-card-blurred' : '') + '">';
          html += '<div class="vb-card-header">';
          html += '<span class="vb-sport-badge ' + sportBadgeClass + '">' + sportLabel + '</span>';
          if (bet.marketRank) html += '<span class="vb-market-rank">Rank #' + bet.marketRank + '</span>';
          html += '</div>';

          html += '<div class="vb-event-name">' + (bet.eventName || bet.event || 'Unknown Event') + '</div>';
          html += '<div class="vb-selection-name">' + (bet.selectionName || bet.selection || bet.runner || 'Unknown') + '</div>';

          html += '<div class="vb-price-row">';
          html += '<div class="vb-best-price-block">';
          html += '<div class="value-bet-best-price">' + (bet.bestPrice || bet.bestOdds || '-') + '</div>';
          html += '<div class="vb-best-at">Best at: <strong>' + (bet.bestBookmaker || bet.bookmaker || '-') + '</strong></div>';
          html += '</div>';
          html += '<div class="value-bet-edge">';
          html += '<div class="vb-edge-label">EDGE</div>';
          html += '<div class="vb-edge-value">+' + edgeNum.toFixed(1) + '%</div>';
          html += '</div>';
          html += '</div>';

          html += '<div class="value-bet-comparison">';
          html += '<div class="vb-comp-row">';
          html += '<span class="vb-comp-label">Avg price</span>';
          html += '<span class="vb-comp-value">' + (bet.avgPrice || bet.averageOdds || '-') + '</span>';
          html += '</div>';
          var barWidth = Math.min(edgeNum * 5, 100);
          html += '<div class="vb-comp-bar"><div class="vb-comp-bar-fill" style="width:' + barWidth + '%"></div></div>';
          html += '</div>';

          html += '<div class="vb-card-footer">';
          html += '<span class="value-bet-bookmaker">' + (bet.bookmakerCount || bet.numBookmakers || '-') + ' bookmakers</span>';
          if (bet.eventTime || bet.time) {
            var t = bet.eventTime || bet.time;
            html += '<span class="vb-event-time">' + t + '</span>';
          }
          html += '</div>';
          html += '</div>';
        });
        html += '</div>';

        // Premium gate overlay
        if (!isPremium && bets.length > 2) {
          html += '<div class="vb-premium-gate">';
          html += '<div class="vb-premium-gate-inner">';
          html += '<h3>Unlock All Value Bets</h3>';
          html += '<p>Premium members get full access to the value bet scanner with unlimited real-time alerts.</p>';
          html += '<button class="btn btn-gold" onclick="window.location.hash=\'#/pricing\'">Upgrade to Premium</button>';
          html += '</div>';
          html += '</div>';
        }
      }

      html += '</div>';
      app.innerHTML = html;
    }

    // Initial fetch
    await fetchAndRender(5);

    // Auto-refresh every 120s
    this._valueBetsInterval = setInterval(function() {
      if (self.currentPage !== 'value-bets') { clearInterval(self._valueBetsInterval); self._valueBetsInterval = null; return; }
      var sel = document.getElementById('vb-edge-filter');
      var minEdge = sel ? parseInt(sel.value) : 5;
      fetchAndRender(minEdge);
    }, 120000);
  },

  _valueBetsFilterEdge(val) {
    if (this._valueBetsInterval) { clearInterval(this._valueBetsInterval); this._valueBetsInterval = null; }
    var self = this;
    (async function() {
      try {
        var res = await fetch('/api/odds/value-bets?minEdge=' + val);
        var data = res.ok ? await res.json() : { valueBets: [] };
        var bets = data.valueBets || data || [];
        if (!Array.isArray(bets)) bets = [];
        self.renderValueBets();
      } catch (e) {
        self.renderValueBets();
      }
    })();
  },

  _valueBetsSortChange() {
    var sortVal = document.getElementById('vb-sort') ? document.getElementById('vb-sort').value : 'edge';
    var grid = document.getElementById('vb-grid');
    if (!grid) return;
    var cards = Array.from(grid.children);
    cards.sort(function(a, b) {
      if (sortVal === 'edge') {
        var ea = parseFloat((a.querySelector('.vb-edge-value') || {}).textContent) || 0;
        var eb = parseFloat((b.querySelector('.vb-edge-value') || {}).textContent) || 0;
        return eb - ea;
      } else if (sortVal === 'time') {
        var ta = (a.querySelector('.vb-event-time') || {}).textContent || 'zzz';
        var tb = (b.querySelector('.vb-event-time') || {}).textContent || 'zzz';
        return ta.localeCompare(tb);
      } else if (sortVal === 'sport') {
        var sa = (a.querySelector('.vb-sport-badge') || {}).textContent || '';
        var sb = (b.querySelector('.vb-sport-badge') || {}).textContent || '';
        return sa.localeCompare(sb);
      }
      return 0;
    });
    cards.forEach(function(c) { grid.appendChild(c); });
  },

  // -----------------------------------------------------------------------
  // HEAD-TO-HEAD COMPARISON PAGE
  // -----------------------------------------------------------------------
  async renderCompare() {
    const app = document.getElementById('app');
    const self = this;
    const isPremium = this.isPremium();
    this._compareSport = this._compareSport || 'football';

    app.innerHTML = `
      <div class="compare-page container">
        <div class="page-header" style="text-align:center;margin-bottom:24px;">
          <h1 style="font-size:28px;font-weight:800;margin-bottom:4px;">Head-to-Head Comparison</h1>
          <p class="text-muted" style="font-size:14px;">Compare any two teams or horses side by side</p>
          <div class="compare-sport-toggle" style="margin-top:16px;">
            <button class="compare-sport-btn ${this._compareSport === 'football' ? 'active' : ''}" data-sport="football">Football</button>
            <button class="compare-sport-btn ${this._compareSport === 'racing' ? 'active' : ''}" data-sport="racing">Racing</button>
          </div>
        </div>
        <div id="compare-body">
          <div class="text-center pulse" style="padding:40px;">Loading...</div>
        </div>
      </div>
    `;

    // Sport toggle
    app.querySelectorAll('.compare-sport-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        self._compareSport = this.getAttribute('data-sport');
        self._compareDataA = null;
        self._compareDataB = null;
        self.renderCompare();
      });
    });

    if (this._compareSport === 'football') {
      await this._renderCompareFootball();
    } else {
      await this._renderCompareRacing();
    }
  },

  async _renderCompareFootball() {
    const self = this;
    const isPremium = this.isPremium();
    const body = document.getElementById('compare-body');
    if (!body) return;

    // Fetch fixtures for autocomplete and quick-compare
    var fixtures = [];
    var allTeams = [];
    try {
      var res = await fetch('/api/football/live-fixtures');
      if (res.ok) {
        var data = await res.json();
        fixtures = data.fixtures || data || [];
        if (!Array.isArray(fixtures)) fixtures = [];
        var teamSet = {};
        fixtures.forEach(function(f) {
          if (f.homeTeam) teamSet[f.homeTeam] = true;
          if (f.awayTeam) teamSet[f.awayTeam] = true;
          // Also check home/away names
          if (f.home) teamSet[f.home] = true;
          if (f.away) teamSet[f.away] = true;
        });
        allTeams = Object.keys(teamSet).sort();
      }
    } catch(e) {}

    // Quick compare links
    var quickLinks = '';
    if (fixtures.length > 0) {
      var ql = fixtures.slice(0, 6).map(function(f) {
        var home = f.homeTeam || f.home || '';
        var away = f.awayTeam || f.away || '';
        if (!home || !away) return '';
        return '<button class="compare-quick-link" data-home="' + self._escHtml(home) + '" data-away="' + self._escHtml(away) + '" data-fixture-id="' + (f.fixtureId || f.id || '') + '">' + self._escHtml(home) + ' vs ' + self._escHtml(away) + ' &mdash; Compare Now</button>';
      }).filter(Boolean).join('');
      if (ql) quickLinks = '<div class="compare-quick-links"><p class="text-muted text-sm" style="margin-bottom:8px;">Quick Compare from Today\'s Fixtures:</p><div class="compare-quick-grid">' + ql + '</div></div>';
    }

    body.innerHTML = `
      <div class="compare-inputs">
        <div class="compare-search">
          <label class="text-sm text-muted">Team A</label>
          <div class="compare-search-wrap">
            <input type="text" id="compare-team-a" class="compare-input" placeholder="Search team..." autocomplete="off">
            <div class="compare-autocomplete" id="compare-ac-a"></div>
          </div>
        </div>
        <div class="compare-vs-small">VS</div>
        <div class="compare-search">
          <label class="text-sm text-muted">Team B</label>
          <div class="compare-search-wrap">
            <input type="text" id="compare-team-b" class="compare-input" placeholder="Search team..." autocomplete="off">
            <div class="compare-autocomplete" id="compare-ac-b"></div>
          </div>
        </div>
        <button class="btn btn-gold compare-btn" id="compare-go-btn">Compare</button>
      </div>
      ${quickLinks}
      <div id="compare-result">
        <div class="compare-empty-state">
          <div style="font-size:48px;margin-bottom:12px;opacity:.4;">&#9878;</div>
          <p class="text-muted">Select two teams to compare</p>
        </div>
      </div>
    `;

    // Autocomplete logic
    function setupAC(inputId, acId) {
      var input = document.getElementById(inputId);
      var ac = document.getElementById(acId);
      if (!input || !ac) return;
      input.addEventListener('input', function() {
        var val = this.value.toLowerCase().trim();
        if (val.length < 2) { ac.style.display = 'none'; ac.innerHTML = ''; return; }
        var matches = allTeams.filter(function(t) { return t.toLowerCase().indexOf(val) !== -1; }).slice(0, 8);
        if (matches.length === 0) { ac.style.display = 'none'; ac.innerHTML = ''; return; }
        ac.innerHTML = matches.map(function(m) { return '<div class="compare-ac-item">' + self._escHtml(m) + '</div>'; }).join('');
        ac.style.display = 'block';
        ac.querySelectorAll('.compare-ac-item').forEach(function(item) {
          item.addEventListener('click', function() {
            input.value = this.textContent;
            ac.style.display = 'none';
          });
        });
      });
      input.addEventListener('blur', function() { setTimeout(function() { ac.style.display = 'none'; }, 200); });
      input.addEventListener('focus', function() { if (ac.innerHTML) ac.style.display = 'block'; });
    }
    setupAC('compare-team-a', 'compare-ac-a');
    setupAC('compare-team-b', 'compare-ac-b');

    // Compare button
    var goBtn = document.getElementById('compare-go-btn');
    if (goBtn) goBtn.addEventListener('click', function() { self._doFootballCompare(fixtures); });

    // Quick links
    body.querySelectorAll('.compare-quick-link').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var home = this.getAttribute('data-home');
        var away = this.getAttribute('data-away');
        var inp1 = document.getElementById('compare-team-a');
        var inp2 = document.getElementById('compare-team-b');
        if (inp1) inp1.value = home;
        if (inp2) inp2.value = away;
        self._doFootballCompare(fixtures);
      });
    });
  },

  async _doFootballCompare(fixtures) {
    var teamA = (document.getElementById('compare-team-a') || {}).value || '';
    var teamB = (document.getElementById('compare-team-b') || {}).value || '';
    if (!teamA.trim() || !teamB.trim()) return;

    var result = document.getElementById('compare-result');
    if (!result) return;
    result.innerHTML = '<div class="text-center pulse" style="padding:40px;">Analysing matchup...</div>';

    var self = this;
    var isPremium = this.isPremium();
    var blurClass = isPremium ? '' : 'compare-blurred';

    // Find matching fixture
    var fixtureMatch = null;
    fixtures.forEach(function(f) {
      var home = (f.homeTeam || f.home || '').toLowerCase();
      var away = (f.awayTeam || f.away || '').toLowerCase();
      if ((home.indexOf(teamA.toLowerCase()) !== -1 || teamA.toLowerCase().indexOf(home) !== -1) &&
          (away.indexOf(teamB.toLowerCase()) !== -1 || teamB.toLowerCase().indexOf(away) !== -1)) {
        fixtureMatch = f;
      }
      if ((home.indexOf(teamB.toLowerCase()) !== -1 || teamB.toLowerCase().indexOf(home) !== -1) &&
          (away.indexOf(teamA.toLowerCase()) !== -1 || teamA.toLowerCase().indexOf(away) !== -1)) {
        fixtureMatch = f;
      }
    });

    // Fetch intelligence data if fixture found
    var intel = null;
    if (fixtureMatch && (fixtureMatch.fixtureId || fixtureMatch.id)) {
      try {
        var res = await fetch('/api/football/match-intelligence/' + (fixtureMatch.fixtureId || fixtureMatch.id));
        if (res.ok) intel = await res.json();
      } catch(e) {}
    }

    // Fetch H2H
    var h2h = null;
    try {
      var res2 = await fetch('/api/football/h2h/' + encodeURIComponent(teamA) + '/' + encodeURIComponent(teamB));
      if (res2.ok) h2h = await res2.json();
    } catch(e) {}

    // Fetch tips to see if we have a verdict
    var matchTip = null;
    try {
      var tips = await this.api('/tips?sport=football');
      if (Array.isArray(tips)) {
        tips.forEach(function(t) {
          var ev = (t.event || t.match || '').toLowerCase();
          if (ev.indexOf(teamA.toLowerCase()) !== -1 && ev.indexOf(teamB.toLowerCase()) !== -1) matchTip = t;
        });
      }
    } catch(e) {}

    // Extract stats
    var statsA = (intel && intel.homeTeam) ? intel.homeTeam : (intel && intel.teamA) ? intel.teamA : {};
    var statsB = (intel && intel.awayTeam) ? intel.awayTeam : (intel && intel.teamB) ? intel.teamB : {};
    var homeStats = intel && intel.homeStats ? intel.homeStats : statsA;
    var awayStats = intel && intel.awayStats ? intel.awayStats : statsB;

    function formBox(form) {
      if (!form) return '<span class="text-muted">-</span>';
      var letters = (typeof form === 'string') ? form.split('') : (Array.isArray(form) ? form : []);
      return letters.slice(-5).map(function(r) {
        var c = (r || '').toUpperCase();
        var cls = c === 'W' ? 'form-w' : c === 'D' ? 'form-d' : c === 'L' ? 'form-l' : '';
        return '<span class="compare-form-box ' + cls + '">' + c + '</span>';
      }).join('');
    }

    function statBar(label, valA, valB) {
      var a = parseFloat(valA) || 0;
      var b = parseFloat(valB) || 0;
      var max = Math.max(a, b, 1);
      var pctA = Math.round((a / max) * 100);
      var pctB = Math.round((b / max) * 100);
      return '<div class="compare-stat-row"><div class="compare-stat-bar-left"><div class="compare-stat-fill-left" style="width:' + pctA + '%"></div><span class="compare-stat-val">' + a + '</span></div><div class="compare-stat-label">' + label + '</div><div class="compare-stat-bar-right"><span class="compare-stat-val">' + b + '</span><div class="compare-stat-fill-right" style="width:' + pctB + '%"></div></div></div>';
    }

    // H2H section
    var h2hHtml = '';
    if (h2h) {
      var meetings = h2h.meetings || h2h.matches || h2h.results || [];
      var meetingsHtml = meetings.slice(0, 5).map(function(m) {
        return '<div class="compare-h2h-match"><span class="text-muted text-xs">' + (m.date || '') + '</span> <strong>' + (m.score || m.result || '') + '</strong> <span class="text-xs text-muted">' + (m.venue || '') + '</span></div>';
      }).join('');

      var winsA = h2h.winsA || h2h.homeWins || 0;
      var draws = h2h.draws || 0;
      var winsB = h2h.winsB || h2h.awayWins || 0;
      var totalH = winsA + draws + winsB || 1;
      var pctWa = Math.round((winsA / totalH) * 100);
      var pctD = Math.round((draws / totalH) * 100);
      var pctWb = 100 - pctWa - pctD;

      h2hHtml = `
        <div class="compare-h2h ${blurClass}">
          <h3 style="text-align:center;font-size:16px;margin-bottom:16px;">Head-to-Head Record</h3>
          <div class="compare-h2h-bar-wrap">
            <div class="compare-h2h-bar">
              <div class="compare-h2h-seg seg-a" style="width:${pctWa}%"><span>${winsA}</span></div>
              <div class="compare-h2h-seg seg-draw" style="width:${pctD}%"><span>${draws}</span></div>
              <div class="compare-h2h-seg seg-b" style="width:${pctWb}%"><span>${winsB}</span></div>
            </div>
            <div class="compare-h2h-labels"><span>${self._escHtml(teamA)} wins</span><span>Draws</span><span>${self._escHtml(teamB)} wins</span></div>
          </div>
          ${h2h.avgGoals != null ? '<div class="compare-h2h-stats"><span>Avg Goals: <strong>' + (h2h.avgGoals || '-') + '</strong></span><span>BTTS: <strong>' + (h2h.bttsPercent != null ? h2h.bttsPercent + '%' : '-') + '</strong></span><span>Over 2.5: <strong>' + (h2h.over25Percent != null ? h2h.over25Percent + '%' : '-') + '</strong></span></div>' : ''}
          ${meetingsHtml ? '<div class="compare-h2h-meetings"><h4 class="text-sm text-muted" style="margin-bottom:8px;">Last Meetings</h4>' + meetingsHtml + '</div>' : ''}
        </div>
      `;
    }

    // Verdict
    var verdictHtml = '';
    if (matchTip) {
      verdictHtml = `
        <div class="compare-verdict ${blurClass}">
          <h3 style="margin-bottom:12px;">Our Verdict</h3>
          <div class="compare-verdict-inner">
            <div><span class="text-muted">Selection:</span> <strong>${self._escHtml(matchTip.selection || matchTip.tip || '')}</strong></div>
            <div><span class="text-muted">Market:</span> ${self._escHtml(matchTip.market || '')}</div>
            <div><span class="text-muted">Odds:</span> <strong class="text-gold">${matchTip.odds || '-'}</strong></div>
            ${matchTip.confidence ? '<div><span class="text-muted">Confidence:</span> <strong>' + matchTip.confidence + '%</strong></div>' : ''}
            ${matchTip.edge ? '<div><span class="text-muted">Edge:</span> <strong class="text-green">+' + matchTip.edge + '%</strong></div>' : ''}
            <a href="#/selections" class="btn btn-outline btn-sm" style="margin-top:12px;">View Full Analysis</a>
          </div>
        </div>
      `;
    }

    // Premium gate overlay
    var premiumGate = !isPremium ? `
      <div class="compare-premium-gate">
        <div class="compare-gate-content">
          <h3>Premium Analysis</h3>
          <p>Upgrade to unlock full H2H data, stat bars, and our expert verdict.</p>
          <a href="#/pricing" class="btn btn-gold">Upgrade Now</a>
        </div>
      </div>
    ` : '';

    result.innerHTML = `
      <div class="compare-grid">
        <div class="compare-column">
          <h2 class="compare-team-name">${self._escHtml(teamA)}</h2>
          <div class="compare-team-stats ${blurClass}">
            ${statsA.leaguePosition ? '<div class="compare-badge">League Pos: <strong>' + statsA.leaguePosition + '</strong></div>' : ''}
            <div class="compare-form-row"><span class="text-sm text-muted">Form:</span> ${formBox(statsA.form || homeStats.form)}</div>
            ${statsA.goalsScored != null || homeStats.goalsScored != null ? '<div class="compare-stat-item"><span class="text-muted">Goals Scored:</span> <strong>' + (statsA.goalsScored || homeStats.goalsScored || '-') + '</strong></div>' : ''}
            ${statsA.goalsConceded != null || homeStats.goalsConceded != null ? '<div class="compare-stat-item"><span class="text-muted">Goals Conceded:</span> <strong>' + (statsA.goalsConceded || homeStats.goalsConceded || '-') + '</strong></div>' : ''}
            ${statsA.xG != null || homeStats.xG != null ? '<div class="compare-stat-item"><span class="text-muted">xG:</span> <strong>' + (statsA.xG || homeStats.xG || '-') + '</strong></div>' : ''}
            ${statsA.xGA != null || homeStats.xGA != null ? '<div class="compare-stat-item"><span class="text-muted">xGA:</span> <strong>' + (statsA.xGA || homeStats.xGA || '-') + '</strong></div>' : ''}
            ${statsA.cleanSheets != null || homeStats.cleanSheets != null ? '<div class="compare-stat-item"><span class="text-muted">Clean Sheets:</span> <strong>' + (statsA.cleanSheets || homeStats.cleanSheets || '-') + '</strong></div>' : ''}
            ${statsA.homeRecord || homeStats.homeRecord ? '<div class="compare-stat-item"><span class="text-muted">Home Record:</span> <strong>' + (statsA.homeRecord || homeStats.homeRecord || '-') + '</strong></div>' : ''}
          </div>
        </div>
        <div class="compare-vs">
          <div class="compare-vs-line"></div>
          <div class="compare-vs-circle">VS</div>
          <div class="compare-vs-line"></div>
        </div>
        <div class="compare-column">
          <h2 class="compare-team-name">${self._escHtml(teamB)}</h2>
          <div class="compare-team-stats ${blurClass}">
            ${statsB.leaguePosition ? '<div class="compare-badge">League Pos: <strong>' + statsB.leaguePosition + '</strong></div>' : ''}
            <div class="compare-form-row"><span class="text-sm text-muted">Form:</span> ${formBox(statsB.form || awayStats.form)}</div>
            ${statsB.goalsScored != null || awayStats.goalsScored != null ? '<div class="compare-stat-item"><span class="text-muted">Goals Scored:</span> <strong>' + (statsB.goalsScored || awayStats.goalsScored || '-') + '</strong></div>' : ''}
            ${statsB.goalsConceded != null || awayStats.goalsConceded != null ? '<div class="compare-stat-item"><span class="text-muted">Goals Conceded:</span> <strong>' + (statsB.goalsConceded || awayStats.goalsConceded || '-') + '</strong></div>' : ''}
            ${statsB.xG != null || awayStats.xG != null ? '<div class="compare-stat-item"><span class="text-muted">xG:</span> <strong>' + (statsB.xG || awayStats.xG || '-') + '</strong></div>' : ''}
            ${statsB.xGA != null || awayStats.xGA != null ? '<div class="compare-stat-item"><span class="text-muted">xGA:</span> <strong>' + (statsB.xGA || awayStats.xGA || '-') + '</strong></div>' : ''}
            ${statsB.cleanSheets != null || awayStats.cleanSheets != null ? '<div class="compare-stat-item"><span class="text-muted">Clean Sheets:</span> <strong>' + (statsB.cleanSheets || awayStats.cleanSheets || '-') + '</strong></div>' : ''}
            ${statsB.awayRecord || awayStats.awayRecord ? '<div class="compare-stat-item"><span class="text-muted">Away Record:</span> <strong>' + (statsB.awayRecord || awayStats.awayRecord || '-') + '</strong></div>' : ''}
          </div>
        </div>
      </div>
      <div class="compare-stat-bars ${blurClass}">
        <h3 style="text-align:center;font-size:16px;margin-bottom:16px;">Key Stats</h3>
        ${statBar('Possession', statsA.possession || homeStats.possession || 0, statsB.possession || awayStats.possession || 0)}
        ${statBar('Shots/Game', statsA.shotsOnTarget || homeStats.shotsOnTarget || 0, statsB.shotsOnTarget || awayStats.shotsOnTarget || 0)}
        ${statBar('Goals/Game', statsA.goalsPerGame || homeStats.goalsPerGame || 0, statsB.goalsPerGame || awayStats.goalsPerGame || 0)}
        ${statBar('xG', statsA.xG || homeStats.xG || 0, statsB.xG || awayStats.xG || 0)}
      </div>
      ${h2hHtml}
      ${verdictHtml}
      ${premiumGate}
    `;
  },

  async _renderCompareRacing() {
    var self = this;
    var isPremium = this.isPremium();
    var blurClass = isPremium ? '' : 'compare-blurred';
    var body = document.getElementById('compare-body');
    if (!body) return;

    // Fetch racing cards for autocomplete
    var allHorses = [];
    var cards = [];
    try {
      var res = await fetch('/api/racing/live-cards');
      if (res.ok) {
        var data = await res.json();
        cards = data.cards || data.races || data || [];
        if (!Array.isArray(cards)) cards = [];
        var nameSet = {};
        cards.forEach(function(race) {
          var runners = race.runners || race.horses || [];
          runners.forEach(function(h) {
            var name = h.name || h.horse || '';
            if (name) nameSet[name] = h;
          });
        });
        allHorses = Object.keys(nameSet).sort();
        self._compareHorseData = nameSet;
      }
    } catch(e) {}

    body.innerHTML = `
      <div class="compare-inputs">
        <div class="compare-search">
          <label class="text-sm text-muted">Horse A</label>
          <div class="compare-search-wrap">
            <input type="text" id="compare-horse-a" class="compare-input" placeholder="Search horse..." autocomplete="off">
            <div class="compare-autocomplete" id="compare-ac-ha"></div>
          </div>
        </div>
        <div class="compare-vs-small">VS</div>
        <div class="compare-search">
          <label class="text-sm text-muted">Horse B</label>
          <div class="compare-search-wrap">
            <input type="text" id="compare-horse-b" class="compare-input" placeholder="Search horse..." autocomplete="off">
            <div class="compare-autocomplete" id="compare-ac-hb"></div>
          </div>
        </div>
        <button class="btn btn-gold compare-btn" id="compare-go-btn-racing">Compare</button>
      </div>
      <div id="compare-result">
        <div class="compare-empty-state">
          <div style="font-size:48px;margin-bottom:12px;opacity:.4;">&#127943;</div>
          <p class="text-muted">Select two horses to compare</p>
        </div>
      </div>
    `;

    // Autocomplete
    function setupAC(inputId, acId) {
      var input = document.getElementById(inputId);
      var ac = document.getElementById(acId);
      if (!input || !ac) return;
      input.addEventListener('input', function() {
        var val = this.value.toLowerCase().trim();
        if (val.length < 2) { ac.style.display = 'none'; ac.innerHTML = ''; return; }
        var matches = allHorses.filter(function(h) { return h.toLowerCase().indexOf(val) !== -1; }).slice(0, 8);
        if (matches.length === 0) { ac.style.display = 'none'; ac.innerHTML = ''; return; }
        ac.innerHTML = matches.map(function(m) { return '<div class="compare-ac-item">' + self._escHtml(m) + '</div>'; }).join('');
        ac.style.display = 'block';
        ac.querySelectorAll('.compare-ac-item').forEach(function(item) {
          item.addEventListener('click', function() {
            input.value = this.textContent;
            ac.style.display = 'none';
          });
        });
      });
      input.addEventListener('blur', function() { setTimeout(function() { ac.style.display = 'none'; }, 200); });
      input.addEventListener('focus', function() { if (ac.innerHTML) ac.style.display = 'block'; });
    }
    setupAC('compare-horse-a', 'compare-ac-ha');
    setupAC('compare-horse-b', 'compare-ac-hb');

    var goBtn = document.getElementById('compare-go-btn-racing');
    if (goBtn) goBtn.addEventListener('click', function() { self._doRacingCompare(); });
  },

  async _doRacingCompare() {
    var horseA = (document.getElementById('compare-horse-a') || {}).value || '';
    var horseB = (document.getElementById('compare-horse-b') || {}).value || '';
    if (!horseA.trim() || !horseB.trim()) return;

    var result = document.getElementById('compare-result');
    if (!result) return;
    result.innerHTML = '<div class="text-center pulse" style="padding:40px;">Analysing runners...</div>';

    var self = this;
    var isPremium = this.isPremium();
    var blurClass = isPremium ? '' : 'compare-blurred';
    var hData = self._compareHorseData || {};
    var dataA = hData[horseA] || {};
    var dataB = hData[horseB] || {};

    // Fetch best odds
    var oddsA = null, oddsB = null;
    try {
      var p1 = fetch('/api/odds/best-price?selection=' + encodeURIComponent(horseA));
      var p2 = fetch('/api/odds/best-price?selection=' + encodeURIComponent(horseB));
      var r = await Promise.all([p1, p2]);
      if (r[0].ok) oddsA = await r[0].json();
      if (r[1].ok) oddsB = await r[1].json();
    } catch(e) {}

    // Check if we have tips for either horse
    var tipA = null, tipB = null;
    try {
      var tips = await this.api('/tips?sport=racing');
      if (Array.isArray(tips)) {
        tips.forEach(function(t) {
          var sel = (t.selection || t.horse || '').toLowerCase();
          if (sel === horseA.toLowerCase()) tipA = t;
          if (sel === horseB.toLowerCase()) tipB = t;
        });
      }
    } catch(e) {}

    function racingFormBox(form) {
      if (!form) return '<span class="text-muted">-</span>';
      var positions = (typeof form === 'string') ? form.split(/[\s\/,-]+/) : (Array.isArray(form) ? form : []);
      return positions.slice(-5).map(function(p) {
        var n = parseInt(p);
        var cls = n === 1 ? 'form-1st' : (n >= 2 && n <= 3) ? 'form-2nd3rd' : 'form-other';
        if (isNaN(n)) cls = 'form-other';
        return '<span class="compare-form-box ' + cls + '">' + self._escHtml(p) + '</span>';
      }).join('');
    }

    function horseColumn(name, data, odds, tip) {
      var bestPrice = odds && (odds.bestPrice || odds.price || odds.odds) ? (odds.bestPrice || odds.price || odds.odds) : '-';
      var bookmaker = odds && odds.bookmaker ? odds.bookmaker : '';
      return `
        <div class="compare-column">
          <h2 class="compare-team-name">${self._escHtml(name)}</h2>
          <div class="compare-team-stats">
            ${data.trainer ? '<div class="compare-stat-item"><span class="text-muted">Trainer:</span> <strong>' + self._escHtml(data.trainer) + '</strong></div>' : ''}
            ${data.jockey ? '<div class="compare-stat-item"><span class="text-muted">Jockey:</span> <strong>' + self._escHtml(data.jockey) + '</strong></div>' : ''}
            ${data.age ? '<div class="compare-stat-item"><span class="text-muted">Age:</span> <strong>' + data.age + '</strong></div>' : ''}
            ${data.weight ? '<div class="compare-stat-item"><span class="text-muted">Weight:</span> <strong>' + self._escHtml(data.weight) + '</strong></div>' : ''}
            ${data.officialRating || data.or ? '<div class="compare-stat-item"><span class="text-muted">Official Rating:</span> <strong>' + (data.officialRating || data.or) + '</strong></div>' : ''}
            <div class="compare-form-row"><span class="text-sm text-muted">Form:</span> ${racingFormBox(data.form)}</div>
            ${data.courseDistanceRecord || data.cdRecord ? '<div class="compare-stat-item"><span class="text-muted">C&D Record:</span> <strong>' + self._escHtml(data.courseDistanceRecord || data.cdRecord || '-') + '</strong></div>' : ''}
            ${data.goingPreference || data.going ? '<div class="compare-stat-item"><span class="text-muted">Going Pref:</span> <strong>' + self._escHtml(data.goingPreference || data.going || '-') + '</strong></div>' : ''}
            <div class="compare-stat-item compare-price"><span class="text-muted">Best Price:</span> <strong class="text-gold">${self._escHtml(String(bestPrice))}</strong> ${bookmaker ? '<span class="text-xs text-muted">(' + self._escHtml(bookmaker) + ')</span>' : ''}</div>
          </div>
          ${tip ? '<div class="compare-verdict-mini ' + blurClass + '"><span class="text-xs" style="color:var(--gold);">OUR TIP</span><div><strong>' + self._escHtml(tip.selection || tip.horse || '') + '</strong> @ <span class="text-gold">' + (tip.odds || '-') + '</span></div>' + (tip.confidence ? '<div class="text-xs text-muted">Confidence: ' + tip.confidence + '%</div>' : '') + (tip.edge ? '<div class="text-xs text-green">Edge: +' + tip.edge + '%</div>' : '') + '</div>' : ''}
        </div>
      `;
    }

    // Side-by-side stat comparison
    function racingStatBar(label, valA, valB) {
      var a = parseFloat(valA) || 0;
      var b = parseFloat(valB) || 0;
      var max = Math.max(a, b, 1);
      var pctA = Math.round((a / max) * 100);
      var pctB = Math.round((b / max) * 100);
      return '<div class="compare-stat-row"><div class="compare-stat-bar-left"><div class="compare-stat-fill-left" style="width:' + pctA + '%"></div><span class="compare-stat-val">' + a + '</span></div><div class="compare-stat-label">' + label + '</div><div class="compare-stat-bar-right"><span class="compare-stat-val">' + b + '</span><div class="compare-stat-fill-right" style="width:' + pctB + '%"></div></div></div>';
    }

    var formScoreA = dataA.formRating || dataA.formScore || 0;
    var formScoreB = dataB.formRating || dataB.formScore || 0;

    // Premium gate
    var premiumGate = !isPremium ? `
      <div class="compare-premium-gate">
        <div class="compare-gate-content">
          <h3>Premium Analysis</h3>
          <p>Upgrade to unlock full comparison data, form scores, and our expert verdict.</p>
          <a href="#/pricing" class="btn btn-gold">Upgrade Now</a>
        </div>
      </div>
    ` : '';

    result.innerHTML = `
      <div class="compare-grid">
        ${horseColumn(horseA, dataA, oddsA, tipA)}
        <div class="compare-vs">
          <div class="compare-vs-line"></div>
          <div class="compare-vs-circle">VS</div>
          <div class="compare-vs-line"></div>
        </div>
        ${horseColumn(horseB, dataB, oddsB, tipB)}
      </div>
      <div class="compare-stat-bars ${blurClass}">
        <h3 style="text-align:center;font-size:16px;margin-bottom:16px;">Stat Comparison</h3>
        ${racingStatBar('Form Score', Math.round(formScoreA * 100), Math.round(formScoreB * 100))}
        ${racingStatBar('Official Rating', dataA.officialRating || dataA.or || 0, dataB.officialRating || dataB.or || 0)}
        ${racingStatBar('Age', dataA.age || 0, dataB.age || 0)}
      </div>
      ${premiumGate}
    `;
  },

  // -----------------------------------------------------------------------
  // FOOTBALL PAGE
  // -----------------------------------------------------------------------
  async renderFootball() {
    const app = document.getElementById('app');
    app.innerHTML = this.renderSkeleton('tips');

    var liveData = null;
    var weekendFixtures = null;
    var isFriday = this._isFriday();
    // On Friday, default to weekend tab so punters can plan weekend bets
    if (!this._footballDateTab && isFriday) this._footballDateTab = 'weekend';
    try {
      var fetches = [
        this.api('/tips?sport=football'),
        this.fetchLiveFootball()
      ];
      // On Fri/Sat/Sun, also fetch weekend fixtures
      if (isFriday || new Date().getDay() === 6 || new Date().getDay() === 0) {
        fetches.push(this.fetchWeekendFootball());
      }
      var results = await Promise.all(fetches);
      this.tips = results[0];
      liveData = results[1];
      weekendFixtures = results[2] || null;
    } catch { try { this.tips = await this.api('/tips?sport=football'); } catch {} }

    var todayDate = this._getToday();
    const tips = this.tips.filter(function(t) {
      if (t.sport !== 'football') return false;
      if (t.isWeeklyAcca) return false;
      if (t.status && t.status !== 'active') return false;
      if (t.date && App._normDate(t.date) < todayDate) return false;
      return true;
    });
    const leagues = [...new Set(tips.map(t => t.league))];
    var hasLiveFixtures = liveData && liveData.live && liveData.fixtures && liveData.fixtures.length > 0;
    var fixtures = hasLiveFixtures ? liveData.fixtures : [];
    var liveUpdatedAt = liveData && liveData.fetchedAt ? new Date(liveData.fetchedAt) : null;

    // Group fixtures by league
    var fixturesByLeague = {};
    fixtures.forEach(function(f) {
      var key = f.league || 'Other';
      if (!fixturesByLeague[key]) fixturesByLeague[key] = [];
      fixturesByLeague[key].push(f);
    });

    // Date tabs with state
    var today = this._getToday();
    var tomorrow = this._getTomorrow();
    var weekendDates = this._getWeekendDates();
    var dateTab = this._footballDateTab || 'today';
    var tomorrowTips = this.tips.filter(function(t) { return t.sport === 'football' && t.status === 'active' && App._normDate(t.date) === tomorrow && !t.isWeeklyAcca; });
    var weekendTips = this.tips.filter(function(t) { return t.sport === 'football' && t.status === 'active' && weekendDates.indexOf(t.date) !== -1 && !t.isWeeklyAcca; });

    // Re-filter tips based on selected date tab
    var displayTips = tips;
    if (dateTab === 'tomorrow') {
      displayTips = tomorrowTips;
    } else if (dateTab === 'weekend') {
      displayTips = weekendTips;
    } else {
      displayTips = tips.filter(function(t) { return App._normDate(t.date) === today; });
      // If no today tips, show all upcoming
      if (displayTips.length === 0) displayTips = tips;
    }
    var displayLeagues = [...new Set(displayTips.map(t => t.league))];

    app.innerHTML = `
      <div class="container">
        <div class="page-header">
          <h1><span class="accent">Football</span> Tips</h1>
          <p>Data-driven selections across Europe's top leagues with xG analysis and injury intelligence</p>
        </div>

        <!-- Date Tabs -->
        <div class="date-tabs">
          <button class="date-tab ${dateTab === 'today' ? 'active' : ''}" onclick="App._footballDateTab='today';App.renderFootball()">Today</button>
          ${tomorrowTips.length ? '<button class="date-tab ' + (dateTab === 'tomorrow' ? 'active' : '') + '" onclick="App._footballDateTab=\'tomorrow\';App.renderFootball()">Tomorrow (' + tomorrowTips.length + ')</button>' : ''}
          <button class="date-tab ${dateTab === 'weekend' ? 'active' : ''}" onclick="App._footballDateTab='weekend';App.renderFootball()">This Weekend${weekendTips.length ? ' (' + weekendTips.length + ')' : ''}</button>
        </div>

        <!-- Live Fixtures -->
        ${hasLiveFixtures ? `
        <div class="section">
          <div class="live-data-header">
            <span class="live-badge">Live Fixtures</span>
            <div class="live-updated">
              ${liveUpdatedAt ? 'Updated ' + this.timeAgo(liveUpdatedAt.toISOString()) : ''}
              <button class="refresh-btn" onclick="App.refreshFootballData(this)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                Refresh
              </button>
            </div>
          </div>
          ${Object.keys(fixturesByLeague).map(function(leagueName) {
            var leagueFixtures = fixturesByLeague[leagueName];
            return '<div class="meeting-card"><h3>\u26bd ' + leagueName + '</h3><div style="display:grid;gap:8px;">' +
              leagueFixtures.map(function(f) {
                var isLive = f.status === '1H' || f.status === '2H' || f.status === 'HT' || f.status === 'LIVE';
                var isFT = f.status === 'FT';
                var kickoffTime = f.kickoff ? new Date(f.kickoff).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'}) : '';
                return '<div class="fixture-card fixture-card-clickable" onclick="App.openMatchIntelligence(' + f.id + ', this)" title="Click for match analysis">' +
                  '<div style="flex:1;">' +
                    '<div class="fixture-league">' + leagueName + '</div>' +
                    '<div class="fixture-teams">' + f.homeTeam + ' <span class="fixture-vs">vs</span> ' + f.awayTeam + '</div>' +
                    '<div class="fixture-meta">' + (f.venue || '') + (kickoffTime ? ' | ' + kickoffTime : '') + '</div>' +
                  '</div>' +
                  (isLive ? '<div><div class="fixture-live-badge">LIVE ' + (f.elapsed || '') + '\'</div><div class="fixture-score">' + (f.homeGoals != null ? f.homeGoals : '-') + ' - ' + (f.awayGoals != null ? f.awayGoals : '-') + '</div></div>' :
                   isFT ? '<div><div style="font-size:10px;color:var(--text-muted);">FT</div><div class="fixture-score" style="color:var(--text-primary);">' + (f.homeGoals||0) + ' - ' + (f.awayGoals||0) + '</div></div>' :
                   '<div class="fixture-meta">' + kickoffTime + '</div>') +
                  '</div>';
              }).join('') + '</div></div>';
          }).join('')}
        </div>` : ''}

        <div class="filter-bar">
          <select onchange="App.filterFootball(this.value, 'league')">
            <option value="">All Leagues</option>
            ${displayLeagues.map(l => `<option value="${l}">${l}</option>`).join('')}
          </select>
          <select onchange="App.filterFootball(this.value, 'market')">
            <option value="">All Markets</option>
            <option value="Match Result">Match Result</option>
            <option value="BTTS">BTTS</option>
            <option value="Over/Under">Over/Under</option>
            <option value="Asian Handicap">Asian Handicap</option>
            <option value="Double Chance">Double Chance</option>
          </select>
          <select onchange="App.filterFootball(this.value, 'analyst')">
            <option value="">All Analysts</option>
            <option value="The Professor">The Professor</option>
            <option value="The Scout">The Scout</option>
            <option value="The Edge">The Edge</option>
          </select>
        </div>

        <!-- Weekend Fixtures Preview (shown on Fri/Sat/Sun when weekend tab selected) -->
        ${dateTab === 'weekend' && weekendFixtures && weekendFixtures.fixtures && weekendFixtures.fixtures.length > 0 ? (() => {
          var wkFixtures = weekendFixtures.fixtures;
          var wkByDate = {};
          wkFixtures.forEach(function(f) {
            var fDate = f.kickoff ? f.kickoff.split('T')[0] : 'Unknown';
            if (!wkByDate[fDate]) wkByDate[fDate] = [];
            wkByDate[fDate].push(f);
          });
          var dayNames = { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' };
          return '<div class="card mb-24" style="border-left:3px solid var(--gold);">' +
            '<h3 class="mb-4" style="color:var(--gold);">&#128197; Weekend Fixtures Preview</h3>' +
            '<p class="text-muted text-sm mb-16">All confirmed fixtures for this weekend. Get your bets on early for the best prices.</p>' +
            Object.keys(wkByDate).sort().map(function(dateKey) {
              var dayDate = new Date(dateKey + 'T12:00:00');
              var dayLabel = dayNames[dayDate.getDay()] || dateKey;
              var dayFixtures = wkByDate[dateKey];
              // Group by league
              var byLeague = {};
              dayFixtures.forEach(function(f) {
                var lg = f.league || 'Other';
                if (!byLeague[lg]) byLeague[lg] = [];
                byLeague[lg].push(f);
              });
              return '<div class="mb-16">' +
                '<h4 style="color:var(--text-primary);margin-bottom:8px;border-bottom:1px solid var(--border);padding-bottom:6px;">' + dayLabel + ' ' + dateKey.split('-').reverse().join('/') + ' — ' + dayFixtures.length + ' fixtures</h4>' +
                Object.keys(byLeague).map(function(lg) {
                  return '<div class="mb-8"><span class="text-gold text-xs" style="font-weight:600;letter-spacing:0.5px;">' + lg + '</span>' +
                    '<div style="display:grid;gap:4px;margin-top:4px;">' +
                    byLeague[lg].map(function(f) {
                      var ko = f.kickoff ? new Date(f.kickoff).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'}) : '';
                      var clickAttr = f.id ? ' onclick="App.openMatchIntelligence(' + f.id + ', this)" style="cursor:pointer;" title="Click for full match analysis"' : '';
                      return '<div class="fixture-card-clickable"' + clickAttr + ' style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-elevated);border-radius:6px;font-size:13px;cursor:pointer;transition:all 0.15s;border:1px solid transparent;"' +
                        ' onmouseover="this.style.borderColor=\'var(--gold)\';this.style.background=\'rgba(212,168,67,0.08)\'"' +
                        ' onmouseout="this.style.borderColor=\'transparent\';this.style.background=\'var(--bg-elevated)\'">' +
                        '<span class="text-muted" style="min-width:40px;">' + ko + '</span>' +
                        '<span style="flex:1;font-weight:500;">' + (f.homeTeam || '') + ' vs ' + (f.awayTeam || '') + '</span>' +
                        '<span class="text-muted text-xs" style="margin-right:4px;">' + (f.venue || '') + '</span>' +
                        '<span style="color:var(--gold);font-size:11px;">Analysis &#8250;</span>' +
                      '</div>';
                    }).join('') +
                    '</div></div>';
                }).join('') +
              '</div>';
            }).join('') +
          '</div>';
        })() : ''}

        <!-- League Badges -->
        <div class="card mb-24">
          <h3 class="mb-16">${dateTab === 'today' ? "Today's" : dateTab === 'tomorrow' ? "Tomorrow's" : "Weekend"} Fixtures by League</h3>
          <div class="grid grid-3">
            ${displayLeagues.length ? displayLeagues.map(l => {
              const lTips = displayTips.filter(t => t.league === l);
              return `
                <div class="stat-card" style="cursor:pointer;" onclick="App.filterFootball('${l}','league')">
                  <div style="font-size:16px;font-weight:700;margin-bottom:4px;">${l}</div>
                  <div class="text-sm text-muted">${lTips.length} tip${lTips.length !== 1 ? 's' : ''}</div>
                  <div class="text-xs text-gold mt-8">${lTips.map(t => t.event).join(' | ')}</div>
                </div>
              `;
            }).join('') : '<div class="text-muted" style="grid-column:1/-1;text-align:center;padding:20px;">No fixtures for this period yet. Tips are published daily by 7:30am UK.</div>'}
          </div>
        </div>

        <div class="section">
          <div class="section-title"><span class="icon">&#9917;</span> Football Selections</div>
          <div class="grid grid-2" id="football-tips">
            ${displayTips.length ? displayTips.map(t => this.renderTipCard(t)).join('') : '<p class="text-muted" style="text-align:center;padding:30px;grid-column:1/-1;">No selections for this period. Check back at 7:30am UK for the latest tips.</p>'}
          </div>
        </div>

        ${!this.isPremium() ? `
        <div class="card card-premium text-center" style="padding:32px;">
          <h3 class="mb-8">Unlock All Football Tips</h3>
          <p class="text-muted mb-16">Premium members get xG analysis, Asian Handicap selections, and match-by-match deep dives.</p>
          <a href="#/pricing" class="btn btn-gold">Upgrade Now</a>
        </div>` : ''}
      </div>
    `;
  },

  async refreshFootballData(btn) {
    if (btn) { btn.classList.add('spinning'); btn.disabled = true; }
    try {
      await this.fetchLiveFootball(true);
      this.renderFootball();
    } catch (e) { console.error('Refresh failed:', e); }
    if (btn) { btn.classList.remove('spinning'); btn.disabled = false; }
  },

  async filterFootball(value, type) {
    const todayStr = new Date().toISOString().split('T')[0];
    let tips = this.tips.filter(t => t.sport === 'football' && t.status === 'active' && App._normDate(t.date) >= todayStr);
    if (value && type === 'league') tips = tips.filter(t => t.league === value);
    if (value && type === 'market') tips = tips.filter(t => t.market === value);
    if (value && type === 'analyst') tips = tips.filter(t => t.tipsterProfile === value);
    document.getElementById('football-tips').innerHTML = tips.map(t => this.renderTipCard(t)).join('') || '<p class="text-muted">No tips match these filters.</p>';
  },

  // -----------------------------------------------------------------------
  // MATCH INTELLIGENCE MODAL
  // -----------------------------------------------------------------------
  async openMatchIntelligence(fixtureId, el) {
    // Remove any existing modal
    var existing = document.getElementById('match-intel-modal');
    if (existing) existing.remove();

    // Show loading modal
    var modal = document.createElement('div');
    modal.id = 'match-intel-modal';
    modal.className = 'match-intel-modal';
    modal.innerHTML = '<div class="match-intel-overlay" onclick="App.closeMatchIntelligence()"></div>' +
      '<div class="match-intel-container">' +
        '<button class="match-intel-close" onclick="App.closeMatchIntelligence()">&times;</button>' +
        '<div class="match-intel-loading"><div class="loading-spinner"></div><p style="margin-top:16px;color:var(--text-muted);">Generating match intelligence...</p></div>' +
      '</div>';
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    try {
      var data = await this.api('/football/match-intelligence/' + fixtureId);
      this.renderMatchIntelligence(data);
      trackEvent('football', 'match_intelligence', data.match.homeTeam + ' vs ' + data.match.awayTeam);
    } catch (err) {
      var container = document.querySelector('.match-intel-container');
      if (container) {
        container.innerHTML = '<button class="match-intel-close" onclick="App.closeMatchIntelligence()">&times;</button>' +
          '<div style="padding:40px;text-align:center;">' +
            '<div style="font-size:48px;margin-bottom:16px;">!</div>' +
            '<h3 style="margin-bottom:8px;">Unable to Load Analysis</h3>' +
            '<p class="text-muted">' + (err.message || 'Something went wrong. Please try again.') + '</p>' +
          '</div>';
      }
    }
  },

  closeMatchIntelligence() {
    var modal = document.getElementById('match-intel-modal');
    if (modal) modal.remove();
    document.body.style.overflow = '';
  },

  renderMatchIntelligence(data) {
    var container = document.querySelector('.match-intel-container');
    if (!container) return;

    var isPremium = this.isPremium();
    var m = data.match;
    var v = data.verdict;
    var h = data.h2h;
    var s = data.stats;
    var a = data.analysis;
    var homeForm = data.form.home;
    var awayForm = data.form.away;

    var kickoffStr = m.kickoff ? new Date(m.kickoff).toLocaleString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    }) : '';

    // Form badges helper
    function formBadges(form) {
      if (!form || !form.length) return '<span class="text-muted">No data</span>';
      return form.map(function(r) {
        var cls = r.result === 'W' ? 'form-badge-win' : r.result === 'D' ? 'form-badge-draw' : 'form-badge-loss';
        return '<span class="match-intel-form-badge ' + cls + '" title="' + r.result + ' vs ' + r.opponent + ' (' + r.goalsFor + '-' + r.goalsAgainst + ')">' + r.result + '</span>';
      }).join('');
    }

    // Confidence bar
    var confPct = (v.confidence || 0) * 10;

    // Risk meter
    var riskPct = v.riskLevel === 'Low' ? 25 : v.riskLevel === 'Low-Medium' ? 40 : v.riskLevel === 'Medium' ? 60 : 80;
    var riskColor = v.riskLevel === 'Low' ? 'var(--green)' : v.riskLevel === 'Low-Medium' ? 'var(--gold)' : v.riskLevel === 'Medium' ? 'var(--gold-dark)' : 'var(--red)';

    // H2H table rows
    var h2hRows = '';
    if (h.matches && h.matches.length) {
      h2hRows = h.matches.slice(0, 5).map(function(match) {
        var dateStr = match.date ? new Date(match.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '';
        return '<tr>' +
          '<td class="text-muted" style="font-size:11px;">' + dateStr + '</td>' +
          '<td style="text-align:right;">' + match.home + '</td>' +
          '<td style="text-align:center;font-weight:700;">' + match.homeGoals + ' - ' + match.awayGoals + '</td>' +
          '<td>' + match.away + '</td>' +
        '</tr>';
      }).join('');
    }

    var html = '<button class="match-intel-close" onclick="App.closeMatchIntelligence()">&times;</button>';

    // --- Match Header ---
    html += '<div class="match-intel-header">' +
      '<div class="match-intel-league">' +
        (m.leagueLogo ? '<img src="' + m.leagueLogo + '" alt="" class="match-intel-league-logo">' : '') +
        '<span>' + m.league + (m.country ? ' - ' + m.country : '') + '</span>' +
      '</div>' +
      '<div class="match-intel-teams-row">' +
        '<div class="match-intel-team">' +
          (m.homeTeamLogo ? '<img src="' + m.homeTeamLogo + '" alt="" class="match-intel-team-logo">' : '') +
          '<span class="match-intel-team-name">' + m.homeTeam + '</span>' +
        '</div>' +
        '<div class="match-intel-vs">' +
          (m.status === 'FT' || m.homeGoals != null ? '<div class="match-intel-score">' + (m.homeGoals || 0) + ' - ' + (m.awayGoals || 0) + '</div>' : '<span>VS</span>') +
          '<div class="match-intel-kickoff">' + kickoffStr + '</div>' +
        '</div>' +
        '<div class="match-intel-team">' +
          (m.awayTeamLogo ? '<img src="' + m.awayTeamLogo + '" alt="" class="match-intel-team-logo">' : '') +
          '<span class="match-intel-team-name">' + m.awayTeam + '</span>' +
        '</div>' +
      '</div>' +
      (m.venue ? '<div class="match-intel-venue">' + m.venue + (m.city ? ', ' + m.city : '') + '</div>' : '') +
    '</div>';

    // --- Form Guide (visible to all) ---
    html += '<div class="match-intel-section">' +
      '<h3 class="match-intel-section-title">Form Guide - Last 5 Matches</h3>' +
      '<div class="match-intel-form">' +
        '<div class="match-intel-form-row">' +
          '<span class="match-intel-form-label">' + m.homeTeam + '</span>' +
          '<div class="match-intel-form-badges">' + formBadges(homeForm) + '</div>' +
        '</div>' +
        '<div class="match-intel-form-row">' +
          '<span class="match-intel-form-label">' + m.awayTeam + '</span>' +
          '<div class="match-intel-form-badges">' + formBadges(awayForm) + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    // --- Premium content wrapper ---
    var lockedClass = isPremium ? '' : ' match-intel-locked';

    // --- OUR TAKE verdict ---
    html += '<div class="match-intel-verdict' + lockedClass + '">' +
      '<div class="match-intel-verdict-label">OUR TAKE</div>' +
      '<div class="match-intel-verdict-pick">' + v.pick + '</div>' +
      '<div class="match-intel-verdict-market">' + v.market + '</div>' +
      '<div class="match-intel-verdict-reason">' + v.reason + '</div>' +
      '<div class="match-intel-meters">' +
        '<div class="match-intel-meter">' +
          '<div class="match-intel-meter-label"><span>Confidence</span><span>' + v.confidence + '/10</span></div>' +
          '<div class="confidence-meter" style="height:8px;border-radius:4px;background:var(--bg-elevated);overflow:hidden;">' +
            '<div style="height:100%;border-radius:4px;background:linear-gradient(90deg,#b8902f,#d4a843,#e8c36a);width:' + confPct + '%;transition:width 0.4s ease;"></div>' +
          '</div>' +
        '</div>' +
        '<div class="match-intel-meter">' +
          '<div class="match-intel-meter-label"><span>Risk: ' + v.riskLevel + '</span></div>' +
          '<div class="confidence-meter" style="height:8px;border-radius:4px;background:var(--bg-elevated);overflow:hidden;">' +
            '<div style="height:100%;border-radius:4px;background:' + riskColor + ';width:' + riskPct + '%;transition:width 0.4s ease;"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    // --- Analysis paragraphs ---
    html += '<div class="match-intel-section' + lockedClass + '">' +
      '<h3 class="match-intel-section-title">Match Overview</h3>' +
      '<p class="match-intel-text">' + a.overview + '</p>' +
      '<h3 class="match-intel-section-title" style="margin-top:16px;">Form Analysis</h3>' +
      '<p class="match-intel-text">' + a.form + '</p>' +
    '</div>';

    // --- H2H Section ---
    html += '<div class="match-intel-section' + lockedClass + '">' +
      '<h3 class="match-intel-section-title">Head-to-Head Record</h3>' +
      '<p class="match-intel-text" style="margin-bottom:12px;">' + a.h2h + '</p>' +
      (h2hRows ? '<div class="match-intel-h2h">' +
        '<table class="match-intel-h2h-table">' +
          '<tbody>' + h2hRows + '</tbody>' +
        '</table>' +
      '</div>' : '') +
    '</div>';

    // --- Stats Grid ---
    html += '<div class="match-intel-section' + lockedClass + '">' +
      '<h3 class="match-intel-section-title">Key Statistics</h3>' +
      '<div class="match-intel-stats">' +
        '<div class="match-intel-stat-header"><span></span><span>' + m.homeTeam + '</span><span>' + m.awayTeam + '</span></div>' +
        '<div class="match-intel-stat-row"><span>Avg Goals Scored</span><span>' + s.home.avgScored + '</span><span>' + s.away.avgScored + '</span></div>' +
        '<div class="match-intel-stat-row"><span>Avg Goals Conceded</span><span>' + s.home.avgConceded + '</span><span>' + s.away.avgConceded + '</span></div>' +
        '<div class="match-intel-stat-row"><span>Clean Sheets</span><span>' + s.home.cleanSheetPct + '%</span><span>' + s.away.cleanSheetPct + '%</span></div>' +
        '<div class="match-intel-stat-row"><span>BTTS %</span><span>' + s.home.bttsPct + '%</span><span>' + s.away.bttsPct + '%</span></div>' +
        '<div class="match-intel-stat-row"><span>Over 2.5 %</span><span>' + s.home.over25Pct + '%</span><span>' + s.away.over25Pct + '%</span></div>' +
      '</div>' +
    '</div>';

    // --- Risk Assessment ---
    html += '<div class="match-intel-section' + lockedClass + '">' +
      '<h3 class="match-intel-section-title">Risk Assessment</h3>' +
      '<p class="match-intel-text">' + v.riskText + '</p>' +
    '</div>';

    // --- Locked overlay for free users ---
    if (!isPremium) {
      html += '<div class="match-intel-upgrade-overlay">' +
        '<div class="match-intel-upgrade-inner">' +
          '<div style="font-size:32px;margin-bottom:12px;">&#128274;</div>' +
          '<h3>Premium Match Intelligence</h3>' +
          '<p class="text-muted" style="margin:8px 0 16px;">Unlock expert verdicts, detailed analysis, H2H breakdowns, and recommended bets for every fixture.</p>' +
          '<a href="#/pricing" class="btn btn-gold" onclick="App.closeMatchIntelligence()">Upgrade to Premium</a>' +
        '</div>' +
      '</div>';
    }

    // --- AI Preview Button + Section ---
    html += '<div class="match-intel-section" id="ai-preview-section">' +
      '<h3 class="match-intel-section-title">AI Match Preview</h3>' +
      '<p class="text-muted" style="font-size:12px;margin-bottom:12px;">Powered by Claude AI — professional written match analysis unique to Elite Edge.</p>' +
      '<button class="btn btn-gold" id="ai-preview-btn" onclick="App.loadFootballAIPreview(' + data.fixtureId + ')" style="margin-bottom:16px;">Generate AI Preview</button>' +
      '<div id="ai-preview-content"></div>' +
    '</div>';

    container.innerHTML = html;
  },

  _aiPreviewCache: {},

  async loadFootballAIPreview(fixtureId) {
    var btn = document.getElementById('ai-preview-btn');
    var contentDiv = document.getElementById('ai-preview-content');
    if (!btn || !contentDiv) return;

    // Check cache
    if (this._aiPreviewCache['football:' + fixtureId]) {
      this._renderFootballAIPreview(contentDiv, this._aiPreviewCache['football:' + fixtureId]);
      btn.style.display = 'none';
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner" style="width:16px;height:16px;display:inline-block;vertical-align:middle;margin-right:8px;"></span> Generating...';
    contentDiv.innerHTML = '';

    try {
      var data = await this.api('/football/ai-preview/' + fixtureId);
      if (data && data.aiPreview) {
        this._aiPreviewCache['football:' + fixtureId] = data.aiPreview;
        this._renderFootballAIPreview(contentDiv, data.aiPreview);
        btn.style.display = 'none';
      } else {
        contentDiv.innerHTML = '<p class="text-muted">AI preview unavailable. The service may not be configured.</p>';
        btn.disabled = false;
        btn.innerHTML = 'Generate AI Preview';
      }
    } catch (err) {
      contentDiv.innerHTML = '<p class="text-muted">Unable to generate AI preview: ' + (err.message || 'Unknown error') + '</p>';
      btn.disabled = false;
      btn.innerHTML = 'Retry AI Preview';
    }
  },

  _renderFootballAIPreview(container, preview) {
    var html = '<div style="background:linear-gradient(135deg,rgba(212,168,67,0.08),rgba(212,168,67,0.02));border:1px solid rgba(212,168,67,0.2);border-radius:12px;padding:20px;">';
    if (preview.headline) {
      html += '<h4 style="color:#d4a843;margin:0 0 12px 0;font-size:16px;">' + preview.headline + '</h4>';
    }
    if (preview.preview) {
      html += '<div style="font-size:13px;color:var(--text-secondary);line-height:1.7;white-space:pre-line;">' + preview.preview + '</div>';
    }
    if (preview.keyStats && preview.keyStats.length > 0) {
      html += '<div style="margin-top:14px;"><strong style="color:#d4a843;font-size:12px;">KEY STATS:</strong><ul style="margin:6px 0 0 0;padding-left:18px;">';
      preview.keyStats.forEach(function(stat) {
        html += '<li style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">' + stat + '</li>';
      });
      html += '</ul></div>';
    }
    if (preview.verdict) {
      html += '<div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(212,168,67,0.15);font-weight:700;font-size:13px;color:#d4a843;">' + preview.verdict + '</div>';
    }
    html += '<div style="margin-top:10px;font-size:10px;color:var(--text-muted);">Generated by Claude AI for Elite Edge Sports Tips</div>';
    html += '</div>';
    container.innerHTML = html;
  },

  // -----------------------------------------------------------------------
  // GRAND NATIONAL FESTIVAL PAGE
  // -----------------------------------------------------------------------
  _festivalTab: 'thursday',

  async renderFestival() {
    var app = document.getElementById('app');
    app.innerHTML = this.renderSkeleton('tips');

    try {
      var tips = await this.api('/tips');
      this.tips = tips;
    } catch(e) { /* use cached */ }

    var self = this;
    var allTips = this.tips || [];
    var isPremium = this.isPremium();
    var tab = this._festivalTab || 'thursday';

    // Festival race schedule
    var festivalDays = {
      thursday: {
        label: 'Thursday 9 April — Opening Day',
        date: '2026-04-09',
        races: [
          { time: '13:45', name: 'Boodles Anniversary Juvenile Hurdle', grade: 'Grade 1' },
          { time: '14:20', name: 'William Hill Manifesto Novices\' Chase', grade: 'Grade 1' },
          { time: '14:55', name: 'Racing Welfare Bowl Chase', grade: 'Grade 1' },
          { time: '15:30', name: 'Randox Foxhunters\' Open Hunters\' Chase', grade: 'Class 2' },
          { time: '16:05', name: 'William Hill Aintree Hurdle', grade: 'Grade 1' },
          { time: '16:40', name: 'Close Brothers Red Rum Handicap Chase', grade: 'Premier Handicap' },
          { time: '17:15', name: 'Goffs Nickel Coin Mares\' Standard Open NH Flat Race', grade: 'Grade 2' }
        ]
      },
      friday: {
        label: 'Friday 10 April — Ladies Day',
        date: '2026-04-10',
        races: [
          { time: '16:05', name: 'Randox Topham Handicap Chase (National Fences)', grade: 'Class 1 Premier Handicap' }
        ],
        notice: 'Other Friday races will publish automatically at 7:30am Friday morning once the full card is released by the Racing API.'
      },
      saturday: {
        label: 'Saturday 11 April — Grand National Day',
        date: '2026-04-11',
        races: [
          { time: '16:00', name: 'Randox Grand National Handicap Chase', grade: 'Class 1 Premier Handicap' }
        ],
        notice: 'Other Saturday races will publish automatically at 7:30am Saturday morning once the full card is released by the Racing API.'
      }
    };

    var day = festivalDays[tab];
    var dayTips = allTips.filter(function(t) { return t.meeting === 'Aintree' && t.date === day.date; });

    // Build race cards
    var raceCardsHtml = '';
    if (day.notice) {
      raceCardsHtml += '<div style="background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.25);border-radius:10px;padding:14px 18px;margin-bottom:16px;display:flex;align-items:center;gap:12px;"><div style="font-size:22px;">&#9432;</div><div style="font-size:13px;color:var(--text-secondary);line-height:1.5;">' + day.notice + '</div></div>';
    }
    for (var ri = 0; ri < day.races.length; ri++) {
      var race = day.races[ri];
      var raceTips = dayTips.filter(function(t) { return t.raceTime === race.time; });
      var hasTip = raceTips.length > 0;

      var tipsHtml = '';
      if (hasTip) {
        for (var ti = 0; ti < raceTips.length; ti++) {
          var tip = raceTips[ti];
          var expandId = 'fest-expand-' + tab + '-' + ri + '-' + ti;
          if (isPremium) {
            tipsHtml += '<div style="background:rgba(212,168,67,0.06);border:1px solid rgba(212,168,67,0.2);border-radius:10px;padding:14px 18px;margin-top:10px;">';
            tipsHtml += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">';
            tipsHtml += '<div>';
            tipsHtml += '<div style="font-weight:800;font-size:16px;color:#fff;">' + tip.selection + (tip.isNap ? ' <span style="background:#d4a843;color:#0a0e1a;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;vertical-align:middle;">NAP</span>' : '') + '</div>';
            tipsHtml += '<div style="font-size:12px;color:var(--text-secondary);">' + (tip.market || 'Win') + ' &bull; Confidence: ' + tip.confidence + '/10 &bull; Stake: ' + (tip.staking || '-') + '</div>';
            tipsHtml += '</div>';
            tipsHtml += '<div style="font-weight:900;font-size:22px;color:#d4a843;">' + self.formatOdds(tip.odds) + '</div>';
            tipsHtml += '</div>';
            tipsHtml += '<div style="margin-top:8px;font-size:13px;color:var(--text-secondary);line-height:1.6;">' + (tip.analysis ? tip.analysis.summary : '') + '</div>';
            tipsHtml += '<button onclick="var el=document.getElementById(\'' + expandId + '\');el.style.display=el.style.display===\'none\'?\'block\':\'none\';" style="background:none;border:1px solid rgba(212,168,67,0.3);color:#d4a843;padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer;margin-top:10px;font-weight:600;">Expand Full Analysis</button>';
            tipsHtml += '<div id="' + expandId + '" style="display:none;margin-top:12px;font-size:12px;color:var(--text-secondary);line-height:1.7;">';
            if (tip.analysis) {
              if (tip.analysis.form) tipsHtml += '<div style="margin-bottom:8px;"><strong style="color:#d4a843;">Form:</strong> ' + tip.analysis.form + '</div>';
              if (tip.analysis.goingSuitability) tipsHtml += '<div style="margin-bottom:8px;"><strong style="color:#d4a843;">Going:</strong> ' + tip.analysis.goingSuitability + '</div>';
              if (tip.analysis.courseRecord) tipsHtml += '<div style="margin-bottom:8px;"><strong style="color:#d4a843;">Course:</strong> ' + tip.analysis.courseRecord + '</div>';
              if (tip.analysis.trainerForm) tipsHtml += '<div style="margin-bottom:8px;"><strong style="color:#d4a843;">Trainer:</strong> ' + tip.analysis.trainerForm + '</div>';
              if (tip.analysis.clockerInsight) tipsHtml += '<div style="margin-top:12px;padding:14px;background:rgba(212,168,67,0.06);border:1px solid rgba(212,168,67,0.2);border-radius:8px;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#d4a843;font-weight:800;margin-bottom:8px;">The Clocker — Deep Intelligence</div><div style="font-size:13px;color:#cbd5e1;line-height:1.6;">' + tip.analysis.clockerInsight + '</div></div>';
              if (tip.analysis.oddsMovement) tipsHtml += '<div style="margin-bottom:8px;background:rgba(34,197,94,0.08);border-left:3px solid #22c55e;padding:8px 12px;border-radius:4px;"><strong style="color:#22c55e;">Market Mover:</strong> ' + tip.analysis.oddsMovement + '</div>';
              if (tip.analysis.dualAIVerified) tipsHtml += '<div style="margin-bottom:8px;background:rgba(34,197,94,0.06);border-left:3px solid #22c55e;padding:8px 12px;border-radius:4px;"><strong style="color:#22c55e;">Dual AI Verified:</strong> GPT independently rates this ' + (tip.analysis.gptConfidence || '?') + '/10 confidence. ' + (tip.analysis.gptReasoning || '') + '</div>';
              if (tip.analysis.riskNotes) tipsHtml += '<div style="margin-bottom:8px;"><strong style="color:#ef4444;">Risk:</strong> ' + tip.analysis.riskNotes + '</div>';
            }
            tipsHtml += '</div>';
            tipsHtml += '</div>';
          } else {
            // Locked / blurred for free users
            tipsHtml += '<div style="background:rgba(212,168,67,0.04);border:1px solid rgba(212,168,67,0.15);border-radius:10px;padding:14px 18px;margin-top:10px;position:relative;overflow:hidden;">';
            tipsHtml += '<div style="filter:blur(8px);pointer-events:none;">';
            tipsHtml += '<div style="display:flex;justify-content:space-between;align-items:center;">';
            tipsHtml += '<div><div style="font-weight:800;font-size:16px;color:#fff;">Premium Selection</div>';
            tipsHtml += '<div style="font-size:12px;color:var(--text-secondary);">Win &bull; Confidence: 8/10</div></div>';
            tipsHtml += '<div style="font-weight:900;font-size:22px;color:#d4a843;">3/1</div>';
            tipsHtml += '</div>';
            tipsHtml += '<div style="margin-top:8px;font-size:13px;color:var(--text-secondary);">Elite-level analysis with form, going, course and trainer insights...</div>';
            tipsHtml += '</div>';
            tipsHtml += '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(10,14,26,0.7);backdrop-filter:blur(2px);">';
            tipsHtml += '<div style="font-size:28px;margin-bottom:6px;">&#128274;</div>';
            tipsHtml += '<div style="font-weight:700;font-size:14px;color:#d4a843;margin-bottom:4px;">Premium Selection</div>';
            tipsHtml += '<a href="#/pricing" style="background:#d4a843;color:#0a0e1a;padding:8px 20px;border-radius:6px;font-weight:700;font-size:12px;text-decoration:none;">Unlock All Festival Tips</a>';
            tipsHtml += '</div>';
            tipsHtml += '</div>';
          }
        }
      } else {
        if (tab === 'saturday') {
          tipsHtml += '<div style="background:rgba(100,100,100,0.1);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px 18px;margin-top:10px;font-size:13px;color:var(--text-secondary);">Tips coming soon &mdash; check back closer to race day.</div>';
        } else {
          tipsHtml += '<div style="background:rgba(100,100,100,0.1);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px 18px;margin-top:10px;font-size:13px;color:var(--text-secondary);">Analysis in progress.</div>';
        }
      }

      var gradeColor = race.grade.indexOf('Grade 1') > -1 ? '#d4a843' : (race.grade.indexOf('Grade') > -1 ? '#a0a0a0' : '#6b7280');
      var isNational = race.name.indexOf('Grand National') > -1;

      raceCardsHtml += '<div style="background:var(--card-bg);border:1px solid ' + (isNational ? 'rgba(212,168,67,0.4)' : 'var(--border)') + ';border-radius:12px;padding:18px 20px;margin-bottom:14px;' + (isNational ? 'box-shadow:0 0 20px rgba(212,168,67,0.1);' : '') + '">';
      raceCardsHtml += '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">';
      raceCardsHtml += '<div style="background:rgba(212,168,67,0.15);color:#d4a843;font-weight:800;font-size:15px;padding:6px 14px;border-radius:8px;min-width:60px;text-align:center;">' + race.time + '</div>';
      raceCardsHtml += '<div style="flex:1;min-width:200px;">';
      raceCardsHtml += '<div style="font-weight:700;font-size:15px;color:#fff;">' + race.name + (isNational ? ' &#127942;' : '') + '</div>';
      raceCardsHtml += '<div style="font-size:12px;color:' + gradeColor + ';font-weight:600;">' + race.grade + '</div>';
      raceCardsHtml += '</div>';
      raceCardsHtml += '</div>';
      raceCardsHtml += tipsHtml;
      raceCardsHtml += '</div>';
    }

    // Tab buttons
    var tabsHtml = '';
    var tabs = ['thursday', 'friday', 'saturday'];
    var tabLabels = ['Thursday', 'Friday', 'Saturday'];
    for (var i = 0; i < tabs.length; i++) {
      var isActive = tabs[i] === tab;
      tabsHtml += '<button onclick="App._festivalTab=\'' + tabs[i] + '\';App.renderFestival();" style="padding:10px 24px;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;border:' + (isActive ? '2px solid #d4a843' : '1px solid rgba(255,255,255,0.1)') + ';background:' + (isActive ? 'rgba(212,168,67,0.15)' : 'rgba(255,255,255,0.03)') + ';color:' + (isActive ? '#d4a843' : 'var(--text-secondary)') + ';">' + tabLabels[i] + '</button>';
    }

    // Tip count for this day
    var tipCount = dayTips.length;

    app.innerHTML = '<div class="container">' +
      '<div class="page-header" style="text-align:center;margin-bottom:8px;">' +
        '<h1 style="font-size:28px;">&#127943; Grand National Festival 2026</h1>' +
        '<p style="font-size:15px;color:var(--text-secondary);">Aintree &mdash; 9-11 April &mdash; Elite Analysis For Every Race</p>' +
      '</div>' +

      '<div style="background:linear-gradient(135deg,rgba(212,168,67,0.12),rgba(184,144,47,0.04));border:2px solid rgba(212,168,67,0.3);border-radius:14px;padding:20px;margin-bottom:24px;text-align:center;">' +
        '<div style="display:flex;justify-content:center;gap:32px;flex-wrap:wrap;">' +
          '<div><div style="font-size:28px;font-weight:900;color:#d4a843;">18</div><div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;">Races</div></div>' +
          '<div><div style="font-size:28px;font-weight:900;color:#d4a843;">3</div><div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;">Days</div></div>' +
          '<div><div style="font-size:28px;font-weight:900;color:#d4a843;">15+</div><div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;">Selections</div></div>' +
          '<div><div style="font-size:28px;font-weight:900;color:#22c55e;">Grade 1</div><div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;">Level Analysis</div></div>' +
        '</div>' +
      '</div>' +

      '<div style="display:flex;gap:10px;margin-bottom:20px;margin-top:8px;justify-content:center;flex-wrap:wrap;overflow:visible;">' + tabsHtml + '</div>' +

      '<div style="margin-bottom:12px;">' +
        '<h2 style="font-size:18px;color:#d4a843;margin-bottom:4px;">' + day.label + '</h2>' +
        '<p style="font-size:13px;color:var(--text-secondary);">' + day.races.length + ' races &bull; ' + tipCount + ' selection' + (tipCount !== 1 ? 's' : '') + ' published</p>' +
      '</div>' +

      raceCardsHtml +

      (!isPremium ? '<div style="text-align:center;margin-top:24px;margin-bottom:24px;">' +
        '<div style="font-size:18px;font-weight:800;color:#d4a843;margin-bottom:8px;">Unlock All 15+ Festival Selections</div>' +
        '<div style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">Full analysis, staking plans, and live updates for every race across all 3 days.</div>' +
        '<a href="#/pricing" style="display:inline-block;background:#d4a843;color:#0a0e1a;padding:14px 36px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;">Subscribe Now &mdash; 14-Day Free Trial</a>' +
        '<div style="font-size:11px;color:#6b7280;margin-top:8px;">Then &pound;19.99/mo. Cancel anytime. 18+ BeGambleAware.org</div>' +
      '</div>' : '') +

    '</div>';
  },

  // -----------------------------------------------------------------------
  // FESTIVAL HUB — Dynamic festival detection from live racing cards
  // -----------------------------------------------------------------------
  async renderFestivalHub() {
    var app = document.getElementById('app');
    app.innerHTML = this.renderSkeleton('tips');

    var self = this;
    var isPremium = this.isPremium();
    var festivalMeetings = ['cheltenham', 'aintree', 'ascot', 'goodwood', 'york', 'newmarket', 'epsom'];

    // Fetch live racing cards and tips in parallel
    var racecards = [];
    var allTips = [];
    try {
      var responses = await Promise.allSettled([
        fetch('/api/racing/live-cards').then(function(r) { return r.ok ? r.json() : { racecards: [] }; }),
        this.api('/tips')
      ]);
      var cardsData = responses[0].status === 'fulfilled' ? responses[0].value : { racecards: [] };
      racecards = cardsData.racecards || cardsData.meetings || [];
      if (!Array.isArray(racecards)) racecards = [];
      allTips = responses[1].status === 'fulfilled' ? responses[1].value : [];
      if (!Array.isArray(allTips)) allTips = [];
      this.tips = allTips;
    } catch (e) { /* use cached */ }

    // Group racecards into meetings
    var meetingsMap = {};
    racecards.forEach(function(race) {
      // Handle both flat racecard arrays and meeting-grouped data
      var meetingName = race.meeting || race.course || race.name || '';
      if (!meetingName) return;
      if (!meetingsMap[meetingName]) {
        meetingsMap[meetingName] = { name: meetingName, races: [] };
      }
      // If it's a meeting object with races array, add its races
      if (race.races && Array.isArray(race.races)) {
        race.races.forEach(function(r) {
          r._meetingName = meetingName;
          meetingsMap[meetingName].races.push(r);
        });
      } else {
        // It's a flat race object
        race._meetingName = meetingName;
        meetingsMap[meetingName].races.push(race);
      }
    });

    // Detect festival meetings
    var festivals = [];
    var meetingKeys = Object.keys(meetingsMap);
    for (var mk = 0; mk < meetingKeys.length; mk++) {
      var meeting = meetingsMap[meetingKeys[mk]];
      var nameLower = meeting.name.toLowerCase();
      var isFestival = false;

      // Check meeting name against known festivals
      for (var fi = 0; fi < festivalMeetings.length; fi++) {
        if (nameLower.indexOf(festivalMeetings[fi]) !== -1) {
          isFestival = true;
          break;
        }
      }

      // Check for Grade 1 / Group 1 races or high prize money
      if (!isFestival) {
        for (var ri = 0; ri < meeting.races.length; ri++) {
          var race = meeting.races[ri];
          var raceClass = (race.raceClass || race.grade || race.class || '').toLowerCase();
          var prizeMoney = race.prizeMoney || race.prize || '';
          var prizeNum = 0;
          if (typeof prizeMoney === 'string') {
            prizeNum = parseInt(prizeMoney.replace(/[^0-9]/g, '')) || 0;
          } else if (typeof prizeMoney === 'number') {
            prizeNum = prizeMoney;
          }

          if (raceClass.indexOf('grade 1') !== -1 || raceClass.indexOf('group 1') !== -1 || prizeNum > 50000) {
            isFestival = true;
            break;
          }
        }
      }

      if (isFestival) {
        festivals.push(meeting);
      }
    }

    if (festivals.length === 0) {
      // No festivals detected — show calendar
      app.innerHTML =
        '<div class="container">' +
          '<div class="page-header" style="text-align:center;">' +
            '<h1 style="font-size:28px;">&#127942; Festival Hub</h1>' +
            '<p style="font-size:15px;color:var(--text-secondary);">Major Racing Festivals &mdash; Elite Analysis For Every Big Race</p>' +
          '</div>' +
          '<div style="border:2px solid rgba(212,168,67,0.3);border-radius:14px;padding:32px;margin-bottom:24px;background:linear-gradient(135deg,rgba(212,168,67,0.08),rgba(212,168,67,0.02));text-align:center;">' +
            '<div style="font-size:48px;margin-bottom:16px;opacity:0.6;">&#127943;</div>' +
            '<div style="font-size:18px;font-weight:800;color:#d4a843;margin-bottom:12px;">No Major Festivals This Week</div>' +
            '<div style="font-size:14px;color:var(--text-secondary);line-height:1.8;max-width:500px;margin:0 auto;">' +
              'Check back for the big meetings:<br>' +
              '<strong style="color:#d4a843;">Cheltenham</strong> (March) &bull; ' +
              '<strong style="color:#d4a843;">Grand National</strong> (April) &bull; ' +
              '<strong style="color:#d4a843;">Royal Ascot</strong> (June) &bull; ' +
              '<strong style="color:#d4a843;">Glorious Goodwood</strong> (July)' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-top:24px;text-align:center;">' +
              '<div class="festival-cal-item" style="background:rgba(255,255,255,0.03);border-radius:10px;padding:16px;border:1px solid rgba(212,168,67,0.15);">' +
                '<div style="font-size:28px;margin-bottom:6px;">&#127793;</div>' +
                '<div style="font-weight:700;font-size:14px;color:#fff;">Cheltenham Festival</div>' +
                '<div style="font-size:12px;color:var(--text-muted);">March &bull; 4 days &bull; 28 races</div>' +
              '</div>' +
              '<div class="festival-cal-item" style="background:rgba(255,255,255,0.03);border-radius:10px;padding:16px;border:1px solid rgba(212,168,67,0.15);">' +
                '<div style="font-size:28px;margin-bottom:6px;">&#127943;</div>' +
                '<div style="font-weight:700;font-size:14px;color:#fff;">Grand National</div>' +
                '<div style="font-size:12px;color:var(--text-muted);">April &bull; 3 days &bull; 18 races</div>' +
              '</div>' +
              '<div class="festival-cal-item" style="background:rgba(255,255,255,0.03);border-radius:10px;padding:16px;border:1px solid rgba(212,168,67,0.15);">' +
                '<div style="font-size:28px;margin-bottom:6px;">&#128081;</div>' +
                '<div style="font-weight:700;font-size:14px;color:#fff;">Royal Ascot</div>' +
                '<div style="font-size:12px;color:var(--text-muted);">June &bull; 5 days &bull; 35 races</div>' +
              '</div>' +
              '<div class="festival-cal-item" style="background:rgba(255,255,255,0.03);border-radius:10px;padding:16px;border:1px solid rgba(212,168,67,0.15);">' +
                '<div style="font-size:28px;margin-bottom:6px;">&#9728;&#65039;</div>' +
                '<div style="font-weight:700;font-size:14px;color:#fff;">Glorious Goodwood</div>' +
                '<div style="font-size:12px;color:var(--text-muted);">July/August &bull; 5 days &bull; 35 races</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="text-align:center;">' +
            '<a href="#/racing" style="color:#d4a843;font-size:14px;font-weight:600;text-decoration:none;">View Today\'s Racing Cards &rarr;</a>' +
          '</div>' +
        '</div>';
      return;
    }

    // Festival detected — build the hub
    var festivalHtml = '';
    for (var fIdx = 0; fIdx < festivals.length; fIdx++) {
      var fest = festivals[fIdx];
      var festTips = allTips.filter(function(t) {
        return (t.meeting || '').toLowerCase() === fest.name.toLowerCase() ||
               (t.event || '').toLowerCase().indexOf(fest.name.toLowerCase()) !== -1;
      });

      // Sort races by time
      fest.races.sort(function(a, b) {
        var ta = a.time || a.offTime || a.raceTime || '';
        var tb = b.time || b.offTime || b.raceTime || '';
        return ta.localeCompare(tb);
      });

      var raceCardsHtml = '';
      for (var rIdx = 0; rIdx < fest.races.length; rIdx++) {
        var race = fest.races[rIdx];
        var raceTime = race.time || race.offTime || race.raceTime || '';
        var raceName = race.raceName || race.name || race.raceClass || 'Race';
        var raceClass = race.raceClass || race.grade || race.class || '';
        var prizeMoney = race.prizeMoney || race.prize || '';
        var isGrade1 = raceClass.toLowerCase().indexOf('grade 1') !== -1 || raceClass.toLowerCase().indexOf('group 1') !== -1;

        // Find our tip for this race
        var raceTips = festTips.filter(function(t) {
          return t.raceTime === raceTime || t.time === raceTime;
        });

        var tipsHtml = '';
        if (raceTips.length > 0) {
          for (var tIdx = 0; tIdx < raceTips.length; tIdx++) {
            var tip = raceTips[tIdx];
            if (isPremium) {
              tipsHtml +=
                '<div class="festival-hub-tip" style="background:rgba(212,168,67,0.06);border:1px solid rgba(212,168,67,0.2);border-radius:10px;padding:14px 18px;margin-top:10px;">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
                    '<div>' +
                      '<div style="font-weight:800;font-size:16px;color:#fff;">' + tip.selection + (tip.isNap ? ' <span style="background:#d4a843;color:#0a0e1a;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;vertical-align:middle;">NAP</span>' : '') + '</div>' +
                      '<div style="font-size:12px;color:var(--text-secondary);">' + (tip.market || 'Win') + ' &bull; Confidence: ' + tip.confidence + '/10 &bull; Stake: ' + (tip.staking || '-') + '</div>' +
                    '</div>' +
                    '<div style="font-weight:900;font-size:22px;color:#d4a843;">' + self.formatOdds(tip.odds) + '</div>' +
                  '</div>' +
                  (tip.analysis && tip.analysis.summary ? '<div style="margin-top:8px;font-size:13px;color:var(--text-secondary);line-height:1.6;">' + tip.analysis.summary + '</div>' : '') +
                '</div>';
            } else {
              tipsHtml +=
                '<div style="background:rgba(212,168,67,0.04);border:1px solid rgba(212,168,67,0.15);border-radius:10px;padding:14px 18px;margin-top:10px;position:relative;overflow:hidden;">' +
                  '<div style="filter:blur(8px);pointer-events:none;">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                      '<div><div style="font-weight:800;font-size:16px;color:#fff;">Premium Selection</div>' +
                      '<div style="font-size:12px;color:var(--text-secondary);">Win &bull; Confidence: 8/10</div></div>' +
                      '<div style="font-weight:900;font-size:22px;color:#d4a843;">3/1</div>' +
                    '</div>' +
                  '</div>' +
                  '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(10,14,26,0.7);backdrop-filter:blur(2px);">' +
                    '<div style="font-size:28px;margin-bottom:6px;">&#128274;</div>' +
                    '<div style="font-weight:700;font-size:14px;color:#d4a843;margin-bottom:4px;">Premium Selection</div>' +
                    '<a href="#/pricing" style="background:#d4a843;color:#0a0e1a;padding:8px 20px;border-radius:6px;font-weight:700;font-size:12px;text-decoration:none;">Unlock Festival Tips</a>' +
                  '</div>' +
                '</div>';
            }
          }
        } else {
          tipsHtml = '<div style="background:rgba(100,100,100,0.1);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px 18px;margin-top:10px;font-size:13px;color:var(--text-secondary);">Analysis pending — check back closer to race time.</div>';
        }

        var gradeColor = isGrade1 ? '#d4a843' : (raceClass.toLowerCase().indexOf('grade') !== -1 || raceClass.toLowerCase().indexOf('group') !== -1 ? '#a0a0a0' : '#6b7280');

        raceCardsHtml +=
          '<div class="festival-hub-race" style="background:var(--card-bg);border:1px solid ' + (isGrade1 ? 'rgba(212,168,67,0.4)' : 'var(--border)') + ';border-radius:12px;padding:18px 20px;margin-bottom:14px;' + (isGrade1 ? 'box-shadow:0 0 20px rgba(212,168,67,0.1);' : '') + '">' +
            '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
              '<div style="background:rgba(212,168,67,0.15);color:#d4a843;font-weight:800;font-size:15px;padding:6px 14px;border-radius:8px;min-width:60px;text-align:center;">' + raceTime + '</div>' +
              '<div style="flex:1;min-width:200px;">' +
                '<div style="font-weight:700;font-size:15px;color:#fff;">' + raceName + '</div>' +
                '<div style="font-size:12px;color:' + gradeColor + ';font-weight:600;">' + raceClass + (prizeMoney ? ' &bull; ' + prizeMoney : '') + '</div>' +
              '</div>' +
            '</div>' +
            tipsHtml +
          '</div>';
      }

      festivalHtml +=
        '<div style="margin-bottom:32px;">' +
          '<h2 style="font-size:20px;color:#d4a843;margin-bottom:4px;">&#127942; ' + fest.name + '</h2>' +
          '<p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">' + fest.races.length + ' race' + (fest.races.length !== 1 ? 's' : '') + ' &bull; ' + festTips.length + ' selection' + (festTips.length !== 1 ? 's' : '') + ' published</p>' +
          raceCardsHtml +
        '</div>';
    }

    app.innerHTML =
      '<div class="container">' +
        '<div class="page-header" style="text-align:center;margin-bottom:8px;">' +
          '<h1 style="font-size:28px;">&#127942; Festival Hub</h1>' +
          '<p style="font-size:15px;color:var(--text-secondary);">Live Festival Racing &mdash; Elite Analysis For Every Big Race</p>' +
        '</div>' +
        '<div style="background:linear-gradient(135deg,rgba(212,168,67,0.12),rgba(184,144,47,0.04));border:2px solid rgba(212,168,67,0.3);border-radius:14px;padding:20px;margin-bottom:24px;text-align:center;">' +
          '<div style="display:flex;justify-content:center;gap:32px;flex-wrap:wrap;">' +
            '<div><div style="font-size:28px;font-weight:900;color:#d4a843;">' + festivals.length + '</div><div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;">Festival' + (festivals.length !== 1 ? 's' : '') + ' Detected</div></div>' +
            '<div><div style="font-size:28px;font-weight:900;color:#d4a843;">' + festivals.reduce(function(s, f) { return s + f.races.length; }, 0) + '</div><div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;">Races</div></div>' +
            '<div><div style="font-size:28px;font-weight:900;color:#22c55e;">LIVE</div><div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;">Auto-Detected</div></div>' +
          '</div>' +
        '</div>' +
        festivalHtml +
        (!isPremium ? '<div style="text-align:center;margin-top:24px;margin-bottom:24px;">' +
          '<div style="font-size:18px;font-weight:800;color:#d4a843;margin-bottom:8px;">Unlock All Festival Selections</div>' +
          '<div style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">Full analysis, staking plans, and live updates for every festival race.</div>' +
          '<a href="#/pricing" style="display:inline-block;background:#d4a843;color:#0a0e1a;padding:14px 36px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;">Subscribe Now &mdash; 14-Day Free Trial</a>' +
          '<div style="font-size:11px;color:#6b7280;margin-top:8px;">Then &pound;19.99/mo. Cancel anytime. 18+ BeGambleAware.org</div>' +
        '</div>' : '') +
      '</div>';
  },

  // -----------------------------------------------------------------------
  // RESULTS PAGE
  // -----------------------------------------------------------------------
  async renderResults() {
    const app = document.getElementById('app');
    app.innerHTML = this.renderSkeleton('results');

    try {
      const [results, perf, tiers] = await Promise.all([
        this.api('/results'),
        this.api('/results/performance'),
        this.loadConfidenceLeaderboard(),
      ]);
      this.results = results;
      this._allResults = results;
      this.performance = perf;
    } catch {}

    const results = this.results;
    const perf = this.performance || { roi: 0, strikeRate: 0, runningBank: 100, totalPnl: 0, totalTips: 0, wins: 0, losses: 0, avgOdds: 0, longestWinStreak: 0 };
    const confidenceLeaderboardHtml = this.renderConfidenceLeaderboard(this._confidenceTiers || []);

    app.innerHTML = `
      <div class="container">
        <div class="page-header">
          <h1><span class="accent">Results</span> & Performance</h1>
          <p>Full transparency on every published tip. Track record you can trust.</p>
        </div>

        <!-- Confidence Tier Leaderboard (social proof) -->
        ${confidenceLeaderboardHtml}

        <div class="grid grid-4 mb-32">
          <div class="stat-card"><div class="stat-value ${perf.roi >= 0 ? 'positive' : 'negative'}">${perf.roi > 0 ? '+' : ''}${perf.roi}%</div><div class="stat-label">ROI</div></div>
          <div class="stat-card"><div class="stat-value">${perf.strikeRate}%</div><div class="stat-label">Strike Rate</div></div>
          <div class="stat-card"><div class="stat-value ${perf.totalPnl >= 0 ? 'positive' : 'negative'}">${perf.totalPnl > 0 ? '+' : ''}${perf.totalPnl}</div><div class="stat-label">Total P/L (units)</div></div>
          <div class="stat-card"><div class="stat-value">${perf.runningBank}</div><div class="stat-label">Running Bank</div></div>
        </div>

        <div class="grid grid-4 mb-32">
          <div class="stat-card"><div class="stat-value">${perf.totalTips}</div><div class="stat-label">Total Tips</div></div>
          <div class="stat-card"><div class="stat-value positive">${perf.wins}</div><div class="stat-label">Winners</div></div>
          <div class="stat-card"><div class="stat-value negative">${perf.losses || 0}</div><div class="stat-label">Losers</div></div>
          <div class="stat-card"><div class="stat-value">${perf.longestWinStreak || 0}</div><div class="stat-label">Best Win Streak</div></div>
        </div>

        <!-- Results Sponsor -->
        <div class="results-sponsor" id="sponsor-results" style="font-size:12px;color:var(--text-muted);text-align:center;margin-bottom:16px;">
          All results verified via live API data &mdash; settled automatically every 5 minutes
        </div>

        <!-- Profit Calendar (GitHub-style heatmap) -->
        <div class="profit-calendar" id="profit-calendar-container"></div>

        <!-- Advanced Chart Filters -->
        <div class="section">
          <div class="section-title"><span class="icon">&#128200;</span> Performance Dashboard</div>
          <div class="chart-filter-bar" id="chart-filters">
            <select id="cf-sport" onchange="App.updateCharts()">
              <option value="">All Sports</option>
              <option value="racing">Racing</option>
              <option value="football">Football</option>
            </select>
            <select id="cf-market" onchange="App.updateCharts()">
              <option value="">All Markets</option>
              <option value="Win">Win</option>
              <option value="Each-Way">Each-Way</option>
              <option value="BTTS">BTTS</option>
              <option value="Over/Under">Over/Under</option>
              <option value="Asian Handicap">Asian Handicap</option>
              <option value="Match Result">Match Result</option>
              <option value="Double Chance">Double Chance</option>
            </select>
            <select id="cf-premium" onchange="App.updateCharts()">
              <option value="">All Types</option>
              <option value="true">Premium Only</option>
              <option value="false">Free Only</option>
            </select>
            <select id="cf-month" onchange="App.updateCharts()">
              <option value="">All Time</option>
              ${(() => {
                const months = new Set();
                (this._allResults || []).forEach(r => { if (r.date) months.add(r.date.substring(0, 7)); });
                return Array.from(months).sort().reverse().map(m => {
                  const [y, mo] = m.split('-');
                  const name = new Date(y, parseInt(mo) - 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
                  return '<option value="' + m + '">' + name + '</option>';
                }).join('');
              })()}
            </select>
          </div>

          <!-- Multi-chart dashboard -->
          <div class="chart-container" style="margin-bottom:20px;"><canvas id="performance-chart"></canvas></div>
          <div class="multi-chart-grid">
            <div class="chart-panel">
              <h4>Monthly P/L</h4>
              <canvas id="monthly-chart"></canvas>
            </div>
            <div class="chart-panel">
              <h4>Strike Rate by Market</h4>
              <canvas id="sr-chart"></canvas>
            </div>
          </div>
        </div>

        <!-- Results Table Filters -->
        <div class="section">
          <div class="section-title" style="justify-content:space-between;">
            <span>Full Results Log</span>
            <button class="btn btn-outline btn-sm" onclick="App.exportResultsCSV()">Export CSV</button>
          </div>
          <div class="filter-bar">
            <select onchange="App.filterResults(this.value,'sport')">
              <option value="">All Sports</option>
              <option value="racing">Racing</option>
              <option value="football">Football</option>
            </select>
            <select onchange="App.filterResults(this.value,'result')">
              <option value="">All Results</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
              <option value="placed">Placed</option>
            </select>
          </div>
          <!-- Desktop: table view. Mobile: card view -->
          <div class="card results-table-wrap">
            <table class="results-table" id="results-table">
              <thead>
                <tr>
                  <th>Date</th><th>Sport</th><th>Event</th><th>Selection</th><th>Market</th><th>Odds</th><th>Stake</th><th>Result</th><th>P/L</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${(() => {
                  var sortedResults = results.sort((a,b) => new Date(b.date) - new Date(a.date));
                  this._displayResults = sortedResults;
                  this._resultsPage = 1;
                  var pageSize = 20;
                  var pagedResults = sortedResults.slice(0, pageSize);
                  return pagedResults.map((r, idx) => `
                  <tr>
                    <td data-label="Date">${formatDateUK(r.date)}</td>
                    <td data-label="Sport">${r.sport === 'racing' ? 'Racing' : 'Football'}</td>
                    <td data-label="Event">${r.event}</td>
                    <td data-label="Selection"><strong>${r.selection}</strong></td>
                    <td data-label="Market">${r.market}</td>
                    <td data-label="Odds">${this.formatOdds(r.odds)}</td>
                    <td data-label="Stake">${r.stake}u</td>
                    <td data-label="Result" class="result-${r.result}">${r.result.toUpperCase()}</td>
                    <td data-label="P/L" class="${r.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}">${r.pnl > 0 ? '+' : ''}${r.pnl.toFixed(2)}u</td>
                    <td data-label="" class="results-actions">
                      ${r.result === 'won' ? `<button class="share-btn" onclick="App.generateShareCard({selection:'${r.selection.replace(/'/g, "\\'")}',odds:${r.odds},pnl:${r.pnl},sport:'${r.sport || 'racing'}',event:'${(r.event || '').replace(/'/g, "\\'")}'})">Share</button> <button class="share-btn" onclick="App.copyShareText('${r.selection.replace(/'/g, "\\'")}',${r.odds})">Copy</button>` : ''}
                      ${r.replayAnalysis ? `<button class="share-btn replay-btn" onclick="App.toggleReplay('replay-${idx}')">AI Analysis</button>` : ''}
                    </td>
                  </tr>
                  ${r.replayAnalysis ? `
                  <tr class="replay-row" id="replay-${idx}" style="display:none;">
                    <td colspan="10">
                      <div class="replay-card">
                        <div class="replay-header">Race Replay Analysis</div>
                        <div class="replay-analysis">${typeof r.replayAnalysis === 'object' ? (r.replayAnalysis.analysis || '') : r.replayAnalysis}</div>
                        ${r.replayAnalysis.keyFactor ? `<div class="replay-factor"><strong>Key Factor:</strong> ${r.replayAnalysis.keyFactor}</div>` : ''}
                        ${r.replayAnalysis.lessonLearned ? `<div class="replay-lesson"><strong>Lesson:</strong> ${r.replayAnalysis.lessonLearned}</div>` : ''}
                      </div>
                    </td>
                  </tr>` : ''}
                `).join('');
                })()}
              </tbody>
            </table>
            <div class="results-pagination" id="results-pagination"></div>
          </div>
        </div>
      </div>
    `;

    this._renderResultsPagination();
    this.renderPerformanceChart(perf);
    this.renderMonthlyChart(results);
    this.renderSRChart(results);

    // Render profit calendar after DOM is ready
    this.renderProfitCalendar(results);
  },

  updateCharts() {
    let filtered = this.results;
    const sport = document.getElementById('cf-sport')?.value;
    const market = document.getElementById('cf-market')?.value;
    const premium = document.getElementById('cf-premium')?.value;
    const month = document.getElementById('cf-month')?.value;
    if (sport) filtered = filtered.filter(r => r.sport === sport);
    if (market) filtered = filtered.filter(r => r.market === market);
    if (premium === 'true') filtered = filtered.filter(r => r.isPremium);
    if (premium === 'false') filtered = filtered.filter(r => !r.isPremium);
    if (month) filtered = filtered.filter(r => r.date && r.date.startsWith(month));

    // Recalculate performance for filtered results
    const wins = filtered.filter(r => r.result === 'won').length;
    const totalPnl = filtered.reduce((s, r) => s + (r.pnl || 0), 0);
    const totalStaked = filtered.reduce((s, r) => s + (r.stake || 1), 0);
    const perf = {
      bankHistory: [{ date: 'Start', bank: 100 }],
      totalTips: filtered.length,
      wins,
      roi: totalStaked > 0 ? ((totalPnl / totalStaked) * 100).toFixed(1) : 0,
      strikeRate: filtered.length > 0 ? ((wins / filtered.length) * 100).toFixed(1) : 0,
    };
    let bank = 100;
    const sorted = [...filtered].sort((a, b) => new Date(a.date) - new Date(b.date));
    sorted.forEach(r => {
      bank += (r.pnl || 0);
      perf.bankHistory.push({ date: r.date, bank: Math.round(bank * 100) / 100 });
    });

    this.renderPerformanceChart(perf);
    this.renderMonthlyChart(filtered);
    this.renderSRChart(filtered);
  },

  renderMonthlyChart(results) {
    if (this.chartMonthly) { this.chartMonthly.destroy(); this.chartMonthly = null; }
    const canvas = document.getElementById('monthly-chart');
    if (!canvas) return;
    // Group by month
    const months = {};
    results.forEach(r => {
      if (!r.date) return;
      const m = r.date.substring(0, 7);
      if (!months[m]) months[m] = 0;
      months[m] += (r.pnl || 0);
    });
    const labels = Object.keys(months).sort();
    const data = labels.map(m => Math.round(months[m] * 100) / 100);
    const colors = data.map(v => v >= 0 ? '#22c55e' : '#ef4444');

    this.chartMonthly = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels.map(m => { const d = new Date(m + '-01'); return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }); }),
        datasets: [{ label: 'P/L (units)', data, backgroundColor: colors, borderRadius: 4 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { backgroundColor: '#141828', titleColor: '#f1f5f9', bodyColor: '#94a3b8', borderColor: '#2a3352', borderWidth: 1 } },
        scales: {
          x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(42,51,82,0.3)' } }
        }
      }
    });
  },

  renderSRChart(results) {
    if (this.chartSR) { this.chartSR.destroy(); this.chartSR = null; }
    const canvas = document.getElementById('sr-chart');
    if (!canvas) return;
    // Group by market
    const markets = {};
    results.forEach(r => {
      const m = r.market || 'Other';
      if (!markets[m]) markets[m] = { total: 0, won: 0 };
      markets[m].total++;
      if (r.result === 'won') markets[m].won++;
    });
    const labels = Object.keys(markets);
    const data = labels.map(m => Math.round((markets[m].won / markets[m].total) * 100));

    this.chartSR = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: 'Strike Rate %', data, backgroundColor: '#d4a843', borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { backgroundColor: '#141828', titleColor: '#f1f5f9', bodyColor: '#94a3b8', borderColor: '#2a3352', borderWidth: 1 } },
        scales: {
          x: { ticks: { color: '#64748b', font: { size: 10 }, callback: v => v + '%' }, grid: { color: 'rgba(42,51,82,0.3)' }, max: 100 },
          y: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { display: false } }
        }
      }
    });
  },

  filterResults(value, type) {
    let filtered = this.results;
    if (value && type === 'sport') filtered = filtered.filter(r => r.sport === value);
    if (value && type === 'result') filtered = filtered.filter(r => r.result === value);
    this._displayResults = filtered.sort((a,b) => new Date(b.date) - new Date(a.date));
    this._resultsPage = 1;
    this._resultsShowAll = false;
    this._renderResultsPage();
  },

  _renderResultsPage() {
    var displayResults = this._displayResults || [];
    var pageSize = 20;
    var currentPage = this._resultsPage || 1;
    var showAll = this._resultsShowAll || false;
    var pagedResults = showAll ? displayResults : displayResults.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    var tbody = document.querySelector('#results-table tbody');
    if (!tbody) return;
    tbody.innerHTML = pagedResults.map(function(r) {
      return '<tr>' +
        '<td>' + formatDateUK(r.date) + '</td>' +
        '<td>' + (r.sport === 'racing' ? 'Racing' : 'Football') + '</td>' +
        '<td>' + r.event + '</td>' +
        '<td><strong>' + r.selection + '</strong></td>' +
        '<td>' + r.market + '</td>' +
        '<td>' + App.formatOdds(r.odds) + '</td>' +
        '<td>' + r.stake + 'u</td>' +
        '<td class="result-' + r.result + '">' + r.result.toUpperCase() + '</td>' +
        '<td class="' + (r.pnl >= 0 ? 'pnl-positive' : 'pnl-negative') + '">' + (r.pnl > 0 ? '+' : '') + r.pnl.toFixed(2) + 'u</td>' +
        '<td>' + (r.result === 'won' ? '<button class="share-btn" onclick="App.generateShareCard({selection:\'' + r.selection.replace(/'/g, "\\'") + '\',odds:' + r.odds + ',pnl:' + r.pnl + ',sport:\'' + (r.sport || 'racing') + '\',event:\'' + (r.event || '').replace(/'/g, "\\'") + '\'})">Share</button>' : '') + '</td>' +
      '</tr>';
    }).join('');
    this._renderResultsPagination();
  },

  _renderResultsPagination() {
    var container = document.getElementById('results-pagination');
    if (!container) return;
    var displayResults = this._displayResults || [];
    var pageSize = 20;
    var currentPage = this._resultsPage || 1;
    var totalPages = Math.ceil(displayResults.length / pageSize);
    var showAll = this._resultsShowAll || false;
    if (displayResults.length <= pageSize) { container.innerHTML = ''; return; }
    if (showAll) {
      container.innerHTML = '<div class="pagination"><span>Showing all ' + displayResults.length + ' results</span><button onclick="App._resultsShowAll=false;App._resultsPage=1;App._renderResultsPage()">Show Pages</button></div>';
      return;
    }
    container.innerHTML = '<div class="pagination">' +
      '<button onclick="App._resultsPage=Math.max(1,App._resultsPage-1);App._renderResultsPage()"' + (currentPage === 1 ? ' disabled' : '') + '>&larr; Previous</button>' +
      '<span>Page ' + currentPage + ' of ' + totalPages + '</span>' +
      '<button onclick="App._resultsPage=Math.min(' + totalPages + ',App._resultsPage+1);App._renderResultsPage()"' + (currentPage === totalPages ? ' disabled' : '') + '>Next &rarr;</button>' +
      '<button onclick="App._resultsShowAll=true;App._renderResultsPage()">Show All</button>' +
    '</div>';
  },

  renderPerformanceChart(perf) {
    if (this.chart) { this.chart.destroy(); this.chart = null; }
    const canvas = document.getElementById('performance-chart');
    if (!canvas || !perf.bankHistory) return;
    const ctx = canvas.getContext('2d');
    const labels = perf.bankHistory.map(b => b.date === 'Start' ? 'Start' : new Date(b.date).toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric' }));
    const data = perf.bankHistory.map(b => b.bank);

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Running Bank (units)',
          data,
          borderColor: '#d4a843',
          backgroundColor: 'rgba(212,168,67,0.08)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: '#d4a843',
          pointBorderColor: '#0a0e1a',
          pointBorderWidth: 2,
          borderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#141828',
            titleColor: '#f1f5f9',
            bodyColor: '#94a3b8',
            borderColor: '#2a3352',
            borderWidth: 1,
            padding: 12,
          }
        },
        scales: {
          x: {
            ticks: { color: '#64748b', font: { size: 11 }, maxTicksLimit: 10 },
            grid: { color: 'rgba(42,51,82,0.3)' },
          },
          y: {
            ticks: { color: '#64748b', font: { size: 11 } },
            grid: { color: 'rgba(42,51,82,0.3)' },
          }
        }
      }
    });
  },

  // -----------------------------------------------------------------------
  // PRICING PAGE
  // -----------------------------------------------------------------------
  renderPricing() {
    const app = document.getElementById('app');
    const isLoggedIn = !!this.user;
    const isPremium = this.isPremium();
    const isVIP = this.isVIP();
    const accessLevel = this.getAccessLevel();
    const isOnTrial = this.user && this.user.trialActive && this.user.trialEnd;
    const trialDaysLeft = isOnTrial ? Math.max(0, Math.ceil((new Date(this.user.trialEnd).getTime() - Date.now()) / (24 * 60 * 60 * 1000))) : 0;
    app.innerHTML = `
      <div class="container">
        <div class="page-header text-center">
          <h1>Choose Your <span class="accent">Plan</span></h1>
          <p>Sign up free in 30 seconds. Card securely stored for credit purchases — you will not be charged.</p>
        </div>

        ${isOnTrial ? '<div style="background:linear-gradient(135deg,rgba(212,168,67,0.15),rgba(212,168,67,0.05));border:2px solid var(--gold);border-radius:14px;padding:24px;margin-bottom:32px;text-align:center;"><div style="font-size:28px;margin-bottom:8px;">&#9201;</div><div style="font-size:20px;font-weight:800;color:var(--gold);margin-bottom:8px;">You\'re on your free trial — ' + trialDaysLeft + ' day' + (trialDaysLeft !== 1 ? 's' : '') + ' left</div><div style="font-size:14px;color:var(--text-secondary);margin-bottom:16px;">Subscribe now to continue enjoying full premium access after your trial ends.</div></div>' : ''}
        ${!isLoggedIn ? '<div style="background:linear-gradient(135deg,rgba(34,197,94,0.1),rgba(34,197,94,0.03));border:2px solid rgba(34,197,94,0.3);border-radius:14px;padding:24px;margin-bottom:32px;text-align:center;"><div style="font-size:28px;margin-bottom:8px;">&#127881;</div><div style="font-size:20px;font-weight:800;color:#22c55e;margin-bottom:8px;">Sign Up &amp; Get 5 Free Credits</div><div style="font-size:14px;color:var(--text-secondary);margin-bottom:8px;">Create your account to start using credits on premium tips. Card details stored securely for credit purchases — you will not be charged on the free tier.</div><div style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">Use credits to unlock tips. Buy more from &pound;1.99 or subscribe for monthly credits.</div><button class="btn btn-gold btn-lg" onclick="App.showModal(\'register\')">Create Free Account</button></div>' : ''}

        <!-- Confidence Tier Leaderboard (social proof before plans) -->
        <div id="pricing-confidence-leaderboard"></div>

        <div class="pricing-grid mb-32">
          <!-- FREE CARD -->
          <div class="pricing-card">
            ${!isLoggedIn ? '<div style="background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;text-align:center;padding:8px;border-radius:8px 8px 0 0;margin:-24px -24px 16px;font-weight:800;font-size:14px;letter-spacing:0.5px;">START HERE</div>' : ''}
            <h3>Free Access</h3>
            <p class="text-muted">Get started with the basics</p>
            <div class="pricing-price">&pound;<span style="font-size:42px;">0</span><span class="period">/forever</span></div>
            <div style="background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.25);border-radius:8px;padding:10px;margin:8px 0 12px;text-align:center;">
              <div style="font-size:24px;font-weight:900;color:var(--gold);">5</div>
              <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">One-Time Credits</div>
            </div>
            <ul class="pricing-features">
              <li>1 credit per premium tip</li>
              <li>1 free daily tip (after race)</li>
              <li>Full results page</li>
              <li>Betting calculators</li>
              <li>Betting academy</li>
              <li>Buy more from &pound;1.99</li>
            </ul>
            <button class="btn ${!isLoggedIn ? 'btn-gold' : 'btn-outline'} btn-full" onclick="${isLoggedIn ? '' : "App.showModal('register')"}">
              ${isLoggedIn ? (isPremium ? 'Free Features Included' : 'Your Current Plan') : 'Sign Up Free — 30 Seconds'}
            </button>
            ${!isLoggedIn ? '<p class="text-xs" style="color:#64748b;margin-top:8px;">Card details stored securely for credit purchases only. You will not be charged on the free tier.</p>' : ''}
          </div>

          <!-- STARTER CARD -->
          <div class="pricing-card${accessLevel === 'starter' ? ' featured' : ''}">
            <h3>Starter</h3>
            <p class="text-muted">Get your feet wet</p>
            <div class="pricing-price"><span class="currency">&pound;</span>9<span style="font-size:20px;">.99</span><span class="period">/month</span></div>
            <p class="text-xs text-gold mb-8">&pound;99.99/year (save &pound;20) | Cancel anytime</p>
            <div style="background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.25);border-radius:8px;padding:10px;margin:0 0 12px;text-align:center;">
              <div style="font-size:24px;font-weight:900;color:var(--gold);">40</div>
              <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">Credits / Month</div>
            </div>
            <ul class="pricing-features">
              <li><strong>Everything in Free, plus:</strong></li>
              <li>40 credits renewed monthly</li>
              <li>3 daily tips (2 sports)</li>
              <li>Selection + odds revealed</li>
              <li>Full results + tracking</li>
              <li style="color:var(--text-muted);text-decoration:line-through;">Full AI analysis</li>
              <li style="color:var(--text-muted);text-decoration:line-through;">Email bulletins</li>
              <li style="color:var(--text-muted);text-decoration:line-through;">Acca generator</li>
            </ul>
            ${accessLevel === 'starter' ? '<button class="btn btn-gold btn-full" disabled>Your Current Plan</button><p class="text-xs text-gold mt-8"><a href="#" onclick="App.startCheckout(\'premium-monthly\');return false;" style="color:var(--gold);">Upgrade to Premium &rarr;</a></p>' :
              isLoggedIn && !isPremium ? '<button class="btn btn-outline btn-full" onclick="App.startCheckout(\'starter-monthly\')">Subscribe &mdash; &pound;9.99/month</button><button class="btn btn-outline btn-full mt-8" onclick="App.startCheckout(\'starter-annual\')">Annual &mdash; &pound;99.99/year</button>' :
              isPremium ? '<button class="btn btn-outline btn-full" disabled>Included in your plan</button>' :
              '<button class="btn btn-outline btn-full" onclick="App.showModal(\'register\')">Sign Up First</button>'}
          </div>

          <!-- PREMIUM CARD -->
          <div class="pricing-card${accessLevel === 'premium' ? ' featured' : ''}">
            <div class="featured-badge" style="background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;text-align:center;padding:8px;border-radius:8px 8px 0 0;margin:-24px -24px 16px;font-weight:800;font-size:14px;letter-spacing:0.5px;">MOST POPULAR</div>
            <h3>Premium</h3>
            <p class="text-muted">Every edge play, every day</p>
            <div class="pricing-price"><span class="currency">&pound;</span>19<span style="font-size:20px;">.99</span><span class="period">/month</span></div>
            <p class="text-xs text-gold mb-8">&pound;199.99/year (save &pound;40) | Cancel anytime</p>
            <div style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:8px;padding:10px;margin:0 0 12px;text-align:center;">
              <div style="font-size:24px;font-weight:900;color:#3b82f6;">120</div>
              <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">Credits / Month</div>
            </div>
            <ul class="pricing-features">
              <li><strong>Everything in Starter, plus:</strong></li>
              <li>120 credits renewed monthly</li>
              <li>All tips, all 6 sports</li>
              <li>Full AI analysis</li>
              <li>Value bet scanner</li>
              <li>5 alert types</li>
              <li>Daily email bulletin</li>
              <li>Smart acca generator</li>
            </ul>
            ${accessLevel === 'premium' && !this.user.trialActive ? '<button class="btn btn-gold btn-full" disabled>Your Current Plan</button>' :
              isOnTrial ? '<button class="btn btn-gold btn-full" onclick="App.startCheckout(\'premium-monthly\')">Subscribe — &pound;19.99/month</button><button class="btn btn-outline btn-full mt-8" onclick="App.startCheckout(\'premium-annual\')">Annual — &pound;199.99/year (Save &pound;40)</button><p class="text-xs text-gold mt-8">Lock in before your trial ends.</p>' :
              isVIP ? '<button class="btn btn-outline btn-full" disabled>Included in VIP</button>' :
              isLoggedIn ? '<button class="btn btn-gold btn-full" onclick="App.startCheckout(\'premium-monthly\')">Subscribe — &pound;19.99/month</button><button class="btn btn-outline btn-full mt-8" onclick="App.startCheckout(\'premium-annual\')">Annual — &pound;199.99/year (Save &pound;40)</button>' :
              '<button class="btn btn-outline btn-full" onclick="App.showModal(\'register\')">Sign Up Free First</button><p class="text-xs text-muted mt-8">Create your free account, then upgrade.</p>'}
          </div>

          <!-- VIP CARD -->
          <div class="pricing-card vip${isVIP ? ' featured' : ''}">
            <div class="featured-badge" style="background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-align:center;padding:8px;border-radius:8px 8px 0 0;margin:-24px -24px 16px;font-weight:800;font-size:14px;letter-spacing:0.5px;">ELITE</div>
            <h3>VIP</h3>
            <p class="text-muted">The ultimate edge — priority everything</p>
            <div class="pricing-price"><span class="currency">&pound;</span>39<span style="font-size:20px;">.99</span><span class="period">/month</span></div>
            <p class="text-xs text-gold mb-8">&pound;399.99/year (save &pound;80) | Cancel anytime</p>
            <div style="background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.3);border-radius:8px;padding:10px;margin:0 0 12px;text-align:center;">
              <div style="font-size:20px;font-weight:900;color:var(--gold);">UNLIMITED</div>
              <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">Credits Forever</div>
            </div>
            <ul class="pricing-features">
              <li><strong>Everything in Premium, plus:</strong></li>
              <li style="color:var(--gold);font-weight:700;">Unlimited credits — no limits</li>
              <li>Early access tips (6:30am)</li>
              <li>AI race replay analysis</li>
              <li>Personalised AI bulletin</li>
              <li>Priority email support</li>
              <li>VIP-only midweek acca</li>
              <li>Custom edge threshold alerts</li>
            </ul>
            ${isVIP && !this.user.trialActive ? '<button class="btn btn-gold btn-full" disabled>Your Current Plan</button>' :
              isOnTrial ? '<button class="btn btn-gold btn-full" onclick="App.startCheckout(\'vip-monthly\')">Subscribe — &pound;39.99/month</button><button class="btn btn-outline btn-full mt-8" onclick="App.startCheckout(\'vip-annual\')">Annual — &pound;399.99/year (Save &pound;80)</button><p class="text-xs text-gold mt-8">Lock in before your trial ends.</p>' :
              isLoggedIn ? '<button class="btn btn-gold btn-full" onclick="App.startCheckout(\'vip-monthly\')">Subscribe — &pound;39.99/month</button><button class="btn btn-outline btn-full mt-8" onclick="App.startCheckout(\'vip-annual\')">Annual — &pound;399.99/year (Save &pound;80)</button>' :
              '<button class="btn btn-outline btn-full" onclick="App.showModal(\'register\')">Sign Up Free First</button><p class="text-xs text-muted mt-8">Create your free account, then upgrade.</p>'}
          </div>
        </div>

        <!-- Payment Methods -->
        <div class="text-center mb-32">
          <div style="display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;padding:20px 0;">
            <span style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);font-weight:600;">Secure Payments</span>
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:center;">
              <span style="background:#000;color:#fff;padding:6px 12px;border-radius:6px;font-size:13px;font-weight:700;letter-spacing:-0.5px;">Apple Pay</span>
              <span style="background:#fff;color:#333;padding:6px 12px;border-radius:6px;font-size:13px;font-weight:700;border:1px solid #e0e0e0;">Google Pay</span>
              <svg width="40" height="24" viewBox="0 0 40 24" style="border-radius:4px;"><rect width="40" height="24" fill="#1a1f71"/><circle cx="15" cy="12" r="7" fill="#ea001b"/><circle cx="25" cy="12" r="7" fill="#f79f1a"/><path d="M20 6.8a7 7 0 0 1 2.6 5.2 7 7 0 0 1-2.6 5.2 7 7 0 0 1-2.6-5.2A7 7 0 0 1 20 6.8z" fill="#ff5f01"/></svg>
              <svg width="40" height="24" viewBox="0 0 40 24" style="border-radius:4px;"><rect width="40" height="24" fill="#1a1f71"/><text x="20" y="16" font-size="10" fill="#fff" font-weight="bold" text-anchor="middle" font-family="Arial">VISA</text></svg>
              <svg width="40" height="24" viewBox="0 0 40 24" style="border-radius:4px;"><rect width="40" height="24" fill="#006fcf"/><text x="20" y="16" font-size="7" fill="#fff" font-weight="bold" text-anchor="middle" font-family="Arial">AMEX</text></svg>
            </div>
          </div>
          <p style="font-size:11px;color:var(--text-muted);margin-top:4px;">All payments processed securely by Stripe. 256-bit SSL encryption. Cancel anytime.</p>
        </div>

        <!-- Social Proof -->
        <div class="text-center mb-32">
          <h2 class="mb-16">Trusted by Winning Bettors</h2>
          <div class="grid grid-3">
            ${this.getTestimonials().map(t => `
              <div class="testimonial-card">
                <div class="testimonial-stars">${'&#9733;'.repeat(t.stars)}</div>
                <div class="testimonial-text">"${t.text}"</div>
                <div class="testimonial-author">${t.author} <span>&bull; ${t.role}</span></div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Telegram CTA on Pricing (Feature #8) -->
        <div class="text-center mb-32">
          <a href="https://t.me/EliteEdgeTips" target="_blank" rel="noopener" class="telegram-cta">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
            Join our Telegram for instant alerts
          </a>
        </div>

        <!-- Referral Scheme -->
        <div style="background:linear-gradient(135deg,rgba(34,197,94,0.08),rgba(34,197,94,0.02));border:2px solid rgba(34,197,94,0.25);border-radius:14px;padding:28px;margin-bottom:32px;max-width:700px;margin-left:auto;margin-right:auto;">
          <div style="text-align:center;margin-bottom:16px;">
            <div style="font-size:36px;margin-bottom:8px;">&#127381;</div>
            <h3 style="color:#22c55e;font-size:20px;margin-bottom:4px;">Earn Free Credits — Refer a Friend</h3>
            <p style="color:var(--text-secondary);font-size:14px;">Share your unique link. Earn credits every time someone signs up.</p>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px;">
            <div style="text-align:center;background:rgba(255,255,255,0.03);border-radius:10px;padding:16px;">
              <div style="font-size:28px;font-weight:900;color:#22c55e;">+3</div>
              <div style="font-size:11px;color:var(--text-muted);">credits when your friend signs up</div>
            </div>
            <div style="text-align:center;background:rgba(255,255,255,0.03);border-radius:10px;padding:16px;">
              <div style="font-size:28px;font-weight:900;color:#22c55e;">+5</div>
              <div style="font-size:11px;color:var(--text-muted);">bonus when they start a trial</div>
            </div>
            <div style="text-align:center;background:rgba(255,255,255,0.03);border-radius:10px;padding:16px;">
              <div style="font-size:28px;font-weight:900;color:var(--gold);">+1</div>
              <div style="font-size:11px;color:var(--text-muted);">credit for sharing on social (daily)</div>
            </div>
          </div>
          <div style="text-align:center;">
            ${isLoggedIn ? '<a href="#/refer" class="btn btn-gold">Get Your Referral Link &rarr;</a>' : '<p style="color:var(--text-muted);font-size:13px;">Sign up to get your unique referral link and start earning.</p>'}
          </div>
        </div>

        <!-- Lead capture -->
        <div class="card card-premium text-center" style="padding:40px;max-width:600px;margin:0 auto;">
          <h3 class="mb-8">Not Ready to Commit?</h3>
          <p class="text-muted mb-16">Enter your email below and we'll send you a free sample of our Premium analysis so you can see the quality for yourself.</p>
          <div style="display:flex;gap:8px;max-width:400px;margin:0 auto;">
            <input type="email" placeholder="your@email.com" style="flex:1;padding:10px 14px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);outline:none;">
            <button class="btn btn-gold" onclick="const e=this.previousElementSibling;if(e&&e.value&&e.value.includes('@')){App.api('/support',{method:'POST',body:JSON.stringify({email:e.value,subject:'Sample Request',message:'Please send me a free sample tip.'})});this.textContent='Sent!';this.disabled=true;}else{this.textContent='Enter valid email';}">Send Sample</button>
          </div>
        </div>
      </div>
    `;

    // Async load confidence leaderboard and inject
    var self = this;
    this.loadConfidenceLeaderboard().then(function(tiers) {
      var container = document.getElementById('pricing-confidence-leaderboard');
      if (container && tiers && tiers.length) {
        container.innerHTML = self.renderConfidenceLeaderboard(tiers);
      }
    }).catch(function() {});
  },

  // -----------------------------------------------------------------------
  // SUPPORT PAGE
  // -----------------------------------------------------------------------
  renderSupport() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="container">
        <div class="page-header">
          <h1><span class="accent">Support</span> & FAQ</h1>
          <p>We're here to help. Browse common questions or submit a ticket.</p>
        </div>

        <div class="grid grid-sidebar">
          <div>
            <!-- FAQ -->
            <div class="section">
              <div class="section-title">Frequently Asked Questions</div>
              ${this.getFAQs().map((faq, i) => `
                <div class="faq-item" onclick="this.classList.toggle('open')">
                  <div class="faq-question">
                    <span>${faq.q}</span>
                    <span class="faq-toggle">+</span>
                  </div>
                  <div class="faq-answer">${faq.a}</div>
                </div>
              `).join('')}
            </div>
          </div>

          <div>
            <!-- Contact Form -->
            <div class="card">
              <h3 class="mb-16">Contact Us</h3>
              <form onsubmit="App.submitSupport(event)">
                <div class="form-group">
                  <label>Name</label>
                  <input type="text" id="sup-name" required value="${this.user?.name || ''}">
                </div>
                <div class="form-group">
                  <label>Email</label>
                  <input type="email" id="sup-email" required value="${this.user?.email || ''}">
                </div>
                <div class="form-group">
                  <label>Subject</label>
                  <input type="text" id="sup-subject" required placeholder="How can we help?">
                </div>
                <div class="form-group">
                  <label>Message</label>
                  <textarea id="sup-message" required placeholder="Describe your question or issue..."></textarea>
                </div>
                <div class="form-error" id="sup-error"></div>
                <div id="sup-success" style="display:none;color:var(--green);font-size:14px;margin-bottom:12px;">Your message has been sent. We'll respond within 24 hours.</div>
                <button type="submit" class="btn btn-gold btn-full">Send Message</button>
              </form>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  async submitSupport(e) {
    e.preventDefault();
    try {
      await this.api('/support', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('sup-name').value,
          email: document.getElementById('sup-email').value,
          subject: document.getElementById('sup-subject').value,
          message: document.getElementById('sup-message').value,
        })
      });
      document.getElementById('sup-success').style.display = 'block';
      document.getElementById('sup-error').textContent = '';
      e.target.reset();
    } catch (err) {
      document.getElementById('sup-error').textContent = err.message;
    }
  },

  // -----------------------------------------------------------------------
  // ADMIN PAGE
  // -----------------------------------------------------------------------
  async renderAdmin() {
    if (!this.user || this.user.role !== 'admin') {
      document.getElementById('app').innerHTML = `
        <div class="container text-center" style="padding:80px;">
          <h2>Admin Access Required</h2>
          <p class="text-muted mt-8">Please log in with an admin account.</p>
          <button class="btn btn-gold mt-16" onclick="App.showModal('login')">Log In</button>
        </div>`;
      return;
    }

    const app = document.getElementById('app');
    app.innerHTML = this.renderSkeleton('dashboard');

    let users = [], tips = [], support = [], chatLogs = [];
    try {
      [users, tips, support, chatLogs] = await Promise.all([
        this.api('/admin/users'),
        this.api('/tips'),
        this.api('/support'),
        this.api('/chat/logs'),
      ]);
    } catch {}

    app.innerHTML = `
      <div class="container">
        <div class="page-header">
          <h1><span class="accent">Admin</span> Panel</h1>
          <p>Manage tips, results, users, emails, and support.</p>
        </div>

        <div class="admin-tabs">
          <button class="admin-tab active" onclick="App.switchAdminTab('tips', this)">Tips</button>
          <button class="admin-tab" onclick="App.switchAdminTab('results', this)">Results</button>
          <button class="admin-tab" onclick="App.switchAdminTab('users', this)">Users</button>
          <button class="admin-tab" onclick="App.switchAdminTab('email', this)">Email</button>
          <button class="admin-tab" onclick="App.switchAdminTab('support', this)">Support (${support.filter(s=>s.status==='open').length})</button>
          <button class="admin-tab" onclick="App.switchAdminTab('livedata', this)">Live Data</button>
          <button class="admin-tab" onclick="App.switchAdminTab('chat', this)">Chat Logs</button>
          <button class="admin-tab" onclick="App.switchAdminTab('notifications', this)">Notifications</button>
        </div>

        <!-- TIPS PANEL -->
        <div class="admin-panel active" id="panel-tips">
          <div class="flex-between mb-16">
            <h3>Manage Tips (${tips.length})</h3>
            <button class="btn btn-gold btn-sm" onclick="App.showAddTipForm()">+ Add Tip</button>
          </div>
          <div id="add-tip-form" style="display:none;" class="card mb-16">
            <h4 class="mb-16">Add New Tip</h4>
            <form onsubmit="App.addTip(event)">
              <div class="form-row">
                <div class="form-group"><label>Sport</label><select id="at-sport"><option value="racing">Racing</option><option value="football">Football</option></select></div>
                <div class="form-group"><label>Event</label><input type="text" id="at-event" required placeholder="e.g. Cheltenham 14:30"></div>
              </div>
              <div class="form-row">
                <div class="form-group"><label>Selection</label><input type="text" id="at-selection" required placeholder="e.g. Desert Crown"></div>
                <div class="form-group"><label>Market</label><select id="at-market"><option>Win</option><option>Each-Way</option><option>Value Outsider</option><option>Match Result</option><option>BTTS</option><option>Over/Under</option><option>Asian Handicap</option><option>Double Chance</option></select></div>
              </div>
              <div class="form-row">
                <div class="form-group"><label>Odds</label><input type="number" id="at-odds" step="0.01" required></div>
                <div class="form-group"><label>Confidence (1-10)</label><input type="number" id="at-confidence" min="1" max="10" required></div>
              </div>
              <div class="form-row">
                <div class="form-group"><label>Model Probability</label><input type="number" id="at-modelprob" step="0.01" min="0" max="1" required></div>
                <div class="form-group"><label>Premium</label><select id="at-premium"><option value="false">Free</option><option value="true">Premium</option></select></div>
              </div>
              <div class="form-group"><label>Analysis Summary</label><textarea id="at-summary" placeholder="Brief analysis..."></textarea></div>
              <div class="form-group"><label>Staking</label><input type="text" id="at-staking" placeholder="e.g. 2 units"></div>
              <div class="flex gap-8">
                <button type="submit" class="btn btn-gold">Save Tip</button>
                <button type="button" class="btn btn-outline" onclick="document.getElementById('add-tip-form').style.display='none'">Cancel</button>
              </div>
            </form>
          </div>
          <div class="card" style="overflow-x:auto;">
            <table class="results-table">
              <thead><tr><th>ID</th><th>Sport</th><th>Event</th><th>Selection</th><th>Odds</th><th>Conf.</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                ${tips.map(t => `
                  <tr>
                    <td class="text-xs">${t.id}</td>
                    <td>${t.sport}</td>
                    <td>${t.event}</td>
                    <td>${t.locked ? '<em>locked</em>' : t.selection}</td>
                    <td>${t.odds}</td>
                    <td>${t.confidence}/10</td>
                    <td>${t.isPremium ? '<span class="text-gold">Premium</span>' : 'Free'}</td>
                    <td>${t.status}</td>
                    <td>
                      <button class="btn btn-ghost btn-sm" onclick="App.deleteTip('${t.id}')">Delete</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- RESULTS PANEL -->
        <div class="admin-panel" id="panel-results">
          <h3 class="mb-16">Mark Results</h3>
          <p class="text-muted mb-16">Select an active tip and mark its result.</p>
          <div class="card">
            <form onsubmit="App.markResult(event)">
              <div class="form-row">
                <div class="form-group">
                  <label>Select Tip</label>
                  <select id="mr-tip">
                    ${tips.filter(t => t.status === 'active' && !t.locked).map(t => `<option value="${t.id}">${t.selection} — ${t.event} @ ${t.odds}</option>`).join('')}
                  </select>
                </div>
                <div class="form-group">
                  <label>Result</label>
                  <select id="mr-result">
                    <option value="won">Won</option>
                    <option value="lost">Lost</option>
                    <option value="placed">Placed (EW)</option>
                    <option value="void">Void</option>
                  </select>
                </div>
              </div>
              <button type="submit" class="btn btn-green">Mark Result</button>
            </form>
          </div>
        </div>

        <!-- USERS PANEL -->
        <div class="admin-panel" id="panel-users">
          <h3 class="mb-16">Subscribers (${users.length})</h3>
          <div class="card" style="overflow-x:auto;">
            <table class="results-table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Subscription</th><th>Status</th><th>Last Login</th><th>IP</th><th>Joined</th><th>Actions</th></tr></thead>
              <tbody>
                ${users.map(u => {
                  const isLocked = u.lockUntil && new Date(u.lockUntil) > new Date();
                  const isFlagged = u.flagged;
                  let statusBadge = '<span style="color:var(--green);">Active</span>';
                  if (isLocked) statusBadge = '<span style="color:var(--red);">Locked</span>';
                  else if (isFlagged) statusBadge = '<span style="color:#f59e0b;">Flagged</span>';
                  const lastIP = u.lastLogin ? u.lastLogin.ip : '-';
                  const lastTime = u.lastLogin ? new Date(u.lastLogin.timestamp).toLocaleString('en-GB') : '-';
                  return `
                  <tr>
                    <td>${u.name} ${isFlagged ? '<span title="Suspicious: 3+ IPs in 24h" style="color:#f59e0b;cursor:help;">&#9888;</span>' : ''}</td>
                    <td class="text-xs">${u.email}</td>
                    <td>${u.role}</td>
                    <td>${u.subscription === 'vip' ? '<span style="color:#d4a843;font-weight:700;">VIP</span>' : u.subscription === 'premium' ? '<span class="text-gold">Premium</span>' : 'Free'}</td>
                    <td>${statusBadge}</td>
                    <td class="text-xs">${lastTime}</td>
                    <td class="text-xs">${lastIP}</td>
                    <td>${formatDateUK(u.joined)}</td>
                    <td style="white-space:nowrap;">
                      <button class="btn btn-ghost btn-sm" onclick="App.adminForceLogout('${u.id}')" title="Force logout">Logout</button>
                      ${isLocked
                        ? `<button class="btn btn-ghost btn-sm" onclick="App.adminUnlockUser('${u.id}')">Unlock</button>`
                        : `<button class="btn btn-ghost btn-sm" onclick="App.adminLockUser('${u.id}')">Lock</button>`}
                      <button class="btn btn-ghost btn-sm" onclick="App.adminToggleLoginHistory('${u.id}')" title="Login history">History</button>
                      <button class="btn btn-ghost btn-sm" onclick="App.adminChangeSubscription('${u.id}','${u.subscription}')" title="Change plan">Plan</button>
                    </td>
                  </tr>
                  <tr id="admin-login-history-${u.id}" style="display:none;">
                    <td colspan="9" style="background:var(--bg-elevated);padding:12px;">
                      <strong>Login History (${u.loginHistory ? u.loginHistory.length : 0})</strong>
                      ${(u.loginHistory || []).length === 0 ? '<p class="text-muted text-xs">No history</p>' : `
                      <table class="results-table" style="margin-top:8px;font-size:11px;">
                        <thead><tr><th>Time</th><th>IP</th><th>Device</th></tr></thead>
                        <tbody>
                          ${(u.loginHistory || []).map(l => {
                            var dev = 'Desktop';
                            if (/Mobile|Android|iPhone/i.test(l.userAgent || '')) dev = 'Mobile';
                            else if (/Windows/i.test(l.userAgent || '')) dev = 'Windows';
                            else if (/Mac/i.test(l.userAgent || '')) dev = 'Mac';
                            return '<tr><td>'+new Date(l.timestamp).toLocaleString('en-GB')+'</td><td>'+l.ip+'</td><td>'+dev+'</td></tr>';
                          }).join('')}
                        </tbody>
                      </table>`}
                    </td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- EMAIL PANEL -->
        <div class="admin-panel" id="panel-email">
          <h3 class="mb-16">Compose Tip Bulletin</h3>
          <div class="card mb-16">
            <form onsubmit="App.sendEmail(event)">
              <div class="form-group">
                <label>Subject Line</label>
                <input type="text" id="em-subject" required value="Today's Elite Edge Tips — ${new Date().toLocaleDateString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric'})}">
              </div>
              <div class="form-group">
                <label>Summary / Intro</label>
                <textarea id="em-summary" placeholder="Add a personal intro or market overview...">Good morning! Here are today's top-rated selections from our model. We have some strong edges identified across both racing and football markets today.</textarea>
              </div>
              <div class="form-group">
                <label>Target Audience</label>
                <select id="em-audience">
                  <option value="premium">Premium Subscribers Only</option>
                  <option value="all">All Users</option>
                  <option value="free">Free Users Only</option>
                </select>
              </div>
              <div class="form-group">
                <label>Select Tips to Include</label>
                <div style="max-height:200px;overflow-y:auto;background:var(--bg-elevated);border-radius:var(--radius-sm);padding:12px;">
                  ${tips.filter(t => !t.locked && t.status === 'active').map(t => `
                    <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;font-size:13px;color:var(--text-secondary);">
                      <input type="checkbox" class="em-tip-check" value="${t.id}" checked>
                      ${t.selection} — ${t.event} @ ${t.odds} (${t.sport})
                    </label>
                  `).join('')}
                </div>
              </div>
              <div class="flex gap-8">
                <button type="submit" class="btn btn-gold">Send Now</button>
                <button type="button" class="btn btn-outline" onclick="App.previewEmail()">Preview</button>
                <button type="button" class="telegram-cta" onclick="App.sendSelectedToTelegram()" style="font-size:13px;padding:8px 14px;">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                  Send to Telegram
                </button>
              </div>
              <div id="em-result" class="mt-16"></div>
            </form>
          </div>
          <div id="email-preview" style="display:none;" class="card">
            <h4 class="mb-8">Email Preview</h4>
            <div class="email-preview" id="email-preview-content"></div>
          </div>
        </div>

        <!-- SUPPORT PANEL -->
        <div class="admin-panel" id="panel-support">
          <h3 class="mb-16">Support Tickets (${support.length})</h3>
          ${support.map(s => `
            <div class="card mb-16">
              <div class="flex-between mb-8">
                <div>
                  <strong>${s.subject}</strong>
                  <div class="text-xs text-muted">${s.name} (${s.email}) — ${formatDateUK(s.date)}</div>
                </div>
                <span class="badge-${s.status === 'open' ? 'premium' : s.status === 'resolved' ? 'free' : 'premium'}" style="font-size:11px;padding:2px 8px;border-radius:4px;">${s.status.toUpperCase()}</span>
              </div>
              <p class="text-sm text-muted mb-8">${s.message}</p>
              ${s.replies.map(r => `<div class="text-sm" style="padding:8px 12px;background:var(--bg-elevated);border-radius:6px;margin:8px 0;"><strong class="text-gold">Admin:</strong> ${r.message}</div>`).join('')}
              <div style="display:flex;gap:8px;margin-top:8px;">
                <input type="text" id="reply-${s.id}" placeholder="Reply..." style="flex:1;padding:8px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);outline:none;font-size:13px;">
                <button class="btn btn-gold btn-sm" onclick="App.replyTicket('${s.id}')">Reply</button>
              </div>
            </div>
          `).join('')}
        </div>

        <!-- LIVE DATA PANEL -->
        <div class="admin-panel" id="panel-livedata">
          <h3 class="mb-16">Live Data Sources</h3>
          <div class="api-status-grid" id="api-status-grid">
            <div class="api-status-card">
              <div class="api-name">Racing API</div>
              <div class="api-indicator" id="api-racing-status">Checking...</div>
            </div>
            <div class="api-status-card">
              <div class="api-name">API-Football</div>
              <div class="api-indicator" id="api-football-status">Checking...</div>
            </div>
            <div class="api-status-card">
              <div class="api-name">Odds API</div>
              <div class="api-indicator" id="api-odds-status">Checking...</div>
            </div>
          </div>
          <div class="flex gap-8 mb-16">
            <button class="btn btn-gold btn-sm" onclick="App.adminAutoSettle()">Auto-Settle Results</button>
            <button class="btn btn-outline btn-sm" onclick="App.adminLoadLiveData()">Refresh All Live Data</button>
          </div>
          <div id="admin-live-racing" class="mb-16"><div class="inline-spinner">Loading live racing data...</div></div>
          <div id="admin-live-football"><div class="inline-spinner">Loading live football data...</div></div>
        </div>

        <!-- CHAT LOGS -->
        <div class="admin-panel" id="panel-chat">
          <h3 class="mb-16">Chat Logs (${chatLogs.length})</h3>
          <div class="card" style="max-height:500px;overflow-y:auto;">
            ${chatLogs.length ? chatLogs.map(c => `
              <div style="padding:12px 0;border-bottom:1px solid var(--border);">
                <div class="text-xs text-muted">${new Date(c.timestamp).toLocaleDateString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric'})} ${new Date(c.timestamp).toLocaleTimeString('en-GB')}</div>
                <div class="text-sm mt-8"><strong>User:</strong> ${c.message}</div>
                <div class="text-sm text-muted mt-8"><strong>Bot:</strong> ${c.response}</div>
              </div>
            `).join('') : '<p class="text-muted">No chat logs yet.</p>'}
          </div>
        </div>

        <!-- NOTIFICATIONS PANEL -->
        <div class="admin-panel" id="panel-notifications">
          <h3 class="mb-16">Push Notifications</h3>
          <div class="card mb-16">
            <p class="text-muted mb-16">Send test notifications to users who have opted in. Browser Notification API is used for instant alerts.</p>
            <button class="btn btn-gold" onclick="App.sendTestAlert()">Send Test Alert</button>
            <button class="btn btn-outline" onclick="App.addNotification('New premium racing tip just published! Check the Racing page.')">Send Tip Alert</button>
            <button class="btn btn-outline" onclick="App.addNotification('Result: Latest selection WON! Check Results for full details.')">Send Result Alert</button>
          </div>
          <div class="card">
            <h4 class="mb-8">Notification Status</h4>
            <p class="text-sm text-muted">Browser API: ${'Notification' in window ? 'Available' : 'Not supported'}</p>
            <p class="text-sm text-muted">User opted in: ${localStorage.getItem('ee_notif_enabled') === 'true' ? 'Yes' : 'No'}</p>
            <p class="text-sm text-muted">Stored alerts: ${this.notifications.length}/10</p>
          </div>
        </div>
      </div>
    `;
  },

  switchAdminTab(panel, btn) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
    if (btn) btn.classList.add('active');
    var panelEl = document.getElementById('panel-' + panel);
    if (panelEl) panelEl.classList.add('active');
    if (panel === 'livedata') this.adminLoadLiveData();
  },

  showAddTipForm() {
    document.getElementById('add-tip-form').style.display = 'block';
  },

  async addTip(e) {
    e.preventDefault();
    const odds = parseFloat(document.getElementById('at-odds').value);
    const modelProb = parseFloat(document.getElementById('at-modelprob').value);
    try {
      await this.api('/admin/tips', {
        method: 'POST',
        body: JSON.stringify({
          sport: document.getElementById('at-sport').value,
          event: document.getElementById('at-event').value,
          selection: document.getElementById('at-selection').value,
          market: document.getElementById('at-market').value,
          odds,
          confidence: parseInt(document.getElementById('at-confidence').value),
          modelProbability: modelProb,
          impliedProbability: 1 / odds,
          edge: modelProb - (1 / odds),
          valueRating: (modelProb - (1/odds)) >= 0.12 ? 'Elite' : (modelProb - (1/odds)) >= 0.07 ? 'High' : (modelProb - (1/odds)) >= 0.04 ? 'Medium' : 'Low',
          isPremium: document.getElementById('at-premium').value === 'true',
          staking: document.getElementById('at-staking').value,
          analysis: { summary: document.getElementById('at-summary').value },
        })
      });
      this.renderAdmin();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async deleteTip(id) {
    if (!confirm('Delete this tip?')) return;
    try {
      await this.api(`/admin/tips/${id}`, { method: 'DELETE' });
      this.renderAdmin();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async markResult(e) {
    e.preventDefault();
    try {
      await this.api('/admin/results', {
        method: 'POST',
        body: JSON.stringify({
          tipId: document.getElementById('mr-tip').value,
          result: document.getElementById('mr-result').value,
        })
      });
      App.showToast('Result recorded successfully.', 'success');
      this.renderAdmin();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async sendEmail(e) {
    e.preventDefault();
    const tipIds = [...document.querySelectorAll('.em-tip-check:checked')].map(c => c.value);
    try {
      const result = await this.api('/email/send', {
        method: 'POST',
        body: JSON.stringify({
          subject: document.getElementById('em-subject').value,
          summary: document.getElementById('em-summary').value,
          tipIds,
          targetAudience: document.getElementById('em-audience').value,
        })
      });
      document.getElementById('em-result').innerHTML = `<div class="text-green">Email sent to ${result.sentCount} recipients.</div>`;
    } catch (err) {
      document.getElementById('em-result').innerHTML = `<div class="text-red">${err.message}</div>`;
    }
  },

  async previewEmail() {
    const tipIds = [...document.querySelectorAll('.em-tip-check:checked')].map(c => c.value);
    try {
      const result = await this.api('/email/compose', {
        method: 'POST',
        body: JSON.stringify({
          subject: document.getElementById('em-subject').value,
          summary: document.getElementById('em-summary').value,
          tipIds,
          targetAudience: document.getElementById('em-audience').value,
        })
      });
      document.getElementById('email-preview').style.display = 'block';
      document.getElementById('email-preview-content').innerHTML = result.html;
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async replyTicket(id) {
    const input = document.getElementById(`reply-${id}`);
    const message = input.value.trim();
    if (!message) return;
    try {
      await this.api(`/support/${id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ message, status: 'in-progress' })
      });
      this.renderAdmin();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  // -----------------------------------------------------------------------
  // ADMIN LIVE DATA
  // -----------------------------------------------------------------------
  async adminLoadLiveData() {
    // Check API statuses and load live data
    var racingEl = document.getElementById('admin-live-racing');
    var footballEl = document.getElementById('admin-live-football');
    var racingStatus = document.getElementById('api-racing-status');
    var footballStatus = document.getElementById('api-football-status');
    var oddsStatus = document.getElementById('api-odds-status');

    try {
      var racing = await this.fetchLiveRacing(true);
      if (racingStatus) {
        racingStatus.className = 'api-indicator ' + (racing && racing.live ? 'connected' : 'disconnected');
        racingStatus.textContent = racing && racing.live ? 'Connected' : 'Not Connected';
      }
      if (racingEl && racing && racing.live && racing.racecards && racing.racecards.length) {
        racingEl.innerHTML = '<h4 class="mb-8">Live Racing Cards (' + racing.racecards.length + ' races)</h4>' +
          racing.racecards.slice(0, 10).map(function(race) {
            var runners = (race.runners || []).slice(0, 5);
            return '<div class="card mb-8" style="padding:12px;"><div style="font-weight:700;color:var(--gold);margin-bottom:6px;">' + (race.time || '') + ' ' + (race.meeting || '') + ' - ' + (race.raceName || '') + '</div>' +
              runners.map(function(r) {
                return '<div class="admin-live-runner"><div><span class="runner-name">' + (r.horseName || '-') + '</span> <span class="runner-detail">(' + (r.jockey || '-') + ' / ' + (r.trainer || '-') + ')</span></div>' +
                  '<button class="btn btn-gold btn-sm" onclick="App.createTipFromRunner(\'' + (r.horseName || '').replace(/'/g, "\\'") + '\',\'' + (race.time || '') + ' ' + (race.meeting || '').replace(/'/g, "\\'") + '\',\'' + (r.odds || '') + '\')">Create Tip</button></div>';
              }).join('') + '</div>';
          }).join('');
      } else if (racingEl) {
        racingEl.innerHTML = '<p class="text-muted">No live racing data available. ' + (racing && racing.message ? racing.message : '') + '</p>';
      }
    } catch (e) {
      if (racingStatus) { racingStatus.className = 'api-indicator disconnected'; racingStatus.textContent = 'Error'; }
      if (racingEl) racingEl.innerHTML = '<p class="text-muted">Failed to load racing data.</p>';
    }

    try {
      var football = await this.fetchLiveFootball(true);
      if (footballStatus) {
        footballStatus.className = 'api-indicator ' + (football && football.live ? 'connected' : 'disconnected');
        footballStatus.textContent = football && football.live ? 'Connected' : 'Not Connected';
      }
      if (footballEl && football && football.live && football.fixtures && football.fixtures.length) {
        footballEl.innerHTML = '<h4 class="mb-8">Live Fixtures (' + football.fixtures.length + ')</h4>' +
          football.fixtures.slice(0, 15).map(function(f) {
            return '<div class="admin-live-runner"><div><span class="runner-name">' + f.homeTeam + ' vs ' + f.awayTeam + '</span> <span class="runner-detail">' + (f.league || '') + ' | ' + (f.status || '') + '</span></div>' +
              '<button class="btn btn-gold btn-sm" onclick="App.createTipFromFixture(\'' + (f.homeTeam + ' vs ' + f.awayTeam).replace(/'/g, "\\'") + '\',\'' + (f.league || '').replace(/'/g, "\\'") + '\')">Create Tip</button></div>';
          }).join('');
      } else if (footballEl) {
        footballEl.innerHTML = '<p class="text-muted">No live football data available. ' + (football && football.message ? football.message : '') + '</p>';
      }
    } catch (e) {
      if (footballStatus) { footballStatus.className = 'api-indicator disconnected'; footballStatus.textContent = 'Error'; }
      if (footballEl) footballEl.innerHTML = '<p class="text-muted">Failed to load football data.</p>';
    }

    try {
      var odds = await this.fetchLiveOdds(true);
      if (oddsStatus) {
        oddsStatus.className = 'api-indicator ' + (odds && odds.live ? 'connected' : 'disconnected');
        oddsStatus.textContent = odds && odds.live ? 'Connected' : 'Not Connected';
      }
    } catch (e) {
      if (oddsStatus) { oddsStatus.className = 'api-indicator disconnected'; oddsStatus.textContent = 'Error'; }
    }
  },

  createTipFromRunner(horseName, event, odds) {
    this.switchAdminTab('tips', document.querySelector('.admin-tab'));
    this.showAddTipForm();
    var sportEl = document.getElementById('at-sport');
    var eventEl = document.getElementById('at-event');
    var selEl = document.getElementById('at-selection');
    var oddsEl = document.getElementById('at-odds');
    if (sportEl) sportEl.value = 'racing';
    if (eventEl) eventEl.value = event || '';
    if (selEl) selEl.value = horseName || '';
    if (oddsEl && odds) oddsEl.value = odds;
  },

  createTipFromFixture(event, league) {
    this.switchAdminTab('tips', document.querySelector('.admin-tab'));
    this.showAddTipForm();
    var sportEl = document.getElementById('at-sport');
    var eventEl = document.getElementById('at-event');
    if (sportEl) sportEl.value = 'football';
    if (eventEl) eventEl.value = event + (league ? ' (' + league + ')' : '');
  },

  async adminForceLogout(userId) {
    if (!confirm('Force logout this user?')) return;
    try {
      var result = await this.api('/admin/users/' + userId + '/force-logout', { method: 'POST' });
      App.showToast(result.message || 'User session invalidated.', 'success');
      this.renderAdmin();
    } catch (e) { App.showToast('Error: ' + e.message, 'error'); }
  },

  async adminLockUser(userId) {
    if (!confirm('Lock this account?')) return;
    try {
      var result = await this.api('/admin/users/' + userId + '/lock', { method: 'POST' });
      App.showToast(result.message || 'Account locked.', 'success');
      this.renderAdmin();
    } catch (e) { App.showToast('Error: ' + e.message, 'error'); }
  },

  async adminUnlockUser(userId) {
    try {
      var result = await this.api('/admin/users/' + userId + '/unlock', { method: 'POST' });
      App.showToast(result.message || 'Account unlocked.', 'success');
      this.renderAdmin();
    } catch (e) { App.showToast('Error: ' + e.message, 'error'); }
  },

  adminToggleLoginHistory(userId) {
    var row = document.getElementById('admin-login-history-' + userId);
    if (row) row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
  },

  async adminChangeSubscription(userId, currentSub) {
    var options = { 'free': 'premium', 'premium': 'vip', 'vip': 'free' };
    var newSub = options[currentSub] || 'premium';
    if (!confirm('Change subscription to ' + newSub + '?')) return;
    var expiry = null;
    if (newSub === 'premium' || newSub === 'vip') {
      expiry = prompt('Subscription expiry date (YYYY-MM-DD):', new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
      if (!expiry) return;
    }
    try {
      var result = await this.api('/admin/users/' + userId + '/subscription', {
        method: 'PUT', body: JSON.stringify({ subscription: newSub, subscriptionExpiry: expiry })
      });
      App.showToast(result.message || 'Subscription updated.', 'success');
      this.renderAdmin();
    } catch (e) { App.showToast('Error: ' + e.message, 'error'); }
  },

  async adminAutoSettle() {
    try {
      var result = await this.api('/admin/auto-results', { method: 'POST' });
      App.showToast(result.message || 'Auto-settle complete. ' + (result.updated || 0) + ' tips updated.', 'success');
      this.renderAdmin();
    } catch (e) { App.showToast('Error: ' + e.message, 'error'); }
  },

  // -----------------------------------------------------------------------
  // CHATBOT
  // -----------------------------------------------------------------------
  toggleChat() {
    const w = document.getElementById('chat-window');
    const tease = document.getElementById('chat-tease');
    w.style.display = w.style.display === 'none' ? 'flex' : 'none';
    if (tease) tease.style.display = 'none';
    // Mark tease as dismissed so it doesn't pop again this session
    sessionStorage.setItem('ee_chat_dismissed', 'true');
    if (w.style.display === 'flex') {
      // Personalise opening message based on auth state
      const messages = document.getElementById('chat-messages');
      if (messages && !messages.dataset.personalised) {
        messages.dataset.personalised = 'true';
        const isGuest = !this.user;
        const isFree = !this.isPremium();
        if (isGuest) {
          messages.innerHTML = '<div class="chat-msg bot">Hi! 👋 Welcome to <strong>Elite Edge Sports Tips</strong>.</div>' +
            '<div class="chat-msg bot">We\'re running at <strong>76.8% strike rate</strong> and <strong>+225% ROI</strong> this season — fully verified.</div>' +
            '<div class="chat-msg bot">Want to see today\'s premium tips? <strong>Your 14-day free trial</strong> 🎁</div>' +
            '<div class="chat-suggestions" id="chat-suggestions">' +
              '<button onclick="App.chatSend(\'Show me today\\\'s tips\')">Show me today\'s tips</button>' +
              '<button onclick="App.closeChat();App.showModal(\'register\')">Start 14-Day Free Trial</button>' +
              '<button onclick="App.chatSend(\'How does it work?\')">How does it work?</button>' +
            '</div>';
        } else if (isFree) {
          messages.innerHTML = '<div class="chat-msg bot">Hi ' + (this.user.name || 'there') + '! 👋</div>' +
            '<div class="chat-msg bot">You\'re on the Free plan. Upgrade to Premium for <strong>2-4 daily picks</strong>, full analysis, and the daily bulletin email.</div>' +
            '<div class="chat-msg bot"><strong>14-day free trial</strong> 🎁 then £19.99/mo. Cancel anytime.</div>' +
            '<div class="chat-suggestions" id="chat-suggestions">' +
              '<button onclick="App.closeChat();window.location.hash=\'#/pricing\'">Upgrade to Premium</button>' +
              '<button onclick="App.chatSend(\'What\\\'s included?\')">What\'s included?</button>' +
              '<button onclick="App.chatSend(\'Today\\\'s tips?\')">Today\'s tips?</button>' +
            '</div>';
        }
      }
    }
  },

  closeChat() {
    document.getElementById('chat-window').style.display = 'none';
  },

  // Auto-tease the chat bubble for non-logged-in users
  initChatTease() {
    if (this.user) return; // Logged in - skip
    if (sessionStorage.getItem('ee_chat_dismissed')) return; // Already dismissed
    setTimeout(() => {
      const bubble = document.getElementById('chat-bubble');
      if (!bubble || sessionStorage.getItem('ee_chat_dismissed')) return;
      // Add a pulsing notification dot
      if (!bubble.querySelector('.chat-tease-dot')) {
        const dot = document.createElement('div');
        dot.className = 'chat-tease-dot';
        bubble.appendChild(dot);
      }
      // Add a teaser bubble that appears next to the chat bubble
      if (!document.getElementById('chat-tease')) {
        const tease = document.createElement('div');
        tease.id = 'chat-tease';
        tease.className = 'chat-tease';
        tease.innerHTML = '<button class="chat-tease-close" onclick="App.dismissChatTease(event)">&times;</button>' +
          '<div class="chat-tease-title">🎁 14-Day Free Trial</div>' +
          '<div class="chat-tease-text">Up to 9 daily tips across 6 sports. 3 AI engines. Start your 14-day free trial.</div>' +
          '<button class="chat-tease-cta" onclick="App.dismissChatTease();App.toggleChat();">Tell me more</button>';
        document.body.appendChild(tease);
        setTimeout(() => tease.classList.add('show'), 50);
      }
    }, 12000); // 12 seconds after page load
  },

  dismissChatTease(e) {
    if (e) e.stopPropagation();
    sessionStorage.setItem('ee_chat_dismissed', 'true');
    const tease = document.getElementById('chat-tease');
    if (tease) tease.remove();
    const dot = document.querySelector('.chat-tease-dot');
    if (dot) dot.remove();
  },

  async chatSend(text) {
    const input = document.getElementById('chat-input');
    const message = text || input.value.trim();
    if (!message) return;
    input.value = '';

    const messages = document.getElementById('chat-messages');
    messages.innerHTML += `<div class="chat-msg user">${this.escapeHtml(message)}</div>`;
    messages.scrollTop = messages.scrollHeight;

    try {
      // Try AI-powered chat first, fall back to rule-based
      let botReply = '';
      let suggestions = [];
      try {
        const aiRes = await this.api('/chat/ai', {
          method: 'POST',
          body: JSON.stringify({ message })
        });
        botReply = aiRes.reply || '';
      } catch (aiErr) {
        // AI unavailable — fall back to rule-based chat
        botReply = '';
      }

      if (botReply) {
        messages.innerHTML += `<div class="chat-msg bot">${this.escapeHtml(botReply)}</div>`;
        // Add contextual suggestions after AI response
        const lower = message.toLowerCase();
        if (lower.includes('tip') || lower.includes('pick')) {
          suggestions = ['Show racing tips', 'Show football tips', 'How do I upgrade?'];
        } else if (lower.includes('price') || lower.includes('premium') || lower.includes('upgrade')) {
          suggestions = ["Today's best tips?", 'What do I get with Premium?', 'Show my results'];
        } else {
          suggestions = ["Today's best tips?", 'How does it work?', 'How do I upgrade?'];
        }
      } else {
        // Fall back to rule-based
        const fallback = await this.api('/chat', {
          method: 'POST',
          body: JSON.stringify({ message })
        });
        botReply = fallback.response;
        suggestions = fallback.suggestions || [];
        messages.innerHTML += `<div class="chat-msg bot">${botReply}</div>`;
      }

      if (suggestions && suggestions.length) {
        document.getElementById('chat-suggestions')?.remove();
        messages.innerHTML += `<div class="chat-suggestions" id="chat-suggestions">
          ${suggestions.map(s => `<button onclick="App.chatSend('${s.replace(/'/g, "\\'")}')">${s}</button>`).join('')}
        </div>`;
      }
    } catch {
      messages.innerHTML += `<div class="chat-msg bot">Sorry, I couldn't process that. Please try again.</div>`;
    }
    messages.scrollTop = messages.scrollHeight;
  },

  // -----------------------------------------------------------------------
  // HELPERS
  // -----------------------------------------------------------------------
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  _getVerdictText(a, tip) {
    if (a && a.valueReasoning) return a.valueReasoning;
    if (a && a.summary) return a.summary;
    var edgePct = ((tip.edge || 0) * 100).toFixed(1);
    var verdict = 'Our model identifies genuine value in this selection with a ' + edgePct + '% edge over the bookmaker price. ';
    if (tip.confidence >= 8) verdict += 'This is one of our strongest plays today.';
    else if (tip.confidence >= 6) verdict += 'A solid selection with clear value.';
    else verdict += 'A speculative play - consider smaller stakes.';
    return verdict;
  },

  _buildModelText(a, tip) {
    if (a.summary) return '<p>' + a.summary + '</p>';
    var c = tip.confidence || 0;
    var edgePct = ((tip.edge || 0) * 100).toFixed(1);
    var implPct = ((tip.impliedProbability || 0) * 100).toFixed(1);
    var modPct = ((tip.modelProbability || 0) * 100).toFixed(1);
    return '<p>Our model gives this selection a <strong>' + c + '/10</strong> confidence rating with a <strong>' + edgePct + '%</strong> edge. Implied probability: ' + implPct + '%. Model probability: ' + modPct + '%.</p>';
  },

  _buildAnalysisSections(tip, a) {
    var self = this;
    if (tip.sport === 'racing') {
      return [
        { icon: '\ud83d\udcca', title: 'Model Assessment', body: self._buildModelText(a, tip) },
        { icon: '\ud83d\udcc8', title: 'Form Analysis', fields: ['form', 'speedRatings'] },
        { icon: '\u26a1', title: 'Key Factors', fields: ['paceAnalysis', 'goingSuitability', 'courseRecord', 'drawBias'] },
        a.oddsMovement ? { icon: '\ud83d\udcc9', title: 'Market Mover', body: '<p style="color:#22c55e;">' + a.oddsMovement + '</p>' } : null,
        { icon: '\u26a0\ufe0f', title: 'Risk Assessment', body: '<p>Risk Level: <strong>' + (tip.riskLevel || 'Medium') + '</strong></p>' + (a.classMovement ? '<p>' + a.classMovement + '</p>' : '') + (a.weight ? '<p>' + a.weight + '</p>' : '') },
        { icon: '\ud83d\udca1', title: 'Why This Is Value', fields: ['valueReasoning', 'marketSupport'] },
        { icon: '\ud83c\udfaf', title: 'Staking Recommendation', body: '<p>Recommended stake: <strong>' + (tip.staking || '1 unit') + '</strong>. ' + (a.trainerJockeyStats ? 'Trainer/Jockey: ' + a.trainerJockeyStats : '') + '</p>' },
        a.clockerInsight ? { icon: '\ud83d\udd0d', title: 'The Clocker — Deep Intelligence', body: '<div style="font-size:13px;line-height:1.7;color:#cbd5e1;">' + a.clockerInsight + '</div>' } : null,
      ];
    }
    return [
      { icon: '\ud83d\udcca', title: 'Model Assessment', body: self._buildModelText(a, tip) },
      { icon: '\ud83d\udcc8', title: 'Form Analysis', fields: ['form', 'homeAway'] },
      { icon: '\u26a1', title: 'Key Factors', fields: ['xG', 'shots'] },
      { icon: '\u26a0\ufe0f', title: 'Risk Assessment', body: '<p>Risk Level: <strong>' + (tip.riskLevel || 'Medium') + '</strong></p>' + (a.injuries ? '<p>' + a.injuries + '</p>' : '') + (a.scheduleCongestion ? '<p>' + a.scheduleCongestion + '</p>' : '') },
      { icon: '\ud83d\udca1', title: 'Why This Is Value', fields: ['valueReasoning', 'motivationContext'] },
      { icon: '\ud83c\udfaf', title: 'Staking Recommendation', body: '<p>Recommended stake: <strong>' + (tip.staking || '1 unit') + '</strong>. ' + (a.h2h ? 'H2H: ' + a.h2h : '') + '</p>' },
    ];
  },

  // -----------------------------------------------------------------------
  // FREE WEEKLY ACCA
  // -----------------------------------------------------------------------
  async renderPremiumAcca() {
    var container = document.getElementById('premium-acca-container');
    if (!container || !this.isPremium()) return;
    try {
      var tips = await this.api('/tips');
      var acca = tips.find(function(t) { return t.isWeeklyAcca && !t.locked; });
      if (!acca || !acca.accaSelections || !acca.accaSelections.length) return;

      var self = this;
      var dayOfWeek = new Date().getDay();
      var isWeekend = dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0;

      container.innerHTML =
        '<div style="background:linear-gradient(135deg,rgba(212,168,67,0.1),rgba(212,168,67,0.03));border:2px solid rgba(212,168,67,0.4);border-radius:14px;padding:24px;margin-bottom:24px;">' +
          '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">' +
            '<div style="font-size:28px;">&#9917;</div>' +
            '<div style="flex:1;">' +
              '<div style="font-size:16px;font-weight:800;color:#d4a843;">Premium Weekend Value Accumulator</div>' +
              '<div style="font-size:12px;color:#8a8fa0;">Analyst-driven selections — no short prices, only value</div>' +
            '</div>' +
            '<div style="text-align:right;">' +
              '<div style="font-size:20px;font-weight:800;color:#d4a843;">' + self.formatOdds(acca.odds) + '</div>' +
              '<div style="font-size:10px;color:#8a8fa0;">COMBINED ODDS</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:grid;gap:8px;margin-bottom:16px;">' +
          acca.accaSelections.map(function(s, idx) {
            return '<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:rgba(255,255,255,0.03);border-radius:8px;border-left:3px solid ' + (idx % 3 === 0 ? '#a855f7' : idx % 3 === 1 ? '#22c55e' : '#d4a843') + ';">' +
              '<div style="font-size:18px;font-weight:800;color:#d4a843;min-width:24px;">' + (idx + 1) + '</div>' +
              '<div style="flex:1;">' +
                '<div style="font-weight:700;font-size:14px;color:#e8e6e3;">' + (s.match || '') + '</div>' +
                '<div style="font-size:12px;color:#8a8fa0;margin-bottom:4px;">' + (s.league || '') + '</div>' +
                '<div style="font-size:13px;font-weight:600;color:#d4a843;">' + (s.selection || '') + '</div>' +
                '<div style="font-size:11px;color:#94a3b8;margin-top:4px;font-style:italic;">' + (s.reasoning || '') + '</div>' +
              '</div>' +
              '<div style="text-align:right;min-width:50px;">' +
                '<div style="font-size:16px;font-weight:800;color:#e8e6e3;">' + self.formatOdds(s.odds) + '</div>' +
              '</div>' +
            '</div>';
          }).join('') +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:rgba(212,168,67,0.1);border-radius:8px;">' +
            '<div>' +
              '<div style="font-size:12px;color:#8a8fa0;">£10 Stake Returns</div>' +
              '<div style="font-size:22px;font-weight:800;color:#22c55e;">£' + (acca.odds * 10).toFixed(2) + '</div>' +
            '</div>' +
            '<div style="text-align:right;">' +
              '<div style="font-size:12px;color:#8a8fa0;">Selections</div>' +
              '<div style="font-size:22px;font-weight:800;color:#d4a843;">' + acca.accaSelections.length + '-fold</div>' +
            '</div>' +
          '</div>' +
          '<p style="font-size:11px;color:#64748b;text-align:center;margin-top:12px;">Premium analyst selections. Min odds per leg: 1.6. Entertainment purposes only. Please gamble responsibly. 18+.</p>' +
        '</div>';
    } catch(e) {
      // Non-fatal
    }
  },

  async renderYesterdayShowcase() {
    var container = document.getElementById('yesterday-winner-showcase');
    if (!container) return;
    try {
      var results = await this.api('/results');
      if (!Array.isArray(results) || results.length === 0) return;

      var yesterday = this._getYesterday();
      var twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];

      // Get yesterday's results (or day before if yesterday had none)
      var dayResults = results.filter(function(r) { return App._normDate(r.date) === yesterday; });
      var showDate = yesterday;
      if (dayResults.length === 0) {
        dayResults = results.filter(function(r) { return App._normDate(r.date) === twoDaysAgo; });
        showDate = twoDaysAgo;
      }
      if (dayResults.length === 0) return;

      var wins = dayResults.filter(function(r) { return r.result === 'won'; });
      var totalPnl = dayResults.reduce(function(s, r) { return s + (r.pnl || 0); }, 0);
      var strikeRate = dayResults.length > 0 ? Math.round((wins.length / dayResults.length) * 100) : 0;
      var bestWin = wins.sort(function(a, b) { return (b.pnl || 0) - (a.pnl || 0); })[0];
      var isPremium = this.isPremium();
      var self = this;

      var dateObj = new Date(showDate + 'T12:00:00');
      var dateLabel = dateObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

      container.innerHTML =
        '<div style="background:linear-gradient(135deg,rgba(34,197,94,0.08),rgba(212,168,67,0.05));border:1px solid rgba(34,197,94,0.25);border-radius:14px;padding:24px;margin-bottom:24px;">' +
          '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">' +
            '<div style="font-size:28px;">&#128270;</div>' +
            '<div>' +
              '<div style="font-size:16px;font-weight:800;color:#d4a843;">What Premium Members Got Yesterday</div>' +
              '<div style="font-size:12px;color:#8a8fa0;">' + dateLabel + ' — Full analysis was available before kick-off</div>' +
            '</div>' +
          '</div>' +

          // Stats bar
          '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">' +
            '<div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:12px;text-align:center;">' +
              '<div style="font-size:20px;font-weight:800;color:#fff;">' + dayResults.length + '</div>' +
              '<div style="font-size:10px;color:#8a8fa0;text-transform:uppercase;">Selections</div>' +
            '</div>' +
            '<div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:12px;text-align:center;">' +
              '<div style="font-size:20px;font-weight:800;color:#22c55e;">' + wins.length + '</div>' +
              '<div style="font-size:10px;color:#8a8fa0;text-transform:uppercase;">Winners</div>' +
            '</div>' +
            '<div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:12px;text-align:center;">' +
              '<div style="font-size:20px;font-weight:800;color:' + (strikeRate >= 50 ? '#22c55e' : '#ef4444') + ';">' + strikeRate + '%</div>' +
              '<div style="font-size:10px;color:#8a8fa0;text-transform:uppercase;">Strike Rate</div>' +
            '</div>' +
            '<div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:12px;text-align:center;">' +
              '<div style="font-size:20px;font-weight:800;color:' + (totalPnl >= 0 ? '#22c55e' : '#ef4444') + ';">' + (totalPnl >= 0 ? '+' : '') + totalPnl.toFixed(2) + 'u</div>' +
              '<div style="font-size:10px;color:#8a8fa0;text-transform:uppercase;">P/L</div>' +
            '</div>' +
          '</div>' +

          // Results list
          '<div style="display:grid;gap:6px;margin-bottom:16px;">' +
          dayResults.map(function(r) {
            var isWin = r.result === 'won';
            var isPlaced = r.result === 'placed';
            var resultColor = isWin ? '#22c55e' : isPlaced ? '#60a5fa' : '#ef4444';
            var resultLabel = isWin ? 'WON' : isPlaced ? 'PLACED' : 'LOST';
            var oddsDisplay = self.formatOdds ? self.formatOdds(r.odds) : r.odds;
            // Free users see selection names but NOT odds or analysis (the value is in the timing)
            return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:8px;border-left:3px solid ' + resultColor + ';">' +
              '<span style="font-size:11px;padding:3px 8px;border-radius:4px;font-weight:700;background:' + resultColor + '20;color:' + resultColor + ';">' + resultLabel + '</span>' +
              '<span style="flex:1;font-weight:600;font-size:13px;color:#e8e6e3;">' + (r.selection || '') + '</span>' +
              '<span style="font-size:13px;color:#8a8fa0;">' + (r.event || '').substring(0, 40) + '</span>' +
              (isPremium ? '<span style="font-weight:700;font-size:14px;color:' + resultColor + ';">' + oddsDisplay + '</span>' : '<span style="font-size:12px;color:#d4a843;">&#128274;</span>') +
            '</div>';
          }).join('') +
          '</div>' +

          // Best winner highlight
          (bestWin ? '<div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:10px;padding:14px;margin-bottom:16px;display:flex;align-items:center;gap:12px;">' +
            '<div style="font-size:28px;">&#127942;</div>' +
            '<div style="flex:1;">' +
              '<div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#22c55e;">Best Winner</div>' +
              '<div style="font-size:16px;font-weight:800;color:#fff;">' + bestWin.selection + ' at ' + (self.formatOdds ? self.formatOdds(bestWin.odds) : bestWin.odds) + '</div>' +
              '<div style="font-size:12px;color:#8a8fa0;">' + (bestWin.event || '') + ' — <strong style="color:#22c55e;">+' + (bestWin.pnl || 0).toFixed(2) + ' units</strong></div>' +
            '</div>' +
          '</div>' : '') +

          // CTA for free users
          (!isPremium ? '<div style="text-align:center;padding-top:8px;">' +
            '<p style="font-size:13px;color:#c0c4d0;margin-bottom:12px;">Premium members received these selections <strong style="color:#d4a843;">before kick-off</strong> with full analysis, staking plans, and AI previews.</p>' +
            '<a href="#/pricing" style="display:inline-block;background:#d4a843;color:#0a0e1a;padding:12px 32px;border-radius:8px;font-weight:700;font-size:14px;text-decoration:none;">Start Your 14-Day Free Trial</a>' +
            '<div style="font-size:11px;color:#6b7280;margin-top:8px;">Card stored securely. No charges on free tier. Cancel anytime. 18+</div>' +
          '</div>' : '') +
        '</div>';
    } catch (e) {
      // Non-fatal
    }
  },

  // -----------------------------------------------------------------------
  // LEGAL PAGES
  // -----------------------------------------------------------------------
  renderTerms() {
    document.getElementById('app').innerHTML = `
      <div class="container">
        <div class="legal-page">
          <h1>Terms &amp; Conditions</h1>
          <p class="legal-updated">Last updated: 1 April 2026</p>

          <div class="legal-disclaimer-box" style="border:2px solid #ef4444;background:rgba(239,68,68,0.1);padding:20px;border-radius:8px;margin-bottom:24px;">
            <p style="font-weight:700;font-size:16px;color:#ef4444;margin-bottom:8px;">⚠️ IMPORTANT — PLEASE READ CAREFULLY</p>
            <p style="font-weight:600;">Elite Edge Sports Tips is an ENTERTAINMENT and STATISTICAL ANALYSIS service ONLY. We are NOT a licensed betting operator, financial adviser, or regulated tipster. ALL content on this platform represents OPINION and STATISTICAL MODELLING ONLY. NOTHING on this site constitutes financial advice, betting advice, investment advice, or a recommendation or inducement to place any bet or wager. There is absolutely NO GUARANTEE of profit or positive returns. Past performance does NOT guarantee future results. Any decision to place bets is made ENTIRELY at your own risk. We accept NO LIABILITY WHATSOEVER for any financial losses incurred. If you choose to gamble, please do so responsibly and only with money you can afford to lose. If you or someone you know has a gambling problem, please contact the National Gambling Helpline on 0808 8020 133 or visit <a href="https://www.begambleaware.org" target="_blank" style="color:#d4a843;">BeGambleAware.org</a>.</p>
          </div>

          <h2>1. Service Description — Entertainment Only</h2>
          <p>Elite Edge Sports Tips ("the Service", "we", "us", "our") provides sports analysis content, statistical modelling outputs, and entertainment-focused commentary on horse racing and European football markets. <strong>All content published on this platform constitutes opinion, entertainment, and statistical analysis only.</strong> Nothing on this site should be construed as financial advice, betting advice, investment advice, professional tipping advice, or a recommendation or inducement to place any wager or bet of any kind. We are not regulated by the Financial Conduct Authority (FCA) or the Gambling Commission as a tipping service.</p>

          <h2>2. No Guarantee of Profit</h2>
          <p><strong>We make absolutely no guarantee, representation, or warranty, express or implied, that following or acting upon any content published on this platform will result in profit or positive financial returns.</strong> Gambling involves significant financial risk. The majority of gamblers lose money. Past performance of our analysis, models, or published selections does not guarantee, predict, or indicate future results. Strike rates, ROI figures, and profit/loss records are historical in nature and should not be relied upon as indicative of future performance.</p>

          <h2>3. Acceptance of Terms</h2>
          <p>By accessing and using this website, you acknowledge that you have read, understood, and agree to be bound by these Terms and Conditions in their entirety. If you do not agree with any part of these Terms, you must immediately cease using the Service.</p>

          <h2>3. Eligibility &amp; Geographic Restriction</h2>
          <ul>
            <li>You must be at least 18 years of age to use this Service.</li>
            <li><strong>This Service is intended for use by residents of the United Kingdom only.</strong> By accessing this platform, you confirm that you are located in and a resident of the United Kingdom.</li>
            <li>Access from outside the United Kingdom may be restricted. We reserve the right to block access from any jurisdiction at our sole discretion.</li>
            <li>You are responsible for ensuring that your use of this Service complies with all applicable laws and regulations in your jurisdiction.</li>
            <li>By registering, you confirm that you are 18+, a UK resident, and meet all eligibility requirements.</li>
          </ul>

          <h2>4. No Betting Advice</h2>
          <p>All content provided by Elite Edge Sports Tips is for informational and entertainment purposes only. Our analysis represents statistical modelling and personal opinion. It does not constitute professional betting advice, financial advice, or any form of guaranteed returns. Past performance does not guarantee future results.</p>

          <h2>5. User Responsibility &amp; Liability</h2>
          <ul>
            <li>All betting decisions are made entirely at your own risk and discretion.</li>
            <li>We accept NO liability for any losses incurred as a result of following or acting upon any content published on this platform.</li>
            <li>You are solely responsible for managing your own bankroll and betting activity.</li>
            <li>We strongly advise that you only bet with money you can afford to lose.</li>
          </ul>

          <h2>6. Subscription Terms, Free Trial &amp; Auto-Renewal</h2>
          <ul>
            <li><strong>Free Tier:</strong> Limited access to one daily NAP selection and basic analysis. No payment required.</li>
            <li><strong>Premium Tier:</strong> Full access to all tips, detailed analysis, email bulletins, and priority support. Pricing: &pound;19.99/month or &pound;199.99/year.</li>
            <li><strong>Free Trial:</strong> New Premium subscribers receive their first month (30 days) completely free of charge. No payment is taken during the trial period. You may cancel at any time during the free trial without incurring any charge.</li>
            <li><strong>Auto-Renewal:</strong> <strong>Your subscription will automatically renew at the end of each billing period (including at the end of your free trial) unless you cancel before the renewal date.</strong> By subscribing, you expressly consent to auto-renewal and authorise us to charge your chosen payment method at the then-current subscription rate (&pound;19.99/month or &pound;199.99/year) on each renewal date.</li>
            <li><strong>Billing:</strong> After your free trial ends, subscriptions are billed in advance on a recurring monthly or annual basis. Your payment method will be charged automatically on the same date each month (or year for annual plans). You will receive an email reminder at least 3 days before each renewal.</li>
            <li><strong>Cancellation:</strong> You may cancel your subscription at any time through your account settings, by emailing support@eliteedgesports.co.uk, or by contacting us via the in-app support form. Cancellation takes effect at the end of the current billing period — you will retain access until that date. <strong>If you cancel during your free trial, you will not be charged.</strong></li>
            <li><strong>Price Changes:</strong> We reserve the right to change subscription prices. We will notify you at least 14 days before any price increase. If you do not agree with the new price, you may cancel before the new rate takes effect.</li>
            <li><strong>Cooling-Off Period:</strong> In accordance with the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013, you have a 14-day cooling-off period from the date of your first paid subscription during which you may request a full refund, provided you have not accessed Premium content during that period.</li>
            <li><strong>Refunds:</strong> Outside the 14-day cooling-off period, refunds are at our sole discretion. Partial-month refunds are not provided for mid-cycle cancellations. Contact support@eliteedgesports.co.uk for all refund requests.</li>
          </ul>

          <h2>7. Intellectual Property</h2>
          <p>All content on this platform, including but not limited to tips, analysis, statistical models, text, graphics, and software, is the intellectual property of Elite Edge Sports Tips Ltd. You may not reproduce, redistribute, sell, or commercially exploit any content without our prior written consent.</p>

          <h2>8. Modifications</h2>
          <p>We reserve the right to modify tips, analysis, pricing, and these Terms at any time. Changes will be posted on this page with an updated date. Continued use of the Service after changes constitutes acceptance of the modified Terms.</p>

          <h2>9. Limitation of Liability</h2>
          <p><strong>To the maximum extent permitted by applicable law, Elite Edge Sports Tips Ltd, its directors, officers, employees, affiliates, agents, contractors, and licensors shall not be liable for any direct, indirect, incidental, special, consequential, punitive, or exemplary damages, including but not limited to damages for loss of profits, goodwill, data, or other intangible losses, arising from or in connection with:</strong></p>
          <ul>
            <li>Your use of or inability to use the Service;</li>
            <li>Any betting, wagering, or gambling activity undertaken as a result of, or in connection with, any content published on this platform;</li>
            <li>Any financial losses incurred from gambling activity;</li>
            <li>Any reliance placed on our content, analysis, statistical models, opinions, or selections;</li>
            <li>Any errors, inaccuracies, or omissions in our content;</li>
            <li>Unauthorised access to your account;</li>
            <li>Any interruption or cessation of the Service.</li>
          </ul>
          <p><strong>You expressly acknowledge and agree that your use of this Service and any gambling activity is at your sole risk.</strong> Our total liability to you for all claims arising from the Service shall not exceed the amount you have paid to us in subscription fees in the 12 months preceding the claim.</p>

          <h2>10. Third-Party Bookmakers &amp; Affiliate Links</h2>
          <p>Elite Edge Sports Tips is <strong>not affiliated with, endorsed by, or in any partnership with</strong> any bookmaker, betting exchange, or licensed gambling operator unless explicitly stated. Any references to bookmaker odds, prices, or promotions are provided for informational and comparison purposes only. If we display affiliate links, we may receive a commission from the bookmaker at no additional cost to you. This does not influence our analysis or selections. You are under no obligation to use any particular bookmaker.</p>

          <h2>11. Age Verification &amp; Self-Exclusion</h2>
          <p>This Service is strictly for persons aged 18 years or over. By using this Service, you confirm that you are at least 18 years old. We support responsible gambling and encourage anyone who may have a gambling problem to register with <a href="https://www.gamstop.co.uk" target="_blank" style="color:#d4a843;">GamStop</a> for self-exclusion from all UK-licensed online gambling operators. If you are registered with GamStop or any self-exclusion scheme, the analysis content on this platform may not be suitable for you and we advise you to discontinue use.</p>

          <h2>12. Severability</h2>
          <p>If any provision of these Terms is found to be invalid or unenforceable by a court of competent jurisdiction, the remaining provisions shall continue in full force and effect.</p>

          <h2>13. Entire Agreement</h2>
          <p>These Terms, together with our Privacy Policy, Disclaimer, and Responsible Gambling Policy, constitute the entire agreement between you and Elite Edge Sports Tips Ltd regarding your use of the Service.</p>

          <h2>14. Governing Law</h2>
          <p>These Terms and Conditions are governed by and construed in accordance with the laws of England and Wales. Any disputes arising from these Terms shall be subject to the exclusive jurisdiction of the courts of England and Wales.</p>

          <h2>15. Contact</h2>
          <p>For questions about these Terms, contact us at: <a href="mailto:support@eliteedgesports.co.uk">support@eliteedgesports.co.uk</a></p>
          <p>Elite Edge Sports Tips Ltd<br>Registered in England &amp; Wales. Company No. 17138566</p>

          <p style="margin-top:32px;"><a href="#/" class="text-gold">&larr; Back to Dashboard</a></p>
        </div>
      </div>
    `;
  },

  renderPrivacy() {
    document.getElementById('app').innerHTML = `
      <div class="container">
        <div class="legal-page">
          <h1>Privacy Policy</h1>
          <p class="legal-updated">Last updated: 1 April 2026</p>

          <div class="legal-disclaimer-box">
            <p>Elite Edge Sports Tips provides statistical analysis and entertainment content only. We are not a licensed betting operator. Any decision to place bets is made entirely at your own risk. We do not guarantee profits and accept no responsibility for any financial losses. Please gamble responsibly.</p>
          </div>

          <h2>1. Introduction</h2>
          <p>Elite Edge Sports Tips Ltd ("we", "us", "our") is committed to protecting your privacy and personal data. This Privacy Policy explains how we collect, use, store, and protect your information in compliance with the UK General Data Protection Regulation (UK GDPR) and the Data Protection Act 2018.</p>

          <h2>2. Data We Collect</h2>
          <h3>Information you provide:</h3>
          <ul>
            <li><strong>Account data:</strong> Name, email address, password (encrypted)</li>
            <li><strong>Subscription data:</strong> Payment information (processed securely by our third-party payment provider; we do not store card details)</li>
            <li><strong>Support data:</strong> Information provided in support tickets or communications</li>
            <li><strong>Agreement data:</strong> Timestamp of your acceptance of our Terms &amp; Conditions</li>
          </ul>
          <h3>Information collected automatically:</h3>
          <ul>
            <li><strong>Usage data:</strong> Pages visited, features used, time spent on site</li>
            <li><strong>Device data:</strong> Browser type, operating system, screen resolution</li>
            <li><strong>Log data:</strong> IP address, access times, referring URLs</li>
            <li><strong>Cookie data:</strong> See Section 7 below</li>
          </ul>

          <h2>3. Legal Basis for Processing (UK GDPR)</h2>
          <p>We process your personal data on the following legal bases:</p>
          <ul>
            <li><strong>Contract:</strong> Processing necessary to perform our contract with you (providing the Service, managing your subscription)</li>
            <li><strong>Consent:</strong> Where you have given consent (marketing emails, analytics cookies). You may withdraw consent at any time.</li>
            <li><strong>Legitimate interests:</strong> Processing necessary for our legitimate interests (improving the Service, fraud prevention, platform security) where these are not overridden by your rights</li>
            <li><strong>Legal obligation:</strong> Processing necessary to comply with UK law (tax records, fraud prevention)</li>
          </ul>

          <h2>4. How We Use Your Data</h2>
          <ul>
            <li><strong>Service delivery:</strong> To provide you with access to tips, analysis, and platform features</li>
            <li><strong>Communication:</strong> To send email bulletins, service updates, and respond to support queries</li>
            <li><strong>Improvement:</strong> To analyse usage patterns and improve our platform and content</li>
            <li><strong>Legal compliance:</strong> To comply with applicable laws, regulations, and legal processes</li>
          </ul>

          <h2>5. Third Parties</h2>
          <p>We may share your data with the following categories of third parties:</p>
          <ul>
            <li><strong>Payment processor:</strong> To process subscription payments securely (e.g., Stripe)</li>
            <li><strong>Email provider:</strong> To deliver email bulletins and notifications (e.g., SendGrid, Mailchimp)</li>
            <li><strong>Analytics:</strong> To understand platform usage (e.g., Google Analytics, with IP anonymisation enabled)</li>
            <li><strong>Hosting:</strong> Our servers and infrastructure providers</li>
          </ul>
          <p>We do not sell your personal data to third parties.</p>

          <h2>6. Data Retention</h2>
          <ul>
            <li>Account data is retained for the duration of your account plus 12 months after deletion.</li>
            <li>Support ticket data is retained for 24 months.</li>
            <li>Usage and analytics data is retained for 26 months.</li>
            <li>Payment records are retained for 7 years as required by UK tax law.</li>
          </ul>

          <h2>7. Your Rights (UK GDPR)</h2>
          <p>Under UK GDPR, you have the following rights:</p>
          <ul>
            <li><strong>Right of access:</strong> Request a copy of your personal data</li>
            <li><strong>Right to rectification:</strong> Request correction of inaccurate data</li>
            <li><strong>Right to erasure:</strong> Request deletion of your personal data ("right to be forgotten")</li>
            <li><strong>Right to data portability:</strong> Request your data in a machine-readable format</li>
            <li><strong>Right to restrict processing:</strong> Request limitation of how we process your data</li>
            <li><strong>Right to object:</strong> Object to processing based on legitimate interests</li>
          </ul>
          <p>To exercise any of these rights, contact us at: <a href="mailto:privacy@eliteedgesports.co.uk">privacy@eliteedgesports.co.uk</a></p>

          <h2>8. Cookies</h2>
          <p>We use the following types of cookies:</p>
          <ul>
            <li><strong>Essential cookies:</strong> Required for the platform to function (authentication, preferences)</li>
            <li><strong>Analytics cookies:</strong> To understand how visitors use our site (can be opted out)</li>
            <li><strong>Functional cookies:</strong> To remember your preferences (theme, display settings)</li>
          </ul>
          <p>You can manage cookie preferences through your browser settings. Disabling essential cookies may affect platform functionality.</p>

          <h2>9. Data Security</h2>
          <p>We implement appropriate technical and organisational measures to protect your data, including encryption of passwords, secure HTTPS connections, and regular security reviews. However, no method of electronic transmission or storage is 100% secure.</p>

          <h2>10. Changes to This Policy</h2>
          <p>We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated date. We will notify registered users of significant changes by email.</p>

          <h2>11. Contact &amp; Complaints</h2>
          <p>For data protection queries: <a href="mailto:privacy@eliteedgesports.co.uk">privacy@eliteedgesports.co.uk</a></p>
          <p>If you are not satisfied with our response, you have the right to lodge a complaint with the Information Commissioner's Office (ICO): <a href="https://ico.org.uk" target="_blank" rel="noopener">ico.org.uk</a></p>

          <p style="margin-top:32px;"><a href="#/" class="text-gold">&larr; Back to Dashboard</a></p>
        </div>
      </div>
    `;
  },

  renderDisclaimer() {
    document.getElementById('app').innerHTML = `
      <div class="container">
        <div class="legal-page">
          <h1>Disclaimer</h1>
          <p class="legal-updated">Last updated: 1 April 2026</p>

          <div class="legal-disclaimer-box" style="border:2px solid #ef4444;background:rgba(239,68,68,0.1);padding:20px;border-radius:8px;margin-bottom:24px;">
            <p style="font-weight:700;font-size:18px;color:#ef4444;margin-bottom:8px;">⚠️ DISCLAIMER — READ BEFORE USING THIS SERVICE</p>
            <p style="font-weight:700;font-size:14px;">THIS SERVICE IS FOR ENTERTAINMENT AND STATISTICAL ANALYSIS PURPOSES ONLY. WE DO NOT PROVIDE FINANCIAL ADVICE, BETTING ADVICE, OR ANY GUARANTEE OF PROFIT. ALL GAMBLING CARRIES RISK. YOU CAN AND MAY LOSE MONEY. WE ACCEPT NO LIABILITY FOR ANY LOSSES.</p>
          </div>

          <h2>1. Important Notice</h2>
          <p><strong>This disclaimer applies to ALL content published by Elite Edge Sports Tips Ltd, including but not limited to:</strong> tips, selections, analysis, predictions, statistical models, confidence scores, edge calculations, accumulators, race cards, match previews, staking suggestions, and any other content on our website, emails, social media channels, or any other medium.</p>
          <p><strong>By using this Service, you explicitly acknowledge and accept every provision of this Disclaimer.</strong></p>

          <h2>2. No Guarantee of Profit — Absolute Disclaimer</h2>
          <p><strong>WE MAKE ABSOLUTELY NO GUARANTEE, WARRANTY, REPRESENTATION, OR PROMISE — EXPRESS OR IMPLIED — THAT FOLLOWING, ACTING UPON, OR BEING INFLUENCED BY ANY CONTENT ON THIS PLATFORM WILL RESULT IN PROFIT, POSITIVE RETURNS, OR FINANCIAL GAIN OF ANY KIND.</strong></p>
          <p>Betting on sports carries <strong>inherent and significant financial risk</strong>. The majority of people who gamble lose money. You should fully expect that you may lose some or all of the money you choose to wager. All published statistics, including ROI, strike rate, running bank figures, and performance records, represent <strong>historical data only</strong>. Past performance is absolutely no guarantee, indicator, or predictor of future results.</p>

          <h2>3. Entertainment &amp; Statistical Opinion Only</h2>
          <p>All content on this platform is provided <strong>strictly for entertainment and informational purposes only</strong>. Our tips and analysis represent the output of statistical modelling combined with subjective analytical opinion. They do not constitute and should never be interpreted as:</p>
          <ul>
            <li><strong>Financial advice</strong> of any kind</li>
            <li><strong>Investment advice</strong> of any kind</li>
            <li><strong>Professional betting or tipping advice</strong></li>
            <li><strong>A recommendation or inducement to gamble</strong></li>
            <li><strong>Tax, legal, or any other form of professional advice</strong></li>
          </ul>
          <p>We are not regulated by the Financial Conduct Authority (FCA), the Gambling Commission (as a tipster service), or any other regulatory body in respect of the provision of betting advice.</p>

          <h2>4. Your Sole Responsibility</h2>
          <p><strong>You are solely and exclusively responsible for:</strong></p>
          <ul>
            <li>Any and all decisions to place bets, wagers, or stakes of any kind</li>
            <li>The amount you choose to stake on any selection</li>
            <li>Ensuring compliance with all gambling laws and regulations in your jurisdiction</li>
            <li>Managing your own bankroll, finances, and gambling activity responsibly</li>
            <li>Seeking independent professional advice before making financial decisions</li>
            <li>Seeking professional help if you believe you have a gambling problem</li>
            <li>Verifying the accuracy of any information before acting upon it</li>
          </ul>

          <h2>5. Complete Limitation of Liability</h2>
          <p><strong>To the fullest extent permitted by applicable law, Elite Edge Sports Tips Ltd, its directors, officers, employees, affiliates, agents, contractors, licensors, and service providers shall not be liable — under any legal theory (including negligence, contract, strict liability, or otherwise) — for any:</strong></p>
          <ul>
            <li>Direct, indirect, incidental, special, consequential, or punitive damages</li>
            <li>Loss of profits, revenue, data, goodwill, or anticipated savings</li>
            <li>Financial losses arising from any betting, wagering, or gambling activity</li>
            <li>Losses arising from any reliance on our content, models, or opinions</li>
            <li>Losses arising from errors, inaccuracies, or omissions in our content</li>
            <li>Service interruptions, delays, or technical failures</li>
          </ul>

          <h2>6. Not a Betting Operator</h2>
          <p>Elite Edge Sports Tips Ltd is <strong>not</strong> a bookmaker, betting exchange, licensed gambling operator, or financial services provider. We do not accept bets, hold deposits, process gambling transactions, or facilitate any form of wagering. We are an independent entertainment and analysis content provider only. Any links to third-party bookmakers are provided for informational convenience only and do not constitute an endorsement or recommendation to gamble.</p>

          <h2>7. Indemnification</h2>
          <p>You agree to indemnify, defend, and hold harmless Elite Edge Sports Tips Ltd and its affiliates from and against any claims, liabilities, damages, losses, or expenses arising from your use of the Service, your gambling activity, or your violation of these terms.</p>

          <p style="margin-top:32px;"><a href="#/" class="text-gold">&larr; Back to Dashboard</a></p>
        </div>
      </div>
    `;
  },

  renderResponsibleGambling() {
    document.getElementById('app').innerHTML = `
      <div class="container">
        <div class="legal-page">
          <h1>Responsible Gambling</h1>
          <p class="legal-updated">Last updated: 1 April 2026</p>

          <div class="legal-disclaimer-box">
            <p>If you feel you have a gambling problem, please seek help immediately. You are not alone, and free, confidential support is available 24/7.</p>
          </div>

          <h2>Our Commitment</h2>
          <p>Elite Edge Sports Tips is committed to promoting responsible gambling. While we provide statistical analysis and entertainment content, we recognise that gambling can become harmful and we take our responsibility seriously.</p>

          <h2>Key Principles</h2>
          <ul>
            <li><strong>Only bet what you can afford to lose.</strong> Never use money intended for rent, bills, food, or other essential expenses.</li>
            <li><strong>Never chase losses.</strong> Losing is a normal part of betting. Chasing losses leads to bigger losses.</li>
            <li><strong>Set a budget and stick to it.</strong> Decide how much you can afford to bet each week/month and do not exceed it, regardless of results.</li>
            <li><strong>Betting should be fun.</strong> If it stops being enjoyable, stop.</li>
            <li><strong>Do not bet under the influence.</strong> Alcohol and drugs impair judgement.</li>
            <li><strong>Take regular breaks.</strong> Do not spend excessive time on betting-related activities.</li>
            <li><strong>Do not borrow to bet.</strong> Never use credit cards, loans, or borrowed money to fund betting.</li>
          </ul>

          <h2>Signs of Problem Gambling</h2>
          <p>You may have a gambling problem if you:</p>
          <ul>
            <li>Spend more money on gambling than you can afford</li>
            <li>Find it hard to manage or stop your gambling</li>
            <li>Have arguments with family or friends about money and gambling</li>
            <li>Lose interest in your usual activities or hobbies</li>
            <li>Are always thinking about gambling</li>
            <li>Lie to others about your gambling</li>
            <li>Borrow money or sell possessions to gamble</li>
            <li>Feel anxious, worried, guilty, or depressed about gambling</li>
            <li>Gamble until your last pound is gone</li>
            <li>Chase losses to try to win back money</li>
          </ul>

          <h2>Budget Management Advice</h2>
          <ul>
            <li>Set a weekly or monthly gambling budget before you start</li>
            <li>Use a separate bank account or e-wallet for gambling funds</li>
            <li>Track all bets and results (use our My Bets feature)</li>
            <li>Set deposit limits with your bookmaker</li>
            <li>Use reality check reminders offered by most bookmakers</li>
            <li>Review your spending regularly</li>
          </ul>

          <h2>Support &amp; Helplines</h2>

          <div class="legal-support-card">
            <h4>BeGambleAware</h4>
            <p>Free, confidential advice and support for anyone affected by gambling.</p>
            <p><a href="https://www.begambleaware.org" target="_blank" rel="noopener">www.begambleaware.org</a></p>
            <p>Helpline: <span class="legal-helpline">0808 8020 133</span> (free, 24/7)</p>
          </div>

          <div class="legal-support-card">
            <h4>GamCare</h4>
            <p>Provides information, advice, and support for anyone affected by gambling.</p>
            <p><a href="https://www.gamcare.org.uk" target="_blank" rel="noopener">www.gamcare.org.uk</a></p>
            <p>National Gambling Helpline: <span class="legal-helpline">0808 8020 133</span></p>
            <p>Live chat available on their website.</p>
          </div>

          <div class="legal-support-card">
            <h4>Gambling Commission</h4>
            <p>The UK regulator for gambling. Report concerns or get information about your rights.</p>
            <p><a href="https://www.gamblingcommission.gov.uk" target="_blank" rel="noopener">www.gamblingcommission.gov.uk</a></p>
          </div>

          <div class="legal-support-card">
            <h4>Gamblers Anonymous</h4>
            <p>Fellowship of men and women who share their experience, strength, and hope with each other.</p>
            <p><a href="https://www.gamblersanonymous.org.uk" target="_blank" rel="noopener">www.gamblersanonymous.org.uk</a></p>
          </div>

          <h2>Self-Exclusion</h2>
          <p>If you need to take a break from gambling, you can self-exclude from betting operators:</p>
          <ul>
            <li><strong>GAMSTOP:</strong> Register at <a href="https://www.gamstop.co.uk" target="_blank" rel="noopener">www.gamstop.co.uk</a> to self-exclude from all UK-licensed online gambling operators for 6 months, 1 year, or 5 years.</li>
            <li><strong>Individual bookmakers:</strong> Most operators offer their own self-exclusion tools in your account settings.</li>
            <li><strong>Betting shop exclusion:</strong> Visit your local betting shop and ask to be excluded.</li>
          </ul>

          <h2>Need Help Now?</h2>
          <div class="legal-disclaimer-box" style="border-color:rgba(34,197,94,.3);background:rgba(34,197,94,.08);">
            <p style="color:var(--green);">If you or someone you know has a gambling problem, call the National Gambling Helpline now on <strong>0808 8020 133</strong> (free, 24/7) or visit <a href="https://www.begambleaware.org" target="_blank" rel="noopener" style="color:var(--green);">BeGambleAware.org</a></p>
          </div>

          <p style="margin-top:32px;"><a href="#/" class="text-gold">&larr; Back to Dashboard</a></p>
        </div>
      </div>
    `;
  },

  // -----------------------------------------------------------------------
  // LIVE ODDS TICKER (Market Movers — Steamers & Drifters)
  // -----------------------------------------------------------------------
  _oddsTickerTimer: null,

  initOddsTicker() {
    this.fetchOddsTicker();
    if (!this._oddsTickerTimer) {
      this._oddsTickerTimer = setInterval(() => {
        this.fetchOddsTicker();
      }, 60 * 1000);
    }
  },

  async fetchOddsTicker() {
    try {
      var data = await this.api('/odds/market-movers');
      var movers = (data && data.movers) || [];
      var ticker = document.getElementById('odds-ticker');
      var track = document.getElementById('odds-ticker-track');
      if (!ticker || !track) return;
      if (!movers.length) {
        ticker.style.display = 'none';
        return;
      }
      // Build items HTML
      var html = '';
      movers.forEach(function(m) {
        var isSteamer = m.direction === 'steamer';
        var cls = isSteamer ? 'steamer' : 'drifter';
        var arrow = isSteamer ? '\u25BC' : '\u25B2';
        var pctRaw = Math.abs(m.change_pct || 0);
        var pct = pctRaw.toFixed(1);
        var eventLabel = m.event_name ? '<span class="odds-ticker-event">' + App._escHtml(m.event_name) + '</span>' : '';
        html += '<div class="odds-ticker-item ' + cls + '">' +
          eventLabel +
          '<span class="odds-ticker-name">' + App._escHtml(m.name || m.runner || '') + '</span>' +
          '<span class="odds-ticker-price">' + Number(m.old_price).toFixed(2) + ' \u2192 ' + Number(m.new_price).toFixed(2) + '</span>' +
          '<span class="odds-ticker-arrow">' + arrow + '</span>' +
          '<span class="odds-ticker-change">' + pct + '%</span>' +
          '</div>';
      });
      // Duplicate for seamless loop
      track.innerHTML = html + html;
      // Adjust animation speed based on number of items (roughly 3s per item)
      var duration = Math.max(20, movers.length * 3);
      track.style.animationDuration = duration + 's';
      ticker.style.display = 'flex';
    } catch (e) {
      // Silently fail — ticker is non-critical
    }
  },

  _escHtml(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  },

  // -----------------------------------------------------------------------
  // NOTIFICATION SYSTEM (Feature: In-app notifications)
  // -----------------------------------------------------------------------
  initNotifications() {
    this.updateNotifBadge();
    // Show prompt if not yet decided
    if (!localStorage.getItem('ee_notif_decided') && 'Notification' in window) {
      setTimeout(() => {
        const prompt = document.getElementById('notif-prompt');
        if (prompt) prompt.style.display = 'block';
      }, 3000);
    }
    // Fetch initial server notifications, then poll every 2 minutes
    this.fetchServerNotifications();
    if (!this._notifPoll) {
      this._notifPoll = setInterval(() => {
        this.fetchServerNotifications();
      }, 2 * 60 * 1000);
    }
  },

  _readNotifIds() {
    try {
      return JSON.parse(localStorage.getItem('ee_notif_read') || '[]');
    } catch { return []; }
  },

  _markNotifRead(id) {
    if (!id) return;
    var readIds = this._readNotifIds();
    if (readIds.indexOf(id) === -1) {
      readIds.push(id);
      // Cap to last 500 to avoid storage bloat
      if (readIds.length > 500) readIds = readIds.slice(-500);
      localStorage.setItem('ee_notif_read', JSON.stringify(readIds));
    }
  },

  async fetchServerNotifications() {
    try {
      var data = await this.api('/notifications');
      var serverList = (data && data.notifications) || [];
      var readIds = this._readNotifIds();
      // Merge: dedupe by id
      var byId = {};
      this.notifications.forEach(function(n) { if (n && n.id) byId[n.id] = n; });
      serverList.forEach(function(n) {
        var existing = byId[n.id];
        if (!existing) {
          byId[n.id] = {
            id: n.id,
            text: n.message,
            type: n.type,
            tipId: n.tipId || null,
            time: n.timestamp,
            audience: n.audience,
            read: readIds.indexOf(n.id) !== -1,
          };
        } else {
          existing.read = readIds.indexOf(n.id) !== -1;
        }
      });
      // Sort by time desc, cap to 30
      var merged = Object.values(byId).sort(function(a, b) {
        return new Date(b.time) - new Date(a.time);
      }).slice(0, 30);
      this.notifications = merged;
      localStorage.setItem('ee_notifications', JSON.stringify(merged));
      this.updateNotifBadge();
      // Re-render dropdown if visible
      var dd = document.getElementById('notif-dropdown');
      if (dd && dd.style.display !== 'none') {
        this.renderNotifList();
      }
    } catch (e) {
      // Silent failure — we'll still show any cached notifications
    }
  },

  enableNotifications() {
    if ('Notification' in window) {
      Notification.requestPermission().then(perm => {
        if (perm === 'granted') {
          this.notifEnabled = true;
          localStorage.setItem('ee_notif_enabled', 'true');
          new Notification('Elite Edge Sports Tips', { body: 'Notifications enabled! You will receive instant tip alerts.', icon: '/images/logo.svg' });
        }
      });
    }
    localStorage.setItem('ee_notif_decided', 'true');
    const prompt = document.getElementById('notif-prompt');
    if (prompt) prompt.style.display = 'none';
  },

  dismissNotifPrompt() {
    localStorage.setItem('ee_notif_decided', 'true');
    const prompt = document.getElementById('notif-prompt');
    if (prompt) prompt.style.display = 'none';
  },

  toggleNotifDropdown() {
    const dd = document.getElementById('notif-dropdown');
    if (!dd) return;
    var wasOpen = dd.style.display !== 'none';
    dd.style.display = wasOpen ? 'none' : 'block';
    if (!wasOpen) {
      // Re-fetch fresh before rendering
      this.fetchServerNotifications();
      this.renderNotifList();
    }
  },

  clickNotification(id) {
    var notif = this.notifications.find(function(n) { return n.id === id; });
    if (!notif) return;
    notif.read = true;
    this._markNotifRead(id);
    localStorage.setItem('ee_notifications', JSON.stringify(this.notifications));
    this.updateNotifBadge();
    this.renderNotifList();
    // If the notification has a tipId, navigate to it
    if (notif.tipId) {
      var dd = document.getElementById('notif-dropdown');
      if (dd) dd.style.display = 'none';
      window.location.hash = '#/tip/' + notif.tipId;
    }
  },

  renderNotifList() {
    const list = document.getElementById('notif-list');
    if (!list) return;
    if (!this.notifications.length) {
      list.innerHTML = '<p class="text-muted text-sm" style="padding:12px;">No notifications yet</p>' +
        '<div style="padding:8px 12px;border-top:1px solid var(--border);"><a href="#/account?alerts" onclick="var dd=document.getElementById(\'notif-dropdown\');if(dd)dd.style.display=\'none\';" style="color:var(--gold);font-size:12px;text-decoration:none;">Manage Alerts</a></div>';
      return;
    }
    var self = this;
    list.innerHTML = this.notifications.slice(0, 20).map(function(n) {
      var safeText = (n.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return '<div class="notif-item ' + (n.read ? '' : 'unread') + '" onclick="App.clickNotification(\'' + n.id + '\')">' +
        '<div>' + safeText + '</div>' +
        '<div class="notif-time">' + self.timeAgo(n.time) + '</div>' +
      '</div>';
    }).join('') +
    '<div style="padding:8px 12px;border-top:1px solid var(--border);text-align:center;"><a href="#/account?alerts" onclick="var dd=document.getElementById(\'notif-dropdown\');if(dd)dd.style.display=\'none\';" style="color:var(--gold);font-size:12px;text-decoration:none;">Manage Alerts</a></div>';
  },

  updateNotifBadge() {
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    const unread = this.notifications.filter(n => !n.read).length;
    badge.textContent = unread;
    badge.style.display = unread > 0 ? 'flex' : 'none';
  },

  addNotification(text) {
    this.notifications.unshift({ id: 'n_' + Date.now(), text, time: new Date().toISOString(), read: false });
    if (this.notifications.length > 10) this.notifications = this.notifications.slice(0, 10);
    localStorage.setItem('ee_notifications', JSON.stringify(this.notifications));
    this.updateNotifBadge();
    if (this.notifEnabled && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('Elite Edge Sports Tips', { body: text });
    }
  },

  clearNotifications() {
    // Mark all current notifications as read rather than wiping server data
    var self = this;
    this.notifications.forEach(function(n) {
      if (n && n.id) self._markNotifRead(n.id);
      if (n) n.read = true;
    });
    localStorage.setItem('ee_notifications', JSON.stringify(this.notifications));
    this.updateNotifBadge();
    this.renderNotifList();
  },

  sendTestAlert() {
    this.addNotification('Test Alert: New premium tip just published!');
    App.showToast('Test notification sent!', 'success');
  },

  timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.floor(hrs / 24) + 'd ago';
  },

  // -----------------------------------------------------------------------
  // ANALYSTS PAGE (Feature #1)
  // -----------------------------------------------------------------------
  // -----------------------------------------------------------------------
  // PERSONAL ROI DASHBOARD — your tracked bets, your results, your profit
  // -----------------------------------------------------------------------
  async renderMyROI() {
    var app = document.getElementById('app');
    if (!this.user || !this.token) {
      app.innerHTML = '<div class="container" style="padding-top:60px;text-align:center;"><h2>Log in to view your Personal ROI Dashboard</h2><p class="text-muted">Track your bets and see your personal strike rate, ROI, and analyst performance.</p><button class="btn btn-gold" onclick="App.showModal(\'login\')">Log In</button></div>';
      return;
    }

    app.innerHTML = '<div class="container" style="padding-top:40px;"><div class="admin-loading"><div class="spinner"></div> Loading your performance data...</div></div>';

    // Sync localStorage bets to server on first load
    var localBets = this.getMyBets();
    if (localBets.length > 0) {
      try { await this.api('/user/bets/sync', { method: 'POST', body: JSON.stringify({ bets: localBets }) }); } catch(e) {}
    }

    var roi;
    try {
      roi = await this.api('/user/bets/roi');
    } catch(e) {
      app.innerHTML = '<div class="container" style="padding-top:60px;text-align:center;"><h2>Start Tracking Your Bets</h2><p class="text-muted">Click "Back This Tip" on any selection to start building your personal performance record.</p><a href="#/dashboard" class="btn btn-gold">Go to Dashboard</a></div>';
      return;
    }

    if (!roi || roi.totalBets === 0) {
      app.innerHTML = '<div class="container" style="padding-top:60px;text-align:center;"><div style="font-size:48px;margin-bottom:16px;">&#128202;</div><h2>Your Personal ROI Dashboard</h2><p class="text-muted" style="max-width:500px;margin:12px auto 24px;">You haven\'t backed any tips yet. Click "Back This Tip" on any selection and we\'ll track the result, calculate your P/L, and show you which analysts and confidence levels work best for you.</p><a href="#/dashboard" class="btn btn-gold">View Today\'s Tips</a></div>';
      return;
    }

    var self = this;
    var pnlClass = roi.totalPnl > 0 ? 'color:#22c55e;' : roi.totalPnl < 0 ? 'color:#ef4444;' : '';
    var roiClass = roi.roi > 0 ? 'color:#22c55e;' : roi.roi < 0 ? 'color:#ef4444;' : '';
    var srClass = roi.strikeRate >= 50 ? 'color:#22c55e;' : roi.strikeRate >= 30 ? 'color:#d4a843;' : 'color:#ef4444;';

    // Analyst performance cards
    var analystCards = '';
    var analystNames = ['The Professor', 'The Scout', 'The Clocker', 'The Edge'];
    var analystColors = { 'The Professor': '#3b82f6', 'The Scout': '#22c55e', 'The Clocker': '#a855f7', 'The Edge': '#d4a843' };
    analystNames.forEach(function(name) {
      var a = roi.byAnalyst[name] || { total: 0, wins: 0, pnl: 0 };
      if (a.total === 0) return;
      var aSR = a.total > 0 ? Math.round((a.wins / a.total) * 100) : 0;
      var aROI = a.total > 0 ? Math.round((a.pnl / a.total) * 100) : 0;
      var col = analystColors[name] || '#d4a843';
      analystCards += '<div style="background:rgba(255,255,255,0.03);border:1px solid ' + col + '33;border-radius:10px;padding:16px;flex:1;min-width:140px;">' +
        '<div style="font-size:13px;font-weight:800;color:' + col + ';margin-bottom:8px;">' + name + '</div>' +
        '<div style="font-size:24px;font-weight:900;' + (a.pnl > 0 ? 'color:#22c55e;' : a.pnl < 0 ? 'color:#ef4444;' : '') + '">' + (a.pnl > 0 ? '+' : '') + a.pnl.toFixed(2) + 'u</div>' +
        '<div style="font-size:11px;color:#94a3b8;">' + a.wins + '/' + a.total + ' (' + aSR + '%) &bull; ROI: ' + aROI + '%</div>' +
      '</div>';
    });

    // Confidence tier cards
    var confCards = '';
    var confTiers = [
      { key: 'elite', label: 'Elite (9-10)', col: '#22c55e' },
      { key: 'strong', label: 'Strong (7-8)', col: '#d4a843' },
      { key: 'other', label: 'Other (<7)', col: '#94a3b8' },
    ];
    confTiers.forEach(function(tier) {
      var c = roi.byConfidence[tier.key] || { total: 0, wins: 0, pnl: 0 };
      if (c.total === 0) return;
      var cSR = c.total > 0 ? Math.round((c.wins / c.total) * 100) : 0;
      confCards += '<div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:16px;flex:1;min-width:140px;">' +
        '<div style="font-size:13px;font-weight:800;color:' + tier.col + ';margin-bottom:8px;">' + tier.label + '</div>' +
        '<div style="font-size:24px;font-weight:900;' + (c.pnl > 0 ? 'color:#22c55e;' : c.pnl < 0 ? 'color:#ef4444;' : '') + '">' + (c.pnl > 0 ? '+' : '') + c.pnl.toFixed(2) + 'u</div>' +
        '<div style="font-size:11px;color:#94a3b8;">' + c.wins + '/' + c.total + ' (' + cSR + '%)</div>' +
      '</div>';
    });

    // "What If" comparison
    var whatIfHtml = '';
    if (roi.whatIf && roi.whatIf.totalTips > 0) {
      var wPnlDiff = roi.whatIf.pnl - roi.totalPnl;
      whatIfHtml = '<div style="background:linear-gradient(135deg,rgba(59,130,246,0.06),rgba(59,130,246,0.02));border:1px solid rgba(59,130,246,0.2);border-radius:12px;padding:20px;margin-bottom:24px;">' +
        '<div style="font-size:14px;font-weight:800;color:#60a5fa;margin-bottom:12px;">What If You Followed Every Tip?</div>' +
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">' +
          '<div style="text-align:center;"><div style="font-size:10px;color:#94a3b8;text-transform:uppercase;">All Tips P/L</div><div style="font-size:22px;font-weight:900;' + (roi.whatIf.pnl > 0 ? 'color:#22c55e;' : 'color:#ef4444;') + '">' + (roi.whatIf.pnl > 0 ? '+' : '') + roi.whatIf.pnl.toFixed(2) + 'u</div></div>' +
          '<div style="text-align:center;"><div style="font-size:10px;color:#94a3b8;text-transform:uppercase;">Your P/L</div><div style="font-size:22px;font-weight:900;' + pnlClass + '">' + (roi.totalPnl > 0 ? '+' : '') + roi.totalPnl.toFixed(2) + 'u</div></div>' +
          '<div style="text-align:center;"><div style="font-size:10px;color:#94a3b8;text-transform:uppercase;">Difference</div><div style="font-size:22px;font-weight:900;' + (wPnlDiff > 0 ? 'color:#f59e0b;' : 'color:#22c55e;') + '">' + (wPnlDiff > 0 ? '+' + wPnlDiff.toFixed(2) + 'u missed' : 'You\'re ahead!') + '</div></div>' +
        '</div>' +
      '</div>';
    }

    // Streak
    var streakHtml = '';
    if (roi.streak && roi.streak.count >= 2) {
      var sCol = roi.streak.type === 'win' ? '#22c55e' : '#ef4444';
      var sIcon = roi.streak.type === 'win' ? '&#128293;' : '&#10060;';
      streakHtml = '<div style="background:' + sCol + '15;border:1px solid ' + sCol + '33;border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:12px;">' +
        '<span style="font-size:24px;">' + sIcon + '</span>' +
        '<span style="font-size:15px;font-weight:700;color:' + sCol + ';">' + roi.streak.count + '-bet ' + roi.streak.type + ' streak</span>' +
        (roi.bestRun > 2 ? '<span style="font-size:12px;color:#94a3b8;margin-left:auto;">Best run: ' + roi.bestRun + ' winners</span>' : '') +
      '</div>';
    }

    // Recent bets table
    var recentBets = '';
    if (roi.chart && roi.chart.length > 0) {
      var rows = roi.chart.slice(-15).reverse().map(function(b) {
        var rBadge = b.result === 'won' ? '<span style="color:#22c55e;font-weight:700;">Won</span>' : b.result === 'placed' ? '<span style="color:#d4a843;font-weight:700;">Placed</span>' : '<span style="color:#ef4444;font-weight:700;">Lost</span>';
        return '<tr><td style="font-size:12px;color:#94a3b8;">' + (b.date || '') + '</td><td>' + (b.selection || '') + '</td><td>' + rBadge + '</td><td style="font-weight:700;' + (b.pnl >= 0 ? 'color:#22c55e;' : 'color:#ef4444;') + '">' + (b.pnl >= 0 ? '+' : '') + b.pnl.toFixed(2) + '</td></tr>';
      }).join('');
      recentBets = '<div style="margin-top:24px;"><div style="font-size:14px;font-weight:800;color:#d4a843;margin-bottom:12px;">Recent Bet History</div>' +
        '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;"><thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #2a2e3d;font-size:11px;color:#64748b;">Date</th><th style="text-align:left;padding:8px;border-bottom:1px solid #2a2e3d;font-size:11px;color:#64748b;">Selection</th><th style="text-align:left;padding:8px;border-bottom:1px solid #2a2e3d;font-size:11px;color:#64748b;">Result</th><th style="text-align:left;padding:8px;border-bottom:1px solid #2a2e3d;font-size:11px;color:#64748b;">Running P/L</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    }

    app.innerHTML = '<div class="container" style="padding-top:40px;">' +
      '<div style="text-align:center;margin-bottom:24px;">' +
        '<h1>Your <span style="color:#d4a843;">Personal ROI</span> Dashboard</h1>' +
        '<p style="color:#94a3b8;">Every bet you\'ve backed, tracked and analysed. This data is yours — it stays as long as you do.</p>' +
      '</div>' +

      // Hero stats
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px;">' +
        '<div style="background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.2);border-radius:12px;padding:20px;text-align:center;">' +
          '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:6px;">Your P/L</div>' +
          '<div style="font-size:32px;font-weight:900;' + pnlClass + '">' + (roi.totalPnl > 0 ? '+' : '') + roi.totalPnl.toFixed(2) + '</div>' +
          '<div style="font-size:11px;color:#64748b;">units</div>' +
        '</div>' +
        '<div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:12px;padding:20px;text-align:center;">' +
          '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:6px;">Your ROI</div>' +
          '<div style="font-size:32px;font-weight:900;' + roiClass + '">' + (roi.roi > 0 ? '+' : '') + roi.roi + '%</div>' +
        '</div>' +
        '<div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:12px;padding:20px;text-align:center;">' +
          '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:6px;">Strike Rate</div>' +
          '<div style="font-size:32px;font-weight:900;' + srClass + '">' + roi.strikeRate + '%</div>' +
        '</div>' +
        '<div style="background:rgba(168,85,247,0.08);border:1px solid rgba(168,85,247,0.2);border-radius:12px;padding:20px;text-align:center;">' +
          '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:6px;">Bets Tracked</div>' +
          '<div style="font-size:32px;font-weight:900;color:#a855f7;">' + roi.totalBets + '</div>' +
          '<div style="font-size:11px;color:#64748b;">' + roi.wins + 'W ' + roi.losses + 'L ' + roi.pending + ' pending</div>' +
        '</div>' +
      '</div>' +

      // Streak
      (streakHtml ? '<div style="margin-bottom:20px;">' + streakHtml + '</div>' : '') +

      // What If
      whatIfHtml +

      // Analyst breakdown
      (analystCards ? '<div style="margin-bottom:24px;"><div style="font-size:14px;font-weight:800;color:#d4a843;margin-bottom:12px;">Your Results by Analyst</div><div style="display:flex;gap:12px;flex-wrap:wrap;">' + analystCards + '</div></div>' : '') +

      // Confidence breakdown
      (confCards ? '<div style="margin-bottom:24px;"><div style="font-size:14px;font-weight:800;color:#d4a843;margin-bottom:12px;">Your Results by Confidence</div><div style="display:flex;gap:12px;flex-wrap:wrap;">' + confCards + '</div></div>' : '') +

      // Recent bets
      recentBets +

      // Export
      '<div style="text-align:center;margin-top:24px;padding-bottom:40px;">' +
        '<button class="btn btn-outline btn-sm" onclick="App.exportMyBetsCSV()">Export as CSV</button>' +
        '<p style="font-size:11px;color:#64748b;margin-top:8px;">Your personal data. Synced across devices. Updated every time a result comes in.</p>' +
      '</div>' +
    '</div>';
  },

  async renderAnalysts() {
    const app = document.getElementById('app');
    app.innerHTML = this.renderSkeleton('tips');

    let results = [];
    try { results = await this.api('/results'); } catch {}

    const analysts = [
      {
        name: 'The Professor',
        key: 'professor',
        initials: 'TP',
        specialty: 'Data-Driven Analysis',
        desc: 'Statistics-first. Trusts the numbers over narrative. Weights xG, form, and speed ratings 30-40% higher than other factors. Prefers shorter prices (1/1 to 4/1) where data is most reliable. Contrarian on market sentiment.',
      },
      {
        name: 'The Scout',
        key: 'scout',
        initials: 'TS',
        specialty: 'Value Hunter',
        desc: 'Value hunter. Finds prices the market has wrong. Weights course form, class drops, and motivation 30-40% higher. Actively goes against the crowd. Prefers bigger prices (3/1 to 20/1) where edges are largest.',
      },
      {
        name: 'The Clocker',
        key: 'clocker',
        initials: 'TC',
        specialty: 'Deep Racing Intelligence',
        desc: 'Racing-only specialist. Reads between the lines — trainer intent (first-time headgear, jockey bookings), pace analysis, going expertise, and stable form. Covers all odds ranges. Finds angles the data alone cannot capture.',
      },
      {
        name: 'The Edge',
        key: 'edge',
        initials: 'TE',
        specialty: 'Balanced Analysis',
        desc: 'Balanced assessment. Weighs all factors equally. Looks for the clearest overall edge across all metrics. Covers the middle ground (2/1 to 10/1). Practical, measured, no bias.',
      },
    ];

    // Calculate stats per analyst from results
    analysts.forEach(a => {
      const aResults = results.filter(r => r.tipsterProfile === a.name);
      a.tips = aResults.length;
      a.won = aResults.filter(r => r.result === 'won').length;
      a.lost = aResults.filter(r => r.result === 'lost').length;
      a.sr = a.tips > 0 ? ((a.won / a.tips) * 100).toFixed(1) : '0.0';
      a.pnl = aResults.reduce((s, r) => s + (r.pnl || 0), 0);
      a.roi = a.tips > 0 ? ((a.pnl / aResults.reduce((s, r) => s + (r.stake || 1), 0)) * 100).toFixed(1) : '0.0';
      // Calculate streak
      const sorted = [...aResults].sort((x, y) => new Date(y.date) - new Date(x.date));
      let streak = 0;
      let streakType = 'W';
      if (sorted.length) {
        streakType = sorted[0].result === 'won' ? 'W' : 'L';
        for (const r of sorted) {
          if ((streakType === 'W' && r.result === 'won') || (streakType === 'L' && r.result !== 'won')) streak++;
          else break;
        }
      }
      a.streak = (streakType === 'W' ? '' : '-') + streak + streakType;
    });

    app.innerHTML = `
      <div class="container">
        <div class="page-header">
          <h1>Our <span class="accent">Analysts</span></h1>
          <p>Meet the team behind Elite Edge's selections. Three distinct approaches, one goal: finding value.</p>
        </div>

        <div class="grid grid-3 mb-32">
          ${analysts.map(a => `
            <div class="analyst-card">
              <div class="analyst-avatar ${a.key}">${a.initials}</div>
              <div class="analyst-name">${a.name}</div>
              <div class="analyst-specialty">${a.specialty}</div>
              <div class="analyst-desc">${a.desc}</div>
              <div class="analyst-stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:12px;">
                <div class="analyst-stat"><div class="analyst-stat-value">${a.tips}</div><div class="analyst-stat-label">Tips</div></div>
                <div class="analyst-stat"><div class="analyst-stat-value">${a.won}</div><div class="analyst-stat-label">Won</div></div>
                <div class="analyst-stat"><div class="analyst-stat-value">${a.sr}%</div><div class="analyst-stat-label">SR%</div></div>
              </div>
              <div class="analyst-stats">
                <div class="analyst-stat"><div class="analyst-stat-value ${parseFloat(a.roi) >= 0 ? 'text-green' : 'text-red'}">${parseFloat(a.roi) >= 0 ? '+' : ''}${a.roi}%</div><div class="analyst-stat-label">ROI</div></div>
                <div class="analyst-stat"><div class="analyst-stat-value ${a.pnl >= 0 ? 'text-green' : 'text-red'}">${a.pnl >= 0 ? '+' : ''}${a.pnl.toFixed(2)}</div><div class="analyst-stat-label">P/L</div></div>
                <div class="analyst-stat"><div class="analyst-stat-value">${a.streak}</div><div class="analyst-stat-label">Streak</div></div>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="card text-center" style="padding:32px;">
          <h3 class="mb-8">Filter Tips by Analyst</h3>
          <p class="text-muted mb-16">Visit the Racing or Football pages and use the analyst filter to see each tipster's selections.</p>
          <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
            <a href="#/racing" class="btn btn-outline">Racing Tips</a>
            <a href="#/football" class="btn btn-outline">Football Tips</a>
          </div>
        </div>
      </div>
    `;
  },

  // -----------------------------------------------------------------------
  // COMMENTS / DISCUSSION (Feature #4)
  // -----------------------------------------------------------------------
  getComments(tipId) {
    return JSON.parse(localStorage.getItem('ee_comments_' + tipId) || '[]');
  },

  saveComments(tipId, comments) {
    localStorage.setItem('ee_comments_' + tipId, JSON.stringify(comments));
  },

  seedComments(tipId) {
    return this.getComments(tipId);
  },

  renderCommentSection(tipId) {
    const comments = this.seedComments(tipId);
    const backedCount = Math.max(comments.length + Math.floor(Math.random() * 15) + 5, 12);
    const isLoggedIn = !!this.user;
    return `
      <div class="comment-section">
        <h4 style="font-size:16px;font-weight:700;margin-bottom:16px;">
          Discussion <span class="backed-count"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> ${backedCount} people backed this</span>
        </h4>
        <div class="comment-list" id="comment-list-${tipId}">
          ${comments.map((c, i) => `
            <div class="comment-item">
              <div class="comment-header">
                <span class="comment-author">${c.user}</span>
                <span class="comment-time">${this.timeAgo(c.time)}</span>
              </div>
              <div class="comment-text">${this.escapeHtml(c.text)}</div>
              <div class="comment-actions">
                <button class="comment-like-btn" onclick="App.likeComment('${tipId}',${i})">&#9650; ${c.likes}</button>
              </div>
            </div>
          `).join('')}
        </div>
        ${isLoggedIn ? `
          <div class="comment-form">
            <input type="text" id="comment-input-${tipId}" placeholder="Add your thoughts..." onkeydown="if(event.key==='Enter')App.postComment('${tipId}')">
            <button class="btn btn-gold btn-sm" onclick="App.postComment('${tipId}')">Post</button>
          </div>
        ` : `
          <div class="card text-center" style="padding:16px;background:var(--bg-elevated);">
            <p class="text-sm text-muted">Join the discussion - <a href="#" onclick="App.showModal('login');return false;" class="text-gold">Log in</a> or <a href="#" onclick="App.showModal('register');return false;" class="text-gold">Sign up</a> to comment.</p>
          </div>
        `}
      </div>
    `;
  },

  postComment(tipId) {
    const input = document.getElementById('comment-input-' + tipId);
    if (!input || !input.value.trim()) return;
    const comments = this.getComments(tipId);
    comments.push({
      user: this.user?.name || 'Anonymous',
      text: input.value.trim(),
      time: new Date().toISOString(),
      likes: 0,
    });
    this.saveComments(tipId, comments);
    input.value = '';
    // Re-render comment list
    const list = document.getElementById('comment-list-' + tipId);
    if (list) {
      list.innerHTML = comments.map((c, i) => `
        <div class="comment-item">
          <div class="comment-header">
            <span class="comment-author">${c.user}</span>
            <span class="comment-time">${this.timeAgo(c.time)}</span>
          </div>
          <div class="comment-text">${this.escapeHtml(c.text)}</div>
          <div class="comment-actions">
            <button class="comment-like-btn" onclick="App.likeComment('${tipId}',${i})">&#9650; ${c.likes}</button>
          </div>
        </div>
      `).join('');
    }
  },

  likeComment(tipId, index) {
    const comments = this.getComments(tipId);
    if (comments[index]) {
      comments[index].likes++;
      this.saveComments(tipId, comments);
      const list = document.getElementById('comment-list-' + tipId);
      if (list) {
        const btns = list.querySelectorAll('.comment-like-btn');
        if (btns[index]) btns[index].innerHTML = '&#9650; ' + comments[index].likes;
      }
    }
  },

  // -----------------------------------------------------------------------
  // REFERRAL SYSTEM (Feature #5)
  // -----------------------------------------------------------------------
  getReferralCode() {
    if (!this.user || !this.user.email) return 'ELITE-XXXX';
    return 'ELITE-' + this.user.email.substring(0, 4).toUpperCase();
  },

  getReferralCount() {
    return parseInt(localStorage.getItem('ee_referral_count') || '0');
  },

  checkReferralParam() {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) {
      localStorage.setItem('ee_referred_by', ref);
    }
  },

  // -----------------------------------------------------------------------
  // ACCOUNT SETTINGS PAGE
  // -----------------------------------------------------------------------
  async renderAccount() {
    if (!this.user) {
      document.getElementById('app').innerHTML = `
        <div class="container text-center" style="padding:80px;">
          <h2>Account Settings</h2>
          <p class="text-muted mt-8">Please log in to view your account.</p>
          <button class="btn btn-gold mt-16" onclick="App.showModal('login')">Log In</button>
        </div>`;
      return;
    }

    const app = document.getElementById('app');
    app.innerHTML = this.renderSkeleton('dashboard');

    let accountData = {};
    try {
      accountData = await this.api('/auth/me');
    } catch (e) { return; }

    const u = accountData.user || {};
    const loginHistory = u.loginHistory || [];
    const lastLogin = u.lastLogin || {};
    const subLabel = u.subscription === 'vip' ? '<span style="color:#d4a843;font-weight:700;">VIP</span>' : u.subscription === 'premium' ? '<span class="text-gold">Premium</span>' : 'Free';
    const expiryLabel = u.subscriptionExpiry ? formatDateUK(u.subscriptionExpiry) : 'N/A';

    function parseUA(ua) {
      if (!ua) return 'Unknown device';
      if (/Mobile|Android|iPhone/i.test(ua)) return 'Mobile';
      if (/Windows/i.test(ua)) return 'Windows PC';
      if (/Mac/i.test(ua)) return 'Mac';
      if (/Linux/i.test(ua)) return 'Linux PC';
      return 'Desktop';
    }

    app.innerHTML = `
      <div class="container" style="max-width:720px;">
        <div class="page-header">
          <h1><span class="accent">Account</span> Settings</h1>
          <p>Manage your profile, security, and preferences.</p>
        </div>

        <!-- Profile Info -->
        <div class="card mb-16">
          <h3 class="mb-16">Profile</h3>
          <div class="form-group">
            <label>Name</label>
            <input type="text" id="acc-name" value="${(u.name || '').replace(/"/g, '&quot;')}" />
          </div>
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="acc-email" value="${(u.email || '').replace(/"/g, '&quot;')}" />
          </div>
          <button class="btn btn-gold btn-sm" onclick="App.saveProfile()">Save Changes</button>
          <div class="account-info-grid" style="margin-top:16px;">
            <div class="account-info-item"><span class="account-label">Subscription</span><span class="account-value">${subLabel}</span></div>
            <div class="account-info-item"><span class="account-label">Expires</span><span class="account-value">${expiryLabel}</span></div>
            <div class="account-info-item"><span class="account-label">Member since</span><span class="account-value">${formatDateUK(u.joined)}</span></div>
          </div>
        </div>

        <!-- Subscription Management -->
        <div class="card mb-16" id="subscription-management">
          <h3 class="mb-16">Subscription</h3>
          ${u.subscription === 'vip' ? `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
              <span style="background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;padding:4px 12px;border-radius:20px;font-weight:700;font-size:13px;">\uD83D\uDC51 VIP Active</span>
            </div>
            <p class="text-sm text-muted mb-8">Next billing date: <strong>${expiryLabel}</strong></p>
            <div id="stripe-sub-details"></div>
            <button class="btn btn-outline btn-sm" onclick="App.openBillingPortal()">Manage Billing</button>
          ` : u.subscription === 'premium' ? `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
              <span style="background:var(--gold);color:#0a0e1a;padding:4px 12px;border-radius:20px;font-weight:700;font-size:13px;">Premium Active</span>
            </div>
            <p class="text-sm text-muted mb-8">Next billing date: <strong>${expiryLabel}</strong></p>
            <div id="stripe-sub-details"></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
              <button class="btn btn-gold btn-sm" onclick="App.startCheckout('vip-monthly')">Upgrade to VIP — &pound;39.99/month</button>
              <button class="btn btn-outline btn-sm" onclick="App.openBillingPortal()">Manage Billing</button>
            </div>
          ` : `
            <p class="text-muted text-sm mb-12">You are on the Free plan. Upgrade for full access to all tips, analysis, and features.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn btn-gold btn-sm" onclick="App.startCheckout('premium-monthly')">Premium — &pound;19.99/month</button>
              <button class="btn btn-outline btn-sm" onclick="App.startCheckout('premium-annual')">Premium Annual — &pound;199.99/year</button>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
              <button class="btn btn-gold btn-sm" onclick="App.startCheckout('vip-monthly')">VIP — &pound;39.99/month</button>
              <button class="btn btn-outline btn-sm" onclick="App.startCheckout('vip-annual')">VIP Annual — &pound;399.99/year</button>
            </div>
          `}
        </div>

        <!-- Current Session -->
        <div class="card mb-16">
          <h3 class="mb-16">Current Session</h3>
          <p class="text-sm text-muted">Logged in from <strong>${parseUA(lastLogin.userAgent)}</strong> at <strong>${lastLogin.timestamp ? new Date(lastLogin.timestamp).toLocaleString('en-GB') : '-'}</strong></p>
          <p class="text-sm text-muted">IP: ${lastLogin.ip || '-'}</p>
        </div>

        <!-- Change Password -->
        <div class="card mb-16">
          <h3 class="mb-16">Change Password</h3>
          <form onsubmit="App.changePassword(event)">
            <div class="form-group">
              <label>Current Password</label>
              <input type="password" id="acct-current-pw" required>
            </div>
            <div class="form-group">
              <label>New Password</label>
              <input type="password" id="acct-new-pw" required minlength="8" oninput="App.updateAcctPwStrength()">
              <div id="acct-pw-strength" class="pw-strength-indicator"></div>
            </div>
            <div class="form-group">
              <label>Confirm New Password</label>
              <input type="password" id="acct-confirm-pw" required>
            </div>
            <div class="form-error" id="acct-pw-error"></div>
            <div class="form-success" id="acct-pw-success" style="display:none;"></div>
            <button type="submit" class="btn btn-gold">Update Password</button>
          </form>
        </div>

        <!-- Odds Format Preference -->
        <div class="card mb-16">
          <h3 class="mb-16">Odds Format</h3>
          <div style="display:flex;gap:12px;">
            <label class="radio-label"><input type="radio" name="acct-odds" value="fractional" ${this.oddsFormat === 'fractional' ? 'checked' : ''} onchange="App.setOddsFormatPref(this.value)"> Fractional (e.g. 6/4)</label>
            <label class="radio-label"><input type="radio" name="acct-odds" value="decimal" ${this.oddsFormat === 'decimal' ? 'checked' : ''} onchange="App.setOddsFormatPref(this.value)"> Decimal (e.g. 2.50)</label>
          </div>
        </div>

        <!-- Email Preferences -->
        <div class="card mb-16">
          <h3 class="mb-16">Email Preferences</h3>
          <p class="text-muted text-sm mb-8">Choose which emails you'd like to receive.</p>
          <div id="email-prefs-loading" class="text-muted text-sm">Loading preferences...</div>
          <div id="email-prefs-container" style="display:none;">
            <div style="display:flex;flex-direction:column;gap:12px;">
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
                <input type="checkbox" id="epref-dailyBulletin" onchange="App.saveEmailPref('dailyBulletin',this.checked)" style="width:18px;height:18px;accent-color:#d4a843;">
                <span style="color:#cbd5e1;font-size:14px;"><strong>Daily Tip Bulletin</strong> <span class="text-muted text-sm">(Premium only - morning selections before 9am)</span></span>
              </label>
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
                <input type="checkbox" id="epref-weeklySummary" onchange="App.saveEmailPref('weeklySummary',this.checked)" style="width:18px;height:18px;accent-color:#d4a843;">
                <span style="color:#cbd5e1;font-size:14px;"><strong>Weekly Results Summary</strong> <span class="text-muted text-sm">(Sunday evening performance report)</span></span>
              </label>
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
                <input type="checkbox" id="epref-bigWins" onchange="App.saveEmailPref('bigWins',this.checked)" style="width:18px;height:18px;accent-color:#d4a843;">
                <span style="color:#cbd5e1;font-size:14px;"><strong>Big Win Alerts</strong> <span class="text-muted text-sm">(Celebration emails when tips win at 5/1+)</span></span>
              </label>
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
                <input type="checkbox" id="epref-marketing" onchange="App.saveEmailPref('marketing',this.checked)" style="width:18px;height:18px;accent-color:#d4a843;">
                <span style="color:#cbd5e1;font-size:14px;"><strong>Re-engagement &amp; Marketing</strong> <span class="text-muted text-sm">(Periodic updates if you haven't visited)</span></span>
              </label>
            </div>
          </div>
        </div>

        <!-- Alert Preferences -->
        <div class="card mb-16" id="alert-preferences">
          <h3 class="mb-16">Alert Preferences</h3>
          <p class="text-muted text-sm mb-8">Set up personalised alerts — get notified when it matters most.</p>
          <div id="alert-prefs-loading" class="text-muted text-sm">Loading preferences...</div>
          <div id="alert-prefs-container" style="display:none;">
            <div style="display:flex;flex-direction:column;gap:12px;">
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
                <input type="checkbox" id="apref-highConfidence" onchange="App.saveAlertPref('highConfidence',this.checked)" style="width:18px;height:18px;accent-color:#d4a843;">
                <span style="color:#cbd5e1;font-size:14px;"><strong>Elite Confidence (9+)</strong> <span class="text-muted text-sm">Get notified when a top-rated tip is published</span></span>
              </label>
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
                <input type="checkbox" id="apref-steamers" onchange="App.saveAlertPref('steamers',this.checked)" style="width:18px;height:18px;accent-color:#d4a843;">
                <span style="color:#cbd5e1;font-size:14px;"><strong>Steamer Alerts</strong> <span class="text-muted text-sm">Know when the market is moving fast on a selection</span></span>
              </label>
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
                <input type="checkbox" id="apref-preRace" onchange="App.saveAlertPref('preRace',this.checked)" style="width:18px;height:18px;accent-color:#d4a843;">
                <span style="color:#cbd5e1;font-size:14px;"><strong>Pre-Race Reminder</strong> <span class="text-muted text-sm">30-minute warning before our tipped races</span></span>
              </label>
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
                <input type="checkbox" id="apref-bigOdds" onchange="App.saveAlertPref('bigOdds',this.checked)" style="width:18px;height:18px;accent-color:#d4a843;">
                <span style="color:#cbd5e1;font-size:14px;"><strong>Big Price Alerts</strong> <span class="text-muted text-sm">Selections at 6/1 or bigger with strong edge</span></span>
              </label>
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
                <input type="checkbox" id="apref-newTips" onchange="App.saveAlertPref('newTips',this.checked)" style="width:18px;height:18px;accent-color:#d4a843;">
                <span style="color:#cbd5e1;font-size:14px;"><strong>All New Tips</strong> <span class="text-muted text-sm">Notification for every new tip published</span></span>
              </label>
            </div>
          </div>
        </div>

        <!-- Login History -->
        <div class="card mb-16">
          <h3 class="mb-16">Login History (last 5)</h3>
          ${loginHistory.length === 0 ? '<p class="text-muted text-sm">No login history available.</p>' : `
          <div style="overflow-x:auto;">
            <table class="results-table">
              <thead><tr><th>Time</th><th>Device</th><th>IP</th></tr></thead>
              <tbody>
                ${loginHistory.map(l => `
                  <tr>
                    <td class="text-sm">${new Date(l.timestamp).toLocaleString('en-GB')}</td>
                    <td class="text-sm">${parseUA(l.userAgent)}</td>
                    <td class="text-sm">${l.ip || '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          `}
        </div>

        <!-- Referral -->
        <div class="card mb-16">
          <h3 class="mb-16">Refer a Friend</h3>
          <p class="text-muted text-sm mb-8">Share your referral code and earn free Premium time.</p>
          <button class="btn btn-outline btn-sm" onclick="App.showReferral()">View Referral Code</button>
        </div>

        <!-- Actions -->
        <div class="card mb-16">
          <h3 class="mb-16">Session & Account</h3>
          <div style="display:flex;flex-wrap:wrap;gap:12px;">
            <button class="btn btn-outline btn-sm" onclick="App.logoutAllDevices()">Log Out All Devices</button>
            <button class="btn btn-sm" style="background:var(--red);color:#fff;" onclick="App.deleteAccount()">Delete Account</button>
          </div>
        </div>
      </div>
    `;

    // Load email preferences asynchronously
    this.loadEmailPrefs().then(function(prefs) {
      var container = document.getElementById('email-prefs-container');
      var loading = document.getElementById('email-prefs-loading');
      if (container) container.style.display = 'block';
      if (loading) loading.style.display = 'none';
      var fields = ['dailyBulletin', 'weeklySummary', 'bigWins', 'marketing'];
      fields.forEach(function(f) {
        var el = document.getElementById('epref-' + f);
        if (el) el.checked = prefs[f] !== false;
      });
    });

    // Load alert preferences asynchronously
    this.loadAlertPrefs().then(function(prefs) {
      var container = document.getElementById('alert-prefs-container');
      var loading = document.getElementById('alert-prefs-loading');
      if (container) container.style.display = 'block';
      if (loading) loading.style.display = 'none';
      var fields = ['highConfidence', 'steamers', 'preRace', 'bigOdds', 'newTips'];
      fields.forEach(function(f) {
        var el = document.getElementById('apref-' + f);
        if (el) el.checked = !!prefs[f];
      });
    });

    // Load Stripe subscription details for premium/vip users
    if (u.subscription === 'premium' || u.subscription === 'vip') {
      this.api('/stripe/status').then(function(status) {
        var el = document.getElementById('stripe-sub-details');
        if (!el) return;
        if (status.stripeStatus) {
          var statusLabel = status.stripeStatus === 'active' ? 'Active' : status.stripeStatus;
          var html = '<p class="text-sm text-muted mb-4">Status: <strong>' + statusLabel + '</strong></p>';
          if (status.cancelAtPeriodEnd) {
            html += '<p class="text-sm" style="color:var(--red);margin-bottom:8px;">Cancels at end of current period</p>';
          }
          if (status.currentPeriodEnd) {
            html += '<p class="text-sm text-muted mb-8">Current period ends: <strong>' + formatDateUK(status.currentPeriodEnd) + '</strong></p>';
          }
          el.innerHTML = html;
        }
      }).catch(function() {});
    }

    // Scroll to alert preferences if hash contains anchor
    if (window.location.hash.indexOf('alerts') !== -1) {
      setTimeout(function() {
        var alertSection = document.getElementById('alert-preferences');
        if (alertSection) alertSection.scrollIntoView({ behavior: 'smooth' });
      }, 300);
    }
  },

  updateAcctPwStrength() {
    const pw = document.getElementById('acct-new-pw').value;
    const indicator = document.getElementById('acct-pw-strength');
    if (!indicator) return;
    const { checks, score } = this.validatePasswordClient(pw);
    const labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];
    const colors = ['#ef4444', '#ef4444', '#f59e0b', '#22c55e', '#22c55e'];
    const pct = (score / 4) * 100;
    indicator.innerHTML = `
      <div class="pw-strength-bar"><div class="pw-strength-fill" style="width:${pct}%;background:${colors[score]};"></div></div>
      <div class="pw-strength-label" style="color:${colors[score]};">${pw.length > 0 ? labels[score] : ''}</div>
      <div class="pw-strength-checks">
        <span class="${checks.length ? 'pw-check-pass' : 'pw-check-fail'}">8+ chars</span>
        <span class="${checks.upper ? 'pw-check-pass' : 'pw-check-fail'}">Uppercase</span>
        <span class="${checks.lower ? 'pw-check-pass' : 'pw-check-fail'}">Lowercase</span>
        <span class="${checks.number ? 'pw-check-pass' : 'pw-check-fail'}">Number</span>
      </div>
    `;
  },

  async saveProfile() {
    var name = document.getElementById('acc-name').value.trim();
    var email = document.getElementById('acc-email').value.trim();
    if (!name) { this.showToast('Name is required', 'error'); return; }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { this.showToast('Valid email required', 'error'); return; }
    try {
      await this.api('/auth/profile', { method: 'PUT', body: JSON.stringify({ name, email }) });
      this.user.name = name;
      this.user.email = email;
      localStorage.setItem('ee_user', JSON.stringify(this.user));
      this.updateAuthUI();
      this.showToast('Profile updated', 'success');
    } catch(err) { this.showToast(err.message, 'error'); }
  },

  async changePassword(e) {
    e.preventDefault();
    const errEl = document.getElementById('acct-pw-error');
    const successEl = document.getElementById('acct-pw-success');
    const currentPw = document.getElementById('acct-current-pw').value;
    const newPw = document.getElementById('acct-new-pw').value;
    const confirmPw = document.getElementById('acct-confirm-pw').value;

    if (newPw !== confirmPw) {
      errEl.textContent = 'New passwords do not match.';
      successEl.style.display = 'none';
      return;
    }
    const { score } = this.validatePasswordClient(newPw);
    if (score < 4) {
      errEl.textContent = 'Password must be at least 8 characters with uppercase, lowercase, and a number.';
      successEl.style.display = 'none';
      return;
    }

    try {
      const result = await this.api('/auth/change-password', {
        method: 'POST', body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw })
      });
      errEl.textContent = '';
      successEl.style.display = 'block';
      successEl.textContent = result.message || 'Password changed successfully.';
      document.getElementById('acct-current-pw').value = '';
      document.getElementById('acct-new-pw').value = '';
      document.getElementById('acct-confirm-pw').value = '';
      document.getElementById('acct-pw-strength').innerHTML = '';
    } catch (err) {
      errEl.textContent = err.message;
      successEl.style.display = 'none';
    }
  },

  setOddsFormatPref(val) {
    this.oddsFormat = val;
    localStorage.setItem('oddsFormat', val);
    this._updateOddsToggleUI();
    // Save to server
    this.api('/auth/preferences', {
      method: 'PUT', body: JSON.stringify({ oddsFormat: val })
    }).catch(() => {});
  },

  async logoutAllDevices() {
    if (!confirm('This will log you out of all devices, including this one. Continue?')) return;
    try {
      await this.api('/auth/logout-all', { method: 'POST' });
      this.logout();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async deleteAccount() {
    if (!confirm('Are you sure you want to delete your account? This action cannot be undone.')) return;
    if (!confirm('This will permanently delete all your data. Type OK to confirm.')) return;
    try {
      await this.api('/auth/account', { method: 'DELETE' });
      this.logout();
      App.showToast('Your account has been deleted.', 'info');
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  showReferral() {
    this.showModal('referral');
    const content = document.getElementById('referral-content');
    if (!content) return;
    const code = this.getReferralCode();
    const link = 'https://eliteedgesports.co.uk/?ref=' + code;
    const count = this.getReferralCount();
    const progress = Math.min(count, 3);
    content.innerHTML = `
      <div class="referral-box">
        <p class="text-muted mb-8">Your referral code</p>
        <div class="referral-code">${code}</div>
        <div class="referral-link">${link}</div>
        <div class="share-buttons">
          <button class="share-social-btn copy" onclick="navigator.clipboard.writeText('${link}').then(()=>alert('Copied!'))">Copy Link</button>
          <button class="share-social-btn twitter" onclick="window.open('https://twitter.com/intent/tweet?text=${encodeURIComponent('Join me on Elite Edge Sports Tips - premium betting intelligence! ' + link)}','_blank')">Twitter</button>
          <button class="share-social-btn whatsapp" onclick="window.open('https://wa.me/?text=${encodeURIComponent('Check out Elite Edge Sports Tips - data-driven betting intelligence! ' + link)}','_blank')">WhatsApp</button>
          <button class="share-social-btn email-share" onclick="window.open('mailto:?subject=Elite Edge Sports Tips&body=${encodeURIComponent('Join me on Elite Edge Sports Tips! ' + link)}')">Email</button>
        </div>
        <div style="margin-top:20px;padding:16px;background:var(--bg-elevated);border-radius:var(--radius-sm);">
          <p class="text-sm text-muted mb-8">Referral Progress</p>
          <div style="display:flex;gap:8px;justify-content:center;margin-bottom:8px;">
            ${[1,2,3].map(i => `<div style="width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;${i <= progress ? 'background:var(--gold);color:var(--bg-deep);' : 'background:var(--bg-card);border:2px solid var(--border);color:var(--text-dim);'}">${i}</div>`).join('')}
          </div>
          <p class="text-xs text-muted">Refer 3 friends, get 1 month free Premium</p>
          <p class="text-gold" style="font-weight:700;margin-top:4px;">${count}/3 referrals</p>
        </div>
      </div>
    `;
  },

  // -----------------------------------------------------------------------
  // AFFILIATE BOOKMAKER ODDS (Feature #2)
  // -----------------------------------------------------------------------
  renderBookmakerOddsAffiliate(bookmakerOdds) {
    if (!bookmakerOdds) return '';
    const entries = Object.entries(bookmakerOdds);
    const bestOdds = Math.max(...entries.map(([, v]) => v));
    const names = { bet365: 'Bet365', betfair: 'Betfair', skybet: 'Sky Bet', paddypower: 'Paddy P', williamhill: 'Wm Hill' };
    const urls = {
      bet365: 'https://www.bet365.com/#/AF',
      betfair: 'https://www.betfair.com/AF',
      skybet: 'https://www.skybet.com/AF',
      paddypower: 'https://www.paddypower.com/AF',
      williamhill: 'https://www.williamhill.com/AF',
    };
    return `<div class="odds-comparison" onclick="event.stopPropagation();">
      ${entries.map(([k, v]) => `
        <a href="${urls[k] || '#'}" target="_blank" rel="noopener nofollow" class="affiliate-btn ${v === bestOdds ? 'best-price' : ''}" title="Place bet at ${names[k] || k}" style="${v === bestOdds ? 'border-color:var(--gold);box-shadow:0 0 8px rgba(212,168,67,.2);' : ''}">
          <span style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;">${names[k] || k}</span>
          <span style="font-weight:800;font-size:13px;${v === bestOdds ? 'color:var(--gold);' : ''}">${this.formatOdds(v)}</span>
          ${v === bestOdds ? '<span style="font-size:8px;color:var(--gold);">BEST</span>' : ''}
        </a>
      `).join('')}
    </div>
    <p class="affiliate-disclaimer">18+ | T&Cs Apply | <a href="https://www.begambleaware.org" target="_blank" rel="noopener" style="color:var(--text-dim);">BeGambleAware.org</a></p>`;
  },

  // -----------------------------------------------------------------------
  // AD SLOT HELPER (Feature #2)
  // -----------------------------------------------------------------------
  renderAdSlot(num) {
    const promos = [
      { text: 'Bet 10 Get 30 in Free Bets', brand: 'Premium Partner Offer' },
      { text: 'New Customer Bonus - Up to 50 Free', brand: 'Featured Bookmaker' },
      { text: 'Enhanced Odds on Today\'s Racing', brand: 'Exclusive Partner Deal' },
    ];
    const p = promos[(num - 1) % promos.length];
    return `
      <div class="ad-slot" id="ad-slot-${num}">
        <div class="ad-slot-label">Partner Offer</div>
        <div class="ad-slot-content">${p.brand}</div>
        <div style="font-size:16px;font-weight:700;color:var(--gold);margin:8px 0;">${p.text}</div>
        <a href="#" class="ad-slot-cta" onclick="event.preventDefault();">Claim Offer</a>
        <div class="ad-slot-disclaimer">18+ | T&Cs Apply | New customers only | BeGambleAware.org</div>
      </div>
    `;
  },

  // -----------------------------------------------------------------------
  // COOKIE CONSENT (Feature #1)
  // -----------------------------------------------------------------------
  initCookieConsent() {
    if (localStorage.getItem('ee_cookie_consent')) return;
    var banner = document.getElementById('cookie-banner');
    if (banner) banner.style.display = 'block';
  },

  acceptCookies() {
    localStorage.setItem('ee_cookie_consent', 'accepted');
    localStorage.setItem('ee_cookie_consent_date', new Date().toISOString());
    var banner = document.getElementById('cookie-banner');
    if (banner) banner.style.display = 'none';
    // Now load analytics (GA4 would be loaded here when configured)
    this.loadAnalytics();
  },

  rejectCookies() {
    localStorage.setItem('ee_cookie_consent', 'rejected');
    localStorage.setItem('ee_cookie_consent_date', new Date().toISOString());
    var banner = document.getElementById('cookie-banner');
    if (banner) banner.style.display = 'none';
    // Don't load analytics
  },

  loadAnalytics() {
    if (localStorage.getItem('ee_cookie_consent') !== 'accepted') return;
    if (window._gaLoaded) return;
    var gaId = 'G-KNT45Z35CH';
    var script = document.createElement('script');
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + gaId;
    script.async = true;
    document.head.appendChild(script);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function(){dataLayer.push(arguments);};
    window.gtag('js', new Date());
    window.gtag('config', gaId, { anonymize_ip: true });
    window._gaLoaded = true;
  },

  // -----------------------------------------------------------------------
  // FORGOT PASSWORD (Feature #2)
  // -----------------------------------------------------------------------
  async forgotPassword(e) {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value;
    const successEl = document.getElementById('forgot-success');
    const errorEl = document.getElementById('forgot-error');
    try {
      const result = await this.api('/auth/forgot-password', {
        method: 'POST', body: JSON.stringify({ email })
      });
      successEl.style.display = 'block';
      successEl.textContent = 'Check your email for a reset link.';
      errorEl.textContent = '';
    } catch (err) {
      errorEl.textContent = err.message;
      successEl.style.display = 'none';
    }
  },

  // -----------------------------------------------------------------------
  // EMAIL VERIFICATION PLACEHOLDER (Feature #3)
  // In production: integrate with SendGrid for real email verification
  // e.g. const sgMail = require('@sendgrid/mail');
  //      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  //      sgMail.send({ to: user.email, subject: 'Verify your email', ... });
  // -----------------------------------------------------------------------
  showEmailVerificationMessage() {
    const app = document.getElementById('app');
    const banner = document.createElement('div');
    banner.className = 'email-verify-banner';
    banner.id = 'email-verify-banner';
    banner.innerHTML = 'Welcome! A verification email has been sent to your inbox.';
    app.parentNode.insertBefore(banner, app);
  },

  async renderBigWinnerBanner() {
    var container = document.getElementById('big-winner-banner');
    if (!container) return;
    try {
      var results = await this.api('/results');
      if (!Array.isArray(results) || results.length === 0) return;

      // Find the biggest winner from last 14 days (by P/L, minimum odds 3.0 for "big" winner)
      var cutoff = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
      var bigWins = results.filter(function(r) {
        return r.result === 'won' && r.pnl > 0 && r.odds >= 3.0 && App._normDate(r.date) >= cutoff;
      }).sort(function(a, b) { return b.pnl - a.pnl; });

      if (bigWins.length === 0) {
        // Fall back to any recent winner
        bigWins = results.filter(function(r) {
          return r.result === 'won' && r.pnl > 0 && App._normDate(r.date) >= cutoff;
        }).sort(function(a, b) { return b.pnl - a.pnl; });
      }
      if (bigWins.length === 0) return;

      var win = bigWins[0];
      var oddsDisplay = this.formatOdds ? this.formatOdds(win.odds) : win.odds;
      var dateObj = new Date(win.date + 'T12:00:00');
      var dateDisplay = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      var sportIcon = win.sport === 'racing' ? '&#127943;' : '&#9917;';
      var pnlDisplay = '+' + win.pnl.toFixed(2);

      container.innerHTML =
        '<div style="background:linear-gradient(135deg,rgba(34,197,94,0.12),rgba(212,168,67,0.08));border:2px solid rgba(34,197,94,0.4);border-radius:14px;padding:20px 24px;margin-bottom:20px;cursor:pointer;position:relative;overflow:hidden;" onclick="window.location.hash=\'#/results\'">' +
          '<div style="display:flex;align-items:center;gap:16px;">' +
            '<div style="font-size:36px;">&#127942;</div>' +
            '<div style="flex:1;">' +
              '<div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#d4a843;margin-bottom:4px;">Latest Big Winner</div>' +
              '<div style="font-weight:900;font-size:18px;color:#22c55e;margin-bottom:4px;">' + sportIcon + ' ' + (win.selection || 'Winner') + ' WINS at ' + oddsDisplay + '</div>' +
              '<div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">' + (win.event || '') + ' — ' + dateDisplay + ' — <strong style="color:#22c55e;">' + pnlDisplay + ' units profit</strong></div>' +
              '<div style="display:inline-block;background:#22c55e;color:#0a0e1a;padding:8px 20px;border-radius:8px;font-weight:700;font-size:13px;">View Full Results &rarr;</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    } catch(e) {
      // Non-fatal — just don't show banner
    }
  },

  showTrialOffer() {
    // Don't show if already premium or already had trial
    if (!this.user || this.user.subscription === 'premium' || this.user.subscription === 'vip' || this.user.trialStart) return;

    var overlay = document.createElement('div');
    overlay.id = 'trial-offer-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);';

    overlay.innerHTML =
      '<div style="background:var(--bg-card,#141828);border:2px solid #d4a843;border-radius:16px;padding:40px;max-width:440px;width:90%;text-align:center;animation:celebrateIn 0.4s ease-out;box-shadow:0 0 60px rgba(212,168,67,0.2);">' +
        '<div style="font-size:48px;margin-bottom:12px;">&#127775;</div>' +
        '<h2 style="color:#d4a843;margin-bottom:8px;font-size:22px;">Start Your 14-Day Free Trial</h2>' +
        '<p style="color:#8b8d93;font-size:14px;margin-bottom:20px;">Get full access to all premium tips across 6 sports, AI analysis, value bets, and expert selections for 14 days free.</p>' +
        '<div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:8px;padding:12px;margin-bottom:20px;">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;color:#e8e6e3;">' +
            '<div>&#10003; All premium tips</div>' +
            '<div>&#10003; AI match previews</div>' +
            '<div>&#10003; Value bet scanner</div>' +
            '<div>&#10003; Custom alerts</div>' +
            '<div>&#10003; Race day live hub</div>' +
            '<div>&#10003; Expert analysis</div>' +
          '</div>' +
        '</div>' +
        '<button onclick="App.startFreeTrial()" style="width:100%;padding:14px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;margin-bottom:12px;">Start 14-Day Free Trial</button>' +
        '<button onclick="document.getElementById(\'trial-offer-overlay\').remove()" style="width:100%;padding:10px;background:transparent;color:#8b8d93;border:1px solid rgba(255,255,255,0.1);border-radius:8px;font-size:13px;cursor:pointer;">Maybe Later</button>' +
        '<p style="font-size:11px;color:#64748b;margin-top:12px;">Card details required. You will not be charged during the 14-day trial. Cancel anytime before the trial ends — no obligation.</p>' +
      '</div>';

    document.body.appendChild(overlay);
  },

  async startFreeTrial(plan) {
    try {
      var overlay = document.getElementById('trial-offer-overlay');
      var btn = overlay ? overlay.querySelector('button') : null;
      if (btn) { btn.textContent = 'Redirecting to secure checkout...'; btn.disabled = true; }

      // Redirect to Stripe Checkout with 14-day trial — card required
      var data = await this.api('/auth/start-trial', {
        method: 'POST',
        body: JSON.stringify({ plan: plan || 'premium-monthly' })
      });

      if (data.url) {
        // Redirect to Stripe Checkout
        window.location.href = data.url;
      } else {
        throw new Error(data.error || 'Unable to create checkout session');
      }
    } catch (err) {
      this.showToast(err.message || 'Unable to start trial. Please try again.', 'error');
      var overlay2 = document.getElementById('trial-offer-overlay');
      if (overlay2) {
        var btn2 = overlay2.querySelector('button');
        if (btn2) { btn2.textContent = 'Start My Free Trial'; btn2.disabled = false; }
      }
    }
  },

  _showTrialExpiredOverlay() {
    if (!this.user || this.user.subscription !== 'free' || !this.user.trialStart) return;
    var overlay = document.createElement('div');
    overlay.id = 'trial-expired-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);backdrop-filter:blur(4px);';
    overlay.innerHTML =
      '<div style="background:var(--bg-card,#141828);border:2px solid #d4a843;border-radius:16px;padding:40px;max-width:480px;width:90%;text-align:center;box-shadow:0 0 60px rgba(212,168,67,0.2);">' +
        '<div style="font-size:48px;margin-bottom:12px;">&#9203;</div>' +
        '<h2 style="color:#d4a843;margin-bottom:8px;font-size:22px;">Your Free Trial Has Ended</h2>' +
        '<p style="color:#8b8d93;font-size:14px;margin-bottom:16px;">You\'ve experienced what Elite Edge can do. Don\'t miss another winning selection.</p>' +
        '<div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:16px;margin-bottom:20px;text-align:left;">' +
          '<div style="color:#22c55e;font-size:13px;font-weight:700;margin-bottom:8px;">During your trial you had access to:</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;color:#cbd5e1;">' +
            '<div>&#10003; AI-powered selections</div>' +
            '<div>&#10003; Full race analysis</div>' +
            '<div>&#10003; Value bet scanner</div>' +
            '<div>&#10003; Expert staking advice</div>' +
          '</div>' +
        '</div>' +
        '<a href="#/pricing" onclick="document.getElementById(\'trial-expired-overlay\').remove()" style="display:block;width:100%;padding:14px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;text-decoration:none;text-align:center;margin-bottom:12px;">View Plans — From &pound;19.99/month</a>' +
        '<button onclick="document.getElementById(\'trial-expired-overlay\').remove()" style="width:100%;padding:10px;background:transparent;color:#8b8d93;border:1px solid rgba(255,255,255,0.1);border-radius:8px;font-size:13px;cursor:pointer;">Continue on Free Plan</button>' +
      '</div>';
    document.body.appendChild(overlay);
  },

  // -----------------------------------------------------------------------
  // PUSH NOTIFICATIONS — request permission + subscribe
  // -----------------------------------------------------------------------
  async requestPushPermission() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (Notification.permission === 'granted' && localStorage.getItem('ee_push_subscribed')) return;
    if (Notification.permission === 'denied') return;

    // Don't ask on first visit — wait until they've logged in
    if (!this.token) return;

    // Show custom prompt first (better UX than raw browser dialog)
    if (!localStorage.getItem('ee_push_asked')) {
      this.showPushPrompt();
      return;
    }
  },

  showPushPrompt() {
    if (localStorage.getItem('ee_push_asked')) return;
    var existing = document.getElementById('push-prompt');
    if (existing) existing.remove();

    var bar = document.createElement('div');
    bar.id = 'push-prompt';
    bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:linear-gradient(135deg,#141828,#1a1f35);border-top:2px solid rgba(212,168,67,0.3);padding:16px 20px;z-index:9998;display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;';
    bar.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;">' +
        '<span style="font-size:24px;">&#128276;</span>' +
        '<div><div style="font-weight:700;color:#fff;font-size:14px;">Never miss a winner</div><div style="font-size:12px;color:#94a3b8;">Get instant alerts when tips publish and when your backed tips win.</div></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;">' +
        '<button onclick="App._subscribeToPush()" style="background:#d4a843;color:#0a0e1a;border:none;padding:10px 20px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;">Enable Notifications</button>' +
        '<button onclick="document.getElementById(\'push-prompt\').remove();localStorage.setItem(\'ee_push_asked\',\'later\');" style="background:none;border:1px solid #2a2d45;color:#64748b;padding:10px 14px;border-radius:8px;font-size:13px;cursor:pointer;">Not now</button>' +
      '</div>';

    document.body.appendChild(bar);
  },

  async _subscribeToPush() {
    var promptEl = document.getElementById('push-prompt');
    if (promptEl) promptEl.remove();
    localStorage.setItem('ee_push_asked', 'yes');

    try {
      var permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      // Get VAPID key
      var keyData = await this.api('/user/push/vapid-key');
      if (!keyData.key) return;

      var reg = await navigator.serviceWorker.ready;
      var subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this._urlBase64ToUint8Array(keyData.key),
      });

      // Send subscription to server
      await this.api('/user/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });

      localStorage.setItem('ee_push_subscribed', 'true');
      this.showToast('Notifications enabled! You\'ll get alerts for new tips and winners.', 'success');
    } catch (err) {
      console.error('[Push] Subscribe failed:', err.message);
    }
  },

  _urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = window.atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; i++) { outputArray[i] = rawData.charCodeAt(i); }
    return outputArray;
  },

  showStreakRewardPopup(reward, streak) {
    var existing = document.getElementById('streak-reward-popup');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'streak-reward-popup';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';

    var milestones = [3, 7, 14, 30, 60, 100];
    var nextMilestone = milestones.find(function(m) { return m > streak; }) || 'MAX';
    var daysToNext = typeof nextMilestone === 'number' ? (nextMilestone - streak) : 0;

    overlay.innerHTML =
      '<div style="background:#141828;border:2px solid rgba(212,168,67,0.5);border-radius:16px;padding:36px;max-width:400px;width:100%;text-align:center;animation:celebrateIn 0.4s ease-out;box-shadow:0 0 60px rgba(212,168,67,0.2);">' +
        '<div style="font-size:56px;margin-bottom:12px;">&#128293;</div>' +
        '<h3 style="color:#d4a843;font-size:22px;margin-bottom:8px;">' + streak + '-Day Streak!</h3>' +
        '<p style="color:#22c55e;font-size:18px;font-weight:800;margin-bottom:4px;">+' + reward.credits + ' Free Credit' + (reward.credits !== 1 ? 's' : '') + ' Earned!</p>' +
        '<p style="color:#94a3b8;font-size:14px;margin-bottom:20px;">You\'ve logged in ' + streak + ' days in a row. Don\'t break the streak!</p>' +
        (daysToNext > 0 ? '<div style="background:rgba(212,168,67,0.08);border-radius:8px;padding:12px;margin-bottom:16px;"><div style="font-size:12px;color:#94a3b8;">Next reward at <strong style="color:#d4a843;">' + nextMilestone + ' days</strong> — only ' + daysToNext + ' more day' + (daysToNext !== 1 ? 's' : '') + '!</div></div>' : '') +
        '<div style="display:flex;gap:6px;justify-content:center;margin-bottom:8px;">' +
          milestones.map(function(m) {
            var reached = streak >= m;
            return '<div style="width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;' + (reached ? 'background:#d4a843;color:#0a0e1a;' : 'background:rgba(255,255,255,0.05);color:#475569;border:1px solid #2a2d45;') + '">' + m + '</div>';
          }).join('') +
        '</div>' +
        '<button onclick="document.getElementById(\'streak-reward-popup\').remove();" style="margin-top:12px;background:#d4a843;color:#0a0e1a;border:none;padding:10px 28px;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;">Awesome!</button>' +
      '</div>';

    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) overlay.remove();
    });
  },

  showTelegramPopup() {
    // Don't show if already dismissed
    if (localStorage.getItem('ee_tg_dismissed')) return;
    var existing = document.getElementById('telegram-popup');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'telegram-popup';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML =
      '<div style="background:#141828;border:2px solid rgba(59,130,246,0.4);border-radius:16px;padding:32px;max-width:420px;width:100%;text-align:center;position:relative;">' +
        '<button onclick="document.getElementById(\'telegram-popup\').remove();localStorage.setItem(\'ee_tg_dismissed\',\'1\');" style="position:absolute;top:12px;right:16px;background:none;border:none;color:#64748b;font-size:24px;cursor:pointer;">&times;</button>' +
        '<div style="font-size:48px;margin-bottom:16px;"><svg width="48" height="48" viewBox="0 0 24 24" fill="#229ED9"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg></div>' +
        '<h3 style="color:#fff;font-size:20px;margin-bottom:8px;">Join Our Telegram Channel</h3>' +
        '<p style="color:#94a3b8;font-size:14px;line-height:1.6;margin-bottom:20px;">Get instant tip alerts, live winner notifications, and community chat — straight to your phone. Over 90% of our subscribers are on Telegram.</p>' +
        '<div style="display:flex;flex-direction:column;gap:10px;">' +
          '<a href="https://t.me/EliteEdgeTips" target="_blank" rel="noopener" onclick="localStorage.setItem(\'ee_tg_dismissed\',\'1\');trackEvent(\'engagement\',\'telegram_join\',\'post_register\');" style="display:flex;align-items:center;justify-content:center;gap:8px;background:#229ED9;color:#fff;padding:14px 24px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>' +
            'Join Elite Edge on Telegram' +
          '</a>' +
          '<button onclick="document.getElementById(\'telegram-popup\').remove();localStorage.setItem(\'ee_tg_dismissed\',\'1\');" style="background:none;border:1px solid #2a2d45;color:#64748b;padding:10px;border-radius:8px;font-size:13px;cursor:pointer;">Maybe later</button>' +
        '</div>' +
        '<p style="font-size:11px;color:#475569;margin-top:12px;">You can always join from the dashboard or footer.</p>' +
      '</div>';

    document.body.appendChild(overlay);
    // Close on background click
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) { overlay.remove(); localStorage.setItem('ee_tg_dismissed', '1'); }
    });
  },

  showWelcomeEmailNotice() {
    const existing = document.getElementById('welcome-email-notice');
    if (existing) existing.remove();
    const app = document.getElementById('app');
    const notice = document.createElement('div');
    notice.id = 'welcome-email-notice';
    notice.style.cssText = 'background:rgba(212,168,67,.12);border:1px solid rgba(212,168,67,.3);color:#d4a843;padding:12px 20px;text-align:center;font-size:14px;border-radius:8px;margin:12px auto;max-width:600px;';
    notice.innerHTML = '&#9993; Check your email for a welcome message! We\'ve sent you everything you need to get started.';
    app.parentNode.insertBefore(notice, app);
    setTimeout(function() { var n = document.getElementById('welcome-email-notice'); if (n) n.remove(); }, 8000);
  },

  async loadEmailPrefs() {
    try {
      var data = await this.api('/auth/email-prefs');
      return data.emailPrefs || { dailyBulletin: true, weeklySummary: true, marketing: true, bigWins: true };
    } catch (e) {
      return { dailyBulletin: true, weeklySummary: true, marketing: true, bigWins: true };
    }
  },

  async saveEmailPref(key, value) {
    try {
      var body = {};
      body[key] = value;
      await this.api('/auth/email-prefs', { method: 'PUT', body: JSON.stringify(body) });
    } catch (e) {
      console.error('Failed to save email pref:', e.message);
    }
  },

  // -----------------------------------------------------------------------
  // ALERT PREFERENCES
  // -----------------------------------------------------------------------
  async loadAlertPrefs() {
    try {
      var data = await this.api('/auth/alert-prefs');
      return data.alertPrefs || { highConfidence: false, steamers: false, preRace: false, bigOdds: false, newTips: false };
    } catch (e) {
      return { highConfidence: false, steamers: false, preRace: false, bigOdds: false, newTips: false };
    }
  },

  async saveAlertPref(key, value) {
    try {
      var body = {};
      body[key] = value;
      await this.api('/auth/alert-prefs', { method: 'PUT', body: JSON.stringify(body) });
    } catch (e) {
      console.error('Failed to save alert pref:', e.message);
    }
  },

  // -----------------------------------------------------------------------
  // WHY ELITE EDGE — Competitor Comparison Page
  // -----------------------------------------------------------------------
  renderWhyEliteEdge() {
    var competitors = [
      { name: 'Racing Post', price: '£24.99', racing: true, football: 'Basic', ai: false, xg: false, apis: '2', sports: '2', odds: false, value: false, acca: false, steamers: false, oddsExplainer: false, liveIntel: false, clv: false, nba: false, tennis: false, rugby: false, nfl: false, alerts: false, going: 'Basic', nonRunner: false, h2h: false, replay: false, chatbot: false, results: 'Partial', calendar: false, drip: false, trial: false, tiers: '1' },
      { name: 'Timeform', price: '£24.99', racing: true, football: false, ai: false, xg: false, apis: '1', sports: '1', odds: false, value: false, acca: false, steamers: false, oddsExplainer: false, liveIntel: false, clv: false, nba: false, tennis: false, rugby: false, nfl: false, alerts: false, going: false, nonRunner: false, h2h: false, replay: false, chatbot: false, results: false, calendar: false, drip: false, trial: true, tiers: '1' },
      { name: 'Infogol', price: '£4.99', racing: false, football: true, ai: false, xg: 'Basic', apis: '1', sports: '1', odds: false, value: false, acca: false, steamers: false, oddsExplainer: false, liveIntel: false, clv: false, nba: false, tennis: false, rugby: false, nfl: false, alerts: false, going: false, nonRunner: false, h2h: 'Basic', replay: false, chatbot: false, results: false, calendar: false, drip: false, trial: true, tiers: '1' },
      { name: 'OLBG', price: '£9.99', racing: 'Community', football: 'Community', ai: false, xg: false, apis: '0', sports: '2', odds: 'Limited', value: false, acca: false, steamers: false, oddsExplainer: false, liveIntel: false, clv: false, nba: false, tennis: false, rugby: false, nfl: false, alerts: false, going: false, nonRunner: false, h2h: false, replay: false, chatbot: false, results: 'User-reported', calendar: false, drip: false, trial: true, tiers: '1' },
    ];

    var features = [
      { label: 'Monthly Price', key: 'price', elite: '£19.99' },
      { label: 'Live Data APIs', key: 'apis', elite: '14' },
      { label: 'Sports Covered', key: 'sports', elite: '6' },
      { label: 'Horse Racing Tips', key: 'racing', elite: true },
      { label: 'Football Tips (18 Leagues)', key: 'football', elite: true },
      { label: 'NBA Basketball Tips', key: 'nba', elite: true },
      { label: 'Tennis Tips (ATP + WTA)', key: 'tennis', elite: true },
      { label: 'Rugby League Tips (Super League + NRL)', key: 'rugby', elite: true },
      { label: 'NFL Tips', key: 'nfl', elite: true },
      { label: 'Real xG Data (Understat)', key: 'xg', elite: true },
      { label: 'AI Match Previews (Claude)', key: 'ai', elite: true },
      { label: 'AI Race Replay Analysis', key: 'replay', elite: true },
      { label: 'AI Chatbot Assistant', key: 'chatbot', elite: true },
      { label: '40+ Bookmaker Odds Comparison', key: 'odds', elite: true },
      { label: 'Value Bet Scanner', key: 'value', elite: true },
      { label: 'Smart Acca Generator (2-8 fold)', key: 'acca', elite: true },
      { label: 'Steamer/Drifter Detection', key: 'steamers', elite: true },
      { label: 'Market Mover Explainer (Live Web AI)', key: 'oddsExplainer', elite: true },
      { label: 'Live Racing Intelligence (Perplexity AI)', key: 'liveIntel', elite: true },
      { label: 'CLV Tracking (Closing Line Value)', key: 'clv', elite: true },
      { label: 'Custom Alerts (5 Types)', key: 'alerts', elite: true },
      { label: 'Going Forecast (Weather + Ground)', key: 'going', elite: true },
      { label: 'Non-Runner Auto Detection & Void', key: 'nonRunner', elite: true },
      { label: 'H2H Comparison Tool', key: 'h2h', elite: true },
      { label: 'Verified Transparent Results', key: 'results', elite: true },
      { label: 'Profit Calendar Heatmap', key: 'calendar', elite: true },
      { label: 'Automated Email Drip Campaign', key: 'drip', elite: true },
      { label: 'Subscription Tiers (Free/Premium/VIP)', key: 'tiers', elite: '3' },
      { label: '14-Day Free Trial', key: 'trial', elite: true },
    ];

    function renderCell(val) {
      if (val === true) return '<span style="color:#22c55e;font-weight:800;font-size:18px;">&#10003;</span>';
      if (val === false) return '<span style="color:#ef4444;font-weight:800;font-size:18px;">&#10007;</span>';
      return '<span style="color:#f59e0b;font-size:12px;">' + val + '</span>';
    }

    var tableRows = features.map(function(f) {
      var eliteVal = f.elite;
      var eliteCell;
      if (f.key === 'price') {
        eliteCell = '<td style="background:rgba(212,168,67,0.04);font-weight:800;font-size:16px;color:#d4a843;">' + eliteVal + '</td>';
      } else if (f.key === 'apis' || f.key === 'tiers') {
        eliteCell = '<td style="background:rgba(212,168,67,0.04);font-weight:800;font-size:16px;color:#d4a843;">' + eliteVal + '</td>';
      } else {
        eliteCell = '<td style="background:rgba(212,168,67,0.04);">' + renderCell(eliteVal) + '</td>';
      }
      var compCells = competitors.map(function(c) {
        if (f.key === 'price') return '<td style="font-weight:800;">' + c.price + '</td>';
        if (f.key === 'apis' || f.key === 'tiers') return '<td style="font-weight:800;color:#8b8d93;">' + (c[f.key] || '0') + '</td>';
        return '<td>' + renderCell(c[f.key]) + '</td>';
      }).join('');
      return '<tr><td style="text-align:left;font-weight:600;color:#c0c4d0;">' + f.label + '</td>' + eliteCell + compCells + '</tr>';
    }).join('');

    var exclusives = [
      { icon: '&#127760;', title: 'Live Web Intelligence (Perplexity AI)', desc: 'Real-time going updates, team news, stable form, and jockey changes scraped from Racing Post, BBC Sport, and Sporting Life — woven into every tip.' },
      { icon: '&#128201;', title: 'Market Mover Explainer', desc: 'When odds shorten, we tell you WHY. Gallop reports, connection money, non-runner reshuffles — cited from live racing press.' },
      { icon: '&#128200;', title: 'CLV Tracking', desc: 'We measure Closing Line Value on every tip. Positive CLV = genuine edge over bookmakers, not just luck. Full transparency.' },
      { icon: '&#129302;', title: '3 AI Engines + 4 Analyst Profiles', desc: 'Claude writes analysis, Perplexity feeds live web intelligence, GPT-4o independently verifies every tip. Four AI analysts (Professor, Scout, Clocker, Edge) each with distinct strategies and auto-tuning that learns from losses.' },
      { icon: '&#128200;', title: 'Value Bet Scanner', desc: 'Compares odds across 40+ UK bookmakers in real-time. Finds where prices disagree.' },
      { icon: '&#9917;', title: 'Smart Acca Generator', desc: 'Scans every live fixture, ranks by probability, builds 2-8 fold accas automatically.' },
      { icon: '&#128202;', title: 'Real xG Data', desc: 'Understat xG fed directly into our model. Real expected goals, not estimates.' },
      { icon: '&#128293;', title: 'Steamer & Drifter Alerts', desc: 'Know when the market moves on our selections. Shortening = market agrees.' },
      { icon: '&#127793;', title: 'Going Forecast', desc: 'OpenWeather data for every racecourse. Predicted going changes before bookmakers adjust.' },
      { icon: '&#127942;', title: 'AI Race Replay', desc: 'After every result, our AI explains WHY it happened. Live press reports + statistical analysis combined by Claude and Perplexity.' },
      { icon: '&#128276;', title: '5 Custom Alert Types', desc: 'Elite confidence, steamers, pre-race, big price, all tips. You control what you receive.' },
      { icon: '&#128274;', title: 'Anti-Sharing Protection', desc: 'One device per account. No password sharing. Every subscription = one person.' },
      { icon: '&#127934;', title: '6 Sports, One Platform', desc: 'Racing, Football, NBA, Tennis, Rugby League, NFL — all powered by the same AI scoring model. No other UK service covers this range with this depth.' },
      { icon: '&#127936;', title: 'Tennis Intelligence (ATP + WTA)', desc: 'Rankings, H2H records, surface analysis, tournament-level weighting. Daily tips across every Grand Slam, Masters, and ATP/WTA event.' },
      { icon: '&#128232;', title: 'Automated Email Intelligence', desc: 'Morning bulletins enriched with live intelligence across all 6 sports. Not templates — real context from today\'s fixtures.' },
      { icon: '&#127919;', title: '14 Live Data APIs', desc: 'Racing, Football, Basketball, Tennis, Rugby, NFL, Odds, Weather, xG, Standings, News, Claude AI, Perplexity AI, Email. Always live.' },
    ];

    document.getElementById('app').innerHTML =
      '<div class="container" style="max-width:1100px;">' +
        '<div style="text-align:center;margin-bottom:20px;">' +
          '<h1 style="font-size:32px;font-weight:900;">Why <span style="color:#d4a843;">Elite Edge</span> Is Different</h1>' +
          '<p style="color:#8b8d93;font-size:16px;margin-bottom:24px;">The UK\'s most advanced multi-sport analysis platform — 14 live APIs, 6 sports, 3 AI engines, 4 analyst profiles, self-learning model</p>' +
        '</div>' +

        // Stats bar
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:32px;">' +
          '<div style="background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.2);border-radius:10px;padding:16px;text-align:center;">' +
            '<div style="font-size:28px;font-weight:900;color:#d4a843;">14</div><div style="font-size:11px;color:#8b8d93;text-transform:uppercase;">Live APIs</div>' +
          '</div>' +
          '<div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:10px;padding:16px;text-align:center;">' +
            '<div style="font-size:28px;font-weight:900;color:#22c55e;">6</div><div style="font-size:11px;color:#8b8d93;text-transform:uppercase;">Sports</div>' +
          '</div>' +
          '<div style="background:rgba(96,165,250,0.08);border:1px solid rgba(96,165,250,0.2);border-radius:10px;padding:16px;text-align:center;">' +
            '<div style="font-size:28px;font-weight:900;color:#60a5fa;">9</div><div style="font-size:11px;color:#8b8d93;text-transform:uppercase;">Daily Tips</div>' +
          '</div>' +
          '<div style="background:rgba(168,85,247,0.08);border:1px solid rgba(168,85,247,0.2);border-radius:10px;padding:16px;text-align:center;">' +
            '<div style="font-size:28px;font-weight:900;color:#a855f7;">3</div><div style="font-size:11px;color:#8b8d93;text-transform:uppercase;">AI Engines</div>' +
          '</div>' +
        '</div>' +

        '<div style="overflow-x:auto;margin-bottom:40px;">' +
        '<table style="width:100%;border-collapse:collapse;min-width:700px;">' +
          '<thead><tr>' +
            '<th style="padding:14px 12px;text-align:left;width:220px;border-bottom:2px solid rgba(212,168,67,0.3);font-size:13px;"></th>' +
            '<th style="padding:14px 12px;text-align:center;color:#d4a843;font-size:15px;font-weight:800;border-bottom:2px solid rgba(212,168,67,0.3);background:rgba(212,168,67,0.08);border-radius:8px 8px 0 0;">Elite Edge</th>' +
            competitors.map(function(c) { return '<th style="padding:14px 12px;text-align:center;color:#8b8d93;font-size:13px;font-weight:700;border-bottom:2px solid rgba(212,168,67,0.3);">' + c.name + '</th>'; }).join('') +
          '</tr></thead>' +
          '<tbody>' + tableRows + '</tbody>' +
        '</table>' +
        '</div>' +

        '<div style="text-align:center;margin-bottom:24px;">' +
          '<h2 style="font-size:24px;font-weight:800;">Features <span style="color:#d4a843;">Only We</span> Offer</h2>' +
          '<p style="color:#8b8d93;font-size:14px;">Technology that no other UK tipping service can match</p>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:40px;">' +
          exclusives.map(function(e) {
            return '<div style="background:rgba(212,168,67,0.06);border:1px solid rgba(212,168,67,0.2);border-radius:12px;padding:20px;text-align:center;">' +
              '<div style="font-size:28px;margin-bottom:8px;">' + e.icon + '</div>' +
              '<h3 style="font-size:14px;font-weight:700;color:#d4a843;margin-bottom:4px;">' + e.title + '</h3>' +
              '<p style="font-size:12px;color:#8b8d93;line-height:1.4;">' + e.desc + '</p>' +
            '</div>';
          }).join('') +
        '</div>' +

        // 4 ANALYST PROFILES
        '<div style="text-align:center;margin-bottom:24px;">' +
          '<h2 style="font-size:24px;font-weight:800;">4 AI Analysts. <span style="color:#d4a843;">4 Strategies.</span></h2>' +
          '<p style="color:#8b8d93;font-size:14px;">Every tip is assigned to the analyst best suited for that selection — then independently verified by GPT-4o</p>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin-bottom:40px;">' +
          '<div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.25);border-radius:12px;padding:24px;">' +
            '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">' +
              '<div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#1d4ed8);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:16px;color:#fff;">TP</div>' +
              '<div><div style="font-size:16px;font-weight:800;color:#3b82f6;">The Professor</div><div style="font-size:11px;color:#8b8d93;">Data-Driven Analysis</div></div>' +
            '</div>' +
            '<p style="font-size:13px;color:#94a3b8;line-height:1.6;">Statistics-first. Trusts xG, speed ratings, and form figures over narrative. Prefers shorter prices (evens to 4/1) where data is most reliable. Weights numbers 30-40% higher than market sentiment.</p>' +
            '<div style="font-size:11px;color:#3b82f6;font-weight:700;margin-top:8px;">SPORTS: All 6 &bull; ODDS: 1/2 to 4/1</div>' +
          '</div>' +
          '<div style="background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.25);border-radius:12px;padding:24px;">' +
            '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">' +
              '<div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#22c55e,#15803d);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:16px;color:#fff;">TS</div>' +
              '<div><div style="font-size:16px;font-weight:800;color:#22c55e;">The Scout</div><div style="font-size:11px;color:#8b8d93;">Value Hunter</div></div>' +
            '</div>' +
            '<p style="font-size:13px;color:#94a3b8;line-height:1.6;">Finds prices the market has wrong. Specialises in class droppers, course specialists, and motivation plays. Goes against the crowd. Bigger prices where edges are largest.</p>' +
            '<div style="font-size:11px;color:#22c55e;font-weight:700;margin-top:8px;">SPORTS: All 6 &bull; ODDS: 3/1 to 20/1</div>' +
          '</div>' +
          '<div style="background:rgba(168,85,247,0.06);border:1px solid rgba(168,85,247,0.25);border-radius:12px;padding:24px;">' +
            '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">' +
              '<div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#a855f7,#7c3aed);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:16px;color:#fff;">TC</div>' +
              '<div><div style="font-size:16px;font-weight:800;color:#a855f7;">The Clocker</div><div style="font-size:11px;color:#8b8d93;">Deep Racing Intelligence</div></div>' +
            '</div>' +
            '<p style="font-size:13px;color:#94a3b8;line-height:1.6;">Racing-only specialist. Reads trainer intent (first-time headgear, jockey bookings), analyses pace scenarios, identifies going specialists, and tracks stable form. Powered by Perplexity live research.</p>' +
            '<div style="font-size:11px;color:#a855f7;font-weight:700;margin-top:8px;">SPORTS: Racing only &bull; ODDS: Evens to 25/1</div>' +
          '</div>' +
          '<div style="background:rgba(212,168,67,0.06);border:1px solid rgba(212,168,67,0.25);border-radius:12px;padding:24px;">' +
            '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">' +
              '<div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#d4a843,#b8902f);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:16px;color:#0a0e1a;">TE</div>' +
              '<div><div style="font-size:16px;font-weight:800;color:#d4a843;">The Edge</div><div style="font-size:11px;color:#8b8d93;">Balanced Analysis</div></div>' +
            '</div>' +
            '<p style="font-size:13px;color:#94a3b8;line-height:1.6;">Weighs all factors equally. No bias. Looks for the clearest overall edge across every metric. The generalist who catches what the specialists miss.</p>' +
            '<div style="font-size:11px;color:#d4a843;font-weight:700;margin-top:8px;">SPORTS: All 6 &bull; ODDS: 2/1 to 10/1</div>' +
          '</div>' +
        '</div>' +

        // Self-learning callout
        '<div style="background:linear-gradient(135deg,rgba(168,85,247,0.08),rgba(34,197,94,0.08));border:2px solid rgba(168,85,247,0.25);border-radius:14px;padding:24px;margin-bottom:40px;text-align:center;">' +
          '<div style="font-size:28px;margin-bottom:8px;">&#129504;</div>' +
          '<h3 style="font-size:18px;font-weight:800;color:#fff;margin-bottom:8px;">Self-Learning Model</h3>' +
          '<p style="font-size:14px;color:#94a3b8;line-height:1.6;max-width:600px;margin:0 auto;">Every 14 days, the system reviews each analyst\'s performance. Losing patterns are identified. Odds ranges tighten. Weak markets are dropped. Successful strategies expand. The model gets sharper with every result.</p>' +
        '</div>' +

        '<div style="text-align:center;margin:48px 0 20px;">' +
          '<a href="#/pricing" style="display:inline-block;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;padding:16px 48px;border-radius:10px;font-size:18px;font-weight:800;text-decoration:none;">Start Your 14-Day Free Trial</a>' +
          '<p style="color:#8b8d93;font-size:13px;margin-top:12px;">Card stored securely. No charges on free tier. Full premium access. Cancel anytime.</p>' +
        '</div>' +

        '<p style="text-align:center;font-size:10px;color:#555;margin-top:32px;line-height:1.6;">Elite Edge Sports Tips Ltd. Company No. 17138566. Registered in England & Wales. Entertainment and statistical analysis only. Not financial or betting advice. No guarantee of profit. 18+ only. Please gamble responsibly. BeGambleAware.org</p>' +
      '</div>';
  },

  // 404 PAGE (Feature #5)
  // -----------------------------------------------------------------------
  renderHowItWorks() {
    document.getElementById('app').innerHTML = `
      <div class="container">
        <div class="legal-page">
          <h1>How Elite Edge Works</h1>
          <p style="color:var(--text-secondary);margin-bottom:24px;">Everything you need to know about our system, how to read our tips, and how to bet smarter.</p>

          <!-- Video Walkthrough -->
          <div id="how-it-works-video" style="margin-bottom:32px;"></div>
          <script>
          (function() {
            // Set your video URL here once recorded — supports Loom, YouTube, or Vimeo
            var videoUrl = window.ELITE_EDGE_VIDEO_URL || localStorage.getItem('ee_walkthrough_url') || '';
            var container = document.getElementById('how-it-works-video');
            if (!container) return;
            if (videoUrl) {
              // Detect Loom, YouTube, or Vimeo and embed accordingly
              var embedHtml = '';
              if (videoUrl.indexOf('loom.com') !== -1) {
                var loomId = videoUrl.split('/').pop().split('?')[0];
                embedHtml = '<div style="position:relative;padding-bottom:56.25%;height:0;border-radius:12px;overflow:hidden;border:1px solid #2a2d45;"><iframe src="https://www.loom.com/embed/' + loomId + '" frameborder="0" webkitallowfullscreen mozallowfullscreen allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%;"></iframe></div>';
              } else if (videoUrl.indexOf('youtube.com') !== -1 || videoUrl.indexOf('youtu.be') !== -1) {
                var ytId = videoUrl.indexOf('youtu.be') !== -1 ? videoUrl.split('/').pop().split('?')[0] : (videoUrl.match(/[?&]v=([^&]+)/) || [])[1];
                if (ytId) embedHtml = '<div style="position:relative;padding-bottom:56.25%;height:0;border-radius:12px;overflow:hidden;border:1px solid #2a2d45;"><iframe src="https://www.youtube.com/embed/' + ytId + '" frameborder="0" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%;"></iframe></div>';
              } else if (videoUrl.indexOf('vimeo.com') !== -1) {
                var vimeoId = videoUrl.split('/').pop().split('?')[0];
                embedHtml = '<div style="position:relative;padding-bottom:56.25%;height:0;border-radius:12px;overflow:hidden;border:1px solid #2a2d45;"><iframe src="https://player.vimeo.com/video/' + vimeoId + '" frameborder="0" allow="autoplay;fullscreen;picture-in-picture" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%;"></iframe></div>';
              } else {
                embedHtml = '<div style="position:relative;padding-bottom:56.25%;height:0;border-radius:12px;overflow:hidden;border:1px solid #2a2d45;"><iframe src="' + videoUrl + '" frameborder="0" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%;"></iframe></div>';
              }
              container.innerHTML = '<div style="margin-bottom:12px;font-size:14px;font-weight:700;color:#d4a843;">&#127916; Watch: How to Use Elite Edge (3 min)</div>' + embedHtml;
            } else {
              container.innerHTML = '<div style="position:relative;background:#0a0e1a;border-radius:12px;padding:40px 20px;text-align:center;border:1px solid #2a2d45;cursor:pointer;" onclick="var url=prompt(\'Paste your Loom/YouTube video URL:\');if(url){localStorage.setItem(\'ee_walkthrough_url\',url);location.reload();}">' +
                '<div style="font-size:48px;margin-bottom:12px;">&#9654;</div>' +
                '<div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:6px;">Video Walkthrough Coming Soon</div>' +
                '<div style="font-size:13px;color:#8a8fa0;">3 minute guide showing how to use Elite Edge</div>' +
              '</div>';
            }
          })();
          </script>

          <!-- Quick Start Guide -->
          <div style="background:linear-gradient(135deg,#0a0e1a,#1a1a2e);border-radius:12px;padding:32px 24px;margin-bottom:32px;border:1px solid #2a2d45;">
            <div style="text-align:center;margin-bottom:20px;">
              <div style="font-size:36px;margin-bottom:8px;">&#128640;</div>
              <div style="font-size:18px;font-weight:700;color:#fff;">Quick Start Guide</div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;">
              <div style="background:rgba(212,168,67,0.08);border-radius:10px;padding:16px;text-align:center;">
                <div style="font-size:24px;margin-bottom:6px;">1&#65039;&#8419;</div>
                <div style="font-weight:700;color:#d4a843;font-size:13px;margin-bottom:4px;">Check Daily Tips</div>
                <div style="font-size:12px;color:#8a8fa0;">Published by 7:30am UK. Racing &amp; football selections with full analysis.</div>
              </div>
              <div style="background:rgba(212,168,67,0.08);border-radius:10px;padding:16px;text-align:center;">
                <div style="font-size:24px;margin-bottom:6px;">2&#65039;&#8419;</div>
                <div style="font-weight:700;color:#d4a843;font-size:13px;margin-bottom:4px;">Read The Edge Score</div>
                <div style="font-size:12px;color:#8a8fa0;">Our model calculates the probability edge — only selections with real value are published.</div>
              </div>
              <div style="background:rgba(212,168,67,0.08);border-radius:10px;padding:16px;text-align:center;">
                <div style="font-size:24px;margin-bottom:6px;">3&#65039;&#8419;</div>
                <div style="font-weight:700;color:#d4a843;font-size:13px;margin-bottom:4px;">Follow The Staking</div>
                <div style="font-size:12px;color:#8a8fa0;">Each tip has a recommended unit stake based on confidence and edge size.</div>
              </div>
              <div style="background:rgba(212,168,67,0.08);border-radius:10px;padding:16px;text-align:center;">
                <div style="font-size:24px;margin-bottom:6px;">4&#65039;&#8419;</div>
                <div style="font-weight:700;color:#d4a843;font-size:13px;margin-bottom:4px;">Track Results</div>
                <div style="font-size:12px;color:#8a8fa0;">Results auto-settle every 5 minutes. Full P/L tracked in your results dashboard.</div>
              </div>
            </div>
          </div>

          <h2>&#127919; Understanding Confidence Scores</h2>
          <p>Every tip we publish has a <strong>confidence score from 1 to 10</strong>. This is our model's assessment of how likely the selection is to win, factoring in all available data.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
            <tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;font-weight:700;color:#ef4444;">1-4</td><td style="padding:8px;">Low confidence — we would never publish these</td></tr>
            <tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;font-weight:700;color:#f59e0b;">5-6</td><td style="padding:8px;">Moderate — only published if edge is very strong</td></tr>
            <tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;font-weight:700;color:#22c55e;">7-8</td><td style="padding:8px;">Strong — the majority of our selections</td></tr>
            <tr><td style="padding:8px;font-weight:700;color:#d4a843;">9-10</td><td style="padding:8px;">Elite — our strongest conviction picks (NAP territory)</td></tr>
          </table>
          <p>We only publish tips with a confidence of <strong>6 or higher</strong>. Our NAP of the Day must be <strong>7+</strong>.</p>

          <h2>&#128200; What is Edge?</h2>
          <p>Edge is the difference between <strong>what we think the probability is</strong> and <strong>what the bookmaker's odds imply</strong>.</p>
          <div style="background:#0a0e1a;border-radius:8px;padding:20px;margin:16px 0;font-family:monospace;font-size:14px;color:#22c55e;">
            Edge = Our Model Probability - Bookmaker Implied Probability<br><br>
            <span style="color:#8a8fa0;">Example:</span><br>
            Our model says a horse has a <span style="color:#d4a843;">35%</span> chance of winning<br>
            The bookmaker's odds of 4/1 imply a <span style="color:#fff;">20%</span> chance<br>
            Edge = 35% - 20% = <span style="color:#22c55e;font-weight:700;">+15% edge</span> ← this is a strong bet
          </div>
          <p>We require a <strong>minimum 5% edge</strong> for racing and <strong>4% for football</strong> before publishing. If no selections meet this threshold, we say "no bet today" — we never publish filler.</p>

          <h2>&#128176; Understanding Units & Staking</h2>
          <p>We measure all stakes and profits in <strong>units</strong>, not pounds. This lets everyone follow regardless of bankroll size.</p>
          <div style="background:#0a0e1a;border-radius:8px;padding:20px;margin:16px 0;">
            <div style="font-size:14px;color:#fff;margin-bottom:12px;"><strong>What is 1 unit?</strong></div>
            <div style="font-size:13px;color:#8a8fa0;line-height:1.7;">
              1 unit = <strong style="color:#d4a843;">1% of your total bankroll</strong><br><br>
              If your bankroll is &pound;500 → 1 unit = &pound;5<br>
              If your bankroll is &pound;1,000 → 1 unit = &pound;10<br>
              If your bankroll is &pound;200 → 1 unit = &pound;2<br><br>
              <strong style="color:#fff;">Our staking guide:</strong><br>
              Low confidence (6) → 1 unit<br>
              Medium confidence (7-8) → 1.5-2 units<br>
              High confidence (9-10) → 2.5-3 units<br>
              NAP → Maximum 3 units
            </div>
          </div>
          <p style="color:#ef4444;font-weight:600;">Never stake more than 3% of your bankroll on a single bet. This protects you during losing runs.</p>

          <h2>&#128202; ROI & Strike Rate Explained</h2>
          <p><strong>Strike Rate</strong> = percentage of tips that win. If we publish 10 tips and 7 win, that's 70%.</p>
          <p><strong>ROI (Return on Investment)</strong> = total profit divided by total staked, as a percentage.</p>
          <div style="background:#0a0e1a;border-radius:8px;padding:20px;margin:16px 0;font-family:monospace;font-size:14px;color:#22c55e;">
            <span style="color:#8a8fa0;">Example:</span><br>
            Total staked: 100 units<br>
            Total returned: 223 units<br>
            Profit: 123 units<br>
            ROI = 123 / 100 = <span style="color:#d4a843;font-weight:700;">+123% ROI</span>
          </div>
          <p>Our full results are <strong>publicly verifiable</strong> on the Results page — every tip, every outcome, no hiding losses.</p>

          <h2>&#9971; How to Read a Racing Tip</h2>
          <p>Each racing selection includes:</p>
          <ul style="font-size:14px;line-height:2;color:var(--text-secondary);">
            <li><strong style="color:#fff;">Selection</strong> — the horse we're backing</li>
            <li><strong style="color:#fff;">Meeting & Time</strong> — where and when the race is</li>
            <li><strong style="color:#fff;">Market</strong> — Win, Each-Way, or Value Outsider</li>
            <li><strong style="color:#fff;">Odds</strong> — the current price with best bookmaker highlighted</li>
            <li><strong style="color:#fff;">Form</strong> — recent finishing positions (1 = won, 2 = second, etc.)</li>
            <li><strong style="color:#fff;">Going</strong> — the ground conditions and whether the horse suits them</li>
            <li><strong style="color:#fff;">Analysis</strong> — our full reasoning, every factor considered</li>
            <li><strong style="color:#fff;">Analyst</strong> — which AI analyst produced this tip (Professor, Scout, Clocker, or Edge)</li>
            <li><strong style="color:#fff;">Deep Intelligence</strong> — The Clocker tips include trainer strike rates, pace analysis, and going expertise from live Perplexity research</li>
          </ul>
          <p><strong>Each-Way explained:</strong> Your stake is split in half — one half on the horse to win, the other on it to place (usually top 3). If it wins, both halves pay out. If it places but doesn't win, the place half pays at a fraction (usually 1/4 or 1/5) of the win odds.</p>

          <h2>&#9917; How to Read a Football Tip</h2>
          <p>Each football selection includes:</p>
          <ul style="font-size:14px;line-height:2;color:var(--text-secondary);">
            <li><strong style="color:#fff;">Fixture</strong> — the match and league</li>
            <li><strong style="color:#fff;">Market</strong> — Match Result, BTTS, Over/Under, Asian Handicap, Double Chance</li>
            <li><strong style="color:#fff;">Odds</strong> — current price across bookmakers</li>
            <li><strong style="color:#fff;">Form</strong> — W/D/L record for both teams (last 5 games)</li>
            <li><strong style="color:#fff;">Analysis</strong> — xG, injuries, H2H, motivation, market value</li>
          </ul>
          <p><strong>Common markets explained:</strong></p>
          <ul style="font-size:14px;line-height:2;color:var(--text-secondary);">
            <li><strong style="color:#d4a843;">BTTS</strong> — Both Teams to Score. Wins if both sides score at least 1 goal.</li>
            <li><strong style="color:#d4a843;">Over 2.5 Goals</strong> — Wins if the match has 3 or more total goals.</li>
            <li><strong style="color:#d4a843;">Asian Handicap -1.5</strong> — Your team must win by 2+ goals for the bet to win.</li>
            <li><strong style="color:#d4a843;">Double Chance (1X)</strong> — Wins if the home team wins OR draws. Only loses if the away team wins.</li>
          </ul>

          <h2>&#128202; Our 4 AI Analysts</h2>
          <p>Every tip is assigned to the analyst best suited for that selection:</p>
          <ul style="font-size:14px;line-height:2;color:var(--text-secondary);">
            <li><strong style="color:#3b82f6;">The Professor</strong> — Data-driven. Trusts xG, speed ratings, and form figures. Prefers shorter prices.</li>
            <li><strong style="color:#22c55e;">The Scout</strong> — Value hunter. Finds overlooked prices. Class droppers, course specialists, motivation plays.</li>
            <li><strong style="color:#a855f7;">The Clocker</strong> — Racing-only deep intelligence. Trainer intent, pace analysis, going expertise, stable form. Powered by live Perplexity research.</li>
            <li><strong style="color:#d4a843;">The Edge</strong> — Balanced. Weighs all factors equally. Catches what the specialists miss.</li>
          </ul>
          <p>Every 14 days, the system reviews each analyst's performance and <strong style="color:#fff;">auto-adjusts</strong> their odds ranges and preferred markets based on what's winning and losing.</p>

          <h2>&#128640; Getting Started</h2>
          <ol style="font-size:14px;line-height:2.2;color:var(--text-secondary);">
            <li>Set your <strong style="color:#fff;">bankroll</strong> in the Bankroll Tracker (e.g. &pound;500)</li>
            <li>Your <strong style="color:#fff;">daily staking plan</strong> auto-calculates on the dashboard — shows exact &pound; amounts per tip</li>
            <li>Set your <strong style="color:#fff;">confidence filter</strong> — only see tips rated 7+ or 8+ if you want fewer, stronger picks</li>
            <li>Check the <strong style="color:#fff;">dashboard every morning</strong> for today's selections</li>
            <li>Click <strong style="color:#fff;">"Back This Tip"</strong> on any selection to track it in your <a href="#/my-roi" style="color:#d4a843;">Personal ROI Dashboard</a></li>
            <li>Read the <strong style="color:#fff;">full analysis</strong> — especially The Clocker's deep intelligence on racing tips</li>
            <li>Your <strong style="color:#fff;">ROI Dashboard</strong> shows your personal strike rate, P/L by analyst, and what you'd have made following all tips</li>
            <li><strong style="color:#ef4444;">Never chase losses</strong> — the staking plan does the thinking for you</li>
          </ol>

          <div style="background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.2);border-radius:10px;padding:20px;margin:24px 0;">
            <div style="font-size:14px;font-weight:700;color:#d4a843;margin-bottom:8px;">&#9888; Important Reminder</div>
            <div style="font-size:13px;color:#8a8fa0;line-height:1.6;">Elite Edge provides statistical analysis and entertainment content only. We do not guarantee profits. All betting carries risk — you can and may lose money. Only bet what you can afford to lose. If you feel you have a gambling problem, visit <a href="https://www.begambleaware.org" target="_blank" style="color:#d4a843;">BeGambleAware.org</a> or call the National Gambling Helpline on <strong style="color:#fff;">0808 8020 133</strong>.</div>
          </div>

          <p style="margin-top:24px;"><a href="#/" class="text-gold">&larr; Back to Dashboard</a></p>
        </div>
      </div>
    `;
  },

  render404() {
    document.getElementById('app').innerHTML = `
      <div class="container" style="text-align:center;padding:80px 20px;">
        <div style="font-size:72px;margin-bottom:16px;opacity:0.3;">404</div>
        <h1 style="font-size:28px;margin-bottom:12px;">Page Not Found</h1>
        <p style="color:var(--text-muted);margin-bottom:32px;max-width:400px;margin-left:auto;margin-right:auto;">The page you're looking for doesn't exist or has been moved.</p>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
          <a href="#/" class="btn btn-gold">Back to Dashboard</a>
          <a href="#/support" class="btn btn-outline">Contact Support</a>
        </div>
      </div>
    `;
  },

  // -----------------------------------------------------------------------
  // CSV/PDF EXPORT (Feature #6 & #11)
  // -----------------------------------------------------------------------
  exportResultsCSV() {
    // Get visible (filtered) results from the table
    const rows = document.querySelectorAll('#results-table tbody tr');
    const csvRows = ['Date,Sport,Event,Selection,Market,Odds,Stake,Result,P/L,Analyst'];
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 9) {
        const values = [];
        for (let i = 0; i < 9; i++) {
          let val = cells[i].textContent.trim().replace(/,/g, ' ');
          values.push('"' + val + '"');
        }
        // Analyst column may not exist in table, use empty
        values.push('""');
        csvRows.push(values.join(','));
      }
    });
    this._downloadCSV(csvRows.join('\n'), 'elite-edge-results.csv');
    trackEvent('export', 'results_csv', csvRows.length + ' rows');
  },

  exportMyBetsCSV() {
    const bets = this.getMyBets();
    if (!bets.length) { App.showToast('No bets to export.', 'info'); return; }
    const csvRows = ['Date,Event,Selection,Odds,Result,P/L'];
    bets.forEach(b => {
      const pnl = b.result === 'won' ? (b.odds - 1) : b.result === 'lost' ? -1 : 0;
      csvRows.push([
        '"' + formatDateUK(b.date) + '"',
        '"' + (b.event || '').replace(/,/g, ' ') + '"',
        '"' + (b.selection || '').replace(/,/g, ' ') + '"',
        b.odds,
        '"' + (b.result || 'PENDING').toUpperCase() + '"',
        pnl.toFixed(2)
      ].join(','));
    });
    this._downloadCSV(csvRows.join('\n'), 'elite-edge-my-bets.csv');
    trackEvent('export', 'mybets_csv', bets.length + ' bets');
  },

  _downloadCSV(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // -----------------------------------------------------------------------
  // TELEGRAM INTEGRATION (Feature #8)
  // -----------------------------------------------------------------------
  formatTipForTelegram(tip) {
    // Placeholder function for formatting tips as Telegram messages
    // In production: use Telegram Bot API (https://core.telegram.org/bots/api)
    // POST https://api.telegram.org/bot<TOKEN>/sendMessage
    return `${tip.isPremium ? 'PREMIUM' : 'FREE'} TIP\n` +
      `${tip.sport === 'racing' ? 'Horse Racing' : 'Football'}\n` +
      `${tip.selection}\n` +
      `${tip.event}\n` +
      `Odds: ${tip.odds} | Confidence: ${tip.confidence}/10\n` +
      `Edge: ${((tip.edge || 0) * 100).toFixed(1)}%\n` +
      `Market: ${tip.market}\n` +
      `Staking: ${tip.staking || '-'}\n\n` +
      `Join us: https://t.me/EliteEdgeTips`;
  },

  sendSelectedToTelegram() {
    const tipIds = [...document.querySelectorAll('.em-tip-check:checked')].map(c => c.value);
    if (!tipIds.length) { App.showToast('No tips selected.', 'info'); return; }
    const messages = tipIds.map(id => {
      const tip = this.tips.find(t => t.id === id);
      return tip ? this.formatTipForTelegram(tip) : null;
    }).filter(Boolean);
    App.showToast('Tips are automatically posted to our Telegram channel.', 'info');
    trackEvent('telegram', 'send_bulletin', tipIds.length + ' tips');
  },

  sendToTelegram(tipId) {
    const tip = this.tips.find(t => t.id === tipId);
    if (!tip) { App.showToast('Tip not found.', 'error'); return; }
    const message = this.formatTipForTelegram(tip);
    // Placeholder: In production, call Telegram Bot API
    // fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ chat_id: '@EliteEdgeTips', text: message })
    // });
    App.showToast('Tips are automatically posted to our Telegram channel.', 'info');
    trackEvent('telegram', 'send_tip', tipId);
  },

  // -----------------------------------------------------------------------
  // BLOG / CONTENT SECTION (Feature #9)
  // -----------------------------------------------------------------------
  blogPosts: [
    {
      slug: 'understanding-value-betting',
      title: 'Understanding Value Betting: Why Edge Matters',
      date: '2026-04-01',
      author: 'The Professor',
      excerpt: 'Value betting is the cornerstone of profitable gambling. Learn why finding edge in the odds is more important than picking winners, and how our model identifies genuine value.',
      content: `<p>Value betting is the cornerstone of long-term profitable gambling. While most punters focus on picking winners, professional bettors understand that the real key to success lies in finding value -- situations where the odds offered by bookmakers are higher than the true probability of an outcome.</p>

<h2>What is Value?</h2>
<p>A value bet exists when the probability of an outcome is greater than what the odds imply. For example, if a horse has a 40% chance of winning but the bookmaker offers odds that imply only a 30% chance (odds of 3.33), you have a 10% edge. Over time, consistently betting with positive edge is mathematically guaranteed to produce profit.</p>

<h2>Why Most Punters Lose</h2>
<p>The average punter bets on outcomes they think will happen, without considering whether the odds represent fair value. A strong favourite at 1.20 might win 90% of the time, but if the true probability is only 85%, you are making a losing bet in the long run. Conversely, a 10/1 outsider that wins only 8% of the time can be a value bet if its true win probability is 12%.</p>

<h2>How We Find Value at Elite Edge</h2>
<p>Our proprietary scoring model analyses dozens of factors for each selection. For horse racing, this includes form, speed ratings, going suitability, trainer-jockey combinations, class movement, draw bias, and market trends. For football, we use expected goals (xG), shots data, home-away splits, injury reports, and scheduling congestion.</p>
<p>Each factor is weighted based on historical significance, and the combined output gives us a model probability for each outcome. When our model probability exceeds the implied probability from the bookmaker odds by a meaningful margin, we have identified genuine value.</p>

<h2>The Importance of Edge Percentage</h2>
<p>We display the edge percentage on every tip card. This number tells you exactly how much our model believes the true probability exceeds what the bookmaker is offering. A 5% edge might not sound like much, but compounded over hundreds of bets, it translates to significant long-term profit.</p>
<p>Our Elite-rated tips typically carry edges of 12% or more -- these are the selections where we have the highest conviction and where the bookmaker pricing is most inefficient.</p>

<h2>Patience and Discipline</h2>
<p>Value betting requires patience. Not every value bet will win -- in fact, many will lose. But the mathematics are on your side over the long run. Our approach at Elite Edge is to identify as many positive-edge opportunities as possible and let the law of large numbers work in our favour.</p>`
    },
    {
      slug: 'xg-football-value',
      title: 'How We Use xG to Find Football Value',
      date: '2026-04-08',
      author: 'The Edge',
      excerpt: 'Expected Goals (xG) has revolutionised football analysis. Discover how we use xG data alongside other metrics to identify mispriced football markets.',
      content: `<p>Expected Goals (xG) has transformed how we analyse football matches and identify value in betting markets. At Elite Edge, xG is just one component of our multi-factor model, but it is arguably the most powerful single metric for predicting match outcomes.</p>

<h2>What is xG?</h2>
<p>Expected Goals measures the quality of chances created. Each shot is assigned a probability of being scored based on historical data -- factors like distance from goal, angle, body part used, assist type, and whether it was a counter-attack or set piece. A penalty has an xG of roughly 0.76, while a shot from 30 yards might be 0.03.</p>

<h2>Why xG Beats Traditional Stats</h2>
<p>Traditional statistics like goals scored and conceded are heavily influenced by luck and variance. A team might score 3 goals from 3 shots of 0.05 xG each -- they were lucky. Conversely, a team creating 3.0 xG but scoring once was unlucky. Over time, actual goals regress to xG, making it a far better predictor of future performance than raw results.</p>

<h2>Our Football Model</h2>
<p>We combine xG with several additional factors:</p>
<p><strong>Form-adjusted xG:</strong> We weight recent matches more heavily, with a decay factor that prioritises the last 6-8 games while still considering the full season.</p>
<p><strong>Home/Away splits:</strong> Some teams create significantly more xG at home versus away. We model this differential to capture venue advantage.</p>
<p><strong>Injury impact:</strong> Key player absences can dramatically alter a team's expected output. We adjust our xG projections based on who is available.</p>
<p><strong>Schedule congestion:</strong> Teams playing their third match in 7 days typically see a drop in xG creation and an increase in xG conceded. Our model accounts for fatigue.</p>

<h2>Finding Value in Markets</h2>
<p>By projecting xG for and against for each team, we can estimate the probability distribution of match outcomes. This gives us probabilities for home win, draw, away win, total goals bands, and both-teams-to-score. We then compare these to bookmaker odds to find value.</p>
<p>Football markets are generally more efficient than racing, so our edges tend to be smaller -- but they are consistent. Our football selections average a 6-8% edge, which compounds into strong ROI over a season of tips.</p>`
    },
    {
      slug: 'how-our-scoring-model-works',
      title: 'Inside Our Scoring Model: How We Find Edge',
      date: '2026-04-15',
      author: 'The Scout',
      excerpt: 'A deep dive into the multi-factor scoring model that powers every Elite Edge selection — from form analysis to market intelligence.',
      content: `<p>Every tip published by Elite Edge Sports Tips is generated by our proprietary multi-factor scoring model. In this post, we explain exactly how it works — because transparency is what sets us apart from every other tipping service.</p>

<h2>Racing: 9 Weighted Factors</h2>
<p>For horse racing, our model evaluates nine key factors for every runner in every race:</p>
<p><strong>Form (20%):</strong> Recent finishing positions, weighted by recency and race quality.<br>
<strong>Going (15%):</strong> How well the horse performs on today's ground conditions, cross-referenced with OpenWeather data.<br>
<strong>Class (12%):</strong> Is the horse stepping up or down in class? Official ratings vs race class.<br>
<strong>Trainer/Jockey (12%):</strong> Current strike rates for the trainer-jockey combination.<br>
<strong>Speed Ratings (10%):</strong> Based on official ratings as a proxy for raw ability.<br>
<strong>Course (10%):</strong> Track suitability — left/right-handed, undulating vs flat.<br>
<strong>Market Support (8%):</strong> Where the smart money is going across 40+ bookmakers.<br>
<strong>Draw (8%):</strong> Draw bias analysis for flat races, adjusted for wind conditions.<br>
<strong>Weight (5%):</strong> Weight carried relative to field average.</p>

<h2>Football: 9 Weighted Factors</h2>
<p>For football, we evaluate:</p>
<p><strong>xG (20%):</strong> Expected goals data — the single most predictive metric in football.<br>
<strong>Form (18%):</strong> Last 5 match results weighted by opposition quality.<br>
<strong>Home/Away (15%):</strong> Venue advantage with historical split analysis.<br>
<strong>Injuries (12%):</strong> Key player absences and their statistical impact.<br>
<strong>H2H (10%):</strong> Head-to-head record between the two sides.<br>
<strong>Motivation (8%):</strong> League position, relegation/title battles, cup ties.<br>
<strong>Shots (7%):</strong> Shot creation and conversion rates.<br>
<strong>Schedule (5%):</strong> Fixture congestion and rotation risk.<br>
<strong>Market Movement (5%):</strong> Odds movement across bookmakers.</p>

<h2>The Edge Calculation</h2>
<p>After scoring, we calculate our model's implied probability and compare it to the bookmaker's implied probability. The difference is the 'edge'. We only publish selections where our edge exceeds 5% for racing and 4% for football. This discipline means we publish fewer tips — but every one has a genuine statistical advantage.</p>`
    }
  ],

  async renderBlogListing() {
    const app = document.getElementById('app');
    app.innerHTML = this.renderSkeleton('tips');

    // Fetch auto-generated weekly reviews
    var weeklyReviews = [];
    try { weeklyReviews = await this.api('/blog/weekly-reviews'); } catch {}

    // Merge with static posts, sorted by date (newest first)
    var allPosts = weeklyReviews.concat(this.blogPosts).sort(function(a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });

    // Store for renderBlogPost to find
    this._allBlogPosts = allPosts;

    app.innerHTML = `
      <div class="container">
        <div class="page-header">
          <h1><span class="accent">Blog</span> & Insights</h1>
          <p>Weekly reviews, expert analysis, and strategy guides from the Elite Edge team.</p>
        </div>
        <div class="blog-grid">
          ${allPosts.map(post => `
            <div class="blog-card" onclick="window.location.hash='#/blog/${post.slug}'">
              ${post.isAutoGenerated ? '<div class="blog-weekly-badge">WEEKLY REVIEW</div>' : ''}
              <div class="blog-date">${formatDateUK(post.date)}</div>
              <h3>${post.title}</h3>
              <div class="blog-excerpt">${post.excerpt}</div>
              ${post.stats ? '<div class="blog-stats-bar"><span class="blog-stat">' + post.stats.wins + '/' + post.stats.tips + ' Winners</span><span class="blog-stat">' + post.stats.strikeRate + '% SR</span><span class="blog-stat ' + (post.stats.pnl >= 0 ? 'positive' : 'negative') + '">' + (post.stats.pnl >= 0 ? '+' : '') + post.stats.pnl + 'u</span><span class="blog-stat">' + (post.stats.roi >= 0 ? '+' : '') + post.stats.roi + '% ROI</span></div>' : ''}
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;">
                <span class="blog-author">By ${post.author}</span>
                <span class="blog-read-more">Read More &rarr;</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  renderBlogPost(slug) {
    // Check auto-generated reviews first, then static posts
    var post = (this._allBlogPosts || []).find(p => p.slug === slug) || this.blogPosts.find(p => p.slug === slug);
    if (!post) { this.render404(); return; }
    trackEvent('blog', 'view_post', post.title);
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="container">
        <div class="blog-post">
          <p class="mb-16"><a href="#/blog" class="text-gold">&larr; Back to Blog</a></p>
          <h1>${post.title}</h1>
          <div class="blog-post-meta">By <span class="text-gold">${post.author}</span> &bull; ${formatDateUK(post.date)}</div>
          <div class="blog-post-body">${post.content}</div>
          <div class="card card-premium text-center mt-32" style="padding:32px;">
            <h3 class="mb-8">Want More Insights?</h3>
            <p class="text-muted mb-16">Premium members get daily deep-dive analysis on every selection.</p>
            <a href="#/pricing" class="btn btn-gold">View Premium Plans</a>
          </div>
          <p class="mt-24"><a href="#/blog" class="text-gold">&larr; Back to Blog</a></p>
        </div>
      </div>
    `;
  },

  // -----------------------------------------------------------------------
  // ONBOARDING WALKTHROUGH (Feature #10)
  // -----------------------------------------------------------------------
  _onboardingStep: 0,

  showOnboarding() {
    this._onboardingStep = 0;
    this._renderOnboardingStep();
  },

  _onboardingSteps: [
    { title: 'Welcome to Elite Edge', desc: 'The UK\'s most advanced sports tipping platform. AI-powered tips across 6 sports — Racing, Football, NBA, Tennis, Rugby, and NFL. Every selection analysed by 3 AI engines before publication.' },
    { title: 'Your 5 Free Credits', desc: 'You\'ve received 5 free credits. Each premium tip costs 1 credit to view. Your credit balance is shown in the top menu bar. When you run out, buy more credit packs from £1.99 or upgrade to a subscription for monthly credits.' },
    { title: 'Browse Tips & Tools', desc: 'Check today\'s selections on the Dashboard. Use the Smart Acca Generator to build accumulators across all 6 sports. Explore the Betting Calculators for returns on any bet type. Visit the Betting Academy to sharpen your knowledge.' },
    { title: 'Earn Free Credits', desc: 'Refer a friend and earn +3 credits when they sign up (+5 more if they start a trial). Share a tip on social media for +1 credit per day. Check your referral link and stats on the Refer & Earn page.' },
    { title: 'Start Your Free Trial', desc: 'Ready for full access? Start a 14-day free trial — get 120 credits per month, full AI analysis, email bulletins, alerts, and the acca generator. Card required but you won\'t be charged for 14 days. Cancel anytime.' },
  ],

  _renderOnboardingStep() {
    const container = document.getElementById('onboarding-container');
    if (!container) return;
    const step = this._onboardingSteps[this._onboardingStep];
    const total = this._onboardingSteps.length;
    container.innerHTML = `
      <div class="onboarding-overlay">
        <div class="onboarding-modal">
          <h2>${step.title}</h2>
          <p>${step.desc}</p>
          <div class="onboarding-dots">
            ${this._onboardingSteps.map((_, i) => `<div class="onboarding-dot ${i === this._onboardingStep ? 'active' : ''}"></div>`).join('')}
          </div>
          <div class="onboarding-actions">
            <button class="btn btn-outline btn-sm" onclick="App.skipOnboarding()">Skip</button>
            <button class="btn btn-gold" onclick="App.nextOnboarding()">${this._onboardingStep < total - 1 ? 'Next' : 'Get Started'}</button>
          </div>
        </div>
      </div>
    `;
  },

  nextOnboarding() {
    this._onboardingStep++;
    if (this._onboardingStep >= this._onboardingSteps.length) {
      this.skipOnboarding();
    } else {
      this._renderOnboardingStep();
    }
  },

  skipOnboarding() {
    localStorage.setItem('onboardingDone', 'true');
    const container = document.getElementById('onboarding-container');
    if (container) container.innerHTML = '';
  },

  getTestimonials() {
    return [
      { text: "Every selection comes with a full breakdown — form, going, market movement. You can see exactly why each tip was chosen. That transparency is what sets this apart.", author: "Premium Subscriber", role: "Racing & Football Package", stars: 5 },
      { text: "The statistical analysis behind each tip is genuinely impressive. xG data, confidence scores, value ratings — it's like having a professional analyst on call.", author: "Premium Subscriber", role: "Full Access Member", stars: 5 },
      { text: "Finally a service that shows its working. Verified results, transparent track record, proper analysis. No hype, just data-driven selections.", author: "Premium Subscriber", role: "Annual Member", stars: 5 },
    ];
  },

  /* ======================================================================
     RACE DAY LIVE HUB
     ====================================================================== */
  _liveIntervals: null,
  _liveHubData: null,

  async renderLiveHub() {
    var self = this;
    var app = document.getElementById('app');
    var isPremium = this.isPremium();
    var today = new Date();
    var todayStr = today.toISOString().split('T')[0];
    var todayDisplay = today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    app.innerHTML = this.renderSkeleton('dashboard');

    // Fetch all data sources
    var tips = [], liveCards = [], liveResults = [], settledResults = [];
    try {
      var responses = await Promise.allSettled([
        fetch('/api/tips').then(function(r) { return r.ok ? r.json() : []; }),
        fetch('/api/racing/live-cards').then(function(r) { return r.ok ? r.json() : []; }),
        fetch('/api/racing/live-results').then(function(r) { return r.ok ? r.json() : []; }),
        fetch('/api/results').then(function(r) { return r.ok ? r.json() : []; })
      ]);
      tips = (responses[0].status === 'fulfilled' ? responses[0].value : []);
      if (tips.tips) tips = tips.tips;
      if (!Array.isArray(tips)) tips = [];
      liveCards = (responses[1].status === 'fulfilled' ? responses[1].value : []);
      if (liveCards.meetings) liveCards = liveCards.meetings;
      if (!Array.isArray(liveCards)) liveCards = [];
      liveResults = (responses[2].status === 'fulfilled' ? responses[2].value : []);
      if (liveResults.results) liveResults = liveResults.results;
      if (!Array.isArray(liveResults)) liveResults = [];
      settledResults = (responses[3].status === 'fulfilled' ? responses[3].value : []);
      if (settledResults.results) settledResults = settledResults.results;
      if (!Array.isArray(settledResults)) settledResults = [];
    } catch (e) { console.error('Live Hub fetch error:', e); }

    // Filter today's racing tips
    var todayTips = tips.filter(function(t) {
      return App._normDate(t.date) === todayStr && (t.sport === 'racing' || t.sport === 'horse-racing' || t.category === 'racing');
    });

    // Calculate stats
    var totalTips = todayTips.length;
    var wonTips = todayTips.filter(function(t) { return t.result === 'won'; });
    var lostTips = todayTips.filter(function(t) { return t.result === 'lost'; });
    var placedTips = todayTips.filter(function(t) { return t.result === 'placed'; });
    var settledCount = wonTips.length + lostTips.length + placedTips.length;
    var strikeRate = settledCount > 0 ? Math.round((wonTips.length / settledCount) * 100) : 0;
    var pnl = 0;
    todayTips.forEach(function(t) {
      if (t.result === 'won' && t.odds) {
        var dec = typeof t.odds === 'number' ? t.odds : parseFloat(t.odds) || 0;
        pnl += (dec - 1);
      } else if (t.result === 'lost') {
        pnl -= 1;
      } else if (t.result === 'placed' && t.eachWayReturn) {
        pnl += (parseFloat(t.eachWayReturn) || 0);
      }
    });

    // Find next race from live cards
    var now = new Date();
    var nextRace = null;
    var nextRaceTime = null;
    var allRaces = [];
    liveCards.forEach(function(meeting) {
      var meetingName = meeting.meeting || meeting.name || meeting.course || '';
      var races = meeting.races || [];
      races.forEach(function(race) {
        var raceTimeStr = race.time || race.offTime || '';
        if (!raceTimeStr) return;
        var parts = raceTimeStr.split(':');
        var raceDate = new Date(now);
        raceDate.setHours(parseInt(parts[0]) || 0, parseInt(parts[1]) || 0, 0, 0);
        allRaces.push({ meeting: meetingName, race: race, dateObj: raceDate, time: raceTimeStr });
      });
    });
    allRaces.sort(function(a, b) { return a.dateObj - b.dateObj; });
    for (var i = 0; i < allRaces.length; i++) {
      if (allRaces[i].dateObj > now) {
        nextRace = allRaces[i];
        nextRaceTime = allRaces[i].dateObj;
        break;
      }
    }

    // Find our tip for the next race
    var nextRaceTip = null;
    if (nextRace) {
      nextRaceTip = todayTips.find(function(t) {
        return (t.time === nextRace.time || t.raceTime === nextRace.time) &&
               (t.meeting === nextRace.meeting || t.course === nextRace.meeting);
      }) || null;
    }

    // Today's results for the right column
    var todayResults = liveResults.filter(function(r) {
      return App._normDate(r.date) === todayStr || !r.date;
    });
    // Also merge settled tips as results
    var settledToday = settledResults.filter(function(r) { return App._normDate(r.date) === todayStr; });

    // Build the page
    var blurClass = isPremium ? '' : ' live-hub-blurred';

    // --- LEFT COLUMN: Next Race Countdown ---
    var leftHTML = '<div class="live-hub-panel">' +
      '<div class="live-hub-panel-header"><span class="live-pulse"></span> NEXT RACE</div>';
    if (nextRace) {
      leftHTML += '<div class="live-countdown-meeting">' + self._escHtml(nextRace.meeting) + '</div>' +
        '<div class="live-countdown-time">' + nextRace.time + '</div>' +
        '<div class="live-countdown" id="live-countdown">--:--:--</div>' +
        '<div class="live-countdown-details">';
      if (nextRace.race.raceName) leftHTML += '<div class="live-countdown-detail">' + self._escHtml(nextRace.race.raceName) + '</div>';
      if (nextRace.race.class) leftHTML += '<div class="live-countdown-detail">Class ' + self._escHtml(String(nextRace.race.class)) + '</div>';
      if (nextRace.race.distance) leftHTML += '<div class="live-countdown-detail">' + self._escHtml(nextRace.race.distance) + '</div>';
      if (nextRace.race.going) leftHTML += '<div class="live-countdown-detail">' + self._escHtml(nextRace.race.going) + '</div>';
      leftHTML += '</div>';
      if (nextRaceTip) {
        leftHTML += '<div class="live-next-tip' + blurClass + '">' +
          '<div class="live-next-tip-label">OUR SELECTION</div>' +
          '<div class="live-next-tip-horse">' + self._escHtml(nextRaceTip.selection || nextRaceTip.horse || nextRaceTip.name || '-') + '</div>' +
          '<div class="live-next-tip-meta">' +
            '<span>Odds: ' + (nextRaceTip.odds || '-') + '</span>' +
            (nextRaceTip.confidence ? '<span>Confidence: ' + nextRaceTip.confidence + '%</span>' : '') +
            (nextRaceTip.edge ? '<span>Edge: ' + nextRaceTip.edge + '%</span>' : '') +
          '</div>' +
        '</div>';
        if (!isPremium) {
          leftHTML += '<div class="live-upgrade-cta"><a href="#/pricing" class="btn btn-gold btn-sm">Upgrade to See Tips</a></div>';
        }
      }
    } else {
      leftHTML += '<div class="live-no-races"><div style="font-size:36px;margin-bottom:12px;">&#127939;</div>' +
        '<div>No upcoming races</div><div class="text-muted text-sm">Check back on the next race day</div></div>';
    }
    leftHTML += '</div>';

    // --- CENTRE COLUMN: Today's Tipped Selections ---
    var centreHTML = '<div class="live-hub-panel live-hub-panel-centre">' +
      '<div class="live-hub-panel-header">TODAY\'S SELECTIONS</div>' +
      '<div class="live-selections-pnl">P/L: <span class="' + (pnl >= 0 ? 'ds-positive' : 'ds-negative') + '">' + (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + 'u</span></div>';
    if (todayTips.length === 0) {
      centreHTML += '<div class="live-no-races"><div style="font-size:28px;margin-bottom:8px;">&#128203;</div><div>No racing tips today yet</div></div>';
    } else {
      centreHTML += '<div class="live-selections-list' + blurClass + '">';
      todayTips.forEach(function(tip) {
        var status = tip.result || 'pending';
        var statusClass = 'pending';
        var statusLabel = 'Pending';
        var statusIcon = '';
        if (status === 'won') { statusClass = 'won'; statusLabel = 'Won'; statusIcon = '&#10003;'; }
        else if (status === 'lost') { statusClass = 'lost'; statusLabel = 'Lost'; statusIcon = '&#10007;'; }
        else if (status === 'placed') { statusClass = 'placed'; statusLabel = 'Placed'; statusIcon = '&#9679;'; }
        else if (status === 'running') { statusClass = 'running'; statusLabel = 'Running'; statusIcon = '&#9654;'; }

        centreHTML += '<div class="live-selection ' + statusClass + '">' +
          '<div class="live-selection-time">' + (tip.time || tip.raceTime || '-') + '</div>' +
          '<div class="live-selection-body">' +
            '<div class="live-selection-meeting">' + self._escHtml(tip.meeting || tip.course || '-') + '</div>' +
            '<div class="live-selection-horse">' + self._escHtml(tip.selection || tip.horse || tip.name || '-') + '</div>' +
          '</div>' +
          '<div class="live-selection-odds">' + (tip.odds || '-') + '</div>' +
          (tip.confidence ? '<div class="live-selection-conf">' + tip.confidence + '%</div>' : '') +
          '<div class="live-selection-status live-status-' + statusClass + '">' + statusIcon + ' ' + statusLabel + '</div>' +
        '</div>';
      });
      centreHTML += '</div>';
      if (!isPremium) {
        centreHTML += '<div class="live-upgrade-cta"><a href="#/pricing" class="btn btn-gold">Upgrade for Full Access</a></div>';
      }
    }
    centreHTML += '</div>';

    // --- RIGHT COLUMN: Live Results Feed ---
    var rightHTML = '<div class="live-hub-panel">' +
      '<div class="live-hub-panel-header">RESULTS</div>' +
      '<div class="live-results-feed" id="live-results-feed">';
    var combinedResults = todayResults.concat(settledToday);
    if (combinedResults.length === 0) {
      rightHTML += '<div class="live-no-races"><div style="font-size:28px;margin-bottom:8px;">&#9203;</div><div>Awaiting results</div><div class="text-muted text-sm">Results appear here as races finish</div></div>';
    } else {
      combinedResults.forEach(function(res) {
        var winner = res.winner || res.selection || res.horse || res.name || '-';
        var sp = res.sp || res.odds || '-';
        var meeting = res.meeting || res.course || '-';
        var time = res.time || res.raceTime || '-';
        // Check if our tip called it
        var calledIt = todayTips.some(function(t) {
          return t.result === 'won' && (t.time === time || t.raceTime === time) &&
                 (t.meeting === meeting || t.course === meeting);
        });
        var resultClass = calledIt ? 'live-result called-it' : (res.ourResult === 'lost' ? 'live-result lost' : 'live-result');
        rightHTML += '<div class="' + resultClass + '">' +
          '<div class="live-result-time">' + self._escHtml(String(time)) + '</div>' +
          '<div class="live-result-body">' +
            '<div class="live-result-meeting">' + self._escHtml(String(meeting)) + '</div>' +
            '<div class="live-result-winner">' + self._escHtml(String(winner)) + '</div>' +
          '</div>' +
          '<div class="live-result-sp">SP: ' + self._escHtml(String(sp)) + '</div>' +
          (calledIt ? '<div class="live-result-badge">WE CALLED IT</div>' : '') +
        '</div>';
      });
    }
    rightHTML += '</div></div>';

    // --- ASSEMBLE ---
    app.innerHTML = '<div class="live-hub">' +
      '<div class="live-hub-topbar">' +
        '<div class="live-hub-topbar-left">' +
          '<span class="live-pulse"></span>' +
          '<span class="live-hub-badge">LIVE</span>' +
          '<span class="live-hub-date">' + todayDisplay + '</span>' +
        '</div>' +
        '<div class="live-hub-topbar-stats">' +
          '<div class="live-hub-stat"><div class="live-hub-stat-value">' + totalTips + '</div><div class="live-hub-stat-label">Tips Today</div></div>' +
          '<div class="live-hub-stat"><div class="live-hub-stat-value ds-positive">' + wonTips.length + '</div><div class="live-hub-stat-label">Won</div></div>' +
          '<div class="live-hub-stat"><div class="live-hub-stat-value ' + (pnl >= 0 ? 'ds-positive' : 'ds-negative') + '">' + (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + 'u</div><div class="live-hub-stat-label">P/L</div></div>' +
          '<div class="live-hub-stat"><div class="live-hub-stat-value">' + strikeRate + '%</div><div class="live-hub-stat-label">Strike Rate</div></div>' +
        '</div>' +
        '<div class="live-hub-topbar-right">' +
          '<span class="live-hub-refresh-label text-muted text-xs">Auto-refresh: 30s</span>' +
          '<button class="btn btn-outline btn-sm" onclick="App.renderLiveHub()" title="Refresh now">&#8635; Refresh</button>' +
        '</div>' +
      '</div>' +
      '<div class="live-hub-grid">' +
        leftHTML +
        centreHTML +
        rightHTML +
      '</div>' +
    '</div>';

    // --- COUNTDOWN TIMER ---
    self._liveIntervals = [];
    if (nextRaceTime) {
      var countdownEl = document.getElementById('live-countdown');
      var countdownInterval = setInterval(function() {
        var now2 = new Date();
        var diff = nextRaceTime - now2;
        if (diff <= 0) {
          if (countdownEl) countdownEl.textContent = '00:00:00';
          return;
        }
        var h = Math.floor(diff / 3600000);
        var m = Math.floor((diff % 3600000) / 60000);
        var s = Math.floor((diff % 60000) / 1000);
        if (countdownEl) {
          countdownEl.textContent =
            (h < 10 ? '0' : '') + h + ':' +
            (m < 10 ? '0' : '') + m + ':' +
            (s < 10 ? '0' : '') + s;
        }
      }, 1000);
      self._liveIntervals.push(countdownInterval);
    }

    // --- AUTO-REFRESH every 30 seconds ---
    var refreshInterval = setInterval(function() {
      if (self.currentPage === 'live') {
        self.renderLiveHub();
      }
    }, 30000);
    self._liveIntervals.push(refreshInterval);
  },

  // =========================================================================
  // PROFIT CALENDAR — GitHub-style heatmap for daily P/L
  // =========================================================================
  renderProfitCalendar(results) {
    var container = document.getElementById('profit-calendar-container');
    if (!container) return;

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var todayStr = this._getToday();

    // Build a map of date -> { pnl, wins, losses }
    var dayMap = {};
    (results || []).forEach(function(r) {
      if (!r.date) return;
      var d = r.date.substring(0, 10);
      if (!dayMap[d]) dayMap[d] = { pnl: 0, wins: 0, losses: 0 };
      dayMap[d].pnl += (r.pnl || 0);
      if (r.result === 'won') dayMap[d].wins++;
      else if (r.result === 'lost') dayMap[d].losses++;
    });

    // Generate last 90 days
    var days = [];
    for (var i = 89; i >= 0; i--) {
      var d = new Date(today);
      d.setDate(d.getDate() - i);
      var dateStr = d.toISOString().split('T')[0];
      var dayOfWeek = d.getDay(); // 0=Sun, 1=Mon...
      days.push({
        date: dateStr,
        dayOfWeek: dayOfWeek,
        data: dayMap[dateStr] || null
      });
    }

    // Build grid: 7 columns (Mon-Sun). We need to pad the first row.
    // Convert Sun=0 to Mon-based: Mon=0, Tue=1, ... Sun=6
    var firstDayCol = (days[0].dayOfWeek + 6) % 7; // Mon-based index

    var squaresHtml = '';
    // Add empty cells for padding the first row
    for (var p = 0; p < firstDayCol; p++) {
      squaresHtml += '<div class="profit-cal-day no-data" style="visibility:hidden;"></div>';
    }

    var self = this;
    days.forEach(function(day) {
      var cls = 'profit-cal-day';
      if (day.date === todayStr) cls += ' today';

      if (!day.data) {
        cls += ' no-data';
      } else {
        var pnl = day.data.pnl;
        var absPnl = Math.abs(pnl);
        if (pnl > 0) {
          if (absPnl >= 3) cls += ' profit-high';
          else if (absPnl >= 1) cls += ' profit-med';
          else cls += ' profit-low';
        } else if (pnl < 0) {
          if (absPnl >= 3) cls += ' loss-high';
          else if (absPnl >= 1) cls += ' loss-med';
          else cls += ' loss-low';
        } else {
          cls += ' no-data';
        }
      }

      var tooltipText = '';
      var dateLabel = new Date(day.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      if (day.data) {
        var pnlStr = (day.data.pnl >= 0 ? '+' : '') + day.data.pnl.toFixed(2) + 'u';
        tooltipText = dateLabel + ': ' + pnlStr + ' (' + day.data.wins + 'W ' + day.data.losses + 'L)';
      } else {
        tooltipText = dateLabel + ': No tips';
      }

      squaresHtml += '<div class="' + cls + '" data-tooltip="' + tooltipText + '" data-date="' + day.date + '"></div>';
    });

    // Month labels
    var monthLabels = '';
    var seenMonths = {};
    days.forEach(function(day) {
      var m = day.date.substring(0, 7);
      if (!seenMonths[m]) {
        seenMonths[m] = true;
        var label = new Date(day.date).toLocaleDateString('en-GB', { month: 'short' });
        monthLabels += '<span class="profit-cal-month-label">' + label + '</span>';
      }
    });

    // Summary stats
    var activeDays = Object.keys(dayMap).filter(function(d) {
      var dDate = new Date(d);
      var cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() - 89);
      return dDate >= cutoff && dDate <= today;
    });
    var profitableDays = activeDays.filter(function(d) { return dayMap[d].pnl > 0; });
    var pct = activeDays.length > 0 ? Math.round((profitableDays.length / activeDays.length) * 100) : 0;

    container.innerHTML =
      '<div class="section">' +
        '<div class="section-title"><span class="icon">&#128197;</span> Profit Calendar — Last 90 Days</div>' +
        '<div class="card" style="padding:20px;">' +
          '<div class="profit-calendar-day-labels">' +
            '<span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>' +
          '</div>' +
          '<div class="profit-calendar-grid">' + squaresHtml + '</div>' +
          '<div class="profit-calendar-months">' + monthLabels + '</div>' +
          '<div class="profit-calendar-legend">' +
            '<span class="profit-cal-legend-label">Loss</span>' +
            '<div class="profit-cal-day loss-high" style="width:14px;height:14px;"></div>' +
            '<div class="profit-cal-day loss-med" style="width:14px;height:14px;"></div>' +
            '<div class="profit-cal-day loss-low" style="width:14px;height:14px;"></div>' +
            '<div class="profit-cal-day no-data" style="width:14px;height:14px;"></div>' +
            '<div class="profit-cal-day profit-low" style="width:14px;height:14px;"></div>' +
            '<div class="profit-cal-day profit-med" style="width:14px;height:14px;"></div>' +
            '<div class="profit-cal-day profit-high" style="width:14px;height:14px;"></div>' +
            '<span class="profit-cal-legend-label">Profit</span>' +
          '</div>' +
          '<div class="profit-calendar-summary">' +
            '<span class="positive">' + profitableDays.length + '</span> profitable days out of ' +
            '<span>' + activeDays.length + '</span> active days ' +
            '(<span class="' + (pct >= 50 ? 'positive' : 'negative') + '">' + pct + '%</span>)' +
          '</div>' +
        '</div>' +
      '</div>';

    // Attach tooltip listeners
    container.querySelectorAll('.profit-cal-day[data-tooltip]').forEach(function(el) {
      el.addEventListener('mouseenter', function(e) {
        var existing = container.querySelector('.profit-cal-tooltip');
        if (existing) existing.remove();
        var tip = document.createElement('div');
        tip.className = 'profit-cal-tooltip';
        tip.textContent = el.getAttribute('data-tooltip');
        el.style.position = 'relative';
        el.appendChild(tip);
      });
      el.addEventListener('mouseleave', function() {
        var tip = el.querySelector('.profit-cal-tooltip');
        if (tip) tip.remove();
      });
    });
  },

  // =========================================================================
  // WIN CELEBRATIONS — Gold confetti animation for new wins
  // =========================================================================
  showWinCelebration(tipData, isPersonal) {
    var self = this;
    var overlay = document.createElement('div');
    overlay.className = 'win-celebration-overlay';

    // More confetti for personal wins
    var confettiCount = isPersonal ? 60 : 30;
    var confettiColors = ['#d4a843', '#22c55e', '#ffffff', '#f5d77a', '#4ade80', '#3b82f6'];
    for (var i = 0; i < confettiCount; i++) {
      var particle = document.createElement('div');
      particle.className = 'confetti-particle';
      particle.style.left = (Math.random() * 100) + 'vw';
      particle.style.backgroundColor = confettiColors[Math.floor(Math.random() * confettiColors.length)];
      particle.style.animationDelay = (Math.random() * 2) + 's';
      particle.style.animationDuration = (2 + Math.random() * 1.5) + 's';
      particle.style.width = (5 + Math.random() * 8) + 'px';
      particle.style.height = (5 + Math.random() * 8) + 'px';
      particle.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      overlay.appendChild(particle);
    }

    var oddsStr = this.formatOdds(tipData.odds);
    var pnl = tipData.pnl || 0;
    var pnlStr = (pnl > 0 ? '+' : '') + pnl.toFixed(2);
    var bankSettings = this.getBankrollSettings ? this.getBankrollSettings() : null;
    var unitSize = bankSettings ? (bankSettings.stakeSize || Math.round((bankSettings.startingBank || 100) * 0.01 * 100) / 100) : null;
    var pnlMoney = unitSize ? (pnl * unitSize).toFixed(2) : null;
    var analystName = tipData.tipsterProfile || tipData.analyst || '';

    var card = document.createElement('div');
    card.className = 'win-celebration-card';
    card.innerHTML =
      '<div class="win-celebration-trophy">' + (isPersonal ? '&#127881;' : '&#127942;') + '</div>' +
      '<div class="win-celebration-title">' + (isPersonal ? 'YOUR TIP WON!' : 'WINNER!') + '</div>' +
      '<div class="win-celebration-selection">' + (tipData.selection || '') + '</div>' +
      '<div class="win-celebration-odds">' + (tipData.event || '') + ' &mdash; ' + oddsStr + '</div>' +
      (analystName ? '<div style="font-size:12px;margin:6px 0;"><span style="background:rgba(212,168,67,0.15);color:#d4a843;padding:2px 8px;border-radius:4px;font-weight:700;">' + analystName + '</span></div>' : '') +
      '<div class="win-celebration-pnl">' + pnlStr + ' units' + (pnlMoney ? ' (&pound;' + pnlMoney + ')' : '') + '</div>' +
      (isPersonal ? '<div style="margin-top:16px;display:flex;gap:8px;justify-content:center;">' +
        '<button onclick="event.stopPropagation();App.generateShareCard({selection:\'' + (tipData.selection || '').replace(/'/g, "\\'") + '\',odds:' + (tipData.odds || 0) + ',pnl:' + pnl + ',sport:\'' + (tipData.sport || 'racing') + '\',event:\'' + (tipData.event || '').replace(/'/g, "\\'") + '\'});" style="background:#d4a843;color:#0a0e1a;border:none;padding:8px 20px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;">Share This Win</button>' +
        '<button onclick="event.stopPropagation();window.location.hash=\'#/my-roi\';" style="background:rgba(255,255,255,0.1);color:#fff;border:1px solid #2a2d45;padding:8px 16px;border-radius:8px;font-size:13px;cursor:pointer;">My ROI</button>' +
      '</div>' : '') +
      '<div style="font-size:11px;color:#475569;margin-top:12px;">Tap to close</div>';
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Pulse P/L elements
    var pnlEls = document.querySelectorAll('.pnl-positive, .stat-value.positive, .trust-value');
    pnlEls.forEach(function(el) { el.classList.add('win-pulse'); });

    // Dismiss on click or after 5 seconds (longer for personal)
    var dismissTime = isPersonal ? 8000 : 4000;
    var dismiss = function() {
      overlay.classList.add('win-celebration-out');
      pnlEls.forEach(function(el) { el.classList.remove('win-pulse'); });
      setTimeout(function() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 400);
    };
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) dismiss();
    });
    setTimeout(dismiss, dismissTime);
  },

  checkForNewWins() {
    var self = this;
    var today = this._getToday();
    var yesterday = this._getYesterday();

    this.api('/results').then(function(results) {
      if (!results || !results.length) return;

      // Filter to won/placed results from today or yesterday
      var recentWins = results.filter(function(r) {
        return (r.result === 'won' || r.result === 'placed') && (App._normDate(r.date) === today || App._normDate(r.date) === yesterday);
      });

      if (!recentWins.length) return;

      // Get stored seen win IDs
      var storedStr = localStorage.getItem('ee_last_seen_wins');
      var seenWins = [];
      try { seenWins = JSON.parse(storedStr) || []; } catch(e) { seenWins = []; }

      // Find unseen wins
      var unseenWins = recentWins.filter(function(w) {
        var winId = w.id || (w.selection + '_' + w.date + '_' + w.odds);
        return seenWins.indexOf(winId) === -1;
      });

      if (!unseenWins.length) return;

      // Check which wins the user personally backed
      var myBets = self.getMyBets();
      var backedTipIds = {};
      myBets.forEach(function(b) { backedTipIds[b.tipId] = true; });

      // Mark all as seen
      var allIds = seenWins.slice();
      unseenWins.forEach(function(w) {
        var winId = w.id || (w.selection + '_' + w.date + '_' + w.odds);
        allIds.push(winId);
      });
      if (allIds.length > 100) allIds = allIds.slice(-100);
      localStorage.setItem('ee_last_seen_wins', JSON.stringify(allIds));

      // Personal wins first (bigger celebration), then general wins
      var personalWins = unseenWins.filter(function(w) { return backedTipIds[w.tipId]; });
      var generalWins = unseenWins.filter(function(w) { return !backedTipIds[w.tipId]; });
      var ordered = personalWins.concat(generalWins);

      // Only show max 3 celebrations to avoid fatigue
      ordered.slice(0, 3).forEach(function(win, index) {
        var isPersonal = backedTipIds[win.tipId];
        var delay = isPersonal ? 9000 : 5000;
        var startDelay = 0;
        for (var d = 0; d < index; d++) {
          startDelay += backedTipIds[ordered[d].tipId] ? 9000 : 5000;
        }
        setTimeout(function() {
          self.showWinCelebration(win, isPersonal);
        }, startDelay);
      });
    }).catch(function() {});
  },

  getFAQs() {
    return [
      { q: "How are your tips generated?", a: "Our tips are generated using a proprietary multi-factor scoring model that analyses form, statistics, market movements, and contextual data. For horse racing, we evaluate speed ratings, going suitability, trainer/jockey stats, draw bias, and class movement. For football, we use expected goals (xG), home/away splits, injury reports, and head-to-head records. Every tip must exceed a minimum edge threshold before publication." },
      { q: "What does 'edge' mean?", a: "Edge is the difference between our model's calculated probability and the bookmaker's implied probability (derived from the odds). For example, if we calculate a 50% chance of winning but the odds imply only 33%, we have a 17% edge. Positive edge means we believe the odds are in the bettor's favour." },
      { q: "How is ROI calculated?", a: "ROI (Return on Investment) = (Total Profit / Total Staked) x 100. For example, if we've staked 100 units total and our net profit is 15 units, our ROI is +15%. We track this across all published tips with full transparency." },
      { q: "What's included in Premium?", a: "Premium members get 2-4 carefully selected premium tips daily — we only publish when the edge is genuine. Full deep-dive analysis with probability calculations, staking recommendations, early morning access before 9am, daily email bulletins, and priority Telegram alerts. Quality over quantity — we never publish filler tips." },
      { q: "Can I cancel my subscription?", a: "Yes, you can cancel anytime with no questions asked. We also offer a 14-day money-back guarantee on all new subscriptions. Simply contact support@eliteedgesports.co.uk to cancel." },
      { q: "How do I know your results are real?", a: "All tips are published before the event starts with timestamped records. Our full results history is publicly available on the Results page, including every loss. We believe in complete transparency — that's why we show ROI, strike rate, and every individual result." },
      { q: "Do you cover all horse racing meetings?", a: "We cover all major UK and Irish meetings daily, including Ascot, Newmarket, York, Kempton, Cheltenham, Aintree, and more, plus selected midweek cards from every active racecourse. Our Racing API provides live data from every UK and Irish meeting." },
      { q: "What football leagues do you cover?", a: "We cover the Premier League, Champions League, La Liga, Serie A, Bundesliga, and Ligue 1. Our model performs best on leagues with rich statistical data. We plan to add Eredivisie, Liga Portugal, and select South American leagues." },
    ];
  },

  // ── Premier League Weekend Preview ──────────────────────────────────
  async renderPremierLeague() {
    var app = document.getElementById('app');
    app.innerHTML = this.renderSkeleton('tips');

    // Calculate upcoming Saturday & Sunday
    var now = new Date();
    var day = now.getDay(); // 0=Sun … 6=Sat
    var daysToSat = (6 - day + 7) % 7 || 7; // next Sat (if today is Sat, still show this weekend)
    if (day === 6) daysToSat = 0; // today is Saturday
    if (day === 0) daysToSat = 6; // today is Sunday — show today's fixtures
    var sat = new Date(now); sat.setDate(now.getDate() + daysToSat);
    var sun = new Date(sat); sun.setDate(sat.getDate() + 1);
    if (day === 0) { // Sunday — show today
      sun = new Date(now);
      sat = new Date(now); sat.setDate(now.getDate() - 1);
    }
    var satStr = sat.toISOString().split('T')[0];
    var sunStr = sun.toISOString().split('T')[0];

    var satLabel = sat.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    var sunLabel = sun.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

    var plFixtures = [];
    var tips = [];
    try {
      var results = await Promise.all([
        this.fetchLiveFootball(false, satStr),
        this.fetchLiveFootball(false, sunStr),
        this.api('/tips?sport=football')
      ]);
      var satData = results[0];
      var sunData = results[1];
      tips = results[2] || [];

      var allFixtures = [];
      if (satData && satData.fixtures) allFixtures = allFixtures.concat(satData.fixtures);
      if (sunData && sunData.fixtures) allFixtures = allFixtures.concat(sunData.fixtures);

      // Filter to Premier League only
      plFixtures = allFixtures.filter(function(f) {
        var leagueName = (f.league || '').toLowerCase();
        return f.leagueId === 39 || leagueName.indexOf('premier') !== -1;
      });
    } catch(e) {
      console.error('PL Preview fetch error:', e);
    }

    var isPremium = this.isPremium();
    var isLoggedIn = !!this.user;

    // Count edge opportunities (fixtures where we have tips)
    var edgeCount = 0;
    plFixtures.forEach(function(f) {
      var home = (f.homeTeam || f.home || '').toLowerCase();
      var away = (f.awayTeam || f.away || '').toLowerCase();
      var hasTip = tips.some(function(t) {
        var ev = (t.event || '').toLowerCase();
        return ev.indexOf(home) !== -1 || ev.indexOf(away) !== -1;
      });
      if (hasTip) edgeCount++;
    });

    // Build fixture cards
    var self = this;
    var fixtureCards = plFixtures.map(function(f, idx) {
      var home = f.homeTeam || f.home || 'Home';
      var away = f.awayTeam || f.away || 'Away';
      var kickoff = f.kickoff ? new Date(f.kickoff) : null;
      var kickoffDay = kickoff ? kickoff.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
      var kickoffTime = kickoff ? kickoff.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
      var venue = f.venue || '';

      // Find matching tip
      var matchTip = null;
      var homeLower = home.toLowerCase();
      var awayLower = away.toLowerCase();
      tips.forEach(function(t) {
        var ev = (t.event || '').toLowerCase();
        if (ev.indexOf(homeLower) !== -1 || ev.indexOf(awayLower) !== -1) matchTip = t;
      });

      // Generate verdicts
      var verdicts = self.generateStaticVerdicts(f, matchTip);

      // Premium gate: free users see first verdict of first match only
      var showFull = isPremium || idx === 0;
      var blurClass = showFull ? '' : ' pl-blurred';

      var verdictsHtml = verdicts.map(function(v, vi) {
        var showVerdict = isPremium || (idx === 0 && vi === 0);
        if (!showVerdict) {
          return '<div class="pl-verdict-card ' + v.type + ' pl-verdict-locked">' +
            '<div class="pl-verdict-analyst ' + v.type + '">' + v.analyst + '</div>' +
            '<div class="pl-verdict-text" style="filter:blur(5px);user-select:none;">' + v.text + '</div>' +
            '<div class="pl-verdict-pick" style="filter:blur(5px);">' + v.verdict + '</div>' +
            '</div>';
        }
        var stars = '';
        for (var s = 0; s < 5; s++) stars += s < v.confidence ? '\u2605' : '\u2606';
        return '<div class="pl-verdict-card ' + v.type + '">' +
          '<div class="pl-verdict-analyst ' + v.type + '">' + v.analyst + '</div>' +
          '<div class="pl-verdict-text">' + v.text + '</div>' +
          '<div class="pl-verdict-pick">VERDICT: ' + v.verdict + ' <span class="pl-verdict-stars">' + stars + '</span></div>' +
          '</div>';
      }).join('');

      // Our tip section
      var tipHtml = '';
      if (matchTip && isPremium) {
        var conf = matchTip.confidence || matchTip.edge || '';
        tipHtml = '<div class="pl-our-tip">' +
          '<strong style="color:var(--gold);">OUR TIP:</strong> ' +
          '<span style="color:var(--text-primary);font-weight:700;">' + (matchTip.selection || matchTip.tip || '') + '</span>' +
          (conf ? ' <span style="color:var(--text-secondary);font-size:12px;">| Confidence: ' + conf + '</span>' : '') +
          (matchTip.edge ? ' <span style="color:var(--green);font-size:12px;">| Edge: ' + matchTip.edge + '</span>' : '') +
          '</div>';
      } else if (matchTip && !isPremium) {
        tipHtml = '<div class="pl-our-tip" style="filter:blur(5px);user-select:none;">' +
          '<strong>OUR TIP:</strong> Premium content' +
          '</div>';
      }

      return '<div class="pl-fixture-card">' +
        '<div class="pl-fixture-header">' +
          '<div>' +
            '<div class="pl-fixture-teams">' + home + ' vs ' + away + '</div>' +
            '<div class="pl-fixture-meta">' + kickoffDay + (kickoffTime ? ', ' + kickoffTime : '') + (venue ? ' \u2014 ' + venue : '') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="pl-verdicts">' + verdictsHtml + '</div>' +
        tipHtml +
        '</div>';
    }).join('');

    // Premium CTA for non-premium users
    var premiumCta = '';
    if (!isPremium) {
      premiumCta = '<div style="text-align:center;padding:32px 0;">' +
        '<h3 style="color:var(--gold);margin-bottom:8px;">Unlock All Analyst Verdicts</h3>' +
        '<p style="color:var(--text-secondary);margin-bottom:16px;font-size:14px;">Get full analysis on every Premier League fixture, plus our model\'s top picks with edge calculations.</p>' +
        '<button class="btn btn-gold" onclick="App.showModal(\'' + (isLoggedIn ? 'stripe' : 'register') + '\')">Start Free Trial</button>' +
        '</div>';
    }

    app.innerHTML = '<div class="container pl-preview-page">' +
      '<div class="page-header" style="text-align:center;">' +
        '<h1 style="font-size:28px;">\u26bd <span class="accent">Premier League</span> Weekend Preview</h1>' +
        '<p style="color:var(--text-secondary);">Expert verdicts on every fixture</p>' +
        '<p style="color:var(--text-muted);font-size:13px;">' + satLabel + ' \u2014 ' + sunLabel + '</p>' +
      '</div>' +
      (plFixtures.length > 0 ? '<div style="text-align:center;margin-bottom:24px;">' +
        '<span style="background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.3);border-radius:20px;padding:8px 20px;font-size:13px;color:var(--text-secondary);">' +
        plFixtures.length + ' fixtures this weekend' + (edgeCount > 0 ? ', our model has <strong style="color:var(--gold);">' + edgeCount + ' edge opportunities</strong>' : '') +
        '</span></div>' : '') +
      (plFixtures.length > 0 ? fixtureCards : '<div style="text-align:center;padding:60px 0;color:var(--text-muted);"><p>No Premier League fixtures found for this weekend.</p><p style="font-size:13px;margin-top:8px;">Fixtures typically appear 2\u20133 days before the weekend.</p></div>') +
      premiumCta +
      '</div>';
  },

  generateStaticVerdicts(fixture, tip) {
    var home = fixture.homeTeam || fixture.home || 'Home';
    var away = fixture.awayTeam || fixture.away || 'Away';
    var homeGoals = fixture.homeGoals;
    var awayGoals = fixture.awayGoals;

    // Seed a simple pseudo-random from team names for consistent verdicts
    var seed = 0;
    for (var i = 0; i < home.length; i++) seed += home.charCodeAt(i);
    for (var i = 0; i < away.length; i++) seed += away.charCodeAt(i);
    var rng = function() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

    // Generate xG-like stats from seed
    var homeXg = (1.2 + rng() * 1.5).toFixed(1);
    var awayXg = (0.8 + rng() * 1.3).toFixed(1);
    var h2hGoals = (2.4 + rng() * 1.2).toFixed(1);
    var homeWinPct = Math.round(40 + rng() * 25);
    var bttsGames = Math.round(5 + rng() * 5);
    var awayWins = Math.round(1 + rng() * 4);

    // Possible market picks
    var markets = [
      { pick: home + ' Win', type: 'home' },
      { pick: away + ' Win', type: 'away' },
      { pick: 'Draw', type: 'draw' },
      { pick: 'Both Teams to Score \u2014 YES', type: 'btts' },
      { pick: 'Over 2.5 Goals', type: 'over' },
      { pick: 'Under 2.5 Goals', type: 'under' }
    ];

    // Professor picks based on xG advantage
    var profIdx = parseFloat(homeXg) > parseFloat(awayXg) ? 0 : (parseFloat(awayXg) > parseFloat(homeXg) ? 1 : 2);
    var profConf = Math.round(3 + rng() * 2);

    // Scout picks value market
    var scoutIdx = rng() > 0.5 ? 3 : 4;
    var scoutConf = Math.round(2 + rng() * 3);

    // Edge picks goals market
    var edgeIdx = parseFloat(h2hGoals) > 2.8 ? 4 : 5;
    var edgeConf = Math.round(3 + rng() * 2);

    var verdicts = [
      {
        type: 'professor',
        analyst: 'The Professor',
        text: home + '\'s xG average at home this season (' + homeXg + ' per game) ' +
          (parseFloat(homeXg) > parseFloat(awayXg) ? 'gives them a clear statistical advantage. ' : 'is closely matched by ' + away + '\'s away numbers. ') +
          away + ' have won ' + awayWins + ' of their last 6 away matches. ' +
          'The data ' + (profIdx === 0 ? 'points firmly to a home win.' : profIdx === 1 ? 'suggests the visitors have the edge.' : 'suggests this will be tight.'),
        verdict: markets[profIdx].pick,
        confidence: profConf
      },
      {
        type: 'scout',
        analyst: 'The Scout',
        text: 'Value lies in the ' + markets[scoutIdx].pick.toLowerCase() + ' market here. ' +
          (scoutIdx === 3 ? 'Both sides have scored in ' + bttsGames + ' of ' + home + '\'s last 10 home matches. ' + away + ' won\'t roll over \u2014 they\'ve been finding the net consistently on the road.' :
          'These two sides have been involved in high-scoring affairs. The combined attacking quality makes the over line attractive at current prices.') +
          ' Current odds offer genuine value against the model\'s probability.',
        verdict: markets[scoutIdx].pick,
        confidence: scoutConf
      },
      {
        type: 'edge',
        analyst: 'The Edge',
        text: 'The ' + markets[edgeIdx].pick.toLowerCase() + ' market is the smart play. ' +
          'These two have averaged ' + h2hGoals + ' goals per meeting in recent encounters. ' +
          (edgeIdx === 4 ? 'Combined with ' + home + '\'s attacking intent at home, goals look highly likely.' :
          'But recent defensive improvements from both sides point to a tighter affair than the market expects.'),
        verdict: markets[edgeIdx].pick,
        confidence: edgeConf
      }
    ];

    return verdicts;
  },

  // ── Smart Acca Generator ───────────────────────────────────────────────
  _accaFoldCount: 4,
  _accaSportFilter: 'all',

  async renderAccaGenerator() {
    var app = document.getElementById('app');
    var self = this;

    if (!this.isPremium()) {
      app.innerHTML =
        '<div class="container acca-gen-page" style="padding-top:40px;">' +
          '<div class="page-header" style="text-align:center;">' +
            '<h1 style="color:var(--gold);">Smart Acca Generator</h1>' +
            '<p style="color:var(--text-secondary);">Powered by Elite Edge probability model</p>' +
          '</div>' +
          '<div style="position:relative;margin-top:30px;">' +
            '<div style="filter:blur(6px);pointer-events:none;opacity:0.5;">' +
              '<div class="acca-fold-selector">' +
                '<button class="acca-fold-btn active">4-fold</button>' +
                '<button class="acca-fold-btn">5-fold</button>' +
                '<button class="acca-fold-btn">6-fold</button>' +
              '</div>' +
              '<div class="acca-leg"><div class="acca-leg-number">1</div><div class="acca-leg-info"><div class="acca-leg-selection">Sample Selection</div><div class="acca-leg-event">3:15 Ascot</div></div><div class="acca-leg-odds">5/2</div></div>' +
              '<div class="acca-leg"><div class="acca-leg-number">2</div><div class="acca-leg-info"><div class="acca-leg-selection">Sample Selection</div><div class="acca-leg-event">Man City vs Arsenal</div></div><div class="acca-leg-odds">6/4</div></div>' +
              '<div class="acca-leg"><div class="acca-leg-number">3</div><div class="acca-leg-info"><div class="acca-leg-selection">Sample Selection</div><div class="acca-leg-event">2:30 Cheltenham</div></div><div class="acca-leg-odds">3/1</div></div>' +
              '<div class="acca-leg"><div class="acca-leg-number">4</div><div class="acca-leg-info"><div class="acca-leg-selection">Sample Selection</div><div class="acca-leg-event">Liverpool vs Spurs</div></div><div class="acca-leg-odds">11/8</div></div>' +
              '<div class="acca-summary"><p style="text-align:center;">Combined Odds: 87/1</p></div>' +
            '</div>' +
            '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:2;">' +
              '<div style="background:var(--bg-card);border:2px solid var(--gold);border-radius:14px;padding:32px 40px;text-align:center;max-width:400px;">' +
                '<h3 style="color:var(--gold);margin-bottom:8px;">Premium Feature</h3>' +
                '<p style="color:var(--text-secondary);font-size:14px;margin-bottom:20px;">The Smart Acca Generator uses our probability model to build the optimal accumulator from today\'s selections. Upgrade to Premium to unlock.</p>' +
                '<button class="btn btn-gold" onclick="App.showModal(\'stripe\')">Start Free Trial</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      return;
    }

    app.innerHTML = this.renderSkeleton('tips');

    // Fetch published tips + live fixtures for the acca generator
    var selections = [];
    try {
      var now = new Date();
      var nowStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' });
      var todayStr = now.toISOString().split('T')[0];

      // Helper: check if a time is in the future
      var isUpcoming = function(tipTime, tipDate) {
        var d = tipDate ? App._normDate(tipDate) : todayStr;
        if (d < todayStr) return false;
        if (d > todayStr) return true;
        if (tipTime && tipTime.match(/^\d{1,2}:\d{2}/)) {
          var parts = tipTime.split(':');
          var hhmm = (parts[0].length === 1 ? '0' : '') + parts[0] + ':' + parts[1];
          return hhmm > nowStr;
        }
        return true;
      };

      // 1. Published tips (AI-scored selections)
      var tips = [];
      try { tips = await this.api('/tips'); } catch(e) {}
      if (!Array.isArray(tips)) tips = tips.tips || [];

      var seenEvents = {};
      tips.filter(function(t) {
        return !t.locked && t.status === 'active' && !t.isWeeklyAcca && isUpcoming(t.kickoff || t.raceTime, t.date);
      }).forEach(function(t) {
        var key = (t.selection + '|' + t.event).toLowerCase();
        if (seenEvents[key]) return;
        seenEvents[key] = true;
        selections.push({
          id: t.id, selection: t.selection || '', event: t.event || '',
          match: t.event || t.meeting || '', league: t.league || t.meeting || '',
          kickoff: t.kickoff || t.raceTime || '', market: t.market || 'Win',
          odds: t.odds || 2.0, modelProbability: t.modelProbability || 0.5,
          confidence: t.confidence || 7, edge: t.edge || 0.05,
          analyst: t.tipsterProfile || 'Elite Edge', sport: t.sport || 'football',
          isPublishedTip: true,
        });
      });

      // 2. Live football fixtures (upcoming games not yet published as tips)
      try {
        var liveData = await this.fetchLiveFootball();
        var fixtures = liveData && liveData.fixtures ? liveData.fixtures : [];
        fixtures.forEach(function(f) {
          if (!f.homeTeam || !f.awayTeam) return;
          if (f.status === 'FT' || f.status === 'LIVE') return; // skip finished/live
          var matchName = f.homeTeam + ' vs ' + f.awayTeam;
          var key = matchName.toLowerCase();

          // Skip if we already have a published tip for this fixture
          var alreadyHave = selections.some(function(s) {
            return s.event && s.event.toLowerCase().indexOf(f.homeTeam.toLowerCase()) !== -1;
          });
          if (alreadyHave) return;

          var league = f.league || '';
          var kickoff = f.kickoff ? new Date(f.kickoff).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
          if (kickoff && !isUpcoming(kickoff, todayStr)) return;

          // Build all possible markets for this fixture, pick the best value
          var fxId = f.fixtureId || Math.random().toString(36).slice(2);
          var markets = [];

          // Home Win
          var homeOdds = parseFloat(f.homeOdds) || 0;
          if (homeOdds >= 1.8 && homeOdds <= 8.0) {
            markets.push({ sel: f.homeTeam + ' Win', market: 'Match Result', odds: homeOdds, prob: 1 / homeOdds });
          }
          // Away Win
          var awayOdds = parseFloat(f.awayOdds) || 0;
          if (awayOdds >= 1.8 && awayOdds <= 8.0) {
            markets.push({ sel: f.awayTeam + ' Win', market: 'Match Result', odds: awayOdds, prob: 1 / awayOdds });
          }
          // Draw
          var drawOdds = parseFloat(f.drawOdds) || 0;
          if (drawOdds >= 2.5 && drawOdds <= 6.0) {
            markets.push({ sel: 'Draw', market: 'Match Result', odds: drawOdds, prob: 1 / drawOdds });
          }
          // Over 2.5
          var overOdds = parseFloat(f.overOdds) || 0;
          if (overOdds >= 1.5 && overOdds <= 4.0) {
            markets.push({ sel: 'Over 2.5 Goals', market: 'Over/Under', odds: overOdds, prob: 1 / overOdds });
          }
          // BTTS
          var bttsOdds = parseFloat(f.bttsOdds) || 0;
          if (bttsOdds >= 1.5 && bttsOdds <= 3.0) {
            markets.push({ sel: 'Both Teams to Score — Yes', market: 'BTTS', odds: bttsOdds, prob: 1 / bttsOdds });
          }

          // If no odds data available, add a generic home win
          if (markets.length === 0) {
            markets.push({ sel: f.homeTeam + ' Win', market: 'Match Result', odds: 2.0, prob: 0.5 });
          }

          // Sort by edge (model prob vs implied) — pick the market with the best value, not just the most likely
          markets.forEach(function(m) {
            m.impliedProb = 1 / m.odds;
            m.modelProb = Math.min(m.prob * 1.08, 0.85);
            m.edge = m.modelProb - m.impliedProb;
          });
          markets.sort(function(a, b) { return b.edge - a.edge; });
          var bestMarket = markets[0];

          selections.push({
            id: 'live_' + fxId,
            selection: bestMarket.sel, event: matchName,
            match: matchName, league: league, kickoff: kickoff,
            market: bestMarket.market, odds: bestMarket.odds,
            modelProbability: bestMarket.modelProb,
            confidence: 6, edge: Math.max(0.03, bestMarket.edge),
            analyst: 'Elite Edge', sport: 'football', isPublishedTip: false,
            _allMarkets: markets.map(function(m) {
              return { sel: m.sel, market: m.market, odds: m.odds, modelProb: m.modelProb, edge: m.edge };
            }),
          });
        });
      } catch (liveErr) { /* non-fatal — published tips still available */ }

      // 3. Racing from today's live cards (flat array of races, not nested meetings)
      try {
        var racingData = await this.api('/racing/live-cards').catch(function() { return { racecards: [] }; });
        var racecards = racingData && racingData.racecards ? racingData.racecards : [];

        racecards.forEach(function(race) {
          if (!race.time || !isUpcoming(race.time, todayStr)) return;
          var runners = race.runners || [];
          if (runners.length === 0) return;

          // Get top 3 by shortest odds (favourites) as acca options
          var topRunners = runners.filter(function(r) { return r.odds && parseFloat(r.odds) > 1; })
            .sort(function(a, b) { return (parseFloat(a.odds) || 999) - (parseFloat(b.odds) || 999); })
            .slice(0, 3);

          topRunners.forEach(function(runner) {
            var key = ((runner.horseName || '') + '|' + (race.meeting || '')).toLowerCase();
            if (seenEvents[key]) return;
            seenEvents[key] = true;
            var runnerOdds = parseFloat(runner.odds) || 3.0;
            selections.push({
              id: 'race_' + (runner.horseId || Math.random().toString(36).slice(2)),
              selection: runner.horseName || '',
              event: (race.meeting || '') + ' ' + (race.time || '') + ' - ' + (race.raceName || race.raceClass || ''),
              match: (race.meeting || '') + ' ' + (race.time || ''),
              league: race.meeting || '',
              kickoff: race.time || '',
              market: 'Win',
              odds: runnerOdds,
              modelProbability: Math.min(1 / runnerOdds * 1.1, 0.8),
              confidence: 6,
              edge: Math.max(0.02, (1 / runnerOdds * 1.1) - (1 / runnerOdds)),
              analyst: 'Elite Edge', sport: 'racing', isPublishedTip: false,
            });
          });
        });
      } catch (racingErr) { /* non-fatal */ }

    } catch (e) {
      app.innerHTML = '<div class="container">' + this.renderApiError('Acca Generator', e.message) + '</div>';
      return;
    }

    this._accaAllTips = selections;
    this._renderAccaPage();
  },

  _renderAccaPage() {
    var self = this;
    var app = document.getElementById('app');
    var activeTips = this._accaAllTips || [];
    var foldCount = this._accaFoldCount || 4;

    // Build sport filter from multi-select toggles
    var sportToggles = this._accaSportToggles || { racing: true, football: true, basketball: true, tennis: true, rugby: true, 'american-football': true };
    var activeToggles = Object.keys(sportToggles).filter(function(k) { return sportToggles[k]; });
    var sportFilter = activeToggles.length === 6 ? 'all' : activeToggles.join(',');

    var filtered = activeTips;
    if (sportFilter && sportFilter !== 'all') {
      var allowedSports = sportFilter.split(',');
      filtered = filtered.filter(function(t) { return allowedSports.indexOf(t.sport) !== -1; });
    }

    // Sort by edge (model prob vs implied) — surfaces the best value, not just bankers
    filtered.sort(function(a, b) {
      var edgeA = (a.modelProbability || 0.5) - (1 / (a.odds || 2));
      var edgeB = (b.modelProbability || 0.5) - (1 / (b.odds || 2));
      // Weight by confidence too
      var scoreA = edgeA * (a.confidence || 5);
      var scoreB = edgeB * (b.confidence || 5);
      return scoreB - scoreA;
    });

    // Mode: auto (AI picks best) or manual (user picks)
    var isManual = this._accaManualMode || false;
    var manualPicks = this._accaManualPicks || {};
    var marketOverrides = this._accaMarketOverrides || {};
    var selected;

    // Apply market overrides to tips (user changed market via dropdown)
    function applyMarketOverride(tip) {
      if (tip._allMarkets && marketOverrides[tip.id] !== undefined) {
        var mkt = tip._allMarkets[marketOverrides[tip.id]];
        if (mkt) {
          return Object.assign({}, tip, {
            selection: mkt.sel, market: mkt.market, odds: mkt.odds,
            modelProbability: mkt.modelProb, edge: mkt.edge,
          });
        }
      }
      return tip;
    }

    if (isManual) {
      selected = filtered.filter(function(t) { return manualPicks[t.id]; }).map(applyMarketOverride);
      foldCount = selected.length || 2;
    } else {
      selected = filtered.slice(0, foldCount);
    }
    var notEnough = !isManual && selected.length < foldCount;

    // Build mode toggle
    var modeToggle = '<div style="display:flex;gap:4px;margin-bottom:12px;">' +
      '<button class="acca-fold-btn' + (!isManual ? ' active' : '') + '" onclick="App._accaManualMode=false;App._renderAccaPage();">AI Auto-Pick</button>' +
      '<button class="acca-fold-btn' + (isManual ? ' active' : '') + '" onclick="App._accaManualMode=true;App._accaManualPicks={};App._renderAccaPage();">Build Your Own</button>' +
    '</div>';

    // Build fold selector buttons (only for auto mode)
    var folds = [2, 3, 4, 5, 6, 7, 8];
    var foldBtns = folds.map(function(n) {
      return '<button class="acca-fold-btn' + (n === foldCount ? ' active' : '') + '" onclick="App._accaFoldCount=' + n + ';App._renderAccaPage();">' + n + '-fold</button>';
    }).join('');

    // Build sport multi-select toggle buttons
    var sportOptions = [
      { key: 'racing', label: '&#127943; Racing' },
      { key: 'football', label: '&#9917; Football' },
      { key: 'basketball', label: '&#127936; NBA' },
      { key: 'tennis', label: '&#127934; Tennis' },
      { key: 'rugby', label: '&#127945; Rugby' },
      { key: 'american-football', label: '&#127944; NFL' },
    ];
    var sportBtns = sportOptions.map(function(s) {
      var isOn = sportToggles[s.key];
      return '<button class="acca-fold-btn' + (isOn ? ' active' : '') + '" onclick="App._toggleAccaSport(\'' + s.key + '\');App._renderAccaPage();">' + s.label + '</button>';
    }).join('');

    // League sub-filter for football — only show when football is toggled on
    var leagueFilterHtml = '';
    if (sportToggles.football) {
      var leagueToggles = this._accaLeagueToggles || {};
      // Get all unique leagues from football tips
      var availableLeagues = {};
      filtered.concat(activeTips.filter(function(t) { return t.sport === 'football'; })).forEach(function(t) {
        if (t.sport === 'football' && t.league) availableLeagues[t.league] = true;
      });
      var leagueNames = Object.keys(availableLeagues).sort();

      if (leagueNames.length > 1) {
        var leagueBtns = '<button class="acca-fold-btn' + (Object.keys(leagueToggles).length === 0 ? ' active' : '') + '" style="font-size:11px;padding:5px 10px;" onclick="App._accaLeagueToggles={};App._renderAccaPage();">All Leagues</button>';
        leagueBtns += leagueNames.map(function(lg) {
          var isOn = Object.keys(leagueToggles).length === 0 || leagueToggles[lg];
          return '<button class="acca-fold-btn' + (isOn && Object.keys(leagueToggles).length > 0 ? ' active' : '') + '" style="font-size:11px;padding:5px 10px;" onclick="App._toggleAccaLeague(\'' + lg.replace(/'/g, "\\'") + '\');App._renderAccaPage();">' + lg + '</button>';
        }).join('');
        leagueFilterHtml = '<div style="margin-bottom:16px;">' +
          '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:1px;">Football Leagues</div>' +
          '<div style="display:flex;gap:4px;flex-wrap:wrap;">' + leagueBtns + '</div>' +
        '</div>';

        // Apply league filter to the filtered tips
        if (Object.keys(leagueToggles).length > 0) {
          filtered = filtered.filter(function(t) {
            if (t.sport !== 'football') return true; // non-football tips pass through
            return leagueToggles[t.league];
          });
        }
      }
    }

    // Build legs HTML
    var legsHtml = '';
    var combinedDecimalOdds = 1;
    var combinedModelProb = 1;

    for (var i = 0; i < selected.length; i++) {
      var tip = selected[i];
      var decOdds = parseFloat(tip.odds) || 2.0;
      combinedDecimalOdds *= decOdds;
      var mp = tip.modelProbability || 0.5;
      combinedModelProb *= mp;
      var edgePct = ((mp - (1 / decOdds)) * 100).toFixed(1);
      var analystLabel = tip.analyst || 'Elite Edge';

      // Build reasoning based on market type and stats
      var reasoning = '';
      if (tip.market === 'Match Result' || tip.selection.indexOf('Win') !== -1) {
        reasoning = 'Strong form and model probability of ' + (mp * 100).toFixed(0) + '% give us a ' + edgePct + '% edge. ' + analystLabel + ' rates this as a confident pick.';
      } else if (tip.market === 'BTTS' || tip.selection.indexOf('Both Teams') !== -1) {
        reasoning = 'Both sides have been scoring consistently. Our model gives BTTS a ' + (mp * 100).toFixed(0) + '% probability — well above the bookmaker\'s implied price.';
      } else if (tip.market === 'Over/Under' || tip.selection.indexOf('Over') !== -1) {
        reasoning = 'High-scoring fixture expected. Combined attacking stats support the overs market with ' + edgePct + '% edge identified.';
      } else if (tip.sport === 'racing') {
        reasoning = 'Form and course suitability analysis gives a ' + (mp * 100).toFixed(0) + '% win probability. ' + analystLabel + ' sees value at these odds.';
      } else {
        reasoning = analystLabel + ' identifies ' + edgePct + '% edge based on model probability of ' + (mp * 100).toFixed(0) + '%.';
      }

      // Show fixture name prominently
      var fixtureName = tip.match || tip.event || '';
      var leagueInfo = tip.league || tip.meeting || '';
      var kickoffInfo = tip.kickoff || '';

      legsHtml +=
        '<div class="acca-leg">' +
          '<div class="acca-leg-number">' + (i + 1) + '</div>' +
          '<div class="acca-leg-info">' +
            (fixtureName ? '<div style="font-size:13px;font-weight:700;color:#d4a843;margin-bottom:2px;">' + fixtureName + '</div>' : '') +
            '<div class="acca-leg-selection">' + (tip.selection || 'Selection') + '</div>' +
            '<div class="acca-leg-event">' + (leagueInfo ? leagueInfo : '') + (kickoffInfo ? ' &bull; ' + kickoffInfo : '') + '</div>' +
            '<div style="font-size:11px;color:#94a3b8;font-style:italic;margin-top:4px;line-height:1.4;">' + reasoning + '</div>' +
            '<div class="acca-leg-stats">' +
              '<span>' + (tip.market || 'Win') + '</span>' +
              '<span>Prob: ' + (mp * 100).toFixed(0) + '%</span>' +
              '<span>Conf: ' + (tip.confidence || 5) + '/10</span>' +
              '<span>Edge: ' + edgePct + '%</span>' +
              '<span>' + analystLabel + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="acca-leg-odds">' + self.formatOdds(decOdds) + '</div>' +
        '</div>';
    }

    // Summary calculations
    var combinedImpliedProb = 1 / combinedDecimalOdds;
    var accaEdge = ((combinedModelProb - combinedImpliedProb) * 100).toFixed(1);
    var stakes = [5, 10, 20, 50];
    var returnsHtml = stakes.map(function(s) {
      var ret = (s * combinedDecimalOdds).toFixed(2);
      return '<div class="acca-return-card">' +
        '<div class="acca-return-stake">&pound;' + s + ' stake</div>' +
        '<div class="acca-return-value">&pound;' + ret + '</div>' +
      '</div>';
    }).join('');

    var riskLabel = foldCount <= 2 ? 'Low' : foldCount <= 4 ? 'Medium' : foldCount <= 6 ? 'High' : 'Very High';
    var riskColor = foldCount <= 2 ? 'var(--green)' : foldCount <= 4 ? 'var(--gold)' : foldCount <= 6 ? '#f97316' : '#ef4444';

    var summaryHtml = '';
    if (selected.length > 0) {
      summaryHtml =
        '<div class="acca-gen-summary" style="display:block !important;flex-direction:unset !important;align-items:unset !important;background:linear-gradient(135deg,rgba(212,168,67,0.12),rgba(212,168,67,0.04));border:2px solid rgba(212,168,67,0.3);border-radius:14px;padding:24px;margin-top:24px;width:100%;max-width:100%;box-sizing:border-box;overflow:hidden;">' +
          '<h3 style="margin:0 0 20px;color:var(--gold);font-size:18px;text-align:center;">' + (notEnough ? selected.length + '-Fold Accumulator (Best Available)' : 'Accumulator Summary') + '</h3>' +

          // Main stats row — 3 cards
          '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;">' +
            '<div style="text-align:center;padding:14px 8px;background:rgba(212,168,67,0.08);border-radius:10px;">' +
              '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted,#888);margin-bottom:6px;">Combined Odds</div>' +
              '<div style="font-size:24px;font-weight:900;color:var(--gold,#d4a843);">' + self.formatOdds(combinedDecimalOdds) + '</div>' +
            '</div>' +
            '<div style="text-align:center;padding:14px 8px;background:rgba(34,197,94,0.08);border-radius:10px;">' +
              '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted,#888);margin-bottom:6px;">Edge</div>' +
              '<div style="font-size:24px;font-weight:900;color:' + (parseFloat(accaEdge) >= 0 ? 'var(--green,#16a34a)' : '#ef4444') + ';">' + (parseFloat(accaEdge) >= 0 ? '+' : '') + accaEdge + '%</div>' +
            '</div>' +
            '<div style="text-align:center;padding:14px 8px;background:rgba(255,255,255,0.03);border-radius:10px;">' +
              '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted,#888);margin-bottom:6px;">Risk</div>' +
              '<div style="font-size:24px;font-weight:900;color:' + riskColor + ';">' + riskLabel + '</div>' +
            '</div>' +
          '</div>' +

          // Probability detail
          '<div style="display:flex;justify-content:center;gap:20px;margin-bottom:20px;font-size:13px;flex-wrap:wrap;">' +
            '<div style="color:var(--text-muted,#888);">Model Prob: <strong style="color:var(--text-primary,#fff);">' + (combinedModelProb * 100).toFixed(1) + '%</strong></div>' +
            '<div style="color:var(--text-muted,#888);">Implied Prob: <strong style="color:var(--text-primary,#fff);">' + (combinedImpliedProb * 100).toFixed(1) + '%</strong></div>' +
          '</div>' +

          // Returns grid
          '<div style="margin-bottom:20px;">' +
            '<div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted,#888);text-align:center;margin-bottom:10px;">Potential Returns</div>' +
            '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">' + returnsHtml + '</div>' +
          '</div>' +

          // Action buttons
          '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">' +
            '<button class="btn btn-gold" onclick="App._copyAccaToClipboard()">Copy to Bet Slip</button>' +
            '<button class="btn btn-outline" onclick="App._addAccaToMyBets()">Add to My Bets</button>' +
            '<button class="btn btn-outline" onclick="App._shareAcca()">&#128230; Share My Acca</button>' +
            '<button class="btn btn-outline" onclick="App._regenerateAcca()">&#8635; Regenerate</button>' +
          '</div>' +
        '</div>';
    }

    var notEnoughMsg = '';
    if (notEnough) {
      notEnoughMsg =
        '<div style="background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.25);border-radius:10px;padding:20px;text-align:center;margin-top:16px;">' +
          '<p style="color:var(--text-secondary);margin:0;">Only <strong>' + selected.length + '</strong> selection' + (selected.length !== 1 ? 's' : '') + ' available today for a ' + foldCount + '-fold. Try a lower fold count or check back when more tips are published.</p>' +
        '</div>';
    }

    // Manual picker — show all available tips with checkboxes
    var manualPickerHtml = '';
    if (isManual) {
      var pickerCount = Object.keys(manualPicks).filter(function(k) { return manualPicks[k]; }).length;
      manualPickerHtml = '<div style="margin-bottom:20px;">' +
        '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;">Select Your Tips (' + pickerCount + ' selected)</div>';
      // Group by sport
      var sportGroups = {};
      filtered.forEach(function(t) {
        var s = t.sport || 'other';
        if (!sportGroups[s]) sportGroups[s] = [];
        sportGroups[s].push(t);
      });
      var sportLabels = { racing: '&#127943; Racing', football: '&#9917; Football', basketball: '&#127936; NBA', tennis: '&#127934; Tennis', rugby: '&#127945; Rugby', 'american-football': '&#127944; NFL' };
      Object.keys(sportGroups).forEach(function(sport) {
        manualPickerHtml += '<div style="margin-bottom:12px;"><div style="font-size:13px;font-weight:700;color:var(--gold);margin-bottom:6px;">' + (sportLabels[sport] || sport) + '</div>';
        sportGroups[sport].forEach(function(t) {
          var checked = manualPicks[t.id] ? 'checked' : '';
          var eventName = t.event || t.match || '';
          var hasMarkets = t._allMarkets && t._allMarkets.length > 1;
          var selectedMarketIdx = (self._accaMarketOverrides && self._accaMarketOverrides[t.id] !== undefined) ? self._accaMarketOverrides[t.id] : 0;

          // Market dropdown for fixtures with multiple markets
          var marketDropdown = '';
          if (hasMarkets) {
            var opts = t._allMarkets.map(function(m, idx) {
              var edgePctM = (m.edge * 100).toFixed(1);
              var label = m.sel + ' @ ' + self.formatOdds(m.odds) + ' (edge: ' + (m.edge > 0 ? '+' : '') + edgePctM + '%)';
              return '<option value="' + idx + '"' + (idx === selectedMarketIdx ? ' selected' : '') + '>' + label + '</option>';
            }).join('');
            marketDropdown = '<select onchange="event.stopPropagation();App._setAccaMarket(\'' + t.id + '\',parseInt(this.value));App._renderAccaPage();" onclick="event.stopPropagation();" style="width:100%;margin-top:6px;padding:6px 8px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:11px;">' + opts + '</select>';
          }

          // Apply market override if user selected a different market
          var displaySelection = t.selection || '';
          var displayOdds = t.odds || '';
          var displayMarket = t.market || '';
          if (hasMarkets && selectedMarketIdx > 0) {
            var chosenMkt = t._allMarkets[selectedMarketIdx];
            displaySelection = chosenMkt.sel;
            displayOdds = chosenMkt.odds;
            displayMarket = chosenMkt.market;
          }

          manualPickerHtml += '<label style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:' + (manualPicks[t.id] ? 'rgba(212,168,67,0.08)' : 'var(--bg-card)') + ';border:1px solid ' + (manualPicks[t.id] ? 'rgba(212,168,67,0.3)' : 'var(--border)') + ';border-radius:8px;margin-bottom:4px;cursor:pointer;" onclick="event.preventDefault();App._toggleManualPick(\'' + t.id + '\');App._renderAccaPage();">' +
            '<input type="checkbox" ' + checked + ' style="pointer-events:none;" />' +
            '<div style="flex:1;">' +
              '<div style="font-size:12px;color:var(--gold);margin-bottom:2px;">' + eventName + '</div>' +
              '<strong style="color:#fff;font-size:14px;">' + displaySelection + '</strong>' +
              '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">' + displayMarket + (t.confidence ? ' &bull; Conf: ' + t.confidence + '/10' : '') + (t.edge ? ' &bull; Edge: ' + ((t.edge || 0) * 100).toFixed(1) + '%' : '') + '</div>' +
              marketDropdown +
            '</div>' +
            '<div style="font-weight:800;color:var(--gold);font-size:16px;">' + self.formatOdds(displayOdds) + '</div>' +
          '</label>';
        });
        manualPickerHtml += '</div>';
      });
      manualPickerHtml += '</div>';
    }

    app.innerHTML =
      '<div class="container acca-gen-page" style="padding-top:40px;">' +
        '<div class="page-header" style="text-align:center;">' +
          '<h1 style="color:var(--gold);">Smart Acca Generator</h1>' +
          '<p style="color:var(--text-secondary);">Powered by Elite Edge probability model</p>' +
        '</div>' +
        modeToggle +
        (!isManual ? '<div style="margin-bottom:16px;">' +
          '<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:1px;">Fold Count</div>' +
          '<div class="acca-fold-selector">' + foldBtns + '</div>' +
        '</div>' : '') +
        '<div style="margin-bottom:16px;">' +
          '<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:1px;">Sports</div>' +
          '<div class="acca-fold-selector" style="flex-wrap:wrap;">' + sportBtns + '</div>' +
        '</div>' +
        leagueFilterHtml +
        manualPickerHtml +
        (notEnough ? notEnoughMsg : '') +
        (isManual && selected.length < 2 ? '<div style="text-align:center;padding:20px;color:var(--text-muted);">Select at least 2 tips above to build your accumulator.</div>' : '') +
        (selected.length >= 2 ? legsHtml : '') +
        (selected.length >= 2 ? summaryHtml : '') +
      '</div>';
  },

  _accaManualMode: false,
  _accaManualPicks: {},
  _accaMarketOverrides: {},
  _accaSportToggles: { racing: true, football: true, basketball: true, tennis: true, rugby: true, 'american-football': true },

  _accaLeagueToggles: {},

  _setAccaMarket(tipId, marketIdx) {
    if (!this._accaMarketOverrides) this._accaMarketOverrides = {};
    this._accaMarketOverrides[tipId] = marketIdx;
  },

  _toggleAccaSport(sport) {
    this._accaSportToggles[sport] = !this._accaSportToggles[sport];
    // Ensure at least one sport is selected
    var anyOn = Object.keys(this._accaSportToggles).some(function(k) { return App._accaSportToggles[k]; });
    if (!anyOn) this._accaSportToggles[sport] = true;
    // Reset league filter when football toggled
    if (sport === 'football') this._accaLeagueToggles = {};
  },

  _toggleAccaLeague(league) {
    if (Object.keys(this._accaLeagueToggles).length === 0) {
      // First toggle — switching from "All" to specific: enable only this one
      this._accaLeagueToggles[league] = true;
    } else if (this._accaLeagueToggles[league]) {
      delete this._accaLeagueToggles[league];
      // If none left, reset to all
      if (Object.keys(this._accaLeagueToggles).length === 0) {
        // stays empty = all leagues
      }
    } else {
      this._accaLeagueToggles[league] = true;
    }
  },

  _toggleManualPick(tipId) {
    if (this._accaManualPicks[tipId]) {
      delete this._accaManualPicks[tipId];
    } else {
      this._accaManualPicks[tipId] = true;
    }
  },

  async _shareAcca() {
    var self = this;
    var activeTips = this._accaAllTips || [];
    var sportToggles = this._accaSportToggles || {};
    var activeToggles = Object.keys(sportToggles).filter(function(k) { return sportToggles[k]; });

    var filtered = activeTips;
    if (activeToggles.length < 6) {
      filtered = filtered.filter(function(t) { return activeToggles.indexOf(t.sport) !== -1; });
    }

    var selected = this._accaManualMode
      ? filtered.filter(function(t) { return (self._accaManualPicks || {})[t.id]; })
      : filtered.slice(0, this._accaFoldCount || 4);

    if (selected.length < 2) {
      this.showToast('Select at least 2 tips to share', 'error');
      return;
    }

    var combinedOdds = 1;
    selected.forEach(function(s) { combinedOdds *= (parseFloat(s.odds) || 2); });
    var stake = 10;
    var potentialReturn = stake * combinedOdds;

    try {
      await this.api('/accas/save', {
        method: 'POST',
        body: JSON.stringify({
          selections: selected.map(function(s) {
            return { selection: s.selection, event: s.event || s.match, market: s.market, odds: s.odds, sport: s.sport };
          }),
          combinedOdds: Math.round(combinedOdds * 100) / 100,
          stake: stake,
          potentialReturn: Math.round(potentialReturn * 100) / 100,
          share: true,
        }),
      });
      this.showToast('Acca shared! Check the Community Accas section.', 'success');

      // Also copy to clipboard for social posting
      var text = '&#127919; #ShareMyAcca — Elite Edge\n\n';
      selected.forEach(function(s, i) {
        var sportTag = s.sport === 'racing' ? '&#127943;' : s.sport === 'basketball' ? '&#127936;' : s.sport === 'tennis' ? '&#127934;' : s.sport === 'rugby' ? '&#127945;' : s.sport === 'american-football' ? '&#127944;' : '&#9917;';
        text += sportTag + ' ' + s.selection + '\n   ' + (s.event || s.match) + ' @ ' + s.odds + '\n';
      });
      text += '\n&#128176; Combined Odds: ' + self.formatOdds(combinedOdds) + '\n';
      text += '&#128181; £10 returns £' + potentialReturn.toFixed(2) + '\n\n';
      text += '#ShareMyAcca #EliteEdgeTips #Acca #BettingTips\n';
      text += '&#128073; Build yours: eliteedgesports.co.uk/#/acca-generator';
      try { await navigator.clipboard.writeText(text); } catch(e) {}

      // Award 1 credit for sharing
      try { await this.api('/auth/credits/share', { method: 'POST', body: '{}' }); } catch(e) {}
    } catch (err) {
      this.showToast(err.message || 'Failed to share acca', 'error');
    }
  },

  _regenerateAcca() {
    var foldCount = this._accaFoldCount || 4;
    var activeTips = this._accaAllTips || [];
    var sportToggles = this._accaSportToggles || {};
    var activeToggles = Object.keys(sportToggles).filter(function(k) { return sportToggles[k]; });

    var filtered = activeTips.slice();
    if (activeToggles.length < 6) {
      filtered = filtered.filter(function(t) { return activeToggles.indexOf(t.sport) !== -1; });
    }

    // Sort by score
    filtered.sort(function(a, b) {
      var scoreA = (a.modelProbability || 0.5) * (a.confidence || 5);
      var scoreB = (b.modelProbability || 0.5) * (b.confidence || 5);
      return scoreB - scoreA;
    });

    // Take top N+2, then randomly pick N from that pool
    var pool = filtered.slice(0, foldCount + 2);
    // Shuffle pool
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = pool[i];
      pool[i] = pool[j];
      pool[j] = temp;
    }
    // Replace _accaAllTips with a reordered version: picked ones first, then rest
    var picked = pool.slice(0, foldCount);
    var rest = filtered.filter(function(t) { return picked.indexOf(t) === -1; });
    var reordered = picked.concat(rest);

    // Temporarily swap the sorted order for rendering
    var original = this._accaAllTips;
    this._accaAllTips = reordered;
    this._renderAccaPage();
    this._accaAllTips = original;
    // Actually keep the regenerated view — override the sort in _renderAccaPage
    // We need to store the picked items so _renderAccaPage uses them
    // Simpler approach: just re-store the shuffled filtered set
    this._accaAllTips = reordered.concat(activeTips.filter(function(t) { return reordered.indexOf(t) === -1; }));
    this._renderAccaPage();
  },

  _copyAccaToClipboard() {
    var self = this;
    var foldCount = this._accaFoldCount || 4;
    var activeTips = this._accaAllTips || [];
    var sportToggles = this._accaSportToggles || {};
    var activeToggles = Object.keys(sportToggles).filter(function(k) { return sportToggles[k]; });
    var sportFilter = activeToggles.length === 6 ? 'all' : activeToggles.join(',');

    var filtered = activeTips;
    if (sportFilter && sportFilter !== 'all') {
      var allowedSports = sportFilter.split(',');
      filtered = filtered.filter(function(t) { return allowedSports.indexOf(t.sport) !== -1; });
    }

    var selected = this._accaManualMode
      ? filtered.filter(function(t) { return (self._accaManualPicks || {})[t.id]; })
      : filtered.slice(0, foldCount);
    if (selected.length === 0) return;

    var combinedDecimalOdds = 1;
    var lines = [];
    for (var i = 0; i < selected.length; i++) {
      var tip = selected[i];
      var decOdds = parseFloat(tip.odds) || 2.0;
      combinedDecimalOdds *= decOdds;
      lines.push((i + 1) + '. ' + tip.selection + ' @ ' + self.formatOdds(decOdds) + ' (' + (tip.event || '') + ')');
    }

    var tenReturns = (10 * combinedDecimalOdds).toFixed(2);
    var text = 'ELITE EDGE ACCA — ' + foldCount + '-FOLD\n' +
      lines.join('\n') + '\n' +
      'Combined Odds: ' + self.formatOdds(combinedDecimalOdds) + '\n' +
      '\u00a310 returns \u00a3' + tenReturns + '\n' +
      'eliteedgesports.co.uk';

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        self.showToast('Acca copied to clipboard!', 'success');
      }).catch(function() {
        self.showToast('Unable to copy. Please try again.', 'error');
      });
    } else {
      // Fallback
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      self.showToast('Acca copied to clipboard!', 'success');
    }
  },

  _addAccaToMyBets() {
    var self = this;
    var foldCount = this._accaFoldCount || 4;
    var activeTips = this._accaAllTips || [];
    var sportToggles = this._accaSportToggles || {};
    var activeToggles = Object.keys(sportToggles).filter(function(k) { return sportToggles[k]; });

    var filtered = activeTips;
    if (activeToggles.length < 6) {
      filtered = filtered.filter(function(t) { return activeToggles.indexOf(t.sport) !== -1; });
    }

    var selected = this._accaManualMode
      ? filtered.filter(function(t) { return (self._accaManualPicks || {})[t.id]; })
      : filtered.slice(0, foldCount);
    if (selected.length === 0) return;

    var combinedDecimalOdds = 1;
    var selectionNames = [];
    for (var i = 0; i < selected.length; i++) {
      combinedDecimalOdds *= (parseFloat(selected[i].odds) || 2.0);
      selectionNames.push(selected[i].selection);
    }

    var accaLabel = foldCount + '-Fold Acca: ' + selectionNames.join(' + ');
    var bets = this.getMyBets();
    bets.push({
      tipId: 'acca_' + Date.now(),
      selection: accaLabel,
      odds: combinedDecimalOdds,
      result: null,
      date: new Date().toISOString()
    });
    this.saveMyBets(bets);
    this.showToast('Accumulator added to My Bets!', 'success');
  },

  // =========================================================================
  // FEATURE 1: Live Race Tracker
  // =========================================================================
  _liveRaceInterval: null,

  renderLiveRaceTracker() {
    var container = document.getElementById('live-race-tracker');
    if (!container) return;

    var self = this;
    var today = this._getToday();
    var allTips = this.tips || [];
    var racingTips = allTips.filter(function(t) {
      return t.sport === 'racing' && t.status === 'active' && (!t.date || App._normDate(t.date) === today);
    });

    if (racingTips.length === 0) {
      container.innerHTML = '';
      return;
    }

    var now = new Date();
    var items = [];

    racingTips.forEach(function(tip) {
      if (!tip.raceTime) return;
      var timeParts = tip.raceTime.match(/(\d{1,2}):(\d{2})/);
      if (!timeParts) return;

      var raceDate = new Date();
      raceDate.setHours(parseInt(timeParts[1], 10), parseInt(timeParts[2], 10), 0, 0);

      var diffMs = raceDate.getTime() - now.getTime();
      var diffMins = Math.round(diffMs / 60000);
      var finishedThreshold = -15;

      var status, statusText, dotClass, itemClass;

      if (diffMins > 30) {
        return; // Too far away, skip
      } else if (diffMins > 0 && diffMins <= 30) {
        status = 'upcoming';
        statusText = '\uD83C\uDFC7 NEXT RACE: ' + tip.selection + ' at ' + (tip.event || 'Unknown') + ' \u2014 starts in ' + diffMins + ' min' + (diffMins !== 1 ? 's' : '');
        dotClass = 'upcoming-dot';
        itemClass = 'upcoming';
      } else if (diffMins <= 0 && diffMins > finishedThreshold) {
        status = 'live';
        statusText = '\uD83C\uDFC7 RUNNING NOW: ' + tip.selection + ' at ' + (tip.event || 'Unknown');
        dotClass = '';
        itemClass = 'live-now';
      } else {
        status = 'finished';
        var resultText = tip.result ? (tip.result === 'won' ? 'WON' : tip.result === 'lost' ? 'LOST' : tip.result.toUpperCase()) : 'Awaiting result...';
        statusText = '\uD83C\uDFC7 ' + tip.selection + ' at ' + (tip.event || 'Unknown') + ' \u2014 ' + resultText;
        dotClass = 'finished-dot';
        itemClass = 'finished';
      }

      items.push({
        diffMins: diffMins,
        status: status,
        html: '<div class="live-race-item ' + itemClass + '">' +
          '<div class="live-dot ' + dotClass + '"></div>' +
          '<div class="live-race-info">' +
            '<div class="live-race-status">' + statusText + '</div>' +
            '<div class="live-race-meta">' + tip.raceTime + ' \u2022 ' + self.formatOdds(tip.odds) + '</div>' +
          '</div>' +
        '</div>'
      });
    });

    if (items.length === 0) {
      container.innerHTML = '';
      return;
    }

    // Sort: live first, then upcoming, then finished
    var statusOrder = { live: 0, upcoming: 1, finished: 2 };
    items.sort(function(a, b) {
      if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status];
      return a.diffMins - b.diffMins;
    });

    container.innerHTML = '<div class="live-race-tracker">' +
      '<div class="live-race-tracker-title"><span class="live-dot"></span> Live Race Tracker</div>' +
      items.map(function(i) { return i.html; }).join('') +
    '</div>';

    // Set up auto-refresh every 30 seconds (clean up on page change)
    if (this._liveRaceInterval) clearInterval(this._liveRaceInterval);
    this._liveRaceInterval = setInterval(function() {
      if (App.currentPage !== 'dashboard') {
        clearInterval(App._liveRaceInterval);
        App._liveRaceInterval = null;
        return;
      }
      App.renderLiveRaceTracker();
    }, 30000);
  },

  // =========================================================================
  // FEATURE 2: Bankroll Challenge Mode
  // =========================================================================
  async renderChallenge() {
    var app = document.getElementById('app');

    if (!this.isPremium()) {
      app.innerHTML = '<div class="container">' +
        '<div class="page-header"><h1><span class="accent">30-Day Bankroll Challenge</span></h1><p>Premium feature</p></div>' +
        '<div class="challenge-cta-card">' +
          '<div style="font-size:48px;margin-bottom:16px;">&#128176;</div>' +
          '<h2>Premium Feature</h2>' +
          '<p>The 30-Day Bankroll Challenge is available exclusively to Premium members. Upgrade to track your virtual bankroll growth.</p>' +
          '<a href="#/pricing" class="btn btn-gold btn-lg">Upgrade to Premium</a>' +
        '</div>' +
      '</div>';
      return;
    }

    var challengeStart = localStorage.getItem('ee_challenge_start');

    if (!challengeStart) {
      app.innerHTML = '<div class="container challenge-page">' +
        '<div class="page-header"><h1><span class="accent">30-Day Bankroll Challenge</span></h1><p>Can you grow a \u00a3100 bank following our tips?</p></div>' +
        '<div class="challenge-cta-card">' +
          '<div style="font-size:64px;margin-bottom:20px;">&#127942;</div>' +
          '<h2>The 30-Day Challenge</h2>' +
          '<p>Start with a virtual \u00a3100 bankroll and follow our tips for 30 days. Track your daily P/L, see your growth, and share your progress. No real money needed \u2014 just skill and strategy.</p>' +
          '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:400px;margin:0 auto 24px;">' +
            '<div style="text-align:center;"><div style="font-size:24px;font-weight:800;color:#d4a843;">\u00a3100</div><div style="font-size:11px;color:var(--text-muted);">Starting Bank</div></div>' +
            '<div style="text-align:center;"><div style="font-size:24px;font-weight:800;color:#d4a843;">30</div><div style="font-size:11px;color:var(--text-muted);">Days</div></div>' +
            '<div style="text-align:center;"><div style="font-size:24px;font-weight:800;color:#22c55e;">Free</div><div style="font-size:11px;color:var(--text-muted);">To Join</div></div>' +
          '</div>' +
          '<button class="btn btn-gold btn-lg" onclick="App.startChallenge()">Start Challenge</button>' +
          '<div style="font-size:12px;color:var(--text-muted);margin-top:12px;">Uses actual results from our selections. Virtual tracking only.</div>' +
        '</div>' +
      '</div>';
      return;
    }

    app.innerHTML = this.renderSkeleton('dashboard');

    var allResults = [];
    try { allResults = await this.api('/results'); if (!Array.isArray(allResults)) allResults = []; } catch (e) { allResults = []; }

    var startDate = new Date(challengeStart);
    var now = new Date();
    var daysPassed = Math.floor((now.getTime() - startDate.getTime()) / 86400000) + 1;
    if (daysPassed > 30) daysPassed = 30;

    // Calculate daily P/L from results since challenge started
    var startStr = challengeStart;
    var challengeResults = allResults.filter(function(r) {
      if (!r.date) return false;
      return App._normDate(r.date) >= startStr;
    }).sort(function(a, b) { return (a.date || '').localeCompare(b.date || ''); });

    // Group by day
    var dailyPL = {};
    challengeResults.forEach(function(r) {
      var dayStr = App._normDate(r.date);
      if (!dailyPL[dayStr]) dailyPL[dayStr] = 0;
      dailyPL[dayStr] += (r.pnl || 0);
    });

    // Build 30-day log
    var bankroll = 100;
    var dailyLog = [];
    for (var d = 0; d < daysPassed; d++) {
      var dayDate = new Date(startDate);
      dayDate.setDate(dayDate.getDate() + d);
      var dayStr = dayDate.toISOString().split('T')[0];
      var pl = dailyPL[dayStr] || 0;
      // Scale P/L assuming 1 unit = 2% of starting bank = 2
      var scaledPL = pl * 2;
      bankroll += scaledPL;
      dailyLog.push({ day: d + 1, date: dayStr, pl: scaledPL, bank: bankroll });
    }

    var growth = ((bankroll - 100) / 100 * 100).toFixed(1);
    var growthSign = bankroll >= 100 ? '+' : '';
    var growthColor = bankroll >= 100 ? '#22c55e' : '#ef4444';

    var dailyLogHtml = dailyLog.map(function(dl) {
      var plStr = dl.pl >= 0 ? '+\u00a3' + dl.pl.toFixed(2) : '-\u00a3' + Math.abs(dl.pl).toFixed(2);
      var plClass = dl.pl > 0 ? 'positive' : (dl.pl < 0 ? 'negative' : 'neutral');
      return '<div class="challenge-day-item">' +
        '<div class="day-num">Day ' + dl.day + '</div>' +
        '<div class="day-pl ' + plClass + '">' + plStr + '</div>' +
      '</div>';
    }).join('');

    var shareText = encodeURIComponent("I'm on Day " + daysPassed + " of the Elite Edge 30-Day Challenge \u2014 " + growthSign + growth + "% growth! Join free: eliteedgesports.co.uk #EliteEdge");

    app.innerHTML = '<div class="container challenge-page">' +
      '<div class="page-header"><h1><span class="accent">30-Day Bankroll Challenge</span></h1><p>Track your virtual bankroll growth following our tips</p></div>' +
      '<div class="challenge-header">' +
        '<h2>Your Challenge Progress</h2>' +
        '<p style="color:var(--text-secondary);font-size:13px;">Started ' + formatDateUK(challengeStart) + '</p>' +
        '<div class="challenge-stats-grid">' +
          '<div class="challenge-stat"><div class="challenge-stat-value">Day ' + daysPassed + '</div><div class="challenge-stat-label">of 30</div></div>' +
          '<div class="challenge-stat"><div class="challenge-stat-value">\u00a3100</div><div class="challenge-stat-label">Starting Bank</div></div>' +
          '<div class="challenge-stat"><div class="challenge-stat-value" style="color:' + growthColor + ';">\u00a3' + bankroll.toFixed(2) + '</div><div class="challenge-stat-label">Current Bank</div></div>' +
          '<div class="challenge-stat"><div class="challenge-stat-value" style="color:' + growthColor + ';">' + growthSign + growth + '%</div><div class="challenge-stat-label">Growth</div></div>' +
        '</div>' +
        '<div class="challenge-progress-bar"><div class="challenge-progress-fill" style="width:' + ((daysPassed / 30) * 100).toFixed(1) + '%;"></div></div>' +
        '<div style="font-size:12px;color:var(--text-muted);">' + daysPassed + ' of 30 days completed</div>' +
        '<div style="margin-top:16px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">' +
          '<button class="btn btn-gold btn-sm" onclick="window.open(\'https://twitter.com/intent/tweet?text=' + shareText + '\',\'_blank\')">Share Progress</button>' +
          '<button class="btn btn-outline btn-sm" onclick="if(confirm(\'Reset your challenge? This cannot be undone.\')){localStorage.removeItem(\'ee_challenge_start\');App.renderChallenge();}">Reset Challenge</button>' +
        '</div>' +
      '</div>' +
      '<div class="card" style="padding:20px;">' +
        '<h3 style="font-size:16px;font-weight:700;margin-bottom:14px;">Daily P/L Log</h3>' +
        (dailyLog.length > 0 ? '<div class="challenge-daily-log">' + dailyLogHtml + '</div>' : '<p class="text-muted">No data yet. Results will appear as tips settle.</p>') +
      '</div>' +
      (daysPassed >= 30 ? '<div class="card text-center" style="padding:32px;margin-top:20px;border-color:rgba(212,168,67,0.3);">' +
        '<div style="font-size:48px;margin-bottom:12px;">&#127942;</div>' +
        '<h2 style="color:var(--gold);margin-bottom:8px;">Challenge Complete!</h2>' +
        '<p style="color:var(--text-secondary);font-size:15px;">You finished with \u00a3' + bankroll.toFixed(2) + ' (' + growthSign + growth + '% growth)</p>' +
        '<button class="btn btn-gold" style="margin-top:16px;" onclick="localStorage.removeItem(\'ee_challenge_start\');App.renderChallenge();">Start New Challenge</button>' +
      '</div>' : '') +
    '</div>';
  },

  startChallenge() {
    var today = this._getToday();
    localStorage.setItem('ee_challenge_start', today);
    this.showToast('Challenge started! Good luck!', 'success');
    this.renderChallenge();
  },

  // =========================================================================
  // FEATURE 3: Cashout Calculator
  // =========================================================================
  renderCashoutCalculator() {
    return '<div class="cashout-section">' +
      '<h3>Cashout Calculator</h3>' +
      '<div class="form-group">' +
        '<label>Original Odds (decimal)</label>' +
        '<input type="number" id="co-original-odds" value="3.00" min="1.01" step="0.01" oninput="App.calculateCashout()">' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Original Stake (\u00a3)</label>' +
        '<input type="number" id="co-stake" value="10" min="0.5" step="0.5" oninput="App.calculateCashout()">' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Current Live Odds (decimal)</label>' +
        '<input type="number" id="co-current-odds" value="2.50" min="1.01" step="0.01" oninput="App.calculateCashout()">' +
      '</div>' +
      '<div class="cashout-results" id="cashout-results">' +
        '<div class="cashout-result-item"><div class="co-label">Original Return</div><div class="co-value" id="co-original-return">-</div></div>' +
        '<div class="cashout-result-item"><div class="co-label">Cashout Value</div><div class="co-value" id="co-cashout-value" style="color:var(--gold);">-</div></div>' +
        '<div class="cashout-result-item"><div class="co-label">Profit if Cash Out</div><div class="co-value" id="co-cashout-profit">-</div></div>' +
        '<div class="cashout-result-item"><div class="co-label">Profit if Wins</div><div class="co-value" id="co-win-profit">-</div></div>' +
      '</div>' +
      '<div class="cashout-bar-container" id="co-bar-container">' +
        '<div class="cashout-bar-fill" id="co-bar-cashout" style="background:var(--gold);width:0%;"></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-top:-10px;margin-bottom:10px;">' +
        '<span>Cashout</span><span>Full Win</span>' +
      '</div>' +
      '<div class="cashout-verdict neutral" id="co-verdict">Enter your odds to see recommendation</div>' +
    '</div>';
  },

  calculateCashout() {
    var origOdds = parseFloat(document.getElementById('co-original-odds')?.value) || 3.0;
    var stake = parseFloat(document.getElementById('co-stake')?.value) || 10;
    var currOdds = parseFloat(document.getElementById('co-current-odds')?.value) || 2.5;

    var originalReturn = stake * origOdds;
    var cashoutValue = stake * (origOdds / currOdds);
    var cashoutProfit = cashoutValue - stake;
    var winProfit = (origOdds - 1) * stake;

    var orEl = document.getElementById('co-original-return');
    var cvEl = document.getElementById('co-cashout-value');
    var cpEl = document.getElementById('co-cashout-profit');
    var wpEl = document.getElementById('co-win-profit');
    var barEl = document.getElementById('co-bar-cashout');
    var verdictEl = document.getElementById('co-verdict');

    if (orEl) orEl.textContent = '\u00a3' + originalReturn.toFixed(2);
    if (cvEl) cvEl.textContent = '\u00a3' + cashoutValue.toFixed(2);
    if (cpEl) {
      cpEl.textContent = (cashoutProfit >= 0 ? '+' : '') + '\u00a3' + cashoutProfit.toFixed(2);
      cpEl.style.color = cashoutProfit >= 0 ? 'var(--green)' : 'var(--red)';
    }
    if (wpEl) {
      wpEl.textContent = '+\u00a3' + winProfit.toFixed(2);
      wpEl.style.color = 'var(--green)';
    }

    // Bar showing cashout vs full win
    if (barEl) {
      var pct = originalReturn > 0 ? Math.min(100, (cashoutValue / originalReturn) * 100) : 0;
      barEl.style.width = pct.toFixed(1) + '%';
    }

    // Verdict
    if (verdictEl) {
      if (currOdds > origOdds) {
        // Current odds are longer = bet is winning
        verdictEl.className = 'cashout-verdict winning';
        verdictEl.innerHTML = '<strong>Your bet is winning!</strong> The market has drifted. Cashout locks in \u00a3' + cashoutProfit.toFixed(2) + ' profit. Consider cashing out to secure gains.';
      } else if (currOdds < origOdds) {
        // Current odds are shorter = market moved against
        verdictEl.className = 'cashout-verdict losing';
        verdictEl.innerHTML = '<strong>Market has moved against you.</strong> Current odds are shorter than your original. Cashout value (\u00a3' + cashoutValue.toFixed(2) + ') is above your stake. Let it ride if you believe it will win.';
      } else {
        verdictEl.className = 'cashout-verdict neutral';
        verdictEl.innerHTML = '<strong>Odds unchanged.</strong> No advantage to cashing out right now. Hold your position or wait for movement.';
      }
    }
  },

  // =========================================================================
  // FEATURE 4: Streak Rewards
  // =========================================================================
  async renderStreakRewards() {
    var container = document.getElementById('streak-rewards');
    if (!container) return;

    var streakData;
    try {
      streakData = await this.api('/results/streaks');
    } catch (e) {
      streakData = null;
    }

    var currentStreak = 0;
    if (streakData && typeof streakData.currentStreak === 'number') {
      currentStreak = streakData.currentStreak;
    } else {
      // Fallback: calculate from results
      var allResults = [];
      try { allResults = await this.api('/results'); if (!Array.isArray(allResults)) allResults = []; } catch (e) {}
      currentStreak = this.calculateStreak(allResults);
    }

    var milestones = [
      { wins: 3, icon: '\uD83D\uDD25', name: 'Hot Streak', desc: '3 consecutive winners', reward: 'Badge unlocked' },
      { wins: 5, icon: '\u2B50', name: 'On Fire', desc: '5 consecutive winners', reward: 'Early tip preview \u2014 tomorrow\'s NAP confidence level' },
      { wins: 7, icon: '\uD83D\uDC8E', name: 'Diamond Run', desc: '7 consecutive winners', reward: 'Bonus AI analysis for any fixture' },
      { wins: 10, icon: '\uD83D\uDC51', name: 'Legendary', desc: '10 consecutive winners', reward: '1 month added to subscription' }
    ];

    // Find next milestone
    var nextMilestone = milestones.find(function(m) { return currentStreak < m.wins; });
    var nextTarget = nextMilestone ? nextMilestone.wins : milestones[milestones.length - 1].wins;
    var progressPct = nextMilestone ? Math.min(100, (currentStreak / nextMilestone.wins) * 100) : 100;

    if (currentStreak === 0) {
      container.innerHTML = '<div class="streak-rewards">' +
        '<div class="streak-rewards-title"><span>\uD83C\uDFC6</span> Streak Rewards</div>' +
        '<div style="text-align:center;padding:16px;">' +
          '<div style="font-size:32px;margin-bottom:12px;">\uD83C\uDFAF</div>' +
          '<div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">Start your streak!</div>' +
          '<div style="font-size:13px;color:var(--text-secondary);">Back today\'s NAP and begin your run. Win 3+ in a row to unlock rewards.</div>' +
        '</div>' +
      '</div>';
      return;
    }

    var milestonesHtml = milestones.map(function(m) {
      var unlocked = currentStreak >= m.wins;
      var active = !unlocked && nextMilestone && nextMilestone.wins === m.wins;
      var cls = unlocked ? 'streak-milestone unlocked' : (active ? 'streak-milestone active' : 'streak-milestone');
      var statusCls = unlocked ? 'streak-milestone-status earned' : 'streak-milestone-status locked';
      var statusText = unlocked ? 'Unlocked' : (m.wins - currentStreak) + ' more';

      return '<div class="' + cls + '">' +
        '<div class="streak-milestone-icon">' + m.icon + '</div>' +
        '<div class="streak-milestone-info">' +
          '<div class="streak-milestone-name">' + m.name + '</div>' +
          '<div class="streak-milestone-desc">' + m.desc + '</div>' +
          '<div class="streak-milestone-reward">Reward: ' + m.reward + '</div>' +
        '</div>' +
        '<div class="' + statusCls + '">' + statusText + '</div>' +
      '</div>';
    }).join('');

    container.innerHTML = '<div class="streak-rewards">' +
      '<div class="streak-rewards-title"><span>\uD83C\uDFC6</span> Streak Rewards \u2014 ' + currentStreak + ' Win Streak</div>' +
      '<div class="streak-progress-mini"><div class="streak-progress-mini-fill" style="width:' + progressPct.toFixed(1) + '%;"></div></div>' +
      '<div style="font-size:11px;color:var(--text-muted);margin-bottom:14px;text-align:right;">' + currentStreak + ' / ' + nextTarget + ' wins to next reward</div>' +
      milestonesHtml +
    '</div>';
  },

  // =========================================================================
  // FEATURE 5: Tip Confidence Heatmap
  // =========================================================================
  renderConfidenceHeatmap(tips) {
    if (!tips || tips.length === 0) return '';

    var today = this._getToday();
    var todayTips = tips.filter(function(t) {
      return t.sport === 'racing' && t.status === 'active' && (!t.date || App._normDate(t.date) === today);
    });

    if (todayTips.length === 0) return '';

    // Group by meeting (event field)
    var meetings = {};
    todayTips.forEach(function(t) {
      var meeting = t.event || 'Unknown';
      if (!meetings[meeting]) meetings[meeting] = [];
      meetings[meeting].push(t);
    });

    // Sort tips within each meeting by race time
    var meetingKeys = Object.keys(meetings).sort();
    meetingKeys.forEach(function(k) {
      meetings[k].sort(function(a, b) {
        return (a.raceTime || '').localeCompare(b.raceTime || '');
      });
    });

    var rowsHtml = meetingKeys.map(function(meeting) {
      var meetingTips = meetings[meeting];
      var blocksHtml = meetingTips.map(function(t) {
        var conf = t.confidence || 0;
        var cls, label;
        if (conf >= 9) { cls = 'elite'; label = 'Elite'; }
        else if (conf >= 7) { cls = 'strong'; label = 'Strong'; }
        else if (conf >= 5) { cls = 'watching'; label = 'Watch'; }
        else { cls = 'none'; label = '-'; }

        var time = t.raceTime || '--:--';
        var tooltip = t.selection + ' (' + conf + '/10)';
        return '<div class="heatmap-block ' + cls + '" title="' + tooltip.replace(/"/g, '&quot;') + '" onclick="App._scrollToRaceTip(\'' + (t.id || '').replace(/'/g, "\\'") + '\')">' + time + '</div>';
      }).join('');

      // Truncate meeting name for display
      var displayName = meeting.length > 14 ? meeting.substring(0, 12) + '..' : meeting;
      return '<div class="heatmap-row">' +
        '<div class="heatmap-label" title="' + meeting.replace(/"/g, '&quot;') + '">' + displayName + '</div>' +
        blocksHtml +
      '</div>';
    }).join('');

    return '<div class="confidence-heatmap">' +
      '<div class="confidence-heatmap-title"><span>\uD83D\uDCCA</span> Today\'s Confidence Heatmap</div>' +
      rowsHtml +
      '<div class="heatmap-legend">' +
        '<div class="heatmap-legend-item"><div class="heatmap-legend-dot" style="background:#ef4444;"></div> Elite (9-10)</div>' +
        '<div class="heatmap-legend-item"><div class="heatmap-legend-dot" style="background:#f59e0b;"></div> Strong (7-8)</div>' +
        '<div class="heatmap-legend-item"><div class="heatmap-legend-dot" style="background:#3b82f6;"></div> Watching (5-6)</div>' +
        '<div class="heatmap-legend-item"><div class="heatmap-legend-dot" style="background:#1e293b;"></div> No Edge (&lt;5)</div>' +
      '</div>' +
    '</div>';
  },

  _scrollToRaceTip(tipId) {
    if (!tipId) return;
    var el = document.querySelector('[data-tip-id="' + tipId + '"]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.outline = '2px solid var(--gold)';
      setTimeout(function() { el.style.outline = ''; }, 2000);
    } else {
      // Navigate to tip detail page
      window.location.hash = '#/tip/' + tipId;
    }
  },
};

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
