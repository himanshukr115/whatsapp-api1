// src/routes/keywords.js
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const db = require('../../config/database');

router.get('/', requireAuth, async (req, res) => {
  const [keywords, flows] = await Promise.all([
    db.query(`SELECT k.*, f.name as flow_name FROM keywords k LEFT JOIN flows f ON f.id = k.flow_id WHERE k.user_id = $1 ORDER BY k.created_at DESC`, [req.session.user.id]),
    db.query('SELECT id, name FROM flows WHERE user_id = $1 ORDER BY name', [req.session.user.id]),
  ]);
  res.render('keywords/index', { layout: 'layouts/dashboard', title: 'Keywords', keywords: keywords.rows, flows: flows.rows });
});

router.post('/', requireAuth, async (req, res) => {
  const { keyword, match_type, trigger_on, flow_id } = req.body;
  if (!keyword) { req.flash('error', 'Keyword is required.'); return res.redirect('/keywords'); }
  await db.query(`INSERT INTO keywords (user_id, flow_id, keyword, match_type, trigger_on) VALUES ($1,$2,$3,$4,$5)`,
    [req.session.user.id, flow_id || null, keyword.toLowerCase().trim(), match_type || 'contains', trigger_on || 'both']);
  req.flash('success', 'Keyword added!');
  res.redirect('/keywords');
});

router.post('/:id/toggle', requireAuth, async (req, res) => {
  const kw = await db.query('SELECT * FROM keywords WHERE id = $1 AND user_id = $2', [req.params.id, req.session.user.id]);
  if (!kw.rows.length) return res.json({ error: 'Not found' });
  await db.query('UPDATE keywords SET is_active = $1 WHERE id = $2', [!kw.rows[0].is_active, req.params.id]);
  res.json({ active: !kw.rows[0].is_active });
});

router.delete('/:id', requireAuth, async (req, res) => {
  await db.query('DELETE FROM keywords WHERE id = $1 AND user_id = $2', [req.params.id, req.session.user.id]);
  req.flash('success', 'Keyword deleted.');
  res.redirect('/keywords');
});

module.exports = router;
