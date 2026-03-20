// src/middleware/auth.js
const logger = require('../utils/logger');

exports.requireAuth = (req, res, next) => {
  if (req.session && req.session.user) return next();
  req.flash('error', 'Please log in to continue.');
  return res.redirect('/auth/login');
};

exports.requireGuest = (req, res, next) => {
  if (!req.session || !req.session.user) return next();
  return res.redirect('/dashboard');
};

exports.requireAdmin = (req, res, next) => {
  const adminEmails = (process.env.ADMIN_EMAILS || 'admin@flowgram.in')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const email = req.session?.user?.email?.toLowerCase();
  if (email && adminEmails.includes(email)) return next();
  req.flash('error', 'You are not authorized to access admin dashboard.');
  return res.redirect('/dashboard');
};

exports.requirePlan = (minPlan) => (req, res, next) => {
  const planOrder = { free: 0, pro: 1, business: 2 };
  const userPlan = req.session.user?.plan_slug || 'free';
  if (planOrder[userPlan] >= planOrder[minPlan]) return next();
  req.flash('error', `This feature requires the ${minPlan} plan or higher.`);
  return res.redirect('/billing');
};
