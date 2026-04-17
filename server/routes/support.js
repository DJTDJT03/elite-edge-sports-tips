module.exports = function(deps) {
  const router = require('express').Router();
  const { db, authenticate, requireAdmin, jwt, JWT_SECRET } = deps;

  // GET /api/support — admin only, list all tickets
  router.get('/support', authenticate, requireAdmin, async (req, res) => {
    try {
      const tickets = await db.getTickets();
      res.json(tickets);
    } catch (err) {
      console.error('[Support] GET /support error:', err.message);
      res.status(500).json({ error: 'Failed to fetch tickets' });
    }
  });

  // POST /api/support — create a new ticket (public)
  router.post('/support', async (req, res) => {
    try {
      const { name, email, subject, message } = req.body;
      if (!name || !email || !subject || !message) {
        return res.status(400).json({ error: 'All fields are required' });
      }

      const ticket = {
        id: `sup_${Date.now()}`,
        userId: null,
        name, email, subject, message,
        status: 'open',
        priority: 'medium',
        date: new Date().toISOString(),
        replies: [],
      };

      // Try to link to user
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
          ticket.userId = decoded.id;
        } catch {}
      }

      await db.createTicket(ticket);
      res.json(ticket);
    } catch (err) {
      console.error('[Support] POST /support error:', err.message);
      res.status(500).json({ error: 'Failed to create ticket' });
    }
  });

  // POST /api/support/:id/reply — admin reply to a ticket
  router.post('/support/:id/reply', authenticate, requireAdmin, async (req, res) => {
    try {
      const tickets = await db.getTickets();
      const idx = tickets.findIndex(t => t.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: 'Ticket not found' });

      tickets[idx].replies.push({
        from: 'admin',
        message: req.body.message,
        date: new Date().toISOString(),
      });
      tickets[idx].status = req.body.status || 'in-progress';

      await db.updateTicket(req.params.id, {
        replies: tickets[idx].replies,
        status: tickets[idx].status,
      });
      res.json(tickets[idx]);
    } catch (err) {
      console.error('[Support] POST /support/:id/reply error:', err.message);
      res.status(500).json({ error: 'Failed to reply to ticket' });
    }
  });

  return router;
};
