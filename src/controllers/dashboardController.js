// src/controllers/dashboardController.js
const db = require('../../config/database');
const logger = require('../utils/logger');

exports.index = async (req, res) => {
  try {
    const userId = req.session.user.id;
    logger.info('Dashboard loading for user', { userId });

    // Fetch all data in parallel
    const [stats, recentActivity, topFlows, igAccounts, chartData] = await Promise.all([
      db.query(`
        SELECT
          (SELECT COUNT(*) FROM flows WHERE user_id = $1 AND is_active = TRUE) as active_flows,
          (SELECT COUNT(*) FROM messages WHERE user_id = $1 AND DATE(sent_at) = CURRENT_DATE AND direction = 'out') as dms_today,
          (SELECT COUNT(*) FROM contacts WHERE user_id = $1 AND DATE(created_at) >= CURRENT_DATE - 30) as new_contacts_30d,
          (SELECT COUNT(*) FROM messages WHERE user_id = $1 AND sent_at >= NOW() - INTERVAL '30 days' AND direction = 'out') as total_dms_30d
      `, [userId]),

      db.query(`
        SELECT ae.*, f.name as flow_name, c.username as contact_username
        FROM analytics_events ae
        LEFT JOIN flows f ON f.id = ae.flow_id
        LEFT JOIN contacts c ON c.id = ae.contact_id
        WHERE ae.user_id = $1
        ORDER BY ae.created_at DESC LIMIT 8
      `, [userId]),

      db.query(`
        SELECT name, trigger_count, success_count,
          CASE WHEN trigger_count > 0 THEN ROUND(success_count::numeric / trigger_count * 100, 1) ELSE 0 END as rate
        FROM flows WHERE user_id = $1 AND trigger_count > 0
        ORDER BY trigger_count DESC LIMIT 5
      `, [userId]),

      db.query("SELECT * FROM ig_accounts WHERE user_id = $1 AND is_active = TRUE", [userId]),

      db.query(`
        SELECT DATE(sent_at) as day, COUNT(*) as count
        FROM messages WHERE user_id = $1 AND direction = 'out' AND sent_at >= NOW() - INTERVAL '7 days'
        GROUP BY DATE(sent_at) ORDER BY day
      `, [userId]),
    ]);

    logger.info('Dashboard data fetched', { userId, statsRows: stats.rowCount });

    res.render('dashboard/index', {
      layout: 'layouts/dashboard',
      title: 'Dashboard',
      stats: stats.rows[0] || { active_flows: 0, dms_today: 0, new_contacts_30d: 0, total_dms_30d: 0 },
      recentActivity: recentActivity.rows || [],
      topFlows: topFlows.rows || [],
      igAccounts: igAccounts.rows || [],
      chartData: chartData.rows || [],
    });
  } catch (err) {
    logger.error('Dashboard error', { error: err.message, stack: err.stack, code: err.code });
    try {
      res.render('dashboard/index', {
        layout: 'layouts/dashboard',
        title: 'Dashboard',
        stats: { active_flows: 0, dms_today: 0, new_contacts_30d: 0, total_dms_30d: 0 },
        recentActivity: [], topFlows: [], igAccounts: [], chartData: [],
      });
    } catch (renderErr) {
      logger.error('Dashboard render error', { error: renderErr.message, stack: renderErr.stack });
      res.status(500).json({ error: 'Dashboard render failed', message: renderErr.message });
    }
  }
};
