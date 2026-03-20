// src/controllers/settingsController.js
const bcrypt = require('bcryptjs');
const db = require('../../config/database');
const logger = require('../utils/logger');

exports.index = async (req, res) => {
  const user = await db.query('SELECT * FROM users WHERE id = $1', [req.session.user.id]);
  const igAccounts = await db.query('SELECT * FROM ig_accounts WHERE user_id = $1', [req.session.user.id]);
  res.render('settings/index', {
    layout: 'layouts/dashboard', title: 'Settings',
    profile: user.rows[0], igAccounts: igAccounts.rows
  });
};

exports.updateProfile = async (req, res) => {
  const { full_name, business_name, timezone } = req.body;
  try {
    await db.query('UPDATE users SET full_name=$1, business_name=$2, timezone=$3, updated_at=NOW() WHERE id=$4',
      [full_name, business_name || null, timezone || 'Asia/Kolkata', req.session.user.id]);
    req.session.user.full_name = full_name;
    req.session.user.business_name = business_name;
    req.flash('success', 'Profile updated.');
  } catch (err) {
    req.flash('error', 'Failed to update profile.');
  }
  res.redirect('/settings');
};

exports.updatePassword = async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  try {
    const user = await db.query('SELECT * FROM users WHERE id = $1', [req.session.user.id]);
    if (!await bcrypt.compare(current_password, user.rows[0].password_hash)) {
      req.flash('error', 'Current password is incorrect.');
      return res.redirect('/settings');
    }
    if (new_password !== confirm_password) {
      req.flash('error', 'New passwords do not match.');
      return res.redirect('/settings');
    }
    if (new_password.length < 8) {
      req.flash('error', 'Password must be at least 8 characters.');
      return res.redirect('/settings');
    }
    const hash = await bcrypt.hash(new_password, 12);
    await db.query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, req.session.user.id]);
    req.flash('success', 'Password updated successfully.');
  } catch (err) {
    req.flash('error', 'Failed to update password.');
  }
  res.redirect('/settings');
};

exports.disconnectIg = async (req, res) => {
  await db.query('UPDATE ig_accounts SET is_active = FALSE WHERE id = $1 AND user_id = $2',
    [req.params.id, req.session.user.id]);
  req.flash('success', 'Instagram account disconnected.');
  res.redirect('/settings');
};

exports.deleteAccount = async (req, res) => {
  const { confirm_text } = req.body;
  if (confirm_text !== 'DELETE') {
    req.flash('error', 'Please type DELETE to confirm.');
    return res.redirect('/settings');
  }
  try {
    await db.query('UPDATE users SET is_active = FALSE, email = CONCAT(email, \'_deleted_\', $1) WHERE id = $2',
      [Date.now(), req.session.user.id]);
    req.session.destroy(() => res.redirect('/'));
  } catch (err) {
    req.flash('error', 'Failed to delete account.');
    res.redirect('/settings');
  }
};
