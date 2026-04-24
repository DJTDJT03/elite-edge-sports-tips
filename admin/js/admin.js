/**
 * Elite Edge Sports Tips — Admin Application
 * Central module: auth, API client, router, toast, modal, utilities
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  var TOKEN_KEY = 'ee_admin_token';
  var USER_KEY = 'ee_admin_user';
  var EXPIRY_KEY = 'ee_admin_token_expiry';
  var STATUS_POLL_INTERVAL = 60000;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  var statusTimer = null;
  var toastCounter = 0;

  // =========================================================================
  // AdminAPI — authenticated fetch wrapper
  // =========================================================================
  var AdminAPI = {
    _baseURL: '/api',

    _isExpired: function () {
      var expiry = localStorage.getItem(EXPIRY_KEY);
      if (!expiry) return true;
      return Date.now() > Number(expiry);
    },

    _headers: function () {
      var token = localStorage.getItem(TOKEN_KEY);
      return {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (token || '')
      };
    },

    _request: function (method, path, body) {
      if (this._isExpired()) {
        AdminApp.logout();
        return Promise.reject(new Error('Session expired'));
      }

      var opts = {
        method: method,
        headers: this._headers()
      };
      if (body !== undefined) {
        opts.body = JSON.stringify(body);
      }

      return fetch(this._baseURL + path, opts)
        .then(function (res) {
          if (res.status === 401) {
            AdminApp.logout();
            return Promise.reject(new Error('Unauthorised'));
          }
          if (!res.ok) {
            return res.json().then(function (data) {
              return Promise.reject(new Error(data.error || 'Request failed'));
            });
          }
          return res.json();
        });
    },

    get: function (path) { return this._request('GET', path); },
    post: function (path, body) { return this._request('POST', path, body); },
    put: function (path, body) { return this._request('PUT', path, body); },
    del: function (path) { return this._request('DELETE', path); }
  };

  window.AdminAPI = AdminAPI;

  // =========================================================================
  // Route map
  // =========================================================================
  var routes = {
    '#/dashboard': function () { if (window.DashboardPage) DashboardPage.render(); },
    '#/tips':      function () { if (window.TipsPage) TipsPage.render(); },
    '#/results':   function () { if (window.ResultsPage) ResultsPage.render(); },
    '#/users':     function () { if (window.UsersPage) UsersPage.render(); },
    '#/email':     function () { if (window.EmailPage) EmailPage.render(); },
    '#/support':   function () { if (window.SupportPage) SupportPage.render(); },
    '#/livedata':  function () { if (window.LiveDataPage) LiveDataPage.render(); },
    '#/audit':     function () { if (window.AuditPage) AuditPage.render(); },
    '#/analytics': function () { if (window.AnalyticsPage) AnalyticsPage.render(); }
  };

  // =========================================================================
  // AdminApp — main application object
  // =========================================================================
  var AdminApp = {
    user: null,

    // -----------------------------------------------------------------------
    // Initialisation
    // -----------------------------------------------------------------------
    init: function () {
      var token = localStorage.getItem(TOKEN_KEY);
      var expiry = localStorage.getItem(EXPIRY_KEY);
      var userJSON = localStorage.getItem(USER_KEY);

      if (!token || !expiry || Date.now() > Number(expiry)) {
        this._showLogin();
        return;
      }

      try {
        this.user = JSON.parse(userJSON);
      } catch (e) {
        this._showLogin();
        return;
      }

      if (!this.user || this.user.role !== 'admin') {
        this._showLogin();
        return;
      }

      this._showApp();
      this._initRouter();
      this._startStatusPolling();
    },

    // -----------------------------------------------------------------------
    // Authentication
    // -----------------------------------------------------------------------
    login: function (email, password) {
      var self = this;
      return fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password })
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (result) {
          if (!result.ok) {
            throw new Error(result.data.error || 'Login failed');
          }

          var data = result.data;

          // Reject non-admin users
          if (!data.user || data.user.role !== 'admin') {
            throw new Error('Access denied. Admin privileges required.');
          }

          // Store credentials
          localStorage.setItem(TOKEN_KEY, data.token);
          localStorage.setItem(EXPIRY_KEY, String(data.tokenExpiry));
          localStorage.setItem(USER_KEY, JSON.stringify(data.user));

          self.user = data.user;
          self._showApp();
          self._initRouter();
          self._startStatusPolling();
          self.toast('Welcome back, ' + data.user.name, 'success');
        });
    },

    logout: function () {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(EXPIRY_KEY);
      this.user = null;
      if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
      this._showLogin();
    },

    // -----------------------------------------------------------------------
    // UI switching
    // -----------------------------------------------------------------------
    _showLogin: function () {
      var loginScreen = document.getElementById('login-screen');
      var adminApp = document.getElementById('admin-app');
      if (loginScreen) loginScreen.style.display = '';
      if (adminApp) adminApp.style.display = 'none';
    },

    _showApp: function () {
      var loginScreen = document.getElementById('login-screen');
      var adminApp = document.getElementById('admin-app');
      if (loginScreen) loginScreen.style.display = 'none';
      if (adminApp) adminApp.style.display = '';

      // Populate user badge if present
      var badge = document.getElementById('admin-user-name');
      if (badge && this.user) badge.textContent = this.user.name || this.user.email;
    },

    // -----------------------------------------------------------------------
    // Router
    // -----------------------------------------------------------------------
    _initRouter: function () {
      var self = this;
      window.addEventListener('hashchange', function () { self._onRoute(); });
      // Navigate to current hash or default
      if (!window.location.hash || window.location.hash === '#' || window.location.hash === '#/') {
        window.location.hash = '#/dashboard';
      } else {
        this._onRoute();
      }
    },

    _onRoute: function () {
      var hash = window.location.hash || '#/dashboard';
      var handler = routes[hash];

      // Update sidebar active state
      var links = document.querySelectorAll('.admin-sidebar a[data-route], .admin-sidebar a[data-section]');
      for (var i = 0; i < links.length; i++) {
        var link = links[i];
        var routeMatch = link.getAttribute('data-route') === hash;
        var sectionMatch = link.getAttribute('data-section') && ('#' + link.getAttribute('data-section') === hash || '#/' + link.getAttribute('data-section') === hash);
        if (routeMatch || sectionMatch) {
          link.classList.add('active');
        } else {
          link.classList.remove('active');
        }
      }

      // Show/hide sections — only manage analytics section, leave others to original system
      var analyticsSection = document.getElementById('sec-analytics');
      if (hash === '#/analytics') {
        // Hide all other sections, show analytics
        var sections = document.querySelectorAll('.section');
        for (var s = 0; s < sections.length; s++) {
          sections[s].classList.remove('active');
          sections[s].style.display = 'none';
        }
        if (analyticsSection) analyticsSection.style.display = 'block';
      } else {
        // Hide analytics, let original system handle other sections
        if (analyticsSection) analyticsSection.style.display = 'none';
      }

      if (handler) {
        handler();
      } else {
        // Default to dashboard for unknown routes
        window.location.hash = '#/dashboard';
      }
    },

    // -----------------------------------------------------------------------
    // Toast system
    // -----------------------------------------------------------------------
    toast: function (message, type) {
      type = type || 'info';
      var container = document.getElementById('admin-toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'admin-toast-container';
        container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:10000;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
        document.body.appendChild(container);
      }

      var id = 'toast-' + (++toastCounter);
      var toast = document.createElement('div');
      toast.id = id;
      toast.className = 'admin-toast admin-toast-' + type;
      toast.style.cssText = 'pointer-events:auto;padding:12px 20px;border-radius:8px;font-size:14px;font-weight:500;color:#fff;box-shadow:0 4px 12px rgba(0,0,0,0.3);opacity:0;transform:translateX(40px);transition:all 0.3s ease;max-width:400px;';

      if (type === 'success') toast.style.background = '#16a34a';
      else if (type === 'error') toast.style.background = '#dc2626';
      else toast.style.background = '#2563eb';

      toast.textContent = message;
      container.appendChild(toast);

      // Animate in
      requestAnimationFrame(function () {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
      });

      // Auto-dismiss after 3 seconds
      setTimeout(function () {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(40px)';
        setTimeout(function () {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
      }, 3000);
    },

    // -----------------------------------------------------------------------
    // Modal system
    // -----------------------------------------------------------------------
    modal: function (title, bodyHTML, buttons) {
      this.closeModal();

      var overlay = document.createElement('div');
      overlay.id = 'admin-modal-overlay';
      overlay.className = 'admin-modal-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9000;display:flex;align-items:center;justify-content:center;';

      var modal = document.createElement('div');
      modal.className = 'admin-modal';
      modal.style.cssText = 'background:var(--bg-card,#1a1e2e);border-radius:12px;padding:24px;max-width:560px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.4);';

      var header = document.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
      var h3 = document.createElement('h3');
      h3.style.cssText = 'margin:0;font-size:18px;font-weight:700;color:var(--text-primary,#fff);';
      h3.textContent = title;
      var closeBtn = document.createElement('button');
      closeBtn.textContent = '\u00d7';
      closeBtn.style.cssText = 'background:none;border:none;color:var(--text-secondary,#999);font-size:24px;cursor:pointer;padding:0 4px;';
      closeBtn.onclick = function () { AdminApp.closeModal(); };
      header.appendChild(h3);
      header.appendChild(closeBtn);

      var body = document.createElement('div');
      body.innerHTML = bodyHTML;

      modal.appendChild(header);
      modal.appendChild(body);

      if (buttons && buttons.length) {
        var footer = document.createElement('div');
        footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:20px;';
        buttons.forEach(function (btn) {
          var el = document.createElement('button');
          el.className = btn.class || 'btn btn-outline';
          el.textContent = btn.label;
          el.onclick = btn.onClick;
          footer.appendChild(el);
        });
        modal.appendChild(footer);
      }

      overlay.appendChild(modal);
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) AdminApp.closeModal();
      });

      document.body.appendChild(overlay);
    },

    closeModal: function () {
      var existing = document.getElementById('admin-modal-overlay');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    },

    confirm: function (message, onConfirm) {
      this.modal('Confirm', '<p style="color:var(--text-secondary,#ccc);font-size:14px;line-height:1.6;">' + message + '</p>', [
        { label: 'Cancel', class: 'btn btn-outline', onClick: function () { AdminApp.closeModal(); } },
        {
          label: 'Confirm', class: 'btn btn-gold',
          onClick: function () {
            AdminApp.closeModal();
            if (onConfirm) onConfirm();
          }
        }
      ]);
    },

    // -----------------------------------------------------------------------
    // Utility functions
    // -----------------------------------------------------------------------
    formatDate: function (iso) {
      if (!iso) return '-';
      var d = new Date(iso);
      var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
    },

    formatOdds: function (decimal) {
      if (!decimal || decimal <= 1) return '-';
      // Convert decimal odds to fractional
      // e.g. 2.50 => 3/2, 1.50 => 1/2
      var numerator = decimal - 1;
      // Find clean fraction
      var best = { n: Math.round(numerator * 100), d: 100 };
      var gcd = function (a, b) { return b === 0 ? a : gcd(b, a % b); };
      var g = gcd(best.n, best.d);
      return (best.n / g) + '/' + (best.d / g);
    },

    formatPnL: function (number) {
      if (number === null || number === undefined) return '<span>-</span>';
      var formatted = (number >= 0 ? '+' : '') + number.toFixed(2);
      var cls = number > 0 ? 'pnl-positive' : (number < 0 ? 'pnl-negative' : 'pnl-zero');
      return '<span class="' + cls + '">' + formatted + '</span>';
    },

    // -----------------------------------------------------------------------
    // Status polling
    // -----------------------------------------------------------------------
    _startStatusPolling: function () {
      var self = this;
      this._pollStatus();
      statusTimer = setInterval(function () { self._pollStatus(); }, STATUS_POLL_INTERVAL);
    },

    _pollStatus: function () {
      AdminAPI.get('/status')
        .then(function (data) {
          // Update sidebar badges / indicators if elements exist
          var racingBadge = document.getElementById('status-racing');
          var footballBadge = document.getElementById('status-football');
          var oddsBadge = document.getElementById('status-odds');

          if (racingBadge) {
            racingBadge.className = 'status-dot ' + (data.racing && data.racing.connected ? 'status-connected' : 'status-disconnected');
          }
          if (footballBadge) {
            footballBadge.className = 'status-dot ' + (data.football && data.football.connected ? 'status-connected' : 'status-disconnected');
          }
          if (oddsBadge) {
            oddsBadge.className = 'status-dot ' + (data.odds && data.odds.connected ? 'status-connected' : 'status-disconnected');
          }
        })
        .catch(function () {
          // Silently fail — status polling is non-critical
        });
    }
  };

  window.AdminApp = AdminApp;

  // =========================================================================
  // Bootstrap on DOMContentLoaded
  // =========================================================================
  document.addEventListener('DOMContentLoaded', function () {
    // Wire up login form if present
    var loginForm = document.getElementById('admin-login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var email = document.getElementById('admin-login-email').value;
        var password = document.getElementById('admin-login-password').value;
        var errorEl = document.getElementById('admin-login-error');

        if (errorEl) errorEl.textContent = '';

        AdminApp.login(email, password).catch(function (err) {
          if (errorEl) errorEl.textContent = err.message;
        });
      });
    }

    // Wire up logout button if present
    var logoutBtn = document.getElementById('admin-logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function (e) {
        e.preventDefault();
        AdminApp.logout();
      });
    }

    AdminApp.init();
  });

})();
