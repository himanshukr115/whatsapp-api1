// src/routes/inbox.js
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const db = require('../../config/database');
const logger = require('../utils/logger');

router.get('/', requireAuth, async (req, res) => {
  const contacts = await db.query(`
    SELECT c.*, COUNT(m.id) FILTER (WHERE m.direction='in' AND m.created_at > COALESCE(c.last_message_at - INTERVAL '1 hour', '2000-01-01')) as unread_count,
    (SELECT content FROM messages WHERE contact_id=c.id ORDER BY created_at DESC LIMIT 1) as last_message
    FROM contacts c
    LEFT JOIN messages m ON m.contact_id = c.id
    WHERE c.user_id = $1
    GROUP BY c.id
    ORDER BY c.last_message_at DESC NULLS LAST LIMIT 50
  `, [req.session.user.id]);

  res.render('inbox/index', { layout: 'layouts/dashboard', title: 'DM Inbox', contacts: contacts.rows, activeContact: null, messages: [] });
});

router.get('/:contactId', requireAuth, async (req, res) => {
  const [contacts, contact, messages] = await Promise.all([
    db.query(`SELECT c.*, (SELECT content FROM messages WHERE contact_id=c.id ORDER BY created_at DESC LIMIT 1) as last_message FROM contacts c WHERE c.user_id=$1 ORDER BY c.last_message_at DESC NULLS LAST LIMIT 50`, [req.session.user.id]),
    db.query('SELECT * FROM contacts WHERE id=$1 AND user_id=$2', [req.params.contactId, req.session.user.id]),
    db.query('SELECT * FROM messages WHERE contact_id=$1 ORDER BY sent_at ASC LIMIT 100', [req.params.contactId]),
  ]);

  if (!contact.rows.length) return res.redirect('/inbox');

  res.render('inbox/index', {
    layout: 'layouts/dashboard', title: 'DM Inbox',
    contacts: contacts.rows, activeContact: contact.rows[0], messages: messages.rows,
  });
});

router.post('/:contactId/send', requireAuth, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.json({ error: 'Message required' });

  try {
    const contact = await db.query('SELECT * FROM contacts WHERE id=$1 AND user_id=$2', [req.params.contactId, req.session.user.id]);
    if (!contact.rows.length) return res.status(404).json({ error: 'Contact not found' });

    await db.query(`INSERT INTO messages (user_id, contact_id, ig_account_id, direction, content, is_automated) VALUES ($1,$2,$3,'out',$4,FALSE)`,
      [req.session.user.id, req.params.contactId, contact.rows[0].ig_account_id, content.trim()]);
    await db.query('UPDATE contacts SET last_message_at=NOW() WHERE id=$1', [req.params.contactId]);

    res.json({ success: true });
  } catch (err) {
    logger.error('Send message error', { error: err.message });
    res.status(500).json({ error: 'Failed to send' });
  }
});

module.exports = router;
