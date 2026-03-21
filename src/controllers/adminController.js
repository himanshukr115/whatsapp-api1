const db = require('../../config/database');
const logger = require('../utils/logger');

const toInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const clampPercent = (value) => Math.max(0, Math.min(100, toInt(value, 0)));

const computeYearlyPrice = (monthlyPaise, discountPercent, explicitYearly) => {
  const parsedMonthly = Math.max(0, toInt(monthlyPaise, 0));
  const parsedYearly = Math.max(0, toInt(explicitYearly, -1));
  const discount = clampPercent(discountPercent);

  if (parsedYearly > -1) return parsedYearly;

  const yearlyWithoutDiscount = parsedMonthly * 12;
  return Math.max(0, Math.round(yearlyWithoutDiscount * (1 - discount / 100)));
};

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
        SELECT id, name, slug, price_monthly, price_yearly, yearly_discount_percent, dm_limit, flow_limit, ig_accounts, is_active, sort_order
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
    yearly_discount_percent,
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

  const parsedFeatures = (features || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

  const monthly = Math.max(0, toInt(price_monthly));
  const discount = clampPercent(yearly_discount_percent);
  const yearly = computeYearlyPrice(monthly, discount, price_yearly);

  try {
    await db.query(`
      INSERT INTO plans (name, slug, price_monthly, price_yearly, yearly_discount_percent, dm_limit, flow_limit, ig_accounts, sort_order, features, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, TRUE)
    `, [
      name.trim(),
      normalizedSlug,
      monthly,
      yearly,
      discount,
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

exports.updatePlan = async (req, res) => {
  const {
    name,
    price_monthly,
    price_yearly,
    yearly_discount_percent,
    dm_limit,
    flow_limit,
    ig_accounts,
    sort_order,
    is_active,
  } = req.body;

  const monthly = Math.max(0, toInt(price_monthly));
  const discount = clampPercent(yearly_discount_percent);
  const yearly = computeYearlyPrice(monthly, discount, price_yearly);

  try {
    await db.query(`
      UPDATE plans
      SET
        name = COALESCE(NULLIF(TRIM($1), ''), name),
        price_monthly = $2,
        price_yearly = $3,
        yearly_discount_percent = $4,
        dm_limit = $5,
        flow_limit = $6,
        ig_accounts = $7,
        sort_order = $8,
        is_active = $9
      WHERE id = $10
    `, [
      name,
      monthly,
      yearly,
      discount,
      Math.max(0, toInt(dm_limit, 0)),
      Math.max(0, toInt(flow_limit, 0)),
      Math.max(0, toInt(ig_accounts, 0)),
      toInt(sort_order, 0),
      is_active === 'true',
      req.params.planId,
    ]);

    req.flash('success', 'Plan updated successfully.');
  } catch (error) {
    logger.error('Update plan error', { error: error.message, planId: req.params.planId });
    req.flash('error', 'Could not update plan.');
  }

  return res.redirect('/admin');
};

exports.deletePlan = async (req, res) => {
  try {
    const inUse = await db.query(
      'SELECT COUNT(*)::int AS count FROM subscriptions WHERE plan_id = $1 AND status = $2',
      [req.params.planId, 'active'],
    );

    if ((inUse.rows[0]?.count || 0) > 0) {
      req.flash('error', 'Cannot delete a plan with active subscriptions. Deactivate it instead.');
      return res.redirect('/admin');
    }

    await db.query('DELETE FROM plans WHERE id = $1', [req.params.planId]);
    req.flash('success', 'Plan deleted successfully.');
  } catch (error) {
    logger.error('Delete plan error', { error: error.message, planId: req.params.planId });
    req.flash('error', 'Could not delete plan.');
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
