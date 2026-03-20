// src/controllers/flowsController.js
const db = require('../../config/database');
const logger = require('../utils/logger');

exports.index = async (req, res) => {
  const { status = 'all' } = req.query;
  let where = 'WHERE f.user_id = $1';
  if (status === 'active') where += ' AND f.is_active = TRUE';
  if (status === 'paused') where += ' AND f.is_active = FALSE AND f.is_draft = FALSE';
  if (status === 'draft') where += ' AND f.is_draft = TRUE';

  const flows = await db.query(`
    SELECT f.*, ig.username as ig_username
    FROM flows f LEFT JOIN ig_accounts ig ON ig.id = f.ig_account_id
    ${where} ORDER BY f.created_at DESC
  `, [req.session.user.id]);

  res.render('flows/index', { layout: 'layouts/dashboard', title: 'Automations', flows: flows.rows, status });
};

exports.create = async (req, res) => {
  const igAccounts = await db.query('SELECT * FROM ig_accounts WHERE user_id = $1 AND is_active = TRUE', [req.session.user.id]);
  res.render('flows/create', { layout: 'layouts/dashboard', title: 'New Flow', igAccounts: igAccounts.rows });
};

exports.store = async (req, res) => {
  const { name, description, trigger_type, trigger_config, ig_account_id } = req.body;
  const userId = req.session.user.id;

  if (!name || !trigger_type) {
    req.flash('error', 'Flow name and trigger type are required.');
    return res.redirect('/flows/create');
  }

  // Check flow limit
  const count = await db.query('SELECT COUNT(*) FROM flows WHERE user_id = $1', [userId]);
  const limit = req.session.user.flow_limit;
  if (limit > 0 && parseInt(count.rows[0].count) >= limit) {
    req.flash('error', `You have reached your flow limit (${limit}). Please upgrade your plan.`);
    return res.redirect('/billing');
  }

  try {
    const { rows } = await db.query(`
      INSERT INTO flows (user_id, ig_account_id, name, description, trigger_type, trigger_config, nodes)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
    `, [userId, ig_account_id || null, name, description || '', trigger_type,
        JSON.stringify(typeof trigger_config === 'string' ? JSON.parse(trigger_config) : (trigger_config || {})),
        JSON.stringify([])]);

    req.flash('success', 'Flow created! Now add steps in the builder.');
    res.redirect(`/flows/${rows[0].id}/edit`);
  } catch (err) {
    logger.error('Create flow error', { error: err.message });
    req.flash('error', 'Failed to create flow.');
    res.redirect('/flows/create');
  }
};

exports.edit = async (req, res) => {
  const flow = await db.query('SELECT * FROM flows WHERE id = $1 AND user_id = $2', [req.params.id, req.session.user.id]);
  if (!flow.rows.length) { req.flash('error', 'Flow not found.'); return res.redirect('/flows'); }
  const igAccounts = await db.query('SELECT * FROM ig_accounts WHERE user_id = $1', [req.session.user.id]);
  res.render('flows/edit', { layout: 'layouts/dashboard', title: 'Edit Flow', flow: flow.rows[0], igAccounts: igAccounts.rows });
};

exports.update = async (req, res) => {
  const { name, description, nodes, trigger_config, is_active } = req.body;
  try {
    await db.query(`
      UPDATE flows SET name=$1, description=$2, nodes=$3, trigger_config=$4, is_active=$5, is_draft=FALSE, updated_at=NOW()
      WHERE id=$6 AND user_id=$7
    `, [name, description, JSON.stringify(nodes ? JSON.parse(nodes) : []),
        JSON.stringify(trigger_config ? JSON.parse(trigger_config) : {}),
        is_active === 'true' || is_active === true,
        req.params.id, req.session.user.id]);
    req.flash('success', 'Flow saved!');
    res.redirect('/flows');
  } catch (err) {
    logger.error('Update flow error', { error: err.message });
    req.flash('error', 'Failed to save flow.');
    res.redirect(`/flows/${req.params.id}/edit`);
  }
};

exports.toggleActive = async (req, res) => {
  const flow = await db.query('SELECT * FROM flows WHERE id = $1 AND user_id = $2', [req.params.id, req.session.user.id]);
  if (!flow.rows.length) return res.json({ error: 'Not found' });
  const newState = !flow.rows[0].is_active;
  await db.query('UPDATE flows SET is_active = $1, is_draft = FALSE, updated_at = NOW() WHERE id = $2', [newState, req.params.id]);
  res.json({ active: newState });
};

exports.destroy = async (req, res) => {
  await db.query('DELETE FROM flows WHERE id = $1 AND user_id = $2', [req.params.id, req.session.user.id]);
  req.flash('success', 'Flow deleted.');
  res.redirect('/flows');
};
