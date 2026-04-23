/* =========================================================================
   ELITE EDGE SPORTS TIPS — Admin Selection Performance Analytics
   Renders into #admin-content
   Depends on: AdminAPI, AdminApp.toast()
   ========================================================================= */

window.AnalyticsPage = {
  async render() {
    var content = document.getElementById('admin-content');
    if (!content) return;

    content.innerHTML = '<div class="admin-loading"><div class="spinner"></div> Loading analytics...</div>';

    try {
      var data = await AdminAPI.get('/admin/selection-analytics');
      this._renderDashboard(content, data);
    } catch(err) {
      content.innerHTML = '<div class="admin-error">Failed to load analytics: ' + err.message + '</div>';
    }
  },

  _renderDashboard: function(container, data) {
    var html = '<div class="admin-page-header">' +
      '<h2>Selection Performance Analytics</h2>' +
      '<p class="admin-page-sub">Internal analysis — where are we strongest?</p>' +
    '</div>';

    // Sport breakdown
    html += '<div class="admin-section"><h3 class="admin-section-title">Performance by Sport</h3>';
    html += this._renderTable(['Sport', 'Tips', 'Won', 'Lost', 'Placed', 'SR%', 'ROI%', 'P/L'], data.bySport);
    html += '</div>';

    // Market breakdown
    html += '<div class="admin-section"><h3 class="admin-section-title">Performance by Market</h3>';
    html += this._renderTable(['Market', 'Tips', 'Won', 'Lost', 'SR%', 'ROI%', 'P/L'], data.byMarket);
    html += '</div>';

    // Odds range breakdown
    html += '<div class="admin-section"><h3 class="admin-section-title">Performance by Odds Range</h3>';
    html += this._renderTable(['Odds Range', 'Tips', 'Won', 'Lost', 'SR%', 'ROI%', 'P/L'], data.byOddsRange);
    html += '</div>';

    // Tipster breakdown
    html += '<div class="admin-section"><h3 class="admin-section-title">Performance by Analyst</h3>';
    html += this._renderTable(['Analyst', 'Tips', 'Won', 'Lost', 'SR%', 'ROI%', 'P/L', 'Best Winner'], data.byTipster);
    html += '</div>';

    // Confidence breakdown
    html += '<div class="admin-section"><h3 class="admin-section-title">Performance by Confidence</h3>';
    html += this._renderTable(['Confidence', 'Tips', 'Won', 'Lost', 'SR%', 'ROI%', 'P/L'], data.byConfidence);
    html += '</div>';

    // Day of week
    html += '<div class="admin-section"><h3 class="admin-section-title">Performance by Day of Week</h3>';
    html += this._renderTable(['Day', 'Tips', 'Won', 'Lost', 'SR%', 'P/L'], data.byDay);
    html += '</div>';

    // Monthly
    html += '<div class="admin-section"><h3 class="admin-section-title">Monthly Performance</h3>';
    html += this._renderTable(['Month', 'Tips', 'Won', 'Lost', 'SR%', 'ROI%', 'P/L'], data.byMonth);
    html += '</div>';

    // Best and worst
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">';

    html += '<div class="admin-section"><h3 class="admin-section-title" style="color:var(--green,#16a34a);">Top 5 Most Profitable</h3>';
    if (data.topWinners && data.topWinners.length) {
      data.topWinners.forEach(function(w) {
        html += '<div style="padding:8px;border-bottom:1px solid var(--border,#2a2e3e);display:flex;justify-content:space-between;">';
        html += '<span>' + w.selection + ' @ ' + w.odds + '</span>';
        html += '<span style="color:var(--green,#16a34a);font-weight:700;">+' + w.pnl.toFixed(2) + 'u</span>';
        html += '</div>';
      });
    } else {
      html += '<p style="color:var(--text-muted,#888);">No data yet</p>';
    }
    html += '</div>';

    html += '<div class="admin-section"><h3 class="admin-section-title" style="color:var(--red,#dc2626);">Top 5 Biggest Losses</h3>';
    if (data.topLosses && data.topLosses.length) {
      data.topLosses.forEach(function(l) {
        html += '<div style="padding:8px;border-bottom:1px solid var(--border,#2a2e3e);display:flex;justify-content:space-between;">';
        html += '<span>' + l.selection + ' @ ' + l.odds + '</span>';
        html += '<span style="color:var(--red,#dc2626);font-weight:700;">' + l.pnl.toFixed(2) + 'u</span>';
        html += '</div>';
      });
    } else {
      html += '<p style="color:var(--text-muted,#888);">No data yet</p>';
    }
    html += '</div>';

    html += '</div>';

    // Last 10 form
    html += '<div class="admin-section"><h3 class="admin-section-title">Current Form (Last 10)</h3>';
    html += '<div style="display:flex;gap:6px;">';
    if (data.lastTen && data.lastTen.length) {
      data.lastTen.forEach(function(r) {
        var color = r.result === 'won' ? 'var(--green,#16a34a)' : r.result === 'placed' ? '#60a5fa' : 'var(--red,#dc2626)';
        var label = r.result === 'won' ? 'W' : r.result === 'placed' ? 'P' : 'L';
        html += '<div style="width:32px;height:32px;border-radius:6px;background:' + color + ';display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;color:#fff;" title="' + r.selection + '">' + label + '</div>';
      });
    } else {
      html += '<p style="color:var(--text-muted,#888);">No results yet</p>';
    }
    html += '</div></div>';

    // Summary stats
    html += '<div class="admin-section"><h3 class="admin-section-title">Key Stats</h3>';
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;">';
    html += '<div class="stat-card"><div class="stat-value">' + (data.avgWinnerOdds || 0).toFixed(2) + '</div><div class="stat-label">Avg Winner Odds</div></div>';
    html += '<div class="stat-card"><div class="stat-value">' + (data.avgLoserOdds || 0).toFixed(2) + '</div><div class="stat-label">Avg Loser Odds</div></div>';
    html += '<div class="stat-card"><div class="stat-value">' + (data.longestStreak || 0) + '</div><div class="stat-label">Longest Win Streak</div></div>';
    html += '<div class="stat-card"><div class="stat-value">' + (data.totalResults || 0) + '</div><div class="stat-label">Total Results</div></div>';
    html += '</div></div>';

    container.innerHTML = html;
  },

  _renderTable: function(headers, rows) {
    if (!rows || rows.length === 0) return '<p style="color:var(--text-muted,#888);">No data yet</p>';
    var html = '<div class="admin-table-wrap"><table class="admin-table"><thead><tr>';
    headers.forEach(function(h) { html += '<th>' + h + '</th>'; });
    html += '</tr></thead><tbody>';
    rows.forEach(function(row) {
      html += '<tr>';
      row.forEach(function(cell, idx) {
        var style = '';
        // Color P/L and ROI columns
        if (typeof cell === 'number') {
          if (headers[idx] === 'P/L' || headers[idx] === 'ROI%') {
            style = ' style="color:' + (cell >= 0 ? 'var(--green,#16a34a)' : 'var(--red,#dc2626)') + ';font-weight:700;"';
          }
        }
        html += '<td' + style + '>' + (typeof cell === 'number' ? (cell % 1 !== 0 ? cell.toFixed(2) : cell) : cell) + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }
};
