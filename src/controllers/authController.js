// src/controllers/authController.js
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../../config/database');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');
const axios = require('axios');

const getAdminEmails = () => (process.env.ADMIN_EMAILS || 'admin@flowgram.in')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const isAdminEmail = (email) => getAdminEmails().includes((email || '').toLowerCase());

// ── Register ──────────────────────────────────────────────────────────────
exports.showRegister = (req, res) => {
  res.render('auth/register', { layout: 'layouts/auth', title: 'Create Account — FlowGram', formData: {} });
};

exports.register = async (req, res) => {
  const { full_name, email, password, business_name } = req.body;
  const errors = [];

  if (!full_name || full_name.trim().length < 2) errors.push('Full name must be at least 2 characters.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Valid email is required.');
  if (!password || password.length < 8) errors.push('Password must be at least 8 characters.');
  if (!/(?=.*[A-Z])(?=.*[0-9])/.test(password)) errors.push('Password must contain an uppercase letter and a number.');

  if (errors.length) {
    return res.render('auth/register', {
      layout: 'layouts/auth', title: 'Create Account',
      errors, formData: { full_name, email, business_name }
    });
  }

  try {
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length) {
      return res.render('auth/register', {
        layout: 'layouts/auth', title: 'Create Account',
        errors: ['An account with this email already exists.'],
        formData: { full_name, email, business_name }
      });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const verify_token = crypto.randomBytes(32).toString('hex');
    // console.log('Generated verify token:', verify_token); // Debug log
    // console.log('User email:', email); // Debug log
    const { rows } = await db.query(`
      INSERT INTO users (email, password_hash, full_name, business_name, email_verify_token)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, email, full_name
    `, [email.toLowerCase(), password_hash, full_name.trim(), business_name?.trim() || null, verify_token]);

    const user = rows[0];

    // Assign free plan
    const plan = await db.query("SELECT id FROM plans WHERE slug = 'free' LIMIT 1");
    if (plan.rows.length) {
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + 1);
      await db.query(`
        INSERT INTO subscriptions (user_id, plan_id, billing_cycle, current_period_end, payment_gateway)
        VALUES ($1, $2, 'monthly', $3, 'free')
      `, [user.id, plan.rows[0].id, endDate]);
    }

    // Send verification email
    const emailSent = await emailService.sendVerificationEmail(email, full_name, verify_token);

    logger.info('New user registered', { userId: user.id, email });
    if (emailSent) {
      req.flash('success', 'Account created! Please check your email to verify your account.');
    } else {
      req.flash('error', 'Account created, but verification email could not be sent. Please use resend verification after login.');
    }
    res.redirect('/auth/login');
  } catch (err) {
    logger.error('Register error', { error: err.message });
    res.render('auth/register', {
      layout: 'layouts/auth', title: 'Create Account',
      errors: ['Something went wrong. Please try again.'],
      formData: { full_name, email, business_name }
    });
  }
};

// ── Login ─────────────────────────────────────────────────────────────────
exports.showLogin = (req, res) => {
  res.render('auth/login', { layout: 'layouts/auth', title: 'Login — FlowGram', formData: {} });
};

exports.login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('auth/login', {
      layout: 'layouts/auth', title: 'Login',
      errors: ['Email and password are required.'], formData: { email }
    });
  }

  try {
    const { rows } = await db.query(`
      SELECT u.*, p.slug as plan_slug, p.name as plan_name, p.dm_limit, p.flow_limit, p.ig_accounts as ig_accounts_limit
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
      LEFT JOIN plans p ON p.id = s.plan_id
      WHERE u.email = $1
      ORDER BY s.created_at DESC LIMIT 1
    `, [email.toLowerCase()]);

    const user = rows[0];

    if (!user || !await bcrypt.compare(password, user.password_hash)) {
      return res.render('auth/login', {
        layout: 'layouts/auth', title: 'Login',
        errors: ['Invalid email or password.'], formData: { email }
      });
    }

    if (user.is_active === false) {
      return res.render('auth/login', {
        layout: 'layouts/auth', title: 'Login',
        errors: ['Your account has been deactivated. Contact support.'], formData: { email }
      });
    }

    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    req.session.user = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      business_name: user.business_name,
      avatar_url: user.avatar_url,
      plan_slug: user.plan_slug || 'free',
      plan_name: user.plan_name || 'Free',
      dm_limit: user.dm_limit || 1000,
      flow_limit: user.flow_limit || 3,
      ig_accounts_limit: user.ig_accounts_limit || 1,
      email_verified: user.email_verified,
      is_admin: isAdminEmail(user.email),
    };

    logger.info('User logged in', { userId: user.id, email });
    req.session.save((err) => {
      if (err) {
        logger.error('Session save error', { error: err.message, stack: err.stack });
        return res.render('auth/login', {
          layout: 'layouts/auth', title: 'Login',
          errors: ['Session error. Please try again.'], formData: { email }
        });
      }
      req.flash('success', `Welcome back, ${user.full_name}!`);
      res.redirect(302, '/dashboard');
    });
  } catch (err) {
    logger.error('Login error', { error: err.message });
    res.render('auth/login', {
      layout: 'layouts/auth', title: 'Login',
      errors: ['Something went wrong. Please try again.'], formData: { email }
    });
  }
};

