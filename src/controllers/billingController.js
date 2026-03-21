// src/controllers/billingController.js
const crypto = require('crypto');
const axios = require('axios');
const db = require('../../config/database');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');

// ── Show Billing Page ─────────────────────────────────────────────────────
exports.showBilling = async (req, res) => {
  try {
    const [plans, subscription, payments] = await Promise.all([
      db.query(`
        SELECT *
        FROM plans
        WHERE is_active = TRUE
        ORDER BY sort_order
      `),
      db.query(`
        SELECT s.*, p.name as plan_name, p.slug as plan_slug, p.price_monthly, p.features
        FROM subscriptions s JOIN plans p ON p.id = s.plan_id
        WHERE s.user_id = $1 AND s.status = 'active' ORDER BY s.created_at DESC LIMIT 1
      `, [req.session.user.id]),
      db.query(`
        SELECT p.*, pl.name as plan_name FROM payments p
        LEFT JOIN plans pl ON pl.id = p.plan_id
        WHERE p.user_id = $1 ORDER BY p.created_at DESC LIMIT 10
      `, [req.session.user.id]),
    ]);

    const computedPlans = plans.rows.map((plan) => ({
      ...plan,
      yearly_discount_percent: plan.price_monthly > 0
        ? Math.max(0, Math.round((1 - (Number(plan.price_yearly || 0) / (Number(plan.price_monthly) * 12))) * 100))
        : 0,
    }));

    res.render('billing/index', {
      layout: 'layouts/dashboard',
      title: 'Billing & Plans',
      plans: computedPlans,
      currentSubscription: subscription.rows[0] || null,
      payments: payments.rows,
      razorpayKey: process.env.RAZORPAY_KEY_ID,
      cashfreeEnabled: Boolean(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY),
      razorpayEnabled: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
      maxYearlyDiscount: computedPlans.reduce((max, plan) => Math.max(max, plan.yearly_discount_percent || 0), 0),
    });
  } catch (err) {
    logger.error('Billing page error', { error: err.message });
    req.flash('error', 'Failed to load billing page.');
    res.redirect('/dashboard');
  }
};

// ── Create Razorpay Order ─────────────────────────────────────────────────
exports.createRazorpayOrder = async (req, res) => {
  const { plan_slug, billing_cycle } = req.body;
  try {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(400).json({ error: 'Razorpay is not configured.' });
    }
    const plan = await db.query("SELECT * FROM plans WHERE slug = $1 AND is_active = TRUE", [plan_slug]);
    if (!plan.rows.length) return res.status(404).json({ error: 'Plan not found' });

    const p = plan.rows[0];
    const amount = billing_cycle === 'yearly' ? p.price_yearly : p.price_monthly;
    if (!amount) return res.json({ free: true });

    // Create Razorpay order via API
    const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
    const { data: order } = await axios.post('https://api.razorpay.com/v1/orders', {
      amount,
      currency: 'INR',
      receipt: `fg_${Date.now()}`,
      notes: { plan_slug, billing_cycle, user_id: req.session.user.id }
    }, { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' } });

    // Save pending payment
    await db.query(`
      INSERT INTO payments (user_id, plan_id, amount, currency, status, gateway, gateway_order_id, metadata)
      VALUES ($1, $2, $3, 'INR', 'pending', 'razorpay', $4, $5)
    `, [req.session.user.id, p.id, amount, order.id, JSON.stringify({ billing_cycle })]);

    res.json({
      orderId: order.id,
      amount,
      currency: 'INR',
      planName: p.name,
      key: process.env.RAZORPAY_KEY_ID,
      prefill: {
        name: req.session.user.full_name,
        email: req.session.user.email,
      }
    });
  } catch (err) {
    logger.error('Razorpay order creation error', { error: err.message });
    res.status(500).json({ error: 'Failed to create payment order' });
  }
};

// ── Verify Razorpay Payment ───────────────────────────────────────────────
exports.verifyRazorpay = async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan_slug, billing_cycle } = req.body;
  try {
    // Verify signature
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSig !== razorpay_signature) {
      logger.warn('Razorpay signature mismatch', { userId: req.session.user.id });
      req.flash('error', 'Payment verification failed. Contact support.');
      return res.redirect('/billing');
    }

    await activateSubscription(req.session.user.id, plan_slug, billing_cycle, 'razorpay', razorpay_order_id, razorpay_payment_id, razorpay_signature);

    // Refresh session
    const { rows } = await db.query(`
      SELECT p.slug, p.name, p.dm_limit, p.flow_limit, p.ig_accounts
      FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.user_id = $1 AND s.status = 'active' ORDER BY s.created_at DESC LIMIT 1
    `, [req.session.user.id]);
    if (rows[0]) {
      req.session.user.plan_slug = rows[0].slug;
      req.session.user.plan_name = rows[0].name;
      req.session.user.dm_limit = rows[0].dm_limit;
      req.session.user.flow_limit = rows[0].flow_limit;
      req.session.user.ig_accounts_limit = rows[0].ig_accounts;
    }

    logger.info('Payment successful via Razorpay', { userId: req.session.user.id, plan: plan_slug });
    req.flash('success', `🎉 Payment successful! You are now on the ${plan_slug} plan.`);
    res.redirect('/billing');
  } catch (err) {
    logger.error('Razorpay verify error', { error: err.message });
    req.flash('error', 'Payment verification failed.');
    res.redirect('/billing');
  }
};

