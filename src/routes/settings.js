// src/routes/settings.js
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/settingsController');
router.get('/', requireAuth, ctrl.index);
router.post('/profile', requireAuth, ctrl.updateProfile);
router.post('/password', requireAuth, ctrl.updatePassword);
router.post('/ig/:id/disconnect', requireAuth, ctrl.disconnectIg);
router.post('/delete-account', requireAuth, ctrl.deleteAccount);
module.exports = router;
