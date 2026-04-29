/**
 * Elite Edge Sports Tips — Admin Dashboard Page
 * Renders stat cards, quick actions, recent activity, and API status
 */
(function () {
  'use strict';

  window.DashboardPage = {

    render: function () {
      var container = document.getElementById('admin-content');
      if (!container) return;

      container.innerHTML =
        '<div class="admin-page-header">' +
          '<h2>Dashboard</h2>' +
          '<p class="admin-page-sub">Overview of your platform at a glance</p>' +
        '</div>' +

        // Stat cards
        '<div class="stat-cards" id="dash-stat-cards">' +
          this._statCardSkeleton('Total Users', 'users') +
          this._statCardSkeleton('Premium Subscribers', 'premium') +
          this._statCardSkeleton('Active Tips Today', 'tips') +
          this._statCardSkeleton('Weekly P/L', 'pnl') +
        '</div>' +

        // Quick actions
        '<div class="admin-section">' +
          '<h3 class="admin-section-title">Quick Actions</h3>' +
          '<div class="quick-actions">' +
            '<button class="btn btn-gold" onclick="DashboardPage.goAddTip()">+ Add Tip</button>' +
            '<button class="btn btn-outline" onclick="DashboardPage.goSendBulletin()">Send Bulletin</button>' +
            '<button class="btn btn-outline" onclick="DashboardPage.autoSettle()">Auto-Settle</button>' +
            '<button class="btn btn-outline" onclick="DashboardPage.refreshData()">Refresh Data</button>' +
          '</div>' +
        '</div>' +

        // Recent activity
        '<div class="admin-section">' +
          '<h3 class="admin-section-title">Recent Activity</h3>' +
          '<div class="admin-table-wrap" id="dash-recent-activity">' +
            '<div class="admin-loading">Loading results...</div>' +
          '</div>' +
        '</div>' +

        // CLV snapshot
        '<div class="admin-section">' +
          '<h3 class="admin-section-title" style="color:#d4a843;">Edge & CLV Summary</h3>' +
          '<div id="dash-clv-summary">' +
            '<div class="admin-loading">Loading CLV data...</div>' +
          '</div>' +
        '</div>' +

        // API status
        '<div class="admin-section">' +
          '<h3 class="admin-section-title">API Status</h3>' +
          '<div class="api-status-grid" id="dash-api-status">' +
            '<div class="admin-loading">Checking connections...</div>' +
          '</div>' +
        '</div>';

      // Fetch data
      this._loadStats();
      this._loadRecentActivity();
      this._loadAPIStatus();
      this._loadCLVSummary();
    },

    // -----------------------------------------------------------------------
    // Skeleton stat card (loading placeholder)
    // -----------------------------------------------------------------------
    _statCardSkeleton: function (label, id) {
      return '<div class="stat-card" id="stat-' + id + '">' +
        '<div class="stat-card-icon stat-icon-' + id + '">' + this._statIcon(id) + '</div>' +
        '<div class="stat-card-body">' +
          '<div class="stat-card-label">' + label + '</div>' +
          '<div class="stat-card-value" id="stat-value-' + id + '">--</div>' +
          '<div class="stat-card-sub" id="stat-sub-' + id + '">&nbsp;</div>' +
        '</div>' +
      '</div>';
    },

    _statIcon: function (type) {
      if (type === 'users') return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
      if (type === 'premium') return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
      if (type === 'tips') return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
      if (type === 'pnl') return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>';
      return '';
    },

    // -----------------------------------------------------------------------
    // Load stat cards
    // -----------------------------------------------------------------------
    _loadStats: function () {
      AdminAPI.get('/admin/stats')
        .then(function (data) {
          var valUsers = document.getElementById('stat-value-users');
          var subUsers = document.getElementById('stat-sub-users');
          if (valUsers) valUsers.textContent = data.totalUsers;
          if (subUsers) subUsers.textContent = data.freeUsers + ' free, ' + data.premiumUsers + ' premium';

          var valPremium = document.getElementById('stat-value-premium');
          var subPremium = document.getElementById('stat-sub-premium');
          if (valPremium) valPremium.textContent = data.premiumUsers;
          if (subPremium) subPremium.textContent = data.conversionRate + '% conversion';

          var valTips = document.getElementById('stat-value-tips');
          var subTips = document.getElementById('stat-sub-tips');
          if (valTips) valTips.textContent = data.tipsToday;
          if (subTips) subTips.textContent = data.resultsThisWeek + ' results this week';

          var valPnl = document.getElementById('stat-value-pnl');
          var subPnl = document.getElementById('stat-sub-pnl');
          if (valPnl) {
            var pnl = data.totalPnL || 0;
            valPnl.innerHTML = AdminApp.formatPnL(pnl);
          }
          if (subPnl) subPnl.textContent = 'All-time total';
        })
        .catch(function (err) {
          AdminApp.toast('Failed to load stats: ' + err.message, 'error');
        });
    },

    // -----------------------------------------------------------------------
    // Load recent activity (last 10 results)
    // -----------------------------------------------------------------------
    _loadRecentActivity: function () {
      AdminAPI.get('/results')
        .then(function (results) {
          var wrap = document.getElementById('dash-recent-activity');
          if (!wrap) return;

          if (!results || results.length === 0) {
            wrap.innerHTML = '<p class="admin-empty">No results recorded yet.</p>';
            return;
          }

          // Take last 10, most recent first
          var recent = results.slice(-10).reverse();

          var html = '<table class="admin-table">' +
            '<thead><tr>' +
              '<th>Date</th>' +
              '<th>Selection</th>' +
              '<th>Odds</th>' +
              '<th>Result</th>' +
              '<th>P/L</th>' +
            '</tr></thead><tbody>';

          recent.forEach(function (r) {
            var resultClass = 'result-badge result-' + (r.result || 'pending');
            html += '<tr>' +
              '<td>' + AdminApp.formatDate(r.date) + '</td>' +
              '<td>' + (r.selection || '-') + '</td>' +
              '<td>' + AdminApp.formatOdds(r.odds) + '</td>' +
              '<td><span class="' + resultClass + '">' + (r.result || 'pending') + '</span></td>' +
              '<td>' + AdminApp.formatPnL(r.pnl) + '</td>' +
            '</tr>';
          });

          html += '</tbody></table>';
          wrap.innerHTML = html;
        })
        .catch(function (err) {
          var wrap = document.getElementById('dash-recent-activity');
          if (wrap) wrap.innerHTML = '<p class="admin-empty">Failed to load results.</p>';
        });
    },

    // -----------------------------------------------------------------------
    // Load API status
    // -----------------------------------------------------------------------
    _loadAPIStatus: function () {
      AdminAPI.get('/status')
        .then(function (data) {
          var grid = document.getElementById('dash-api-status');
          if (!grid) return;

          var apis = [
            { label: 'Racing API', connected: data.racing && data.racing.connected },
            { label: 'Football API', connected: data.football && data.football.connected },
            { label: 'Odds API', connected: data.odds && data.odds.connected }
          ];

          var html = '';
          apis.forEach(function (api) {
            var dotClass = api.connected ? 'status-connected' : 'status-disconnected';
            var statusText = api.connected ? 'Connected' : 'Disconnected';
            html += '<div class="api-status-item">' +
              '<span class="status-dot ' + dotClass + '"></span>' +
              '<span class="api-status-label">' + api.label + '</span>' +
              '<span class="api-status-text ' + dotClass + '">' + statusText + '</span>' +
            '</div>';
          });

          grid.innerHTML = html;
        })
        .catch(function () {
          var grid = document.getElementById('dash-api-status');
          if (grid) grid.innerHTML = '<p class="admin-empty">Unable to check API status.</p>';
        });
    },

    // -----------------------------------------------------------------------
    // Quick actions
    // -----------------------------------------------------------------------
    goAddTip: function () {
      window.location.hash = '#/tips';
    },

    goSendBulletin: function () {
      window.location.hash = '#/email';
    },

    autoSettle: function () {
      AdminApp.confirm('Run auto-settle to match active tips against live results?', function () {
        AdminApp.toast('Auto-settling...', 'info');
        AdminAPI.post('/admin/auto-results', {})
          .then(function (data) {
            AdminApp.toast(data.message || (data.updated + ' tip(s) auto-settled'), 'success');
            DashboardPage._loadStats();
            DashboardPage._loadRecentActivity();
          })
          .catch(function (err) {
            AdminApp.toast('Auto-settle failed: ' + err.message, 'error');
          });
      });
    },

    refreshData: function () {
      AdminApp.toast('Refreshing data...', 'info');
      this._loadStats();
      this._loadRecentActivity();
      this._loadAPIStatus();
      this._loadCLVSummary();
      setTimeout(function () {
        AdminApp.toast('Data refreshed', 'success');
      }, 600);
    },

    // -----------------------------------------------------------------------
    // Load CLV summary for dashboard
    // -----------------------------------------------------------------------
    _loadCLVSummary: function () {
      AdminAPI.get('/analytics/clv?days=30')
        .then(function (data) {
          var wrap = document.getElementById('dash-clv-summary');
          if (!wrap) return;

          if (!data || data.tipsWithClv === 0) {
            wrap.innerHTML = '<p style="color:var(--text-muted,#888);font-size:13px;">CLV data will appear here once tips are settled with closing prices. This requires the price history logger to run while tips are active.</p>';
            return;
          }

          var avgClvColor = data.avgClv > 0 ? '#16a34a' : (data.avgClv < 0 ? '#dc2626' : '#fff');
          var rateColor = data.positiveClvRate >= 55 ? '#16a34a' : (data.positiveClvRate >= 45 ? '#fbbf24' : '#dc2626');

          var html = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;">';
          html += '<div class="stat-card"><div class="stat-card-value" style="color:' + avgClvColor + ';">' + (data.avgClv !== null ? (data.avgClv > 0 ? '+' : '') + data.avgClv.toFixed(2) + '%' : '-') + '</div><div class="stat-card-label">Avg CLV (30d)</div></div>';
          html += '<div class="stat-card"><div class="stat-card-value" style="color:' + rateColor + ';">' + (data.positiveClvRate || 0) + '%</div><div class="stat-card-label">+CLV Rate</div></div>';
          html += '<div class="stat-card"><div class="stat-card-value">' + data.tipsWithClv + '</div><div class="stat-card-label">Tips Tracked</div></div>';
          html += '<div class="stat-card"><div class="stat-card-value">' + data.totalSettled + '</div><div class="stat-card-label">Total Settled</div></div>';
          html += '</div>';

          // Mini CLV by sport
          if (data.bySport && Object.keys(data.bySport).length > 0) {
            html += '<div style="display:flex;gap:16px;margin-top:12px;font-size:12px;">';
            Object.keys(data.bySport).forEach(function(sport) {
              var s = data.bySport[sport];
              var c = s.avgClv > 0 ? '#16a34a' : '#dc2626';
              html += '<span style="text-transform:capitalize;color:var(--text-muted,#888);">' + sport + ': <strong style="color:' + c + ';">' + (s.avgClv > 0 ? '+' : '') + s.avgClv + '%</strong> (' + s.tips + ' tips)</span>';
            });
            html += '</div>';
          }

          html += '<div style="margin-top:8px;"><a href="#/analytics" style="color:#d4a843;font-size:12px;text-decoration:underline;">View full CLV analytics &rarr;</a></div>';
          wrap.innerHTML = html;
        })
        .catch(function () {
          var wrap = document.getElementById('dash-clv-summary');
          if (wrap) wrap.innerHTML = '<p style="color:var(--text-muted,#888);font-size:13px;">CLV analytics not available yet. Data will appear after tips are settled with closing prices.</p>';
        });
    }
  };

})();