// ── Logout ────────────────────────────────────────────────────────────────
exports.logout = (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('fg.sid');
    res.redirect('/');
  });
};

exports.googleLogin = (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REDIRECT_URI) {
    req.flash('error', 'Google login is not configured yet.');
    return res.redirect('/auth/login');
  }

  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauth_state = state;

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });

  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
};

exports.resendVerification = async (req, res) => {
  const userEmail = req.session?.user?.email;
  if (!userEmail) {
    req.flash('error', 'Please log in first.');
    return res.redirect('/auth/login');
  }

  try {
    const { rows } = await db.query(
      'SELECT id, full_name, email_verified FROM users WHERE email = $1 LIMIT 1',
      [userEmail.toLowerCase()]
    );

    if (!rows.length) {
      req.flash('error', 'User not found.');
      return res.redirect('/dashboard');
    }

    const user = rows[0];
    if (user.email_verified) {
      req.flash('success', 'Your email is already verified.');
      return res.redirect('/dashboard');
    }

    const verifyToken = crypto.randomBytes(32).toString('hex');
    await db.query('UPDATE users SET email_verify_token = $1 WHERE id = $2', [verifyToken, user.id]);
    const emailSent = await emailService.sendVerificationEmail(userEmail, user.full_name, verifyToken);

    if (emailSent) {
      req.flash('success', 'Verification email sent. Please check your inbox.');
    } else {
      req.flash('error', 'Unable to send verification email right now. Please contact support.');
    }
    return res.redirect('/dashboard');
  } catch (err) {
    logger.error('Resend verification error', { error: err.message, email: userEmail });
    req.flash('error', 'Failed to resend verification email.');
    return res.redirect('/dashboard');
  }
};

