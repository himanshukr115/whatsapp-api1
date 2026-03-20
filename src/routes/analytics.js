// src/routes/analytics.js
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const db = require('../../config/database');

router.get('/', requireAuth, async (req, res) => {
  const { days = 30 } = req.query;
  const userId = req.session.user.id;

  const [overview, dmChart, sourceBreakdown, flowStats] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE direction='out') as total_sent,
        COUNT(*) FILTER (WHERE direction='in') as total_received,
        COUNT(DISTINCT contact_id) as unique_contacts,
        COUNT(*) FILTER (WHERE is_automated=TRUE AND direction='out') as automated_count
      FROM messages WHERE user_id=$1 AND sent_at >= NOW() - INTERVAL '${parseInt(days)} days'
    `, [userId]),

    db.query(`
      SELECT DATE(sent_at) as day, COUNT(*) as count
      FROM messages WHERE user_id=$1 AND direction='out' AND sent_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY DATE(sent_at) ORDER BY day
    `, [userId]),

    db.query(`
      SELECT event_type, COUNT(*) as count
      FROM analytics_events WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY event_type ORDER BY count DESC
    `, [userId]),

    db.query(`
      SELECT name, trigger_count, success_count,
        CASE WHEN trigger_count>0 THEN ROUND(success_count::numeric/trigger_count*100,1) ELSE 0 END as rate
      FROM flows WHERE user_id=$1 ORDER BY trigger_count DESC LIMIT 10
    `, [userId]),
  ]);

  res.render('analytics/index', {
    layout: 'layouts/dashboard', title: 'Analytics',
    overview: overview.rows[0],
    dmChart: dmChart.rows,
    sourceBreakdown: sourceBreakdown.rows,
    flowStats: flowStats.rows,
    days: parseInt(days),
  });
});

module.exports = router;
