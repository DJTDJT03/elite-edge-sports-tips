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
  // INIT
  // -----------------------------------------------------------------------
  init() {
    this.loadTheme();
    this.loadOddsFormat();
    this.updateAuthUI();
    this.bindNav();
    window.addEventListener('hashchange', () => this.route());
    this.route();
    this.loadDailyStats();
    this.initNotifications();
    this.checkReferralParam();
    this.initCookieConsent();
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

  async fetchLiveFootball(forceRefresh) {
    if (!forceRefresh) {
      var cached = this._getCached('football', 600000); // 10 min
      if (cached) return cached;
    }
    try {
      var data = await this.api('/football/live-fixtures');
      if (data) this._setCache('football', data);
      return data;
    } catch (e) { return { live: false, fixtures: [] }; }
  },

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
      if (!res.ok) throw new Error(data.error || 'Request failed');
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
  // AUTH
  // -----------------------------------------------------------------------
  async login(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    try {
      const { token, user } = await this.api('/auth/login', {
        method: 'POST', body: JSON.stringify({ email, password })
      });
      this.token = token; this.user = user;
      localStorage.setItem('ee_token', token);
      localStorage.setItem('ee_user', JSON.stringify(user));
      this.updateAuthUI();
      this.closeModal();
      trackEvent('auth', 'login', email);
      // Show onboarding on first login (Feature #10)
      if (!localStorage.getItem('onboardingDone')) {
        this.showOnboarding();
      }
      this.route();
    } catch (err) {
      document.getElementById('login-error').textContent = err.message;
    }
  },

  async register(e) {
    e.preventDefault();
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
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
      const { token, user } = await this.api('/auth/register', {
        method: 'POST', body: JSON.stringify({ name, email, password, agreementTimestamp })
      });
      this.token = token; this.user = user;
      // Email verification placeholder (Feature #3)
      // In production: integrate SendGrid here to send verification email
      // e.g. await sendVerificationEmail(user.email, verificationToken);
      user.emailVerified = false;
      localStorage.setItem('ee_token', token);
      localStorage.setItem('ee_user', JSON.stringify(user));
      this.updateAuthUI();
      this.closeModal();
      // Show email verification message
      this.showEmailVerificationMessage();
      trackEvent('auth', 'register', email);
      this.route();
    } catch (err) {
      document.getElementById('reg-error').textContent = err.message;
    }
  },

  logout() {
    this.token = null; this.user = null;
    localStorage.removeItem('ee_token');
    localStorage.removeItem('ee_user');
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

    if (this.user) {
      guest.style.display = 'none';
      userEl.style.display = 'flex';
      badge.textContent = this.user.name;
      badge.style.cursor = 'pointer';
      badge.onclick = () => this.showReferral();
      adminLink.style.display = this.user.role === 'admin' ? 'inline-block' : 'none';
      if (myBetsLink) myBetsLink.style.display = 'inline-block';
      if (this.user.subscription === 'free') {
        subBar.style.display = 'block';
        subBar.innerHTML = 'You are on the <strong>Free</strong> plan. <a href="#/pricing">Upgrade to Premium</a> for full access to all tips and analysis.';
      } else if (this.user.subscription === 'premium') {
        subBar.style.display = 'block';
        subBar.innerHTML = '<strong>Premium</strong> member — Full access enabled. Thank you for your subscription.';
      } else {
        subBar.style.display = 'none';
      }
    } else {
      guest.style.display = 'flex';
      userEl.style.display = 'none';
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
  },

  closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
  },

  // -----------------------------------------------------------------------
  // NAVIGATION
  // -----------------------------------------------------------------------
  bindNav() {
    document.getElementById('nav-toggle').addEventListener('click', () => {
      document.getElementById('nav-links').classList.toggle('open');
    });
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        document.getElementById('nav-links').classList.remove('open');
      });
    });
  },

  route() {
    const hash = window.location.hash.replace('#/', '') || 'dashboard';
    const page = hash.split('/')[0] || 'dashboard';
    this.currentPage = page;

    // Update active nav
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.page === page);
    });

    const app = document.getElementById('app');
    app.className = 'animate-in';

    switch (page) {
      case 'dashboard': case '': this.renderDashboard(); break;
      case 'racing': this.renderRacing(); break;
      case 'football': this.renderFootball(); break;
      case 'results': this.renderResults(); break;
      case 'pricing': this.renderPricing(); break;
      case 'analysts': this.renderAnalysts(); break;
      case 'support': this.renderSupport(); break;
      case 'admin': this.renderAdmin(); break;
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
      default: this.render404();
    }
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
      const todayTips = tips.length;
      const todayResults = results.filter(r => r.date === today);
      const won = todayResults.filter(r => r.result === 'won').length;
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

  toggleBacked(tipId, selection, odds, result) {
    const bets = this.getMyBets();
    const idx = bets.findIndex(b => b.tipId === tipId);
    if (idx >= 0) {
      bets.splice(idx, 1);
    } else {
      bets.push({ tipId, selection, odds, result: result || null, date: new Date().toISOString() });
      trackEvent('betting', 'bet_placed', selection);
    }
    this.saveMyBets(bets);
    // Update button state
    const btn = document.getElementById(`backed-${tipId}`);
    if (btn) {
      const isBacked = bets.find(b => b.tipId === tipId);
      btn.className = isBacked ? 'backed-btn backed' : 'backed-btn';
      btn.textContent = isBacked ? 'Backed' : 'I backed this';
    }
  },

  renderMyBets() {
    const content = document.getElementById('mybets-content');
    if (!content) return;
    const bets = this.getMyBets();
    if (!bets.length) {
      content.innerHTML = '<p class="text-muted">No bets tracked yet. Click "I backed this" on any tip card to start tracking.</p>';
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
  // ACCUMULATOR BUILDER (Enhancement #7)
  // -----------------------------------------------------------------------
  toggleAcca(tipId, selection, odds, e) {
    if (e) e.stopPropagation();
    const idx = this.accaSelections.findIndex(a => a.tipId === tipId);
    if (idx >= 0) {
      this.accaSelections.splice(idx, 1);
    } else {
      this.accaSelections.push({ tipId, selection, odds });
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
  },

  // -----------------------------------------------------------------------
  // SOCIAL SHARING (Enhancement #8)
  // -----------------------------------------------------------------------
  shareWin(selection, odds) {
    const text = `Another winner from @EliteEdgeTips! ${selection} @ ${odds} \u2705 Join us: https://eliteedgesports.co.uk #EliteEdgeTips #Winner`;
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  },

  copyShareText(selection, odds) {
    const text = `Another winner from EliteEdgeTips! ${selection} @ ${odds} \u2705 Join us: https://eliteedgesports.co.uk`;
    navigator.clipboard.writeText(text).then(() => {
      alert('Copied to clipboard!');
    }).catch(() => {
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
      return '<span class="odds-movement drifted" title="Odds drifted (value increasing)">\u2191 Drifted</span>';
    } else if (currentOdds < openingOdds) {
      return '<span class="odds-movement shortened" title="Odds shortened">\u2193 Shortened</span>';
    }
    return '<span class="odds-movement" style="color:var(--text-muted);">\u2194 Steady</span>';
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
    </div>`;
  },

  // -----------------------------------------------------------------------
  // DASHBOARD
  // -----------------------------------------------------------------------
  async renderDashboard() {
    const app = document.getElementById('app');
    app.innerHTML = `<div class="container">
      <div class="page-header"><h1>Welcome to <span class="accent">Elite Edge</span></h1><p>Loading today's selections...</p></div>
      <div class="grid grid-2">${'<div class="skeleton skeleton-card"></div>'.repeat(4)}</div>
    </div>`;

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
    const recentWins = allResults.filter(r => r.result === 'won').slice(-8);
    const streak = this.calculateStreak(allResults);

    // Date-aware: filter to today/tomorrow, archive older
    var today = this._getToday();
    var tomorrow = this._getTomorrow();
    var yesterday = this._getYesterday();
    var tips = allTips.filter(function(t) {
      if (!t.date) return true;
      return t.date >= yesterday;
    });
    var todayTips = tips.filter(function(t) { return !t.date || t.date === today; });
    var tomorrowTips = tips.filter(function(t) { return t.date === tomorrow; });
    var recentTips = tips.filter(function(t) { return t.date === yesterday; });

    // Find NAP of the day
    const napTip = tips.find(t => t.isNap && !t.locked);

    app.innerHTML = `
      <div class="container">
        <div class="page-header">
          <h1>Welcome to <span class="accent">Elite Edge</span></h1>
          <p>Today's premium betting intelligence — ${new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}</p>
        </div>

        <!-- Quality Philosophy Banner -->
        <div style="background:linear-gradient(135deg, rgba(212,168,67,0.1), rgba(212,168,67,0.02));border:1px solid rgba(212,168,67,0.2);border-radius:12px;padding:16px 20px;margin-bottom:20px;display:flex;align-items:center;gap:16px;">
          <div style="font-size:28px;">🎯</div>
          <div>
            <div style="font-weight:700;font-size:14px;color:#d4a843;margin-bottom:2px;">Quality Over Quantity — We Only Tip When The Edge Is Real</div>
            <div style="font-size:12px;color:var(--text-secondary);">We publish 2-4 selections daily maximum. If there's no genuine edge, we say "no bet today". We never publish filler tips to hit a quota. Every selection has a calculated statistical edge.</div>
          </div>
        </div>

        <!-- Trust Banner -->
        <div class="trust-banner">
          <div class="trust-item"><div class="trust-value">+${perf.roi}%</div><div class="trust-label">Overall ROI</div></div>
          <div class="trust-item"><div class="trust-value">${perf.strikeRate}%</div><div class="trust-label">Strike Rate</div></div>
          <div class="trust-item"><div class="trust-value">${perf.runningBank}</div><div class="trust-label">Running Bank (units)</div></div>
          <div class="trust-item"><div class="trust-value">${perf.totalTips}</div><div class="trust-label">Tips Published</div></div>
          <div class="trust-item"><div class="trust-value">${perf.wins}</div><div class="trust-label">Winners</div></div>
          ${streak > 1 ? `<div class="trust-item"><div class="streak-badge">\ud83d\udd25 ${streak}-Tip Winning Streak</div></div>` : ''}
        </div>

        <!-- Recent Wins Ticker -->
        ${recentWins.length ? `
        <div class="ticker-wrap">
          <div class="ticker">
            ${recentWins.concat(recentWins).map(w => `
              <div class="ticker-item">
                <span class="win-tag">WIN</span>
                <span>${w.selection}</span>
                <span class="odds-tag">@ ${this.formatOdds(w.odds)}</span>
                <span class="text-muted">(+${w.pnl > 0 ? w.pnl.toFixed(2) : '0'} units)</span>
                <button class="share-btn" onclick="event.stopPropagation();App.shareWin('${w.selection.replace(/'/g, "\\'")}', ${w.odds})" title="Share on X/Twitter">Share</button>
              </div>
            `).join('')}
          </div>
        </div>` : ''}

        <!-- Recent Winners Grid (permanent, high visibility) -->
        ${recentWins.length ? `
        <div class="section" style="margin-bottom:24px;">
          <div class="section-title"><span style="color:#22c55e;">&#10003;</span> Verified Recent Winners</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">
            ${recentWins.slice(-6).reverse().map(w => `
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

        <!-- NAP OF THE DAY (Enhancement #4) -->
        ${napTip ? `
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
        </div>` : ''}

        <!-- Free Weekly Acca -->
        ${this.renderWeeklyAcca(tips)}

        <!-- Today's Tips -->
        <div class="section">
          <div class="section-title"><span class="icon">&#9826;</span> Today's Selections (${todayTips.length} tips)</div>
          <div class="date-tabs">
            <button class="date-tab active" onclick="App.filterDashDate('today',this)">Today</button>
            ${tomorrowTips.length ? '<button class="date-tab" onclick="App.filterDashDate(\'tomorrow\',this)">Tomorrow (' + tomorrowTips.length + ')</button>' : ''}
            ${recentTips.length ? '<button class="date-tab" onclick="App.filterDashDate(\'recent\',this)">Yesterday (' + recentTips.length + ')</button>' : ''}
          </div>
          <div class="tabs">
            <button class="tab active" onclick="App.filterDashTips('all', this)">All</button>
            <button class="tab" onclick="App.filterDashTips('racing', this)">Racing</button>
            <button class="tab" onclick="App.filterDashTips('football', this)">Football</button>
            <button class="tab" onclick="App.filterDashTips('free', this)">Free</button>
            <button class="tab" onclick="App.filterDashTips('premium', this)">Premium</button>
          </div>
          <div class="grid grid-2" id="dash-tips">
            ${tips.filter(t => !t.isNap && !t.isWeeklyAcca).map((t, i) => {
              let html = this.renderTipCard(t);
              if ((i + 1) % 3 === 0 && i < 9) html += this.renderAdSlot(Math.floor((i + 1) / 3));
              return html;
            }).join('')}
          </div>
        </div>

        <!-- Testimonials -->
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

        <!-- Telegram CTA (Feature #8) -->
        <div class="card text-center mb-32" style="padding:32px;">
          <h3 class="mb-8">Join Our Telegram Channel</h3>
          <p class="text-muted mb-16">Get instant tip alerts, live updates, and community discussion in our Telegram group.</p>
          <a href="https://t.me/EliteEdgeTips" target="_blank" rel="noopener" class="telegram-cta">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
            Join our Telegram
          </a>
        </div>

        <!-- CTA -->
        ${!this.user || this.user.subscription === 'free' ? `
        <div class="card card-premium text-center" style="padding:40px;">
          <h2 style="margin-bottom:8px;">Unlock Premium Tips</h2>
          <p class="text-muted mb-24">Join thousands of winning bettors. Get full access to all selections, deep analysis, and priority alerts.</p>
          <a href="#/pricing" class="btn btn-gold btn-lg">View Premium Plans</a>
          <p class="text-xs text-muted mt-16">First month FREE, then &pound;14.99/month. Cancel anytime.</p>
        </div>` : ''}
      </div>
    `;
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
    var filtered = this.tips.filter(function(t) { return !t.isNap && !t.isWeeklyAcca; });
    if (dateFilter === 'today') filtered = filtered.filter(function(t) { return !t.date || t.date === today; });
    else if (dateFilter === 'tomorrow') filtered = filtered.filter(function(t) { return t.date === tomorrow; });
    else if (dateFilter === 'recent') filtered = filtered.filter(function(t) { return t.date === yesterday; });
    container.innerHTML = filtered.map(function(t) { return App.renderTipCard(t); }).join('');
  },

  filterDashTips(filter, btn) {
    document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const container = document.getElementById('dash-tips');
    var today = this._getToday();
    var tomorrow = this._getTomorrow();
    var yesterday = this._getYesterday();
    let filtered = this.tips.filter(t => !t.isNap && !t.isWeeklyAcca);
    // Apply date filter
    if (this._dashDateFilter === 'today') filtered = filtered.filter(function(t) { return !t.date || t.date === today; });
    else if (this._dashDateFilter === 'tomorrow') filtered = filtered.filter(function(t) { return t.date === tomorrow; });
    else if (this._dashDateFilter === 'recent') filtered = filtered.filter(function(t) { return t.date === yesterday; });
    if (filter === 'racing') filtered = filtered.filter(t => t.sport === 'racing');
    if (filter === 'football') filtered = filtered.filter(t => t.sport === 'football');
    if (filter === 'free') filtered = filtered.filter(t => !t.isPremium);
    if (filter === 'premium') filtered = filtered.filter(t => t.isPremium);
    container.innerHTML = filtered.map(t => this.renderTipCard(t)).join('');
  },

  // -----------------------------------------------------------------------
  // TIP CARD (reusable) — includes odds comparison, movement, form, acca, backed
  // -----------------------------------------------------------------------
  renderTipCard(tip) {
    const isLocked = tip.locked;
    const edgeClass = tip.valueRating === 'Elite' ? 'edge-elite' : tip.valueRating === 'High' ? 'edge-high' : tip.valueRating === 'Medium' ? 'edge-medium' : 'edge-low';
    const edgePct = Math.min((tip.edge || 0) * 100 / 0.2 * 100, 100);
    const myBets = this.getMyBets();
    const isBacked = myBets.some(b => b.tipId === tip.id);
    const inAcca = this.accaSelections.some(a => a.tipId === tip.id);

    return `
      <div class="tip-card ${tip.isPremium ? 'premium' : ''} ${isLocked ? 'locked' : ''}" onclick="window.location.hash='#/tip/${tip.id}'">
        <div class="tip-top">
          <div class="tip-badges">
            <span class="tip-sport-badge ${tip.sport === 'racing' ? 'badge-racing' : 'badge-football'}">${tip.sport === 'racing' ? 'Racing' : 'Football'}</span>
            <span class="${tip.isPremium ? 'badge-premium' : 'badge-free'}">${tip.isPremium ? 'Premium' : 'Free'}</span>
            ${tip.valueRating ? `<span class="badge-premium">${tip.valueRating}</span>` : ''}
            ${tip.tipsterProfile ? `<span class="analyst-badge ${tip.tipsterProfile === 'The Professor' ? 'professor' : tip.tipsterProfile === 'The Scout' ? 'scout' : 'edge'}">${tip.tipsterProfile}</span>` : ''}
          </div>
          <div>
            <div class="tip-odds">${tip.locked ? '?.??' : this.formatOdds(tip.odds)} ${!isLocked ? this.renderOddsMovement(tip.odds, tip.openingOdds) : ''}</div>
            <div class="tip-odds-label">${tip.market || ''}</div>
          </div>
        </div>
        <div class="${isLocked ? 'tip-locked-content' : ''}">
          <div class="tip-selection">${tip.selection}</div>
          <div class="tip-event">${tip.event}${tip.league ? ' &bull; ' + tip.league : ''}${tip.raceTime ? ' &bull; ' + tip.raceTime : ''}</div>
          <div class="tip-summary">${tip.analysis?.summary ? tip.analysis.summary.substring(0, 150) + '...' : ''}</div>
          <div class="tip-meta">
            <div class="tip-meta-item"><strong>Confidence:</strong> ${tip.confidence}/10</div>
            <div class="tip-meta-item"><strong>Edge:</strong> ${((tip.edge || 0) * 100).toFixed(1)}%</div>
            <div class="tip-meta-item"><strong>Stake:</strong> ${tip.staking || '-'}</div>
            <div class="tip-meta-item"><strong>Risk:</strong> ${tip.riskLevel || '-'}</div>
          </div>
          ${!isLocked ? this.renderBookmakerOdds(tip.bookmakerOdds) : ''}
          ${!isLocked ? this.renderFormGuide(tip.recentForm, tip.sport) : ''}
          <div class="tip-edge-bar">
            <div class="tip-edge-bar-label"><span>Edge</span><span>${((tip.edge || 0) * 100).toFixed(1)}%</span></div>
            <div class="tip-edge-bar-track"><div class="tip-edge-bar-fill ${edgeClass}" style="width:${edgePct}%"></div></div>
          </div>
          ${!isLocked ? `
          <div style="display:flex;gap:8px;margin-top:10px;align-items:center;">
            <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted);cursor:pointer;" onclick="event.stopPropagation();">
              <input type="checkbox" class="acca-checkbox" id="acca-cb-${tip.id}" ${inAcca ? 'checked' : ''} onchange="App.toggleAcca('${tip.id}','${tip.selection.replace(/'/g, "\\'")}',${tip.odds},event)"> Add to Acca
            </label>
            <button class="backed-btn ${isBacked ? 'backed' : ''}" id="backed-${tip.id}" onclick="event.stopPropagation();App.toggleBacked('${tip.id}','${tip.selection.replace(/'/g, "\\'")}',${tip.odds},'${tip.result || ''}')">${isBacked ? 'Backed' : 'I backed this'}</button>
          </div>` : ''}
        </div>
        ${isLocked ? `
          <div class="lock-overlay">
            <div class="lock-icon">&#128274;</div>
            <div class="lock-text">Premium Tip — Upgrade to View</div>
            <button class="btn btn-gold btn-sm" onclick="event.stopPropagation();window.location.hash='#/pricing'">Upgrade Now</button>
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
    app.innerHTML = '<div class="container"><div class="text-center pulse" style="padding:60px;">Loading tip...</div></div>';

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
          </div>` : ''}

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
          ${analysisSections.map(function(sec) {
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

          ${!this.user || this.user.subscription === 'free' ? `
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
  // RACING PAGE
  // -----------------------------------------------------------------------
  _racingDateTab: 'today',

  async renderRacing() {
    const app = document.getElementById('app');
    app.innerHTML = '<div class="container"><div class="text-center pulse" style="padding:60px;">Loading racing tips...</div></div>';

    var liveData = null;
    try {
      var results = await Promise.all([
        this.api('/tips?sport=racing'),
        this.fetchLiveRacing()
      ]);
      this.tips = results[0];
      liveData = results[1];
    } catch { try { this.tips = await this.api('/tips?sport=racing'); } catch {} }

    const tips = this.tips.filter(t => t.sport === 'racing');
    const meetings = [...new Set(tips.map(t => t.meeting))];
    var hasLiveCards = liveData && liveData.live && liveData.racecards && liveData.racecards.length > 0;
    var racecards = hasLiveCards ? liveData.racecards : [];
    var liveUpdatedAt = liveData && liveData.fetchedAt ? new Date(liveData.fetchedAt) : null;

    // Group live racecards by meeting
    var liveMeetings = {};
    racecards.forEach(function(r) {
      var key = r.meeting || 'Unknown';
      if (!liveMeetings[key]) liveMeetings[key] = [];
      liveMeetings[key].push(r);
    });

    // Date tabs for tips
    var today = this._getToday();
    var tomorrow = this._getTomorrow();
    var weekendDates = this._getWeekendDates();
    var tomorrowTips = tips.filter(function(t) { return t.date === tomorrow; });

    app.innerHTML = `
      <div class="container">
        <div class="page-header">
          <h1><span class="accent">Horse Racing</span> Tips</h1>
          <p>Daily race cards, selections, and deep form analysis across UK & Irish meetings</p>
        </div>

        <!-- Date Tabs -->
        <div class="date-tabs">
          <button class="date-tab active" onclick="App._racingDateTab='today';App.renderRacing()">Today</button>
          ${tomorrowTips.length ? '<button class="date-tab" onclick="App._racingDateTab=\'tomorrow\';App.renderRacing()">Tomorrow</button>' : ''}
          <button class="date-tab" onclick="App._racingDateTab='weekend';App.renderRacing()">This Weekend</button>
        </div>

        <!-- Live Race Cards -->
        ${hasLiveCards ? `
        <div class="section">
          <div class="live-data-header">
            <span class="live-badge">Live Race Cards</span>
            <div class="live-updated">
              ${liveUpdatedAt ? 'Updated ' + this.timeAgo(liveUpdatedAt.toISOString()) : ''}
              <button class="refresh-btn" onclick="App.refreshRacingData(this)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                Refresh
              </button>
            </div>
          </div>
          ${Object.keys(liveMeetings).map(function(meetingName) {
            var races = liveMeetings[meetingName];
            return '<div class="meeting-card"><h3>\ud83c\udfc7 ' + meetingName + ' (' + races.length + ' races)</h3>' +
              races.map(function(race) {
                var runnersHtml = '';
                if (race.runners && race.runners.length) {
                  runnersHtml = '<table class="runner-table"><thead><tr><th>Draw</th><th>Horse</th><th>Jockey</th><th>Trainer</th><th>Form</th><th>OR</th><th>Wt</th><th>Odds</th></tr></thead><tbody>' +
                    race.runners.map(function(r) {
                      return '<tr><td>' + (r.draw || '-') + '</td><td style="font-weight:600;">' + (r.horseName || '-') + '</td><td>' + (r.jockey || '-') + '</td><td>' + (r.trainer || '-') + '</td><td>' + (r.form || '-') + '</td><td>' + (r.officialRating || '-') + '</td><td>' + (r.weight || '-') + '</td><td style="font-weight:700;color:var(--gold);">' + (r.odds ? App.formatOdds(parseFloat(r.odds)) : '-') + '</td></tr>';
                    }).join('') +
                    '</tbody></table>';
                }
                return '<div style="margin-bottom:12px;padding:10px 0;border-bottom:1px solid var(--border);">' +
                  '<div class="race-row"><span class="race-time">' + (race.time || '-') + '</span><span class="race-name">' + (race.raceName || '') + '</span><span class="race-info">' + [race.raceClass, race.distance, race.going].filter(Boolean).join(' | ') + '</span></div>' +
                  runnersHtml + '</div>';
              }).join('') + '</div>';
          }).join('')}
        </div>` : ''}

        <div class="filter-bar">
          <select onchange="App.filterRacing(this.value, 'meeting')">
            <option value="">All Meetings</option>
            ${meetings.map(m => `<option value="${m}">${m}</option>`).join('')}
          </select>
          <select onchange="App.filterRacing(this.value, 'market')">
            <option value="">All Markets</option>
            <option value="Win">Win</option>
            <option value="Each-Way">Each-Way</option>
            <option value="Value Outsider">Value Outsider</option>
          </select>
          <select onchange="App.filterRacing(this.value, 'going')">
            <option value="">All Going</option>
            <option value="Good to Firm">Good to Firm</option>
            <option value="Good">Good</option>
            <option value="Good to Soft">Good to Soft</option>
            <option value="Soft">Soft</option>
            <option value="Standard (AW)">Standard (AW)</option>
          </select>
          <select onchange="App.filterRacing(this.value, 'analyst')">
            <option value="">All Analysts</option>
            <option value="The Professor">The Professor</option>
            <option value="The Scout">The Scout</option>
            <option value="The Edge">The Edge</option>
          </select>
        </div>

        <!-- Race Card Summary -->
        <div class="card mb-24">
          <h3 class="mb-16">Today's Meetings</h3>
          <div class="grid grid-4">
            ${meetings.map(m => {
              const mTips = tips.filter(t => t.meeting === m);
              return `
                <div class="stat-card" style="cursor:pointer;" onclick="App.filterRacing('${m}','meeting')">
                  <div style="font-size:18px;font-weight:700;margin-bottom:4px;">${m}</div>
                  <div class="text-sm text-muted">${mTips.length} selection${mTips.length !== 1 ? 's' : ''}</div>
                  <div class="text-xs text-gold mt-8">${mTips.map(t => t.raceTime).join(', ')}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="section">
          <div class="section-title"><span class="icon">&#9826;</span> Racing Selections</div>
          <div class="grid grid-2" id="racing-tips">
            ${tips.map(t => this.renderTipCard(t)).join('')}
          </div>
        </div>

        ${!this.user || this.user.subscription === 'free' ? `
        <div class="card card-premium text-center" style="padding:32px;">
          <h3 class="mb-8">Unlock All Racing Tips</h3>
          <p class="text-muted mb-16">Premium members get 3-5 extra racing tips daily with full form analysis, speed figures, and trainer statistics.</p>
          <a href="#/pricing" class="btn btn-gold">Upgrade Now</a>
        </div>` : ''}
      </div>
    `;
  },

  async refreshRacingData(btn) {
    if (btn) { btn.classList.add('spinning'); btn.disabled = true; }
    try {
      await this.fetchLiveRacing(true);
      this.renderRacing();
    } catch (e) { console.error('Refresh failed:', e); }
    if (btn) { btn.classList.remove('spinning'); btn.disabled = false; }
  },

  async filterRacing(value, type) {
    let tips = this.tips.filter(t => t.sport === 'racing');
    if (value && type === 'meeting') tips = tips.filter(t => t.meeting === value);
    if (value && type === 'market') tips = tips.filter(t => t.market === value);
    if (value && type === 'going') tips = tips.filter(t => t.going === value);
    if (value && type === 'analyst') tips = tips.filter(t => t.tipsterProfile === value);
    document.getElementById('racing-tips').innerHTML = tips.map(t => this.renderTipCard(t)).join('') || '<p class="text-muted">No tips match these filters.</p>';
  },

  // -----------------------------------------------------------------------
  // FOOTBALL PAGE
  // -----------------------------------------------------------------------
  async renderFootball() {
    const app = document.getElementById('app');
    app.innerHTML = '<div class="container"><div class="text-center pulse" style="padding:60px;">Loading football tips...</div></div>';

    var liveData = null;
    try {
      var results = await Promise.all([
        this.api('/tips?sport=football'),
        this.fetchLiveFootball()
      ]);
      this.tips = results[0];
      liveData = results[1];
    } catch { try { this.tips = await this.api('/tips?sport=football'); } catch {} }

    const tips = this.tips.filter(t => t.sport === 'football');
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

    // Date tabs
    var today = this._getToday();
    var tomorrow = this._getTomorrow();
    var tomorrowTips = tips.filter(function(t) { return t.date === tomorrow; });

    app.innerHTML = `
      <div class="container">
        <div class="page-header">
          <h1><span class="accent">Football</span> Tips</h1>
          <p>Data-driven selections across Europe's top leagues with xG analysis and injury intelligence</p>
        </div>

        <!-- Date Tabs -->
        <div class="date-tabs">
          <button class="date-tab active" onclick="App.renderFootball()">Today</button>
          ${tomorrowTips.length ? '<button class="date-tab">Tomorrow (' + tomorrowTips.length + ')</button>' : ''}
          <button class="date-tab">This Weekend</button>
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
                return '<div class="fixture-card">' +
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
            ${leagues.map(l => `<option value="${l}">${l}</option>`).join('')}
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

        <!-- League Badges -->
        <div class="card mb-24">
          <h3 class="mb-16">Today's Fixtures by League</h3>
          <div class="grid grid-3">
            ${leagues.map(l => {
              const lTips = tips.filter(t => t.league === l);
              return `
                <div class="stat-card" style="cursor:pointer;" onclick="App.filterFootball('${l}','league')">
                  <div style="font-size:16px;font-weight:700;margin-bottom:4px;">${l}</div>
                  <div class="text-sm text-muted">${lTips.length} tip${lTips.length !== 1 ? 's' : ''}</div>
                  <div class="text-xs text-gold mt-8">${lTips.map(t => t.event).join(' | ')}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="section">
          <div class="section-title"><span class="icon">&#9917;</span> Football Selections</div>
          <div class="grid grid-2" id="football-tips">
            ${tips.map(t => this.renderTipCard(t)).join('')}
          </div>
        </div>

        ${!this.user || this.user.subscription === 'free' ? `
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
    let tips = this.tips.filter(t => t.sport === 'football');
    if (value && type === 'league') tips = tips.filter(t => t.league === value);
    if (value && type === 'market') tips = tips.filter(t => t.market === value);
    if (value && type === 'analyst') tips = tips.filter(t => t.tipsterProfile === value);
    document.getElementById('football-tips').innerHTML = tips.map(t => this.renderTipCard(t)).join('') || '<p class="text-muted">No tips match these filters.</p>';
  },

  // -----------------------------------------------------------------------
  // RESULTS PAGE
  // -----------------------------------------------------------------------
  async renderResults() {
    const app = document.getElementById('app');
    app.innerHTML = '<div class="container"><div class="text-center pulse" style="padding:60px;">Loading results...</div></div>';

    try {
      const [results, perf] = await Promise.all([
        this.api('/results'),
        this.api('/results/performance'),
      ]);
      this.results = results;
      this.performance = perf;
    } catch {}

    const results = this.results;
    const perf = this.performance || { roi: 0, strikeRate: 0, runningBank: 100, totalPnl: 0, totalTips: 0, wins: 0, losses: 0, avgOdds: 0, longestWinStreak: 0 };

    app.innerHTML = `
      <div class="container">
        <div class="page-header">
          <h1><span class="accent">Results</span> & Performance</h1>
          <p>Full transparency on every published tip. Track record you can trust.</p>
        </div>

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
        <div class="results-sponsor" id="sponsor-results">
          Results powered by <span class="sponsor-name">[ Partner Name ]</span> - Your trusted source for live odds and results
        </div>

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
              <option value="2026-03">March 2026</option>
              <option value="2026-04">April 2026</option>
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
          <div class="card" style="overflow-x:auto;">
            <table class="results-table" id="results-table">
              <thead>
                <tr>
                  <th>Date</th><th>Sport</th><th>Event</th><th>Selection</th><th>Market</th><th>Odds</th><th>Stake</th><th>Result</th><th>P/L</th><th></th>
                </tr>
              </thead>
              <tbody>
                ${results.sort((a,b) => new Date(b.date) - new Date(a.date)).map(r => `
                  <tr>
                    <td>${formatDateUK(r.date)}</td>
                    <td>${r.sport === 'racing' ? 'Racing' : 'Football'}</td>
                    <td>${r.event}</td>
                    <td>${r.selection}</td>
                    <td>${r.market}</td>
                    <td>${this.formatOdds(r.odds)}</td>
                    <td>${r.stake}</td>
                    <td class="result-${r.result}">${r.result.toUpperCase()}</td>
                    <td class="${r.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}">${r.pnl > 0 ? '+' : ''}${r.pnl.toFixed(2)}</td>
                    <td>${r.result === 'won' ? `<button class="share-btn" onclick="App.shareWin('${r.selection.replace(/'/g, "\\'")}',${r.odds})">Share</button> <button class="share-btn" onclick="App.copyShareText('${r.selection.replace(/'/g, "\\'")}',${r.odds})">Copy</button>` : ''}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    this.renderPerformanceChart(perf);
    this.renderMonthlyChart(results);
    this.renderSRChart(results);
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
    const tbody = document.querySelector('#results-table tbody');
    tbody.innerHTML = filtered.sort((a,b) => new Date(b.date) - new Date(a.date)).map(r => `
      <tr>
        <td>${formatDateUK(r.date)}</td>
        <td>${r.sport === 'racing' ? 'Racing' : 'Football'}</td>
        <td>${r.event}</td>
        <td>${r.selection}</td>
        <td>${r.market}</td>
        <td>${App.formatOdds(r.odds)}</td>
        <td>${r.stake}</td>
        <td class="result-${r.result}">${r.result.toUpperCase()}</td>
        <td class="${r.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}">${r.pnl > 0 ? '+' : ''}${r.pnl.toFixed(2)}</td>
        <td>${r.result === 'won' ? `<button class="share-btn" onclick="App.shareWin('${r.selection.replace(/'/g, "\\'")}',${r.odds})">Share</button>` : ''}</td>
      </tr>
    `).join('');
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
    app.innerHTML = `
      <div class="container">
        <div class="page-header text-center">
          <h1>Choose Your <span class="accent">Plan</span></h1>
          <p>Invest in your betting edge. Cancel anytime.</p>
        </div>

        <div class="pricing-grid mb-32">
          <div class="pricing-card">
            <h3>Free</h3>
            <p class="text-muted">One free selection every day</p>
            <div class="pricing-price">&pound;<span style="font-size:42px;">0</span><span class="period">/month</span></div>
            <ul class="pricing-features">
              <li>1 free NAP of the day</li>
              <li>Basic match/race info</li>
              <li>Summary analysis</li>
              <li>Results tracker access</li>
              <li class="disabled">Full deep-dive analysis</li>
              <li class="disabled">Premium edge selections (2-4 daily max)</li>
              <li class="disabled">Early access to tips</li>
              <li class="disabled">Email bulletins</li>
              <li class="disabled">Staking recommendations</li>
              <li class="disabled">Priority support</li>
            </ul>
            <button class="btn btn-outline btn-full" onclick="${this.user ? '' : "App.showModal('register')"}">
              ${this.user ? 'Current Plan' : 'Sign Up Free'}
            </button>
          </div>

          <div class="pricing-card featured">
            <div style="background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;text-align:center;padding:8px;border-radius:8px 8px 0 0;margin:-24px -24px 16px;font-weight:800;font-size:14px;letter-spacing:0.5px;">🎉 FIRST MONTH FREE — LIMITED OFFER</div>
            <h3>Premium</h3>
            <p class="text-muted">Every edge play, every day — quality not quantity</p>
            <div class="pricing-price"><span style="text-decoration:line-through;color:var(--text-muted);font-size:18px;">&pound;14.99</span> <span class="currency">&pound;</span>0<span style="font-size:20px;">.00</span><span class="period">/1st month</span></div>
            <p class="text-xs text-gold mb-8">Then &pound;14.99/month | or &pound;119.99/year (save &pound;60)</p>
            <ul class="pricing-features">
              <li><strong>First month completely FREE</strong></li>
              <li>2-4 premium selections daily (quality over quantity)</li>
              <li>Full deep-dive analysis</li>
              <li>Probability & edge calculations</li>
              <li>Staking recommendations</li>
              <li>Early morning access (before 9am)</li>
              <li>Daily email bulletins</li>
              <li>In-play alerts (coming soon)</li>
              <li>Priority email support</li>
              <li>Exclusive Telegram group</li>
            </ul>
            <!-- STRIPE INTEGRATION POINT: Replace onclick with Stripe Checkout redirect -->
            <!-- stripe.redirectToCheckout({ sessionId: await createCheckoutSession(plan, price, trialDays: 30) }) -->
            <button class="btn btn-gold btn-full" data-plan="monthly" data-price="0" data-trial="30" data-currency="gbp" onclick="trackEvent('upgrade','click_monthly_trial','pricing');App.showModal('stripe')">
              ${this.user?.subscription === 'premium' ? 'Current Plan' : 'Start Free Month'}
            </button>
            <button class="btn btn-outline btn-full mt-8" data-plan="annual" data-price="11999" data-currency="gbp" onclick="App.showModal('stripe')">
              Annual Plan - &pound;119.99/yr (Save &pound;60)
            </button>
            <div class="stripe-badge mt-8">
              <span>Secure payment powered by</span>
              <span class="stripe-logo">Stripe</span>
            </div>
            <p class="text-xs text-muted mt-8">Free for 30 days, then auto-renews at &pound;14.99/month. Cancel anytime before your trial ends to avoid charges. No commitment.</p>
          </div>
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

        <!-- Lead capture -->
        <div class="card card-premium text-center" style="padding:40px;max-width:600px;margin:0 auto;">
          <h3 class="mb-8">Not Ready to Commit?</h3>
          <p class="text-muted mb-16">Enter your email below and we'll send you a free sample of our Premium analysis so you can see the quality for yourself.</p>
          <div style="display:flex;gap:8px;max-width:400px;margin:0 auto;">
            <input type="email" placeholder="your@email.com" style="flex:1;padding:10px 14px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);outline:none;">
            <button class="btn btn-gold" onclick="alert('Thanks! Check your inbox for a sample Premium tip.')">Send Sample</button>
          </div>
        </div>
      </div>
    `;
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
    app.innerHTML = '<div class="container"><div class="text-center pulse" style="padding:60px;">Loading admin panel...</div></div>';

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
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Subscription</th><th>Joined</th></tr></thead>
              <tbody>
                ${users.map(u => `
                  <tr>
                    <td>${u.name}</td>
                    <td>${u.email}</td>
                    <td>${u.role}</td>
                    <td>${u.subscription === 'premium' ? '<span class="text-gold">Premium</span>' : 'Free'}</td>
                    <td>${formatDateUK(u.joined)}</td>
                  </tr>
                `).join('')}
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
    } catch (err) { alert(err.message); }
  },

  async deleteTip(id) {
    if (!confirm('Delete this tip?')) return;
    try {
      await this.api(`/admin/tips/${id}`, { method: 'DELETE' });
      this.renderAdmin();
    } catch (err) { alert(err.message); }
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
      alert('Result recorded successfully.');
      this.renderAdmin();
    } catch (err) { alert(err.message); }
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
    } catch (err) { alert(err.message); }
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
    } catch (err) { alert(err.message); }
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

  async adminAutoSettle() {
    try {
      var result = await this.api('/admin/auto-results', { method: 'POST' });
      alert(result.message || 'Auto-settle complete. ' + (result.updated || 0) + ' tips updated.');
      this.renderAdmin();
    } catch (e) { alert('Error: ' + e.message); }
  },

  // -----------------------------------------------------------------------
  // CHATBOT
  // -----------------------------------------------------------------------
  toggleChat() {
    const w = document.getElementById('chat-window');
    w.style.display = w.style.display === 'none' ? 'flex' : 'none';
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
      const { response, suggestions } = await this.api('/chat', {
        method: 'POST',
        body: JSON.stringify({ message })
      });
      messages.innerHTML += `<div class="chat-msg bot">${response}</div>`;
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
        { icon: '\u26a0\ufe0f', title: 'Risk Assessment', body: '<p>Risk Level: <strong>' + (tip.riskLevel || 'Medium') + '</strong></p>' + (a.classMovement ? '<p>' + a.classMovement + '</p>' : '') + (a.weight ? '<p>' + a.weight + '</p>' : '') },
        { icon: '\ud83d\udca1', title: 'Why This Is Value', fields: ['valueReasoning', 'marketSupport'] },
        { icon: '\ud83c\udfaf', title: 'Staking Recommendation', body: '<p>Recommended stake: <strong>' + (tip.staking || '1 unit') + '</strong>. ' + (a.trainerJockeyStats ? 'Trainer/Jockey: ' + a.trainerJockeyStats : '') + '</p>' },
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
  renderWeeklyAcca(tips) {
    const acca = tips.find(t => t.isWeeklyAcca);
    if (!acca || !acca.accaSelections) return '';
    return `
      <div class="acca-free-card-wrapper">
        <div class="acca-free-header">
          <span class="acca-free-badge">FREE</span>
          Weekly 5-Fold Accumulator &mdash; Weekend ${formatDateUK(acca.date)}
        </div>
        <div class="acca-free-card">
          ${acca.accaSelections.map((s, i) => `
            <div class="acca-selection-row">
              <div>
                <div class="acca-selection-match">${i + 1}. ${s.match}</div>
                <div class="acca-selection-pick">${s.selection} &bull; ${s.league}</div>
                <div class="acca-selection-reasoning">${s.reasoning}</div>
              </div>
              <div class="acca-selection-odds">${this.formatOdds(s.odds)}</div>
            </div>
          `).join('')}
          <div class="acca-total-row">
            <div class="acca-total-label">Combined Odds</div>
            <div class="acca-total-value">${this.formatOdds(acca.odds || acca.accaCombinedOdds || 0)}</div>
          </div>
          <div class="acca-return-info">
            <div class="return-label">&pound;10 Stake Returns</div>
            <div class="return-amount">&pound;${((acca.odds || acca.accaCombinedOdds || 0) * 10).toFixed(2)}</div>
          </div>
          <p style="font-size:11px;color:var(--text-muted);text-align:center;margin-top:12px;">
            This accumulator is provided for entertainment purposes only. Please gamble responsibly. 18+.
          </p>
        </div>
      </div>
    `;
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
            <li><strong>Premium Tier:</strong> Full access to all tips, detailed analysis, email bulletins, and priority support. Pricing: &pound;14.99/month or &pound;119.99/year.</li>
            <li><strong>Free Trial:</strong> New Premium subscribers receive their first month (30 days) completely free of charge. No payment is taken during the trial period. You may cancel at any time during the free trial without incurring any charge.</li>
            <li><strong>Auto-Renewal:</strong> <strong>Your subscription will automatically renew at the end of each billing period (including at the end of your free trial) unless you cancel before the renewal date.</strong> By subscribing, you expressly consent to auto-renewal and authorise us to charge your chosen payment method at the then-current subscription rate (&pound;14.99/month or &pound;119.99/year) on each renewal date.</li>
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

          <h2>10. Governing Law</h2>
          <p>These Terms and Conditions are governed by and construed in accordance with the laws of England and Wales. Any disputes arising from these Terms shall be subject to the exclusive jurisdiction of the courts of England and Wales.</p>

          <h2>11. Contact</h2>
          <p>For questions about these Terms, contact us at: <a href="mailto:support@eliteedgesports.co.uk">support@eliteedgesports.co.uk</a></p>

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

          <h2>3. How We Use Your Data</h2>
          <ul>
            <li><strong>Service delivery:</strong> To provide you with access to tips, analysis, and platform features</li>
            <li><strong>Communication:</strong> To send email bulletins, service updates, and respond to support queries</li>
            <li><strong>Improvement:</strong> To analyse usage patterns and improve our platform and content</li>
            <li><strong>Legal compliance:</strong> To comply with applicable laws, regulations, and legal processes</li>
          </ul>

          <h2>4. Third Parties</h2>
          <p>We may share your data with the following categories of third parties:</p>
          <ul>
            <li><strong>Payment processor:</strong> To process subscription payments securely (e.g., Stripe)</li>
            <li><strong>Email provider:</strong> To deliver email bulletins and notifications (e.g., SendGrid, Mailchimp)</li>
            <li><strong>Analytics:</strong> To understand platform usage (e.g., Google Analytics, with IP anonymisation enabled)</li>
            <li><strong>Hosting:</strong> Our servers and infrastructure providers</li>
          </ul>
          <p>We do not sell your personal data to third parties.</p>

          <h2>5. Data Retention</h2>
          <ul>
            <li>Account data is retained for the duration of your account plus 12 months after deletion.</li>
            <li>Support ticket data is retained for 24 months.</li>
            <li>Usage and analytics data is retained for 26 months.</li>
            <li>Payment records are retained for 7 years as required by UK tax law.</li>
          </ul>

          <h2>6. Your Rights</h2>
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

          <h2>7. Cookies</h2>
          <p>We use the following types of cookies:</p>
          <ul>
            <li><strong>Essential cookies:</strong> Required for the platform to function (authentication, preferences)</li>
            <li><strong>Analytics cookies:</strong> To understand how visitors use our site (can be opted out)</li>
            <li><strong>Functional cookies:</strong> To remember your preferences (theme, display settings)</li>
          </ul>
          <p>You can manage cookie preferences through your browser settings. Disabling essential cookies may affect platform functionality.</p>

          <h2>8. Data Security</h2>
          <p>We implement appropriate technical and organisational measures to protect your data, including encryption of passwords, secure HTTPS connections, and regular security reviews. However, no method of electronic transmission or storage is 100% secure.</p>

          <h2>9. Changes to This Policy</h2>
          <p>We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated date. We will notify registered users of significant changes by email.</p>

          <h2>10. Contact &amp; Complaints</h2>
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
  // NOTIFICATION SYSTEM (Feature #3)
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
    // Seed some notifications for demo
    if (!this.notifications.length) {
      this.notifications = [
        { id: 'n1', text: 'New tip: Arsenal vs Southampton - Arsenal Win', time: new Date(Date.now() - 3600000).toISOString(), read: false },
        { id: 'n2', text: 'Result: Gaelic Warrior WON +7.50u', time: new Date(Date.now() - 7200000).toISOString(), read: false },
        { id: 'n3', text: 'Weekly acca is live - 5 selections at 4.97', time: new Date(Date.now() - 14400000).toISOString(), read: true },
      ];
      localStorage.setItem('ee_notifications', JSON.stringify(this.notifications));
      this.updateNotifBadge();
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
    dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
    this.renderNotifList();
    // Mark all as read
    this.notifications.forEach(n => n.read = true);
    localStorage.setItem('ee_notifications', JSON.stringify(this.notifications));
    this.updateNotifBadge();
  },

  renderNotifList() {
    const list = document.getElementById('notif-list');
    if (!list) return;
    if (!this.notifications.length) {
      list.innerHTML = '<p class="text-muted text-sm" style="padding:12px;">No notifications yet</p>';
      return;
    }
    list.innerHTML = this.notifications.slice(0, 10).map(n => `
      <div class="notif-item ${n.read ? '' : 'unread'}">
        <div>${n.text}</div>
        <div class="notif-time">${this.timeAgo(n.time)}</div>
      </div>
    `).join('');
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
    this.notifications = [];
    localStorage.setItem('ee_notifications', '[]');
    this.updateNotifBadge();
    this.renderNotifList();
  },

  sendTestAlert() {
    this.addNotification('Test Alert: New premium tip just published!');
    alert('Test notification sent!');
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
  async renderAnalysts() {
    const app = document.getElementById('app');
    app.innerHTML = '<div class="container"><div class="text-center pulse" style="padding:60px;">Loading analysts...</div></div>';

    let results = [];
    try { results = await this.api('/results'); } catch {}

    const analysts = [
      {
        name: 'The Professor',
        key: 'professor',
        initials: 'TP',
        specialty: 'Model-Driven Analysis',
        desc: 'The Professor relies on pure data and statistical modelling to identify high-probability selections. Specialising in short-priced favourites with strong form profiles, this analyst targets consistent strike rates over flashy prices. Every pick is backed by rigorous quantitative analysis.',
      },
      {
        name: 'The Scout',
        key: 'scout',
        initials: 'TS',
        specialty: 'Value Hunter',
        desc: 'The Scout searches for overlooked runners and undervalued prices that the market has missed. Specialising in bigger-priced selections with strong each-way value, this analyst accepts a lower strike rate in exchange for significantly higher ROI when selections land.',
      },
      {
        name: 'The Edge',
        key: 'edge',
        initials: 'TE',
        specialty: 'Balanced Analysis',
        desc: 'The Edge combines statistical modelling with contextual analysis to find the sweet spot between probability and value. Covering both racing and football markets, this analyst blends data with situational awareness for well-rounded selections.',
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
    const existing = this.getComments(tipId);
    if (existing.length) return existing;
    const seeds = [
      { user: 'JamesR_2026', text: 'Great analysis here, really detailed breakdown of the form. Backing this one.', time: new Date(Date.now() - 7200000).toISOString(), likes: 5 },
      { user: 'PunterPete', text: 'Been following these tips for 2 months now. The edge calculations are spot on more often than not.', time: new Date(Date.now() - 5400000).toISOString(), likes: 3 },
      { user: 'FormStudentUK', text: 'The pace analysis is what sets this apart from other services. Really useful insight.', time: new Date(Date.now() - 3600000).toISOString(), likes: 7 },
      { user: 'RacingDave', text: 'Odds have shortened since this was posted which confirms the value was there. Good spot.', time: new Date(Date.now() - 1800000).toISOString(), likes: 2 },
      { user: 'AccaBuilder', text: 'Adding this to my acca. The confidence level gives me reassurance.', time: new Date(Date.now() - 900000).toISOString(), likes: 1 },
    ];
    this.saveComments(tipId, seeds);
    return seeds;
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
    if (localStorage.getItem('cookieConsent') !== 'true') {
      const banner = document.getElementById('cookie-banner');
      if (banner) banner.style.display = 'flex';
    }
  },

  acceptCookies() {
    localStorage.setItem('cookieConsent', 'true');
    const banner = document.getElementById('cookie-banner');
    if (banner) banner.style.display = 'none';
    trackEvent('consent', 'cookies_accepted', '');
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
      if (result.demo) {
        successEl.style.display = 'block';
        successEl.innerHTML = result.message + '<br><strong style="color:var(--gold);">' + result.demoMessage + '</strong>';
      } else {
        successEl.style.display = 'block';
        successEl.textContent = result.message;
      }
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
    banner.innerHTML = 'Please check your email to verify your account. <span class="unverified-badge">Unverified</span>';
    app.parentNode.insertBefore(banner, app);

    // Demo mode: auto-verify after 2 seconds
    setTimeout(() => {
      const b = document.getElementById('email-verify-banner');
      if (b) {
        b.innerHTML = 'Email verified successfully! Your account is now active. <span class="verified-badge">Verified</span>';
        b.style.background = 'rgba(34,197,94,.15)';
        b.style.borderColor = 'rgba(34,197,94,.4)';
        if (this.user) {
          this.user.emailVerified = true;
          localStorage.setItem('ee_user', JSON.stringify(this.user));
        }
        // Remove after 3 more seconds
        setTimeout(() => { if (b) b.remove(); }, 3000);
      }
    }, 2000);
  },

  // -----------------------------------------------------------------------
  // 404 PAGE (Feature #5)
  // -----------------------------------------------------------------------
  render404() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="container">
        <div class="page-404">
          <svg class="logo-404" width="80" height="80" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="logo-404" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#d4a843"/><stop offset="100%" stop-color="#b8902f"/></linearGradient></defs>
            <path d="M32 4L4 32l28 28 28-28L32 4z" fill="none" stroke="url(#logo-404)" stroke-width="3"/>
            <text x="16" y="40" font-family="Inter,sans-serif" font-weight="900" font-size="24" fill="#d4a843">EE</text>
          </svg>
          <h1>404</h1>
          <h2>Page Not Found</h2>
          <p>The page you are looking for does not exist or has been moved. Let us get you back on track.</p>
          <a href="#/" class="btn btn-gold btn-lg">Back to Dashboard</a>
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
    if (!bets.length) { alert('No bets to export.'); return; }
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
    if (!tipIds.length) { alert('No tips selected.'); return; }
    const messages = tipIds.map(id => {
      const tip = this.tips.find(t => t.id === id);
      return tip ? this.formatTipForTelegram(tip) : null;
    }).filter(Boolean);
    alert('Telegram messages formatted (demo mode):\n\n' + messages.join('\n---\n'));
    trackEvent('telegram', 'send_bulletin', tipIds.length + ' tips');
  },

  sendToTelegram(tipId) {
    const tip = this.tips.find(t => t.id === tipId);
    if (!tip) { alert('Tip not found.'); return; }
    const message = this.formatTipForTelegram(tip);
    // Placeholder: In production, call Telegram Bot API
    // fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ chat_id: '@EliteEdgeTips', text: message })
    // });
    alert('Telegram message formatted (demo mode):\n\n' + message);
    trackEvent('telegram', 'send_tip', tipId);
  },

  // -----------------------------------------------------------------------
  // BLOG / CONTENT SECTION (Feature #9)
  // -----------------------------------------------------------------------
  blogPosts: [
    {
      slug: 'understanding-value-betting',
      title: 'Understanding Value Betting: Why Edge Matters',
      date: '2026-03-25',
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
      date: '2026-03-20',
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
      slug: 'cheltenham-2026-record',
      title: 'Cheltenham Festival 2026: Our Record-Breaking Week',
      date: '2026-03-15',
      author: 'The Scout',
      excerpt: 'A look back at our outstanding Cheltenham Festival 2026 performance, where our model delivered exceptional results across all four days of racing.',
      content: `<p>Cheltenham Festival 2026 was a landmark week for Elite Edge Sports Tips. Our model delivered outstanding results across all four days of the greatest National Hunt racing festival, and we want to share a transparent breakdown of every selection.</p>

<h2>The Numbers</h2>
<p>Across the four days, we published 18 selections (12 Premium, 6 Free). Our overall Cheltenham record:</p>
<p><strong>Strike Rate:</strong> 44.4% (8 winners from 18 selections)<br>
<strong>ROI:</strong> +38.2%<br>
<strong>P/L:</strong> +14.73 units (from 38.5 units staked)</p>

<h2>Day One Highlights</h2>
<p>The festival started with a bang when our NAP of the Day -- a 5/1 shot in the Supreme Novices Hurdle -- stormed home by three lengths. Our model had identified this horse as having superior form figures on soft ground, a factor the market had underweighted due to a disappointing last run on good ground.</p>

<h2>The Power of Going Analysis</h2>
<p>Cheltenham 2026 saw genuinely soft ground throughout the week, which significantly favoured our model. Going suitability is one of our most heavily weighted factors for jump racing, and when the ground is testing, it becomes even more predictive. Three of our eight winners were horses whose form dramatically improved on soft ground -- a pattern the general market often overlooks.</p>

<h2>What We Got Wrong</h2>
<p>Transparency matters to us, so let us also address the losers. Our biggest miss was a well-fancied 3/1 shot in the Champion Hurdle who faded in the closing stages. Our model had correctly identified the horse's quality but did not sufficiently account for the step up in trip under testing conditions. This is exactly the kind of post-festival analysis we conduct to refine our model for next season.</p>

<h2>Key Takeaways</h2>
<p>Festival racing is high variance -- short-priced favourites get beaten regularly, and the form book can be turned upside down. Our edge comes from disciplined model-based selection rather than gut feeling. We identify the factors that matter most at each specific meeting and weight them accordingly.</p>
<p>If you missed our Cheltenham coverage, our full archive of every selection with analysis is available on the Results page. And if you want to be ready for Aintree, Punchestown, and Royal Ascot, now is the time to join Premium.</p>`
    }
  ],

  renderBlogListing() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="container">
        <div class="page-header">
          <h1><span class="accent">Blog</span> & Insights</h1>
          <p>Expert analysis, strategy guides, and behind-the-scenes looks at our data-driven approach.</p>
        </div>
        <div class="blog-grid">
          ${this.blogPosts.map(post => `
            <div class="blog-card" onclick="window.location.hash='#/blog/${post.slug}'">
              <div class="blog-date">${formatDateUK(post.date)}</div>
              <h3>${post.title}</h3>
              <div class="blog-excerpt">${post.excerpt}</div>
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
    const post = this.blogPosts.find(p => p.slug === slug);
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
    { title: 'Welcome to Elite Edge', desc: 'Your new home for data-driven betting intelligence. We use statistical models to identify value in horse racing and football markets, giving you a genuine edge over the bookmakers.' },
    { title: 'Browse Tips', desc: 'Our dashboard shows today\'s top selections with confidence scores, edge percentages, and detailed analysis. Free members get 1 daily tip. Premium members get 2-4 carefully selected edge plays — we never publish tips just to fill a quota.' },
    { title: 'Track Performance', desc: 'Visit the Results page to see our full, transparent track record. Every tip is recorded with P/L, strike rate, and ROI. Use the "I backed this" button to track your own personal performance.' },
    { title: 'Go Premium', desc: 'Unlock all tips, full analysis, staking recommendations, and priority alerts. First month is completely FREE. Then just \u00a314.99/month, cancel anytime. Your edge starts here.' },
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
      { text: "Been following the racing tips for 3 months. Consistently profitable and the analysis is genuinely insightful. Worth every penny of the subscription.", author: "James R.", role: "Premium member since Jan 2026", stars: 5 },
      { text: "The football BTTS and Over/Under picks are outstanding. Love seeing the xG data and probability breakdowns. Makes me feel confident in every bet.", author: "Mark T.", role: "Premium member since Nov 2025", stars: 5 },
      { text: "Tried many tipping services before. This is the first one that actually shows their working and has a transparent, verified track record. Highly recommended.", author: "Sarah W.", role: "Premium member since Feb 2026", stars: 5 },
    ];
  },

  getFAQs() {
    return [
      { q: "How are your tips generated?", a: "Our tips are generated using a proprietary multi-factor scoring model that analyses form, statistics, market movements, and contextual data. For horse racing, we evaluate speed ratings, going suitability, trainer/jockey stats, draw bias, and class movement. For football, we use expected goals (xG), home/away splits, injury reports, and head-to-head records. Every tip must exceed a minimum edge threshold before publication." },
      { q: "What does 'edge' mean?", a: "Edge is the difference between our model's calculated probability and the bookmaker's implied probability (derived from the odds). For example, if we calculate a 50% chance of winning but the odds imply only 33%, we have a 17% edge. Positive edge means we believe the odds are in the bettor's favour." },
      { q: "How is ROI calculated?", a: "ROI (Return on Investment) = (Total Profit / Total Staked) x 100. For example, if we've staked 100 units total and our net profit is 15 units, our ROI is +15%. We track this across all published tips with full transparency." },
      { q: "What's included in Premium?", a: "Premium members get 2-4 carefully selected premium tips daily — we only publish when the edge is genuine. Full deep-dive analysis with probability calculations, staking recommendations, early morning access before 9am, daily email bulletins, and priority Telegram alerts. Quality over quantity — we never publish filler tips." },
      { q: "Can I cancel my subscription?", a: "Yes, you can cancel anytime with no questions asked. We also offer a 7-day money-back guarantee on all new subscriptions. Simply contact support@eliteedgesports.co.uk to cancel." },
      { q: "How do I know your results are real?", a: "All tips are published before the event starts with timestamped records. Our full results history is publicly available on the Results page, including every loss. We believe in complete transparency — that's why we show ROI, strike rate, and every individual result." },
      { q: "Do you cover all horse racing meetings?", a: "We currently focus on the major UK and Irish meetings where our model has the strongest historical performance. This includes Cheltenham, Ascot, Newmarket, York, and Kempton, plus selected midweek cards. We're expanding coverage to smaller meetings soon." },
      { q: "What football leagues do you cover?", a: "We cover the Premier League, Champions League, La Liga, Serie A, Bundesliga, and Ligue 1. Our model performs best on leagues with rich statistical data. We plan to add Eredivisie, Liga Portugal, and select South American leagues." },
    ];
  },
};

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
