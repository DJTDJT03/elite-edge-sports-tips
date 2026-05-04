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
  _selectedDate: null, // for daily review picker

  // ---------------------------------------------------------------------------
  // RENDER — main entry point
  // ---------------------------------------------------------------------------
  async render() {
    var container = document.getElementById('admin-content');
    if (!container) return;

    container.innerHTML = '<div class="admin-loading"><div class="spinner"></div> Loading results data...</div>';

    try {
      var selectedDate = this._selectedDate || new Date().toISOString().split('T')[0];
      var data = await Promise.all([
        AdminAPI.get('/results/performance'),
        AdminAPI.get('/results'),
        AdminAPI.get('/tips'),
        AdminAPI.get('/results/by-confidence'),
        AdminAPI.get('/analytics/shadow-scoring?date=' + selectedDate).catch(function() { return { candidates: [] }; }),
        AdminAPI.get('/user/match-predictions?date=' + selectedDate).catch(function() { return { predictions: [], stats: {} }; }),
        AdminAPI.get('/user/race-predictions?date=' + selectedDate).catch(function() { return { predictions: [], stats: {} }; }),
      ]);
      this._performance = data[0];
      this._results = data[1];
      this._tips = data[2];
      this._byConfidence = data[3];
      this._candidates = (data[4] && data[4].candidates) ? data[4].candidates : [];
      this._matchPredictions = (data[5] && data[5].predictions) ? data[5].predictions : [];
      this._matchPredictionStats = (data[5] && data[5].stats) ? data[5].stats : {};
      this._racePredictions = (data[6] && data[6].predictions) ? data[6].predictions : [];
      this._racePredictionStats = (data[6] && data[6].stats) ? data[6].stats : {};
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
      + this._renderDailyReview()
      + this._renderRacePredictions()
      + this._renderMatchPredictions()
      + this._renderPerformanceOverview()
      + this._renderSportBreakdown()
      + this._renderByConfidence()
      + this._renderSettleSection()
      + this._renderRecentResults();

    this._bindEvents(container);
  },

  // ---------------------------------------------------------------------------
  // 0. DAILY REVIEW — pick a date, see all tips + outcomes for that day
  // ---------------------------------------------------------------------------
  _renderDailyReview() {
    var self = this;
    // Default to today
    if (!this._selectedDate) {
      var now = new Date();
      this._selectedDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    }

    // Find all dates that have tips or results for quick-nav buttons
    var dateSet = {};
    this._tips.forEach(function(t) {
      var d = self._extractDate(t.date || t.createdAt);
      if (d) dateSet[d] = true;
    });
    this._results.forEach(function(r) {
      var d = self._extractDate(r.date);
      if (d) dateSet[d] = true;
    });
    var allDates = Object.keys(dateSet).sort().reverse();

    // Quick-nav: last 7 days with data
    var quickBtns = allDates.slice(0, 7).map(function(d) {
      var isActive = d === self._selectedDate;
      var dt = new Date(d + 'T12:00:00');
      var dayLabel = dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      return '<button class="btn btn-sm ' + (isActive ? 'btn-gold' : 'btn-outline') + ' daily-nav-btn" data-date="' + d + '" style="font-size:11px;padding:6px 10px;">' + dayLabel + '</button>';
    }).join('');

    // Get tips AND scored candidates for selected date
    var selectedDate = this._selectedDate;
    var dayTips = this._tips.filter(function(t) {
      return self._extractDate(t.date || t.createdAt) === selectedDate;
    });
    var dayCandidates = (this._candidates || []);

    // Match results to tips
    var resultMap = {};
    this._results.forEach(function(r) {
      if (r.tipId) resultMap[r.tipId] = r;
    });

    // Build unified list: merge published tips + unpublished candidates
    var allPicks = [];
    var usedSelections = {};

    // Add published tips first
    dayTips.forEach(function(t) {
      var r = resultMap[t.id];
      var key = (t.selection || '').toLowerCase() + '|' + (t.event || '').toLowerCase();
      usedSelections[key] = true;
      allPicks.push({
        sport: t.sport, selection: t.selection, event: t.event || t.meeting,
        market: t.market, odds: t.odds, confidence: t.confidence,
        edge: t.edge, time: t.raceTime || t.kickoff || '',
        result: r ? r.result : null, pnl: r ? (r.pnl || 0) : 0,
        outcome: t.actualOutcome || (r && r.actualOutcome) || '',
        wasPublished: true, settled: !!r,
      });
    });

    // Add unpublished candidates (shadow scoring picks not sent to users)
    dayCandidates.forEach(function(c) {
      var key = (c.selection || '').toLowerCase() + '|' + (c.event || '').toLowerCase();
      if (usedSelections[key]) return; // skip if already shown as a published tip
      allPicks.push({
        sport: c.sport, selection: c.selection, event: c.event || c.meeting,
        market: c.market, odds: c.odds, confidence: c.confidence,
        edge: c.edge, time: c.kickoff || '',
        result: c.result || null, pnl: c.pnl || 0,
        outcome: '', wasPublished: c.wasPublished, settled: c.settled,
      });
    });

    // Build stats for the day — ALL picks
    var dayWins = 0, dayLosses = 0, dayPending = 0, dayVoid = 0, dayPlaced = 0;
    var dayPnL = 0;
    var pubWins = 0, pubTotal = 0, unpubWins = 0, unpubTotal = 0;
    allPicks.forEach(function(p) {
      if (!p.result) { dayPending++; return; }
      if (p.result === 'won') { dayWins++; dayPnL += p.pnl; if (p.wasPublished) { pubWins++; pubTotal++; } else { unpubWins++; unpubTotal++; } }
      else if (p.result === 'lost') { dayLosses++; dayPnL += p.pnl; if (p.wasPublished) pubTotal++; else unpubTotal++; }
      else if (p.result === 'placed') { dayPlaced++; dayPnL += p.pnl; if (p.wasPublished) { pubWins++; pubTotal++; } else { unpubWins++; unpubTotal++; } }
      else if (p.result === 'void') { dayVoid++; }
      else { dayPending++; }
    });
    var daySettled = dayWins + dayLosses + dayPlaced + dayVoid;
    var dayStrikeRate = (daySettled - dayVoid) > 0 ? Math.round(((dayWins + dayPlaced) / (daySettled - dayVoid)) * 1000) / 10 : 0;
    dayPnL = Math.round(dayPnL * 100) / 100;

    var dt = new Date(selectedDate + 'T12:00:00');
    var dateLabel = dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    // Sort by sport then time
    allPicks.sort(function(a, b) {
      if (a.sport !== b.sport) return (a.sport || '').localeCompare(b.sport || '');
      return (a.time || '').localeCompare(b.time || '');
    });

    // Build rows
    var tipRows = '';
    if (allPicks.length === 0) {
      tipRows = '<tr><td colspan="10" style="text-align:center;color:#64748b;padding:20px;">No picks scored on this date.</td></tr>';
    } else {
      allPicks.forEach(function(p) {
        var resultBadge, pnlCell, outcomeCell;
        if (p.settled && p.result) {
          var badgeClass = p.result === 'won' ? 'badge-result-won' : p.result === 'lost' ? 'badge-result-lost' : p.result === 'placed' ? 'badge-result-placed' : 'badge-result-void';
          resultBadge = '<span class="badge ' + badgeClass + '">' + self._ucFirst(p.result) + '</span>';
          pnlCell = '<span class="' + (p.pnl > 0 ? 'stat-green' : p.pnl < 0 ? 'stat-red' : '') + '">' + (p.pnl > 0 ? '+' : '') + p.pnl.toFixed(2) + '</span>';
        } else {
          resultBadge = '<span class="badge" style="background:rgba(148,163,184,0.15);color:#94a3b8;">Pending</span>';
          pnlCell = '<span style="color:#64748b;">—</span>';
        }
        outcomeCell = p.outcome ? '<span style="font-size:11px;color:#cbd5e1;">' + p.outcome + '</span>' : '<span style="color:#64748b;font-size:11px;">—</span>';

        var sportIcon = p.sport === 'racing' ? '&#127943;' : p.sport === 'football' ? '&#9917;' : p.sport === 'basketball' ? '&#127936;' : p.sport === 'tennis' ? '&#127934;' : p.sport === 'rugby' ? '&#127945;' : p.sport === 'american-football' ? '&#127944;' : '&#128200;';
        var confColor = (p.confidence || 0) >= 8 ? '#22c55e' : (p.confidence || 0) >= 6 ? '#d4a843' : '#94a3b8';
        var time = p.time || '';
        if (time && time.length > 5) time = time.substring(0, 5);

        var pubBadge = p.wasPublished
          ? '<span style="background:rgba(212,168,67,0.2);color:#d4a843;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;">PUBLISHED</span>'
          : '<span style="background:rgba(100,116,139,0.2);color:#94a3b8;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;">SHADOW</span>';

        var edgeVal = p.edge ? (p.edge > 1 ? p.edge.toFixed(1) : (p.edge * 100).toFixed(1)) : '—';

        var rowBg = p.wasPublished ? '' : 'background:rgba(100,116,139,0.03);';

        tipRows += '<tr style="' + rowBg + '">'
          + '<td>' + sportIcon + '</td>'
          + '<td style="font-size:12px;color:#94a3b8;">' + time + '</td>'
          + '<td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (p.event || '-') + '</td>'
          + '<td><strong>' + (p.selection || '-') + '</strong><br><span style="font-size:11px;color:#64748b;">' + (p.market || 'Win') + '</span></td>'
          + '<td style="font-weight:700;color:#d4a843;">' + (p.odds || '-') + '</td>'
          + '<td style="text-align:center;"><span style="color:' + confColor + ';font-weight:700;">' + (p.confidence || '-') + '</span></td>'
          + '<td style="text-align:center;">' + edgeVal + '%</td>'
          + '<td>' + pubBadge + '</td>'
          + '<td>' + resultBadge + '</td>'
          + '<td>' + pnlCell + '</td>'
          + '</tr>';
      });
    }

    var pnlClass = dayPnL > 0 ? 'stat-green' : dayPnL < 0 ? 'stat-red' : '';
    var pubSR = pubTotal > 0 ? Math.round((pubWins / pubTotal) * 1000) / 10 : 0;
    var unpubSR = unpubTotal > 0 ? Math.round((unpubWins / unpubTotal) * 1000) / 10 : 0;

    return ''
      + '<h2 class="admin-section-title">Daily Review — All Picks</h2>'
      + '<div style="margin-bottom:16px;">'
      +   '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">'
      +     '<input type="date" id="daily-date-picker" value="' + selectedDate + '" style="padding:8px 12px;background:var(--admin-bg-card,#1e2235);border:1px solid var(--admin-border,#2a2e3d);border-radius:6px;color:#fff;font-size:14px;" />'
      +     '<span style="font-size:14px;color:#cbd5e1;font-weight:600;">' + dateLabel + '</span>'
      +   '</div>'
      +   '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:16px;">' + quickBtns + '</div>'
      + '</div>'

      // Day summary cards
      + '<div class="admin-stat-cards" style="margin-bottom:12px;">'
      +   '<div class="stat-card"><div class="stat-label">All Picks</div><div class="stat-value">' + allPicks.length + '</div></div>'
      +   '<div class="stat-card"><div class="stat-label">Published</div><div class="stat-value" style="color:#d4a843;">' + dayTips.length + '</div></div>'
      +   '<div class="stat-card"><div class="stat-label">Shadow</div><div class="stat-value" style="color:#94a3b8;">' + (allPicks.length - dayTips.length) + '</div></div>'
      +   '<div class="stat-card"><div class="stat-label">Winners</div><div class="stat-value stat-green">' + dayWins + '</div></div>'
      +   '<div class="stat-card"><div class="stat-label">Losers</div><div class="stat-value stat-red">' + dayLosses + '</div></div>'
      +   '<div class="stat-card"><div class="stat-label">Pending</div><div class="stat-value" style="color:#f59e0b;">' + dayPending + '</div></div>'
      +   '<div class="stat-card"><div class="stat-label">Strike Rate</div><div class="stat-value ' + (dayStrikeRate > 50 ? 'stat-green' : dayStrikeRate >= 30 ? 'stat-amber' : 'stat-red') + '">' + (daySettled > dayVoid ? dayStrikeRate + '%' : '—') + '</div></div>'
      +   '<div class="stat-card"><div class="stat-label">P/L</div><div class="stat-value ' + pnlClass + '">' + (dayPnL > 0 ? '+' : '') + dayPnL.toFixed(2) + '</div></div>'
      + '</div>'

      // Published vs Shadow accuracy comparison
      + (pubTotal > 0 || unpubTotal > 0 ? '<div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap;">'
      +   (pubTotal > 0 ? '<div style="flex:1;min-width:200px;background:rgba(212,168,67,0.06);border:1px solid rgba(212,168,67,0.2);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#d4a843;margin-bottom:4px;">Published Accuracy</div><div style="font-size:24px;font-weight:900;color:#d4a843;">' + pubSR + '%</div><div style="font-size:11px;color:#94a3b8;">' + pubWins + '/' + pubTotal + ' settled</div></div>' : '')
      +   (unpubTotal > 0 ? '<div style="flex:1;min-width:200px;background:rgba(100,116,139,0.06);border:1px solid rgba(100,116,139,0.2);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:4px;">Shadow Accuracy</div><div style="font-size:24px;font-weight:900;color:#94a3b8;">' + unpubSR + '%</div><div style="font-size:11px;color:#94a3b8;">' + unpubWins + '/' + unpubTotal + ' settled</div></div>' : '')
      + '</div>' : '')

      // All picks table
      + '<div class="admin-table-wrap">'
      +   '<table class="admin-table">'
      +     '<thead><tr><th></th><th>Time</th><th>Event</th><th>Our Pick</th><th>Odds</th><th>Conf</th><th>Edge</th><th>Status</th><th>Result</th><th>P/L</th></tr></thead>'
      +     '<tbody>' + tipRows + '</tbody>'
      +   '</table>'
      + '</div>'
      + '<hr style="border:none;border-top:1px solid #2a2e3d;margin:32px 0;">';
  },

  async _fetchCandidatesAndRerender(container) {
    try {
      var results = await Promise.all([
        AdminAPI.get('/analytics/shadow-scoring?date=' + this._selectedDate).catch(function() { return { candidates: [] }; }),
        AdminAPI.get('/user/match-predictions?date=' + this._selectedDate).catch(function() { return { predictions: [], stats: {} }; }),
        AdminAPI.get('/user/race-predictions?date=' + this._selectedDate).catch(function() { return { predictions: [], stats: {} }; }),
      ]);
      this._candidates = (results[0] && results[0].candidates) ? results[0].candidates : [];
      this._matchPredictions = (results[1] && results[1].predictions) ? results[1].predictions : [];
      this._racePredictions = (results[2] && results[2].predictions) ? results[2].predictions : [];
    } catch (e) {
      this._candidates = [];
      this._matchPredictions = [];
    }
    this._renderPage(container);
  },

  _extractDate(dateVal) {
    if (!dateVal) return null;
    var str = String(dateVal);
    // Handle ISO strings and date-only strings
    if (str.length >= 10) return str.substring(0, 10);
    return null;
  },

  // ---------------------------------------------------------------------------
  // 0b. RACE PREDICTIONS — "Our Pick" in every race
  // ---------------------------------------------------------------------------
  _renderRacePredictions() {
    var preds = this._racePredictions || [];
    if (preds.length === 0) return '';

    var stats = this._racePredictionStats || {};
    var winRate = stats.winRate || 0;
    var placeRate = stats.placeRate || 0;
    var winColor = winRate >= 25 ? '#22c55e' : winRate >= 15 ? '#d4a843' : '#ef4444';
    var placeColor = placeRate >= 50 ? '#22c55e' : placeRate >= 35 ? '#d4a843' : '#ef4444';

    var rows = preds.map(function(p) {
      var resultBadge = '';
      if (p.correct === true) resultBadge = '<span style="color:#22c55e;font-weight:700;">&#10003; WON</span>';
      else if (p.finish_position && p.finish_position <= 3) resultBadge = '<span style="color:#d4a843;font-weight:700;">' + p.finish_position + (p.finish_position === 1 ? 'st' : p.finish_position === 2 ? 'nd' : 'rd') + ' Placed</span>';
      else if (p.correct === false) resultBadge = '<span style="color:#ef4444;">' + (p.finish_position ? p.finish_position + (p.finish_position >= 4 ? 'th' : '') : 'Lost') + '</span>';
      else resultBadge = '<span style="color:#94a3b8;">Pending</span>';

      return '<tr>' +
        '<td style="font-size:12px;">' + (p.meeting || '') + ' ' + (p.race_time || '') + '</td>' +
        '<td><strong>' + (p.selection || '') + '</strong></td>' +
        '<td style="text-align:center;color:#d4a843;font-weight:700;">' + (p.odds || '-') + '</td>' +
        '<td style="text-align:center;">' + (p.confidence || '-') + '</td>' +
        '<td style="text-align:center;">' + (p.runners || '-') + '</td>' +
        '<td>' + (p.winner || '—') + '</td>' +
        '<td>' + resultBadge + '</td>' +
      '</tr>';
    }).join('');

    return ''
      + '<h2 class="admin-section-title">Our Pick — Racing Predictions (Every Race)</h2>'
      + '<div class="admin-stat-cards" style="margin-bottom:16px;">'
      +   '<div class="stat-card"><div class="stat-label">Races</div><div class="stat-value">' + preds.length + '</div></div>'
      +   '<div class="stat-card"><div class="stat-label">Winners</div><div class="stat-value stat-green">' + (stats.correct || 0) + '</div></div>'
      +   '<div class="stat-card"><div class="stat-label">Placed</div><div class="stat-value" style="color:#d4a843;">' + (stats.placed || 0) + '</div></div>'
      +   '<div class="stat-card"><div class="stat-label">Win Rate</div><div class="stat-value" style="color:' + winColor + ';">' + winRate + '%</div></div>'
      +   '<div class="stat-card"><div class="stat-label">Place Rate</div><div class="stat-value" style="color:' + placeColor + ';">' + placeRate + '%</div></div>'
      + '</div>'
      + '<div class="admin-table-wrap">'
      +   '<table class="admin-table">'
      +     '<thead><tr><th>Race</th><th>Our Pick</th><th>Odds</th><th>Conf</th><th>Field</th><th>Winner</th><th>Result</th></tr></thead>'
      +     '<tbody>' + rows + '</tbody>'
      +   '</table>'
      + '</div>'
      + '<hr style="border:none;border-top:1px solid #2a2e3d;margin:32px 0;">';
  },

  // ---------------------------------------------------------------------------
  // 0c. MATCH PREDICTIONS — "Our Take" accuracy on every football game
  // ---------------------------------------------------------------------------
  _renderMatchPredictions() {
    var preds = this._matchPredictions || [];
    if (preds.length === 0) return '';

    var correct = preds.filter(function(p) { return p.correct === true; }).length;
    var incorrect = preds.filter(function(p) { return p.correct === false; }).length;
    var pending = preds.filter(function(p) { return p.result === null; }).length;
    var settled = correct + incorrect;
    var accuracy = settled > 0 ? Math.round((correct / settled) * 1000) / 10 : 0;
    var accColor = accuracy >= 60 ? '#22c55e' : accuracy >= 40 ? '#d4a843' : '#ef4444';

    var rows = preds.map(function(p) {
      var resultBadge = '';
      if (p.correct === true) resultBadge = '<span style="color:#22c55e;font-weight:700;">&#10003; Correct</span>';
      else if (p.correct === false) resultBadge = '<span style="color:#ef4444;font-weight:700;">&#10007; Wrong</span>';
      else resultBadge = '<span style="color:#94a3b8;">Pending</span>';

      var score = p.result || '—';
      return '<tr>' +
        '<td style="font-size:12px;">' + (p.home_team || '') + ' vs ' + (p.away_team || '') + '</td>' +
        '<td style="font-size:12px;color:#94a3b8;">' + (p.league || '') + '</td>' +
        '<td><strong>' + (p.pick || '') + '</strong><br><span style="font-size:11px;color:#64748b;">' + (p.market || '') + '</span></td>' +
        '<td style="text-align:center;font-weight:700;color:#d4a843;">' + (p.confidence || '') + '</td>' +
        '<td style="text-align:center;">' + score + '</td>' +
        '<td>' + resultBadge + '</td>' +
      '</tr>';
    }).join('');

    return ''
      + '<h2 class="admin-section-title">Our Take — Football Predictions</h2>'
      + '<div class="admin-stat-cards" style="margin-bottom:16px;">'
      +   '<div class="stat-card"><div class="stat-label">Predictions</div><div class="stat-value">' + preds.length + '</div></div>'
      +   '<div class="stat-card"><div class="stat-label">Correct</div><div class="stat-value stat-green">' + correct + '</div></div>'
      +   '<div class="stat-card"><div class="stat-label">Wrong</div><div class="stat-value stat-red">' + incorrect + '</div></div>'
      +   '<div class="stat-card"><div class="stat-label">Pending</div><div class="stat-value" style="color:#f59e0b;">' + pending + '</div></div>'
      +   '<div class="stat-card"><div class="stat-label">Accuracy</div><div class="stat-value" style="color:' + accColor + ';">' + accuracy + '%</div></div>'
      + '</div>'
      + '<div class="admin-table-wrap">'
      +   '<table class="admin-table">'
      +     '<thead><tr><th>Match</th><th>League</th><th>Our Pick</th><th>Conf</th><th>Score</th><th>Result</th></tr></thead>'
      +     '<tbody>' + rows + '</tbody>'
      +   '</table>'
      + '</div>'
      + '<hr style="border:none;border-top:1px solid #2a2e3d;margin:32px 0;">';
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
      var sportIcon = t.sport === 'racing' ? '&#127943;' : t.sport === 'football' ? '&#9917;' : t.sport === 'basketball' ? '&#127936;' : t.sport === 'tennis' ? '&#127934;' : t.sport === 'rugby' ? '&#127945;' : '&#127944;';
      var outcomePlaceholder = t.sport === 'racing' ? 'e.g. 1st, 3rd, fell' : t.sport === 'football' ? 'e.g. 2-1' : 'e.g. score/result';
      rows += '<tr data-tip-id="' + t.id + '">'
        + '<td>' + sportIcon + ' ' + (t.event || '-') + '</td>'
        + '<td><strong>' + (t.selection || '-') + '</strong><br><span style="font-size:11px;color:#64748b;">' + (t.market || 'Win') + '</span></td>'
        + '<td>' + (t.odds || '-') + '</td>'
        + '<td><input type="text" class="settle-outcome-input" data-tip-id="' + t.id + '" placeholder="' + outcomePlaceholder + '" style="padding:4px 8px;background:var(--admin-bg-card,#1e2235);border:1px solid var(--admin-border,#2a2e3d);border-radius:4px;color:#fff;font-size:12px;width:120px;" /></td>'
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
      +     '<thead><tr><th>Event</th><th>Our Pick</th><th>Odds</th><th>Actual Outcome</th><th>Mark Result</th></tr></thead>'
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

    // Daily review date picker — re-fetch candidates for new date
    var datePicker = document.getElementById('daily-date-picker');
    if (datePicker) {
      datePicker.addEventListener('change', function() {
        self._selectedDate = this.value;
        self._fetchCandidatesAndRerender(container);
      });
    }

    // Quick-nav day buttons
    var dayBtns = container.querySelectorAll('.daily-nav-btn');
    for (var d = 0; d < dayBtns.length; d++) {
      dayBtns[d].addEventListener('click', function() {
        self._selectedDate = this.getAttribute('data-date');
        self._fetchCandidatesAndRerender(container);
      });
    }

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
      // Get the outcome input value from the same row
      var outcomeInput = row ? row.querySelector('.settle-outcome-input') : null;
      var actualOutcome = outcomeInput ? outcomeInput.value.trim() : '';
      await AdminAPI.post('/admin/results', { tipId: tipId, result: result, actualOutcome: actualOutcome || undefined });
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