// ── Create Cashfree Order ─────────────────────────────────────────────────
exports.createCashfreeOrder = async (req, res) => {
  const { plan_slug, billing_cycle } = req.body;
  try {
    if (!process.env.CASHFREE_APP_ID || !process.env.CASHFREE_SECRET_KEY) {
      return res.status(400).json({ error: 'Cashfree is not configured.' });
    }
    const plan = await db.query("SELECT * FROM plans WHERE slug = $1 AND is_active = TRUE", [plan_slug]);
    if (!plan.rows.length) return res.status(404).json({ error: 'Plan not found' });

    const p = plan.rows[0];
    const amount = billing_cycle === 'yearly' ? p.price_yearly : p.price_monthly;
    if (!amount) return res.json({ free: true });

    const orderId = `FG${Date.now()}`;
    const amountInRupees = (amount / 100).toFixed(2);
    const baseUrl = process.env.NODE_ENV === 'production'
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg';

    const { data } = await axios.post(`${baseUrl}/orders`, {
      order_id: orderId,
      order_amount: amountInRupees,
      order_currency: 'INR',
      customer_details: {
        customer_id: req.session.user.id,
        customer_name: req.session.user.full_name,
        customer_email: req.session.user.email,
        customer_phone: '9999999999',
      },
      order_meta: {
        return_url: `${process.env.APP_URL}/billing/cashfree/callback?order_id={order_id}&plan=${plan_slug}&cycle=${billing_cycle}`,
      },
      order_note: `FlowGram ${p.name} Plan - ${billing_cycle}`,
    }, {
      headers: {
        'x-client-id': process.env.CASHFREE_APP_ID,
        'x-client-secret': process.env.CASHFREE_SECRET_KEY,
        'x-api-version': '2023-08-01',
        'Content-Type': 'application/json',
      }
    });

    await db.query(`
      INSERT INTO payments (user_id, plan_id, amount, currency, status, gateway, gateway_order_id, metadata)
      VALUES ($1, $2, $3, 'INR', 'pending', 'cashfree', $4, $5)
    `, [req.session.user.id, p.id, amount, orderId, JSON.stringify({ billing_cycle })]);

    res.json({ paymentSessionId: data.payment_session_id, orderId, appId: process.env.CASHFREE_APP_ID });
  } catch (err) {
    logger.error('Cashfree order error', { error: err.message });
    res.status(500).json({ error: 'Failed to create payment order' });
  }
};

// ── Cashfree Callback ─────────────────────────────────────────────────────
exports.cashfreeCallback = async (req, res) => {
  const { order_id, plan, cycle } = req.query;
  try {
    const baseUrl = process.env.NODE_ENV === 'production'
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg';

    const { data } = await axios.get(`${baseUrl}/orders/${order_id}`, {
      headers: {
        'x-client-id': process.env.CASHFREE_APP_ID,
        'x-client-secret': process.env.CASHFREE_SECRET_KEY,
        'x-api-version': '2023-08-01',
      }
    });

    if (data.order_status === 'PAID') {
      await activateSubscription(req.session.user.id, plan, cycle, 'cashfree', order_id, data.cf_order_id, null);
      req.flash('success', `🎉 Payment successful! You are now on the ${plan} plan.`);
    } else {
      req.flash('error', 'Payment was not completed.');
    }
  } catch (err) {
    logger.error('Cashfree callback error', { error: err.message });
    req.flash('error', 'Payment verification failed.');
  }
  res.redirect('/billing');
};

