const router = require('express').Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/adminController');

router.get('/', requireAuth, requireAdmin, ctrl.index);
router.post('/plans', requireAuth, requireAdmin, ctrl.createPlan);
router.post('/plans/:planId/update', requireAuth, requireAdmin, ctrl.updatePlan);
router.post('/plans/:planId/delete', requireAuth, requireAdmin, ctrl.deletePlan);
router.post('/users/:userId/role', requireAuth, requireAdmin, ctrl.updateUserRole);

module.exports = router;
