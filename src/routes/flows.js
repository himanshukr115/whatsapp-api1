// src/routes/flows.js
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/flowsController');
router.get('/', requireAuth, ctrl.index);
router.get('/create', requireAuth, ctrl.create);
router.post('/', requireAuth, ctrl.store);
router.get('/:id/edit', requireAuth, ctrl.edit);
router.put('/:id', requireAuth, ctrl.update);
router.post('/:id/toggle', requireAuth, ctrl.toggleActive);
router.delete('/:id', requireAuth, ctrl.destroy);
module.exports = router;