exports.directCheckout = async (req, res) => {
  const { plan_slug, billing_cycle } = req.body;
  const billingCycle = billing_cycle === 'yearly' ? 'yearly' : 'monthly';

  try {
    const plan = await db.query("SELECT * FROM plans WHERE slug = $1 AND is_active = TRUE", [plan_slug]);
    if (!plan.rows.length) {
      req.flash('error', 'Plan not found.');
      return res.redirect('/billing');
    }

    const p = plan.rows[0];
    const amount = billingCycle === 'yearly' ? p.price_yearly : p.price_monthly;
    const orderId = `MANUAL_${Date.now()}`;
    const paymentId = `manual_${Date.now()}`;

    await db.query(`
      INSERT INTO payments (user_id, plan_id, amount, currency, status, gateway, gateway_order_id, gateway_payment_id, metadata)
      VALUES ($1, $2, $3, 'INR', 'completed', 'manual', $4, $5, $6)
    `, [req.session.user.id, p.id, amount, orderId, paymentId, JSON.stringify({ billing_cycle: billingCycle, source: 'direct_checkout' })]);

    await activateSubscription(req.session.user.id, p.slug, billingCycle, 'manual', orderId, paymentId, null);

    req.flash('success', `Plan upgraded to ${p.name} (${billingCycle}).`);
    return res.redirect('/billing');
  } catch (error) {
    logger.error('Direct checkout error', { error: error.message, userId: req.session.user.id, plan: plan_slug });
    req.flash('error', 'Could not complete checkout.');
    return res.redirect('/billing');
  }
};

exports.cancelSubscription = async (req, res) => {
  try {
    await db.query(`
      UPDATE subscriptions
      SET cancel_at_period_end = TRUE, updated_at = NOW()
      WHERE user_id = $1 AND status = 'active'
    `, [req.session.user.id]);
    req.flash('success', 'Subscription cancellation scheduled at period end.');
  } catch (error) {
    logger.error('Cancel subscription error', { error: error.message, userId: req.session.user.id });
    req.flash('error', 'Unable to cancel subscription right now.');
  }
  return res.redirect('/billing');
};

// ── Razorpay Webhook ──────────────────────────────────────────────────────
exports.razorpayWebhook = async (req, res) => {
  const sig = req.headers['x-razorpay-signature'];
  const body = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');

  if (sig !== expected) return res.status(400).json({ error: 'Invalid signature' });

  try {
    await db.query('INSERT INTO webhook_logs (source, event_type, payload) VALUES ($1, $2, $3)',
      ['razorpay', req.body.event, req.body]);

    if (req.body.event === 'payment.captured') {
      const payment = req.body.payload.payment.entity;
      await db.query(`
        UPDATE payments SET status = 'completed', gateway_payment_id = $1, updated_at = NOW()
        WHERE gateway_order_id = $2
      `, [payment.id, payment.order_id]);
    }
    res.json({ status: 'ok' });
  } catch (err) {
    logger.error('Razorpay webhook error', { error: err.message });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

// ── Helper: Activate Subscription ────────────────────────────────────────
async function activateSubscription(userId, planSlug, billingCycle, gateway, orderId, paymentId, signature) {
  const plan = await db.query("SELECT * FROM plans WHERE slug = $1", [planSlug]);
  if (!plan.rows.length) throw new Error('Plan not found');
  const p = plan.rows[0];

  const amount = billingCycle === 'yearly' ? p.price_yearly : p.price_monthly;
  const endDate = new Date();
  billingCycle === 'yearly' ? endDate.setFullYear(endDate.getFullYear() + 1) : endDate.setMonth(endDate.getMonth() + 1);

  // Deactivate old subscriptions
  await db.query("UPDATE subscriptions SET status = 'cancelled' WHERE user_id = $1 AND status = 'active'", [userId]);

  // Create new subscription
  await db.query(`
    INSERT INTO subscriptions (user_id, plan_id, status, billing_cycle, current_period_start, current_period_end, payment_gateway)
    VALUES ($1, $2, 'active', $3, NOW(), $4, $5)
  `, [userId, p.id, billingCycle, endDate, gateway]);

  // Update payment record
  const metaData = { billing_cycle: billingCycle, ...(signature ? { signature } : {}) };
  await db.query(`
    UPDATE payments SET status = 'completed', gateway_payment_id = $1, gateway_signature = $2, updated_at = NOW()
    WHERE user_id = $3 AND gateway_order_id = $4
  `, [paymentId, signature || null, userId, orderId]);

  // Send receipt email
  const user = await db.query('SELECT email, full_name FROM users WHERE id = $1', [userId]);
  if (user.rows[0]) {
    await emailService.sendPaymentReceipt(user.rows[0].email, user.rows[0].full_name, p.name, amount / 100, billingCycle, paymentId);
  }
}
