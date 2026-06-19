/**
 * Elite Edge Sports Tips — Analytics Routes
 * CLV tracking, edge-vs-results analysis, analyst performance
 */

module.exports = function(deps) {
  const router = require('express').Router();
  const { db, authenticate, requireAdmin } = deps;

  // -------------------------------------------------------------------------
  // GET /api/analytics/clv — CLV summary across all settled tips
  // -------------------------------------------------------------------------
  router.get('/analytics/clv', authenticate, requireAdmin, async (req, res) => {
    try {
      const tips = await db.getTips({ status: 'settled' });
      const sport = req.query.sport || null;
      const analyst = req.query.analyst || null;
      const days = parseInt(req.query.days) || 90;

      const cutoff = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

      const filtered = tips.filter(function(t) {
        if (sport && t.sport !== sport) return false;
        if (analyst && t.tipsterProfile !== analyst) return false;
        var tipDate = t.date;
        if (tipDate && typeof tipDate !== 'string') {
          try { tipDate = new Date(tipDate).toISOString().split('T')[0]; } catch(e) { return false; }
        }
        if (tipDate && tipDate < cutoff) return false;
        return true;
      });

      // Overall CLV stats
      var tipsWithClv = filtered.filter(function(t) { return t.clvPercent !== null && t.clvPercent !== undefined; });
      var avgClv = tipsWithClv.length > 0
        ? tipsWithClv.reduce(function(sum, t) { return sum + t.clvPercent; }, 0) / tipsWithClv.length
        : null;
      var positiveClv = tipsWithClv.filter(function(t) { return t.clvPercent > 0; }).length;
      var negativeClv = tipsWithClv.filter(function(t) { return t.clvPercent < 0; }).length;

      // CLV by sport
      var bySport = {};
      tipsWithClv.forEach(function(t) {
        if (!bySport[t.sport]) bySport[t.sport] = { tips: 0, totalClv: 0, positive: 0 };
        bySport[t.sport].tips++;
        bySport[t.sport].totalClv += t.clvPercent;
        if (t.clvPercent > 0) bySport[t.sport].positive++;
      });
      Object.keys(bySport).forEach(function(s) {
        bySport[s].avgClv = Math.round((bySport[s].totalClv / bySport[s].tips) * 100) / 100;
        bySport[s].positiveRate = Math.round((bySport[s].positive / bySport[s].tips) * 100);
      });

      // CLV by analyst
      var byAnalyst = {};
      tipsWithClv.forEach(function(t) {
        var key = t.tipsterProfile || 'Unknown';
        if (!byAnalyst[key]) byAnalyst[key] = { tips: 0, totalClv: 0, positive: 0 };
        byAnalyst[key].tips++;
        byAnalyst[key].totalClv += t.clvPercent;
        if (t.clvPercent > 0) byAnalyst[key].positive++;
      });
      Object.keys(byAnalyst).forEach(function(a) {
        byAnalyst[a].avgClv = Math.round((byAnalyst[a].totalClv / byAnalyst[a].tips) * 100) / 100;
        byAnalyst[a].positiveRate = Math.round((byAnalyst[a].positive / byAnalyst[a].tips) * 100);
      });

      // CLV by confidence band
      var byConfidence = {};
      tipsWithClv.forEach(function(t) {
        var band = t.confidence >= 8 ? 'high (8-10)' : t.confidence >= 6 ? 'medium (6-7)' : 'low (1-5)';
        if (!byConfidence[band]) byConfidence[band] = { tips: 0, totalClv: 0, wins: 0 };
        byConfidence[band].tips++;
        byConfidence[band].totalClv += t.clvPercent;
        if (t.result === 'won' || t.result === 'placed') byConfidence[band].wins++;
      });
      Object.keys(byConfidence).forEach(function(b) {
        byConfidence[b].avgClv = Math.round((byConfidence[b].totalClv / byConfidence[b].tips) * 100) / 100;
        byConfidence[b].strikeRate = Math.round((byConfidence[b].wins / byConfidence[b].tips) * 100);
      });

      // Recent CLV trend (last 20 tips)
      var recentTrend = tipsWithClv
        .sort(function(a, b) { return (b.settledAt || b.createdAt || '') > (a.settledAt || a.createdAt || '') ? 1 : -1; })
        .slice(0, 20)
        .map(function(t) {
          return {
            selection: t.selection, sport: t.sport, odds: t.odds,
            advisedPrice: t.advisedPriceDecimal, closingPrice: t.closingPriceDecimal,
            clv: t.clvPercent, result: t.result, date: t.date,
          };
        });

      res.json({
        period: days + ' days',
        totalSettled: filtered.length,
        tipsWithClv: tipsWithClv.length,
        avgClv: avgClv !== null ? Math.round(avgClv * 100) / 100 : null,
        positiveClvCount: positiveClv,
        negativeClvCount: negativeClv,
        positiveClvRate: tipsWithClv.length > 0 ? Math.round((positiveClv / tipsWithClv.length) * 100) : null,
        bySport: bySport,
        byAnalyst: byAnalyst,
        byConfidence: byConfidence,
        recentTrend: recentTrend,
      });
    } catch (err) {
      console.error('[Analytics] CLV error:', err.message);
      res.status(500).json({ error: 'Failed to compute CLV analytics' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/analytics/clv-public — public-safe CLV proof (headline numbers only).
  // CLV is the gold-standard proof of edge: consistently beating the closing line
  // = genuine skill, not luck. Only published once there's a meaningful sample.
  // -------------------------------------------------------------------------
  router.get('/analytics/clv-public', async (req, res) => {
    try {
      const tips = await db.getTips({ status: 'settled' });
      // Combine published tips with our per-fixture model calls (match_predictions)
      // so the proof draws on the full body of calls, not just published tips.
      var records = tips
        .filter(function (t) { return t.clvPercent !== null && t.clvPercent !== undefined; })
        .map(function (t) { return { clv: t.clvPercent, sport: t.sport || 'other' }; });
      try {
        var mps = db.getMatchPredictions ? await db.getMatchPredictions() : [];
        mps.forEach(function (m) {
          var c = (m.clv_percent !== null && m.clv_percent !== undefined) ? parseFloat(m.clv_percent) : null;
          if (c !== null && !isNaN(c)) records.push({ clv: c, sport: 'football' });
        });
      } catch (e) { /* match_predictions CLV optional */ }

      const withClv = records;
      const n = withClv.length;
      const MIN_SAMPLE = 15; // don't publish numbers off a tiny sample
      if (n < MIN_SAMPLE) {
        return res.json({ ready: false, sample: n, minSample: MIN_SAMPLE });
      }
      const avgClv = withClv.reduce(function (s, t) { return s + t.clv; }, 0) / n;
      const positive = withClv.filter(function (t) { return t.clv > 0; }).length;
      // Per-sport beat rate (only sports with a decent sample)
      const bySport = {};
      withClv.forEach(function (t) {
        if (!bySport[t.sport]) bySport[t.sport] = { n: 0, pos: 0, total: 0 };
        bySport[t.sport].n++; bySport[t.sport].total += t.clv;
        if (t.clv > 0) bySport[t.sport].pos++;
      });
      const sports = Object.keys(bySport).filter(function (s) { return bySport[s].n >= 8; }).map(function (s) {
        return { sport: s, sample: bySport[s].n, beatRate: Math.round((bySport[s].pos / bySport[s].n) * 100), avgClv: Math.round((bySport[s].total / bySport[s].n) * 100) / 100 };
      });
      res.json({
        ready: true,
        sample: n,
        avgClv: Math.round(avgClv * 100) / 100,
        beatRate: Math.round((positive / n) * 100),
        bySport: sports,
      });
    } catch (err) {
      console.error('[Analytics] CLV public error:', err.message);
      res.status(500).json({ error: 'CLV unavailable' });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/analytics/clv/backfill — compute CLV for already-settled tips that
  // have tracked price history but no CLV yet (settlement used to ignore it).
  // Grows the Proof-of-Edge sample from data we already captured. Idempotent.
  // -------------------------------------------------------------------------
  router.post('/analytics/clv/backfill', authenticate, requireAdmin, async (req, res) => {
    try {
      const tips = await db.getTips({ status: 'settled' });
      const todo = tips.filter(function (t) { return (t.clvPercent === null || t.clvPercent === undefined) && (t.advisedPriceDecimal || t.odds); });
      var updated = 0, noHistory = 0;
      for (var i = 0; i < todo.length; i++) {
        var t = todo[i];
        var hist = await db.getPriceHistory(t.id);
        if (!hist || !hist.length) { noHistory++; continue; }
        var closing = hist[hist.length - 1].priceDecimal;
        var advised = t.advisedPriceDecimal || t.odds;
        if (closing > 1 && advised > 1) {
          var clv = ((1 / closing - 1 / advised) / (1 / advised)) * 100;
          await db.updateTip(t.id, { closingPriceDecimal: Math.round(closing * 100) / 100, clvPercent: Math.round(clv * 100) / 100 });
          updated++;
        }
      }
      res.json({ ok: true, candidates: todo.length, updated: updated, noPriceHistory: noHistory });
    } catch (err) {
      console.error('[Analytics] CLV backfill error:', err.message);
      res.status(500).json({ error: 'CLV backfill failed: ' + err.message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/analytics/calibration — Brier score, reliability curve, confidence
  // ordering and a backtest by odds band. Pure measurement (admin only).
  // -------------------------------------------------------------------------
  router.get('/analytics/calibration', authenticate, requireAdmin, async (req, res) => {
    try {
      var calibration = require('../services/calibrationEngine');
      var days = parseInt(req.query.days) || 90;
      var cutoff = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
      var tips = await db.getTips({ status: 'settled' });
      var filtered = tips.filter(function (t) {
        var d = t.date;
        if (d && typeof d !== 'string') { try { d = new Date(d).toISOString().split('T')[0]; } catch (e) { return false; } }
        if (req.query.sport && t.sport !== req.query.sport) return false;
        return !(d && d < cutoff);
      });
      res.json(Object.assign({ period: days + ' days' }, calibration.analyse(filtered, { minSample: 10 })));
    } catch (err) {
      console.error('[Analytics] calibration error:', err.message);
      res.status(500).json({ error: 'Failed to compute calibration' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/analytics/edge-vs-results — compare predicted edge to actual
  // -------------------------------------------------------------------------
  router.get('/analytics/edge-vs-results', authenticate, requireAdmin, async (req, res) => {
    try {
      const tips = await db.getTips({ status: 'settled' });
      const results = await db.getResults();
      const days = parseInt(req.query.days) || 90;
      const cutoff = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

      // Build result lookup by tipId
      var resultMap = {};
      results.forEach(function(r) { if (r.tipId) resultMap[r.tipId] = r; });

      var settledTips = tips.filter(function(t) {
        var d = t.date;
        if (d && typeof d !== 'string') {
          try { d = new Date(d).toISOString().split('T')[0]; } catch(e) { return false; }
        }
        return d >= cutoff && t.result && t.result !== 'void';
      });

      // Edge bands: 0-5%, 5-10%, 10-15%, 15%+
      var edgeBands = [
        { label: '0-5%', min: 0, max: 0.05, tips: 0, wins: 0, totalPnl: 0, totalEdge: 0 },
        { label: '5-10%', min: 0.05, max: 0.10, tips: 0, wins: 0, totalPnl: 0, totalEdge: 0 },
        { label: '10-15%', min: 0.10, max: 0.15, tips: 0, wins: 0, totalPnl: 0, totalEdge: 0 },
        { label: '15%+', min: 0.15, max: 1.0, tips: 0, wins: 0, totalPnl: 0, totalEdge: 0 },
      ];

      settledTips.forEach(function(t) {
        var edge = t.edge || 0;
        var won = t.result === 'won' || t.result === 'placed';
        var r = resultMap[t.id];
        var pnl = r ? r.pnl : 0;

        for (var i = 0; i < edgeBands.length; i++) {
          if (edge >= edgeBands[i].min && edge < edgeBands[i].max) {
            edgeBands[i].tips++;
            if (won) edgeBands[i].wins++;
            edgeBands[i].totalPnl += pnl;
            edgeBands[i].totalEdge += edge;
            break;
          }
        }
      });

      edgeBands.forEach(function(b) {
        b.strikeRate = b.tips > 0 ? Math.round((b.wins / b.tips) * 100) : 0;
        b.avgEdge = b.tips > 0 ? Math.round((b.totalEdge / b.tips) * 10000) / 100 : 0;
        b.roi = b.tips > 0 ? Math.round((b.totalPnl / (b.tips * 2)) * 10000) / 100 : 0; // assume 2u avg stake
      });

      // Scatter data: edge vs actual PnL per tip
      var scatter = settledTips.slice(0, 100).map(function(t) {
        var r = resultMap[t.id];
        return {
          selection: t.selection, sport: t.sport,
          edge: Math.round((t.edge || 0) * 10000) / 100,
          confidence: t.confidence,
          odds: t.odds,
          pnl: r ? r.pnl : 0,
          result: t.result,
          clv: t.clvPercent,
        };
      });

      // Model calibration: compare model probability vs actual win rate by probability band
      var probBands = [
        { label: '20-30%', min: 0.20, max: 0.30, tips: 0, wins: 0 },
        { label: '30-40%', min: 0.30, max: 0.40, tips: 0, wins: 0 },
        { label: '40-50%', min: 0.40, max: 0.50, tips: 0, wins: 0 },
        { label: '50-60%', min: 0.50, max: 0.60, tips: 0, wins: 0 },
        { label: '60%+', min: 0.60, max: 1.0, tips: 0, wins: 0 },
      ];

      settledTips.forEach(function(t) {
        var prob = t.modelProbability || 0;
        var won = t.result === 'won' || t.result === 'placed';
        for (var i = 0; i < probBands.length; i++) {
          if (prob >= probBands[i].min && prob < probBands[i].max) {
            probBands[i].tips++;
            if (won) probBands[i].wins++;
            break;
          }
        }
      });

      probBands.forEach(function(b) {
        b.actualWinRate = b.tips > 0 ? Math.round((b.wins / b.tips) * 100) : 0;
        b.expectedRate = Math.round(((b.min + b.max) / 2) * 100);
      });

      res.json({
        period: days + ' days',
        totalSettled: settledTips.length,
        edgeBands: edgeBands,
        modelCalibration: probBands,
        scatter: scatter,
      });
    } catch (err) {
      console.error('[Analytics] Edge-vs-results error:', err.message);
      res.status(500).json({ error: 'Failed to compute edge analytics' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/analytics/price-history/:tipId — price movement for a specific tip
  // -------------------------------------------------------------------------
  router.get('/analytics/price-history/:tipId', authenticate, async (req, res) => {
    try {
      const history = await db.getPriceHistory(req.params.tipId);
      const tip = await db.getTipById(req.params.tipId);
      res.json({
        tipId: req.params.tipId,
        selection: tip ? tip.selection : null,
        advisedPrice: tip ? tip.advisedPriceDecimal : null,
        closingPrice: tip ? tip.closingPriceDecimal : null,
        clv: tip ? tip.clvPercent : null,
        snapshots: history,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch price history' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/analytics/analyst-snapshots — historical analyst performance
  // -------------------------------------------------------------------------
  router.get('/analytics/analyst-snapshots', authenticate, requireAdmin, async (req, res) => {
    try {
      const analyst = req.query.analyst || null;
      const limit = parseInt(req.query.limit) || 30;
      const snapshots = await db.getAnalystSnapshots(analyst, limit);
      res.json({ snapshots: snapshots });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch analyst snapshots' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/analytics/quality-loop — enrichment quality snapshots
  // -------------------------------------------------------------------------
  router.get('/analytics/quality-loop', authenticate, requireAdmin, async (req, res) => {
    try {
      var snapshots = await db.getLatestQualitySnapshot();
      var aggregates = snapshots.filter(function(s) { return s.isAggregate; });
      var signals = snapshots.filter(function(s) { return !s.isAggregate; });
      res.json({ aggregates: aggregates, signals: signals });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch quality-loop data' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/analytics/shadow-scoring — all scored candidates + stats
  // -------------------------------------------------------------------------
  router.get('/analytics/shadow-scoring', authenticate, requireAdmin, async (req, res) => {
    try {
      var days = parseInt(req.query.days) || 7;
      var sport = req.query.sport || null;
      var date = req.query.date || null;
      var filters = { settled: undefined };
      if (sport) filters.sport = sport;
      if (date) filters.date = date;
      var candidates = await db.getScoredCandidates(filters);
      var stats = await db.getCandidateStats(days);
      res.json({ candidates: candidates, stats: stats });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch shadow scoring data' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/analytics/selection-outcome/:selection — check if a specific selection won
  // -------------------------------------------------------------------------
  router.get('/analytics/selection-outcome', async (req, res) => {
    try {
      var selection = req.query.selection || '';
      var date = req.query.date || new Date().toISOString().split('T')[0];
      if (!selection) return res.status(400).json({ error: 'Selection required' });

      // Check scored candidates first
      var candidates = await db.getScoredCandidates({ date: date });
      var match = candidates.find(function(c) {
        return c.selection.toLowerCase() === selection.toLowerCase();
      });

      if (match) {
        return res.json({
          found: true, selection: match.selection, event: match.event,
          market: match.market, odds: match.odds, result: match.result,
          settled: match.settled, wasPublished: match.wasPublished,
          confidence: match.confidence, edge: match.edge,
        });
      }

      // Check published results
      var results = await db.getResults({ date: date });
      var resultMatch = results.find(function(r) {
        return r.selection.toLowerCase() === selection.toLowerCase();
      });

      if (resultMatch) {
        return res.json({
          found: true, selection: resultMatch.selection, event: resultMatch.event,
          market: resultMatch.market, odds: resultMatch.odds, result: resultMatch.result,
          settled: true, wasPublished: true, pnl: resultMatch.pnl,
        });
      }

      res.json({ found: false, selection: selection, date: date });
    } catch (err) {
      res.status(500).json({ error: 'Failed to check selection outcome' });
    }
  });

  return router;
};
