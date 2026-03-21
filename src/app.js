// src/app.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const flash = require('connect-flash');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const methodOverride = require('method-override');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/database');
const logger = require('./utils/logger');

const app = express();

// ── Security ──────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://checkout.razorpay.com", "https://cdn.jsdelivr.net", "https://www.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://api.razorpay.com"],
      frameSrc: ["'self'", "https://api.razorpay.com"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({ origin: process.env.APP_URL, credentials: true }));

// ── Rate Limiting ─────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 200,
  message: 'Too many requests, please try again later.',
  skip: (req) => req.path.startsWith('/health'),
});
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many auth attempts.' });
app.use(limiter);

// ── Middleware ────────────────────────────────────────────────────────────
app.use(compression());
app.use(morgan('combined', { stream: { write: (msg) => logger.http(msg.trim()) } }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, '../public'), { maxAge: '7d' }));

// ── Sessions ──────────────────────────────────────────────────────────────
const sessionConfig = {
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  name: 'fg.sid',
  cookie: {
    secure: process.env.NODE_ENV === 'production' && process.env.APP_URL?.startsWith('https'),
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'lax',
  },
};
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(session(sessionConfig));
app.use(flash());

// ── Template Engine ───────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);

// ── Global template vars ──────────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.appName = process.env.APP_NAME || 'FlowGram';
  res.locals.appUrl = process.env.APP_URL || 'http://localhost:3000';
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────
app.use('/auth', authLimiter, require('./routes/auth'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/flows', require('./routes/flows'));
app.use('/inbox', require('./routes/inbox'));
app.use('/keywords', require('./routes/keywords'));
app.use('/analytics', require('./routes/analytics'));
app.use('/billing', require('./routes/billing'));
app.use('/settings', require('./routes/settings'));
app.use('/admin', require('./routes/admin'));
app.use('/instagram', require('./routes/instagram'));
app.use('/api/webhooks', require('./routes/webhooks'));
app.use('/api', require('./routes/api'));

// ── Landing page ──────────────────────────────────────────────────────────
app.get('/', async (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');

  try {
    const { rows } = await pool.query(`
      SELECT name, slug, price_monthly, price_yearly, features
      FROM plans
      WHERE is_active = TRUE
      ORDER BY sort_order ASC, created_at ASC
    `);

    const plans = (rows.length ? rows : [
      { name: 'Free', slug: 'free', price_monthly: 0, price_yearly: 0, features: ['1,000 DMs per month', '3 active flows', '1 Instagram account', 'Basic analytics', 'Email support'] },
    ]).map((plan) => ({
      ...plan,
      yearly_discount_percent: plan.price_monthly > 0
        ? Math.max(0, Math.round((1 - (Number(plan.price_yearly || 0) / (Number(plan.price_monthly) * 12))) * 100))
        : 0,
    }));

    const maxDiscount = plans.reduce((max, plan) => Math.max(max, plan.yearly_discount_percent || 0), 0);

    return res.render('landing', {
      layout: 'layouts/public',
      title: 'FlowGram — Instagram Automation for Creators',
      plans,
      maxDiscount,
    });
  } catch (error) {
    logger.error('Landing page error', { error: error.message });
    return res.render('landing', {
      layout: 'layouts/public',
      title: 'FlowGram — Instagram Automation for Creators',
      plans: [
        { name: 'Free', slug: 'free', price_monthly: 0, price_yearly: 0, features: ['1,000 DMs per month', '3 active flows', '1 Instagram account', 'Basic analytics', 'Email support'], yearly_discount_percent: 0 },
      ],
      maxDiscount: 0,
    });
  }
});

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', time: new Date().toISOString(), env: process.env.NODE_ENV });
  } catch (e) {
    res.status(500).json({ status: 'error', db: 'down' });
  }
});

// ── Session Test ──────────────────────────────────────────────────────────
app.get('/test-session', (req, res) => {
  res.json({ 
    session: req.session, 
    user: req.session?.user || null,
    sessionID: req.sessionID,
    hasCookie: !!req.cookies['fg.sid']
  });
});

// ── 404 ───────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('errors/404', { layout: 'layouts/public', title: '404 — Page Not Found' });
});

// ── Error Handler ─────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack, url: req.url });
  const status = err.status || 500;
  res.status(status).render('errors/500', { layout: 'layouts/public', title: 'Server Error', error: process.env.NODE_ENV === 'development' ? err : {} });
});

// ── Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`🚀 FlowGram running on port ${PORT} [${process.env.NODE_ENV}]`);
});

// ── Cron Jobs ─────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const cron = require('node-cron');
  cron.schedule('0 0 * * *', () => {
    pool.query('UPDATE ig_accounts SET daily_dm_count = 0, daily_dm_date = CURRENT_DATE WHERE daily_dm_date < CURRENT_DATE')
      .then(() => logger.info('Daily DM counters reset'))
      .catch(err => logger.error('Cron error', { error: err.message }));
  });
}

module.exports = app;
