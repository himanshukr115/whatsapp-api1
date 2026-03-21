const router = require('express').Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/adminController');

router.get('/', requireAuth, requireAdmin, ctrl.index);
router.post('/plans', requireAuth, requireAdmin, ctrl.createPlan);

module.exports = router;
