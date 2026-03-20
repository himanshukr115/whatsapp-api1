// src/routes/dashboard.js
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/dashboardController');
router.get('/', requireAuth, ctrl.index);
module.exports = router;
