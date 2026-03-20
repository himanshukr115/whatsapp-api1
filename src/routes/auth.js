// src/routes/auth.js
const router = require('express').Router();
const auth = require('../controllers/authController');
const { requireGuest } = require('../middleware/auth');

router.get('/login', requireGuest, auth.showLogin);
router.post('/login', requireGuest, auth.login);
router.get('/register', requireGuest, auth.showRegister);
router.post('/register', requireGuest, auth.register);
router.get('/logout', auth.logout);
router.get('/verify/:token', auth.verifyEmail);
router.get('/forgot-password', requireGuest, auth.showForgotPassword);
router.post('/forgot-password', requireGuest, auth.forgotPassword);
router.get('/reset-password/:token', auth.showResetPassword);
router.post('/reset-password/:token', auth.resetPassword);

module.exports = router;
