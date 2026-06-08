/**
 * Elite Edge Sports Tips — Last Man Standing routes
 *
 * Pluggable, feature-flagged (ENABLE_LMS). Mounted at /api/lms in index.js
 * only when the flag is on. Self-contained: all LMS Stripe handling lives here
 * so core stripe.js is never touched.
 *
 * Factory receives the shared deps object.
 */

const lmsStore = require('../db/lmsStore');
const lms = require('../services/lmsService');

const EXTRA_TEAM_PRICE_PENCE = 1000; // £10
const MAX_EXTRA_TEAMS = 2;

module.exports = function (deps) {
  const { db, authenticate, requireAdmin, stripeService, emailService } = deps;
  const router = require('express').Router();

  // ---- access helpers -------------------------------------------------------
  function isSubscriber(user) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (user.trialActive) return true;
    return ['premium', 'vip', 'starter'].indexOf(user.subscription) !== -1;
  }
  function canAccess(competition, user) {
    if (competition.access === 'everyone') return true;
    return isSubscriber(user); // 'subscriber'
  }
  function guard(req, res) {
    if (!lmsStore.available()) {
      res.status(503).json({ error: 'Last Man Standing requires the database and is not available right now.' });
      return false;
    }
    return true;
  }

  async function buildEntryView(competition, userId) {
    const entry = await lmsStore.getEntry(competition.id, userId);
    if (!entry) return { joined: false };
    const picks = await lmsStore.getPicksForEntry(entry.id);
    const currentPick = picks.find(function (p) { return p.round === competition.currentRound; }) || null;
    const usedTeams = picks
      .filter(function (p) { return p.result !== 'void' && p.round !== competition.currentRound; })
      .map(function (p) { return p.team; });
    const purchased = await lmsStore.countPaidPurchases(competition.id, userId);
    const rolloverActive = lms.extraTeamsAllowed(competition);
    return {
      joined: true,
      status: entry.status,
      extraTeams: entry.extraTeams,
      reusesUsed: entry.reusesUsed,
      allowancesLeft: Math.max(0, (entry.extraTeams || 0) - (entry.reusesUsed || 0)),
      picks: picks.map(function (p) {
        return { round: p.round, roundLabel: lms.roundLabel(competition.phase, p.round), team: p.team, result: p.result, isReuse: p.isReuse };
      }),
      currentPick: currentPick ? { team: currentPick.team, result: currentPick.result, isReuse: currentPick.isReuse } : null,
      usedTeams: usedTeams,
      purchasedExtraTeams: purchased,
      // Extra teams only sold in a rollover situation (and up to the per-person cap)
      extraTeamsAllowed: rolloverActive,
      canBuyExtra: rolloverActive && purchased < MAX_EXTRA_TEAMS,
    };
  }

  // ===========================================================================
  // PUBLIC / SUBSCRIBER
  // ===========================================================================

  // GET /api/lms/competitions — list joinable/active competitions
  router.get('/competitions', authenticate, async function (req, res) {
    if (!guard(req, res)) return;
    try {
      const open = await lmsStore.getCompetitions();
      const list = [];
      for (let i = 0; i < open.length; i++) {
        const c = open[i];
        if (c.status === 'completed' && !req.query.includeCompleted) continue;
        const aliveCount = await lmsStore.countAlive(c.id);
        const myEntry = await lmsStore.getEntry(c.id, req.user.id);
        list.push({
          id: c.id, name: c.name, phase: c.phase, status: c.status, access: c.access,
          currentRound: c.currentRound, roundLabel: lms.roundLabel(c.phase, c.currentRound),
          prizePot: c.prizePot, aliveCount: aliveCount,
          joined: !!myEntry, myStatus: myEntry ? myEntry.status : null,
          canAccess: canAccess(c, req.user),
        });
      }
      res.json({ competitions: list });
    } catch (e) {
      console.error('[LMS] list error:', e.message);
      res.status(500).json({ error: 'Could not load competitions' });
    }
  });

  // GET /api/lms/competitions/:id — full detail for the current user
  router.get('/competitions/:id', authenticate, async function (req, res) {
    if (!guard(req, res)) return;
    try {
      const c = await lmsStore.getCompetitionById(req.params.id);
      if (!c) return res.status(404).json({ error: 'Competition not found' });
      const aliveCount = await lmsStore.countAlive(c.id);
      const me = await buildEntryView(c, req.user.id);
      // Team list for WC pick selection
      let teams = [];
      if (c.phase === 'world_cup') teams = await lmsStore.getWcTeams();
      res.json({
        competition: {
          id: c.id, name: c.name, phase: c.phase, status: c.status, access: c.access,
          currentRound: c.currentRound, roundLabel: lms.roundLabel(c.phase, c.currentRound),
          prizePot: c.prizePot, totalRounds: c.phase === 'world_cup' ? lms.WC_TOTAL_ROUNDS : null,
          rollovers: (c.config && c.config.rollovers) || [],
        },
        aliveCount: aliveCount,
        canAccess: canAccess(c, req.user),
        canPick: me.joined && me.status === 'alive' && c.status !== 'completed'
          && (!me.currentPick || me.currentPick.result === 'pending'),
        me: me,
        teams: teams,
        extraTeam: { pricePence: EXTRA_TEAM_PRICE_PENCE, priceLabel: '£10', max: MAX_EXTRA_TEAMS },
      });
    } catch (e) {
      console.error('[LMS] detail error:', e.message);
      res.status(500).json({ error: 'Could not load competition' });
    }
  });

  // POST /api/lms/competitions/:id/join
  router.post('/competitions/:id/join', authenticate, async function (req, res) {
    if (!guard(req, res)) return;
    try {
      const c = await lmsStore.getCompetitionById(req.params.id);
      if (!c) return res.status(404).json({ error: 'Competition not found' });
      if (c.status === 'completed') return res.status(400).json({ error: 'This competition has finished' });
      if (!canAccess(c, req.user)) {
        return res.status(403).json({ error: 'This competition is for subscribers. Start a subscription to join.', upgrade: true });
      }
      // Entries lock once the competition has moved past round 1 (no late joiners
      // mid-game), unless it's a PL rollover phase that explicitly allows carry-over.
      if (c.status === 'active' && c.currentRound > 1 && c.phase === 'world_cup') {
        return res.status(400).json({ error: 'Entries are closed — the competition is already underway.' });
      }
      const existing = await lmsStore.getEntry(c.id, req.user.id);
      if (existing) return res.json({ ok: true, alreadyJoined: true });
      await lmsStore.createEntry({ competitionId: c.id, userId: req.user.id });
      console.log('[LMS] ' + req.user.email + ' joined competition ' + c.id + ' (' + c.name + ')');
      res.json({ ok: true });
    } catch (e) {
      console.error('[LMS] join error:', e.message);
      res.status(500).json({ error: 'Could not join' });
    }
  });

  // POST /api/lms/competitions/:id/pick  { team }
  router.post('/competitions/:id/pick', authenticate, async function (req, res) {
    if (!guard(req, res)) return;
    try {
      const c = await lmsStore.getCompetitionById(req.params.id);
      if (!c) return res.status(404).json({ error: 'Competition not found' });
      if (c.status === 'completed') return res.status(400).json({ error: 'This competition has finished' });
      const team = (req.body && req.body.team || '').trim();
      const result = await lms.makePick(c, req.user.id, team);
      if (!result.ok) return res.status(400).json({ error: result.reason });
      res.json({ ok: true, changed: !!result.changed, team: team, round: c.currentRound });
    } catch (e) {
      console.error('[LMS] pick error:', e.message);
      res.status(500).json({ error: 'Could not save pick' });
    }
  });

  // GET /api/lms/competitions/:id/standings — leaderboard
  router.get('/competitions/:id/standings', authenticate, async function (req, res) {
    if (!guard(req, res)) return;
    try {
      const c = await lmsStore.getCompetitionById(req.params.id);
      if (!c) return res.status(404).json({ error: 'Competition not found' });
      const entries = await lmsStore.getEntriesForCompetition(c.id);
      const users = await db.getUsers();
      const byId = {};
      users.forEach(function (u) { byId[u.id] = u; });
      const rows = [];
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const picks = await lmsStore.getPicksForEntry(e.id);
        const u = byId[e.userId];
        rows.push({
          name: u ? (u.name || 'Player') : 'Player',
          status: e.status,
          roundsSurvived: picks.filter(function (p) { return p.result === 'won'; }).length,
          eliminatedRound: e.eliminatedRound,
          isMe: e.userId === req.user.id,
          // Reveal current pick only after settlement to avoid copying
          lastTeam: picks.length ? picks[picks.length - 1].team : null,
        });
      }
      rows.sort(function (a, b) {
        if (a.status === b.status) return b.roundsSurvived - a.roundsSurvived;
        return a.status === 'alive' || a.status === 'winner' ? -1 : 1;
      });
      res.json({ standings: rows, aliveCount: rows.filter(function (r) { return r.status === 'alive'; }).length });
    } catch (e) {
      console.error('[LMS] standings error:', e.message);
      res.status(500).json({ error: 'Could not load standings' });
    }
  });

  // ===========================================================================
  // EXTRA-TEAM PURCHASE (£10 one-time, self-contained Stripe flow)
  // ===========================================================================

  // POST /api/lms/competitions/:id/buy-team — start checkout
  router.post('/competitions/:id/buy-team', authenticate, async function (req, res) {
    if (!guard(req, res)) return;
    try {
      if (!stripeService || !stripeService.isAvailable) return res.status(503).json({ error: 'Payment system not configured' });
      const c = await lmsStore.getCompetitionById(req.params.id);
      if (!c) return res.status(404).json({ error: 'Competition not found' });
      if (c.status === 'completed') return res.status(400).json({ error: 'This competition has finished' });

      const entry = await lmsStore.getEntry(c.id, req.user.id);
      if (!entry) return res.status(400).json({ error: 'Join the competition first' });

      // Extra teams are only sold in a rollover situation.
      if (!lms.extraTeamsAllowed(c)) {
        return res.status(400).json({ error: 'Extra teams are only available once the competition has rolled over.' });
      }

      const purchased = await lmsStore.countPaidPurchases(c.id, req.user.id);
      if (purchased >= MAX_EXTRA_TEAMS) {
        return res.status(400).json({ error: 'You have reached the maximum of ' + MAX_EXTRA_TEAMS + ' extra teams.' });
      }

      const baseUrl = req.headers.origin || req.protocol + '://' + req.get('host');
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: req.user.email,
        metadata: { type: 'lms_extra_team', userId: req.user.id, competitionId: String(c.id) },
        line_items: [{
          price_data: {
            currency: 'gbp',
            product_data: { name: 'Last Man Standing — Extra Team (' + c.name + ')' },
            unit_amount: EXTRA_TEAM_PRICE_PENCE,
          },
          quantity: 1,
        }],
        success_url: baseUrl + '/api/lms/buy-team-success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: baseUrl + '/#/last-man-standing',
      });

      // Record a pending purchase keyed by session for idempotent settlement
      await lmsStore.createPurchase({
        competitionId: c.id, userId: req.user.id, amount: EXTRA_TEAM_PRICE_PENCE / 100,
        stripeSessionId: session.id, status: 'pending',
      });

      res.json({ url: session.url });
    } catch (e) {
      console.error('[LMS] buy-team error:', e.message);
      res.status(500).json({ error: 'Could not start checkout' });
    }
  });

  // GET /api/lms/buy-team-success — Stripe redirect target (no auth; verified via session)
  router.get('/buy-team-success', async function (req, res) {
    try {
      const sessionId = req.query.session_id;
      if (!sessionId) return res.redirect('/#/last-man-standing?error=missing_session');
      if (!stripeService || !stripeService.isAvailable) return res.redirect('/#/last-man-standing?error=unavailable');

      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (!session || session.payment_status !== 'paid') return res.redirect('/#/last-man-standing?error=payment_incomplete');

      // Idempotency — only process a pending purchase once
      const purchase = await lmsStore.getPurchaseBySession(sessionId);
      if (!purchase) return res.redirect('/#/last-man-standing?error=unknown_purchase');
      if (purchase.status === 'paid') return res.redirect('/#/last-man-standing?extra_team=already');

      const competitionId = session.metadata && session.metadata.competitionId;
      const userId = session.metadata && session.metadata.userId;
      const entry = await lmsStore.getEntry(competitionId, userId);
      if (!entry) return res.redirect('/#/last-man-standing?error=no_entry');

      await lmsStore.updatePurchase(purchase.id, { status: 'paid' });
      await lmsStore.incrementExtraTeams(entry.id, 1);
      await lmsStore.addToPot(competitionId, EXTRA_TEAM_PRICE_PENCE / 100);

      console.log('[LMS] Extra team purchased by user ' + userId + ' for competition ' + competitionId + ' (+£10 to pot)');
      res.redirect('/#/last-man-standing?extra_team=added');
    } catch (e) {
      console.error('[LMS] buy-team-success error:', e.message);
      res.redirect('/#/last-man-standing?error=processing');
    }
  });

  // ===========================================================================
  // ADMIN
  // ===========================================================================

  // POST /api/lms/admin/competitions — create
  router.post('/admin/competitions', authenticate, requireAdmin, async function (req, res) {
    if (!guard(req, res)) return;
    try {
      const b = req.body || {};
      if (!b.name || !b.phase) return res.status(400).json({ error: 'name and phase are required' });
      if (['world_cup', 'pl_rollover'].indexOf(b.phase) === -1) return res.status(400).json({ error: 'Invalid phase' });
      const c = await lmsStore.createCompetition({
        name: b.name, phase: b.phase,
        status: b.status || 'open',
        access: b.access || (b.phase === 'pl_rollover' ? 'everyone' : 'subscriber'),
        currentRound: 1,
        basePrize: b.basePrize || (b.phase === 'world_cup' ? 250 : 0),
        prizePot: b.basePrize || (b.phase === 'world_cup' ? 250 : 0),
        config: b.config || {},
      });
      res.json({ ok: true, competition: c });
    } catch (e) {
      console.error('[LMS] admin create error:', e.message);
      res.status(500).json({ error: 'Could not create competition' });
    }
  });

  // PUT /api/lms/admin/competitions/:id — update (status, name, round, access, pot)
  router.put('/admin/competitions/:id', authenticate, requireAdmin, async function (req, res) {
    if (!guard(req, res)) return;
    try {
      const c = await lmsStore.getCompetitionById(req.params.id);
      if (!c) return res.status(404).json({ error: 'Competition not found' });
      const b = req.body || {};
      const fields = {};
      ['name', 'status', 'access', 'currentRound', 'basePrize'].forEach(function (k) {
        if (b[k] !== undefined) fields[k] = b[k];
      });
      const updated = await lmsStore.updateCompetition(c.id, fields);
      res.json({ ok: true, competition: updated });
    } catch (e) {
      console.error('[LMS] admin update error:', e.message);
      res.status(500).json({ error: 'Could not update competition' });
    }
  });

  // POST /api/lms/admin/competitions/:id/settle — settle current round
  router.post('/admin/competitions/:id/settle', authenticate, requireAdmin, async function (req, res) {
    if (!guard(req, res)) return;
    try {
      const c = await lmsStore.getCompetitionById(req.params.id);
      if (!c) return res.status(404).json({ error: 'Competition not found' });
      const force = !!(req.body && req.body.force);
      const report = await lms.settleRound(c, { force: force });
      res.json({ ok: true, report: report });
    } catch (e) {
      console.error('[LMS] admin settle error:', e.message);
      res.status(500).json({ error: 'Could not settle round' });
    }
  });

  // POST /api/lms/admin/picks/:pickId/result  { result } — manual override
  // For penalty shootouts and PL fixtures the admin confirms won/lost.
  router.post('/admin/picks/:pickId/result', authenticate, requireAdmin, async function (req, res) {
    if (!guard(req, res)) return;
    try {
      const result = (req.body && req.body.result || '').toLowerCase();
      if (['won', 'lost', 'void', 'pending'].indexOf(result) === -1) {
        return res.status(400).json({ error: 'result must be won, lost, void or pending' });
      }
      const updated = await lmsStore.updatePick(req.params.pickId, {
        result: result, settledAt: new Date().toISOString(),
      });
      if (!updated) return res.status(404).json({ error: 'Pick not found' });
      res.json({ ok: true, pick: updated });
    } catch (e) {
      console.error('[LMS] admin pick result error:', e.message);
      res.status(500).json({ error: 'Could not update pick' });
    }
  });

  // GET /api/lms/admin/competitions/:id/entries — full admin view
  router.get('/admin/competitions/:id/entries', authenticate, requireAdmin, async function (req, res) {
    if (!guard(req, res)) return;
    try {
      const c = await lmsStore.getCompetitionById(req.params.id);
      if (!c) return res.status(404).json({ error: 'Competition not found' });
      const entries = await lmsStore.getEntriesForCompetition(c.id);
      const users = await db.getUsers();
      const byId = {};
      users.forEach(function (u) { byId[u.id] = u; });
      const out = [];
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const picks = await lmsStore.getPicksForEntry(e.id);
        const u = byId[e.userId];
        out.push({
          entryId: e.id,
          name: u ? u.name : 'Player', email: u ? u.email : null,
          status: e.status, extraTeams: e.extraTeams, eliminatedRound: e.eliminatedRound,
          picks: picks.map(function (p) {
            return { pickId: p.id, round: p.round, roundLabel: lms.roundLabel(c.phase, p.round), team: p.team, result: p.result, isReuse: p.isReuse };
          }),
        });
      }
      res.json({
        competition: { id: c.id, name: c.name, phase: c.phase, status: c.status, currentRound: c.currentRound, roundLabel: lms.roundLabel(c.phase, c.currentRound), prizePot: c.prizePot },
        entries: out,
      });
    } catch (e) {
      console.error('[LMS] admin entries error:', e.message);
      res.status(500).json({ error: 'Could not load entries' });
    }
  });

  return router;
};
