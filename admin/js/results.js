/* =========================================================================
   ELITE EDGE SPORTS TIPS — Admin Results Management Module
   Renders into #admin-content
   Depends on: AdminAPI, AdminApp.toast()
   ========================================================================= */

window.ResultsPage = {
  _performance: null,
  _results: [],
  _tips: [],
  _byConfidence: null,
  _sortField: 'date',
  _sortDir: -1,

  // ---------------------------------------------------------------------------
  // RENDER — main entry point
  // ---------------------------------------------------------------------------
  async render() {
    var container = document.getElementById('admin-content');
    if (!container) return;

    container.innerHTML = '<div class="admin-loading"><div class="spinner"></div> Loading results data...</div>';

    try {
      var data = await Promise.all([
        AdminAPI.get('/results/performance'),
        AdminAPI.get('/results'),
        AdminAPI.get('/tips'),
        AdminAPI.get('/results/by-confidence'),
      ]);
      this._performance = data[0];
      this._results = data[1];
      this._tips = data[2];
      this._byConfidence = data[3];
    } catch (err) {
      container.innerHTML = '<div class="admin-error">Failed to load results data: ' + (err.message || err) + '</div>';
      return;
    }

    this._renderPage(container);
  },

  // ---------------------------------------------------------------------------
  // PAGE LAYOUT
  // ---------------------------------------------------------------------------
  _renderPage(container) {
    var self = this;

    container.innerHTML = ''
      + this._renderPerformanceOverview()
      + this._renderSportBreakdown()
      + this._renderByConfidence()
      + this._renderSettleSection()
      + this._renderRecentResults();

    this._bindEvents(container);
  },

  // ---------------------------------------------------------------------------
  // 1. PERFORMANCE OVERVIEW — stat cards
  // ---------------------------------------------------------------------------
  _renderPerformanceOverview() {
    var p = this._performance || {};
    var totalTips = p.totalTips || this._results.length || 0;
    var wins = p.wins || this._results.filter(function(r) { return r.result === 'won' || r.result === 'placed'; }).length;
    var strikeRate = totalTips > 0 ? Math.round((wins / totalTips) * 1000) / 10 : 0;
    if (p.strikeRate !== undefined) strikeRate = p.strikeRate;

    var totalPnL = p.totalPnL !== undefined ? p.totalPnL
      : this._results.reduce(function(s, r) { return s + (r.pnl || 0); }, 0);
    totalPnL = Math.round(totalPnL * 100) / 100;

    var totalStaked = p.totalStaked !== undefined ? p.totalStaked
      : this._results.reduce(function(s, r) { return s + (r.stake || 1); }, 0);
    var roi = p.roi !== undefined ? p.roi
      : (totalStaked > 0 ? Math.round((totalPnL / totalStaked) * 1000) / 10 : 0);

    var srClass = strikeRate > 50 ? 'stat-green' : (strikeRate >= 30 ? 'stat-amber' : 'stat-red');
    var pnlClass = totalPnL > 0 ? 'stat-green' : (totalPnL < 0 ? 'stat-red' : '');
    var roiClass = roi > 0 ? 'stat-green' : (roi < 0 ? 'stat-red' : '');

    return ''
      + '<h2 class="admin-section-title">Performance Overview</h2>'
      + '<div class="admin-stat-cards">'
      +   '<div class="stat-card">'
      +     '<div class="stat-label">Total Tips</div>'
      +     '<div class="stat-value">' + totalTips + '</div>'
      +   '</div>'
      +   '<div class="stat-card">'
      +     '<div class="stat-label">Strike Rate</div>'
      +     '<div class="stat-value ' + srClass + '">' + strikeRate + '%</div>'
      +   '</div>'
      +   '<div class="stat-card">'
      +     '<div class="stat-label">Total P/L</div>'
      +     '<div class="stat-value ' + pnlClass + '">' + (totalPnL > 0 ? '+' : '') + totalPnL.toFixed(2) + '</div>'
      +   '</div>'
      +   '<div class="stat-card">'
      +     '<div class="stat-label">ROI</div>'
      +     '<div class="stat-value ' + roiClass + '">' + (roi > 0 ? '+' : '') + roi + '%</div>'
      +   '</div>'
      + '</div>';
  },

  // ---------------------------------------------------------------------------
  // 2. BY SPORT BREAKDOWN
  // ---------------------------------------------------------------------------
  _renderSportBreakdown() {
    var racingResults = this._results.filter(function(r) { return r.sport === 'racing' && r.result !== 'void'; });
    var footballResults = this._results.filter(function(r) { return r.sport === 'football' && r.result !== 'void'; });

    return ''
      + '<h2 class="admin-section-title">By Sport Breakdown</h2>'
      + '<div class="admin-sport-cards">'
      +   this._sportCard('Racing', racingResults)
      +   this._sportCard('Football', footballResults)
      + '</div>';
  },

  _sportCard(label, results) {
    var total = results.length;
    var wins = results.filter(function(r) { return r.result === 'won' || r.result === 'placed'; }).length;
    var strikeRate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;
    var pnl = results.reduce(function(s, r) { return s + (r.pnl || 0); }, 0);
    pnl = Math.round(pnl * 100) / 100;
    var staked = results.reduce(function(s, r) { return s + (r.stake || 1); }, 0);
    var roi = staked > 0 ? Math.round((pnl / staked) * 1000) / 10 : 0;

    var pnlClass = pnl > 0 ? 'stat-green' : (pnl < 0 ? 'stat-red' : '');
    var roiClass = roi > 0 ? 'stat-green' : (roi < 0 ? 'stat-red' : '');
    var icon = label === 'Racing' ? '&#127943;' : '&#9917;';

    return ''
      + '<div class="sport-card">'
      +   '<h3 class="sport-card-title">' + icon + ' ' + label + '</h3>'
      +   '<div class="sport-stat-row"><span>Tips</span><strong>' + total + '</strong></div>'
      +   '<div class="sport-stat-row"><span>Wins</span><strong>' + wins + '</strong></div>'
      +   '<div class="sport-stat-row"><span>Strike Rate</span><strong>' + strikeRate + '%</strong></div>'
      +   '<div class="sport-stat-row"><span>P/L</span><strong class="' + pnlClass + '">' + (pnl > 0 ? '+' : '') + pnl.toFixed(2) + '</strong></div>'
      +   '<div class="sport-stat-row"><span>ROI</span><strong class="' + roiClass + '">' + (roi > 0 ? '+' : '') + roi + '%</strong></div>'
      + '</div>';
  },

  // ---------------------------------------------------------------------------
  // 3. BY CONFIDENCE TIER
  // ---------------------------------------------------------------------------
  _renderByConfidence() {
    var tiers = (this._byConfidence && this._byConfidence.tiers) ? this._byConfidence.tiers : [];
    if (!tiers.length) {
      return '<h2 class="admin-section-title">Performance by Confidence</h2>'
        + '<div class="admin-empty">No confidence data available.</div>';
    }

    // Find the max tips for relative bar widths
    var maxTips = 1;
    for (var i = 0; i < tiers.length; i++) {
      if (tiers[i].totalTips > maxTips) maxTips = tiers[i].totalTips;
    }

    var rows = '';
    for (var j = 0; j < tiers.length; j++) {
      var t = tiers[j];
      var barWidth = maxTips > 0 ? Math.round((t.totalTips / maxTips) * 100) : 0;
      var srClass = t.strikeRate > 50 ? 'stat-green' : (t.strikeRate >= 30 ? 'stat-amber' : 'stat-red');
      var pnlClass = t.pnl > 0 ? 'stat-green' : (t.pnl < 0 ? 'stat-red' : '');

      rows += '<tr>'
        + '<td><strong>' + t.tier + '</strong> <span class="text-muted">(' + t.range + ')</span></td>'
        + '<td>'
        +   '<div class="conf-bar-wrap">'
        +     '<div class="conf-bar" style="width:' + barWidth + '%"></div>'
        +     '<span class="conf-bar-label">' + t.totalTips + '</span>'
        +   '</div>'
        + '</td>'
        + '<td>' + t.wins + '</td>'
        + '<td class="' + srClass + '">' + t.strikeRate + '%</td>'
        + '<td class="' + pnlClass + '">' + (t.pnl > 0 ? '+' : '') + t.pnl.toFixed(2) + '</td>'
        + '<td>' + (t.roi > 0 ? '+' : '') + t.roi + '%</td>'
        + '</tr>';
    }

    return ''
      + '<h2 class="admin-section-title">Performance by Confidence</h2>'
      + '<div class="admin-table-wrap">'
      +   '<table class="admin-table conf-table">'
      +     '<thead><tr>'
      +       '<th>Tier</th><th>Tips</th><th>Wins</th><th>Strike Rate</th><th>P/L</th><th>ROI</th>'
      +     '</tr></thead>'
      +     '<tbody>' + rows + '</tbody>'
      +   '</table>'
      + '</div>';
  },

  // ---------------------------------------------------------------------------
  // 4. SETTLE RESULTS — quick-settle unsettled tips
  // ---------------------------------------------------------------------------
  _renderSettleSection() {
    var unsettled = this._tips.filter(function(t) {
      return t.status === 'active' && !t.locked;
    });

    if (!unsettled.length) {
      return ''
        + '<h2 class="admin-section-title">Settle Results</h2>'
        + '<div class="admin-empty">No unsettled tips. All tips have been settled.</div>';
    }

    var rows = '';
    for (var i = 0; i < unsettled.length; i++) {
      var t = unsettled[i];
      rows += '<tr data-tip-id="' + t.id + '">'
        + '<td>' + (t.event || '-') + '</td>'
        + '<td>' + (t.selection || '-') + '</td>'
        + '<td>' + (t.odds || '-') + '</td>'
        + '<td class="col-settle-actions">'
        +   '<button class="btn btn-sm btn-green settle-btn" data-tip-id="' + t.id + '" data-result="won">Won</button>'
        +   '<button class="btn btn-sm btn-red settle-btn" data-tip-id="' + t.id + '" data-result="lost">Lost</button>'
        +   '<button class="btn btn-sm btn-amber settle-btn" data-tip-id="' + t.id + '" data-result="placed">Placed</button>'
        +   '<button class="btn btn-sm btn-outline settle-btn" data-tip-id="' + t.id + '" data-result="void">Void</button>'
        + '</td>'
        + '</tr>';
    }

    return ''
      + '<h2 class="admin-section-title">Settle Results</h2>'
      + '<div class="admin-table-wrap">'
      +   '<table class="admin-table settle-table">'
      +     '<thead><tr><th>Event</th><th>Selection</th><th>Odds</th><th>Mark Result</th></tr></thead>'
      +     '<tbody>' + rows + '</tbody>'
      +   '</table>'
      + '</div>';
  },

  // ---------------------------------------------------------------------------
  // 5. RECENT RESULTS — last 20, sortable by date
  // ---------------------------------------------------------------------------
  _renderRecentResults() {
    var sorted = this._getSortedResults();
    var recent = sorted.slice(0, 20);

    if (!recent.length) {
      return ''
        + '<h2 class="admin-section-title">Recent Results</h2>'
        + '<div class="admin-empty">No results recorded yet.</div>';
    }

    var rows = '';
    for (var i = 0; i < recent.length; i++) {
      var r = recent[i];
      var resultBadge = '<span class="badge badge-result-' + (r.result || 'void') + '">'
        + this._ucFirst(r.result || 'N/A') + '</span>';
      var pnl = r.pnl !== undefined ? r.pnl : 0;
      var pnlClass = pnl > 0 ? 'pnl-pos' : (pnl < 0 ? 'pnl-neg' : '');

      rows += '<tr>'
        + '<td>' + (r.date || '-') + '</td>'
        + '<td class="col-event">' + (r.event || '-') + '</td>'
        + '<td>' + (r.selection || '-') + '</td>'
        + '<td>' + (r.odds || '-') + '</td>'
        + '<td>' + (r.stake || '-') + '</td>'
        + '<td>' + resultBadge + '</td>'
        + '<td class="' + pnlClass + '">' + (pnl > 0 ? '+' : '') + pnl.toFixed(2) + '</td>'
        + '</tr>';
    }

    var sortIcon = this._sortDir === -1 ? ' &#9660;' : ' &#9650;';
    var dateSortLabel = this._sortField === 'date' ? ('Date' + sortIcon) : 'Date';

    return ''
      + '<h2 class="admin-section-title">Recent Results</h2>'
      + '<div class="admin-table-wrap">'
      +   '<table class="admin-table recent-table">'
      +     '<thead><tr>'
      +       '<th class="sortable" id="sort-date">' + dateSortLabel + '</th>'
      +       '<th>Event</th><th>Selection</th><th>Odds</th><th>Stake</th><th>Result</th><th>P/L</th>'
      +     '</tr></thead>'
      +     '<tbody>' + rows + '</tbody>'
      +   '</table>'
      + '</div>';
  },

  _getSortedResults() {
    var field = this._sortField;
    var dir = this._sortDir;
    var copy = this._results.slice();

    copy.sort(function(a, b) {
      var aVal = a[field] || '';
      var bVal = b[field] || '';
      if (aVal < bVal) return -1 * dir;
      if (aVal > bVal) return 1 * dir;
      return 0;
    });

    return copy;
  },

  // ---------------------------------------------------------------------------
  // EVENT BINDINGS
  // ---------------------------------------------------------------------------
  _bindEvents(container) {
    var self = this;

    // Settle buttons
    var settleBtns = container.querySelectorAll('.settle-btn');
    for (var i = 0; i < settleBtns.length; i++) {
      settleBtns[i].addEventListener('click', function() {
        var tipId = this.getAttribute('data-tip-id');
        var result = this.getAttribute('data-result');
        self._settleTip(tipId, result, this);
      });
    }

    // Sort by date
    var sortDate = document.getElementById('sort-date');
    if (sortDate) {
      sortDate.addEventListener('click', function() {
        if (self._sortField === 'date') {
          self._sortDir = self._sortDir === -1 ? 1 : -1;
        } else {
          self._sortField = 'date';
          self._sortDir = -1;
        }
        self._renderPage(container);
      });
    }
  },

  // ---------------------------------------------------------------------------
  // SETTLE SINGLE TIP
  // ---------------------------------------------------------------------------
  async _settleTip(tipId, result, btn) {
    // Disable all buttons in the same row to prevent double-clicks
    var row = btn.closest('tr');
    if (row) {
      var btns = row.querySelectorAll('.settle-btn');
      for (var i = 0; i < btns.length; i++) {
        btns[i].disabled = true;
      }
    }

    try {
      await AdminAPI.post('/admin/results', { tipId: tipId, result: result });
      AdminApp.toast('Tip settled as ' + this._ucFirst(result) + '.', 'success');
      await this.render();
    } catch (err) {
      AdminApp.toast('Settle failed: ' + (err.message || err), 'error');
      // Re-enable buttons on failure
      if (row) {
        var btns2 = row.querySelectorAll('.settle-btn');
        for (var j = 0; j < btns2.length; j++) {
          btns2[j].disabled = false;
        }
      }
    }
  },

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------
  _ucFirst(s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
};
