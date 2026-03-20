// src/routes/webhooks.js
const router = require('express').Router();
const express = require('express');
const ctrl = require('../controllers/billingController');
const logger = require('../utils/logger');
const db = require('../../config/database');

// Raw body needed for signature verification
router.post('/razorpay', express.raw({ type: 'application/json' }), (req, res, next) => {
  req.body = JSON.parse(req.body);
  next();
}, ctrl.razorpayWebhook);

// Instagram webhook verification
router.get('/instagram', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    logger.info('Instagram webhook verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Instagram webhook events
router.post('/instagram', express.json(), async (req, res) => {
  try {
    const body = req.body;
    await db.query('INSERT INTO webhook_logs (source, event_type, payload) VALUES ($1,$2,$3)',
      ['instagram', body.object, body]);

    if (body.object === 'instagram') {
      for (const entry of (body.entry || [])) {
        for (const change of (entry.changes || [])) {
          logger.info('Instagram webhook event', { field: change.field });
          // Queue event processing here in production
        }
        for (const msg of (entry.messaging || [])) {
          logger.info('Instagram DM received', { senderId: msg.sender?.id });
          // Trigger flow processing here
        }
      }
    }
    res.sendStatus(200);
  } catch (err) {
    logger.error('Instagram webhook error', { error: err.message });
    res.sendStatus(500);
  }
});

module.exports = router;
