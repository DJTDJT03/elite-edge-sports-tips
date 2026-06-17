/**
 * Winners Wall — subscriber-submitted wins, admin-moderated.
 *
 * Social proof for the homepage. Members submit a screenshot + caption; nothing
 * is public until an admin approves it. Framed as service testimonials with
 * 18+/BeGambleAware messaging — not a betting-promotion feed.
 *
 * Pluggable: own table (winner_submissions), never touches the locked core.
 */
module.exports = function (deps) {
  var router = require('express').Router();
  var db = deps.db;
  var authenticate = deps.authenticate;
  var requireAdmin = deps.requireAdmin;

  // Max stored image payload (data URL). Client compresses before upload; this
  // sits safely under the 1mb express.json body limit.
  var MAX_IMAGE_CHARS = 900000;
  var CAPTION_MAX = 280;

  function clean(s, max) {
    if (s == null) return '';
    return String(s).replace(/\s+/g, ' ').trim().slice(0, max);
  }

  // POST /api/winners — submit a win (authenticated). Goes to the moderation queue.
  router.post('/winners', authenticate, async function (req, res) {
    try {
      if (!db || !db.query) return res.status(503).json({ error: 'Unavailable right now.' });
      var body = req.body || {};
      var caption = clean(body.caption, CAPTION_MAX);
      var amount = clean(body.amount, 24);
      var image = typeof body.image === 'string' ? body.image : '';

      if (!image && !caption) return res.status(400).json({ error: 'Add a screenshot or a few words about your win.' });
      if (image) {
        // Strict: prefix AND a fully-anchored base64 body (only base64 chars to
        // end-of-string). Prevents an attribute-breakout XSS payload after the
        // comma, e.g. data:image/png;base64,"><img onerror=...>.
        if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(image)) {
          return res.status(400).json({ error: 'Please attach a valid image file (PNG or JPG).' });
        }
        if (image.length > MAX_IMAGE_CHARS) {
          return res.status(413).json({ error: 'That image is too large — please use a smaller screenshot.' });
        }
      }

      var name = clean(body.displayName, 40) || req.user.name || req.user.username || 'Elite Edge member';
      // Rate-limit: max 5 pending submissions per user at once
      var pendingCount = await db.query("SELECT COUNT(*)::int AS n FROM winner_submissions WHERE user_id = $1 AND status = 'pending'", [String(req.user.id)]);
      if (pendingCount.rows && pendingCount.rows[0] && pendingCount.rows[0].n >= 5) {
        return res.status(429).json({ error: 'You have a few submissions awaiting review already — thanks!' });
      }

      await db.query(
        "INSERT INTO winner_submissions (user_id, display_name, caption, image_data, amount, status) VALUES ($1,$2,$3,$4,$5,'pending')",
        [String(req.user.id), name, caption || null, image || null, amount || null]
      );
      res.json({ ok: true, message: 'Thanks! Your win has been sent for review and will appear on the Winners Wall once approved.' });
    } catch (err) {
      res.status(500).json({ error: 'Could not submit: ' + err.message });
    }
  });

  // GET /api/winners — public, approved only (no image_data omitted — needed to render).
  router.get('/winners', async function (req, res) {
    try {
      if (!db || !db.query) return res.json({ winners: [] });
      res.set('Cache-Control', 'public, max-age=120');
      var limit = Math.min(parseInt(req.query.limit, 10) || 24, 60);
      var r = await db.query(
        "SELECT id, display_name, caption, image_data, amount, approved_at FROM winner_submissions " +
        "WHERE status = 'approved' ORDER BY approved_at DESC NULLS LAST, created_at DESC LIMIT $1",
        [limit]
      );
      res.json({ winners: (r.rows || []).map(function (w) {
        return { id: w.id, name: w.display_name, caption: w.caption, image: w.image_data, amount: w.amount, date: w.approved_at };
      }) });
    } catch (err) {
      res.json({ winners: [] });
    }
  });

  // ---- Admin moderation ----

  // GET /api/admin/winners?status=pending — moderation queue (default pending).
  router.get('/admin/winners', authenticate, requireAdmin, async function (req, res) {
    try {
      var status = ['pending', 'approved', 'rejected'].indexOf(req.query.status) !== -1 ? req.query.status : 'pending';
      var r = await db.query(
        "SELECT id, user_id, display_name, caption, image_data, amount, status, created_at, approved_at FROM winner_submissions " +
        "WHERE status = $1 ORDER BY created_at DESC LIMIT 200",
        [status]
      );
      res.json({ winners: r.rows || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/winners/:id/:action — approve | reject | delete
  router.post('/admin/winners/:id/:action', authenticate, requireAdmin, async function (req, res) {
    try {
      var id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: 'Bad id' });
      var action = req.params.action;
      if (action === 'approve') {
        await db.query("UPDATE winner_submissions SET status = 'approved', approved_at = NOW() WHERE id = $1", [id]);
      } else if (action === 'reject') {
        await db.query("UPDATE winner_submissions SET status = 'rejected' WHERE id = $1", [id]);
      } else if (action === 'delete') {
        await db.query("DELETE FROM winner_submissions WHERE id = $1", [id]);
      } else {
        return res.status(400).json({ error: 'Unknown action' });
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