exports.googleCallback = async (req, res) => {
  const { code, state } = req.query;

  if (!code || !state || state !== req.session.oauth_state) {
    req.flash('error', 'Invalid Google login request. Please try again.');
    return res.redirect('/auth/login');
  }

  delete req.session.oauth_state;

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
    req.flash('error', 'Google login is not configured yet.');
    return res.redirect('/auth/login');
  }

  try {
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const { access_token } = tokenResponse.data;

    const profileResponse = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const { sub: googleId, email, name, picture, email_verified: emailVerified } = profileResponse.data;
    if (!email || !googleId) {
      req.flash('error', 'Google login failed: no email returned.');
      return res.redirect('/auth/login');
    }

    const normalizedEmail = email.toLowerCase();
    const { rows: existingRows } = await db.query(`
      SELECT u.*, p.slug as plan_slug, p.name as plan_name, p.dm_limit, p.flow_limit, p.ig_accounts as ig_accounts_limit
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
      LEFT JOIN plans p ON p.id = s.plan_id
      WHERE u.email = $1
      ORDER BY s.created_at DESC LIMIT 1
    `, [normalizedEmail]);

    let user = existingRows[0];

    if (!user) {
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const passwordHash = await bcrypt.hash(randomPassword, 12);

      const { rows } = await db.query(`
        INSERT INTO users (email, password_hash, full_name, avatar_url, email_verified, google_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [normalizedEmail, passwordHash, name || normalizedEmail.split('@')[0], picture || null, !!emailVerified, googleId]);
      user = rows[0];

      const plan = await db.query("SELECT id FROM plans WHERE slug = 'free' LIMIT 1");
      if (plan.rows.length) {
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 1);
        await db.query(`
          INSERT INTO subscriptions (user_id, plan_id, billing_cycle, current_period_end, payment_gateway)
          VALUES ($1, $2, 'monthly', $3, 'free')
        `, [user.id, plan.rows[0].id, endDate]);
      }
    } else {
      await db.query(`
        UPDATE users
        SET google_id = COALESCE(google_id, $1),
            avatar_url = COALESCE(avatar_url, $2),
            email_verified = CASE WHEN $3 = TRUE THEN TRUE ELSE email_verified END,
            last_login_at = NOW()
        WHERE id = $4
      `, [googleId, picture || null, !!emailVerified, user.id]);
    }

    const { rows: sessionRows } = await db.query(`
      SELECT u.*, p.slug as plan_slug, p.name as plan_name, p.dm_limit, p.flow_limit, p.ig_accounts as ig_accounts_limit
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
      LEFT JOIN plans p ON p.id = s.plan_id
      WHERE u.id = $1
      ORDER BY s.created_at DESC LIMIT 1
    `, [user.id]);

    const userForSession = sessionRows[0];

    req.session.user = {
      id: userForSession.id,
      email: userForSession.email,
      full_name: userForSession.full_name,
      business_name: userForSession.business_name,
      avatar_url: userForSession.avatar_url,
      plan_slug: userForSession.plan_slug || 'free',
      plan_name: userForSession.plan_name || 'Free',
      dm_limit: userForSession.dm_limit || 1000,
      flow_limit: userForSession.flow_limit || 3,
      ig_accounts_limit: userForSession.ig_accounts_limit || 1,
      email_verified: userForSession.email_verified,
      is_admin: isAdminEmail(userForSession.email),
    };

    req.flash('success', 'Logged in with Google successfully.');
    return res.redirect('/dashboard');
  } catch (err) {
    logger.error('Google login error', { error: err.message, data: err.response?.data });
    req.flash('error', 'Google login failed. Please try again.');
    return res.redirect('/auth/login');
  }
};

// ── Verify Email ──────────────────────────────────────────────────────────
exports.verifyEmail = async (req, res) => {
  const { token } = req.params;
  try {
    const { rows } = await db.query(
      "UPDATE users SET email_verified = TRUE, email_verify_token = NULL WHERE email_verify_token = $1 RETURNING id",
      [token]
    );
    if (!rows.length) {
      req.flash('error', 'Invalid or expired verification link.');
    } else {
      req.flash('success', 'Email verified! You can now log in.');
      if (req.session.user) req.session.user.email_verified = true;
    }
  } catch (err) {
    req.flash('error', 'Verification failed.');
  }
  res.redirect('/auth/login');
};

// ── Forgot Password ───────────────────────────────────────────────────────
exports.showForgotPassword = (req, res) => {
  res.render('auth/forgot-password', { layout: 'layouts/auth', title: 'Forgot Password' });
};

exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email?.toLowerCase()]);
    if (rows.length) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 3600000); // 1 hour
      await db.query('UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
        [token, expires, rows[0].id]);
      await emailService.sendPasswordResetEmail(email, rows[0].full_name, token);
    }
    // Always show success to prevent email enumeration
    req.flash('success', 'If that email exists, a reset link has been sent.');
    res.redirect('/auth/forgot-password');
  } catch (err) {
    logger.error('Forgot password error', { error: err.message });
    req.flash('error', 'Something went wrong.');
    res.redirect('/auth/forgot-password');
  }
};

exports.showResetPassword = async (req, res) => {
  const { token } = req.params;
  const { rows } = await db.query(
    'SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()', [token]
  );
  if (!rows.length) {
    req.flash('error', 'Invalid or expired reset link.');
    return res.redirect('/auth/forgot-password');
  }
  res.render('auth/reset-password', { layout: 'layouts/auth', title: 'Reset Password', token });
};

exports.resetPassword = async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  if (!password || password.length < 8) {
    req.flash('error', 'Password must be at least 8 characters.');
    return res.redirect(`/auth/reset-password/${token}`);
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      "UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE reset_token = $2 AND reset_token_expires > NOW() RETURNING id",
      [hash, token]
    );
    if (!rows.length) {
      req.flash('error', 'Invalid or expired reset link.');
      return res.redirect('/auth/forgot-password');
    }
    req.flash('success', 'Password reset successfully. Please log in.');
    res.redirect('/auth/login');
  } catch (err) {
    req.flash('error', 'Something went wrong.');
    res.redirect(`/auth/reset-password/${token}`);
  }
};
