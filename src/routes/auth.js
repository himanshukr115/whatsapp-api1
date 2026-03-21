// src/routes/auth.js
const router = require('express').Router();
const auth = require('../controllers/authController');
const { requireAuth, requireGuest } = require('../middleware/auth');

router.get('/login', requireGuest, auth.showLogin);
router.post('/login', requireGuest, auth.login);
router.get('/register', requireGuest, auth.showRegister);
router.post('/register', requireGuest, auth.register);
router.get('/google', requireGuest, auth.googleLogin);
router.get('/google/callback', requireGuest, auth.googleCallback);
router.get('/logout', auth.logout);
router.get('/verify/:token', auth.verifyEmail);
router.get('/resend-verify', requireAuth, auth.resendVerification);
router.get('/forgot-password', requireGuest, auth.showForgotPassword);
router.post('/forgot-password', requireGuest, auth.forgotPassword);
router.get('/reset-password/:token', auth.showResetPassword);
router.post('/reset-password/:token', auth.resetPassword);

module.exports = router;
