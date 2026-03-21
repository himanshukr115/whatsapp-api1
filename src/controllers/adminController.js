const db = require('../../config/database');
const logger = require('../utils/logger');

exports.index = async (req, res) => {
  try {
    const [summary, recentUsers, paidUsers, plans] = await Promise.all([
      db.query(`
        SELECT
          (SELECT COUNT(*)::int FROM users) AS total_users,
          (SELECT COUNT(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '30 days') AS users_last_30_days,
          (SELECT COUNT(DISTINCT user_id)::int FROM subscriptions WHERE status = 'active') AS active_subscriptions,
          (SELECT COUNT(DISTINCT user_id)::int FROM payments WHERE status = 'completed') AS paid_users,
          (SELECT COALESCE(SUM(amount), 0)::bigint FROM payments WHERE status = 'completed') AS revenue_captured
      `),
      db.query(`
        SELECT id, full_name, email, business_name, role, created_at, last_login_at
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
      db.query(`
        SELECT id, name, slug, price_monthly, price_yearly, dm_limit, flow_limit, ig_accounts, is_active, sort_order
        FROM plans
        ORDER BY sort_order ASC, created_at ASC
      `),
    ]);

    return res.render('admin/index', {
      layout: 'layouts/dashboard',
      title: 'SaaS Admin',
      stats: summary.rows[0],
      recentUsers: recentUsers.rows,
      paidUsers: paidUsers.rows,
      plans: plans.rows,
    });
  } catch (error) {
    logger.error('Admin dashboard error', { error: error.message });
    req.flash('error', 'Unable to load admin dashboard right now.');
    return res.redirect('/dashboard');
  }
};

exports.createPlan = async (req, res) => {
  const {
    name,
    slug,
    price_monthly,
    price_yearly,
    dm_limit,
    flow_limit,
    ig_accounts,
    sort_order,
    features,
  } = req.body;

  const normalizedSlug = (slug || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!name || !normalizedSlug) {
    req.flash('error', 'Plan name and slug are required.');
    return res.redirect('/admin');
  }

  const toInt = (value, fallback = 0) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  };

  const parsedFeatures = (features || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

  try {
    await db.query(`
      INSERT INTO plans (name, slug, price_monthly, price_yearly, dm_limit, flow_limit, ig_accounts, sort_order, features, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, TRUE)
    `, [
      name.trim(),
      normalizedSlug,
      Math.max(0, toInt(price_monthly)),
      Math.max(0, toInt(price_yearly)),
      Math.max(0, toInt(dm_limit, 1000)),
      Math.max(0, toInt(flow_limit, 3)),
      Math.max(0, toInt(ig_accounts, 1)),
      toInt(sort_order, 0),
      JSON.stringify(parsedFeatures),
    ]);
    req.flash('success', `Plan "${name.trim()}" created successfully.`);
  } catch (error) {
    logger.error('Create plan error', { error: error.message, slug: normalizedSlug });
    req.flash('error', 'Could not create plan. Ensure slug is unique.');
  }
  return res.redirect('/admin');
};

exports.updateUserRole = async (req, res) => {
  const allowed = ['user', 'moderator', 'admin'];
  const role = (req.body.role || '').toLowerCase();

  if (!allowed.includes(role)) {
    req.flash('error', 'Invalid role selected.');
    return res.redirect('/admin');
  }

  try {
    await db.query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', [role, req.params.userId]);

    if (req.session.user?.id === req.params.userId) {
      req.session.user.role = role;
      req.session.user.is_admin = role === 'admin';
    }

    req.flash('success', 'User role updated successfully.');
  } catch (error) {
    logger.error('Update user role error', { error: error.message, userId: req.params.userId, role });
    req.flash('error', 'Could not update user role.');
  }

  return res.redirect('/admin');
};
