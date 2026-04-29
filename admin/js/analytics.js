/* =========================================================================
   ELITE EDGE SPORTS TIPS — Admin Selection Performance Analytics
   Enhanced with CLV tracking, edge-vs-results, analyst snapshots
   Renders into #admin-content
   Depends on: AdminAPI, AdminApp.toast()
   ========================================================================= */

window.AnalyticsPage = {
  async render() {
    var content = document.getElementById('admin-content');
    if (!content) return;

    content.innerHTML = '<div class="admin-loading"><div class="spinner"></div> Loading analytics...</div>';

    try {
      // Fetch all analytics data in parallel
      var results = await Promise.allSettled([
        AdminAPI.get('/admin/selection-analytics'),
        AdminAPI.get('/analytics/clv'),
        AdminAPI.get('/analytics/edge-vs-results'),
        AdminAPI.get('/analytics/analyst-snapshots'),
        AdminAPI.get('/analytics/quality-loop'),
      ]);

      var data = results[0].status === 'fulfilled' ? results[0].value : {};
      var clvData = results[1].status === 'fulfilled' ? results[1].value : null;
      var edgeData = results[2].status === 'fulfilled' ? results[2].value : null;
      var snapshots = results[3].status === 'fulfilled' ? results[3].value : null;
      var qualityData = results[4].status === 'fulfilled' ? results[4].value : null;

      this._renderDashboard(content, data, clvData, edgeData, snapshots, qualityData);
    } catch(err) {
      content.innerHTML = '<div class="admin-error">Failed to load analytics: ' + err.message + '</div>';
    }
  },

  _renderDashboard: function(container, data, clvData, edgeData, snapshots, qualityData) {
    var html = '<div class="admin-page-header">' +
      '<h2>Selection Performance Analytics</h2>' +
      '<p class="admin-page-sub">Data integrity, CLV tracking, and edge measurement</p>' +
    '</div>';

    // =====================================================================
    // CLV OVERVIEW SECTION (Phase 5 — new)
    // =====================================================================
    if (clvData) {
      html += '<div class="admin-section"><h3 class="admin-section-title" style="color:#d4a843;">Closing Line Value (CLV)</h3>';
      html += '<p style="color:var(--text-muted,#888);font-size:12px;margin-bottom:12px;">CLV measures whether we get better odds than the market closing price. Positive CLV = genuine edge over bookmakers.</p>';

      // CLV stat cards
      html += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px;">';
      html += '<div class="stat-card"><div class="stat-value">' + (clvData.tipsWithClv || 0) + '</div><div class="stat-label">Tips with CLV Data</div></div>';

      var avgClvColor = clvData.avgClv > 0 ? 'var(--green,#16a34a)' : (clvData.avgClv < 0 ? 'var(--red,#dc2626)' : '#fff');
      html += '<div class="stat-card"><div class="stat-value" style="color:' + avgClvColor + ';">' + (clvData.avgClv !== null ? (clvData.avgClv > 0 ? '+' : '') + clvData.avgClv.toFixed(2) + '%' : '-') + '</div><div class="stat-label">Average CLV</div></div>';

      html += '<div class="stat-card"><div class="stat-value" style="color:var(--green,#16a34a);">' + (clvData.positiveClvCount || 0) + '</div><div class="stat-label">Positive CLV Tips</div></div>';
      html += '<div class="stat-card"><div class="stat-value" style="color:var(--red,#dc2626);">' + (clvData.negativeClvCount || 0) + '</div><div class="stat-label">Negative CLV Tips</div></div>';

      var positiveRate = clvData.positiveClvRate !== null ? clvData.positiveClvRate : 0;
      var rateColor = positiveRate >= 55 ? 'var(--green,#16a34a)' : (positiveRate >= 45 ? '#fbbf24' : 'var(--red,#dc2626)');
      html += '<div class="stat-card"><div class="stat-value" style="color:' + rateColor + ';">' + positiveRate + '%</div><div class="stat-label">Positive CLV Rate</div></div>';
      html += '</div>';

      // CLV by Sport
      if (clvData.bySport && Object.keys(clvData.bySport).length > 0) {
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">';
        html += '<div><h4 style="color:#d4a843;font-size:13px;margin-bottom:8px;">CLV by Sport</h4>';
        var sportKeys = Object.keys(clvData.bySport);
        sportKeys.forEach(function(sport) {
          var s = clvData.bySport[sport];
          var clvColor = s.avgClv > 0 ? 'var(--green,#16a34a)' : 'var(--red,#dc2626)';
          html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border,#2a2e3e);">';
          html += '<span style="text-transform:capitalize;">' + sport + ' (' + s.tips + ' tips)</span>';
          html += '<span style="color:' + clvColor + ';font-weight:700;">' + (s.avgClv > 0 ? '+' : '') + s.avgClv + '% CLV (' + s.positiveRate + '% positive)</span>';
          html += '</div>';
        });
        html += '</div>';

        // CLV by Analyst
        html += '<div><h4 style="color:#d4a843;font-size:13px;margin-bottom:8px;">CLV by Analyst</h4>';
        if (clvData.byAnalyst) {
          var analystKeys = Object.keys(clvData.byAnalyst);
          analystKeys.forEach(function(analyst) {
            var a = clvData.byAnalyst[analyst];
            var aClvColor = a.avgClv > 0 ? 'var(--green,#16a34a)' : 'var(--red,#dc2626)';
            html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border,#2a2e3e);">';
            html += '<span>' + analyst + ' (' + a.tips + ' tips)</span>';
            html += '<span style="color:' + aClvColor + ';font-weight:700;">' + (a.avgClv > 0 ? '+' : '') + a.avgClv + '% CLV</span>';
            html += '</div>';
          });
        }
        html += '</div></div>';
      }

      // CLV by Confidence Band
      if (clvData.byConfidence && Object.keys(clvData.byConfidence).length > 0) {
        html += '<h4 style="color:#d4a843;font-size:13px;margin-bottom:8px;">CLV by Confidence Band</h4>';
        html += '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Band</th><th>Tips</th><th>Avg CLV</th><th>Strike Rate</th></tr></thead><tbody>';
        Object.keys(clvData.byConfidence).forEach(function(band) {
          var b = clvData.byConfidence[band];
          var bClvColor = b.avgClv > 0 ? 'var(--green,#16a34a)' : 'var(--red,#dc2626)';
          html += '<tr><td>' + band + '</td><td>' + b.tips + '</td><td style="color:' + bClvColor + ';font-weight:700;">' + (b.avgClv > 0 ? '+' : '') + b.avgClv + '%</td><td>' + b.strikeRate + '%</td></tr>';
        });
        html += '</tbody></table></div>';
      }

      // Recent CLV trend
      if (clvData.recentTrend && clvData.recentTrend.length > 0) {
        html += '<h4 style="color:#d4a843;font-size:13px;margin:16px 0 8px;">Recent CLV (Last 20 Tips)</h4>';
        html += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">';
        clvData.recentTrend.forEach(function(t) {
          var color = t.clv > 0 ? 'var(--green,#16a34a)' : (t.clv < 0 ? 'var(--red,#dc2626)' : '#888');
          var label = t.clv !== null ? (t.clv > 0 ? '+' : '') + t.clv.toFixed(1) + '%' : '-';
          var resultDot = t.result === 'won' ? '#16a34a' : (t.result === 'placed' ? '#3b82f6' : '#dc2626');
          html += '<div style="background:var(--bg-elevated,#1a1e2e);border:1px solid var(--border,#2a2e3e);border-radius:6px;padding:6px 8px;font-size:11px;text-align:center;min-width:60px;" title="' + t.selection + ' @ ' + t.odds + '">';
          html += '<div style="width:6px;height:6px;border-radius:50%;background:' + resultDot + ';display:inline-block;margin-right:4px;"></div>';
          html += '<span style="color:' + color + ';font-weight:700;">' + label + '</span>';
          html += '</div>';
        });
        html += '</div>';
      }

      html += '</div>';
    }

    // =====================================================================
    // ENRICHMENT QUALITY LOOP (D5)
    // =====================================================================
    if (qualityData) {
      html += '<div class="admin-section"><h3 class="admin-section-title" style="color:#f59e0b;">Enrichment Quality Loop</h3>';
      html += '<p style="color:var(--text-muted,#888);font-size:12px;margin-bottom:12px;">Does Perplexity enrichment improve CLV and ROI? Per-signal baseline compares enriched-with-X vs enriched-without-X.</p>';

      // Per-sport aggregate cards
      if (qualityData.aggregates && qualityData.aggregates.length > 0) {
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-bottom:16px;">';
        qualityData.aggregates.forEach(function(agg) {
          var aggVColor = agg.verdict === 'Earning its keep' ? 'var(--green,#16a34a)' :
            agg.verdict === 'No benefit — consider disabling' ? 'var(--red,#dc2626)' :
            agg.verdict === 'Mixed signal' ? '#f59e0b' : '#888';
          html += '<div style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.2);border-radius:10px;padding:16px;">';
          html += '<div style="font-size:12px;color:var(--text-muted,#888);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">' + (agg.sport || 'All') + '</div>';
          html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:8px;">';
          html += '<div style="text-align:center;"><div style="font-size:10px;color:var(--text-muted,#888);">Enriched</div><div style="font-size:18px;font-weight:800;">' + agg.tipsWith + '</div></div>';
          html += '<div style="text-align:center;"><div style="font-size:10px;color:var(--text-muted,#888);">CLV</div><div style="font-size:18px;font-weight:800;color:' + (agg.avgClvWith > 0 ? 'var(--green,#16a34a)' : 'var(--red,#dc2626)') + ';">' + (agg.avgClvWith > 0 ? '+' : '') + agg.avgClvWith + '%</div></div>';
          html += '<div style="text-align:center;"><div style="font-size:10px;color:var(--text-muted,#888);">Baseline</div><div style="font-size:18px;font-weight:800;color:' + (agg.avgClvWithout > 0 ? 'var(--green,#16a34a)' : 'var(--red,#dc2626)') + ';">' + (agg.avgClvWithout > 0 ? '+' : '') + agg.avgClvWithout + '%</div></div>';
          html += '<div style="text-align:center;"><div style="font-size:10px;color:var(--text-muted,#888);">Delta</div><div style="font-size:18px;font-weight:800;color:' + (agg.clvDelta > 0 ? 'var(--green,#16a34a)' : agg.clvDelta < 0 ? 'var(--red,#dc2626)' : '#888') + ';">' + (agg.clvDelta > 0 ? '+' : '') + agg.clvDelta + '%</div></div>';
          html += '</div>';
          html += '<div style="text-align:center;font-size:13px;font-weight:700;color:' + aggVColor + ';">' + agg.verdict + '</div>';
          html += '</div>';
        });
        html += '</div>';
      } else {
        html += '<p style="color:var(--text-muted,#888);">No aggregate data yet — quality loop runs nightly at 3am UK.</p>';
      }

      // Per-signal table
      if (qualityData.signals && qualityData.signals.length > 0) {
        html += '<div class="admin-table-wrap"><table class="admin-table"><thead><tr>';
        html += '<th>Sport</th><th>Signal</th><th>Tips</th><th>Avg CLV</th><th>ROI</th><th>SR%</th>';
        html += '<th>Baseline CLV</th><th>Baseline ROI</th><th>CLV Delta</th><th>ROI Delta</th><th>Verdict</th>';
        html += '</tr></thead><tbody>';
        qualityData.signals.forEach(function(s) {
          var vColor = s.verdict === 'Earning its keep' ? 'var(--green,#16a34a)' :
            s.verdict === 'No benefit — consider disabling' ? 'var(--red,#dc2626)' :
            s.verdict === 'Mixed signal' ? '#f59e0b' :
            s.verdict === 'Inconclusive' ? '#888' : '#666';
          var dClvColor = s.clvDelta > 0 ? 'var(--green,#16a34a)' : s.clvDelta < 0 ? 'var(--red,#dc2626)' : '#888';
          var dRoiColor = s.roiDeltaPct > 0 ? 'var(--green,#16a34a)' : s.roiDeltaPct < 0 ? 'var(--red,#dc2626)' : '#888';
          html += '<tr>';
          html += '<td style="text-transform:capitalize;">' + (s.sport || '-') + '</td>';
          html += '<td><code>' + (s.signalKey || '-') + '</code></td>';
          html += '<td>' + s.tipsWith + '</td>';
          html += '<td style="color:' + (s.avgClvWith > 0 ? 'var(--green,#16a34a)' : 'var(--red,#dc2626)') + ';">' + (s.avgClvWith > 0 ? '+' : '') + s.avgClvWith + '%</td>';
          html += '<td>' + s.roiPctWith + '%</td>';
          html += '<td>' + s.strikeRateWith + '%</td>';
          html += '<td>' + (s.avgClvWithout > 0 ? '+' : '') + s.avgClvWithout + '%</td>';
          html += '<td>' + s.roiPctWithout + '%</td>';
          html += '<td style="color:' + dClvColor + ';font-weight:700;">' + (s.clvDelta > 0 ? '+' : '') + s.clvDelta + '%</td>';
          html += '<td style="color:' + dRoiColor + ';font-weight:700;">' + (s.roiDeltaPct > 0 ? '+' : '') + s.roiDeltaPct + '%</td>';
          html += '<td style="color:' + vColor + ';font-weight:700;">' + s.verdict + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div>';
      } else {
        html += '<p style="color:var(--text-muted,#888);font-size:13px;">No per-signal data yet. Signals will appear here once tips are settled with enrichment data.</p>';
      }

      html += '</div>';
    }

    // =====================================================================
    // EDGE VS RESULTS SECTION (Phase 5 — new)
    // =====================================================================
    if (edgeData) {
      html += '<div class="admin-section"><h3 class="admin-section-title" style="color:#3b82f6;">Edge vs Actual Results</h3>';
      html += '<p style="color:var(--text-muted,#888);font-size:12px;margin-bottom:12px;">Are higher-edge selections actually performing better? This validates the scoring model.</p>';

      // Edge bands table
      if (edgeData.edgeBands && edgeData.edgeBands.length > 0) {
        html += '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Edge Band</th><th>Tips</th><th>Wins</th><th>Strike Rate</th><th>Avg Edge</th><th>ROI</th></tr></thead><tbody>';
        edgeData.edgeBands.forEach(function(b) {
          var roiColor = b.roi > 0 ? 'var(--green,#16a34a)' : (b.roi < 0 ? 'var(--red,#dc2626)' : '#fff');
          html += '<tr><td>' + b.label + '</td><td>' + b.tips + '</td><td>' + b.wins + '</td><td>' + b.strikeRate + '%</td><td>' + b.avgEdge + '%</td><td style="color:' + roiColor + ';font-weight:700;">' + (b.roi > 0 ? '+' : '') + b.roi + '%</td></tr>';
        });
        html += '</tbody></table></div>';
      }

      // Model calibration
      if (edgeData.modelCalibration && edgeData.modelCalibration.length > 0) {
        html += '<h4 style="color:#3b82f6;font-size:13px;margin:16px 0 8px;">Model Calibration — Predicted vs Actual Win Rate</h4>';
        html += '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Probability Band</th><th>Tips</th><th>Expected Win Rate</th><th>Actual Win Rate</th><th>Calibration</th></tr></thead><tbody>';
        edgeData.modelCalibration.forEach(function(b) {
          var diff = b.actualWinRate - b.expectedRate;
          var calColor = Math.abs(diff) <= 5 ? 'var(--green,#16a34a)' : (Math.abs(diff) <= 10 ? '#fbbf24' : 'var(--red,#dc2626)');
          var calLabel = Math.abs(diff) <= 5 ? 'Well calibrated' : (diff > 0 ? 'Under-confident' : 'Over-confident');
          html += '<tr><td>' + b.label + '</td><td>' + b.tips + '</td><td>' + b.expectedRate + '%</td><td>' + b.actualWinRate + '%</td><td style="color:' + calColor + ';">' + calLabel + ' (' + (diff > 0 ? '+' : '') + diff + '%)</td></tr>';
        });
        html += '</tbody></table></div>';
      }

      html += '</div>';
    }

    // =====================================================================
    // ANALYST PERFORMANCE SNAPSHOTS (Phase 5 — new)
    // =====================================================================
    if (snapshots && snapshots.snapshots && snapshots.snapshots.length > 0) {
      html += '<div class="admin-section"><h3 class="admin-section-title" style="color:#22c55e;">Analyst Performance Trends</h3>';
      html += '<p style="color:var(--text-muted,#888);font-size:12px;margin-bottom:12px;">Daily snapshots showing how each analyst is performing over time.</p>';

      // Group by analyst
      var byAnalyst = {};
      snapshots.snapshots.forEach(function(s) {
        if (!byAnalyst[s.analystKey]) byAnalyst[s.analystKey] = [];
        byAnalyst[s.analystKey].push(s);
      });

      html += '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Analyst</th><th>Sport</th><th>Tips</th><th>Wins</th><th>Strike Rate</th><th>Avg Odds</th><th>P/L</th><th>Avg CLV</th><th>ROI</th></tr></thead><tbody>';
      Object.keys(byAnalyst).forEach(function(analyst) {
        var latest = byAnalyst[analyst][0]; // most recent snapshot
        var pnlColor = latest.totalPnl > 0 ? 'var(--green,#16a34a)' : (latest.totalPnl < 0 ? 'var(--red,#dc2626)' : '#fff');
        var clvColor = latest.avgClv && latest.avgClv > 0 ? 'var(--green,#16a34a)' : (latest.avgClv && latest.avgClv < 0 ? 'var(--red,#dc2626)' : '#888');
        var roiColor = latest.roiPercent > 0 ? 'var(--green,#16a34a)' : (latest.roiPercent < 0 ? 'var(--red,#dc2626)' : '#fff');
        html += '<tr>';
        html += '<td><strong>' + analyst + '</strong></td>';
        html += '<td>' + (latest.sport || 'all') + '</td>';
        html += '<td>' + latest.totalTips + '</td>';
        html += '<td>' + latest.wins + '</td>';
        html += '<td>' + (latest.strikeRate * 100).toFixed(1) + '%</td>';
        html += '<td>' + latest.avgOdds.toFixed(2) + '</td>';
        html += '<td style="color:' + pnlColor + ';font-weight:700;">' + (latest.totalPnl > 0 ? '+' : '') + latest.totalPnl.toFixed(2) + 'u</td>';
        html += '<td style="color:' + clvColor + ';">' + (latest.avgClv !== null ? (latest.avgClv > 0 ? '+' : '') + latest.avgClv.toFixed(2) + '%' : '-') + '</td>';
        html += '<td style="color:' + roiColor + ';font-weight:700;">' + (latest.roiPercent * 100).toFixed(1) + '%</td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';
      html += '</div>';
    }

    // =====================================================================
    // ORIGINAL ANALYTICS (existing)
    // =====================================================================

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
