const db = require('../../config/database');
const logger = require('../utils/logger');

exports.index = async (req, res) => {
  try {
    const [summary, recentUsers, paidUsers] = await Promise.all([
      db.query(`
        SELECT
          (SELECT COUNT(*)::int FROM users) AS total_users,
          (SELECT COUNT(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '30 days') AS users_last_30_days,
          (SELECT COUNT(DISTINCT user_id)::int FROM subscriptions WHERE status = 'active') AS active_subscriptions,
          (SELECT COUNT(DISTINCT user_id)::int FROM payments WHERE status = 'captured') AS paid_users,
          (SELECT COALESCE(SUM(amount), 0)::bigint FROM payments WHERE status = 'captured') AS revenue_captured
      `),
      db.query(`
        SELECT id, full_name, email, business_name, created_at, last_login_at
        FROM users
        ORDER BY created_at DESC
        LIMIT 20
      `),
      db.query(`
        SELECT
          u.full_name,
          u.email,
          pl.name AS plan_name,
          p.amount,
          p.currency,
          p.status,
          p.created_at
        FROM payments p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN plans pl ON pl.id = p.plan_id
        ORDER BY p.created_at DESC
        LIMIT 20
      `),
    ]);

    return res.render('admin/index', {
      layout: 'layouts/dashboard',
      title: 'SaaS Admin',
      stats: summary.rows[0],
      recentUsers: recentUsers.rows,
      paidUsers: paidUsers.rows,
    });
  } catch (error) {
    logger.error('Admin dashboard error', { error: error.message });
    req.flash('error', 'Unable to load admin dashboard right now.');
    return res.redirect('/dashboard');
  }
};
