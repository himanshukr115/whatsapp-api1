// src/routes/billing.js
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/billingController');
router.get('/', requireAuth, ctrl.showBilling);
router.post('/razorpay/order', requireAuth, ctrl.createRazorpayOrder);
router.post('/razorpay/verify', requireAuth, ctrl.verifyRazorpay);
router.post('/cashfree/order', requireAuth, ctrl.createCashfreeOrder);
router.get('/cashfree/callback', requireAuth, ctrl.cashfreeCallback);
router.post('/checkout', requireAuth, ctrl.directCheckout);
router.post('/cancel', requireAuth, ctrl.cancelSubscription);
module.exports = router;
