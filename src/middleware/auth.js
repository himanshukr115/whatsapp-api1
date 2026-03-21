// src/middleware/auth.js
const logger = require('../utils/logger');
const db = require('../../config/database');

exports.requireAuth = (req, res, next) => {
  if (req.session && req.session.user) {
    return next();
  }
  
  logger.warn('Auth rejected - no user in session', { path: req.path });
  req.flash('error', 'Please log in to continue.');
  return res.redirect('/auth/login');
};

exports.requireGuest = (req, res, next) => {
  if (!req.session || !req.session.user) return next();
  return res.redirect('/dashboard');
};

exports.requireAdmin = async (req, res, next) => {
  const sessionRole = req.session?.user?.role || 'user';
  // Also support legacy sessions that may have is_admin but not role
  const sessionIsAdmin = req.session?.user?.is_admin === true;
  if (sessionRole === 'admin' || sessionIsAdmin) {
    // Keep is_admin in sync
    if (req.session?.user) req.session.user.is_admin = true;
    return next();
  }

  try {
    const userId = req.session?.user?.id;
    if (!userId) throw new Error('No user id in session');
    const { rows } = await db.query('SELECT role FROM users WHERE id = $1 LIMIT 1', [userId]);
    const dbRole = rows[0]?.role || 'user';
    req.session.user.role = dbRole;
    req.session.user.is_admin = dbRole === 'admin';
    if (dbRole === 'admin') return next();
  } catch (error) {
    logger.warn('Admin role check failed', { error: error.message, userId: req.session?.user?.id });
  }

  req.flash('error', 'You are not authorized to access admin dashboard.');
  return res.redirect('/dashboard');
};

exports.requireModerator = (req, res, next) => {
  const role = req.session?.user?.role || 'user';
  if (role === 'admin' || role === 'moderator') return next();
  req.flash('error', 'Moderator or admin access is required.');
  return res.redirect('/dashboard');
};

exports.requirePlan = (minPlan) => (req, res, next) => {
  const planOrder = { free: 0, pro: 1, business: 2 };
  const userPlan = req.session.user?.plan_slug || 'free';
  if (typeof planOrder[minPlan] === 'undefined') {
    logger.warn('Invalid plan requirement configured', { minPlan });
    return res.redirect('/dashboard');
  }
  if (planOrder[userPlan] >= planOrder[minPlan]) return next();
  req.flash('error', `This feature requires the ${minPlan} plan or higher.`);
  return res.redirect('/billing');
};