/**
 * Sporting Events — reusable "featured meeting" hubs.
 *
 * Replaces the one-off World Cup hub with a managed calendar: admin adds the big
 * meetings (Goodwood, football season kick-off, York Ebor, …), and the site
 * spotlights the active/next one and renders a hub page per event. Fully
 * isolated — does not touch the tipping engine.
 */
'use strict';

module.exports = function (deps) {
  var router = require('express').Router();
  var db = deps.db;
  var authenticate = deps.authenticate;
  var requireAdmin = deps.requireAdmin;

  function rowOut(r) {
    return {
      id: r.id, slug: r.slug, name: r.name, sport: r.sport, tagline: r.tagline,
      blurb: r.blurb, startDate: r.start_date, endDate: r.end_date, venue: r.venue,
      accent: r.accent || '#d4a843', emoji: r.emoji || '🏆', enabled: r.enabled,
    };
  }

  // Status relative to today: 'live' | 'upcoming' | 'past'.
  function statusOf(ev) {
    var today = new Date().toISOString().slice(0, 10);
    var s = String(ev.startDate).slice(0, 10), e = String(ev.endDate).slice(0, 10);
    if (today < s) return 'upcoming';
    if (today > e) return 'past';
    return 'live';
  }

  // GET /api/events — public: enabled events (live + upcoming first), for the
  // calendar strip + spotlight. Past events drop off after their end date.
  router.get('/events', async function (req, res) {
    try {
      if (!db || !db.query) return res.json({ events: [] });
      var { rows } = await db.query(
        "SELECT * FROM sporting_events WHERE enabled = TRUE AND end_date >= CURRENT_DATE - INTERVAL '2 days' ORDER BY start_date ASC"
      );
      var events = (rows || []).map(rowOut).map(function (e) { return Object.assign(e, { status: statusOf(e) }); });
      res.json({ events: events });
    } catch (err) { res.status(500).json({ error: 'Failed to load events' }); }
  });

  // GET /api/events/spotlight — the single event to feature right now: a live one
  // if any, else the soonest upcoming within 21 days. Null if nothing to show.
  router.get('/events/spotlight', async function (req, res) {
    try {
      if (!db || !db.query) return res.json({ event: null });
      var { rows } = await db.query(
        "SELECT * FROM sporting_events WHERE enabled = TRUE AND end_date >= CURRENT_DATE ORDER BY start_date ASC"
      );
      var events = (rows || []).map(rowOut).map(function (e) { return Object.assign(e, { status: statusOf(e), daysToStart: Math.ceil((new Date(String(e.startDate).slice(0, 10)) - new Date(new Date().toISOString().slice(0, 10))) / 86400000) }); });
      var live = events.filter(function (e) { return e.status === 'live'; });
      var soon = events.filter(function (e) { return e.status === 'upcoming' && e.daysToStart <= 21; });
      res.json({ event: live[0] || soon[0] || null });
    } catch (err) { res.status(500).json({ error: 'Failed to load spotlight' }); }
  });

  // GET /api/events/:slug — public: a single event hub's detail.
  router.get('/events/:slug', async function (req, res) {
    try {
      if (!db || !db.query) return res.status(404).json({ error: 'Not found' });
      var { rows } = await db.query('SELECT * FROM sporting_events WHERE slug = $1 AND enabled = TRUE LIMIT 1', [req.params.slug]);
      if (!rows.length) return res.status(404).json({ error: 'Event not found' });
      var ev = Object.assign(rowOut(rows[0]), { status: statusOf(rowOut(rows[0])) });
      res.json({ event: ev });
    } catch (err) { res.status(500).json({ error: 'Failed to load event' }); }
  });

  // ---- Admin: manage the calendar ------------------------------------------

  // GET /api/events/admin/all — every event incl. disabled/past.
  router.get('/events/admin/all', authenticate, requireAdmin, async function (req, res) {
    try {
      var { rows } = await db.query('SELECT * FROM sporting_events ORDER BY start_date DESC');
      res.json({ events: (rows || []).map(rowOut).map(function (e) { return Object.assign(e, { status: statusOf(e) }); }) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  function slugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60); }
  // Accent must be a hex colour (it lands inside a style attribute) — reject
  // anything else to close the stored-XSS vector. Emoji: strip HTML-significant
  // chars (it's rendered raw as an icon) and cap length.
  function cleanAccent(a) { return /^#[0-9a-fA-F]{3,8}$/.test(String(a || '')) ? a : '#d4a843'; }
  function cleanEmoji(e) { return String(e || '🏆').replace(/[<>"'&]/g, '').slice(0, 8) || '🏆'; }

  // POST /api/events/admin/save — create or update (by id).
  router.post('/events/admin/save', authenticate, requireAdmin, async function (req, res) {
    try {
      var b = req.body || {};
      if (!b.name || !b.startDate || !b.endDate) return res.status(400).json({ error: 'name, startDate and endDate are required' });
      var slug = b.slug ? slugify(b.slug) : slugify(b.name);
      var accent = cleanAccent(b.accent), emoji = cleanEmoji(b.emoji);
      if (b.id) {
        await db.query(
          'UPDATE sporting_events SET name=$2, sport=$3, tagline=$4, blurb=$5, start_date=$6, end_date=$7, venue=$8, accent=$9, emoji=$10, enabled=$11, slug=$12 WHERE id=$1',
          [b.id, b.name, b.sport || null, b.tagline || null, b.blurb || null, b.startDate, b.endDate, b.venue || null, accent, emoji, b.enabled !== false, slug]
        );
        return res.json({ ok: true, id: b.id, slug: slug });
      }
      var { rows } = await db.query(
        'INSERT INTO sporting_events (slug, name, sport, tagline, blurb, start_date, end_date, venue, accent, emoji, enabled) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (slug) DO UPDATE SET name=$2, sport=$3, tagline=$4, blurb=$5, start_date=$6, end_date=$7, venue=$8, accent=$9, emoji=$10, enabled=$11 RETURNING id',
        [slug, b.name, b.sport || null, b.tagline || null, b.blurb || null, b.startDate, b.endDate, b.venue || null, accent, emoji, b.enabled !== false]
      );
      res.json({ ok: true, id: rows[0] && rows[0].id, slug: slug });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/events/admin/delete — remove an event.
  router.post('/events/admin/delete', authenticate, requireAdmin, async function (req, res) {
    try {
      if (!req.body || !req.body.id) return res.status(400).json({ error: 'id required' });
      await db.query('DELETE FROM sporting_events WHERE id = $1', [req.body.id]);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/events/admin/seed — seed the current big meetings (idempotent by slug).
  router.post('/events/admin/seed', authenticate, requireAdmin, async function (req, res) {
    try {
      var seed = [
        { slug: 'glorious-goodwood-2026', name: 'Glorious Goodwood', sport: 'racing', emoji: '🏇', accent: '#22c55e', venue: 'Goodwood', tagline: "Racing's marquee summer flat festival", blurb: 'Five days of the best flat racing. Our daily NAP, value picks and full card analysis all week.', startDate: '2026-07-28', endDate: '2026-08-01' },
        { slug: 'football-season-2026-27', name: 'Football Season Kick-Off', sport: 'football', emoji: '⚽', accent: '#d4a843', venue: 'Premier League & top leagues', tagline: 'The new season starts here', blurb: 'Back for 2026/27. Opening-weekend previews, Our Take on every game, and season-long value.', startDate: '2026-08-14', endDate: '2026-08-31' },
        { slug: 'york-ebor-2026', name: 'York Ebor Festival', sport: 'racing', emoji: '🏇', accent: '#3b82f6', venue: 'York', tagline: 'Juddmonte International & the Ebor', blurb: 'Four days of top-class flat racing at York. Daily picks and full analysis.', startDate: '2026-08-19', endDate: '2026-08-22' },
      ];
      var n = 0;
      for (var i = 0; i < seed.length; i++) {
        var e = seed[i];
        await db.query(
          'INSERT INTO sporting_events (slug, name, sport, tagline, blurb, start_date, end_date, venue, accent, emoji, enabled) ' +
          'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE) ON CONFLICT (slug) DO NOTHING',
          [e.slug, e.name, e.sport, e.tagline, e.blurb, e.startDate, e.endDate, e.venue, e.accent, e.emoji]
        );
        n++;
      }
      res.json({ ok: true, seeded: n });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
