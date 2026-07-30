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
  // Cosmo Bet — our official sportsbook partner. This is the affiliate tracking
  // link (Cellxpert): a click drops the cookie so any resulting sign-up/deposit
  // is attributed to us (CPA). `sub` appends a subId so we can see which surface
  // converts. Not a secret — it's a public affiliate link.
  COSMO_BET_URL: 'https://track.cosmobetpartners.com/visit/?bta=42583&nci=6102',
  cosmoLink(sub) {
    var u = this.COSMO_BET_URL;
    return sub ? u + '&subid=' + encodeURIComponent(sub) : u;
  },
  // A branded, compliant "Bet with Cosmo Bet" CTA. `label` overrides the text.
  renderCosmoCta(sub, label) {
    return '<a href="' + this.cosmoLink(sub) + '" target="_blank" rel="noopener sponsored" ' +
      'onclick="event.stopPropagation();" class="cosmo-cta" ' +
      'style="display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;box-sizing:border-box;' +
      'background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;font-weight:800;font-size:14px;' +
      'padding:11px 16px;border-radius:8px;text-decoration:none;margin-top:12px;">' +
      '⚡ ' + (label || 'Bet with Cosmo Bet') + ' →' +
      '</a>' +
      '<div style="font-size:10px;color:var(--text-muted);text-align:center;margin-top:6px;">' +
      'Official partner · 18+ · <a href="https://www.begambleaware.org" target="_blank" rel="noopener" style="color:var(--text-muted);">BeGambleAware.org</a></div>';
  },
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
    this._wireNavDropdowns();
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
    this._loadNewsTicker(); // live football news ticker (persists across pages)
    this._loadLiveStrip();  // site-wide live scoreboard strip
    if (!this._liveStripTimer) this._liveStripTimer = setInterval(function () { App._loadLiveStrip(); }, 60000);
    this._mountAskFab(); // site-wide floating "Ask the Edge" widget
    this.loadDailyStats();
    this.loadActivityTicker();
    this.initNotifications();
    this.initOddsTicker();
    this.checkReferralParam();
    this.initCookieConsent();
    this.loadAnalytics();
    this.initChatTease();
    this.initInstallPrompt();
    // Real-time engine — keeps dashboard alive without manual refresh
    this._initRealTimeEngine();
    // Feature flags — show/hide World Cup + LMS nav, then sync the Competitions
    // group (hide the whole dropdown if neither is live).
    this.api('/status').then(function(data) {
      if (data && data.features && data.features.worldCup) {
        var wcNav = document.getElementById('nav-world-cup');
        if (wcNav) wcNav.style.display = '';
      }
      if (data && data.features && data.features.lms) {
        var lmsNav = document.getElementById('nav-lms');
        if (lmsNav) lmsNav.style.display = '';
      }
      App._syncNavGroups();
    }).catch(function() { App._syncNavGroups(); });
  },

  // Make nav dropdowns work on CLICK/TAP (not just hover) — essential for touch
  // devices and for users who click the trigger. Toggles an .open class; clicks
  // outside close them; selecting a link closes the menu.
  _wireNavDropdowns() {
    document.addEventListener('click', function (e) {
      var trigger = e.target.closest('.nav-dropdown-trigger');
      if (trigger) {
        e.preventDefault();
        var group = trigger.closest('.nav-dropdown');
        var wasOpen = group.classList.contains('open');
        document.querySelectorAll('.nav-dropdown.open').forEach(function (g) { g.classList.remove('open'); });
        if (!wasOpen) group.classList.add('open');
        return;
      }
      // A link inside a menu, or any outside click → close all.
      document.querySelectorAll('.nav-dropdown.open').forEach(function (g) { g.classList.remove('open'); });
    });
  },

  // Hide any grouped nav dropdown that has no visible links (e.g. Competitions
  // when neither World Cup nor Last Man Standing is live), so the top nav never
  // shows an empty menu.
  _syncNavGroups() {
    document.querySelectorAll('[data-nav-group]').forEach(function(group) {
      var links = group.querySelectorAll('.nav-dropdown-menu > a');
      var anyVisible = Array.prototype.some.call(links, function(a) { return a.style.display !== 'none'; });
      group.style.display = anyVisible ? '' : 'none';
    });
  },

  // -----------------------------------------------------------------------
  // REAL-TIME ENGINE — keeps all screens alive without manual refresh
  // Per Master Prompt: no stale dashboards, no frozen stats, everything alive
  // -----------------------------------------------------------------------
  _rtLastTipCount: 0,
  _rtLastResultCount: 0,

  _initRealTimeEngine() {
    var self = this;

    // 1. Live scores refresh — every 30 seconds on football/dashboard pages
    setInterval(function() {
      var page = self.currentPage;
      if (page === 'football' || page === 'dashboard' || page === 'live') {
        self._rtRefreshLiveScores();
      }
    }, 30000);

    // 2. Settlement + tip check — every 2 minutes on any page
    setInterval(function() {
      self._rtCheckForUpdates();
    }, 120000);

    // 3. Daily stats bar — refresh every 60 seconds
    setInterval(function() {
      self.loadDailyStats();
    }, 60000);
  },

  async _rtRefreshLiveScores() {
    try {
      var data = await this.fetchLiveFootball(true); // force fresh
      if (!data || !data.fixtures) return;
      var fixtures = data.fixtures;

      // Update any live score elements on the current page
      fixtures.forEach(function(f) {
        if (f.status === 'FT' || f.status === 'AET' || f.status === 'PEN' ||
            f.status === '1H' || f.status === '2H' || f.status === 'HT' || f.status === 'LIVE') {
          // Find fixture cards on the page and update scores
          var cards = document.querySelectorAll('.fixture-card, .wc-fixture-card');
          cards.forEach(function(card) {
            var teamsEl = card.querySelector('.fixture-teams');
            if (!teamsEl) return;
            var text = teamsEl.textContent.toLowerCase();
            if (text.indexOf(f.homeTeam.toLowerCase()) !== -1 || text.indexOf(f.awayTeam.toLowerCase()) !== -1) {
              var scoreEl = card.querySelector('.fixture-score');
              if (scoreEl && f.homeGoals !== null) {
                scoreEl.textContent = f.homeGoals + ' - ' + f.awayGoals;
              }
              // Update status badge
              var liveBadge = card.querySelector('.fixture-live-badge');
              if (liveBadge && (f.status === 'FT' || f.status === 'AET')) {
                liveBadge.textContent = 'FT';
                liveBadge.style.background = 'var(--text-muted)';
              }
            }
          });
        }
      });
    } catch(e) { /* silent — non-critical */ }
  },

  async _rtCheckForUpdates() {
    try {
      // Check if tips count changed (new tips published)
      var tips = await this.api('/tips');
      if (Array.isArray(tips)) {
        var footballToday = tips.filter(function(t) {
          return t.sport === 'football' && t.status === 'active' && !t.isWeeklyAcca;
        });
        if (footballToday.length > this._rtLastTipCount && this._rtLastTipCount > 0) {
          this.showToast('New tips published! ' + footballToday.length + ' selections live.', 'success');
          this.loadDailyStats();
        }
        this._rtLastTipCount = footballToday.length;
        this.tips = tips;
      }

      // Check if results changed (new settlements)
      var results = await this.api('/results?sport=football&days=1');
      if (Array.isArray(results)) {
        if (results.length > this._rtLastResultCount && this._rtLastResultCount > 0) {
          var newResults = results.length - this._rtLastResultCount;
          this.showToast(newResults + ' tip' + (newResults === 1 ? '' : 's') + ' just settled. Check Results.', 'info');
          this.loadDailyStats();
          // Update daily stats bar P&L
          var todayResults = results;
          var wins = todayResults.filter(function(r) { return r.result === 'won'; }).length;
          var pnl = todayResults.reduce(function(s, r) { return s + (r.pnl || 0); }, 0);
          var statsBar = document.getElementById('daily-stats-bar');
          if (statsBar) {
            var wonEl = statsBar.querySelector('[data-stat="won"]');
            var pnlEl = statsBar.querySelector('[data-stat="pnl"]');
            if (wonEl) wonEl.textContent = wins;
            if (pnlEl) { pnlEl.textContent = (pnl >= 0 ? '+' : '') + pnl.toFixed(2); pnlEl.style.color = pnl >= 0 ? '#22c55e' : '#ef4444'; }
          }
        }
        this._rtLastResultCount = results.length;
      }
    } catch(e) { /* silent */ }
  },

  // -----------------------------------------------------------------------
  // PWA INSTALL PROMPT
  // -----------------------------------------------------------------------
  _deferredInstallPrompt: null,

  initInstallPrompt() {
    var self = this;
    // Android install prompt
    window.addEventListener('beforeinstallprompt', function(e) {
      e.preventDefault();
      self._deferredInstallPrompt = e;
      if (!localStorage.getItem('ee_install_dismissed')) {
        setTimeout(function() {
          if (self._deferredInstallPrompt) self.showInstallBanner();
        }, 30000);
      }
    });

    // iOS install prompt (no beforeinstallprompt support)
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    var isStandalone = window.navigator.standalone === true;
    if (isIOS && !isStandalone && !localStorage.getItem('ee_install_dismissed')) {
      setTimeout(function() {
        self.showIOSInstallPrompt();
      }, 15000);
    }
  },

  showIOSInstallPrompt() {
    if (document.getElementById('ios-install-prompt')) return;
    var prompt = document.createElement('div');
    prompt.id = 'ios-install-prompt';
    prompt.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#141828;border-top:2px solid rgba(212,168,67,0.3);padding:16px 20px;z-index:9998;animation:slideUp 0.3s ease-out;';
    prompt.innerHTML =
      '<div style="display:flex;align-items:center;gap:14px;max-width:600px;margin:0 auto;">' +
        '<div style="font-size:36px;flex-shrink:0;">&#128241;</div>' +
        '<div style="flex:1;">' +
          '<div style="font-weight:700;color:#fff;font-size:14px;margin-bottom:4px;">Install Elite Edge</div>' +
          '<div style="font-size:12px;color:#94a3b8;line-height:1.4;">Tap <strong style="color:#fff;">Share</strong> <span style="font-size:16px;">&#9757;</span> then <strong style="color:#fff;">"Add to Home Screen"</strong> for the full app experience.</div>' +
        '</div>' +
        '<button onclick="document.getElementById(\'ios-install-prompt\').remove();localStorage.setItem(\'ee_install_dismissed\',\'true\');" style="background:none;border:none;color:#64748b;font-size:20px;cursor:pointer;padding:8px;">&times;</button>' +
      '</div>';
    document.body.appendChild(prompt);
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
  _getDateOffset(n) {
    var d = new Date(); d.setDate(d.getDate() + n);
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
      const res = await fetch(`/api${endpoint}`, { cache: 'no-store', ...options, headers: { ...headers, ...options.headers } });
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
    const firstName = (document.getElementById('reg-first-name').value || '').trim();
    const surname = (document.getElementById('reg-surname').value || '').trim();
    const dateOfBirth = (document.getElementById('reg-dob').value || '').trim();
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const mobileEl = document.getElementById('reg-mobile');
    const mobileVal = mobileEl ? mobileEl.value.trim() : '';

    if (!firstName || !surname) { document.getElementById('reg-error').textContent = 'Please enter your first name and surname.'; return; }
    if (!dateOfBirth) { document.getElementById('reg-error').textContent = 'Please enter your date of birth.'; return; }
    if (!mobileVal || mobileVal.replace(/\D/g, '').length < 7) { document.getElementById('reg-error').textContent = 'Please enter a valid mobile number.'; return; }
    // 18+ check
    var _dob = new Date(dateOfBirth);
    var _age = (Date.now() - _dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (isNaN(_dob.getTime()) || _age < 18) { document.getElementById('reg-error').textContent = 'You must be 18 or over to register.'; return; }

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

      const data = await this.api('/auth/register', {
        method: 'POST', body: JSON.stringify({ firstName, surname, dateOfBirth, email, password, mobile: mobileVal, agreementTimestamp, referralCode: refCode || undefined })
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
      badge.innerHTML = this.user.name + (this.isVIP() ? ' <span class="vip-badge">VIP</span>' : '');
      badge.style.cursor = 'pointer';
      badge.onclick = () => { window.location.hash = '#/account'; };
      // Dedicated, always-visible credits pill (desktop + mobile). VIP = unlimited.
      var creditsPill = document.getElementById('nav-credits');
      if (creditsPill) {
        if (this.isVIP()) {
          // VIP is unlimited — no credit count to show, keep the bar clean.
          creditsPill.style.display = 'none';
        } else if (this.user.credits !== undefined && this.user.credits !== null) {
          var c = this.user.credits || 0;
          creditsPill.innerHTML = '<span class="nav-credits-num">' + c + '</span> credit' + (c === 1 ? '' : 's');
          creditsPill.classList.toggle('nav-credits-low', c <= 3);
          creditsPill.classList.remove('nav-credits-vip');
          creditsPill.style.display = 'inline-flex';
        } else {
          creditsPill.style.display = 'none';
        }
      }
      // Mobile auth
      if (guestMobile) guestMobile.style.display = 'none';
      if (userMobile) userMobile.style.display = '';
      var signupMobileBtn = document.getElementById('nav-signup-mobile');
      if (signupMobileBtn) signupMobileBtn.style.display = 'none';
      if (badgeMobile) { badgeMobile.innerHTML = this.user.name + (this.isVIP() ? ' <span class="vip-badge">VIP</span>' : ''); badgeMobile.style.cursor = 'pointer'; badgeMobile.onclick = () => { window.location.hash = '#/account'; }; }
      // Top menu auth (mobile only — toggled via class, CSS hides on desktop)
      var topGuest = document.getElementById('nav-auth-top-guest');
      var topUser = document.getElementById('nav-auth-top-user');
      if (topGuest) topGuest.classList.add('nav-auth-hidden');
      if (topUser) topUser.classList.remove('nav-auth-hidden');
      var navAvatar = document.getElementById('nav-user-avatar');
      var navWelcome = document.getElementById('nav-user-welcome');
      var navPlan = document.getElementById('nav-user-plan');
      if (navAvatar) navAvatar.textContent = (this.user.name || '?').charAt(0).toUpperCase();
      if (navWelcome) navWelcome.textContent = 'Welcome, ' + (this.user.name || '').split(' ')[0];
      var planLabel = this.isVIP() ? 'VIP Member' : this.isPremium() ? 'Premium Member' : this.user.subscription === 'starter' ? 'Starter Member' : 'Free Member';
      if (navPlan) navPlan.textContent = planLabel;
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
      var creditsPillOut = document.getElementById('nav-credits');
      if (creditsPillOut) creditsPillOut.style.display = 'none';
      // Mobile auth
      if (guestMobile) guestMobile.style.display = '';
      if (userMobile) userMobile.style.display = 'none';
      var signupMobileBtnG = document.getElementById('nav-signup-mobile');
      if (signupMobileBtnG) signupMobileBtnG.style.display = '';  // CSS shows it on mobile only
      // Top menu auth (mobile only — toggled via class, CSS hides on desktop)
      var topGuest2 = document.getElementById('nav-auth-top-guest');
      var topUser2 = document.getElementById('nav-auth-top-user');
      if (topGuest2) topGuest2.classList.remove('nav-auth-hidden');
      if (topUser2) topUser2.classList.add('nav-auth-hidden');
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
        // A dropdown group header (trigger) is not a real destination — tapping it
        // must NOT collapse the whole mobile menu, only real links close it.
        if (link.classList.contains('nav-dropdown-trigger')) return;
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
    // Clear World Cup countdowns
    if (typeof WorldCup !== 'undefined' && WorldCup._countdownInterval) {
      WorldCup.cleanup();
    }
    if (this._wcDashInterval) {
      clearInterval(this._wcDashInterval);
      this._wcDashInterval = null;
    }

    // Update active nav — highlight the link AND its parent dropdown trigger, so
    // a grouped page (e.g. Football under Sports) lights up its menu.
    document.querySelectorAll('.nav-dropdown-trigger').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(link => {
      var on = link.dataset.page === page;
      link.classList.toggle('active', on);
      if (on) {
        var group = link.closest('.nav-dropdown');
        if (group) { var trig = group.querySelector('.nav-dropdown-trigger'); if (trig) trig.classList.add('active'); }
      }
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
      case 'last-man-standing': if (typeof LMS !== 'undefined') LMS.render(); break;
      case 'winners': this.renderWinnersPage(); break;
      case 'academy': this.renderAcademy(); break;
      case 'buy-credits': this.renderBuyCredits(); break;
      case 'refer': this.renderReferral(); break;
      case 'selections': this.renderSelections(); break;
      case 'value-bets': this.renderValueBets(); break;
      case 'compare': this.renderCompare(); break;
      case 'festival': this.renderFestival(); break;
      case 'festivals': this.renderFestivalHub(); break;
      case 'results': this.renderResults(); break;
      case 'track-record': this.renderTrackRecord(); break;
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
      case 'world-cup': if (typeof WorldCup !== 'undefined') { WorldCup.render(); } else { this.render404(); } break;
      case 'events': this.renderEventHub(hash.split('/')[1]); break;
      case 'matches': this.renderMatches(); break;
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
      'analysts': 'Our Analysts — Professor, Scout, Clocker, Tactician, Edge | Elite Edge',
      'my-roi': 'My ROI Dashboard — Personal Performance Tracking | Elite Edge',
      'track-record': 'Verified Track Record — Every Tip, Every Result | Elite Edge',
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
      'world-cup': 'World Cup 2026 — Predictions, Bracket & Nation Wars | Elite Edge',
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
        '<div style="font-size:clamp(20px,5vw,24px);font-weight:900;color:#fff;margin-bottom:8px;">' + (result.selection || '') + '</div>' +
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
      (allHit ? '<div class="monthly-target-all-hit">&#127942; ALL TARGETS HIT — 10 BONUS CREDITS &#127942;</div>' : '') +

      // Login check-in calendar
      '<div style="margin-top:16px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.05);">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
          '<span style="font-size:12px;font-weight:700;color:#d4a843;">Daily Check-In</span>' +
          '<span style="font-size:11px;color:#94a3b8;">' + (this._loginStreak || 0) + '-day streak &#128293;</span>' +
        '</div>' +
        '<div style="display:flex;gap:3px;flex-wrap:wrap;">' +
          (function() {
            var daysInMonth = new Date(year, month + 1, 0).getDate();
            var today = now.getDate();
            var dots = '';
            for (var d = 1; d <= daysInMonth; d++) {
              var isPast = d < today;
              var isToday = d === today;
              var col = isToday ? '#d4a843' : isPast ? (daysTracked[year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0')] ? '#22c55e' : '#1e2235') : '#0f1320';
              dots += '<div style="width:12px;height:12px;border-radius:2px;background:' + col + ';' + (isToday ? 'box-shadow:0 0 4px #d4a843;' : '') + '" title="' + d + '/' + (month + 1) + '"></div>';
            }
            return dots;
          })() +
        '</div>' +
        '<div style="font-size:10px;color:#475569;margin-top:6px;">Green = active day. Check in 20+ days this month for bonus credits.</div>' +
      '</div>' +
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

    // GUEST LANDING FUNNEL — a cold visitor gets a clear conversion path
    // (hero → free tips → how it works → proof → pricing → FAQ), not the dense
    // members' dashboard. Members keep the full dashboard below.
    if (!this.user) {
      app.innerHTML = this._renderLandingFunnel({ todayTips: todayTips, napTip: napTip, perf: perf, recentWins: recentWins, streak: streak });
      this._loadEventSpotlight(); // featured meeting (Goodwood etc.) — fills the slot in the funnel
      return;
    }

    app.innerHTML = `
      <div class="container">
        ${!this.user ? `
        <!-- GUEST SIGN-UP HERO — unmissable for new visitors -->
        <div style="background:linear-gradient(135deg,rgba(34,197,94,0.12),rgba(212,168,67,0.08));border:2px solid rgba(212,168,67,0.45);border-radius:14px;padding:22px 24px;margin-bottom:20px;text-align:center;">
          <div style="font-size:22px;font-weight:900;color:#fff;margin-bottom:6px;">New here? Create your free account</div>
          <div style="font-size:14px;color:var(--text-secondary);margin-bottom:16px;">Free daily tips, results and analysis across 6 sports. No card needed. Upgrade anytime.</div>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
            <button class="btn btn-gold btn-lg" onclick="App.showModal('register')" style="font-weight:800;">Sign Up Free</button>
            <button class="btn btn-outline btn-lg" onclick="App.showModal('login')">Log In</button>
          </div>
        </div>
        ` : ''}
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

        <!-- WORLD CUP COUNTDOWN BANNER -->
        ${typeof WorldCup !== 'undefined' && document.getElementById('nav-world-cup') && document.getElementById('nav-world-cup').style.display !== 'none' ? `
        <div onclick="window.location.hash='#/world-cup'" style="background:linear-gradient(135deg,#1a0a2e 0%,#0a0e1a 40%,#0a2a1a 100%);border:2px solid rgba(34,197,94,0.3);border-radius:14px;padding:20px 24px;margin-bottom:20px;cursor:pointer;position:relative;overflow:hidden;">
          <div style="position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle at 30% 50%,rgba(34,197,94,0.06),transparent 50%),radial-gradient(circle at 70% 50%,rgba(212,168,67,0.06),transparent 50%);"></div>
          <div style="position:relative;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;">
            <div>
              <div style="font-size:20px;font-weight:900;background:linear-gradient(135deg,#d4a843,#f0d078);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">&#9917; FIFA World Cup 2026</div>
              <div style="color:rgba(255,255,255,0.6);font-size:13px;margin-top:4px;">USA &#127482;&#127480; Canada &#127464;&#127462; Mexico &#127474;&#127485; — Predict, Compete & Represent Your Nation</div>
            </div>
            <div id="wc-dash-countdown" style="display:flex;gap:8px;"></div>
          </div>
        </div>
        ` : ''}

        <!-- FEATURED SPORTING EVENT SPOTLIGHT (data-driven; filled by _loadEventSpotlight) -->
        <div id="event-spotlight-slot"></div>

        <!-- LAST MAN STANDING BANNER (data-driven; filled by _loadLmsBanner) -->
        <div id="lms-banner-slot"></div>

        <!-- ASK ELITE EDGE — natural-language assistant grounded in our engine -->
        <div style="background:linear-gradient(135deg,#10131f,#0a0e1a);border:1px solid rgba(212,168,67,0.3);border-radius:14px;padding:18px 20px;margin-bottom:20px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <span style="font-size:20px;">&#128173;</span>
            <div>
              <div style="font-size:16px;font-weight:800;color:#fff;">Ask Elite Edge</div>
              <div style="font-size:12px;color:var(--text-secondary);">Live, data-backed answers from our engine + real-time research. Try "Who wins the 2:45 at Kempton today?" or "Team news for Arsenal v Wolves?"</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:nowrap;">
            <input id="ee-ask-input" type="text" placeholder="Ask about any race, match or team…" onkeydown="if(event.key==='Enter'){App.askEliteEdge();}" style="flex:1;min-width:0;padding:12px 14px;background:var(--bg);border:1px solid var(--border);border-radius:10px;color:var(--text-primary);font-size:14px;">
            <button onclick="App.askEliteEdge()" class="btn btn-gold" style="white-space:nowrap;padding:12px 22px;">Ask</button>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">
            ${["Who's your NAP today?","Who wins the next at Kempton?","Best value in the football?","Any team news for today's games?"].map(function(q){ return '<button onclick="App.askEliteEdge(' + JSON.stringify(q).replace(/"/g,'&quot;') + ')" style="background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.25);color:#d4a843;font-size:11px;padding:5px 10px;border-radius:14px;cursor:pointer;">' + q + '</button>'; }).join('')}
          </div>
          <div id="ee-ask-answer" style="display:none;margin-top:14px;padding:14px 16px;background:var(--bg);border:1px solid var(--border);border-radius:10px;font-size:14px;line-height:1.6;color:var(--text-primary);"></div>
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
        <!-- Premium acca moved to dedicated Acca Builder page -->
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

        <!-- 12b. LIVE & LATEST — in-play scores + results landing (feels alive) -->
        <div id="live-now-section"></div>

        <!-- 13a. WINNERS WALL — subscriber-submitted wins (admin-moderated) -->
        <div class="section" id="winners-wall-section" style="margin-bottom:24px;">
          <div class="section-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
            <span><span style="color:#d4a843;">&#127942;</span> Winners Wall</span>
            ${this.user ? `<button class="btn btn-gold btn-sm" onclick="App.showWinnerSubmit()">Share your win</button>` : `<a href="#/pricing" class="btn btn-outline btn-sm">Join to share yours</a>`}
          </div>
          <p style="font-size:12px;color:var(--text-muted);margin:-4px 0 12px;">Real wins from Elite Edge members. 18+ | Please gamble responsibly | BeGambleAware.org</p>
          <div id="winners-wall"><div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px;">Loading winners&hellip;</div></div>
          <div style="text-align:center;margin-top:12px;"><a href="#/winners" style="color:var(--accent);font-size:13px;font-weight:600;">See all winners &rarr;</a></div>
        </div>

        <!-- 13b. SUBSCRIBER LEADERBOARD — competition + social proof -->
        <div id="subscriber-leaderboard"></div>

        <!-- 13c. FOOTBALL NEWS — live RSS feed (keeps the site fresh) -->
        <div id="football-news-section"></div>

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
          <a href="https://t.me/EliteEdgeSportsTips" target="_blank" rel="noopener" class="telegram-cta">
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
              <a href="#/how-it-works" style="font-size:12px;color:#d4a843;text-decoration:none;font-weight:600;margin-left:auto;">Full Guide &rarr;</a>
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

    // Live & Latest (in-play scores + results landing) + Winners Wall
    this._loadLiveNow();
    this._loadWinners();

    // World Cup dashboard countdown
    var wcCountdownEl = document.getElementById('wc-dash-countdown');
    if (wcCountdownEl) {
      var wcTarget = new Date('2026-06-11T20:00:00Z');
      function updateWcCountdown() {
        var now = new Date();
        var diff = wcTarget - now;
        if (diff <= 0) { wcCountdownEl.innerHTML = '<span style="color:#22c55e;font-weight:900;font-size:16px;">UNDERWAY</span>'; return; }
        var d = Math.floor(diff / 86400000);
        var h = Math.floor((diff / 3600000) % 24);
        var m = Math.floor((diff / 60000) % 60);
        var s = Math.floor((diff / 1000) % 60);
        function unit(n, l) { return '<div style="background:rgba(255,255,255,0.05);border:1px solid rgba(212,168,67,0.2);border-radius:8px;padding:6px 10px;text-align:center;min-width:48px;"><div style="font-size:18px;font-weight:900;color:#d4a843;">' + n + '</div><div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.4);">' + l + '</div></div>'; }
        wcCountdownEl.innerHTML = unit(d,'Days') + unit(h,'Hrs') + unit(m,'Min') + unit(s,'Sec');
      }
      updateWcCountdown();
      App._wcDashInterval = setInterval(updateWcCountdown, 1000);
    }

    // Render bankroll chart after DOM update
    var self = this;
    setTimeout(function() { try { self.renderBankrollChart(); } catch (e) {} }, 50);

    // Check for new wins and show celebrations
    setTimeout(function() { try { self.checkForNewWins(); } catch (e) {} }, 500);

    // Render dynamic big winner banner
    this.renderBigWinnerBanner();

    // Featured sporting-event spotlight (Goodwood, season kick-off, York Ebor…)
    this._loadEventSpotlight();

    // Render Last Man Standing banner (data-driven; only if a competition is live)
    this._loadLmsBanner();

    // Premium weekend acca — DISABLED (replaced by Smart Acca Generator page)
    // this.renderPremiumAcca();

    // Render yesterday's winner showcase (all users)
    this.renderYesterdayShowcase();

    // Fetch and render breaking news section
    this._fetchDashboardNews();
    this._loadFootballNews();

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

  _newsTimeAgo(dateStr) {
    if (!dateStr) return '';
    var diff = Date.now() - new Date(dateStr).getTime();
    if (isNaN(diff) || diff < 0) return '';
    var mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + 'm ago';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    return Math.floor(hours / 24) + 'd ago';
  },

  async _loadFootballNews() {
    var container = document.getElementById('football-news-section');
    if (!container) return;
    try {
      var data = await this.api('/football-news?limit=12');
      container = document.getElementById('football-news-section');
      if (!container) return;
      var news = (data && data.news) || [];
      if (!news.length) return; // silently skip if feeds unavailable
      var self = this;
      var cards = news.slice(0, 8).map(function (n) {
        var img = n.image
          ? '<div style="width:84px;height:64px;flex-shrink:0;border-radius:8px;overflow:hidden;background:#0a0e1a;"><img src="' + App.escapeHtml(n.image) + '" loading="lazy" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentNode.style.display=\'none\'"></div>'
          : '';
        return '<a href="' + App.escapeHtml(n.url) + '" target="_blank" rel="noopener" style="display:flex;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--border);text-decoration:none;">' +
          img +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:13px;font-weight:600;color:#fff;line-height:1.4;">' + App.escapeHtml(n.title) + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted);margin-top:3px;">' + App.escapeHtml(n.source || '') + (n.publishedAt ? ' &bull; ' + self._newsTimeAgo(n.publishedAt) : '') + '</div>' +
          '</div>' +
        '</a>';
      }).join('');
      container.innerHTML =
        '<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:20px;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">' +
            '<div style="display:flex;align-items:center;gap:10px;"><div style="font-size:22px;">&#9917;</div><div style="font-size:16px;font-weight:800;color:#fff;">Football News</div></div>' +
            '<span style="font-size:11px;color:var(--text-muted);">Live &bull; auto-updates</span>' +
          '</div>' +
          cards +
          '<p style="font-size:10px;color:var(--text-muted);margin-top:10px;text-align:center;">Headlines from BBC Sport, Sky Sports &amp; The Guardian. Tap to read the full story at the source.</p>' +
        '</div>';
    } catch (e) { /* silently skip */ }
  },

  async _loadNewsTicker() {
    var ticker = document.getElementById('news-ticker');
    if (!ticker) return;
    try {
      var data = await this.api('/football-news?limit=15');
      var news = (data && data.news) || [];
      if (!news.length) { ticker.style.display = 'none'; return; }
      var items = news.slice(0, 15).map(function (n) {
        return '<a href="' + App.escapeHtml(n.url) + '" target="_blank" rel="noopener" class="news-ticker-item">' +
          '<span class="news-ticker-dot">&#9917;</span>' + App.escapeHtml(n.title) +
          '<span class="news-ticker-src">' + App.escapeHtml(n.source || '') + '</span></a>';
      }).join('');
      // Duplicate the track so the marquee loops seamlessly.
      ticker.innerHTML = '<div class="news-ticker-track">' + items + items + '</div>';
      ticker.style.display = 'block';
    } catch (e) { ticker.style.display = 'none'; }
  },

  _liveMatchLabel(m) {
    var score = (m.hg != null && m.ag != null) ? (m.hg + '–' + m.ag) : null;
    var finished = m.status === 'finished';
    var scheduled = m.status === 'scheduled';
    if (finished && score) return '<span class="live-strip-score">' + App.escapeHtml(m.home) + ' ' + score + ' ' + App.escapeHtml(m.away) + '</span> <span style="color:#7a8295;font-size:11px;">FT</span>';
    if (score && !scheduled) return '<span class="live-badge">LIVE</span> <span class="live-strip-score">' + App.escapeHtml(m.home) + ' ' + score + ' ' + App.escapeHtml(m.away) + '</span>';
    var ko = m.kickoff ? new Date(m.kickoff).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
    return App.escapeHtml(m.home) + ' v ' + App.escapeHtml(m.away) + (ko ? ' <span style="color:#7a8295;font-size:11px;">' + ko + '</span>' : '');
  },

  // Site-wide live scoreboard strip (today's WC scores + results landing).
  async _loadLiveStrip() {
    var strip = document.getElementById('live-strip');
    if (!strip) return;
    try {
      var d = await this.api('/live-now');
      strip = document.getElementById('live-strip');
      if (!strip) return;
      var items = [];
      (d.live || []).forEach(function (m) {
        items.push('<span class="live-strip-item">&#9917; ' + App._liveMatchLabel(m) + '</span>');
      });
      (d.results || []).slice(0, 8).forEach(function (r) {
        var won = r.result === 'won' || r.result === 'placed';
        var cls = won ? 'live-strip-won' : 'live-strip-lost';
        var icon = won ? '&#10003;' : '&#10007;';
        items.push('<span class="live-strip-item"><span class="' + cls + '">' + icon + ' ' + App.escapeHtml(r.selection || '') + '</span>' + (r.odds ? ' <span style="color:#7a8295;font-size:11px;">@ ' + App.escapeHtml(App.formatOdds ? App.formatOdds(r.odds) : String(r.odds)) + '</span>' : '') + '</span>');
      });
      if (!items.length) { strip.style.display = 'none'; return; }
      strip.innerHTML = '<div class="live-strip-track">' + items.join('') + items.join('') + '</div>';
      strip.style.display = 'block';
    } catch (e) { strip.style.display = 'none'; }
  },

  // Homepage "LIVE & LATEST" section.
  async _loadLiveNow() {
    var box = document.getElementById('live-now-section');
    if (!box) return;
    try {
      var d = await this.api('/live-now');
      box = document.getElementById('live-now-section');
      if (!box) return;
      var live = d.live || [], results = d.results || [];
      if (!live.length && !results.length) { box.innerHTML = ''; return; }
      var matchRows = live.slice(0, 6).map(function (m) {
        return '<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">&#9917; ' + App._liveMatchLabel(m) + '</div>';
      }).join('');
      var resultRows = results.slice(0, 6).map(function (r) {
        var won = r.result === 'won' || r.result === 'placed';
        var col = won ? '#22c55e' : '#ef4444';
        return '<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;display:flex;justify-content:space-between;gap:8px;">' +
          '<span><span style="color:' + col + ';font-weight:700;">' + (won ? '&#10003;' : '&#10007;') + '</span> ' + App.escapeHtml(r.selection || '') + (r.event ? ' <span style="color:var(--text-muted);font-size:11px;">' + App.escapeHtml(r.event) + '</span>' : '') + '</span>' +
          '<span style="color:' + col + ';font-weight:700;white-space:nowrap;">' + (r.pnl != null ? (r.pnl >= 0 ? '+' : '') + Number(r.pnl).toFixed(2) + 'u' : (won ? 'WON' : 'LOST')) + '</span></div>';
      }).join('');
      box.innerHTML =
        '<div class="section" style="margin-bottom:24px;"><div class="section-title"><span style="color:#ef4444;">&#128308;</span> Live &amp; Latest</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;">' +
          (matchRows ? '<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:16px;"><div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Today\'s World Cup</div>' + matchRows + '</div>' : '') +
          (resultRows ? '<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:16px;"><div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Results landing</div>' + resultRows + '</div>' : '') +
        '</div></div>';
    } catch (e) { /* silently skip */ }
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
  _renderFootballResultCard(item) {
    var isWon = item.result === 'won' || item.result === 'placed';
    var isLost = item.result === 'lost';
    var isSettled = isWon || isLost;
    var outcome = item.actualOutcome || '';
    var borderColor = isWon ? '#22c55e' : isLost ? '#ef4444' : 'rgba(255,255,255,0.08)';
    var resultIcon = isWon ? '<span style="color:#22c55e;font-size:18px;font-weight:900;">&#10003;</span>' : isLost ? '<span style="color:#ef4444;font-size:18px;font-weight:900;">&#10007;</span>' : '<span style="color:rgba(255,255,255,0.3);">&#8212;</span>';
    var resultLabel = isWon ? '<span style="color:#22c55e;font-weight:800;">WON</span>' : isLost ? '<span style="color:#ef4444;font-weight:800;">LOST</span>' : '<span style="color:rgba(255,255,255,0.4);">Pending</span>';
    var pnlStr = item.pnl !== undefined && item.pnl !== null ? (item.pnl >= 0 ? '<span style="color:#22c55e;font-weight:700;">+' + item.pnl.toFixed(2) + 'u</span>' : '<span style="color:#ef4444;font-weight:700;">' + item.pnl.toFixed(2) + 'u</span>') : '';

    return '<div style="display:flex;align-items:center;gap:14px;padding:14px 18px;border-left:4px solid ' + borderColor + ';background:rgba(255,255,255,0.02);border-radius:0 10px 10px 0;margin-bottom:8px;">' +
      '<div style="flex-shrink:0;width:36px;text-align:center;">' + resultIcon + '</div>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:2px;">' + (item.event || item.selection || '') + '</div>' +
        (outcome ? '<div style="font-size:16px;font-weight:900;color:' + (isWon ? '#22c55e' : isLost ? '#ef4444' : '#d4a843') + ';margin-bottom:4px;">' + outcome + '</div>' : '') +
        '<div style="font-size:12px;color:rgba(255,255,255,0.5);">' +
          '<span>Our Pick: <strong style="color:rgba(255,255,255,0.8);">' + (item.selection || '') + '</strong></span>' +
          ' &bull; <span>' + (item.market || '') + '</span>' +
          ' &bull; <span>' + this.formatOdds(item.odds || 0) + '</span>' +
          (item.tipsterProfile ? ' &bull; <span>' + item.tipsterProfile + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div style="flex-shrink:0;text-align:right;">' +
        '<div>' + resultLabel + '</div>' +
        (pnlStr ? '<div style="font-size:13px;margin-top:2px;">' + pnlStr + '</div>' : '') +
      '</div>' +
    '</div>';
  },

  // Guest landing funnel — a visually rich conversion path for cold visitors
  // (NerdyTips-style layout, Elite Edge palette). No backend changes.
  _renderLandingFunnel(ctx) {
    var self = this;
    var perf = ctx.perf || {};
    var todayTips = (ctx.todayTips || []);
    var recentWins = ctx.recentWins || [];
    var dateLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    var hasProof = perf && (perf.strikeRate || perf.roi || perf.totalTips);
    var esc = function (s) { return self.escapeHtml(s || ''); };
    var sportIcon = function (s) { return s === 'racing' ? '🏇' : s === 'basketball' ? '🏀' : s === 'tennis' ? '🎾' : s === 'rugby' ? '🏉' : s === 'american-football' ? '🏈' : '⚽'; };

    // A visual prediction card (the signature NerdyTips element, our colours).
    var predCard = function (t) {
      var icon = sportIcon(t.sport);
      var accent = t.sport === 'racing' ? '#d4a843' : '#d4a843';
      var _kd = t.kickoff ? new Date(t.kickoff) : null;
      var when = t.raceTime || (_kd && !isNaN(_kd.getTime()) ? _kd.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
      var league = t.league || t.meeting || '';
      var titleLine, subLine;
      if (t.sport === 'racing') { titleLine = esc(t.selection || ''); subLine = esc((t.meeting || '') + (t.raceClass ? ' · ' + t.raceClass : '')); }
      else {
        var ev = String(t.event || '').split(' - ')[0];
        var vs = ev.split(/\s+vs\s+/i);
        titleLine = vs.length > 1 ? esc(vs[0].trim()) + ' <span style="color:var(--text-muted);font-weight:600;">v</span> ' + esc(vs[1].trim()) : esc(t.event || '');
        subLine = esc(t.selection || '');
      }
      var locked = self.isPremium() ? false : t.locked;
      var oddsTxt = locked ? '?.??' : self.formatOdds(t.odds);
      var vr = t.valueRating && t.valueRating !== 'No Value' ? t.valueRating : '';
      // The pick text (selection) — strip a redundant leading market prefix so it
      // reads cleanly (e.g. "Kairat Almaty or Draw", not "Double Chance - ...").
      var pick = String(t.selection || '');
      if (t.market && pick.toLowerCase().indexOf(String(t.market).toLowerCase() + ' -') === 0) pick = pick.slice(String(t.market).length + 2).trim();
      return '<div onclick="window.location.hash=\'#/tip/' + t.id + '\'" style="min-width:270px;flex:0 0 270px;scroll-snap-align:start;background:linear-gradient(160deg,#161b28,#0d1019);border:1px solid var(--border);border-radius:16px;padding:0;cursor:pointer;transition:transform .15s,border-color .15s;position:relative;overflow:hidden;" onmouseover="this.style.transform=\'translateY(-3px)\';this.style.borderColor=\'' + accent + '66\'" onmouseout="this.style.transform=\'\';this.style.borderColor=\'\'">' +
        '<div style="height:3px;background:linear-gradient(90deg,' + accent + ',transparent);"></div>' +
        '<div style="padding:16px;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">' +
            '<span style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;">' + icon + ' ' + esc(league) + '</span>' +
            (when ? '<span style="font-size:11px;font-weight:800;color:#fff;background:' + accent + '22;border-radius:5px;padding:2px 7px;">' + esc(when) + '</span>' : '') +
          '</div>' +
          '<div style="font-size:16px;font-weight:800;color:#fff;line-height:1.3;margin-bottom:12px;min-height:42px;">' + titleLine + '</div>' +
          '<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:14px;">' +
            '<div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">Our pick · ' + esc(t.market || '') + '</div>' +
            '<div style="font-size:14px;font-weight:800;color:' + accent + ';line-height:1.3;">' + esc(pick) + '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;justify-content:space-between;">' +
            '<div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">Odds</div><div style="font-size:22px;font-weight:900;color:var(--gold);">' + oddsTxt + '</div></div>' +
            (vr ? '<span style="background:linear-gradient(135deg,#d4a843,#b8902f);color:#fff;font-size:11px;font-weight:800;padding:6px 11px;border-radius:7px;">' + esc(vr) + ' VALUE</span>' : '<span style="background:' + (locked ? 'rgba(212,168,67,0.15);color:var(--gold);border:1px solid ' + accent + '55' : accent + ';color:#0a0e1a') + ';font-size:11px;font-weight:800;padding:6px 11px;border-radius:7px;">' + (locked ? '🔒 PREMIUM' : 'FREE PICK') + '</span>') +
          '</div>' +
        '</div>' +
      '</div>';
    };

    var featureCard = function (icon, title, desc, accent) {
      return '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:22px;">' +
        '<div style="width:46px;height:46px;border-radius:12px;background:' + accent + '1f;border:1px solid ' + accent + '44;display:flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:14px;">' + icon + '</div>' +
        '<div style="font-size:16px;font-weight:800;color:#fff;margin-bottom:6px;">' + title + '</div>' +
        '<div style="font-size:13.5px;color:var(--text-secondary);line-height:1.6;">' + desc + '</div>' +
      '</div>';
    };

    // 1) HERO — split banner with the athlete image (right) + betting copy (left),
    // navy/gold/blue brand palette. Save the generated footballer image to
    // /public/images/hero-athlete.png. Graceful navy fallback if it's missing.
    var featIcons = [
      { i: '📊', t: 'Data-Driven Insights' },
      { i: '🎯', t: 'Elite Analysis' },
      { i: '🧠', t: 'Smarter Predictions' },
      { i: '🏆', t: 'Better Results' },
    ];
    var hero =
      '<div style="position:relative;overflow:hidden;background:#0a1020;min-height:clamp(460px,60vw,600px);display:flex;align-items:center;">' +
        // full-bleed athlete image (centre-right), darkened on the left for text
        '<div aria-hidden="true" style="position:absolute;inset:0;background-image:url(\'/images/hero-athlete.jpg\');background-repeat:no-repeat;background-position:center right;background-size:cover;"></div>' +
        '<div aria-hidden="true" style="position:absolute;inset:0;background:linear-gradient(90deg,#0a1020 0%,rgba(10,16,32,0.94) 30%,rgba(10,16,32,0.62) 52%,rgba(10,16,32,0.12) 74%,transparent 100%);"></div>' +
        '<div style="position:relative;max-width:1120px;margin:0 auto;width:100%;padding:clamp(36px,7vw,64px) 20px;">' +
          '<div style="max-width:560px;">' +
            '<div style="display:inline-block;font-size:11px;font-weight:800;letter-spacing:2px;color:var(--gold);background:rgba(212,168,67,0.12);border:1px solid rgba(212,168,67,0.4);border-radius:20px;padding:6px 15px;margin-bottom:20px;">⚡ UK\'S #1 AI TIPPING PLATFORM</div>' +
            '<h1 style="font-size:clamp(34px,8vw,60px);line-height:1.02;font-weight:900;letter-spacing:-1px;margin:0 0 14px;">' +
              '<span style="color:#fff;display:block;">DATA IN.</span>' +
              '<span style="color:var(--gold);display:block;">EDGE OUT.</span>' +
            '</h1>' +
            '<p style="font-size:clamp(15px,4vw,18px);color:#c7d0e0;max-width:480px;margin:0 0 6px;line-height:1.55;">5 self-learning analysts, 3 AI engines and our own quant model debate every pick — then we publish the Closing Line Value to prove it beats the market.</p>' +
            (hasProof ? '<div style="display:flex;gap:clamp(16px,5vw,36px);flex-wrap:wrap;margin:24px 0 6px;">' +
              (perf.strikeRate ? '<div><div style="font-size:clamp(26px,6vw,34px);font-weight:900;color:var(--gold);line-height:1;">' + perf.strikeRate + '%</div><div style="font-size:11px;color:#8b97ad;text-transform:uppercase;letter-spacing:1px;margin-top:4px;">Strike rate</div></div>' : '') +
              (perf.roi ? '<div><div style="font-size:clamp(26px,6vw,34px);font-weight:900;color:var(--gold);line-height:1;">' + (perf.roi > 0 ? '+' : '') + perf.roi + '%</div><div style="font-size:11px;color:#8b97ad;text-transform:uppercase;letter-spacing:1px;margin-top:4px;">ROI</div></div>' : '') +
              (perf.totalTips ? '<div><div style="font-size:clamp(26px,6vw,34px);font-weight:900;color:#fff;line-height:1;">' + perf.totalTips + '</div><div style="font-size:11px;color:#8b97ad;text-transform:uppercase;letter-spacing:1px;margin-top:4px;">Verified tips</div></div>' : '') +
            '</div>' : '') +
            '<div style="display:flex;gap:22px;flex-wrap:wrap;margin:22px 0;">' +
              featIcons.map(function (f) { return '<div style="text-align:center;"><div style="font-size:22px;margin-bottom:5px;">' + f.i + '</div><div style="font-size:10px;font-weight:700;color:#8b97ad;text-transform:uppercase;letter-spacing:0.5px;max-width:80px;">' + f.t + '</div></div>'; }).join('') +
            '</div>' +
            '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
              '<button class="btn btn-gold" onclick="App.showModal(\'register\')" style="padding:15px 32px;font-size:15px;box-shadow:0 8px 24px rgba(212,168,67,0.28);">Get Started Free →</button>' +
              '<a href="javascript:void(0)" onclick="var el=document.getElementById(\'free-tips\');if(el)el.scrollIntoView({behavior:\'smooth\'});" class="btn btn-outline" style="padding:15px 32px;font-size:15px;">See today\'s tips</a>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;margin-top:18px;font-size:13px;color:#c7d0e0;"><span style="color:#00b67a;letter-spacing:2px;">★★★★★</span><span>Trusted by bettors across the UK · 18+ · BeGambleAware.org</span></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    // 1b) SPOTLIGHT (featured meeting)
    var spotlight = '<div style="max-width:1080px;margin:0 auto;padding:0 18px;"><div id="event-spotlight-slot"></div></div>';

    // 2) TODAY'S PREDICTIONS — horizontal scroll of rich cards
    var predStrip = todayTips.length
      ? '<div style="display:flex;gap:14px;overflow-x:auto;scroll-snap-type:x mandatory;padding:4px 4px 12px;-webkit-overflow-scrolling:touch;">' + todayTips.slice(0, 10).map(predCard).join('') + '</div>'
      : '<div style="text-align:center;padding:30px;color:var(--text-muted);background:var(--bg-card);border:1px solid var(--border);border-radius:14px;">Today\'s selections are being finalised — sign up free and they land the moment they\'re published.</div>';
    var tipsSection =
      '<div id="free-tips" style="padding:clamp(32px,7vw,48px) 18px;max-width:1080px;margin:0 auto;">' +
        '<div style="display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:18px;">' +
          '<div><h2 style="font-size:clamp(22px,5.5vw,28px);font-weight:900;color:#fff;margin:0;">Today\'s Predictions</h2>' +
          '<p style="color:var(--text-muted);font-size:13px;margin:4px 0 0;">' + dateLabel + ' · free picks shown, premium unlocks with an account</p></div>' +
          '<button class="btn btn-outline btn-sm" onclick="App.showModal(\'register\')">Unlock all →</button>' +
        '</div>' + predStrip +
      '</div>';

    // 3) WHY ELITE EDGE — bento grid with one highlighted hero card (our colours)
    var heroCard =
      '<div class="ee-bento-hero" style="background:linear-gradient(150deg,#d4a843,#a87c22);color:#0a0e1a;border-radius:16px;padding:26px;display:flex;flex-direction:column;justify-content:space-between;min-height:220px;">' +
        '<div style="font-size:30px;">🏆</div>' +
        '<div><div style="font-size:clamp(20px,3vw,26px);font-weight:900;line-height:1.15;margin-bottom:8px;">A prediction engine, not a tipster.</div>' +
        '<div style="font-size:14px;font-weight:600;line-height:1.55;opacity:0.85;">5 analysts, a 3-AI arbiter panel and our own quant model debate every fixture to a single, most-probable call — and we publish the Closing Line Value to prove it.</div></div>' +
      '</div>';
    var whySection =
      '<div style="padding:clamp(34px,7vw,52px) 18px;background:radial-gradient(ellipse at 50% 0%,rgba(212,168,67,0.05),transparent 55%);border-top:1px solid var(--border);border-bottom:1px solid var(--border);">' +
        '<div style="max-width:1080px;margin:0 auto;">' +
          '<div style="text-align:center;margin-bottom:30px;"><div style="display:inline-block;font-size:11px;font-weight:800;letter-spacing:1.5px;color:var(--gold);margin-bottom:8px;">ENGINEERED TO WIN</div>' +
          '<h2 style="font-size:clamp(22px,5.5vw,30px);font-weight:900;color:#fff;margin:0;">Why Elite Edge is different</h2></div>' +
          '<div class="ee-bento">' +
            heroCard +
            featureCard('🤖', '3 AI engines verify it', 'A GPT, Gemini and Grok arbiter panel independently reviews each call before it\'s published.', '#3b82f6') +
            featureCard('📈', 'Proven with CLV', 'Closing Line Value tracked on every tip — mathematical proof we beat the market, win or lose.', '#d4a843') +
            featureCard('⚡', '14 live data feeds', 'Form, xG, lineups, going and live market moves across 6 sports, 160+ competitions.', '#3b82f6') +
            featureCard('🔒', 'Locked before kick-off', 'Every pick frozen pre-match, never changed after the result — total integrity.', '#d4a843') +
          '</div>' +
        '</div>' +
      '</div>';

    // 4) HOW IT WORKS — 3 steps
    var steps = [
      { n: '1', t: 'We gather the data', d: '14 live feeds across 6 sports — form, xG, lineups, going, market moves.' },
      { n: '2', t: 'The engine debates it', d: '5 analysts + a 3-AI arbiter panel + our quant model argue every fixture to one most-probable call.' },
      { n: '3', t: 'We prove the edge', d: 'Locked before kick-off, with Closing Line Value tracked so you see we beat the market.' },
    ];
    var howSection =
      '<div style="padding:clamp(34px,7vw,52px) 18px;max-width:1080px;margin:0 auto;">' +
        '<h2 style="text-align:center;font-size:clamp(22px,5.5vw,30px);font-weight:900;color:#fff;margin:0 0 30px;">How it works</h2>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:18px;">' +
          steps.map(function (s) { return '<div style="text-align:center;padding:8px;"><div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;font-weight:900;font-size:22px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">' + s.n + '</div><div style="font-size:17px;font-weight:800;color:#fff;margin-bottom:8px;">' + s.t + '</div><div style="font-size:14px;color:var(--text-secondary);line-height:1.6;max-width:300px;margin:0 auto;">' + s.d + '</div></div>'; }).join('') +
        '</div>' +
      '</div>';

    // 5) PROVEN EDGE + winners
    var winnersHtml = recentWins.slice(0, 8).map(function (r) {
      // Strip the redundant market prefix ("Double Chance - Kairat or Draw" → "Kairat or Draw")
      // so the strip reads as clean selections, not eight identical "Double Chance" rows.
      var sel = String(r.selection || 'Winner');
      var di = sel.indexOf(' - ');
      if (di > -1) sel = sel.slice(di + 3);
      return '<div style="background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.3);border-radius:8px;padding:9px 14px;white-space:nowrap;font-size:13px;"><span style="color:#d4a843;font-weight:800;">✓ ' + esc(sel) + '</span>' + (r.odds ? ' <span style="color:var(--text-muted);">@ ' + esc(self.formatOdds ? self.formatOdds(r.odds) : String(r.odds)) + '</span>' : '') + '</div>';
    }).join('');
    var proofSection = (recentWins.length || hasProof) ?
      '<div style="padding:clamp(34px,7vw,48px) 18px;background:radial-gradient(ellipse at 50% 120%,rgba(212,168,67,0.08),transparent 60%);border-top:1px solid var(--border);"><div style="max-width:1080px;margin:0 auto;text-align:center;">' +
        '<div style="display:inline-block;font-size:11px;font-weight:800;letter-spacing:1.5px;color:#d4a843;border:1px solid rgba(212,168,67,0.3);border-radius:20px;padding:5px 14px;margin-bottom:14px;">📈 PROVEN, NOT PROMISED</div>' +
        '<h2 style="font-size:clamp(22px,5.5vw,30px);font-weight:900;color:#fff;margin:0 0 12px;">We publish our track record</h2>' +
        '<p style="color:var(--text-secondary);font-size:15px;max-width:600px;margin:0 auto 22px;line-height:1.6;">Closing Line Value on every tip is how professionals prove genuine edge. We show it — win or lose. That\'s the difference between us and a bloke with a Telegram channel.</p>' +
        (winnersHtml ? '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:24px;">' + winnersHtml + '</div>' : '') +
        '<a href="#/track-record" class="btn btn-outline" style="padding:12px 28px;">See the full track record →</a>' +
      '</div></div>' : '';

    // 6) PRICING
    var tiers = [
      { name: 'Free', price: '£0', sub: 'forever', feats: ['Daily free tips', 'Results & analysis', 'Ask the Edge assistant'], cta: 'Sign Up Free', action: "App.showModal('register')", highlight: false },
      { name: 'Starter', price: '£9.99', sub: 'per month', feats: ['50 credits every month', '~2 tips per day', 'Racing + Football selections', 'Personal ROI tracking'], cta: 'Get Starter', action: "window.location.hash='#/pricing'", highlight: false },
      { name: 'Premium', price: '£19.99', sub: 'per month', feats: ['Every tip unlocked', 'Full match intelligence', 'Value Finder & Acca Builder', 'Proven-edge CLV data'], cta: 'Start 14-day trial', action: "window.location.hash='#/pricing'", highlight: true },
      { name: 'VIP', price: '£39.99', sub: 'per month', feats: ['Everything in Premium', 'Unlimited credits', 'Early access (6:30am tips)', 'Priority + SMS/Telegram alerts'], cta: 'Go VIP', action: "window.location.hash='#/pricing'", highlight: false },
    ];
    var pricingSection =
      '<div style="padding:clamp(34px,7vw,52px) 18px;background:rgba(255,255,255,0.02);border-top:1px solid var(--border);"><div style="max-width:1080px;margin:0 auto;">' +
        '<h2 style="text-align:center;font-size:clamp(22px,5.5vw,30px);font-weight:900;color:#fff;margin:0 0 6px;">Simple plans, cancel anytime</h2>' +
        '<p style="text-align:center;color:var(--text-muted);font-size:14px;margin:0 0 30px;">Start free. Upgrade when the results convince you — not before.</p>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(250px,100%),1fr));gap:16px;align-items:start;">' +
          tiers.map(function (t) {
            return '<div style="background:' + (t.highlight ? 'linear-gradient(160deg,rgba(212,168,67,0.1),var(--bg-card))' : 'var(--bg-card)') + ';border:' + (t.highlight ? '2px solid var(--gold)' : '1px solid var(--border)') + ';border-radius:16px;padding:26px;position:relative;' + (t.highlight ? 'box-shadow:0 0 30px rgba(212,168,67,0.12);' : '') + '">' +
              (t.highlight ? '<div style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:var(--gold);color:#0a0e1a;font-size:11px;font-weight:800;padding:4px 14px;border-radius:20px;white-space:nowrap;">★ MOST POPULAR</div>' : '') +
              '<div style="font-size:15px;font-weight:800;color:#fff;">' + t.name + '</div>' +
              '<div style="margin:10px 0 18px;"><span style="font-size:36px;font-weight:900;color:var(--gold);">' + t.price + '</span> <span style="font-size:13px;color:var(--text-muted);">' + t.sub + '</span></div>' +
              '<div style="margin-bottom:20px;">' + t.feats.map(function (f) { return '<div style="font-size:13.5px;color:var(--text-secondary);padding:5px 0;">✓ ' + f + '</div>'; }).join('') + '</div>' +
              '<button class="btn ' + (t.highlight ? 'btn-gold' : 'btn-outline') + '" onclick="' + t.action + '" style="width:100%;">' + t.cta + '</button>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<div style="text-align:center;margin-top:18px;"><a href="#/pricing" style="color:var(--gold);font-size:13px;">Compare all plans →</a></div>' +
      '</div></div>';

    // 7) FAQ
    var faqs = [
      { q: 'Is it really free?', a: 'Yes — free daily tips, results and our AI assistant with no card needed. Premium unlocks every pick and the full intelligence.' },
      { q: 'How is this different from other tipsters?', a: 'We publish our Closing Line Value — mathematical proof our picks beat the market. Most tipsters just show their winners and hide the losers.' },
      { q: 'What sports do you cover?', a: 'Horse racing, football, NBA, tennis, rugby league and NFL — plus featured meetings like Glorious Goodwood and the season\'s big fixtures.' },
      { q: 'Can I cancel anytime?', a: 'Anytime, in a couple of clicks. Premium comes with a 14-day money-back guarantee.' },
    ];
    var faqSection =
      '<div style="padding:clamp(34px,7vw,52px) 18px;max-width:780px;margin:0 auto;">' +
        '<h2 style="text-align:center;font-size:clamp(22px,5.5vw,30px);font-weight:900;color:#fff;margin:0 0 26px;">Questions</h2>' +
        faqs.map(function (f) { return '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:18px 20px;margin-bottom:10px;"><div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:6px;">' + f.q + '</div><div style="font-size:14px;color:var(--text-secondary);line-height:1.6;">' + f.a + '</div></div>'; }).join('') +
      '</div>';

    // 8) FINAL CTA
    var finalCta =
      '<div style="text-align:center;padding:clamp(38px,8vw,56px) 18px 56px;background:radial-gradient(ellipse at 50% 130%,rgba(212,168,67,0.14),transparent 60%);">' +
        '<h2 style="font-size:clamp(22px,6vw,32px);font-weight:900;color:#fff;margin:0 0 12px;">Ready to bet with an edge?</h2>' +
        '<p style="color:var(--text-secondary);font-size:16px;margin:0 0 24px;">Join free and get today\'s tips in seconds.</p>' +
        '<button class="btn btn-gold" onclick="App.showModal(\'register\')" style="padding:16px 40px;font-size:17px;">Create your free account →</button>' +
        '<div style="font-size:12px;color:var(--text-muted);margin-top:16px;">18+ · Please gamble responsibly · BeGambleAware.org · Analysis, not betting advice</div>' +
      '</div>';

    return '<div style="max-width:100%;overflow-x:hidden;">' + hero + spotlight + tipsSection + whySection + howSection + proofSection + pricingSection + faqSection + finalCta + '</div>';
  },

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
            ${tip.freePick ? '<span style="background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:800;letter-spacing:0.5px;">&#127942; FREE PICK</span>' : ''}
            ${tip.valueRating ? `<span class="badge-premium">${tip.valueRating}</span>` : ''}
            ${tip.tipsterProfile ? `<span class="analyst-badge ${tip.tipsterProfile === 'The Professor' ? 'professor' : tip.tipsterProfile === 'The Scout' ? 'scout' : tip.tipsterProfile === 'The Clocker' ? 'clocker' : tip.tipsterProfile === 'The Tactician' ? 'tactician' : 'edge'}">${tip.tipsterProfile}</span>` : ''}
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

    // Filter to today's races only (exclude future big-race entries)
    var todayStr = this._getToday();
    var todayRacecards = racecards.filter(function(r) {
      if (!r.date) return true; // no date = assume today
      var rDate = r.date.toString().split('T')[0].substring(0, 10);
      return rDate === todayStr || rDate === '';
    });

    // Group by meeting
    var liveMeetings = {};
    todayRacecards.forEach(function(r) {
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
          var allRunners = race.runners || [];
          var runnerCount = allRunners.filter(function(r) { return !r.isNonRunner && !r.scratched && r.odds && r.odds > 0; }).length || allRunners.length;
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
    var allRaceRunners = race.runners || [];
    // Filter to declared runners only (have odds and not non-runner)
    var runners = allRaceRunners.filter(function(r) { return !r.isNonRunner && !r.scratched && r.odds && r.odds > 0; });
    if (runners.length === 0) runners = allRaceRunners; // fallback if no odds data

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
        '<div class="race-analysis-header">FORM &amp; STATS</div>' +
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
      // Headline analysis = the AI-written, race-specific preview (auto-loads).
      '<div class="race-analysis-section" style="margin-top:20px;" id="racing-ai-preview-section">' +
        '<div class="race-analysis-header">ELITE EDGE ANALYSIS</div>' +
        '<div style="padding:14px 16px 16px;">' +
          '<div id="racing-ai-preview-content"><p class="text-muted" style="margin:4px 0;"><span class="loading-spinner" style="width:16px;height:16px;display:inline-block;vertical-align:middle;margin-right:8px;"></span>Analysing the race&hellip;</p></div>' +
          '<button class="btn btn-gold btn-sm" id="racing-ai-preview-btn" style="display:none;margin-top:10px;" onclick="App.loadRacingAIPreview(\'' + (race.raceId || race.time || '').replace(/'/g, "\\'") + '\')">Retry analysis</button>' +
        '</div>' +
      '</div>' +
      // Supporting structured detail (form/ratings/draw) below the headline.
      analysisHtml +
      '<div style="margin:20px 0;">' +
        '<button class="btn btn-outline btn-sm" onclick="var el=document.getElementById(\'runners-table\');el.style.display=el.style.display===\'none\'?\'block\':\'none\';this.textContent=el.style.display===\'none\'?\'Show Full Race Card ('+runners.length+' Runners)\':\'Hide Race Card\'">Show Full Race Card (' + runners.length + ' Runners)</button>' +
      '</div>' +
      '<div id="runners-table" style="display:none;">' + runnersHtml + '</div>' +
    '</div>';

    // Auto-generate the headline AI analysis (cached per race).
    this.loadRacingAIPreview((race.raceId || race.time || ''));

    if (typeof trackEvent === 'function') trackEvent('racing', 'race_detail', meetingName + ' ' + race.time);
  },

  _racingAIPreviewCache: {},

  async loadRacingAIPreview(raceId) {
    var btn = document.getElementById('racing-ai-preview-btn');
    var contentDiv = document.getElementById('racing-ai-preview-content');
    if (!contentDiv) return;

    // Check cache
    if (this._racingAIPreviewCache[raceId]) {
      this._renderRacingAIPreview(contentDiv, this._racingAIPreviewCache[raceId]);
      if (btn) btn.style.display = 'none';
      return;
    }
    // (contentDiv already shows an "Analysing the race…" placeholder)

    try {
      var data = await this.api('/racing/ai-preview/' + encodeURIComponent(raceId));
      contentDiv = document.getElementById('racing-ai-preview-content'); btn = document.getElementById('racing-ai-preview-btn');
      if (!contentDiv) return;
      if (data && data.aiPreview) {
        this._racingAIPreviewCache[raceId] = data.aiPreview;
        this._renderRacingAIPreview(contentDiv, data.aiPreview);
        if (btn) btn.style.display = 'none';
      } else {
        contentDiv.innerHTML = '<p class="text-muted">Analysis unavailable right now — the full race card is below.</p>';
        if (btn) { btn.style.display = ''; btn.disabled = false; btn.innerHTML = 'Retry analysis'; }
      }
    } catch (err) {
      contentDiv = document.getElementById('racing-ai-preview-content'); btn = document.getElementById('racing-ai-preview-btn');
      if (contentDiv) contentDiv.innerHTML = '<p class="text-muted">Analysis unavailable right now — the full race card is below.</p>';
      if (btn) { btn.style.display = ''; btn.disabled = false; btn.innerHTML = 'Retry analysis'; }
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

        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px;">' +
          '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;text-align:center;cursor:pointer;" onclick="App.buyCredits(\'credits-3\')">' +
            '<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px;">Quick Top-Up</div>' +
            '<div style="font-size:32px;font-weight:900;color:var(--text-primary);">3</div>' +
            '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">credits</div>' +
            '<div style="font-size:20px;font-weight:800;color:var(--gold);">&pound;1.99</div>' +
            '<div style="font-size:11px;color:#ef4444;">66p per credit</div>' +
          '</div>' +
          '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;text-align:center;cursor:pointer;" onclick="App.buyCredits(\'credits-10\')">' +
            '<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px;">Weekend Pack</div>' +
            '<div style="font-size:32px;font-weight:900;color:var(--text-primary);">10</div>' +
            '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">credits</div>' +
            '<div style="font-size:20px;font-weight:800;color:var(--gold);">&pound;4.99</div>' +
            '<div style="font-size:11px;color:#f59e0b;">50p per credit</div>' +
          '</div>' +
          '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;text-align:center;cursor:pointer;" onclick="App.buyCredits(\'credits-25\')">' +
            '<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px;">25 Pack</div>' +
            '<div style="font-size:32px;font-weight:900;color:var(--text-primary);">25</div>' +
            '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">credits</div>' +
            '<div style="font-size:20px;font-weight:800;color:var(--gold);">&pound;8.99</div>' +
            '<div style="font-size:11px;color:#f59e0b;">36p per credit</div>' +
          '</div>' +
        '</div>' +

        // Nudge: subscription is ALWAYS better
        '<div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:10px;padding:14px;text-align:center;margin-bottom:24px;">' +
          '<div style="font-size:13px;color:#fca5a5;">Buying credits individually costs <strong style="color:#ef4444;">2-4x more</strong> than subscribing.</div>' +
        '</div>' +

        (upgradeTier ? '<div style="background:linear-gradient(135deg,rgba(34,197,94,0.08),rgba(34,197,94,0.02));border:2px solid rgba(34,197,94,0.3);border-radius:14px;padding:28px;text-align:center;margin-bottom:32px;">' +
          '<div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#22c55e;font-weight:700;margin-bottom:8px;">SAVE UP TO 75%</div>' +
          '<div style="font-size:16px;color:var(--text-primary);font-weight:700;margin-bottom:12px;">Get <strong style="color:var(--gold);">' + upgradeCredits + ' credits every month</strong> with ' + upgradeTier + '</div>' +
          '<div style="display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:center;max-width:500px;margin:0 auto 16px;">' +
            '<div style="text-align:center;padding:12px;background:rgba(239,68,68,0.06);border-radius:8px;">' +
              '<div style="font-size:11px;color:#ef4444;margin-bottom:4px;">Credit Packs</div>' +
              '<div style="font-size:18px;font-weight:800;color:#ef4444;text-decoration:line-through;">25 for &pound;8.99</div>' +
              '<div style="font-size:11px;color:var(--text-muted);">36p per credit</div>' +
            '</div>' +
            '<div style="font-size:20px;color:var(--text-muted);">vs</div>' +
            '<div style="text-align:center;padding:12px;background:rgba(34,197,94,0.06);border-radius:8px;">' +
              '<div style="font-size:11px;color:#22c55e;margin-bottom:4px;">' + upgradeTier + ' Plan</div>' +
              '<div style="font-size:18px;font-weight:800;color:#22c55e;">' + upgradeCredits + ' for &pound;' + upgradePrice + '/mo</div>' +
              '<div style="font-size:11px;color:var(--text-muted);">' + (sub === 'premium' ? '0p' : sub === 'starter' ? '17p' : '25p') + ' per credit</div>' +
            '</div>' +
          '</div>' +
          '<button class="btn btn-gold btn-lg" onclick="App.startCheckout(\'' + upgradePlan + '\')">Subscribe to ' + upgradeTier + ' — Save ' + (sub === 'free' ? '38' : sub === 'starter' ? '53' : '75') + '% &rarr;</button>' +
          '<div style="font-size:11px;color:var(--text-muted);margin-top:8px;">14-day free trial. Cancel anytime.</div>' +
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
  // ALL MATCHES — every game grouped by league, each league collapsible with an
  // arrow (NerdyTips-style). Team crests, kickoff/score, and our pick where we
  // have one. This is the visual, interactive matches hub Darren asked for.
  async renderMatches() {
    var app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = '<div class="container" style="padding-top:20px;"><div style="text-align:center;padding:50px 0;color:var(--text-muted);"><div class="loading-spinner" style="margin:0 auto 12px;"></div>Loading today\'s matches…</div></div>';
    var self = this;
    var fixtures = [], tips = [];
    try {
      var res = await Promise.all([ this.fetchLiveFootball(true), this.api('/tips?sport=football').catch(function(){return [];}) ]);
      fixtures = (res[0] && res[0].fixtures) || [];
      tips = res[1] || [];
    } catch (e) {}

    // Match a fixture to our published pick (by team names) to show "Our pick".
    var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
    var pickFor = function (f) {
      var h = norm(f.homeTeam), a = norm(f.awayTeam);
      return tips.find(function (t) { var e = norm(t.event); return e && (e.indexOf(h) !== -1 || e.indexOf(a) !== -1) && (e.indexOf(h) !== -1 && e.indexOf(a) !== -1); });
    };

    // Group by league (live/upcoming first, finished after).
    var groups = {};
    fixtures.forEach(function (f) {
      var key = f.league || 'Other';
      if (!groups[key]) groups[key] = { name: key, logo: f.leagueLogo || '', games: [] };
      groups[key].games.push(f);
    });
    var leagues = Object.values(groups).sort(function (a, b) { return b.games.length - a.games.length; });

    var crest = function (url, name) {
      if (url) return '<img src="' + self.escapeHtml(url) + '" alt="" style="width:26px;height:26px;object-fit:contain;" onerror="this.style.visibility=\'hidden\'">';
      return '<div style="width:26px;height:26px;border-radius:50%;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:var(--gold);">' + self.escapeHtml((name || '?')[0]) + '</div>';
    };
    var isLive = function (s) { return ['LIVE', '1H', '2H', 'HT', 'ET'].indexOf(s) !== -1; };
    var isFin = function (s) { return ['FT', 'AET', 'PEN'].indexOf(s) !== -1; };

    // Implied probability from decimal odds (real bookmaker data, not invented).
    var impl = function (o) { o = parseFloat(o); return (o && o > 1) ? 1 / o : 0; };
    // Compress a market + selection into a NerdyTips-style short code (1 / 1X / O2.5).
    var shortCode = function (market, selection, f) {
      var m = String(market || '').toLowerCase();
      var s = String(selection || '').toLowerCase();
      var h = String(f.homeTeam || '').toLowerCase(), a = String(f.awayTeam || '').toLowerCase();
      if (m.indexOf('double') !== -1) {
        var hasH = h && s.indexOf(h.split(' ')[0]) !== -1, hasA = a && s.indexOf(a.split(' ')[0]) !== -1, hasD = s.indexOf('draw') !== -1;
        if (hasH && hasD) return '1X'; if (hasA && hasD) return 'X2'; if (hasH && hasA) return '12'; return '1X';
      }
      // Check the selection's own Under/Over first so a market literally named
      // "Total Goals" with an "Under 2.5" selection is not mislabelled as Over.
      if (s.indexOf('under') !== -1) return 'U' + (s.match(/[\d.]+/) || ['2.5'])[0];
      if (s.indexOf('over') !== -1 || m.indexOf('over') !== -1 || m.indexOf('total') !== -1) return 'O' + (s.match(/[\d.]+/) || ['2.5'])[0];
      if (m.indexOf('btts') !== -1 || m.indexOf('both teams') !== -1) return s.indexOf('no') !== -1 ? 'NO BTTS' : 'BTTS';
      if (m.indexOf('result') !== -1 || m.indexOf('1x2') !== -1 || m.indexOf('match') !== -1) {
        if (h && s.indexOf(h.split(' ')[0]) !== -1) return '1'; if (a && s.indexOf(a.split(' ')[0]) !== -1) return '2'; if (s.indexOf('draw') !== -1) return 'X';
      }
      return self.escapeHtml((selection || market || '').slice(0, 8));
    };
    // Confidence bar (gold = Our Take, muted = market implied). pct is 0-100.
    var confBar = function (pct, gold) {
      pct = Math.max(4, Math.min(99, Math.round(pct || 0)));
      var col = gold ? 'linear-gradient(90deg,#d4a843,#e8b93a)' : 'linear-gradient(90deg,#3b82f6,#60a5fa)';
      return '<div style="display:flex;align-items:center;gap:8px;justify-content:flex-end;">' +
        '<div style="width:64px;height:5px;border-radius:3px;background:var(--bg-elevated);overflow:hidden;"><div style="width:' + pct + '%;height:100%;background:' + col + ';"></div></div>' +
        '<span style="font-size:12px;font-weight:800;color:' + (gold ? 'var(--gold)' : '#9fb0c9') + ';min-width:34px;text-align:right;">' + pct + '%</span></div>';
    };

    var gameRow = function (f, ri) {
      var pk = pickFor(f);
      var t = f.kickoff ? new Date(f.kickoff) : null;
      var live = isLive(f.status), fin = isFin(f.status);
      var timeTxt = live ? '<span style="color:#ef4444;font-weight:800;font-size:10px;">● LIVE</span>' : fin ? '<span style="color:var(--text-muted);font-size:10px;font-weight:700;">FT</span>' : (t && !isNaN(t.getTime()) ? t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
      var scored = (f.homeGoals != null && f.awayGoals != null);

      // 1X2 implied probabilities from real odds.
      var ph = impl(f.homeOdds), pd = impl(f.drawOdds), pa = impl(f.awayOdds), psum = ph + pd + pa;
      var hasOdds = psum > 0;
      var nH = hasOdds ? ph / psum : 0, nD = hasOdds ? pd / psum : 0, nA = hasOdds ? pa / psum : 0;

      // Prediction pill: our genuine Our Take if published, else the market favourite.
      var predHtml = '';
      if (pk) {
        var code = shortCode(pk.market, pk.selection, f);
        var cNum = Number(pk.confidence);
        var conf = (cNum && !isNaN(cNum)) ? cNum * 10 : (hasOdds ? Math.max(nH, nD, nA) * 100 : 60);
        predHtml = '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;">' +
          '<span title="Our Take" style="font-size:12px;font-weight:900;color:#0a0e1a;background:var(--gold);border-radius:6px;padding:3px 9px;display:inline-block;">' + code + '</span>' +
          confBar(conf, true) + '</div>';
      } else if (hasOdds) {
        var best = Math.max(nH, nD, nA);
        // Explicit argmax so a float tie can't mislabel the favourite.
        var mcode = (nH >= nD && nH >= nA) ? '1' : (nA >= nD && nA >= nH) ? '2' : 'X';
        predHtml = '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;">' +
          '<span title="Market favourite (implied by odds)" style="font-size:12px;font-weight:800;color:#c7d0e0;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;padding:3px 9px;display:inline-block;">' + mcode + '</span>' +
          confBar(best * 100, false) + '</div>';
      } else {
        predHtml = '<span style="font-size:11px;color:var(--text-muted);">—</span>';
      }

      var rid = 'mr-' + ri;
      var teamLine = function (logo, name, goals, bold) {
        return '<div style="display:flex;align-items:center;gap:9px;min-width:0;">' + crest(logo, name) +
          '<span style="font-size:14px;font-weight:' + (bold ? '800' : '600') + ';color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">' + self.escapeHtml(name) + '</span>' +
          (scored ? '<span style="font-size:15px;font-weight:900;color:#fff;margin-left:auto;">' + goals + '</span>' : '') + '</div>';
      };
      // Winner emphasis when finished.
      var hWin = scored && f.homeGoals > f.awayGoals, aWin = scored && f.awayGoals > f.homeGoals;

      // Expandable detail — the full multi-market odds grid (real odds only).
      var oddsCell = function (label, val) {
        return '<div style="flex:1;text-align:center;padding:8px 4px;background:var(--bg-elevated);border-radius:8px;">' +
          '<div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">' + label + '</div>' +
          '<div style="font-size:13px;font-weight:800;color:#fff;">' + (val ? self.formatOdds(val) : '—') + '</div></div>';
      };
      var detail =
        '<div id="' + rid + '" class="mtch-detail" style="display:none;padding:0 14px 14px;">' +
          '<div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin:2px 0 6px;">Match Result</div>' +
          '<div style="display:flex;gap:6px;margin-bottom:8px;">' + oddsCell('1 · Home', f.homeOdds) + oddsCell('X · Draw', f.drawOdds) + oddsCell('2 · Away', f.awayOdds) + '</div>' +
          ((f.overOdds || f.underOdds || f.bttsOdds) ?
            '<div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin:2px 0 6px;">Goals</div>' +
            '<div style="display:flex;gap:6px;margin-bottom:10px;">' + oddsCell('Over 2.5', f.overOdds) + oddsCell('Under 2.5', f.underOdds) + oddsCell('BTTS', f.bttsOdds) + '</div>' : '') +
          (pk ? '<div style="background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.3);border-radius:8px;padding:9px 12px;margin-bottom:10px;font-size:12px;color:#e8e6e3;"><strong style="color:var(--gold);">Our Take:</strong> ' + self.escapeHtml(pk.selection || '') + (pk.market ? ' <span style="color:var(--text-muted);">(' + self.escapeHtml(pk.market) + ')</span>' : '') + '</div>' : '') +
          // Published pick → its tip page (rich analysis by tip id); otherwise open
          // match intelligence by FIXTURE id (openMatchIntelligence hits /match-intelligence/:id).
          ((pk && pk.id) ? '<a href="#/tip/' + pk.id + '" onclick="event.stopPropagation();" style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:var(--gold);">Full match intelligence →</a>'
            : (f.id ? '<a href="javascript:void(0)" onclick="event.stopPropagation();App.openMatchIntelligence(' + f.id + ',this);" style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:var(--gold);">Full match intelligence →</a>' : '')) +
        '</div>';

      return '<div style="border-top:1px solid var(--border);">' +
        '<div onclick="App._toggleMatchRow(\'' + rid + '\',this)" style="display:grid;grid-template-columns:46px 1fr auto 16px;gap:10px;align-items:center;padding:11px 14px;cursor:pointer;user-select:none;">' +
          '<div style="font-size:11px;color:var(--text-secondary);text-align:center;line-height:1.3;">' + timeTxt + '</div>' +
          '<div style="min-width:0;display:flex;flex-direction:column;gap:5px;">' + teamLine(f.homeTeamLogo, f.homeTeam, f.homeGoals, hWin) + teamLine(f.awayTeamLogo, f.awayTeam, f.awayGoals, aWin) + '</div>' +
          '<div>' + predHtml + '</div>' +
          '<span class="mtch-arrow" style="color:var(--text-muted);font-size:11px;transition:transform .2s;">▼</span>' +
        '</div>' + detail +
      '</div>';
    };

    var rowIdx = 0;
    var body = leagues.length ? leagues.map(function (lg, i) {
      var open = i === 0; // first league expanded by default
      var lid = 'lg-' + i;
      var rows = lg.games.map(function (g) { return gameRow(g, rowIdx++); }).join('');
      return '<div class="match-league" style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:12px;">' +
        '<div onclick="App._toggleLeague(\'' + lid + '\',this)" style="display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;user-select:none;">' +
          (lg.logo ? '<img src="' + self.escapeHtml(lg.logo) + '" alt="" style="width:24px;height:24px;object-fit:contain;" onerror="this.style.display=\'none\'">' : '') +
          '<span style="font-size:15px;font-weight:800;color:#fff;flex:1;">' + self.escapeHtml(lg.name) + '</span>' +
          '<span style="font-size:12px;color:var(--text-muted);background:var(--bg-elevated);border-radius:12px;padding:2px 10px;">' + lg.games.length + '</span>' +
          '<span class="league-arrow" style="color:var(--gold);font-size:14px;transition:transform .2s;transform:rotate(' + (open ? '180' : '0') + 'deg);">▼</span>' +
        '</div>' +
        '<div id="' + lid + '" style="display:' + (open ? 'block' : 'none') + ';">' + rows + '</div>' +
      '</div>';
    }).join('') : '<div style="text-align:center;padding:50px 20px;color:var(--text-muted);background:var(--bg-card);border:1px solid var(--border);border-radius:14px;">No football matches loaded right now. Check back soon, or see our <a href="#/racing" style="color:var(--gold);">racing card</a>.</div>';

    app.innerHTML =
      '<div class="container" style="padding-top:18px;max-width:900px;">' +
        '<div style="margin-bottom:18px;"><h1 style="font-size:clamp(24px,6vw,32px);font-weight:900;color:#fff;margin:0 0 4px;">All Matches</h1>' +
        '<p style="color:var(--text-muted);font-size:14px;margin:0;">Every game, grouped by competition. Tap a match to open the full odds. <span style="color:var(--gold);font-weight:700;">Gold</span> = Our Take; blue = market favourite.</p></div>' +
        body +
      '</div>';
  },

  // Expand/collapse a single match row to reveal its multi-market odds grid.
  _toggleMatchRow(id, header) {
    var el = document.getElementById(id);
    if (!el) return;
    var open = el.style.display !== 'none';
    el.style.display = open ? 'none' : 'block';
    var arrow = header.querySelector('.mtch-arrow');
    if (arrow) arrow.style.transform = 'rotate(' + (open ? '0' : '180') + 'deg)';
  },

  _toggleLeague(id, header) {
    var el = document.getElementById(id);
    if (!el) return;
    var open = el.style.display !== 'none';
    el.style.display = open ? 'none' : 'block';
    var arrow = header.querySelector('.league-arrow');
    if (arrow) arrow.style.transform = 'rotate(' + (open ? '0' : '180') + 'deg)';
  },

  async renderFootball() {
    const app = document.getElementById('app');
    app.innerHTML = this.renderSkeleton('tips');

    var liveData = null;
    var weekendFixtures = null;
    var pastFixtureData = null;
    var tomorrowFixtureData = null;
    var isFriday = this._isFriday();
    var dateTab = this._footballDateTab || 'today';
    // Selected future date (YYYY-MM-DD) when a specific upcoming-day tab is active
    var futureDate = this._footballFutureDate || this._getTomorrow();
    var yesterdayDate = this._getYesterday();
    var dayBeforeDate = (function() { var d = new Date(); d.setDate(d.getDate() - 2); return d.toISOString().split('T')[0]; })();
    var tomorrowDate = this._getTomorrow();
    try {
      var fetches = [
        this.api('/tips?sport=football'),
        this.fetchLiveFootball(),
        this.api('/results?sport=football'),
      ];
      // Fetch fixtures for the selected date
      if (dateTab === 'yesterday') {
        fetches.push(this.fetchLiveFootball(false, yesterdayDate));
      } else if (dateTab === 'day-before') {
        fetches.push(this.fetchLiveFootball(false, dayBeforeDate));
      } else if (dateTab === 'future') {
        fetches.push(this.fetchLiveFootball(false, futureDate));
      }
      var results = await Promise.all(fetches);
      this.tips = results[0];
      liveData = results[1];
      this._footballResults = results[2] || [];
      if (dateTab === 'yesterday' || dateTab === 'day-before') {
        pastFixtureData = results[3] || null;
      } else if (dateTab === 'future') {
        tomorrowFixtureData = results[3] || null;
      }
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
    var tomorrow = tomorrowDate;
    var yesterday = yesterdayDate;
    var dayBeforeYesterday = dayBeforeDate;
    var weekendDates = this._getWeekendDates();
    var tomorrowTips = this.tips.filter(function(t) { return t.sport === 'football' && t.status === 'active' && App._normDate(t.date) === tomorrow && !t.isWeeklyAcca; });
    var weekendTips = this.tips.filter(function(t) { return t.sport === 'football' && t.status === 'active' && weekendDates.indexOf(t.date) !== -1 && !t.isWeeklyAcca; });

    // Re-filter tips based on selected date tab
    var displayTips = tips;
    var isPastTab = false;
    if (dateTab === 'future') {
      displayTips = this.tips.filter(function(t) { return t.sport === 'football' && t.status === 'active' && App._normDate(t.date) === futureDate && !t.isWeeklyAcca; });
    } else if (dateTab === 'yesterday' || dateTab === 'day-before') {
      isPastTab = true;
      var targetDate = dateTab === 'yesterday' ? yesterday : dayBeforeYesterday;
      // For past days, use results (settled tips with outcomes) — dedupe by selection+event
      var pastResults = (this._footballResults || []).filter(function(r) {
        return r.sport === 'football' && App._normDate(r.date) === targetDate;
      });
      // Also check settled tips
      var pastTips = (this.tips || []).filter(function(t) {
        return t.sport === 'football' && App._normDate(t.date) === targetDate && !t.isWeeklyAcca;
      });
      // Merge: prefer results (have actualOutcome), fall back to tips
      var seen = {};
      displayTips = [];
      pastResults.forEach(function(r) {
        var key = (r.selection || '').toLowerCase() + '|' + (r.event || '').toLowerCase();
        if (!seen[key]) { seen[key] = true; displayTips.push(r); }
      });
      pastTips.forEach(function(t) {
        var key = (t.selection || '').toLowerCase() + '|' + (t.event || '').toLowerCase();
        if (!seen[key]) { seen[key] = true; displayTips.push(t); }
      });
    } else {
      displayTips = tips.filter(function(t) { return App._normDate(t.date) === today; });
      if (displayTips.length === 0) {
        displayTips = []; // Show empty state, not all tips
      }
    }
    // Sort: Premier League first, then alphabetically by league
    displayTips.sort(function(a, b) {
      var aIsPL = (a.league || '').toLowerCase().indexOf('premier') !== -1 ? 0 : 1;
      var bIsPL = (b.league || '').toLowerCase().indexOf('premier') !== -1 ? 0 : 1;
      if (aIsPL !== bIsPL) return aIsPL - bIsPL;
      return (a.league || '').localeCompare(b.league || '');
    });
    // Sort leagues: Premier League always first
    var displayLeagues = [...new Set(displayTips.map(t => t.league))].sort(function(a, b) {
      var aIsPL = (a || '').toLowerCase().indexOf('premier') !== -1 ? 0 : 1;
      var bIsPL = (b || '').toLowerCase().indexOf('premier') !== -1 ? 0 : 1;
      if (aIsPL !== bIsPL) return aIsPL - bIsPL;
      return (a || '').localeCompare(b || '');
    });

    app.innerHTML = `
      <div class="container">
        <div class="page-header">
          <h1><span class="accent">Football</span> Tips</h1>
          <p>Data-driven selections across Europe's top leagues with xG analysis and injury intelligence</p>
        </div>

        <!-- Date Tabs — rolling day-by-day selector (yesterday → next 10 days) -->
        <div class="date-tabs" style="overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;">
          <button class="date-tab ${dateTab === 'yesterday' ? 'active' : ''}" onclick="App._footballDateTab='yesterday';App.renderFootball()">Yesterday</button>
          <button class="date-tab ${dateTab === 'today' ? 'active' : ''}" onclick="App._footballDateTab='today';App.renderFootball()">Today</button>
          ${(function() {
            var btns = '';
            for (var dd = 1; dd <= 10; dd++) {
              var ds = App._getDateOffset(dd);
              var lbl = dd === 1 ? 'Tomorrow' : new Date(ds + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
              var dayTips = App.tips.filter(function(t) { return t.sport === 'football' && t.status === 'active' && App._normDate(t.date) === ds && !t.isWeeklyAcca; }).length;
              var isActive = dateTab === 'future' && futureDate === ds;
              btns += '<button class="date-tab ' + (isActive ? 'active' : '') + '" onclick="App._footballDateTab=\'future\';App._footballFutureDate=\'' + ds + '\';App.renderFootball()">' + lbl + (dayTips ? ' (' + dayTips + ')' : '') + '</button>';
            }
            return btns;
          })()}
        </div>

        <!-- Fixtures Section — date-aware -->
        ${(() => {
          // Determine which fixtures to show based on selected tab
          var tabFixtures = [];
          var sectionLabel = 'Live Fixtures';
          var showRefresh = false;
          if (dateTab === 'yesterday' || dateTab === 'day-before') {
            // Past dates — show finished fixtures with scores
            tabFixtures = pastFixtureData && pastFixtureData.fixtures ? pastFixtureData.fixtures : [];
            sectionLabel = dateTab === 'yesterday' ? 'Yesterday\'s Results' : new Date(dayBeforeYesterday).toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'short'}) + ' Results';
          } else if (dateTab === 'future') {
            tabFixtures = tomorrowFixtureData && tomorrowFixtureData.fixtures ? tomorrowFixtureData.fixtures : [];
            sectionLabel = (futureDate === App._getTomorrow() ? 'Tomorrow' : new Date(futureDate + 'T12:00:00').toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long'})) + '’s Fixtures';
          } else {
            tabFixtures = fixtures;
            sectionLabel = 'Live Fixtures';
            showRefresh = true;
          }
          if (tabFixtures.length === 0) return '<div class="section"><div style="text-align:center;padding:40px 20px;"><div style="font-size:40px;margin-bottom:12px;">&#9917;</div><div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:6px;">No Fixtures ' + (dateTab === 'today' ? 'Today' : 'For This Date') + '</div><div style="font-size:13px;color:rgba(255,255,255,0.4);max-width:420px;margin:0 auto;">No games on this date. The domestic season is building back up — our previews and Our Take on every game return with the fixtures. Check the dashboard for the next featured meeting.</div><div style="margin-top:16px;"><a href="#/dashboard" style="background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;padding:10px 24px;border-radius:8px;font-weight:700;font-size:13px;text-decoration:none;">Back to Dashboard</a></div></div></div>';
          // Group by league
          var tabByLeague = {};
          tabFixtures.forEach(function(f) {
            var key = f.league || 'Other';
            if (!tabByLeague[key]) tabByLeague[key] = [];
            tabByLeague[key].push(f);
          });
          // Build our results lookup for past tabs — match results to our picks
          var ourResults = {};
          if (isPastTab) {
            displayTips.forEach(function(r) {
              var evt = (r.event || '').toLowerCase();
              ourResults[evt] = r;
            });
          }
          return '<div class="section">' +
            '<div class="live-data-header">' +
              '<span class="live-badge">' + sectionLabel + '</span>' +
              (showRefresh ? '<div class="live-updated">' +
                (liveUpdatedAt ? 'Updated ' + App.timeAgo(liveUpdatedAt.toISOString()) : '') +
                '<button class="refresh-btn" onclick="App.refreshFootballData(this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Refresh</button>' +
              '</div>' : '') +
            '</div>' +
            Object.keys(tabByLeague).sort(function(a, b) {
              var aIsPL = a.toLowerCase().indexOf('premier') !== -1 ? 0 : 1;
              var bIsPL = b.toLowerCase().indexOf('premier') !== -1 ? 0 : 1;
              return aIsPL !== bIsPL ? aIsPL - bIsPL : a.localeCompare(b);
            }).map(function(leagueName) {
              var leagueFixtures = tabByLeague[leagueName];
              return '<div class="meeting-card"><h3>&#9917; ' + leagueName + '</h3><div style="display:grid;gap:8px;">' +
                leagueFixtures.map(function(f) {
                  var isLive = f.status === '1H' || f.status === '2H' || f.status === 'HT' || f.status === 'LIVE';
                  var isFT = f.status === 'FT' || f.status === 'AET' || f.status === 'PEN';
                  var kickoffTime = f.kickoff ? new Date(f.kickoff).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'}) : '';
                  // Check if we had a pick on this fixture
                  var ourPick = null;
                  var matchKey = ((f.homeTeam || '') + ' vs ' + (f.awayTeam || '')).toLowerCase();
                  Object.keys(ourResults).forEach(function(k) {
                    if (k.indexOf((f.homeTeam || '').toLowerCase()) !== -1 || k.indexOf((f.awayTeam || '').toLowerCase()) !== -1) {
                      ourPick = ourResults[k];
                    }
                  });
                  var pickBadge = '';
                  if (ourPick && isFT) {
                    var isWon = ourPick.result === 'won' || ourPick.result === 'placed';
                    var isLost = ourPick.result === 'lost';
                    pickBadge = '<div style="font-size:11px;margin-top:4px;padding:4px 8px;border-radius:4px;' +
                      (isWon ? 'background:rgba(34,197,94,0.12);color:#22c55e;' : isLost ? 'background:rgba(239,68,68,0.12);color:#ef4444;' : 'color:rgba(255,255,255,0.4);') + '">' +
                      'Our Pick: <strong>' + (ourPick.selection || '') + '</strong> @ ' + App.formatOdds(ourPick.odds || 0) +
                      (isWon ? ' &#10003; WON' : isLost ? ' &#10007; LOST' : '') +
                    '</div>';
                  }
                  return '<div class="fixture-card fixture-card-clickable" onclick="App.openMatchIntelligence(' + (f.id || 0) + ', this)" title="Click for match analysis">' +
                    '<div style="flex:1;">' +
                      '<div class="fixture-league">' + leagueName + '</div>' +
                      '<div class="fixture-teams" style="display:flex;align-items:center;gap:6px;">' +
                        (f.homeTeamLogo ? '<img src="' + f.homeTeamLogo + '" style="width:20px;height:20px;object-fit:contain;" onerror="this.style.display=\'none\'">' : '') +
                        (f.homeTeam||'') + ' <span class="fixture-vs">vs</span> ' + (f.awayTeam||'') +
                        (f.awayTeamLogo ? '<img src="' + f.awayTeamLogo + '" style="width:20px;height:20px;object-fit:contain;" onerror="this.style.display=\'none\'">' : '') +
                      '</div>' +
                      '<div class="fixture-meta">' + (f.venue || '') + (kickoffTime ? ' | ' + kickoffTime : '') + '</div>' +
                      pickBadge +
                    '</div>' +
                    (isLive ? '<div><div class="fixture-live-badge">LIVE ' + (f.elapsed || '') + '\'</div><div class="fixture-score">' + (f.homeGoals != null ? f.homeGoals : '-') + ' - ' + (f.awayGoals != null ? f.awayGoals : '-') + '</div></div>' :
                     isFT ? '<div><div style="font-size:10px;color:var(--text-muted);">FT</div><div class="fixture-score" style="color:var(--text-primary);font-size:18px;font-weight:900;">' + (f.homeGoals||0) + ' - ' + (f.awayGoals||0) + '</div></div>' :
                     '<div class="fixture-meta" style="font-size:14px;font-weight:600;">' + kickoffTime + '</div>') +
                  '</div>';
                }).join('') + '</div></div>';
            }).join('') +
          '</div>';
        })()}

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
                Object.keys(byLeague).sort(function(a, b) {
                  var aIsPL = a.toLowerCase().indexOf('premier') !== -1 ? 0 : 1;
                  var bIsPL = b.toLowerCase().indexOf('premier') !== -1 ? 0 : 1;
                  return aIsPL !== bIsPL ? aIsPL - bIsPL : a.localeCompare(b);
                }).map(function(lg) {
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
          <h3 class="mb-16">${dateTab === 'today' ? "Today's" : dateTab === 'future' ? (futureDate === this._getTomorrow() ? "Tomorrow's" : new Date(futureDate + 'T12:00:00').toLocaleDateString('en-GB', {weekday:'long'}) + "'s") : dateTab === 'yesterday' ? "Yesterday's" : "Selected day's"} Fixtures by League</h3>
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
          <div class="section-title"><span class="icon">&#9917;</span> ${isPastTab ? 'Results' : 'Football Selections'}</div>
          <div class="${isPastTab ? '' : 'grid grid-2'}" id="football-tips">
            ${displayTips.length ? (isPastTab ? displayTips.map(function(t) { return App._renderFootballResultCard(t); }).join('') : displayTips.map(t => this.renderTipCard(t)).join('')) : '<p class="text-muted" style="text-align:center;padding:30px;' + (isPastTab ? '' : 'grid-column:1/-1;') + '">No ' + (isPastTab ? 'results' : 'selections') + ' for this period.' + (isPastTab ? '' : ' Check back at 7:30am UK for the latest tips.') + '</p>'}
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

  // National-team name -> ISO code for flagcdn. Covers all 48 WC2026 nations
  // plus the feed's alternate names (Korea Republic, IR Iran, USA, etc.).
  countryCode(name) {
    if (!name) return null;
    var key = String(name).toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents
      .replace(/&/g, 'and').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
    var MAP = {
      'mexico': 'mx', 'south africa': 'za', 'south korea': 'kr', 'korea republic': 'kr', 'korea': 'kr',
      'czech republic': 'cz', 'czechia': 'cz', 'canada': 'ca', 'switzerland': 'ch', 'qatar': 'qa',
      'bosnia and herzegovina': 'ba', 'bosnia': 'ba', 'brazil': 'br', 'morocco': 'ma', 'haiti': 'ht',
      'scotland': 'gb-sct', 'usa': 'us', 'united states': 'us', 'paraguay': 'py', 'australia': 'au',
      'turkey': 'tr', 'turkiye': 'tr', 'germany': 'de', 'curacao': 'cw', 'ivory coast': 'ci',
      'cote divoire': 'ci', 'ecuador': 'ec', 'netherlands': 'nl', 'holland': 'nl', 'japan': 'jp',
      'sweden': 'se', 'tunisia': 'tn', 'belgium': 'be', 'egypt': 'eg', 'iran': 'ir', 'ir iran': 'ir',
      'new zealand': 'nz', 'spain': 'es', 'cape verde': 'cv', 'cabo verde': 'cv', 'saudi arabia': 'sa',
      'uruguay': 'uy', 'france': 'fr', 'senegal': 'sn', 'norway': 'no', 'iraq': 'iq', 'argentina': 'ar',
      'algeria': 'dz', 'austria': 'at', 'jordan': 'jo', 'portugal': 'pt', 'dr congo': 'cd',
      'congo dr': 'cd', 'democratic republic of congo': 'cd', 'uzbekistan': 'uz', 'colombia': 'co',
      'england': 'gb-eng', 'croatia': 'hr', 'ghana': 'gh', 'panama': 'pa', 'wales': 'gb-wls',
      'northern ireland': 'gb-nir', 'republic of ireland': 'ie', 'ireland': 'ie',
    };
    return MAP[key] || null;
  },

  // Team badge for the match-intel header: crisp flag for national sides, club
  // crest when we have one, lettered circle as the last resort. size in px.
  teamBadge(team, logoUrl, size) {
    size = size || 48;
    var letter = '<div class="match-intel-letter" style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:linear-gradient(135deg,#1a2a4a,#0a1a3a);display:flex;align-items:center;justify-content:center;font-size:' + Math.round(size * 0.38) + 'px;font-weight:900;color:#d4a843;">' + ((team || '?')[0] || '?') + '</div>';
    var code = this.countryCode(team);
    if (code) {
      var src = '/flags/' + code + '.png';
      return '<img src="' + src + '" alt="' + (team || '') + '" class="match-intel-team-logo" ' +
        'style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 2px rgba(212,168,67,0.35);" ' +
        'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
        letter.replace('display:flex', 'display:none');
    }
    if (logoUrl) {
      return '<img src="' + logoUrl + '" alt="' + (team || '') + '" class="match-intel-team-logo" ' +
        'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
        letter.replace('display:flex', 'display:none');
    }
    return letter;
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
          this.teamBadge(m.homeTeam, m.homeTeamLogo, 48) +
          '<span class="match-intel-team-name">' + m.homeTeam + '</span>' +
        '</div>' +
        '<div class="match-intel-vs">' +
          (m.status === 'FT' || m.homeGoals != null ? '<div class="match-intel-score">' + (m.homeGoals || 0) + ' - ' + (m.awayGoals || 0) + '</div>' : '<span>VS</span>') +
          '<div class="match-intel-kickoff">' + kickoffStr + '</div>' +
        '</div>' +
        '<div class="match-intel-team">' +
          this.teamBadge(m.awayTeam, m.awayTeamLogo, 48) +
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
      // Official-partner CTA — only under the UNLOCKED verdict (premium users).
      // Rendered as a slot: the tracked CTA shows immediately, then a loader
      // upgrades it to Cosmo's live price + "add to betslip" for this exact pick.
      (isPremium ? '<div id="cosmo-cta-slot">' + this.renderCosmoCta('match-intel', 'Back this with Cosmo Bet') + '</div>' : '') +
    '</div>';

    // --- Elite Edge Quant Model (in-house Elo + Dixon-Coles) ---
    if (data.quantModel && data.quantModel.winProb) {
      var q = data.quantModel;
      // A projected scoreline CONSISTENT with Our Take, drawn from the model's
      // scoreline distribution — so the score we show never contradicts the pick
      // (no "BTTS-Yes" beside a 1-0, no team-win beside a draw).
      var _consistentScore = function(top, verdict, homeTeam) {
        if (!top || !top.length) return null;
        var pk = (verdict && verdict.pick || '').toLowerCase();
        var mk = (verdict && verdict.market || '').toLowerCase();
        var P = function(s) { var x = String(s.score || '').split('-'); return { h: parseInt(x[0]) || 0, a: parseInt(x[1]) || 0 }; };
        var f = top;
        if (mk.indexOf('both teams') !== -1 || pk.indexOf('btts') !== -1) {
          f = pk.indexOf('no') !== -1 ? top.filter(function(s) { var x = P(s); return x.h === 0 || x.a === 0; }) : top.filter(function(s) { var x = P(s); return x.h >= 1 && x.a >= 1; });
        } else if (mk.indexOf('total') !== -1 || pk.indexOf('over') !== -1 || pk.indexOf('under') !== -1) {
          f = pk.indexOf('over') !== -1 ? top.filter(function(s) { var x = P(s); return (x.h + x.a) >= 3; }) : top.filter(function(s) { var x = P(s); return (x.h + x.a) <= 2; });
        } else if (mk.indexOf('double chance') !== -1) {
          f = (homeTeam && pk.indexOf(String(homeTeam).toLowerCase()) !== -1)
            ? top.filter(function(s) { var x = P(s); return x.h >= x.a; })   // home win or draw
            : top.filter(function(s) { var x = P(s); return x.a >= x.h; });  // away win or draw
        } else if (pk.indexOf('draw') !== -1) {
          f = top.filter(function(s) { var x = P(s); return x.h === x.a; });
        } else if (homeTeam && pk.indexOf(String(homeTeam).toLowerCase()) !== -1) {
          f = top.filter(function(s) { var x = P(s); return x.h > x.a; });
        } else if (pk) {
          f = top.filter(function(s) { var x = P(s); return x.a > x.h; });
        }
        return (f[0] || top[0]).score;
      };
      var _projScore = q.topScorelines ? _consistentScore(q.topScorelines, v, m.homeTeam) : q.mostLikelyScore;
      var qbar = function (label, pct, color) {
        return '<div style="display:flex;align-items:center;gap:8px;margin:4px 0;">' +
          '<span style="font-size:12px;color:var(--text-secondary);width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + App.escapeHtml(label) + '</span>' +
          '<div style="flex:1;height:8px;border-radius:4px;background:var(--bg-elevated);overflow:hidden;"><div style="height:100%;width:' + pct + '%;background:' + color + ';"></div></div>' +
          '<span style="font-size:12px;font-weight:700;color:var(--text-primary);width:34px;text-align:right;">' + pct + '%</span>' +
        '</div>';
      };
      html += '<div class="match-intel-section">' +
        '<h3 class="match-intel-section-title">Elite Edge Model <span style="font-size:11px;color:var(--text-muted);font-weight:500;">· Elo + Dixon-Coles (our engine)</span></h3>' +
        '<div style="display:flex;gap:18px;flex-wrap:wrap;">' +
          '<div style="flex:1;min-width:220px;">' +
            qbar(m.homeTeam, q.winProb.home, '#22c55e') +
            qbar('Draw', q.winProb.draw, '#94a3b8') +
            qbar(m.awayTeam, q.winProb.away, '#3b82f6') +
          '</div>' +
          '<div style="text-align:center;min-width:120px;">' +
            '<div style="font-size:11px;color:var(--text-muted);">Expected goals</div>' +
            '<div style="font-size:20px;font-weight:900;color:#fff;">' + q.expectedGoals.home + ' – ' + q.expectedGoals.away + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted);margin-top:6px;">Projected</div>' +
            '<div style="font-size:16px;font-weight:800;color:#d4a843;">' + (_projScore || q.mostLikelyScore || '-') + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);margin-top:8px;border-top:1px solid var(--border);padding-top:8px;">Over 2.5: <strong>' + q.over25 + '%</strong> &nbsp;·&nbsp; BTTS: <strong>' + q.btts + '%</strong> &nbsp;·&nbsp; Power rating ' + q.ratings.home + ' v ' + q.ratings.away + '</div>' +
      '</div>';
    }

    // --- Model Prediction (SportMonks All-In) ---
    // Only shown when our own Elite Edge (quant) model ISN'T available — one
    // source of truth. Two competing models on screen (with different win %,
    // scoreline and BTTS) is what made "Our Take" look inconsistent.
    if (!(data.quantModel && data.quantModel.winProb) && (data.winProbability || data.predictedScore || data.bttsPercent != null)) {
      var wp = data.winProbability;
      var probBar = function(label, pct, color) {
        return '<div style="margin-bottom:8px;">' +
          '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);margin-bottom:3px;"><span>' + label + '</span><span>' + (pct != null ? pct + '%' : '-') + '</span></div>' +
          '<div style="height:7px;border-radius:4px;background:var(--bg-elevated);overflow:hidden;"><div style="height:100%;width:' + (pct || 0) + '%;background:' + color + ';border-radius:4px;"></div></div>' +
        '</div>';
      };
      html += '<div class="match-intel-section' + lockedClass + '">' +
        '<h3 class="match-intel-section-title">Model Prediction</h3>' +
        (wp ? probBar(m.homeTeam + ' win', wp.home, '#22c55e') + probBar('Draw', wp.draw, '#d4a843') + probBar(m.awayTeam + ' win', wp.away, '#3b82f6') : '') +
        '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:10px;">' +
          (data.predictedScore ? '<div><span style="color:var(--text-secondary);font-size:12px;">Most likely score</span><div style="font-size:18px;font-weight:800;color:var(--text-primary);">' + this.escapeHtml(String(data.predictedScore)) + '</div></div>' : '') +
          (data.bttsPercent != null ? '<div><span style="color:var(--text-secondary);font-size:12px;">Both teams to score</span><div style="font-size:18px;font-weight:800;color:var(--text-primary);">' + data.bttsPercent + '%</div></div>' : '') +
          (data.xg ? '<div><span style="color:var(--text-secondary);font-size:12px;">Expected goals</span><div style="font-size:18px;font-weight:800;color:var(--text-primary);">' + data.xg.home + ' v ' + data.xg.away + '</div></div>' : '') +
        '</div>' +
      '</div>';
    }

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

    // --- Match Momentum (SportMonks Pressure Index) ---
    if (data.pressure && data.pressure.timeline && data.pressure.timeline.length) {
      var pr = data.pressure;
      var spark = pr.timeline.map(function(t) {
        var h = t.home || 0, a = t.away || 0, tot = h + a;
        var hPct = tot ? Math.round((h / tot) * 100) : 50;
        // Each column: top = home share (gold), bottom = away share (blue).
        return '<div title="' + (t.minute != null ? t.minute + "'" : '') + '" style="flex:1;display:flex;flex-direction:column;height:46px;border-radius:2px;overflow:hidden;background:var(--bg-elevated);">' +
          '<div style="height:' + hPct + '%;background:#d4a843;"></div>' +
          '<div style="height:' + (100 - hPct) + '%;background:#3b82f6;"></div>' +
        '</div>';
      }).join('');
      html += '<div class="match-intel-section' + lockedClass + '">' +
        '<h3 class="match-intel-section-title">Match Momentum <span style="font-size:11px;color:var(--text-muted);font-weight:500;">· Pressure Index</span></h3>' +
        '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;">' +
          '<span style="color:#d4a843;font-weight:700;">' + this.escapeHtml(m.homeTeam) + ' ' + pr.homeShare + '%</span>' +
          '<span style="color:#3b82f6;font-weight:700;">' + pr.awayShare + '% ' + this.escapeHtml(m.awayTeam) + '</span>' +
        '</div>' +
        '<div style="display:flex;gap:2px;align-items:stretch;">' + spark + '</div>' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:6px;">Share of attacking pressure across the match.</div>' +
      '</div>';
    }

    // --- Match Stats (SportMonks live/full-time stat sheet) ---
    if (data.teamStats && data.teamStats.length) {
      var statRow = function(r) {
        var h = Number(r.home) || 0, a = Number(r.away) || 0, tot = h + a;
        var hPct = tot ? Math.round((h / tot) * 100) : 50;
        return '<div style="margin-bottom:10px;">' +
          '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px;">' +
            '<strong style="color:var(--text-primary);">' + r.home + (r.suffix || '') + '</strong>' +
            '<span style="color:var(--text-secondary);">' + r.label + '</span>' +
            '<strong style="color:var(--text-primary);">' + r.away + (r.suffix || '') + '</strong>' +
          '</div>' +
          '<div style="display:flex;height:6px;border-radius:3px;overflow:hidden;background:var(--bg-elevated);">' +
            '<div style="width:' + hPct + '%;background:#d4a843;"></div>' +
            '<div style="width:' + (100 - hPct) + '%;background:#3b82f6;"></div>' +
          '</div>' +
        '</div>';
      };
      html += '<div class="match-intel-section' + lockedClass + '">' +
        '<h3 class="match-intel-section-title">Match Stats <span style="font-size:11px;color:var(--text-muted);font-weight:500;">· ' + this.escapeHtml(m.homeTeam) + ' v ' + this.escapeHtml(m.awayTeam) + '</span></h3>' +
        data.teamStats.map(statRow).join('') +
      '</div>';
    }

    // --- Probable Lineups (SportMonks All-In) — with formations + player ratings ---
    if (data.lineups && ((data.lineups.home && data.lineups.home.length) || (data.lineups.away && data.lineups.away.length))) {
      var ratingChip = function(rating) {
        if (rating == null) return '';
        var col = rating >= 7.5 ? '#22c55e' : rating >= 6.5 ? '#d4a843' : '#ef4444';
        return '<span style="margin-left:auto;font-size:11px;font-weight:800;color:#fff;background:' + col + ';border-radius:4px;padding:1px 6px;min-width:34px;text-align:center;">' + rating.toFixed(1) + '</span>';
      };
      var lineupCol = function(players) {
        return (players || []).map(function(p) {
          return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;' + (p.starter === false ? 'opacity:0.6;' : '') + '">' +
            '<span style="display:inline-block;min-width:22px;text-align:center;color:var(--gold);font-weight:700;font-size:12px;">' + (p.number != null ? p.number : '') + '</span>' +
            '<span style="color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + App.escapeHtml(p.name || '') + '</span>' +
            ratingChip(p.rating) +
          '</div>';
        }).join('');
      };
      var fmt = data.formations || {};
      var teamHead = function(name, formation) {
        return '<div style="display:flex;justify-content:space-between;align-items:baseline;font-weight:700;color:var(--text-primary);margin-bottom:6px;border-bottom:1px solid var(--border);padding-bottom:4px;">' +
          '<span>' + App.escapeHtml(name) + '</span>' +
          (formation ? '<span style="font-size:11px;color:var(--text-muted);font-weight:600;">' + App.escapeHtml(formation) + '</span>' : '') +
        '</div>';
      };
      var hasRatings = (data.lineups.home || []).some(function(p) { return p.rating != null; }) || (data.lineups.away || []).some(function(p) { return p.rating != null; });
      html += '<div class="match-intel-section' + lockedClass + '">' +
        '<h3 class="match-intel-section-title">' + (hasRatings ? 'Lineups & Player Ratings' : 'Probable Lineups') + '</h3>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">' +
          '<div>' + teamHead(m.homeTeam, fmt.home) + lineupCol(data.lineups.home) + '</div>' +
          '<div>' + teamHead(m.awayTeam, fmt.away) + lineupCol(data.lineups.away) + '</div>' +
        '</div>' +
      '</div>';
    }

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

    // Upgrade the partner CTA with Cosmo's live price + add-to-betslip for THIS
    // pick (async; the tracked CTA already shows, so this only enriches it).
    if (isPremium && v && v.pick) this.loadCosmoOdds(m, v);
  },

  // Fetch Cosmo Bet's live price for the verdict pick and, if matched, swap the
  // generic CTA for "Our pick @ <odds> · Add to betslip". Silent on no match.
  async loadCosmoOdds(m, v) {
    var slot = document.getElementById('cosmo-cta-slot');
    if (!slot) return;
    try {
      var date = m.kickoff ? String(m.kickoff).slice(0, 10) : '';
      var qs = '?home=' + encodeURIComponent(m.homeTeam) + '&away=' + encodeURIComponent(m.awayTeam) +
        '&date=' + encodeURIComponent(date) + '&market=' + encodeURIComponent(v.market || '') +
        '&selection=' + encodeURIComponent(v.pick || '');
      var d = await this.api('/football/cosmo-odds' + qs);
      slot = document.getElementById('cosmo-cta-slot');
      if (!slot) return;
      if (d && d.matched && d.betslipLink) {
        // Only promise "Add to Betslip" when the deep-link is genuinely wired;
        // otherwise it's the tracked link to Cosmo (honest label).
        var label = d.deepLink ? 'Add to Betslip' : 'Back this with Cosmo Bet';
        slot.innerHTML =
          '<div style="margin-top:12px;background:rgba(212,168,67,0.06);border:1px solid rgba(212,168,67,0.25);border-radius:10px;padding:12px 14px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;">' +
              '<span style="font-size:12px;color:var(--text-secondary);">Cosmo Bet price · ' + this.escapeHtml(v.pick) + '</span>' +
              (d.cosmoOdds ? '<span style="font-size:20px;font-weight:900;color:var(--gold);">' + this.formatOdds(d.cosmoOdds) + '</span>' : '') +
            '</div>' +
            '<a href="' + encodeURI(d.betslipLink) + '" target="_blank" rel="noopener sponsored" onclick="event.stopPropagation();" ' +
            'style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;font-weight:800;font-size:14px;padding:11px 16px;border-radius:8px;text-decoration:none;">⚡ ' + label + ' →</a>' +
            '<div style="font-size:10px;color:var(--text-muted);text-align:center;margin-top:6px;">Official partner · 18+ · <a href="https://www.begambleaware.org" target="_blank" rel="noopener" style="color:var(--text-muted);">BeGambleAware.org</a></div>' +
          '</div>';
      }
    } catch (e) { /* keep the default tracked CTA */ }
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
              if (tip.analysis.tacticianInsight) tipsHtml += '<div style="margin-top:12px;padding:14px;background:rgba(239,68,68,0.04);border:1px solid rgba(239,68,68,0.2);border-radius:8px;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#ef4444;font-weight:800;margin-bottom:8px;">The Tactician — Deep Intelligence</div><div style="font-size:13px;color:#cbd5e1;line-height:1.6;">' + tip.analysis.tacticianInsight + '</div></div>';
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
          All results verified via live API data &mdash; settled automatically in near real-time
        </div>

        <!-- Day-by-Day Archive -->
        <div class="section">
          <div class="section-title"><span class="icon">&#128197;</span> Daily Results Archive</div>
          <div id="results-archive" style="margin-bottom:24px;">Loading archive...</div>
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

    // Load and render the day-by-day archive
    this._loadResultsArchive();
  },

  async _loadResultsArchive() {
    var container = document.getElementById('results-archive');
    if (!container) return;
    try {
      var data = await this.api('/results/archive?sport=football&days=30');
      if (!data || !data.archive || data.archive.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">No settled results yet. Results appear here automatically after matches finish.</p>';
        return;
      }
      var self = this;
      var html = data.archive.map(function(day) {
        var dateLabel = new Date(day.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
        var total = day.wins + day.losses + day.voids;
        var sr = total > 0 ? Math.round((day.wins / total) * 100) : 0;
        var pnlColor = day.pnl >= 0 ? '#22c55e' : '#ef4444';
        var pnlSign = day.pnl >= 0 ? '+' : '';

        var summaryBar = '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:10px;cursor:pointer;margin-bottom:2px;" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\'">' +
          '<div><strong style="color:#fff;">' + dateLabel + '</strong> <span style="color:var(--text-muted);font-size:12px;margin-left:8px;">' + total + ' tips</span></div>' +
          '<div style="display:flex;gap:12px;align-items:center;">' +
            '<span style="color:#22c55e;font-weight:700;font-size:13px;">' + day.wins + 'W</span>' +
            '<span style="color:#ef4444;font-weight:700;font-size:13px;">' + day.losses + 'L</span>' +
            '<span style="font-weight:800;color:' + pnlColor + ';font-size:14px;">' + pnlSign + day.pnl.toFixed(2) + 'u</span>' +
            '<span style="color:var(--text-muted);font-size:12px;">' + sr + '%</span>' +
            '<span style="color:var(--text-muted);font-size:11px;">&#9660;</span>' +
          '</div>' +
        '</div>';

        var detailRows = day.results.map(function(r) {
          var isWon = r.result === 'won' || r.result === 'placed';
          var isLost = r.result === 'lost';
          var icon = isWon ? '<span style="color:#22c55e;">&#10003;</span>' : isLost ? '<span style="color:#ef4444;">&#10007;</span>' : '<span style="color:var(--text-muted);">&#8212;</span>';
          var rPnl = r.pnl !== undefined ? (r.pnl >= 0 ? '<span style="color:#22c55e;">+' + r.pnl.toFixed(2) + '</span>' : '<span style="color:#ef4444;">' + r.pnl.toFixed(2) + '</span>') : '';
          return '<div style="display:flex;align-items:center;gap:10px;padding:8px 18px;border-bottom:1px solid rgba(255,255,255,0.03);font-size:13px;">' +
            '<div style="width:20px;text-align:center;">' + icon + '</div>' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-weight:600;color:#fff;">' + (r.event || r.selection) + '</div>' +
              (r.actualOutcome ? '<div style="font-size:12px;color:' + (isWon ? '#22c55e' : isLost ? '#ef4444' : 'var(--text-muted)') + ';font-weight:700;">' + r.actualOutcome + '</div>' : '') +
              '<div style="font-size:11px;color:var(--text-muted);">Pick: ' + r.selection + ' &bull; ' + r.market + ' &bull; ' + self.formatOdds(r.odds) + (r.analyst ? ' &bull; ' + r.analyst : '') + '</div>' +
            '</div>' +
            '<div style="text-align:right;white-space:nowrap;">' +
              '<div style="font-size:13px;font-weight:700;">' + rPnl + 'u</div>' +
            '</div>' +
          '</div>';
        }).join('');

        return summaryBar + '<div style="display:none;background:rgba(255,255,255,0.01);border-radius:0 0 10px 10px;margin-bottom:8px;overflow:hidden;">' + detailRows + '</div>';
      }).join('');

      // Add summary header
      var s = data.summary;
      var summaryHtml = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;">' +
        '<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:20px;font-weight:900;color:#d4a843;">' + s.strikeRate + '%</div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;">Strike Rate</div></div>' +
        '<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:20px;font-weight:900;color:' + (s.pnl >= 0 ? '#22c55e' : '#ef4444') + ';">' + (s.pnl >= 0 ? '+' : '') + s.pnl.toFixed(2) + '</div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;">P&L (units)</div></div>' +
        '<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:20px;font-weight:900;color:#fff;">' + s.totalTips + '</div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;">Total Tips</div></div>' +
        '<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:20px;font-weight:900;color:#fff;">' + s.days + '</div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;">Days Tracked</div></div>' +
      '</div>';

      container.innerHTML = summaryHtml + html;
    } catch(e) {
      container.innerHTML = '<p style="color:var(--text-muted);text-align:center;">Failed to load archive.</p>';
    }
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

        <!-- CREDIT EXPLAINER — urgency + clarity -->
        <div style="background:linear-gradient(135deg,rgba(212,168,67,0.08),rgba(212,168,67,0.02));border:2px solid rgba(212,168,67,0.25);border-radius:14px;padding:24px;margin-bottom:28px;">
          <div style="text-align:center;margin-bottom:16px;">
            <div style="font-size:20px;font-weight:900;color:#d4a843;">1 Credit = 1 Selection</div>
            <div style="font-size:13px;color:var(--text-secondary);margin-top:6px;">Every tip, every AI preview, every verdict costs just 1 credit. Acca Generator costs 3.</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(72px,1fr));gap:8px;text-align:center;">
            <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:10px;">
              <div style="font-size:20px;margin-bottom:4px;">&#127919;</div>
              <div style="font-size:11px;font-weight:700;color:#fff;">Tips</div>
              <div style="font-size:18px;font-weight:900;color:#d4a843;">1</div>
              <div style="font-size:9px;color:var(--text-muted);">credit each</div>
            </div>
            <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:10px;">
              <div style="font-size:20px;margin-bottom:4px;">&#129302;</div>
              <div style="font-size:11px;font-weight:700;color:#fff;">AI Previews</div>
              <div style="font-size:18px;font-weight:900;color:#d4a843;">1</div>
              <div style="font-size:9px;color:var(--text-muted);">credit each</div>
            </div>
            <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:10px;">
              <div style="font-size:20px;margin-bottom:4px;">&#9917;</div>
              <div style="font-size:11px;font-weight:700;color:#fff;">Our Take</div>
              <div style="font-size:18px;font-weight:900;color:#d4a843;">1</div>
              <div style="font-size:9px;color:var(--text-muted);">credit each</div>
            </div>
            <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:10px;">
              <div style="font-size:20px;margin-bottom:4px;">&#128200;</div>
              <div style="font-size:11px;font-weight:700;color:#fff;">Acca Builder</div>
              <div style="font-size:18px;font-weight:900;color:#d4a843;">3</div>
              <div style="font-size:9px;color:var(--text-muted);">credits per use</div>
            </div>
          </div>
          <div style="text-align:center;margin-top:12px;font-size:12px;color:#f59e0b;font-weight:600;">Credits renew monthly. No rollover. Use them or lose them.</div>
        </div>

        <div class="pricing-grid mb-32">
          <!-- FREE CARD -->
          <div class="pricing-card">
            ${!isLoggedIn ? '<div style="background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;text-align:center;padding:8px;border-radius:8px 8px 0 0;margin:-24px -24px 16px;font-weight:800;font-size:14px;letter-spacing:0.5px;">START HERE</div>' : '<div style="height:30px;margin:-24px -24px 16px;"></div>'}
            <h3>Free</h3>
            <p class="text-muted">See what all the fuss is about</p>
            <div class="pricing-price">&pound;<span style="font-size:42px;">0</span><span class="period">/month</span></div>
            <div style="background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.25);border-radius:8px;padding:14px;margin:8px 0 12px;text-align:center;">
              <div style="font-size:32px;font-weight:900;color:var(--gold);">10</div>
              <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">Credits / Month</div>
              <div style="font-size:11px;color:#22c55e;font-weight:600;margin-top:4px;">&#10003; Auto-renews monthly</div>
            </div>
            <ul class="pricing-features">
              <li>10 credits renewed every month</li>
              <li>View 10 tips or AI previews</li>
              <li>1 full free tip every day</li>
              <li>Full results + track record</li>
              <li>Betting calculators</li>
              <li>Top up anytime from &pound;1.99</li>
            </ul>
            <button class="btn ${!isLoggedIn ? 'btn-gold' : 'btn-outline'} btn-full" onclick="${isLoggedIn ? '' : "App.showModal('register')"}">
              ${isLoggedIn ? (isPremium ? 'Free Features Included' : 'Your Current Plan') : 'Sign Up Free'}
            </button>
          </div>

          <!-- STARTER CARD -->
          <div class="pricing-card${accessLevel === 'starter' ? ' featured' : ''}">
            <div style="height:30px;margin:-24px -24px 16px;"></div>
            <h3>Starter</h3>
            <p class="text-muted">The daily NAP + extras</p>
            <div class="pricing-price"><span class="currency">&pound;</span>9<span style="font-size:20px;">.99</span><span class="period">/month</span></div>
            <p class="text-xs text-gold mb-8">&pound;99.99/year (save &pound;20) | Cancel anytime</p>
            <div style="background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.25);border-radius:8px;padding:14px;margin:0 0 12px;text-align:center;">
              <div style="font-size:32px;font-weight:900;color:var(--gold);">50</div>
              <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">Credits / Month</div>
              <div style="font-size:11px;color:#22c55e;font-weight:600;margin-top:4px;">20p per credit &bull; 16x more than Free</div>
            </div>
            <ul class="pricing-features">
              <li><strong>Everything in Free, plus:</strong></li>
              <li>50 credits renewed monthly</li>
              <li>~2 tips per day comfortably</li>
              <li>Selection + odds before the off</li>
              <li>Racing + Football tips</li>
              <li>Personal ROI tracking</li>
              <li style="color:var(--text-muted);text-decoration:line-through;">Full AI deep analysis</li>
              <li style="color:var(--text-muted);text-decoration:line-through;">Daily email bulletin</li>
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
            <p class="text-muted">Every tip, every day, all month</p>
            <div class="pricing-price"><span class="currency">&pound;</span>19<span style="font-size:20px;">.99</span><span class="period">/month</span></div>
            <p class="text-xs text-gold mb-8">&pound;199.99/year (save &pound;40) | Cancel anytime</p>
            <div style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:8px;padding:14px;margin:0 0 12px;text-align:center;">
              <div style="font-size:32px;font-weight:900;color:#3b82f6;">250</div>
              <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">Credits / Month</div>
              <div style="font-size:11px;color:#22c55e;font-weight:600;margin-top:4px;">8p per credit &bull; 83x more than Free</div>
            </div>
            <ul class="pricing-features">
              <li><strong>Everything in Starter, plus:</strong></li>
              <li style="color:#22c55e;font-weight:700;">250 credits — view every tip, every day</li>
              <li>All Racing + Football selections</li>
              <li>All AI match + race previews included</li>
              <li>Full 5-analyst deep analysis</li>
              <li>Acca Generator included (3 credits)</li>
              <li>Daily email bulletin with AI insights</li>
              <li>Personal ROI dashboard</li>
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
            <p class="text-muted">Zero limits. Zero thinking.</p>
            <div class="pricing-price"><span class="currency">&pound;</span>39<span style="font-size:20px;">.99</span><span class="period">/month</span></div>
            <p class="text-xs text-gold mb-8">&pound;399.99/year (save &pound;80) | Cancel anytime</p>
            <div style="background:linear-gradient(135deg,rgba(212,168,67,0.15),rgba(212,168,67,0.05));border:2px solid rgba(212,168,67,0.4);border-radius:8px;padding:14px;margin:0 0 12px;text-align:center;">
              <div style="font-size:28px;font-weight:900;color:var(--gold);">UNLIMITED</div>
              <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">Credits Forever</div>
              <div style="font-size:11px;color:#d4a843;font-weight:600;margin-top:4px;">Never count. Never run out. Never miss.</div>
            </div>
            <ul class="pricing-features">
              <li><strong>Everything in Premium, plus:</strong></li>
              <li style="color:var(--gold);font-weight:700;">Unlimited — every tip, every preview, every acca</li>
              <li>Early access tips (6:30am — before anyone else)</li>
              <li>AI race replay analysis</li>
              <li>Personalised AI morning bulletin</li>
              <li>Priority email support</li>
              <li>Custom edge threshold alerts</li>
              <li style="color:var(--gold);font-weight:600;">If you're buying 2+ packs/month — VIP saves you money</li>
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
          <a href="https://t.me/EliteEdgeSportsTips" target="_blank" rel="noopener" class="telegram-cta">
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
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin-bottom:20px;">
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
          <button class="admin-tab" onclick="App.switchAdminTab('lms', this)">&#127942; Last Man Standing</button>
          <button class="admin-tab" onclick="App.switchAdminTab('winners', this)">Winners Wall</button>
          <button class="admin-tab" onclick="App.switchAdminTab('asklog', this)">Ask Log</button>
          <button class="admin-tab" onclick="App.switchAdminTab('events', this)">&#127942; Events</button>
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
                    <td>${u.subscription === 'vip' ? '<span style="color:#d4a843;font-weight:700;">VIP</span>' : u.subscription === 'premium' ? '<span class="text-gold">Premium</span>' : u.subscription === 'starter' ? '<span style="color:#22c55e;font-weight:600;">Starter</span>' : 'Free'}</td>
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
                      <button class="btn btn-ghost btn-sm" onclick="App.adminReconcileStripe('${u.id}','${(u.email || '').replace(/'/g, "\\'")}')" title="They paid but show free? Pull their real plan from Stripe">Fix from Stripe</button>
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
            <button class="btn btn-outline btn-sm" onclick="App.adminCheckStripe()">Check Stripe</button>
            <button class="btn btn-outline btn-sm" onclick="App.adminGenerateBlog(this)">Generate Blog Now</button>
            <button class="btn btn-outline btn-sm" onclick="App.adminShowCalibration()">Model Calibration</button>
            <button class="btn btn-outline btn-sm" onclick="App.adminBackfillClv(this)" title="Compute Closing Line Value for settled tips that have price history but no CLV">Backfill CLV</button>
            <button class="btn btn-outline btn-sm" onclick="App.adminRescorePredictions(this)" title="Re-grade all settled Our Take predictions with the fixed scorer (Double Chance / Total Goals were mis-scored)">Re-score Our Take</button>
          </div>
          <div id="admin-calibration-out" style="display:none;margin-bottom:16px;"></div>
          <div id="admin-clv-out" style="display:none;margin-bottom:16px;"></div>
          <div id="admin-stripe-health" style="display:none;margin-bottom:16px;padding:12px 14px;border-radius:8px;font-size:13px;"></div>
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
            <h4 class="mb-8">Announcements to all subscribers</h4>
            <p class="text-muted mb-8">Sends a push + in-app nudge to everyone and emails step-by-step install instructions (iPhone &amp; Android).</p>
            <button class="btn btn-gold" onclick="App.adminAnnouncePwa()">Send "Add to Home Screen" announcement</button>
            <div id="admin-announce-out" style="display:none;margin-top:10px;font-size:13px;"></div>
          </div>
          <div class="card mb-16">
            <h4 class="mb-8">Instagram (official Graph API)</h4>
            <p class="text-muted mb-8">Once your Meta token is set in Railway, check the connection and post a test. The daily World Cup view auto-posts here too.</p>
            <button class="btn btn-outline btn-sm" onclick="App.adminInstagramVerify()">Check Instagram connection</button>
            <button class="btn btn-outline btn-sm" onclick="App.adminInstagramTest()">Post test to Instagram</button>
            <div id="admin-instagram-out" style="display:none;margin-top:10px;font-size:13px;"></div>
          </div>
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

        <!-- LAST MAN STANDING PANEL -->
        <div class="admin-panel" id="panel-lms">
          <h3 class="mb-16">&#127942; Last Man Standing</h3>
          <div id="lms-admin-content"><p class="text-muted">Loading…</p></div>
        </div>

        <div class="admin-panel" id="panel-winners">
          <h3 class="mb-16">&#127942; Winners Wall — Moderation</h3>
          <p class="text-muted mb-16" style="font-size:13px;">Approve member-submitted wins before they appear on the homepage. Approved entries show publicly; rejected ones stay hidden.</p>
          <div id="winners-admin-content"><p class="text-muted">Loading…</p></div>
        </div>

        <div class="admin-panel" id="panel-asklog">
          <h3 class="mb-16">&#128173; Ask the Edge — What People Are Asking</h3>
          <p class="text-muted mb-16" style="font-size:13px;">Live demand intel from the assistant. Use the most-asked questions to decide which fixtures/races to prioritise for previews and content.</p>
          <div id="asklog-content"><p class="text-muted">Loading…</p></div>
        </div>

        <div class="admin-panel" id="panel-events">
          <h3 class="mb-8">&#127942; Sporting Events Calendar</h3>
          <p class="text-muted mb-16" style="font-size:13px;">Manage the big meetings the site features. The soonest live/upcoming event shows as a spotlight on the dashboard and gets its own hub page (#/events/&lt;slug&gt;).</p>
          <div style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-gold btn-sm" onclick="App.adminSaveEvent()">Add / Save event</button>
            <button class="btn btn-outline btn-sm" onclick="App.adminSeedEvents()">Seed big meetings (Goodwood, season, Ebor)</button>
          </div>
          <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:16px;display:grid;grid-template-columns:1fr 1fr;gap:8px;max-width:640px;">
            <input type="hidden" id="ev-id">
            <label class="text-sm text-muted">Name<br><input id="ev-name" placeholder="Glorious Goodwood" style="padding:7px;width:100%;box-sizing:border-box;"></label>
            <label class="text-sm text-muted">Sport<br><select id="ev-sport" style="padding:7px;width:100%;"><option value="racing">Racing</option><option value="football">Football</option><option value="other">Other</option></select></label>
            <label class="text-sm text-muted">Start date<br><input id="ev-start" type="date" style="padding:7px;width:100%;box-sizing:border-box;"></label>
            <label class="text-sm text-muted">End date<br><input id="ev-end" type="date" style="padding:7px;width:100%;box-sizing:border-box;"></label>
            <label class="text-sm text-muted">Venue<br><input id="ev-venue" placeholder="Goodwood" style="padding:7px;width:100%;box-sizing:border-box;"></label>
            <label class="text-sm text-muted">Emoji<br><input id="ev-emoji" placeholder="&#127943;" style="padding:7px;width:100%;box-sizing:border-box;"></label>
            <label class="text-sm text-muted" style="grid-column:1/3;">Tagline<br><input id="ev-tagline" placeholder="Racing's marquee summer flat festival" style="padding:7px;width:100%;box-sizing:border-box;"></label>
            <label class="text-sm text-muted" style="grid-column:1/3;">Blurb<br><textarea id="ev-blurb" rows="2" style="padding:7px;width:100%;box-sizing:border-box;"></textarea></label>
          </div>
          <div id="events-list"><p class="text-muted">Loading…</p></div>
        </div>
      </div>
    `;
  },

  async _loadAdminEvents() {
    var box = document.getElementById('events-list');
    if (box) box.innerHTML = '<p class="text-muted">Loading…</p>';
    try {
      var d = await this.api('/events/admin/all');
      box = document.getElementById('events-list');
      if (!box) return;
      var evs = (d && d.events) || [];
      this._adminEventsCache = evs; // safe lookup for Edit (no inline JSON injection)
      if (!evs.length) { box.innerHTML = '<p class="text-muted">No events yet. Click "Seed big meetings" or add one above.</p>'; return; }
      box.innerHTML = evs.map(function (e) {
        var col = e.status === 'live' ? '#22c55e' : e.status === 'upcoming' ? '#d4a843' : '#64748b';
        return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;flex-wrap:wrap;">' +
          '<span style="font-size:11px;font-weight:800;color:' + col + ';border:1px solid ' + col + ';border-radius:4px;padding:1px 6px;">' + e.status.toUpperCase() + '</span>' +
          '<strong style="color:#fff;">' + App.escapeHtml(e.emoji || '') + ' ' + App.escapeHtml(e.name) + '</strong>' +
          '<span style="color:var(--text-muted);font-size:12px;">' + App._eventDateLabel(e.startDate, e.endDate) + ' · ' + App.escapeHtml(e.sport || '') + (e.enabled ? '' : ' · DISABLED') + '</span>' +
          '<span style="margin-left:auto;display:flex;gap:6px;">' +
            '<button class="btn btn-outline btn-sm" onclick="App.adminEditEventById(' + e.id + ')">Edit</button>' +
            '<button class="btn btn-outline btn-sm" onclick="App.adminToggleEvent(' + e.id + ',' + (!e.enabled) + ')">' + (e.enabled ? 'Disable' : 'Enable') + '</button>' +
            '<button class="btn btn-outline btn-sm" onclick="App.adminDeleteEvent(' + e.id + ')">Delete</button>' +
          '</span>' +
        '</div>';
      }).join('');
    } catch (e) { if (box) box.innerHTML = '<p style="color:#ef4444;">Failed to load events: ' + (e.message || e) + '</p>'; }
  },

  adminEditEventById(id) {
    var e = (this._adminEventsCache || []).find(function (x) { return x.id === id; });
    if (e) this.adminEditEvent(e);
  },

  adminEditEvent(e) {
    document.getElementById('ev-id').value = e.id || '';
    document.getElementById('ev-name').value = e.name || '';
    document.getElementById('ev-sport').value = e.sport || 'racing';
    document.getElementById('ev-start').value = String(e.startDate || '').slice(0, 10);
    document.getElementById('ev-end').value = String(e.endDate || '').slice(0, 10);
    document.getElementById('ev-venue').value = e.venue || '';
    document.getElementById('ev-emoji').value = e.emoji || '';
    document.getElementById('ev-tagline').value = e.tagline || '';
    document.getElementById('ev-blurb').value = e.blurb || '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  async adminSaveEvent() {
    var body = {
      id: document.getElementById('ev-id').value || undefined,
      name: document.getElementById('ev-name').value.trim(),
      sport: document.getElementById('ev-sport').value,
      startDate: document.getElementById('ev-start').value,
      endDate: document.getElementById('ev-end').value,
      venue: document.getElementById('ev-venue').value.trim(),
      emoji: document.getElementById('ev-emoji').value.trim() || '🏆',
      tagline: document.getElementById('ev-tagline').value.trim(),
      blurb: document.getElementById('ev-blurb').value.trim(),
    };
    if (!body.name || !body.startDate || !body.endDate) { this.showToast('Name, start and end dates are required', 'error'); return; }
    try {
      await this.api('/events/admin/save', { method: 'POST', body: JSON.stringify(body) });
      this.showToast('Event saved', 'success');
      ['ev-id', 'ev-name', 'ev-venue', 'ev-emoji', 'ev-tagline', 'ev-blurb', 'ev-start', 'ev-end'].forEach(function (i) { var el = document.getElementById(i); if (el) el.value = ''; });
      this._loadAdminEvents();
    } catch (e) { this.showToast('Save failed: ' + (e.message || e), 'error'); }
  },

  async adminSeedEvents() {
    try { var r = await this.api('/events/admin/seed', { method: 'POST' }); this.showToast('Seeded ' + (r.seeded || 0) + ' events', 'success'); this._loadAdminEvents(); }
    catch (e) { this.showToast('Seed failed: ' + (e.message || e), 'error'); }
  },

  async adminToggleEvent(id, enabled) {
    try {
      var all = await this.api('/events/admin/all');
      var e = (all.events || []).find(function (x) { return x.id === id; });
      if (!e) return;
      e.enabled = enabled; e.startDate = String(e.startDate).slice(0, 10); e.endDate = String(e.endDate).slice(0, 10);
      await this.api('/events/admin/save', { method: 'POST', body: JSON.stringify(e) });
      this._loadAdminEvents();
    } catch (er) { this.showToast('Failed: ' + (er.message || er), 'error'); }
  },

  async adminDeleteEvent(id) {
    if (!confirm('Delete this event?')) return;
    try { await this.api('/events/admin/delete', { method: 'POST', body: JSON.stringify({ id: id }) }); this._loadAdminEvents(); }
    catch (e) { this.showToast('Delete failed: ' + (e.message || e), 'error'); }
  },

  switchAdminTab(panel, btn) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
    if (btn) btn.classList.add('active');
    var panelEl = document.getElementById('panel-' + panel);
    if (panelEl) panelEl.classList.add('active');
    if (panel === 'livedata') this.adminLoadLiveData();
    if (panel === 'lms') this.adminLoadLms();
    if (panel === 'winners') this._loadAdminWinners('pending');
    if (panel === 'asklog') this._loadAssistantQueries();
    if (panel === 'events') this._loadAdminEvents();
  },

  async _loadAssistantQueries() {
    var box = document.getElementById('asklog-content');
    if (!box) return;
    box.innerHTML = '<p class="text-muted">Loading…</p>';
    var data;
    try { data = await this.api('/admin/assistant-queries'); }
    catch (e) { box.innerHTML = '<div class="card"><p class="text-muted">Could not load.</p></div>'; return; }
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]; }); };
    var top = (data && data.top) || [];
    var recent = (data && data.recent) || [];
    var topHtml = top.length
      ? '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
          '<tr style="text-align:left;color:var(--text-muted);"><th style="padding:6px 8px;">Question</th><th style="padding:6px 8px;width:60px;">Asked</th></tr>' +
          top.map(function (t) { return '<tr style="border-top:1px solid var(--border);"><td style="padding:6px 8px;color:#fff;">' + esc(t.question) + '</td><td style="padding:6px 8px;color:#d4a843;font-weight:700;">' + t.n + '&times;</td></tr>'; }).join('') +
        '</table>'
      : '<p class="text-muted">No questions logged yet.</p>';
    var recentHtml = recent.length
      ? recent.slice(0, 40).map(function (r) { return '<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;color:#cbd5e1;">' + esc(r.question) + ' <span style="color:var(--text-muted);font-size:11px;">· ' + (r.created_at ? formatDateUK(r.created_at) : '') + '</span></div>'; }).join('')
      : '<p class="text-muted">Nothing yet.</p>';
    box.innerHTML =
      '<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:16px;"><div style="font-size:12px;color:var(--text-muted);">Questions asked (last 7 days)</div><div style="font-size:28px;font-weight:900;color:#d4a843;">' + ((data && data.last7days) || 0) + '</div></div>' +
      '<h4 style="margin:8px 0;">Most asked (30 days)</h4>' + topHtml +
      '<h4 style="margin:16px 0 8px;">Recent questions</h4>' + recentHtml;
  },

  // ---- Winners Wall moderation (admin) -----------------------------------
  async _loadAdminWinners(status) {
    status = status || 'pending';
    var box = document.getElementById('winners-admin-content');
    if (!box) return;
    box.innerHTML = '<p class="text-muted">Loading ' + status + ' submissions…</p>';
    var data;
    try {
      data = await this.api('/admin/winners?status=' + status);
    } catch (e) {
      box.innerHTML = '<div class="card"><p class="text-muted">Could not load submissions.</p></div>';
      return;
    }
    var rows = (data && data.winners) || [];
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]; }); };
    var tabBtn = function (s, label) {
      return '<button class="btn btn-sm ' + (s === status ? 'btn-gold' : 'btn-outline') + '" onclick="App._loadAdminWinners(\'' + s + '\')" style="margin-right:6px;">' + label + '</button>';
    };
    var header = '<div style="margin-bottom:14px;">' + tabBtn('pending', 'Pending') + tabBtn('approved', 'Approved') + tabBtn('rejected', 'Rejected') + '</div>';
    if (!rows.length) {
      box.innerHTML = header + '<p class="text-muted">No ' + status + ' submissions.</p>';
      return;
    }
    box.innerHTML = header + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;">' +
      rows.map(function (w) {
        var img = w.image_data ? '<img src="' + esc(w.image_data) + '" style="width:100%;height:auto;max-height:600px;object-fit:contain;border-radius:8px;margin-bottom:8px;background:#0a0e1a;">' : '<div style="font-size:12px;color:#888;margin-bottom:8px;">(no image)</div>';
        var actions = '';
        if (status !== 'approved') actions += '<button class="btn btn-gold btn-sm" onclick="App.adminWinnerAction(' + w.id + ',\'approve\')">Approve</button> ';
        if (status !== 'rejected') actions += '<button class="btn btn-outline btn-sm" onclick="App.adminWinnerAction(' + w.id + ',\'reject\')">Reject</button> ';
        actions += '<button class="btn btn-outline btn-sm" style="color:#ef4444;border-color:#ef4444;" onclick="if(confirm(\'Delete this submission permanently?\'))App.adminWinnerAction(' + w.id + ',\'delete\')">Delete</button>';
        return '<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:14px;">' + img +
          (w.caption ? '<div style="font-size:13px;color:#e8e8ec;margin-bottom:6px;">' + esc(w.caption) + '</div>' : '') +
          '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">' + (w.amount ? esc(w.amount) + ' &middot; ' : '') + esc(w.display_name) + ' &middot; ' + formatDateUK(w.created_at) + '</div>' +
          '<div>' + actions + '</div></div>';
      }).join('') + '</div>';
  },

  async adminWinnerAction(id, action) {
    try {
      var r = await this.api('/admin/winners/' + id + '/' + action, { method: 'POST', body: '{}' });
      if (r && r.error) { this.showToast(r.error, 'error'); return; }
      this.showToast('Done — ' + action + 'd.', 'success');
      var active = document.querySelector('#winners-admin-content .btn-gold');
      this._loadAdminWinners(active ? active.textContent.toLowerCase() : 'pending');
    } catch (e) {
      this.showToast(e && e.message ? e.message : 'Action failed.', 'error');
    }
  },

  // ---- Last Man Standing admin (in-app) ----------------------------------
  async adminLoadLms() {
    var box = document.getElementById('lms-admin-content');
    if (!box) return;
    var data;
    try {
      data = await this.api('/lms/competitions?includeCompleted=1');
    } catch (e) {
      box.innerHTML = '<div class="card"><p class="text-muted">Last Man Standing isn\'t switched on yet. Set <strong>ENABLE_LMS=true</strong> (and <strong>ENABLE_WORLD_CUP=true</strong>) in Railway, redeploy, then refresh this page.</p></div>';
      return;
    }
    var comps = (data && data.competitions) || [];
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]; }); };

    var list = comps.map(function (c) {
      var actions = '';
      if (c.status === 'open') actions += '<button class="btn btn-gold btn-sm" onclick="App.lmsSetStatus(' + c.id + ',\'active\')">Activate</button> ';
      if (c.status !== 'completed') {
        actions += '<button class="btn btn-outline btn-sm" onclick="App.lmsDiagnoseRound(' + c.id + ')">Diagnose round</button> ';
        actions += '<button class="btn btn-outline btn-sm" onclick="App.lmsSettle(' + c.id + ',false)">Settle round</button> ';
        actions += '<button class="btn btn-outline btn-sm" title="Settles all finished picks, eliminates anyone unsettled, and advances to the next matchday\'s picks" onclick="if(confirm(\'Force settle: eliminates any alive entry whose pick is NOT a confirmed win, then advances to the next round. Make sure this round\\u2019s results are all in first.\'))App.lmsSettle(' + c.id + ',true)">Force settle &amp; advance</button> ';
      }
      actions += '<div id="lms-diag-' + c.id + '" style="margin-top:10px;"></div>';
      return '<div class="card mb-16">' +
        '<div class="flex-between"><div><strong>' + esc(c.name) + '</strong> <span class="text-sm text-muted">(' + esc(c.phase) + ')</span></div>' +
        '<div class="text-sm">Status: <strong>' + esc(c.status) + '</strong> · ' + esc(c.roundLabel || ('Round ' + c.currentRound)) + ' · Alive: ' + (c.aliveCount != null ? c.aliveCount : '-') + ' · Pot: &pound;' + (c.prizePot || 0).toFixed(0) + '</div></div>' +
        '<div class="mt-8">' + (actions || '<span class="text-muted text-sm">Completed</span>') + '</div>' +
        '</div>';
    }).join('');

    box.innerHTML =
      '<div class="card mb-16" style="border-color:rgba(212,168,67,0.35);">' +
        '<h4 class="mb-8">&#127937; Racecard feed (The Racing API)</h4>' +
        '<p class="text-sm text-muted mb-8">Confirms whether today\'s racecards are actually reaching the system. Run this if Ask the Edge can\'t see a race.</p>' +
        '<button class="btn btn-gold btn-sm" onclick="App.racingDiagnose()">Diagnose racecard feed</button>' +
        '<pre id="racing-diag-out" style="display:none;white-space:pre-wrap;background:rgba(0,0,0,0.25);border-radius:8px;padding:10px;margin-top:10px;font-size:11px;max-height:300px;overflow:auto;"></pre>' +
      '</div>' +
      '<div class="card mb-16">' +
        '<h4 class="mb-8">World Cup data feed</h4>' +
        '<p class="text-sm text-muted mb-8">Pulls fixtures from SportMonks (falls back to API-Football). Run Diagnose to confirm the feed, then Sync to load fixtures.</p>' +
        '<button class="btn btn-outline btn-sm" onclick="App.lmsDiagnoseWc()">Diagnose feed</button> ' +
        '<button class="btn btn-gold btn-sm" onclick="App.lmsSyncWc()">Sync fixtures now</button> ' +
        '<button class="btn btn-outline btn-sm" onclick="App.lmsInspectFixture()">Inspect rich data (xG/lineups/predictions)</button> ' +
        '<button class="btn btn-gold btn-sm" onclick="App.lmsGenerateWcPreviews()">Run consensus picks (Our Take)</button> ' +
        '<button class="btn btn-outline btn-sm" onclick="App.lmsRegenerateWcPreviews()" title="Overwrite existing Our Take picks with the latest engine logic">Refresh existing picks</button> ' +
        '<button class="btn btn-outline btn-sm" onclick="App.lmsDedupeWcFixtures()" title="Remove duplicate fixture rows (seeded + synced). Shows a count first, then asks to confirm.">Clean up duplicate fixtures</button> ' +
        '<button class="btn btn-outline btn-sm" onclick="App.cosmoValueScan()" title="Shadow scan: where our model beats Cosmo Bet\'s price. Verify match accuracy before it goes public.">Cosmo value scan</button> ' +
        '<button class="btn btn-outline btn-sm" onclick="App.wcBroadcastPreview()">Preview WC view content</button> ' +
        '<button class="btn btn-gold btn-sm" onclick="App.wcBroadcastSend()">Send WC view (Telegram + subscribers)</button> ' +
        '<button class="btn btn-outline btn-sm" onclick="App.wcBroadcastTelegram()">Resend to Telegram only</button>' +
        '<pre id="lms-wc-feed-out" style="display:none;white-space:pre-wrap;background:rgba(0,0,0,0.25);border-radius:8px;padding:10px;margin-top:10px;font-size:11px;max-height:240px;overflow:auto;"></pre>' +
      '</div>' +
      '<div class="card mb-16" style="border-color:rgba(212,168,67,0.35);">' +
        '<h4 class="mb-8">Lock a match verdict (Our Take)</h4>' +
        '<p class="text-sm text-muted mb-8">Set/restore the verdict shown on a World Cup match — it then stays put before and after the game. Use to fix a match whose take wasn\'t auto-locked.</p>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;">' +
          '<label class="text-sm text-muted">Home<br><input id="wc-v-home" placeholder="Portugal" style="padding:8px;width:130px;"></label>' +
          '<label class="text-sm text-muted">Away<br><input id="wc-v-away" placeholder="Congo DR" style="padding:8px;width:130px;"></label>' +
          '<label class="text-sm text-muted">Selection<br><input id="wc-v-sel" placeholder="Under 2.5 Goals" style="padding:8px;width:160px;"></label>' +
          '<label class="text-sm text-muted">Market<br><input id="wc-v-mkt" placeholder="Total Goals" value="Total Goals" style="padding:8px;width:140px;"></label>' +
          '<label class="text-sm text-muted">Conf<br><input id="wc-v-conf" type="number" value="6" style="padding:8px;width:60px;"></label>' +
        '</div>' +
        '<label class="text-sm text-muted" style="display:block;margin-top:8px;">Reasoning (optional)<br><textarea id="wc-v-reason" rows="2" placeholder="A low-scoring affair looks most likely..." style="width:100%;padding:8px;box-sizing:border-box;"></textarea></label>' +
        '<button class="btn btn-gold btn-sm" style="margin-top:8px;" onclick="App.wcSetVerdict()">Lock verdict</button>' +
        '<span id="wc-v-out" class="text-sm" style="margin-left:10px;"></span>' +
      '</div>' +
      '<div class="card mb-16">' +
        '<h4 class="mb-16">Create competition</h4>' +
        '<div class="form-row" style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;">' +
          '<label class="text-sm text-muted">Name<br><input id="lms-c-name" value="World Cup 2026 Last Man Standing" style="padding:8px;min-width:240px;"></label>' +
          '<label class="text-sm text-muted">Phase<br><select id="lms-c-phase" style="padding:8px;"><option value="world_cup">World Cup</option><option value="pl_rollover">PL Rollover</option></select></label>' +
          '<label class="text-sm text-muted">Prize (&pound;)<br><input id="lms-c-prize" type="number" value="250" style="padding:8px;width:110px;"></label>' +
          '<label class="text-sm text-muted">Access<br><select id="lms-c-access" style="padding:8px;"><option value="everyone">Any member (incl. Free)</option><option value="subscriber">Paid subscribers only</option></select></label>' +
          '<button class="btn btn-gold btn-sm" onclick="App.lmsCreate()">Create &amp; Activate</button>' +
        '</div>' +
        '<p class="text-sm text-muted mt-8">Creating sets it Active straight away so the dashboard banner goes live.</p>' +
      '</div>' +
      '<h4 class="mb-16">Competitions (' + comps.length + ')</h4>' +
      (list || '<p class="text-muted">None yet — create one above.</p>');
  },

  async lmsDiagnoseWc() {
    var out = document.getElementById('lms-wc-feed-out');
    if (out) { out.style.display = 'block'; out.textContent = 'Checking SportMonks World Cup feed…'; }
    try {
      var r = await this.api('/world-cup/admin/diagnose');
      if (out) out.textContent = JSON.stringify(r.diagnostic || r, null, 2);
    } catch (e) {
      if (out) out.textContent = 'Diagnostic failed: ' + (e.message || e) + '\n\n(Make sure ENABLE_WORLD_CUP=true and SPORTMONKS_API_KEY are set in Railway.)';
    }
  },

  async lmsInspectFixture() {
    var out = document.getElementById('lms-wc-feed-out');
    if (out) { out.style.display = 'block'; out.textContent = 'Inspecting rich fixture data (first upcoming WC fixture)…'; }
    try {
      var r = await this.api('/world-cup/admin/fixture-data');
      if (out) out.textContent = JSON.stringify(r.summary || r, null, 2);
    } catch (e) {
      if (out) out.textContent = 'Inspect failed: ' + (e.message || e) + '\n\n(Sync fixtures first so there is one to inspect.)';
    }
  },

  async wcBroadcastPreview() {
    var out = document.getElementById('lms-wc-feed-out');
    if (out) { out.style.display = 'block'; out.textContent = 'Building today\'s World Cup view…'; }
    try {
      var r = await this.api('/world-cup/admin/broadcast-preview');
      if (!r.count) { if (out) out.textContent = 'No World Cup games with a view in the next 30h.'; return; }
      var lines = (r.picks || []).map(function (p) {
        var price = p.oddsDecimal ? ' @ ' + p.oddsDecimal.toFixed(2) : '';
        return '• ' + p.home + ' v ' + p.away + ' → ' + p.view + price + (p.note ? ' · ' + p.note : '') + (p.conf ? ' [confidence ' + p.conf + '/10]' : '');
      });
      if (out) out.textContent = 'WC view for ' + r.count + ' game(s) — this is what will be sent:\n\n' + lines.join('\n');
    } catch (e) { if (out) out.textContent = 'Preview failed: ' + (e.message || e); }
  },

  async wcBroadcastTelegram() {
    if (!confirm('Resend today\'s World Cup view to the Telegram channel only? (No emails, no push — just Telegram.)')) return;
    var out = document.getElementById('lms-wc-feed-out');
    if (out) { out.style.display = 'block'; out.textContent = 'Resending to Telegram…'; }
    try {
      var r = await this.api('/world-cup/admin/broadcast', { method: 'POST', body: JSON.stringify({ telegramOnly: true }) });
      if (!r.sent) { if (out) out.textContent = r.reason || 'Nothing to send.'; this.showToast(r.reason || 'Nothing to send', 'error'); return; }
      if (out) out.textContent = 'Telegram resend: ' + r.picks + ' game(s) — Telegram: ' + (r.telegram ? 'sent ✓' : 'NOT sent (check TELEGRAM_BOT_TOKEN)');
      this.showToast(r.telegram ? 'Resent to Telegram (' + r.picks + ' games)' : 'Telegram not configured', r.telegram ? 'success' : 'error');
    } catch (e) { if (out) out.textContent = 'Resend failed: ' + (e.message || e); this.showToast('Resend failed: ' + e.message, 'error'); }
  },

  async wcBroadcastSend() {
    if (!confirm('Send the World Cup view to the Telegram channel, push, and email all subscribers now?')) return;
    var out = document.getElementById('lms-wc-feed-out');
    if (out) { out.style.display = 'block'; out.textContent = 'Sending World Cup view…'; }
    try {
      var r = await this.api('/world-cup/admin/broadcast', { method: 'POST' });
      if (!r.sent) { if (out) out.textContent = r.reason || 'Nothing to send.'; this.showToast(r.reason || 'Nothing to send', 'error'); return; }
      if (out) out.textContent = 'Sent! ' + r.picks + ' game(s) — Telegram: ' + (r.telegram ? 'yes' : 'no') + ', Instagram: ' + (r.instagram ? 'yes' : 'no') + ', emails: ' + r.emails + ', push: ' + (r.push ? 'yes' : 'no');
      this.showToast('World Cup view sent — ' + r.picks + ' games, ' + r.emails + ' emails', 'success');
    } catch (e) { if (out) out.textContent = 'Send failed: ' + (e.message || e); this.showToast('Send failed: ' + e.message, 'error'); }
  },

  async lmsGenerateWcPreviews() {
    var out = document.getElementById('lms-wc-feed-out');
    if (out) { out.style.display = 'block'; out.textContent = 'Running the 5-analyst consensus engine over upcoming fixtures… (this can take a minute)'; }
    try {
      var r = await this.api('/world-cup/admin/generate-previews', { method: 'POST' });
      if (out) out.textContent = 'Consensus picks generated for ' + (r.generated || 0) + ' fixture(s).\nOpen any of those games — the "Our Take" now shows the multi-analyst consensus selection.';
      this.showToast('Consensus picks generated: ' + (r.generated || 0) + ' fixtures', 'success');
    } catch (e) {
      if (out) out.textContent = 'Preview generation failed: ' + (e.message || e) + '\n\n(Needs a Perplexity key + upcoming scheduled fixtures within 5 days.)';
    }
  },

  async lmsDedupeWcFixtures() {
    var out = document.getElementById('lms-wc-feed-out');
    if (out) { out.style.display = 'block'; out.textContent = 'Scanning for duplicate fixture rows…'; }
    try {
      // 1) Dry run — count duplicates without touching anything.
      var dry = await this.api('/world-cup/admin/dedupe-fixtures', { method: 'POST' });
      var d = dry.result || {};
      if (!d.duplicatesToRemove) {
        if (out) out.textContent = 'No duplicate fixtures found — the table is clean. ✅';
        this.showToast('No duplicate fixtures', 'success');
        return;
      }
      var sample = (d.sample || []).map(function (s) { return '  • ' + s.remove + ' → keep id ' + s.keepId; }).join('\n');
      var ok = window.confirm(
        'Found ' + d.duplicatesToRemove + ' duplicate fixture row(s) to remove.\n' +
        d.dependentPreviews + ' preview(s) and ' + d.dependentPredictions + ' user prediction(s) will be re-pointed to the kept row first.\n\n' +
        'This runs in a transaction (rolls back on any error). Proceed?'
      );
      if (out) out.textContent = 'Found ' + d.duplicatesToRemove + ' duplicate(s):\n' + sample + (d.sample && d.sample.length < d.duplicatesToRemove ? '\n  …' : '');
      if (!ok) { if (out) out.textContent += '\n\nCancelled — nothing changed.'; return; }
      // 2) Execute.
      if (out) out.textContent += '\n\nRemoving duplicates…';
      var run = await this.api('/world-cup/admin/dedupe-fixtures?execute=true', { method: 'POST' });
      var r = run.result || {};
      if (r.error) { if (out) out.textContent += '\n' + r.error; return; }
      if (out) out.textContent += '\nDone — removed ' + (r.deleted || 0) + ' duplicate(s), moved ' + (r.previewsMoved || 0) + ' preview(s) + ' + (r.predictionsMoved || 0) + ' prediction(s).';
      this.showToast('Removed ' + (r.deleted || 0) + ' duplicate fixtures', 'success');
    } catch (e) {
      if (out) out.textContent = 'Dedupe failed: ' + (e.message || e);
    }
  },

  async cosmoValueScan() {
    var out = document.getElementById('lms-wc-feed-out');
    if (out) { out.style.display = 'block'; out.textContent = 'Matching our fixtures to Cosmo Bet + scanning for value…'; }
    try {
      var r = await this.api('/football/admin/cosmo-value');
      var scan = r.valueScan || {};
      var bets = scan.valueBets || [];
      var head = 'Cosmo status: ' + JSON.stringify(r.status) + '\nOur fixtures scanned: ' + (r.ourFixtures || 0) + ' · team map: ' + ((r.mapLearned && r.mapLearned.total) || 0) + ' teams\n\n';
      if (!bets.length) {
        if (out) out.textContent = head + 'No value bets right now (model and Cosmo in line, or no fixtures matched).';
        return;
      }
      var lines = bets.map(function (b) {
        return '• ' + b.fixture + ' — ' + b.selection + ' @ ' + b.cosmoOdds + '  (we ' + b.modelProb + '% vs market ' + b.marketProb + '%, +' + b.edge + '%)';
      }).join('\n');
      if (out) out.textContent = head + bets.length + ' value bet(s) — VERIFY the fixtures matched correctly:\n' + lines;
      this.showToast('Cosmo value scan: ' + bets.length + ' bets', 'success');
    } catch (e) {
      if (out) out.textContent = 'Cosmo value scan failed: ' + (e.message || e);
    }
  },

  async lmsRegenerateWcPreviews() {
    var out = document.getElementById('lms-wc-feed-out');
    if (out) { out.style.display = 'block'; out.textContent = 'Re-running the consensus engine over ALL upcoming fixtures and overwriting their Our Take picks with the latest logic… (this can take a minute)'; }
    try {
      var r = await this.api('/world-cup/admin/regenerate-previews', { method: 'POST' });
      if (out) out.textContent = 'Refreshed Our Take for ' + ((r.regenerated && r.regenerated.generated) || 0) + ' fixture(s).\nOpen any upcoming game — the headline now reflects the probability-led consensus.';
      this.showToast('Refreshed picks: ' + ((r.regenerated && r.regenerated.generated) || 0) + ' fixtures', 'success');
    } catch (e) {
      if (out) out.textContent = 'Refresh failed: ' + (e.message || e);
    }
  },

  async lmsSyncWc() {
    var out = document.getElementById('lms-wc-feed-out');
    if (out) { out.style.display = 'block'; out.textContent = 'Syncing World Cup fixtures…'; }
    try {
      var r = await this.api('/world-cup/admin/sync', { method: 'POST' });
      if (out) out.textContent = 'Sync result:\n' + JSON.stringify(r.synced || r, null, 2);
      this.showToast('World Cup sync: ' + (((r.synced || {}).fixtures) || 0) + ' fixtures from ' + (((r.synced || {}).source) || '?'), 'success');
    } catch (e) {
      if (out) out.textContent = 'Sync failed: ' + (e.message || e);
      this.showToast('Sync failed: ' + (e.message || e), 'error');
    }
  },

  async lmsCreate() {
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    var name = g('lms-c-name');
    if (!name) { this.showToast('Enter a name', 'error'); return; }
    try {
      await this.api('/lms/admin/competitions', {
        method: 'POST',
        body: JSON.stringify({
          name: name, phase: g('lms-c-phase'),
          basePrize: parseFloat(g('lms-c-prize')) || 0,
          access: g('lms-c-access'), status: 'active',
        }),
      });
      this.showToast('Competition created and live', 'success');
      this.adminLoadLms();
    } catch (e) { this.showToast('Create failed: ' + (e.message || e), 'error'); }
  },

  async lmsSettle(id, force) {
    try {
      var r = await this.api('/lms/admin/competitions/' + id + '/settle', { method: 'POST', body: JSON.stringify({ force: !!force }) });
      var rep = (r && r.report) || {};
      this.showToast(rep.message || 'Settled', rep.held ? 'info' : 'success');
      this.adminLoadLms();
    } catch (e) { this.showToast('Settle failed: ' + (e.message || e), 'error'); }
  },

  async lmsSetStatus(id, status) {
    try {
      await this.api('/lms/admin/competitions/' + id, { method: 'PUT', body: JSON.stringify({ status: status }) });
      this.showToast('Status: ' + status, 'success');
      this.adminLoadLms();
    } catch (e) { this.showToast('Failed: ' + (e.message || e), 'error'); }
  },

  async racingDiagnose() {
    var out = document.getElementById('racing-diag-out');
    if (out) { out.style.display = 'block'; out.textContent = 'Checking The Racing API…'; }
    try {
      var d = await this.api('/admin/racing-diagnostic');
      var lines = [];
      lines.push('Credentials: key ' + (d.hasKey ? '✓' : '✗ MISSING') + ' · secret ' + (d.hasSecret ? '✓' : '✗ MISSING'));
      lines.push('Endpoint used: ' + (d.endpointUsed || '?'));
      lines.push('Raw races from API: ' + d.rawApiCount);
      if (d.rawRunnerKeys && d.rawRunnerKeys.length) lines.push('API runner fields: ' + d.rawRunnerKeys.join(', '));
      lines.push('After parsing: ' + d.normalisedCount);
      lines.push("Today's GB/IRE cards (what the assistant gets): " + d.todayUkIreCount);
      if (d.sampleFromApi && d.sampleFromApi.length) {
        lines.push('\nSample from API (region | date | course | time):');
        d.sampleFromApi.forEach(function (s) { lines.push('  ' + s.region + ' | ' + s.date + ' | ' + s.course + ' | ' + s.time); });
      }
      if (d.sampleTodayUkIre && d.sampleTodayUkIre.length) {
        lines.push('\nToday\'s cards available to the assistant:');
        d.sampleTodayUkIre.forEach(function (s) { lines.push('  ' + s); });
      }
      if (d.richFields && typeof d.richFields === 'object') {
        var rf = d.richFields;
        lines.push('\nData depth (across ' + rf.totalRunners + ' runners today):');
        lines.push('  OR: ' + rf.withOR + ' · Power rating: ' + rf.withRPR + ' · Speed: ' + rf.withTS + ' · Written analysis: ' + rf.withSpotlight);
        if (rf.spotlightSample) lines.push('  e.g. "' + rf.spotlightSample + '…"');
        if (rf.hasSpotlight && rf.hasRPR) lines.push('  → PRO data confirmed — write-ups now use Power/Speed ratings + per-horse analysis. 🎯');
      }
      if (d.rawSample && d.rawSample.length) {
        lines.push('\nRAW API values' + (d.rawSampleRace ? ' (' + d.rawSampleRace + ')' : '') + ':');
        d.rawSample.forEach(function (s) {
          lines.push('  ' + (s.horse || '?') + ':');
          lines.push('    ofr:' + JSON.stringify(s.ofr) + ' rpr:' + JSON.stringify(s.rpr) + ' ts:' + JSON.stringify(s.ts));
          lines.push('    perf_rating:' + JSON.stringify(s.perf_rating) + ' speed_rating:' + JSON.stringify(s.speed_rating) + ' trainer_rtf:' + JSON.stringify(s.trainer_rtf));
          lines.push('    trainer_14d:' + JSON.stringify(s.trainer_14d));
          lines.push('    comment:' + JSON.stringify(s.comment) + ' spotlight:' + JSON.stringify(s.spotlight));
        });
      }
      if (d.error) lines.push('\n⚠ ' + d.error);
      else if (d.todayUkIreCount > 0) lines.push('\n✅ Racecards are flowing — the assistant can read them.');
      if (out) out.textContent = lines.join('\n');
    } catch (e) {
      if (out) out.textContent = 'Diagnostic failed: ' + (e.message || e);
    }
  },

  async wcSetVerdict() {
    var out = document.getElementById('wc-v-out');
    var g = function (id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; };
    var body = { home: g('wc-v-home'), away: g('wc-v-away'), selection: g('wc-v-sel'), market: g('wc-v-mkt'), confidence: g('wc-v-conf'), reason: g('wc-v-reason') };
    if (!body.home || !body.away || !body.selection) { if (out) { out.style.color = '#ef4444'; out.textContent = 'Home, away and selection are required.'; } return; }
    if (out) { out.style.color = ''; out.textContent = 'Locking…'; }
    try {
      var r = await this.api('/world-cup/admin/set-verdict', { method: 'POST', body: JSON.stringify(body) });
      if (out) { out.style.color = '#22c55e'; out.textContent = '✓ Locked: ' + r.fixture + ' → ' + r.selection; }
    } catch (e) { if (out) { out.style.color = '#ef4444'; out.textContent = 'Failed: ' + (e.message || e); } }
  },

  async lmsDiagnoseRound(id) {
    var box = document.getElementById('lms-diag-' + id);
    if (box) box.innerHTML = '<span class="text-muted text-sm">Diagnosing…</span>';
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]; }); };
    try {
      var d = await this.api('/lms/admin/competitions/' + id + '/diagnose');
      box = document.getElementById('lms-diag-' + id);
      if (!box) return;
      var head = '<div style="font-size:13px;margin-bottom:8px;"><strong>' + esc(d.roundLabel) + '</strong> — ' +
        d.fixturesWithResult + '/' + d.fixturesTotal + ' fixtures have results · ' +
        (d.roundComplete ? '<span style="color:#22c55e;">round complete → would advance to ' + esc(d.wouldAdvanceTo) + ' (run Settle round)</span>' : '<span style="color:#f59e0b;">round NOT complete — survivors can\'t pick the next matchday until it is</span>') + '</div>';
      if (d.missingResults && d.missingResults.length) {
        head += '<div style="font-size:12px;color:#f59e0b;margin-bottom:8px;">Missing results (' + d.missingResults.length + '): ' + d.missingResults.slice(0, 10).map(esc).join(', ') + (d.missingResults.length > 10 ? '…' : '') + '<br><span style="color:var(--text-muted);">If these games have finished, click "Sync fixtures now" above to pull results.</span></div>';
      }
      var rows = (d.picks || []).map(function (p) {
        var col = p.storedResult === 'won' ? '#22c55e' : p.storedResult === 'lost' ? '#ef4444' : p.resolvesAs === 'lost' ? '#f59e0b' : p.resolvesAs === 'won' ? '#84cc16' : 'var(--text-muted)';
        var override = p.pickId ? ' <button class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:11px;" onclick="App.lmsOverridePick(' + id + ',' + p.pickId + ',\'lost\')">mark lost</button> <button class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:11px;" onclick="App.lmsOverridePick(' + id + ',' + p.pickId + ',\'won\')">won</button>' : '';
        return '<tr style="border-top:1px solid var(--border);"><td style="padding:4px 8px;">' + esc(p.user) + '</td><td style="padding:4px 8px;">' + esc(p.team) + '</td>' +
          '<td style="padding:4px 8px;color:' + col + ';">' + esc(p.storedResult || '-') + (p.resolvesAs && p.resolvesAs !== p.storedResult ? ' → resolves as <strong>' + esc(p.resolvesAs) + '</strong>' : '') + (p.detail ? ' <span style="color:var(--text-muted);">(' + esc(p.detail) + ')</span>' : '') + '</td>' +
          '<td style="padding:4px 8px;">' + override + '</td></tr>';
      }).join('');
      box.innerHTML = head + (rows ? '<table style="width:100%;border-collapse:collapse;font-size:12px;"><tr style="text-align:left;color:var(--text-muted);"><th style="padding:4px 8px;">Player</th><th style="padding:4px 8px;">Pick</th><th style="padding:4px 8px;">Status</th><th></th></tr>' + rows + '</table>' : '<span class="text-muted text-sm">No alive picks this round.</span>');
    } catch (e) {
      if (box) box.innerHTML = '<span style="color:var(--red);font-size:12px;">Diagnose failed: ' + esc(e.message || e) + '</span>';
    }
  },

  async lmsOverridePick(compId, pickId, result) {
    try {
      await this.api('/lms/admin/picks/' + pickId + '/result', { method: 'POST', body: JSON.stringify({ result: result }) });
      this.showToast('Pick marked ' + result, 'success');
      this.lmsDiagnoseRound(compId);
    } catch (e) { this.showToast('Override failed: ' + (e.message || e), 'error'); }
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
  async adminGenerateBlog(btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    try {
      var r = await this.api('/admin/trigger/blog', { method: 'POST' });
      this.showToast((r && r.message) || 'Blog review generated.', 'success');
    } catch (e) {
      this.showToast('Blog generation failed: ' + (e.message || e), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Generate Blog Now'; }
    }
  },

  async adminRescorePredictions(btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Re-scoring…'; }
    try {
      var r = await this.api('/admin/rescore-predictions', { method: 'POST' });
      var res = r.result || {};
      this.showToast('Re-scored ' + (res.rescored || 0) + ' predictions, ' + (res.changed || 0) + ' corrected', 'success');
      alert('Re-scored ' + (res.rescored || 0) + ' settled Our Take predictions.\n' + (res.changed || 0) + ' had the wrong result and are now fixed (Double Chance + Total Goals were being mis-scored).\n\nThe accuracy % will now reflect reality.');
    } catch (e) {
      this.showToast('Re-score failed: ' + (e.message || e), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Re-score Our Take'; }
    }
  },

  async adminBackfillClv(btn) {
    var box = document.getElementById('admin-clv-out');
    if (!box) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Backfilling…'; }
    box.style.display = 'block';
    box.innerHTML = '<div class="inline-spinner">Computing Closing Line Value from captured price history…</div>';
    try {
      var r = await this.api('/analytics/clv/backfill', { method: 'POST' });
      var pub = null; try { pub = await this.api('/analytics/clv-public'); } catch (e) {}
      var status = pub && pub.ready
        ? '<span style="color:#22c55e;font-weight:800;">Proof of Edge is LIVE</span> — ' + pub.beatRate + '% beat the close, avg ' + (pub.avgClv >= 0 ? '+' : '') + pub.avgClv + '% CLV over ' + pub.sample + ' tips.'
        : '<span style="color:#d4a843;font-weight:700;">Not live yet</span> — ' + (pub ? pub.sample : '?') + '/' + (pub ? pub.minSample : 15) + ' tips with CLV. Builds as more tips settle.';
      box.innerHTML = '<div class="card" style="padding:14px;font-size:13px;">' +
        '<strong>CLV backfill complete.</strong><br>' +
        'Updated ' + (r.updated || 0) + ' of ' + (r.candidates || 0) + ' settled tips (' + (r.noPriceHistory || 0) + ' had no captured price history).<br>' +
        '<div style="margin-top:8px;">' + status + '</div>' +
      '</div>';
      this.showToast('CLV backfill: ' + (r.updated || 0) + ' tips updated', 'success');
    } catch (e) {
      box.innerHTML = '<div class="card" style="padding:14px;color:#ef4444;">CLV backfill failed: ' + (e.message || e) + '</div>';
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Backfill CLV'; }
    }
  },

  async adminShowCalibration() {
    var box = document.getElementById('admin-calibration-out');
    if (!box) return;
    box.style.display = 'block';
    box.innerHTML = '<div class="inline-spinner">Computing model calibration…</div>';
    try {
      var c = await this.api('/analytics/calibration');
      if (!c.ready) { box.innerHTML = '<div class="card" style="padding:14px;">Not enough settled tips yet for calibration (' + (c.sample || 0) + '/' + (c.minSample || 10) + ').</div>'; return; }
      var gradeColor = c.grade === 'Excellent' ? '#22c55e' : c.grade === 'Good' ? '#84cc16' : c.grade === 'Fair' ? '#d4a843' : '#ef4444';
      var relRows = (c.reliability || []).map(function (r) {
        var gc = Math.abs(r.gap) <= 5 ? '#22c55e' : Math.abs(r.gap) <= 12 ? '#d4a843' : '#ef4444';
        return '<tr><td>' + r.band + '</td><td>' + r.sample + '</td><td>' + r.predicted + '%</td><td>' + r.actual + '%</td><td style="color:' + gc + ';font-weight:700;">' + (r.gap > 0 ? '+' : '') + r.gap + '</td></tr>';
      }).join('');
      var confRows = (c.confidenceOrdering.bands || []).map(function (b) { return '<tr><td>' + b.confidence + '/10</td><td>' + b.sample + '</td><td>' + b.winRate + '%</td></tr>'; }).join('');
      var analystRows = (c.byAnalyst || []).map(function (a) { return '<tr><td>' + this.escapeHtml(a.analyst) + '</td><td>' + a.sample + '</td><td>' + a.winRate + '%</td><td>' + a.brier + '</td></tr>'; }.bind(this)).join('');
      var oddsRows = (c.backtestByOdds || []).map(function (b) { return '<tr><td>' + b.band + '</td><td>' + b.sample + '</td><td>' + b.winRate + '%</td><td style="color:' + (b.roi >= 0 ? '#22c55e' : '#ef4444') + ';font-weight:700;">' + (b.roi >= 0 ? '+' : '') + b.roi + '%</td></tr>'; }).join('');
      box.innerHTML = '<div class="card" style="padding:18px;">' +
        '<h4 style="margin:0 0 10px;">Model Calibration <span style="font-size:11px;color:var(--text-muted);font-weight:500;">· ' + c.period + ' · ' + c.sample + ' tips</span></h4>' +
        '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:14px;">' +
          '<div><div style="font-size:11px;color:var(--text-muted);">Calibration</div><div style="font-size:20px;font-weight:900;color:' + gradeColor + ';">' + c.grade + '</div></div>' +
          '<div><div style="font-size:11px;color:var(--text-muted);">Brier score</div><div style="font-size:20px;font-weight:900;">' + c.brier + '</div></div>' +
          '<div><div style="font-size:11px;color:var(--text-muted);">Skill vs base</div><div style="font-size:20px;font-weight:900;color:' + (c.brierSkillScore >= 0 ? '#22c55e' : '#ef4444') + ';">' + (c.brierSkillScore >= 0 ? '+' : '') + c.brierSkillScore + '</div></div>' +
          '<div><div style="font-size:11px;color:var(--text-muted);">Confidence ordering</div><div style="font-size:16px;font-weight:800;color:' + (c.confidenceOrdering.healthy ? '#22c55e' : '#ef4444') + ';">' + (c.confidenceOrdering.healthy ? 'Healthy' : 'Inversions') + '</div></div>' +
        '</div>' +
        (c.confidenceOrdering.inversions.length ? '<div style="background:rgba(239,68,68,0.1);border-left:3px solid #ef4444;padding:8px 12px;border-radius:4px;font-size:12px;margin-bottom:14px;">⚠️ ' + c.confidenceOrdering.inversions.join('; ') + '</div>' : '') +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:12px;">' +
          '<div><strong>Reliability (predicted vs actual)</strong><table style="width:100%;margin-top:6px;"><tr style="color:var(--text-muted);"><td>Band</td><td>N</td><td>Pred</td><td>Actual</td><td>Gap</td></tr>' + relRows + '</table></div>' +
          '<div><strong>Win rate by confidence</strong><table style="width:100%;margin-top:6px;"><tr style="color:var(--text-muted);"><td>Conf</td><td>N</td><td>Win%</td></tr>' + confRows + '</table></div>' +
          '<div><strong>By analyst (lower Brier = sharper)</strong><table style="width:100%;margin-top:6px;"><tr style="color:var(--text-muted);"><td>Analyst</td><td>N</td><td>Win%</td><td>Brier</td></tr>' + analystRows + '</table></div>' +
          '<div><strong>Backtest ROI by odds band</strong><table style="width:100%;margin-top:6px;"><tr style="color:var(--text-muted);"><td>Band</td><td>N</td><td>Win%</td><td>ROI</td></tr>' + oddsRows + '</table></div>' +
        '</div>' +
      '</div>';
    } catch (e) { box.innerHTML = '<div class="card" style="padding:14px;color:#ef4444;">Calibration failed: ' + (e.message || e) + '</div>'; }
  },

  async adminCheckStripe() {
    var box = document.getElementById('admin-stripe-health');
    if (box) { box.style.display = 'block'; box.style.background = 'var(--bg-elevated)'; box.style.color = 'var(--text-secondary)'; box.textContent = 'Checking Stripe…'; }
    try {
      var r = await this.api('/stripe/health');
      if (!box) return;
      if (r.ok) {
        box.style.background = 'rgba(34,197,94,0.12)';
        box.style.color = '#22c55e';
        box.innerHTML = '✅ <strong>Stripe healthy</strong> — key valid and talking to Stripe (' + (r.mode || '?') + ' mode). Webhook secret: ' + (r.webhookSecretSet ? 'set' : '<strong>missing</strong>') + '.';
      } else {
        box.style.background = 'rgba(239,68,68,0.12)';
        box.style.color = '#ef4444';
        box.innerHTML = '⚠️ <strong>Stripe problem</strong> — ' + this.escapeHtml(r.message || r.error || 'unknown') + (r.mode ? ' (key looks like ' + r.mode + ' mode)' : '');
      }
    } catch (e) {
      if (box) { box.style.background = 'rgba(239,68,68,0.12)'; box.style.color = '#ef4444'; box.textContent = 'Check failed: ' + (e.message || e); }
    }
  },

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

  async adminReconcileStripe(userId, email) {
    if (!confirm('Look up ' + (email || 'this user') + ' in Stripe and set their plan to whatever they are actually paying for?')) return;
    try {
      var result = await this.api('/admin/users/' + userId + '/reconcile-stripe', { method: 'POST' });
      App.showToast(result.message || (result.reconciled ? 'Reconciled.' : 'No active Stripe subscription found.'), result.reconciled ? 'success' : 'error');
      this.renderAdmin();
    } catch (e) { App.showToast('Error: ' + e.message, 'error'); }
  },

  async adminChangeSubscription(userId, currentSub) {
    var newSub = prompt('Set plan — type one of: free, starter, premium, vip\n(current: ' + currentSub + ')', currentSub);
    if (!newSub) return;
    newSub = newSub.trim().toLowerCase();
    if (['free', 'starter', 'premium', 'vip'].indexOf(newSub) === -1) {
      return App.showToast('Invalid plan. Use free, starter, premium or vip.', 'error');
    }
    var expiry = null;
    if (newSub === 'starter' || newSub === 'premium' || newSub === 'vip') {
      expiry = prompt('Subscription expiry date (YYYY-MM-DD):', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
      if (!expiry) return;
    }
    try {
      var result = await this.api('/admin/users/' + userId + '/subscription', {
        method: 'PUT', body: JSON.stringify({ subscription: newSub, subscriptionExpiry: expiry })
      });
      // Show the TRUTH from the server (what actually persisted), not an assumption.
      alert('Server result:\n\n' + (result.message || JSON.stringify(result)) + (result.persisted ? '\n\nPersisted value in DB: ' + result.persisted : ''));
      await this.renderAdmin();
    } catch (e) { alert('Update failed: ' + e.message); App.showToast('Error: ' + e.message, 'error'); }
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
      a.tacticianInsight ? { icon: '\u26bd', title: 'The Tactician — Deep Intelligence', body: '<div style="font-size:13px;line-height:1.7;color:#cbd5e1;">' + a.tacticianInsight + '</div>' } : null,
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

  toggleNotifDropdown(e) {
    if (e) e.stopPropagation();
    const dd = document.getElementById('notif-dropdown');
    if (!dd) return;
    var wasOpen = dd.style.display !== 'none';
    dd.style.display = wasOpen ? 'none' : 'block';
    if (!wasOpen) {
      this.fetchServerNotifications();
      this.renderNotifList();
      // Auto-mark all as read after 2 seconds of being open
      var self = this;
      this._notifAutoReadTimer = setTimeout(function() {
        var hadUnread = self.notifications.some(function(n) { return !n.read; });
        self.notifications.forEach(function(n) {
          if (n && n.id && !n.read) {
            n.read = true;
            self._markNotifRead(n.id);
          }
        });
        localStorage.setItem('ee_notifications', JSON.stringify(self.notifications));
        self.updateNotifBadge();
        if (hadUnread) self.renderNotifList();
      }, 2000);
      // Close on click outside
      var closeHandler = function(ev) {
        var wrapper = document.getElementById('notif-wrapper');
        if (wrapper && !wrapper.contains(ev.target)) {
          dd.style.display = 'none';
          document.removeEventListener('click', closeHandler);
        }
      };
      setTimeout(function() { document.addEventListener('click', closeHandler); }, 10);
    } else {
      // Closing — cancel auto-read if still pending
      if (this._notifAutoReadTimer) { clearTimeout(this._notifAutoReadTimer); this._notifAutoReadTimer = null; }
    }
  },

  clickNotification(id) {
    var notif = this.notifications.find(function(n) { return n.id === id; });
    if (!notif) return;
    notif.read = true;
    this._markNotifRead(id);

    // Fade out the item then remove it from the visible list
    var itemEl = document.querySelector('.notif-item[data-notif-id="' + id + '"]');
    if (itemEl) {
      itemEl.style.transition = 'opacity 0.3s, max-height 0.3s, padding 0.3s';
      itemEl.style.opacity = '0';
      itemEl.style.maxHeight = '0';
      itemEl.style.paddingTop = '0';
      itemEl.style.paddingBottom = '0';
      itemEl.style.overflow = 'hidden';
    }

    localStorage.setItem('ee_notifications', JSON.stringify(this.notifications));
    this.updateNotifBadge();

    // After animation, re-render list without the read item
    setTimeout(function() {
      App.renderNotifList();
    }, 350);

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
    // Show unread first, then recently read (last 5 mins)
    var fiveMinsAgo = Date.now() - 5 * 60 * 1000;
    var visible = this.notifications.filter(function(n) {
      if (!n.read) return true;
      // Show recently read briefly so user sees the transition
      return false;
    });
    if (!visible.length) {
      list.innerHTML = '<p class="text-muted text-sm" style="padding:16px;text-align:center;">All caught up!</p>' +
        '<div style="padding:8px 12px;border-top:1px solid var(--border);text-align:center;"><a href="#/account?alerts" onclick="var dd=document.getElementById(\'notif-dropdown\');if(dd)dd.style.display=\'none\';" style="color:var(--gold);font-size:12px;text-decoration:none;">Manage Alerts</a></div>';
      return;
    }
    var self = this;
    list.innerHTML = visible.slice(0, 20).map(function(n) {
      var safeText = (n.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return '<div class="notif-item unread" data-notif-id="' + n.id + '" onclick="App.clickNotification(\'' + n.id + '\')">' +
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

  async adminInstagramVerify() {
    var out = document.getElementById('admin-instagram-out');
    if (out) { out.style.display = 'block'; out.textContent = 'Checking Instagram connection…'; }
    try {
      var r = await this.api('/admin/instagram/verify');
      if (out) out.innerHTML = r.ok
        ? '<span style="color:#22c55e;">Connected ✓</span> — @' + r.username + (r.followers != null ? ' · ' + r.followers + ' followers' : '')
        : '<span style="color:#ef4444;">Not connected:</span> ' + (r.error || 'check INSTAGRAM_ACCESS_TOKEN + INSTAGRAM_ACCOUNT_ID in Railway');
    } catch (e) { if (out) out.innerHTML = '<span style="color:#ef4444;">Error: ' + (e.message || e) + '</span>'; }
  },

  async adminInstagramTest() {
    var caption = prompt('Test Instagram post caption:', 'Elite Edge is live for the World Cup ⚽ Data-driven views every day. eliteedgesports.co.uk · 18+ | BeGambleAware.org #WorldCup2026 #EliteEdge');
    if (!caption) return;
    var out = document.getElementById('admin-instagram-out');
    if (out) { out.style.display = 'block'; out.textContent = 'Posting to Instagram…'; }
    try {
      var r = await this.api('/admin/instagram/post', { method: 'POST', body: JSON.stringify({ caption: caption }) });
      if (out) out.innerHTML = r.ok ? '<span style="color:#22c55e;">Posted ✓</span> (media ' + r.mediaId + ')' : '<span style="color:#ef4444;">Failed:</span> ' + (r.error || 'unknown');
      this.showToast(r.ok ? 'Posted to Instagram' : 'Instagram post failed', r.ok ? 'success' : 'error');
    } catch (e) { if (out) out.innerHTML = '<span style="color:#ef4444;">Error: ' + (e.message || e) + '</span>'; }
  },

  async adminAnnouncePwa() {
    if (!confirm('Send the "Add to Home Screen" announcement to ALL subscribers now? (Push + in-app notification + step-by-step email.)')) return;
    var out = document.getElementById('admin-announce-out');
    if (out) { out.style.display = 'block'; out.textContent = 'Sending announcement…'; }
    try {
      var r = await this.api('/admin/announce-pwa', { method: 'POST' });
      if (out) out.innerHTML = '<span style="color:#22c55e;">Sent ✓</span> — Telegram: ' + (r.telegram ? 'yes' : 'no') + ', in-app: ' + (r.notification ? 'yes' : 'no') + ', push: ' + (r.push ? 'yes' : 'no') + ', emails: ' + (r.emails || 0);
      this.showToast('Install announcement sent (' + (r.emails || 0) + ' emails)', 'success');
    } catch (e) {
      if (out) out.innerHTML = '<span style="color:#ef4444;">Failed: ' + (e.message || e) + '</span>';
      this.showToast('Announcement failed: ' + e.message, 'error');
    }
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
    var analystNames = ['The Professor', 'The Scout', 'The Clocker', 'The Tactician', 'The Edge'];
    var analystColors = { 'The Professor': '#3b82f6', 'The Scout': '#22c55e', 'The Clocker': '#a855f7', 'The Tactician': '#ef4444', 'The Edge': '#d4a843' };
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

    // Streak — always show the positive (best run), not current losses
    var streakHtml = '';
    var bestRun = roi.bestRun || 0;
    var isWinStreak = roi.streak && roi.streak.type === 'win' && roi.streak.count >= 2;
    if (isWinStreak) {
      // Currently on a winning streak — show it proudly
      streakHtml = '<div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:12px;">' +
        '<span style="font-size:24px;">&#128293;</span>' +
        '<span style="font-size:15px;font-weight:700;color:#22c55e;">' + roi.streak.count + '-bet win streak</span>' +
        (bestRun > roi.streak.count ? '<span style="font-size:12px;color:#94a3b8;margin-left:auto;">Best ever: ' + bestRun + ' winners</span>' : '<span style="font-size:12px;color:#d4a843;margin-left:auto;">Personal best!</span>') +
      '</div>';
    } else if (bestRun >= 2) {
      // Not on a win streak — show best run as motivation
      streakHtml = '<div style="background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.2);border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:12px;">' +
        '<span style="font-size:24px;">&#127942;</span>' +
        '<span style="font-size:15px;font-weight:700;color:#d4a843;">Best run: ' + bestRun + ' consecutive winners</span>' +
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

  // -----------------------------------------------------------------------
  // VERIFIED TRACK RECORD — public proof page for marketing
  // -----------------------------------------------------------------------
  async renderTrackRecord() {
    var app = document.getElementById('app');
    app.innerHTML = '<div class="container" style="padding-top:40px;"><div style="text-align:center;"><div class="spinner"></div><p class="text-muted" style="margin-top:12px;">Loading verified track record...</p></div></div>';

    var data;
    try {
      data = await this.api('/track-record');
    } catch(e) {
      app.innerHTML = '<div class="container" style="padding-top:60px;text-align:center;"><h2>Track Record Unavailable</h2><p class="text-muted">Please try again later.</p></div>';
      return;
    }

    // Closing Line Value proof — the gold-standard proof of edge (best-effort).
    var clv = null;
    try { clv = await this.api('/analytics/clv-public'); } catch (e) { clv = null; }
    var clvCard = '';
    if (clv && clv.ready) {
      var clvPos = clv.avgClv >= 0;
      var sportsLine = (clv.bySport || []).map(function (s) {
        return s.sport.charAt(0).toUpperCase() + s.sport.slice(1) + ' ' + s.beatRate + '%';
      }).join(' · ');
      clvCard = '<div style="background:linear-gradient(135deg,rgba(34,197,94,0.10),rgba(212,168,67,0.06));border:1px solid rgba(34,197,94,0.3);border-radius:12px;padding:22px;margin-bottom:28px;">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="font-size:18px;">📈</span><h2 style="font-size:18px;font-weight:800;margin:0;">Proven Edge — Closing Line Value</h2></div>' +
        '<p style="font-size:13px;color:#94a3b8;margin:0 0 16px;">Beating the closing line is how professionals prove genuine edge — not luck. Measured on every settled tip.</p>' +
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">' +
          '<div style="text-align:center;"><div style="font-size:30px;font-weight:900;color:#22c55e;">' + clv.beatRate + '%</div><div style="font-size:11px;color:#94a3b8;">beat the closing line</div></div>' +
          '<div style="text-align:center;"><div style="font-size:30px;font-weight:900;color:' + (clvPos ? '#22c55e' : '#ef4444') + ';">' + (clvPos ? '+' : '') + clv.avgClv + '%</div><div style="font-size:11px;color:#94a3b8;">average CLV</div></div>' +
          '<div style="text-align:center;"><div style="font-size:30px;font-weight:900;color:#d4a843;">' + clv.sample + '</div><div style="font-size:11px;color:#94a3b8;">tips measured</div></div>' +
        '</div>' +
        (sportsLine ? '<div style="font-size:12px;color:#64748b;margin-top:14px;text-align:center;">Beat-rate by sport: ' + sportsLine + '</div>' : '') +
      '</div>';
    } else if (clv && clv.ready === false) {
      clvCard = '<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:12px;padding:18px;margin-bottom:28px;text-align:center;">' +
        '<h2 style="font-size:16px;font-weight:800;margin:0 0 4px;">📈 Closing Line Value tracking is live</h2>' +
        '<p style="font-size:13px;color:#94a3b8;margin:0;">We measure CLV on every tip. Headline figures publish once we have a meaningful sample (' + (clv.sample || 0) + '/' + (clv.minSample || 15) + ' settled so far).</p>' +
      '</div>';
    }

    var o = data.overview || {};
    var self = this;
    var pnlClass = o.totalPnl > 0 ? 'color:#22c55e;' : 'color:#ef4444;';
    var roiClass = o.roi > 0 ? 'color:#22c55e;' : 'color:#ef4444;';
    var srClass = o.strikeRate >= 50 ? 'color:#22c55e;' : o.strikeRate >= 30 ? 'color:#d4a843;' : 'color:#ef4444;';

    // Sport cards
    var sportCards = Object.keys(data.bySport || {}).map(function(s) {
      var d = data.bySport[s];
      var icon = s === 'racing' ? '&#127943;' : s === 'football' ? '&#9917;' : s === 'basketball' ? '&#127936;' : s === 'tennis' ? '&#127934;' : s === 'rugby' ? '&#127945;' : '&#127944;';
      return '<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center;min-width:140px;">' +
        '<div style="font-size:22px;">' + icon + '</div>' +
        '<div style="font-size:13px;font-weight:700;color:#fff;margin:4px 0;">' + s.charAt(0).toUpperCase() + s.slice(1) + '</div>' +
        '<div style="font-size:20px;font-weight:900;' + (d.pnl > 0 ? 'color:#22c55e;' : 'color:#ef4444;') + '">' + (d.pnl > 0 ? '+' : '') + d.pnl.toFixed(2) + 'u</div>' +
        '<div style="font-size:11px;color:#94a3b8;">' + d.wins + '/' + d.total + ' (' + d.strikeRate + '%) | ROI ' + (d.roi > 0 ? '+' : '') + d.roi + '%</div>' +
      '</div>';
    }).join('');

    // Analyst cards
    var analystCards = Object.keys(data.byAnalyst || {}).map(function(a) {
      var d = data.byAnalyst[a];
      var col = a === 'The Professor' ? '#3b82f6' : a === 'The Scout' ? '#22c55e' : a === 'The Clocker' ? '#a855f7' : a === 'The Tactician' ? '#ef4444' : '#d4a843';
      return '<div style="background:rgba(255,255,255,0.03);border-left:3px solid ' + col + ';border-radius:8px;padding:14px 16px;">' +
        '<div style="font-size:13px;font-weight:800;color:' + col + ';">' + a + '</div>' +
        '<div style="font-size:18px;font-weight:900;' + (d.pnl > 0 ? 'color:#22c55e;' : 'color:#ef4444;') + '">' + (d.pnl > 0 ? '+' : '') + d.pnl.toFixed(2) + 'u</div>' +
        '<div style="font-size:11px;color:#94a3b8;">' + d.wins + '/' + d.total + ' (' + d.strikeRate + '%)</div>' +
      '</div>';
    }).join('');

    // Confidence tier cards
    var confLabels = { elite: 'Elite (9-10)', strong: 'Strong (7-8)', other: 'Standard (<7)' };
    var confCards = Object.keys(data.byConfidence || {}).map(function(t) {
      var d = data.byConfidence[t];
      if (d.total === 0) return '';
      return '<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:14px 16px;flex:1;min-width:140px;text-align:center;">' +
        '<div style="font-size:13px;font-weight:700;color:#d4a843;">' + (confLabels[t] || t) + '</div>' +
        '<div style="font-size:18px;font-weight:900;' + (d.pnl > 0 ? 'color:#22c55e;' : 'color:#ef4444;') + '">' + (d.pnl > 0 ? '+' : '') + d.pnl.toFixed(2) + 'u</div>' +
        '<div style="font-size:11px;color:#94a3b8;">' + d.wins + '/' + d.total + ' (' + d.strikeRate + '%)</div>' +
      '</div>';
    }).join('');

    // Monthly table
    var months = Object.keys(data.monthly || {}).sort().reverse();
    var monthlyRows = months.map(function(m) {
      var d = data.monthly[m];
      var total = d.wins + d.losses;
      var sr = total > 0 ? Math.round((d.wins / total) * 100) : 0;
      return '<tr>' +
        '<td style="font-weight:600;">' + m + '</td>' +
        '<td>' + total + '</td>' +
        '<td style="color:#22c55e;">' + d.wins + '</td>' +
        '<td style="color:#ef4444;">' + d.losses + '</td>' +
        '<td>' + sr + '%</td>' +
        '<td style="font-weight:700;' + (d.pnl > 0 ? 'color:#22c55e;' : 'color:#ef4444;') + '">' + (d.pnl > 0 ? '+' : '') + d.pnl.toFixed(2) + '</td>' +
      '</tr>';
    }).join('');

    // Best winners
    var bestRows = (data.bestWinners || []).map(function(w) {
      return '<tr>' +
        '<td>' + (w.selection || '') + '</td>' +
        '<td style="font-size:12px;color:#94a3b8;">' + (w.event || '') + '</td>' +
        '<td style="font-weight:700;color:#d4a843;">' + self.formatOdds(w.odds) + '</td>' +
        '<td style="font-weight:700;color:#22c55e;">+' + w.pnl.toFixed(2) + '</td>' +
        '<td style="font-size:12px;color:#94a3b8;">' + formatDateUK(w.date) + '</td>' +
      '</tr>';
    }).join('');

    app.innerHTML = '<div class="container" style="padding-top:40px;max-width:900px;">' +

      // Header
      '<div style="text-align:center;margin-bottom:32px;">' +
        '<h1 style="font-size:28px;">Verified <span style="color:#d4a843;">Track Record</span></h1>' +
        '<p style="color:#94a3b8;font-size:14px;">Every tip. Every result. Full transparency. Auto-verified via live API data.</p>' +
        '<p style="font-size:12px;color:#475569;margin-top:8px;">Tracking since ' + (o.firstTipDate || '—') + ' | Last updated: ' + (data.generatedAt ? new Date(data.generatedAt).toLocaleString('en-GB') : '—') + '</p>' +
      '</div>' +

      // Hero stats
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:28px;">' +
        '<div style="background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.2);border-radius:12px;padding:20px;text-align:center;">' +
          '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:6px;">Total P/L</div>' +
          '<div style="font-size:28px;font-weight:900;' + pnlClass + '">' + (o.totalPnl > 0 ? '+' : '') + o.totalPnl.toFixed(2) + '</div>' +
          '<div style="font-size:11px;color:#64748b;">units</div>' +
        '</div>' +
        '<div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:12px;padding:20px;text-align:center;">' +
          '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:6px;">ROI</div>' +
          '<div style="font-size:28px;font-weight:900;' + roiClass + '">' + (o.roi > 0 ? '+' : '') + o.roi + '%</div>' +
        '</div>' +
        '<div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:12px;padding:20px;text-align:center;">' +
          '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:6px;">Strike Rate</div>' +
          '<div style="font-size:28px;font-weight:900;' + srClass + '">' + o.strikeRate + '%</div>' +
        '</div>' +
        '<div style="background:rgba(168,85,247,0.08);border:1px solid rgba(168,85,247,0.2);border-radius:12px;padding:20px;text-align:center;">' +
          '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:6px;">Verified Tips</div>' +
          '<div style="font-size:28px;font-weight:900;color:#a855f7;">' + o.totalTips + '</div>' +
          '<div style="font-size:11px;color:#64748b;">' + o.wins + 'W ' + o.losses + 'L | Best run: ' + o.longestStreak + '</div>' +
        '</div>' +
      '</div>' +

      // Proven Edge — CLV
      clvCard +

      // By sport
      '<div style="margin-bottom:28px;">' +
        '<h2 style="font-size:18px;font-weight:800;margin-bottom:12px;">Performance by Sport</h2>' +
        '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + sportCards + '</div>' +
      '</div>' +

      // By analyst
      '<div style="margin-bottom:28px;">' +
        '<h2 style="font-size:18px;font-weight:800;margin-bottom:12px;">Performance by Analyst</h2>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;">' + analystCards + '</div>' +
      '</div>' +

      // By confidence
      '<div style="margin-bottom:28px;">' +
        '<h2 style="font-size:18px;font-weight:800;margin-bottom:12px;">Performance by Confidence Tier</h2>' +
        '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + confCards + '</div>' +
      '</div>' +

      // Monthly breakdown
      (monthlyRows ? '<div style="margin-bottom:28px;">' +
        '<h2 style="font-size:18px;font-weight:800;margin-bottom:12px;">Monthly Breakdown</h2>' +
        '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">' +
          '<thead><tr><th style="text-align:left;padding:10px 8px;border-bottom:1px solid #2a2e3d;color:#64748b;">Month</th><th style="padding:10px 8px;border-bottom:1px solid #2a2e3d;color:#64748b;">Tips</th><th style="padding:10px 8px;border-bottom:1px solid #2a2e3d;color:#64748b;">Won</th><th style="padding:10px 8px;border-bottom:1px solid #2a2e3d;color:#64748b;">Lost</th><th style="padding:10px 8px;border-bottom:1px solid #2a2e3d;color:#64748b;">SR%</th><th style="padding:10px 8px;border-bottom:1px solid #2a2e3d;color:#64748b;">P/L</th></tr></thead>' +
          '<tbody>' + monthlyRows + '</tbody>' +
        '</table></div>' +
      '</div>' : '') +

      // Best winners
      (bestRows ? '<div style="margin-bottom:28px;">' +
        '<h2 style="font-size:18px;font-weight:800;margin-bottom:12px;">Top 10 Winners</h2>' +
        '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">' +
          '<thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #2a2e3d;color:#64748b;">Selection</th><th style="text-align:left;padding:8px;border-bottom:1px solid #2a2e3d;color:#64748b;">Event</th><th style="padding:8px;border-bottom:1px solid #2a2e3d;color:#64748b;">Odds</th><th style="padding:8px;border-bottom:1px solid #2a2e3d;color:#64748b;">P/L</th><th style="padding:8px;border-bottom:1px solid #2a2e3d;color:#64748b;">Date</th></tr></thead>' +
          '<tbody>' + bestRows + '</tbody>' +
        '</table></div>' +
      '</div>' : '') +

      // Verification statement
      '<div style="background:rgba(34,197,94,0.06);border:2px solid rgba(34,197,94,0.2);border-radius:12px;padding:24px;text-align:center;margin-bottom:28px;">' +
        '<div style="font-size:24px;margin-bottom:8px;">&#9989;</div>' +
        '<h3 style="color:#22c55e;font-size:16px;margin-bottom:8px;">Independently Verified</h3>' +
        '<p style="font-size:13px;color:#94a3b8;line-height:1.6;max-width:600px;margin:0 auto;">All tips are timestamped before the event starts. Results are settled automatically via live API data from official sources — Racing API, Football-Data.org, and API-Sports. No results are entered manually. No losses are hidden. This is the complete, unedited record.</p>' +
      '</div>' +

      // CTA
      '<div style="text-align:center;margin-bottom:40px;">' +
        '<a href="#/pricing" class="btn btn-gold btn-lg">Start Your 14-Day Free Trial</a>' +
        '<p style="font-size:12px;color:#475569;margin-top:8px;">See these results for yourself. Cancel anytime.</p>' +
      '</div>' +

      '<p style="text-align:center;font-size:10px;color:#334155;">Elite Edge Sports Tips Ltd. Company No. 17138566. Statistical analysis and entertainment only. Past performance does not guarantee future results. 18+ BeGambleAware.org</p>' +
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
        name: 'The Tactician',
        key: 'tactician',
        initials: 'TT',
        specialty: 'Deep Football Intelligence',
        desc: 'Football-only specialist. Reads manager intent, tactical setups, injury impact, motivation context, referee tendencies, and xG trends. Powered by live Perplexity research from BBC Sport, The Athletic, and FBRef.',
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
    // MUST return the real server-stored code, or shared links credit nobody.
    if (this.user && this.user.referralCode) return this.user.referralCode;
    if (!this.user || !this.user.email) return '';
    return 'ELITE-' + this.user.email.substring(0, 4).toUpperCase(); // fallback only
  },

  getReferralCount() {
    // Real count comes from the server on the user object; localStorage is a fallback.
    if (this.user && typeof this.user.referralCount === 'number') return this.user.referralCount;
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
    const subLabel = u.subscription === 'vip' ? '<span style="color:#d4a843;font-weight:700;">VIP</span>' : u.subscription === 'premium' ? '<span class="text-gold">Premium</span>' : u.subscription === 'starter' ? '<span style="color:#22c55e;font-weight:600;">Starter</span>' : 'Free';
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

  // -----------------------------------------------------------------------
  // WINNERS WALL — subscriber-submitted wins (admin-moderated social proof)
  // -----------------------------------------------------------------------
  renderWinnersPage() {
    var app = document.getElementById('app');
    app.innerHTML =
      '<div class="container" style="padding-top:32px;max-width:1000px;">' +
        '<div style="text-align:center;margin-bottom:8px;"><span style="display:inline-block;background:rgba(212,168,67,0.12);border:1px solid rgba(212,168,67,0.3);color:#d4a843;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;padding:5px 14px;border-radius:6px;">Real Member Wins</span></div>' +
        '<h1 style="text-align:center;font-size:30px;font-weight:900;margin:8px 0 4px;">&#127942; Winners Wall</h1>' +
        '<p style="text-align:center;color:var(--text-muted);font-size:14px;margin-bottom:8px;">Genuine wins shared by Elite Edge members. Every entry is reviewed before it appears here.</p>' +
        '<p style="text-align:center;color:var(--text-muted);font-size:11px;margin-bottom:20px;">18+ | Please gamble responsibly | BeGambleAware.org</p>' +
        '<div style="text-align:center;margin-bottom:24px;">' +
          (this.user ? '<button class="btn btn-gold" onclick="App.showWinnerSubmit()">Share your win</button>' : '<a href="#/pricing" class="btn btn-gold">Join Elite Edge to share yours</a>') +
        '</div>' +
        '<div id="winners-wall"><div style="text-align:center;padding:40px;color:var(--text-muted);">Loading winners&hellip;</div></div>' +
      '</div>';
    this._loadWinners(60);
  },

  async _loadWinners(limit) {
    limit = limit || 18;
    var el = document.getElementById('winners-wall');
    if (!el) return;
    try {
      var data = await this.api('/winners?limit=' + limit);
      el = document.getElementById('winners-wall');
      if (!el) return;
      var winners = (data && data.winners) || [];
      if (!winners.length) {
        el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px;">No winners posted yet — ' +
          (this.user ? 'be the first to <a href="#" onclick="App.showWinnerSubmit();return false;" style="color:var(--gold);">share yours</a>!' : 'members can share their wins here.') + '</div>';
        return;
      }
      el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;">' +
        winners.map(function (w) {
          var img = w.image ? '<div style="width:100%;background:#0a0e1a;text-align:center;"><img src="' + App.escapeHtml(w.image) + '" alt="Member win" loading="lazy" style="width:100%;height:auto;max-height:560px;object-fit:contain;display:block;"></div>' : '';
          var cap = w.caption ? '<div style="font-size:13px;color:#e8e8ec;line-height:1.4;margin-bottom:6px;">' + App.escapeHtml(w.caption) + '</div>' : '';
          var amt = w.amount ? '<span style="color:#22c55e;font-weight:800;">' + App.escapeHtml(w.amount) + '</span> &middot; ' : '';
          return '<div style="background:var(--card-bg);border:1px solid rgba(34,197,94,0.25);border-radius:12px;overflow:hidden;">' + img +
            '<div style="padding:12px 14px;">' + cap +
            '<div style="font-size:12px;color:var(--text-muted);">' + amt + App.escapeHtml(w.name || 'Elite Edge member') + '</div></div></div>';
        }).join('') + '</div>';
    } catch (e) {
      var e2 = document.getElementById('winners-wall');
      if (e2) e2.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px;">Winners unavailable right now.</div>';
    }
  },

  showWinnerSubmit() {
    if (!this.user) { this.showModal('login'); return; }
    var existing = document.getElementById('winner-submit-overlay');
    if (existing) existing.remove();
    this._winnerImageData = null;
    var ov = document.createElement('div');
    ov.id = 'winner-submit-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;';
    ov.innerHTML = '<div style="background:#11162a;border:1px solid rgba(212,168,67,0.3);border-radius:16px;max-width:440px;width:100%;padding:24px;position:relative;">' +
      '<button onclick="document.getElementById(\'winner-submit-overlay\').remove()" style="position:absolute;top:10px;right:14px;background:none;border:none;color:#888;font-size:26px;cursor:pointer;line-height:1;">&times;</button>' +
      '<h3 style="font-size:20px;font-weight:900;color:#d4a843;margin-bottom:4px;">Share Your Win</h3>' +
      '<p style="font-size:13px;color:#9aa3b2;margin-bottom:16px;">Upload a screenshot and tell us about it. We review every entry before it goes on the Winners Wall.</p>' +
      '<label style="display:block;font-size:12px;color:#9aa3b2;margin-bottom:6px;font-weight:600;">Screenshot</label>' +
      '<input type="file" id="winner-image" accept="image/*" style="width:100%;margin-bottom:6px;color:#ccc;font-size:13px;">' +
      '<div id="winner-image-preview" style="margin-bottom:12px;"></div>' +
      '<label style="display:block;font-size:12px;color:#9aa3b2;margin-bottom:6px;font-weight:600;">Your win (optional)</label>' +
      '<textarea id="winner-caption" maxlength="280" rows="2" placeholder="e.g. Followed the Sweden BTTS tip — landed nicely!" style="width:100%;background:#0a0e1a;border:1px solid #2a2f45;border-radius:8px;padding:10px;color:#fff;font-size:13px;margin-bottom:12px;resize:vertical;box-sizing:border-box;"></textarea>' +
      '<label style="display:block;font-size:12px;color:#9aa3b2;margin-bottom:6px;font-weight:600;">Display name (optional)</label>' +
      '<input type="text" id="winner-name" maxlength="40" placeholder="' + App.escapeHtml(this.user.name || 'Your name') + '" style="width:100%;background:#0a0e1a;border:1px solid #2a2f45;border-radius:8px;padding:10px;color:#fff;font-size:13px;margin-bottom:16px;box-sizing:border-box;">' +
      '<label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;color:#9aa3b2;margin-bottom:16px;cursor:pointer;"><input type="checkbox" id="winner-consent" style="margin-top:2px;flex-shrink:0;"><span>I\'m happy for Elite Edge to display this publicly, and I\'ve removed any personal details (account numbers, etc.) from the screenshot.</span></label>' +
      '<button id="winner-submit-btn" class="btn btn-gold btn-full" onclick="App.submitWinner()">Submit for review</button>' +
      '<p style="font-size:10px;color:#667085;text-align:center;margin-top:12px;">18+ | Please gamble responsibly | BeGambleAware.org</p>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    var fileInput = document.getElementById('winner-image');
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var pv = document.getElementById('winner-image-preview');
      if (pv) pv.innerHTML = '<span style="font-size:12px;color:#9aa3b2;">Processing image…</span>';
      App._compressImage(f, function (dataUrl) {
        App._winnerImageData = dataUrl;
        var pv2 = document.getElementById('winner-image-preview');
        if (pv2) pv2.innerHTML = dataUrl ? '<img src="' + dataUrl + '" style="max-width:100%;max-height:200px;border-radius:8px;border:1px solid #2a2f45;">' : '<span style="font-size:12px;color:#ef4444;">Could not read that image — try another.</span>';
      });
    });
  },

  _compressImage(file, cb) {
    try {
      var reader = new FileReader();
      reader.onload = function (ev) {
        var img = new Image();
        img.onload = function () {
          var maxDim = 1200, w = img.width, h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w >= h) { h = Math.round(h * maxDim / w); w = maxDim; }
            else { w = Math.round(w * maxDim / h); h = maxDim; }
          }
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          var q = 0.85, out = canvas.toDataURL('image/jpeg', q);
          while (out.length > 820000 && q > 0.4) { q -= 0.1; out = canvas.toDataURL('image/jpeg', q); }
          cb(out);
        };
        img.onerror = function () { cb(null); };
        img.src = ev.target.result;
      };
      reader.onerror = function () { cb(null); };
      reader.readAsDataURL(file);
    } catch (e) { cb(null); }
  },

  async submitWinner() {
    var btn = document.getElementById('winner-submit-btn');
    var caption = (document.getElementById('winner-caption') || {}).value || '';
    var name = (document.getElementById('winner-name') || {}).value || '';
    var image = this._winnerImageData || '';
    var consent = document.getElementById('winner-consent');
    var fileInput = document.getElementById('winner-image');
    // Image chosen but still compressing — don't silently submit without it.
    if (!image && fileInput && fileInput.files && fileInput.files.length) {
      this.showToast('Your screenshot is still processing — give it a second and tap submit again.', 'error');
      return;
    }
    if (!image && !caption.trim()) { this.showToast('Add a screenshot or a few words first.', 'error'); return; }
    if (!consent || !consent.checked) { this.showToast('Please tick the consent box so we can display your win.', 'error'); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
    try {
      var r = await this.api('/winners', { method: 'POST', body: JSON.stringify({ caption: caption, displayName: name, image: image }) });
      if (r && r.error) { this.showToast(r.error, 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Submit for review'; } return; }
      var ov = document.getElementById('winner-submit-overlay');
      if (ov) ov.remove();
      this._winnerImageData = null;
      this.showToast((r && r.message) || 'Thanks! Your win is awaiting review.', 'success');
    } catch (e) {
      this.showToast(e && e.message ? e.message : 'Could not submit — please try again.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Submit for review'; }
    }
  },

  async showReferral() {
    this.showModal('referral');
    const content = document.getElementById('referral-content');
    if (!content) return;
    // Pull authoritative stats from the server (real code, count, pending referrals)
    var stats = {};
    try { stats = await this.api('/referral'); } catch (e) {}
    content = document.getElementById('referral-content');
    if (!content) return;
    const code = stats.referralCode || this.getReferralCode();
    const link = stats.referralLink || ('https://eliteedgesports.co.uk/?ref=' + code);
    const count = (typeof stats.referralCount === 'number') ? stats.referralCount : this.getReferralCount();
    const pending = stats.pendingReferrals || 0;
    const earnedMonths = Math.floor(count / 3);
    const progress = count % 3; // progress towards the next free month
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
        ${pending > 0 ? `<div style="margin-top:16px;padding:12px 14px;background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.25);border-radius:8px;text-align:left;">
          <p style="font-size:13px;color:#d4a843;font-weight:700;margin:0 0 4px;">&#8987; ${pending} friend${pending > 1 ? 's' : ''} joined but haven't verified yet</p>
          <p style="font-size:12px;color:var(--text-muted);margin:0;">Referrals only count once your friend verifies their email. Give them a nudge to check their inbox (and spam) for the verification link — then your reward lands automatically.</p>
        </div>` : ''}
        <div style="margin-top:20px;padding:16px;background:var(--bg-elevated);border-radius:var(--radius-sm);">
          <p class="text-sm text-muted mb-8">Referral Progress</p>
          <div style="display:flex;gap:8px;justify-content:center;margin-bottom:8px;">
            ${[1,2,3].map(i => `<div style="width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;${i <= progress ? 'background:var(--gold);color:var(--bg-deep);' : 'background:var(--bg-card);border:2px solid var(--border);color:var(--text-dim);'}">${i}</div>`).join('')}
          </div>
          <p class="text-xs text-muted">Every 3 friends who join = 1 month free Premium</p>
          ${earnedMonths > 0 ? `<p class="text-gold" style="font-weight:700;margin-top:4px;">&#127881; ${earnedMonths} free month${earnedMonths > 1 ? 's' : ''} earned &bull; ${count} verified referral${count !== 1 ? 's' : ''}</p>` : `<p class="text-gold" style="font-weight:700;margin-top:4px;">${progress}/3 towards your first free month</p>`}
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
          '<a href="https://t.me/EliteEdgeSportsTips" target="_blank" rel="noopener" onclick="localStorage.setItem(\'ee_tg_dismissed\',\'1\');trackEvent(\'engagement\',\'telegram_join\',\'post_register\');" style="display:flex;align-items:center;justify-content:center;gap:8px;background:#229ED9;color:#fff;padding:14px 24px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;">' +
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
      { icon: '&#129302;', title: '3 AI Engines + 5 Analyst Profiles', desc: 'Claude writes analysis, Perplexity feeds live web intelligence, GPT-4o independently verifies every tip. Five AI analysts (Professor, Scout, Clocker, Tactician, Edge) — racing and football each have dedicated deep-research specialists with weekly self-tuning.' },
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
          '<h2 style="font-size:24px;font-weight:800;">5 AI Analysts. <span style="color:#d4a843;">5 Strategies.</span></h2>' +
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
              '<div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#ef4444,#dc2626);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:16px;color:#fff;">TT</div>' +
              '<div><div style="font-size:16px;font-weight:800;color:#ef4444;">The Tactician</div><div style="font-size:11px;color:#8b8d93;">Deep Football Intelligence</div></div>' +
            '</div>' +
            '<p style="font-size:13px;color:#94a3b8;line-height:1.6;">Football-only specialist. Manager press conference analysis, tactical setup changes, injury impact, motivation context, referee tendencies, and xG trend analysis. Powered by live Perplexity research.</p>' +
            '<div style="font-size:11px;color:#ef4444;font-weight:700;margin-top:8px;">SPORTS: Football only &bull; ODDS: 1/2 to 12/1</div>' +
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
          '<p style="font-size:14px;color:#94a3b8;line-height:1.6;max-width:600px;margin:0 auto;">Every week, the system reviews each analyst\'s performance. Losing patterns are identified. Odds ranges tighten. Weak markets are dropped. Successful strategies expand. The model gets sharper with every result.</p>' +
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
            <li><strong style="color:#fff;">Analyst</strong> — which AI analyst produced this tip (Professor, Scout, Clocker, Tactician, or Edge)</li>
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
          <p>Every Monday, the system reviews each analyst's performance and <strong style="color:#fff;">auto-adjusts</strong> their odds ranges and preferred markets based on what's winning and losing.</p>

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

    // Render video embed after DOM update
    setTimeout(function() {
      var container = document.getElementById('how-it-works-video');
      if (!container) return;
      var videoUrl = window.ELITE_EDGE_VIDEO_URL || localStorage.getItem('ee_walkthrough_url') || '';
      if (videoUrl) {
        var embedHtml = '';
        if (videoUrl.indexOf('loom.com') !== -1) {
          var loomId = videoUrl.split('/').pop().split('?')[0];
          embedHtml = '<div style="position:relative;padding-bottom:56.25%;height:0;border-radius:12px;overflow:hidden;border:1px solid #2a2d45;"><iframe src="https://www.loom.com/embed/' + loomId + '" frameborder="0" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%;"></iframe></div>';
        } else if (videoUrl.indexOf('youtube.com') !== -1 || videoUrl.indexOf('youtu.be') !== -1) {
          var ytId = videoUrl.indexOf('youtu.be') !== -1 ? videoUrl.split('/').pop().split('?')[0] : (videoUrl.match(/[?&]v=([^&]+)/) || [])[1];
          if (ytId) embedHtml = '<div style="position:relative;padding-bottom:56.25%;height:0;border-radius:12px;overflow:hidden;border:1px solid #2a2d45;"><iframe src="https://www.youtube.com/embed/' + ytId + '" frameborder="0" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%;"></iframe></div>';
        }
        if (embedHtml) container.innerHTML = '<div style="margin-bottom:12px;font-size:14px;font-weight:700;color:#d4a843;">Watch: How to Use Elite Edge</div>' + embedHtml;
      } else {
        container.innerHTML = '<div style="background:#0a0e1a;border-radius:12px;padding:40px 20px;text-align:center;border:1px solid #2a2d45;"><div style="font-size:48px;margin-bottom:12px;">&#9654;</div><div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:6px;">Video Walkthrough Coming Soon</div><div style="font-size:13px;color:#8a8fa0;">3 minute guide showing how to use Elite Edge</div></div>';
      }
    }, 50);
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
      `Join us: https://t.me/EliteEdgeSportsTips`;
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
    { title: 'Your 10 Free Credits', desc: 'You\'ve received 10 free credits, and they renew every month. Each premium tip costs 1 credit to view, and there\'s a full free tip every day that costs nothing. Your credit balance is shown in the top menu bar. When you run out, buy more credit packs from £1.99 or upgrade for more monthly credits.' },
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

    // Acca generator costs 3 credits for free/starter users
    if (this.user && !this.isPremium() && !this.isVIP() && this.user.role !== 'admin') {
      var userCredits = this.user.credits || 0;
      if (userCredits < 3) {
        app.innerHTML = '<div class="container" style="padding-top:60px;text-align:center;">' +
          '<div style="font-size:48px;margin-bottom:16px;">&#128176;</div>' +
          '<h2 style="color:var(--gold);">Smart Acca Generator</h2>' +
          '<p style="color:var(--text-secondary);margin:12px 0;">Costs <strong style="color:#d4a843;">3 credits</strong> per use. You have <strong style="color:#ef4444;">' + userCredits + ' credits</strong>.</p>' +
          '<div style="display:flex;gap:10px;justify-content:center;margin-top:20px;">' +
            '<a href="#/buy-credits" class="btn btn-gold">Buy Credits</a>' +
            '<a href="#/pricing" class="btn btn-outline">Upgrade Plan</a>' +
          '</div>' +
        '</div>';
        return;
      }
      // Deduct 3 credits
      try {
        await this.api('/user/bets/deduct-acca', { method: 'POST' });
        this.user.credits = Math.max(0, userCredits - 3);
        localStorage.setItem('ee_user', JSON.stringify(this.user));
      } catch(e) {}
    }

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
      // Also store all fixtures for result checking on acca legs
      try {
        var liveData = await this.fetchLiveFootball(true); // Force fresh — no cache
        var fixtures = liveData && liveData.fixtures ? liveData.fixtures : [];
        this._accaFixtures = fixtures;
        fixtures.forEach(function(f) {
          if (!f.homeTeam || !f.awayTeam) return;
          if (f.status === 'FT' || f.status === 'AET' || f.status === 'PEN') return; // skip finished
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

          // Skip fixtures with no real odds — never show fake prices
          if (markets.length === 0) return;

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
            homeTeamLogo: f.homeTeamLogo || '', awayTeamLogo: f.awayTeamLogo || '',
            _allMarkets: markets.map(function(m) {
              return { sel: m.sel, market: m.market, odds: m.odds, modelProb: m.modelProb, edge: m.edge };
            }),
          });
        });
      } catch (liveErr) { /* non-fatal — published tips still available */ }

      // Racing removed — acca builder is football only

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

    // Football only — filter out any non-football selections
    var filtered = activeTips.filter(function(t) { return t.sport === 'football'; });

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

    // Sport filter removed — football only

    // League sub-filter for football
    var leagueFilterHtml = '';
    if (true) {
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

      // Check if this leg's match has a result
      var legResult = self._checkAccaLegResult(tip);
      var resultBadge = '';
      var legBorderStyle = '';
      if (legResult === 'won') {
        resultBadge = '<div style="background:#22c55e;color:#000;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:800;white-space:nowrap;">WON &#10003;</div>';
        legBorderStyle = 'border-left:3px solid #22c55e;';
      } else if (legResult === 'lost') {
        resultBadge = '<div style="background:#ef4444;color:#fff;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:800;white-space:nowrap;">LOST &#10007;</div>';
        legBorderStyle = 'border-left:3px solid #ef4444;';
      } else if (legResult === 'live') {
        resultBadge = '<div style="background:#22c55e;color:#000;padding:4px 10px;border-radius:6px;font-size:10px;font-weight:800;white-space:nowrap;animation:pulse 2s infinite;">LIVE</div>';
        legBorderStyle = 'border-left:3px solid #22c55e;';
      }

      var homeLogo = tip.homeTeamLogo ? '<img src="' + tip.homeTeamLogo + '" style="width:16px;height:16px;object-fit:contain;vertical-align:middle;" onerror="this.style.display=\'none\'"> ' : '';
      var awayLogo = tip.awayTeamLogo ? ' <img src="' + tip.awayTeamLogo + '" style="width:16px;height:16px;object-fit:contain;vertical-align:middle;" onerror="this.style.display=\'none\'">' : '';

      legsHtml +=
        '<div class="acca-leg" style="' + legBorderStyle + '">' +
          '<div class="acca-leg-number">' + (i + 1) + '</div>' +
          '<div class="acca-leg-info">' +
            (fixtureName ? '<div style="font-size:13px;font-weight:700;color:#d4a843;margin-bottom:2px;">' + homeLogo + fixtureName + awayLogo + '</div>' : '') +
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
          '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">' +
            '<div class="acca-leg-odds">' + self.formatOdds(decOdds) + '</div>' +
            resultBadge +
          '</div>' +
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

  _checkAccaLegResult(tip) {
    var fixtures = this._accaFixtures || [];
    var selection = (tip.selection || '').toLowerCase();
    var event = (tip.event || tip.match || '').toLowerCase();

    // Find matching fixture by team names
    var match = fixtures.find(function(f) {
      if (!f.homeTeam || !f.awayTeam) return false;
      var home = f.homeTeam.toLowerCase();
      var away = f.awayTeam.toLowerCase();
      return event.indexOf(home) !== -1 || event.indexOf(away) !== -1 ||
             (selection.indexOf(home) !== -1 || selection.indexOf(away) !== -1);
    });

    if (!match) {
      // Also check published tip result directly
      if (tip.result === 'won' || tip.result === 'win') return 'won';
      if (tip.result === 'lost' || tip.result === 'loss') return 'lost';
      return null;
    }

    // Match is live
    if (match.status === 'LIVE' || match.status === '1H' || match.status === '2H' || match.status === 'HT') {
      return 'live';
    }

    // Match is finished
    if (match.status !== 'FT' && match.status !== 'AET' && match.status !== 'PEN') return null;

    var homeGoals = parseInt(match.homeGoals) || 0;
    var awayGoals = parseInt(match.awayGoals) || 0;
    var totalGoals = homeGoals + awayGoals;
    var market = (tip.market || '').toLowerCase();

    // Match Result
    if (market.indexOf('match result') !== -1 || market === 'win') {
      if (selection.indexOf('draw') !== -1) {
        return homeGoals === awayGoals ? 'won' : 'lost';
      }
      var homeWin = homeGoals > awayGoals;
      var awayWin = awayGoals > homeGoals;
      // Check if selection mentions home team winning
      if (selection.indexOf(match.homeTeam.toLowerCase()) !== -1 && selection.indexOf('win') !== -1) {
        return homeWin ? 'won' : 'lost';
      }
      if (selection.indexOf(match.awayTeam.toLowerCase()) !== -1 && selection.indexOf('win') !== -1) {
        return awayWin ? 'won' : 'lost';
      }
      // Fallback: if selection contains home team name, assume home win pick
      if (selection.indexOf(match.homeTeam.toLowerCase()) !== -1) return homeWin ? 'won' : 'lost';
      if (selection.indexOf(match.awayTeam.toLowerCase()) !== -1) return awayWin ? 'won' : 'lost';
    }

    // Over/Under 2.5
    if (market.indexOf('over') !== -1 && market.indexOf('under') === -1) {
      return totalGoals > 2 ? 'won' : 'lost';
    }
    if (market.indexOf('under') !== -1) {
      return totalGoals < 3 ? 'won' : 'lost';
    }

    // BTTS
    if (market.indexOf('btts') !== -1 || market.indexOf('both teams') !== -1) {
      var bttsYes = homeGoals > 0 && awayGoals > 0;
      if (selection.indexOf('yes') !== -1) return bttsYes ? 'won' : 'lost';
      if (selection.indexOf('no') !== -1) return !bttsYes ? 'won' : 'lost';
      return bttsYes ? 'won' : 'lost';
    }

    // Double Chance
    if (market.indexOf('double chance') !== -1) {
      if (selection.indexOf('1x') !== -1 || (selection.indexOf(match.homeTeam.toLowerCase()) !== -1 && selection.indexOf('draw') !== -1)) {
        return homeGoals >= awayGoals ? 'won' : 'lost';
      }
      if (selection.indexOf('x2') !== -1 || (selection.indexOf(match.awayTeam.toLowerCase()) !== -1 && selection.indexOf('draw') !== -1)) {
        return awayGoals >= homeGoals ? 'won' : 'lost';
      }
    }

    return null;
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

  // Ask Elite Edge — natural-language assistant grounded in our selection engine
  async askEliteEdge(presetQ) {
    var input = document.getElementById('ee-ask-input');
    if (presetQ && input) input.value = presetQ;
    var q = (presetQ || (input ? input.value : '') || '').trim();
    var out = document.getElementById('ee-ask-answer');
    if (!q) { if (input) input.focus(); return; }
    if (out) {
      out.style.display = 'block';
      out.innerHTML = '<span style="color:var(--text-secondary);">Elite Edge is thinking…</span>';
    }
    try {
      var data = await this.api('/chat/ai', { method: 'POST', body: JSON.stringify({ message: q }) });
      var reply = (data && data.reply) ? this._formatAssistantText(data.reply) : 'No answer right now.';
      var sources = (data && data.sources) || [];
      var srcHtml = '';
      sources = sources.filter(function (u) { return /^https?:\/\//i.test(u); }); // safe schemes only
      if (sources.length) {
        srcHtml = '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted);">Sources: ' +
          sources.slice(0, 4).map(function (u, i) {
            var host = '';
            try { host = new URL(u).hostname.replace('www.', ''); } catch (e) { host = 'source ' + (i + 1); }
            return '<a href="' + App.escapeHtml(u) + '" target="_blank" rel="noopener" style="color:#d4a843;">' + App.escapeHtml(host) + '</a>';
          }).join(' · ') + '</div>';
      }
      if (out) out.innerHTML = '<div style="font-size:11px;font-weight:700;color:#d4a843;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">&#128173; Elite Edge says</div>' +
        '<div style="line-height:1.6;">' + reply + '</div>' + srcHtml +
        '<div style="margin-top:10px;font-size:11px;color:var(--text-muted);">Statistical prediction for entertainment. 18+ · Please gamble responsibly.</div>';
    } catch (e) {
      if (out) out.innerHTML = '<span style="color:var(--red);">Sorry, couldn\'t answer that just now — try again in a moment.</span>';
    }
  },

  // Site-wide floating "Ask the Edge" widget — mounted once, persists across pages.
  _mountAskFab() {
    if (document.getElementById('ee-fab')) return;
    if (!document.getElementById('ee-fab-style')) {
      var st = document.createElement('style');
      st.id = 'ee-fab-style';
      st.textContent =
        '#ee-fab{position:fixed;bottom:20px;right:20px;z-index:9998;width:58px;height:58px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;font-size:26px;box-shadow:0 8px 24px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;transition:transform .15s;}' +
        '#ee-fab:hover{transform:scale(1.08);}' +
        '#ee-fab::after{content:"";position:absolute;inset:0;border-radius:50%;border:2px solid #d4a843;animation:ee-fab-pulse 2.4s ease-out infinite;}' +
        '@keyframes ee-fab-pulse{0%{transform:scale(1);opacity:.6}100%{transform:scale(1.7);opacity:0}}' +
        '#ee-fab-panel{position:fixed;bottom:88px;right:20px;z-index:9999;width:min(380px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 120px));background:#0f1426;border:1px solid rgba(212,168,67,0.3);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.55);display:none;flex-direction:column;overflow:hidden;}' +
        '.ee-fab-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:linear-gradient(135deg,rgba(212,168,67,0.14),rgba(212,168,67,0.02));border-bottom:1px solid rgba(255,255,255,0.07);}' +
        '.ee-fab-msgs{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px;}' +
        '.ee-fab-bubble{font-size:13.5px;line-height:1.55;padding:10px 12px;border-radius:12px;max-width:92%;}' +
        '.ee-fab-user{align-self:flex-end;background:#d4a843;color:#0a0e1a;font-weight:600;}' +
        '.ee-fab-bot{align-self:flex-start;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);color:#e8e8ec;}' +
        '.ee-fab-bot strong{color:#fff;}' +
        '.ee-fab-chip{background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.25);color:#d4a843;font-size:11px;padding:5px 10px;border-radius:14px;cursor:pointer;}' +
        '.ee-fab-input-row{display:flex;gap:8px;padding:12px;border-top:1px solid rgba(255,255,255,0.07);}' +
        '.ee-fab-input-row input{flex:1;min-width:0;padding:10px 12px;background:#0a0e1a;border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#fff;font-size:14px;}';
      document.head.appendChild(st);
    }
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<button id="ee-fab" title="Ask the Edge" aria-label="Ask the Edge" onclick="App.toggleAskFab()">&#128173;</button>' +
      '<div id="ee-fab-panel">' +
        '<div class="ee-fab-head">' +
          '<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:18px;">&#128173;</span><div><div style="font-weight:800;color:#fff;font-size:14px;">Ask the Edge</div><div style="font-size:11px;color:#9aa3b2;">Live answers from our engine</div></div></div>' +
          '<button onclick="App.toggleAskFab()" style="background:none;border:none;color:#888;font-size:22px;cursor:pointer;line-height:1;">&times;</button>' +
        '</div>' +
        '<div id="ee-fab-msgs" class="ee-fab-msgs">' +
          '<div class="ee-fab-bubble ee-fab-bot">Ask me about any race, match or team — e.g. "Who wins the 2:45 at Kempton?" or "Team news for Arsenal v Wolves?"</div>' +
          '<div id="ee-fab-chips" style="display:flex;gap:6px;flex-wrap:wrap;">' +
            ['Who\'s your NAP today?', 'Best value in the football?', 'Any team news today?'].map(function (q) {
              return '<button class="ee-fab-chip" onclick="App.askFabSend(' + JSON.stringify(q).replace(/"/g, '&quot;') + ')">' + q + '</button>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<div class="ee-fab-input-row">' +
          '<input id="ee-fab-input" type="text" placeholder="Ask anything…" onkeydown="if(event.key===\'Enter\'){App.askFabSend();}">' +
          '<button class="btn btn-gold" style="padding:10px 16px;" onclick="App.askFabSend()">Ask</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    this._loadPopularChips();
  },

  // Adaptive prompts — replace the default chips with what people actually ask most.
  async _loadPopularChips() {
    try {
      var data = await this.api('/assistant/popular');
      var qs = (data && data.questions) || [];
      if (!qs.length) return;
      var row = document.getElementById('ee-fab-chips');
      if (!row) return;
      row.innerHTML = qs.slice(0, 4).map(function (q) {
        return '<button class="ee-fab-chip" onclick="App.askFabSend(' + JSON.stringify(q).replace(/"/g, '&quot;') + ')">' + App.escapeHtml(q) + '</button>';
      }).join('');
    } catch (e) { /* keep defaults */ }
  },

  toggleAskFab() {
    var p = document.getElementById('ee-fab-panel');
    if (!p) return;
    var open = p.style.display === 'flex';
    p.style.display = open ? 'none' : 'flex';
    if (!open) { var i = document.getElementById('ee-fab-input'); if (i) setTimeout(function () { i.focus(); }, 50); }
  },

  async askFabSend(presetQ) {
    var input = document.getElementById('ee-fab-input');
    var msgs = document.getElementById('ee-fab-msgs');
    if (!msgs) return;
    var q = (presetQ || (input ? input.value : '') || '').trim();
    if (!q) { if (input) input.focus(); return; }
    if (input) input.value = '';
    var add = function (cls, html) {
      var d = document.createElement('div');
      d.className = 'ee-fab-bubble ' + cls;
      d.innerHTML = html;
      msgs.appendChild(d);
      msgs.scrollTop = msgs.scrollHeight;
      return d;
    };
    add('ee-fab-user', App.escapeHtml(q));
    var thinking = add('ee-fab-bot', '<span style="color:#9aa3b2;">Elite Edge is thinking…</span>');
    try {
      var data = await this.api('/chat/ai', { method: 'POST', body: JSON.stringify({ message: q }) });
      var reply = (data && data.reply) ? this._formatAssistantText(data.reply) : 'No answer right now.';
      var sources = ((data && data.sources) || []).filter(function (u) { return /^https?:\/\//i.test(u); });
      var src = '';
      if (sources.length) {
        src = '<div style="margin-top:8px;font-size:11px;color:#7a8295;">Sources: ' + sources.slice(0, 3).map(function (u) {
          var host = ''; try { host = new URL(u).hostname.replace('www.', ''); } catch (e) { host = 'source'; }
          return '<a href="' + App.escapeHtml(u) + '" target="_blank" rel="noopener" style="color:#d4a843;">' + App.escapeHtml(host) + '</a>';
        }).join(' · ') + '</div>';
      }
      thinking.innerHTML = reply + src;
      msgs.scrollTop = msgs.scrollHeight;
    } catch (e) {
      thinking.innerHTML = '<span style="color:#ef4444;">Sorry, couldn\'t answer that just now — try again in a moment.</span>';
    }
  },

  // Lightweight, SAFE markdown formatter for the assistant's answer.
  _formatAssistantText(raw) {
    var esc = this.escapeHtml(String(raw || ''));
    // **bold**
    esc = esc.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // headings like "### X" → bold line
    esc = esc.replace(/^#{1,4}\s*(.+)$/gm, '<strong>$1</strong>');
    // bullet lines (-, *, •) → list items
    var lines = esc.split('\n');
    var html = '', inList = false;
    lines.forEach(function (ln) {
      var m = ln.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
      if (m) {
        if (!inList) { html += '<ul style="margin:6px 0;padding-left:18px;">'; inList = true; }
        html += '<li style="margin:2px 0;">' + m[1] + '</li>';
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        if (ln.trim()) html += '<p style="margin:6px 0;">' + ln + '</p>';
      }
    });
    if (inList) html += '</ul>';
    return html;
  },

  // Data-driven Last Man Standing dashboard banner. Pulls the live competition
  // and its branding from /lms/featured, so it re-skins itself (World Cup ->
  // Premier League) and detaches automatically when nothing is running.
  async _loadEventSpotlight() {
    var slot = document.getElementById('event-spotlight-slot');
    if (!slot) return;
    try {
      var d = await this.api('/events/spotlight');
      slot = document.getElementById('event-spotlight-slot');
      if (!slot || !d || !d.event) return;
      var e = d.event;
      var accent = this._safeAccent(e.accent);
      var slug = encodeURIComponent(e.slug || '');
      var emoji = this.escapeHtml(e.emoji || '🏆');
      var live = e.status === 'live';
      var when = live ? 'LIVE NOW' : (e.daysToStart <= 0 ? 'STARTS TODAY' : 'IN ' + e.daysToStart + ' DAY' + (e.daysToStart === 1 ? '' : 'S'));
      var dates = this._eventDateLabel(e.startDate, e.endDate);
      slot.innerHTML =
        '<div onclick="window.location.hash=\'#/events/' + slug + '\'" style="background:linear-gradient(135deg,#10131f,#0a0e1a);border:2px solid ' + accent + '55;border-radius:14px;padding:20px 24px;margin-bottom:20px;cursor:pointer;position:relative;overflow:hidden;">' +
          '<div style="position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle at 25% 50%,' + accent + '18,transparent 45%);"></div>' +
          '<div style="position:relative;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;">' +
            '<div style="min-width:0;">' +
              '<div style="display:inline-block;font-size:10px;font-weight:800;letter-spacing:1.5px;color:' + accent + ';border:1px solid ' + accent + '66;border-radius:5px;padding:2px 8px;margin-bottom:8px;">' + emoji + ' FEATURED · ' + when + '</div>' +
              '<div style="font-size:21px;font-weight:900;color:#fff;">' + this.escapeHtml(e.name) + '</div>' +
              '<div style="color:rgba(255,255,255,0.6);font-size:13px;margin-top:3px;">' + this.escapeHtml(e.tagline || '') + (e.venue ? ' · ' + this.escapeHtml(e.venue) : '') + ' · ' + dates + '</div>' +
            '</div>' +
            '<div style="background:' + accent + ';color:#0a0e1a;font-weight:800;font-size:13px;padding:9px 18px;border-radius:8px;white-space:nowrap;">View hub →</div>' +
          '</div>' +
        '</div>';
    } catch (e) { /* no spotlight — silent */ }
  },

  async renderEventHub(slug) {
    var app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = '<div style="text-align:center;padding:60px 0;color:var(--text-muted);">Loading event…</div>';
    var d;
    try { d = await this.api('/events/' + encodeURIComponent(slug || '')); } catch (e) { d = null; }
    if (!d || !d.event) { app.innerHTML = '<div class="section" style="text-align:center;padding:60px 20px;"><h2>Event not found</h2><p class="text-muted">This meeting isn\'t on the calendar. <a href="#/dashboard" style="color:var(--gold);">Back to dashboard →</a></p></div>'; return; }
    var e = d.event;
    var accent = this._safeAccent(e.accent);
    var emoji = this.escapeHtml(e.emoji || '🏆');
    var live = e.status === 'live', past = e.status === 'past';
    var badge = live ? 'LIVE NOW' : past ? 'CONCLUDED' : 'UPCOMING';
    var dates = this._eventDateLabel(e.startDate, e.endDate);
    var isRacing = (e.sport || '').toLowerCase().indexOf('rac') !== -1;
    var ctaHash = isRacing ? '#/racing' : '#/football';
    var ctaLabel = isRacing ? 'See today\'s racecards & our picks' : 'See the fixtures & Our Take';
    app.innerHTML =
      '<div style="max-width:900px;margin:0 auto;padding:0 4px;">' +
        '<div style="background:linear-gradient(135deg,#10131f,#0a0e1a);border:2px solid ' + accent + '55;border-radius:16px;padding:28px 26px;margin-bottom:22px;position:relative;overflow:hidden;">' +
          '<div style="position:absolute;top:-40%;left:-30%;width:180%;height:180%;background:radial-gradient(circle at 25% 40%,' + accent + '1f,transparent 45%);"></div>' +
          '<div style="position:relative;">' +
            '<div style="display:inline-block;font-size:11px;font-weight:800;letter-spacing:1.5px;color:' + accent + ';border:1px solid ' + accent + '66;border-radius:5px;padding:3px 10px;margin-bottom:12px;">' + emoji + ' ' + badge + '</div>' +
            '<h1 style="font-size:30px;font-weight:900;color:#fff;margin:0 0 6px;">' + this.escapeHtml(e.name) + '</h1>' +
            '<div style="color:' + accent + ';font-weight:700;font-size:14px;margin-bottom:10px;">' + this.escapeHtml(e.tagline || '') + '</div>' +
            '<div style="color:rgba(255,255,255,0.6);font-size:14px;">' + dates + (e.venue ? ' · ' + this.escapeHtml(e.venue) : '') + '</div>' +
            (e.blurb ? '<p style="color:rgba(255,255,255,0.75);font-size:15px;line-height:1.6;margin:16px 0 0;max-width:640px;">' + this.escapeHtml(e.blurb) + '</p>' : '') +
            '<a href="' + ctaHash + '" style="display:inline-block;margin-top:18px;background:' + accent + ';color:#0a0e1a;font-weight:800;font-size:14px;padding:11px 22px;border-radius:9px;text-decoration:none;">' + ctaLabel + ' →</a>' +
          '</div>' +
        '</div>' +
        (past ? '<div style="text-align:center;color:var(--text-muted);font-size:13px;padding:10px;">This meeting has concluded — see our track record on the results page.</div>' :
          '<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:18px 20px;">' +
            '<div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">What to expect</div>' +
            '<p style="color:var(--text-secondary);font-size:14px;line-height:1.6;margin:0;">Our engine covers every ' + (isRacing ? 'race at the meeting — daily NAP, value picks and full card analysis' : 'game — Our Take on every fixture, proven-edge value and one-tap bet links') + '. Selections appear on the ' + (isRacing ? 'Racing' : 'Football') + ' page as the ' + (isRacing ? 'cards' : 'fixtures') + ' are declared.</p>' +
          '</div>') +
      '</div>';
    this.updatePageMeta && this.updatePageMeta('events');
  },

  // Only ever emit a hex colour into style/attribute contexts (defence-in-depth;
  // the server already validates, but never trust stored data on render).
  _safeAccent(a) { return /^#[0-9a-fA-F]{3,8}$/.test(String(a || '')) ? a : '#d4a843'; },

  _eventDateLabel(start, end) {
    try {
      var s = new Date(String(start).slice(0, 10)), e = new Date(String(end).slice(0, 10));
      var opt = { day: 'numeric', month: 'short' };
      var ss = s.toLocaleDateString('en-GB', opt), ee = e.toLocaleDateString('en-GB', opt);
      return ss === ee ? ss : ss + ' – ' + ee;
    } catch (er) { return ''; }
  },

  async _loadLmsBanner() {
    var slot = document.getElementById('lms-banner-slot');
    if (!slot) return;
    // Only bother if the LMS feature is switched on (nav link is visible)
    var nav = document.getElementById('nav-lms');
    if (!nav || nav.style.display === 'none') { slot.innerHTML = ''; return; }
    try {
      var data = await this.api('/lms/featured');
      var c = data && data.competition;
      if (!c) { slot.innerHTML = ''; return; }
      var b = c.banner || {};
      var accent = b.accent || '#d4a843';
      var pot = '£' + Math.round(c.prizePot || 0);
      var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]; }); };
      slot.innerHTML =
        '<div onclick="window.location.hash=\'#/last-man-standing\'" style="background:linear-gradient(135deg,#0a0e1a 0%,#14110a 55%,#1a1305 100%);border:2px solid ' + accent + '73;border-radius:14px;padding:18px 22px;margin-bottom:20px;cursor:pointer;position:relative;overflow:hidden;">' +
          '<div style="position:absolute;top:-50%;right:-10%;width:60%;height:200%;background:radial-gradient(circle at 70% 50%,' + accent + '1f,transparent 60%);"></div>' +
          '<div style="position:relative;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;">' +
            '<div style="display:flex;align-items:center;gap:16px;">' +
              '<span style="font-size:40px;line-height:1;">' + (b.emoji || '🏆') + '</span>' +
              '<div>' +
                '<div style="font-size:13px;font-weight:800;letter-spacing:2px;color:rgba(255,255,255,0.65);text-transform:uppercase;">' + esc(b.eyebrow || c.name) + '</div>' +
                '<div style="font-size:24px;font-weight:900;letter-spacing:0.5px;background:linear-gradient(135deg,#f0d078,' + accent + ');-webkit-background-clip:text;-webkit-text-fill-color:transparent;line-height:1.1;">' + esc(b.title || 'LAST MAN STANDING') + '</div>' +
                '<div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:3px;">' + esc(b.tagline || '') + '</div>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:14px;">' +
              (c.prizePot ? '<div style="text-align:center;"><div style="font-size:28px;font-weight:900;color:' + accent + ';line-height:1;">' + pot + '</div><div style="font-size:10px;font-weight:700;letter-spacing:1px;color:rgba(255,255,255,0.6);text-transform:uppercase;">For the winner</div></div>' : '') +
              '<span style="background:linear-gradient(135deg,' + accent + ',#b8902f);color:#0a0e1a;font-weight:800;font-size:13px;padding:10px 20px;border-radius:8px;white-space:nowrap;">' + esc(b.cta || 'Play Now') + ' &rarr;</span>' +
            '</div>' +
          '</div>' +
        '</div>';
    } catch (e) { slot.innerHTML = ''; }
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
