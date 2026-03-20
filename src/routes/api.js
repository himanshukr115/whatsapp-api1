// src/routes/api.js
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const db = require('../../config/database');

// Stats for dashboard charts
router.get('/stats/chart', requireAuth, async (req, res) => {
  const { days = 7 } = req.query;
  const data = await db.query(`
    SELECT DATE(sent_at) as day, COUNT(*) as count
    FROM messages WHERE user_id=$1 AND direction='out' AND sent_at >= NOW() - INTERVAL '${parseInt(days)} days'
    GROUP BY DATE(sent_at) ORDER BY day
  `, [req.session.user.id]);
  res.json(data.rows);
});

// Search contacts
router.get('/contacts/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  const data = await db.query(`
    SELECT * FROM contacts WHERE user_id=$1 AND (username ILIKE $2 OR display_name ILIKE $2) LIMIT 10
  `, [req.session.user.id, `%${q}%`]);
  res.json(data.rows);
});

// Get flow
router.get('/flows/:id', requireAuth, async (req, res) => {
  const data = await db.query('SELECT * FROM flows WHERE id=$1 AND user_id=$2', [req.params.id, req.session.user.id]);
  if (!data.rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(data.rows[0]);
});

// Update flow nodes (builder saves)
router.put('/flows/:id/nodes', requireAuth, async (req, res) => {
  const { nodes } = req.body;
  await db.query('UPDATE flows SET nodes=$1, updated_at=NOW() WHERE id=$2 AND user_id=$3',
    [JSON.stringify(nodes), req.params.id, req.session.user.id]);
  res.json({ success: true });
});

// User usage stats
router.get('/usage', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const [dms, flows] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM messages WHERE user_id=$1 AND direction='out' AND DATE(sent_at) >= DATE_TRUNC('month', CURRENT_DATE)`, [userId]),
    db.query(`SELECT COUNT(*) FROM flows WHERE user_id=$1`, [userId]),
  ]);
  res.json({
    dms_used: parseInt(dms.rows[0].count),
    dms_limit: req.session.user.dm_limit,
    flows_used: parseInt(flows.rows[0].count),
    flows_limit: req.session.user.flow_limit,
  });
});

module.exports = router;
