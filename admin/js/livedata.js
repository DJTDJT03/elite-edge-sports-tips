/* =========================================================================
   ELITE EDGE SPORTS TIPS — Admin Live Data Module
   Renders into #admin-content
   Depends on: AdminAPI, AdminApp.toast(), AdminApp.confirm()
   ========================================================================= */

window.LiveDataPage = {
  _pollTimer: null,
  _statusData: null,
  _marketData: null,

  // ---------------------------------------------------------------------------
  // RENDER — main entry point
  // ---------------------------------------------------------------------------
  async render() {
    // Clean up any previous polling interval
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }

    var container = document.getElementById('admin-content');
    if (!container) return;

    container.innerHTML = '<div class="admin-loading"><div class="spinner"></div> Loading live data...</div>';

    try {
      var results = await Promise.all([
        AdminAPI.get('/status'),
        AdminAPI.get('/odds/market-movers').catch(function () { return null; })
      ]);
      this._statusData = results[0];
      this._marketData = results[1];
    } catch (err) {
      container.innerHTML = '<div class="admin-error">Failed to load live data: ' + (err.message || err) + '</div>';
      return;
    }

    this._renderPage(container);
    this._startPolling();
  },

  // ---------------------------------------------------------------------------
  // PAGE LAYOUT
  // ---------------------------------------------------------------------------
  _renderPage(container) {
    var status = this._statusData || {};
    var market = this._marketData || {};

    container.innerHTML = ''
      + '<div class="admin-page-header">'
      +   '<h2>Live Data</h2>'
      +   '<p class="admin-page-sub">API connections, market intelligence, and live alerts</p>'
      + '</div>'

      // ---- API Connections ----
      + '<div class="admin-section">'
      +   '<h3 class="admin-section-title">API Connections</h3>'
      +   '<div class="api-status-grid" id="livedata-status">'
      +     this._buildStatusCards(status)
      +   '</div>'
      + '</div>'

      // ---- Quick Actions ----
      + '<div class="admin-section">'
      +   '<h3 class="admin-section-title">Quick Actions</h3>'
      +   '<div class="quick-actions">'
      +     '<button class="btn btn-gold" id="btn-auto-settle">Auto-Settle Results</button>'
      +     '<span style="color:var(--text-secondary,#999);font-size:13px;align-self:center;">Data refreshes automatically every 30 seconds while on this page.</span>'
      +   '</div>'
      + '</div>'

      // ---- Market Intelligence Summary ----
      + '<div class="admin-section">'
      +   '<h3 class="admin-section-title">Market Intelligence Summary</h3>'
      +   this._buildMarketSummary(market)
      + '</div>'

      // ---- Active Alerts ----
      + '<div class="admin-section">'
      +   '<h3 class="admin-section-title">Active Alerts</h3>'
      +   this._buildAlerts(market)
      + '</div>';

    this._bindEvents();
  },

  // ---------------------------------------------------------------------------
  // STATUS CARDS
  // ---------------------------------------------------------------------------
  _buildStatusCards(status) {
    var cards = [
      {
        label: 'Racing API',
        connected: status.racing && status.racing.connected
      },
      {
        label: 'Football API',
        connected: status.football && status.football.connected
      },
      {
        label: 'Odds API',
        connected: status.odds && status.odds.connected
      },
      {
        label: 'Movement Tracker',
        connected: true,
        extra: this._buildTrackerExtra(status)
      }
    ];

    var html = '';
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var dotClass = c.connected ? 'status-connected' : 'status-disconnected';
      var statusText = c.connected ? 'Connected' : 'Disconnected';

      html += '<div class="api-status-item">'
        + '<span class="status-dot ' + dotClass + '"></span>'
        + '<span class="api-status-label">' + c.label + '</span>'
        + '<span class="api-status-text ' + dotClass + '">' + statusText + '</span>';

      if (c.extra) {
        html += '<span style="color:var(--text-secondary,#999);font-size:12px;margin-left:8px;">' + c.extra + '</span>';
      }

      html += '</div>';
    }

    return html;
  },

  _buildTrackerExtra(status) {
    var tracker = status.movementTracker || status.tracker || {};
    var eventsTracked = tracker.eventsTracked || tracker.events || 0;
    var activeAlerts = tracker.activeAlerts || tracker.alerts || 0;
    return eventsTracked + ' events tracked, ' + activeAlerts + ' active alert(s)';
  },

  // ---------------------------------------------------------------------------
  // MARKET INTELLIGENCE SUMMARY
  // ---------------------------------------------------------------------------
  _buildMarketSummary(market) {
    if (!market || (!market.steamers && !market.drifters)) {
      return '<p class="admin-empty">No market intelligence data available.</p>';
    }

    var steamers = market.steamers || [];
    var drifters = market.drifters || [];
    var totalEvents = market.totalEvents || market.eventsTracked || 0;

    var html = '<div class="stat-cards">';

    // Steamers card
    html += '<div class="stat-card">'
      + '<div class="stat-card-body">'
      +   '<div class="stat-card-label">Steamers</div>'
      +   '<div class="stat-card-value">' + steamers.length + '</div>'
      +   '<div class="stat-card-sub">' + this._topThreeList(steamers) + '</div>'
      + '</div>'
      + '</div>';

    // Drifters card
    html += '<div class="stat-card">'
      + '<div class="stat-card-body">'
      +   '<div class="stat-card-label">Drifters</div>'
      +   '<div class="stat-card-value">' + drifters.length + '</div>'
      +   '<div class="stat-card-sub">' + this._topThreeList(drifters) + '</div>'
      + '</div>'
      + '</div>';

    // Total events card
    html += '<div class="stat-card">'
      + '<div class="stat-card-body">'
      +   '<div class="stat-card-label">Events Tracked</div>'
      +   '<div class="stat-card-value">' + totalEvents + '</div>'
      + '</div>'
      + '</div>';

    html += '</div>';
    return html;
  },

  _topThreeList(items) {
    if (!items || !items.length) return 'None';
    var top = items.slice(0, 3);
    var names = [];
    for (var i = 0; i < top.length; i++) {
      names.push(this._esc(top[i].runner || top[i].name || top[i].selection || 'Unknown'));
    }
    return names.join(', ');
  },

  // ---------------------------------------------------------------------------
  // ACTIVE ALERTS
  // ---------------------------------------------------------------------------
  _buildAlerts(market) {
    var alerts = (market && market.alerts) ? market.alerts : [];

    if (!alerts.length) {
      return '<p class="admin-empty">No active alerts at this time.</p>';
    }

    var html = '<div class="admin-table-wrap"><table class="admin-table">'
      + '<thead><tr>'
      +   '<th>Runner</th>'
      +   '<th>Event</th>'
      +   '<th>Direction</th>'
      +   '<th>% Change</th>'
      +   '<th>Signal</th>'
      + '</tr></thead><tbody>';

    for (var i = 0; i < alerts.length; i++) {
      var a = alerts[i];
      var direction = a.direction || a.movement || '-';
      var dirClass = direction === 'steamer' || direction === 'shortening'
        ? 'pnl-positive' : 'pnl-negative';
      var pctChange = a.percentChange || a.change || 0;
      var pctDisplay = typeof pctChange === 'number'
        ? (pctChange > 0 ? '+' : '') + pctChange.toFixed(1) + '%'
        : this._esc(String(pctChange));

      html += '<tr>'
        + '<td>' + this._esc(a.runner || a.name || '-') + '</td>'
        + '<td>' + this._esc(a.event || '-') + '</td>'
        + '<td><span class="' + dirClass + '">' + this._esc(direction) + '</span></td>'
        + '<td>' + pctDisplay + '</td>'
        + '<td>' + this._esc(a.signal || '-') + '</td>'
        + '</tr>';
    }

    html += '</tbody></table></div>';
    return html;
  },

  // ---------------------------------------------------------------------------
  // EVENT BINDINGS
  // ---------------------------------------------------------------------------
  _bindEvents() {
    var self = this;

    var autoSettleBtn = document.getElementById('btn-auto-settle');
    if (autoSettleBtn) {
      autoSettleBtn.addEventListener('click', function () {
        AdminApp.confirm('Run auto-settle to match active tips against live results?', function () {
          AdminApp.toast('Auto-settling...', 'info');
          AdminAPI.post('/admin/auto-results', {})
            .then(function (data) {
              var count = data.updated || data.settledCount || 0;
              AdminApp.toast((data.message || count + ' tip(s) auto-settled'), 'success');
            })
            .catch(function (err) {
              AdminApp.toast('Auto-settle failed: ' + (err.message || err), 'error');
            });
        });
      });
    }
  },

  // ---------------------------------------------------------------------------
  // POLLING — auto-refresh every 30 seconds
  // ---------------------------------------------------------------------------
  _startPolling() {
    var self = this;

    this._pollTimer = setInterval(function () {
      // If we navigated away, stop polling
      var container = document.getElementById('admin-content');
      if (!container || window.location.hash !== '#/livedata') {
        clearInterval(self._pollTimer);
        self._pollTimer = null;
        return;
      }

      Promise.all([
        AdminAPI.get('/status'),
        AdminAPI.get('/odds/market-movers').catch(function () { return null; })
      ])
        .then(function (results) {
          self._statusData = results[0];
          self._marketData = results[1];

          // Update status cards in-place
          var statusGrid = document.getElementById('livedata-status');
          if (statusGrid) {
            statusGrid.innerHTML = self._buildStatusCards(self._statusData || {});
          }
        })
        .catch(function () {
          // Silently fail — polling is non-critical
        });
    }, 30000);
  },

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------
  _esc(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
};
