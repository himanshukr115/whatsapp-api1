// src/routes/instagram.js
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const db = require('../../config/database');
const axios = require('axios');
const logger = require('../utils/logger');

// ── Connect via Access Token (Manual) ─────────────────────────────────────
router.post('/connect/token', requireAuth, async (req, res) => {
  const { access_token } = req.body;
  const userId = req.session.user.id;

  if (!access_token) {
    return res.json({ success: false, error: 'Access token is required.' });
  }

  try {
    // Step 1: Get long-lived token
    let longLivedToken = access_token;
    try {
      if (process.env.META_APP_ID && process.env.META_APP_SECRET) {
        const ltRes = await axios.get('https://graph.facebook.com/oauth/access_token', {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: process.env.META_APP_ID,
            client_secret: process.env.META_APP_SECRET,
            fb_exchange_token: access_token,
          },
        });
        longLivedToken = ltRes.data.access_token || access_token;
      }
    } catch (e) {
      // If exchange fails, use original token
      longLivedToken = access_token;
    }

    // Step 2: Get Instagram Business Account via /me/accounts (Pages)
    const pagesRes = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
      params: { access_token: longLivedToken, fields: 'id,name,instagram_business_account,access_token' },
    });

    const pages = pagesRes.data?.data || [];
    const connectedAccounts = [];

    for (const page of pages) {
      if (!page.instagram_business_account) continue;

      const igId = page.instagram_business_account.id;
      const pageToken = page.access_token || longLivedToken;

      // Step 3: Get IG profile
      const igRes = await axios.get(`https://graph.facebook.com/v19.0/${igId}`, {
        params: {
          access_token: pageToken,
          fields: 'id,username,name,profile_picture_url,followers_count,account_type',
        },
      });

      const ig = igRes.data;

      // Upsert into db
      await db.query(`
        INSERT INTO ig_accounts (user_id, ig_user_id, username, display_name, avatar_url, followers_count, access_token, is_active, account_type, webhook_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, FALSE)
        ON CONFLICT (ig_user_id) DO UPDATE SET
          user_id = $1, username = $3, display_name = $4, avatar_url = $5,
          followers_count = $6, access_token = $7, is_active = TRUE, updated_at = NOW()
      `, [userId, ig.id, ig.username, ig.name, ig.profile_picture_url || null,
          ig.followers_count || 0, pageToken, ig.account_type || 'BUSINESS']);

      connectedAccounts.push({ username: ig.username, followers: ig.followers_count });
    }

    // Try direct IG user token if no pages found
    if (connectedAccounts.length === 0) {
      try {
        const meRes = await axios.get('https://graph.facebook.com/v19.0/me', {
          params: {
            access_token: longLivedToken,
            fields: 'id,username,name,profile_picture_url,followers_count,account_type',
          },
        });
        const ig = meRes.data;
        if (ig.username) {
          await db.query(`
            INSERT INTO ig_accounts (user_id, ig_user_id, username, display_name, avatar_url, followers_count, access_token, is_active, account_type)
            VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, 'BUSINESS')
            ON CONFLICT (ig_user_id) DO UPDATE SET
              user_id = $1, username = $3, display_name = $4, avatar_url = $5,
              followers_count = $6, access_token = $7, is_active = TRUE, updated_at = NOW()
          `, [userId, ig.id, ig.username, ig.name, ig.profile_picture_url || null,
              ig.followers_count || 0, longLivedToken]);
          connectedAccounts.push({ username: ig.username, followers: ig.followers_count });
        }
      } catch (e) {
        logger.warn('Direct IG token attempt failed', { error: e.message });
      }
    }

    if (connectedAccounts.length === 0) {
      return res.json({
        success: false,
        error: 'No Instagram Business accounts found. Make sure your Instagram is connected to a Facebook Page and is a Business or Creator account.',
      });
    }

    logger.info('Instagram connected via token', { userId, accounts: connectedAccounts.length });
    return res.json({ success: true, accounts: connectedAccounts });

  } catch (err) {
    logger.error('Instagram connect error', { error: err.message, data: err.response?.data });
    const msg = err.response?.data?.error?.message || 'Invalid token or API error. Please check your access token.';
    return res.json({ success: false, error: msg });
  }
});

// ── OAuth Flow (Meta Login) ───────────────────────────────────────────────
router.get('/connect/oauth', requireAuth, (req, res) => {
  if (!process.env.META_APP_ID) {
    req.flash('error', 'Meta App ID not configured. Use manual token connection.');
    return res.redirect('/settings');
  }

  const redirectUri = `${process.env.APP_URL}/instagram/oauth/callback`;
  const scope = [
    'instagram_basic',
    'instagram_manage_messages',
    'instagram_manage_comments',
    'pages_manage_metadata',
    'pages_read_engagement',
    'pages_show_list',
    'business_management',
  ].join(',');

  const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${process.env.META_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&response_type=code&state=${req.session.user.id}`;
  res.redirect(url);
});

// ── OAuth Callback ────────────────────────────────────────────────────────
router.get('/oauth/callback', requireAuth, async (req, res) => {
  const { code, error: oauthError } = req.query;

  if (oauthError) {
    req.flash('error', 'Instagram connection was cancelled.');
    return res.redirect('/settings?tab=instagram');
  }

  if (!code) {
    req.flash('error', 'No authorization code received.');
    return res.redirect('/settings?tab=instagram');
  }

  try {
    const redirectUri = `${process.env.APP_URL}/instagram/oauth/callback`;
    const tokenRes = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        client_id: process.env.META_APP_ID,
        client_secret: process.env.META_APP_SECRET,
        redirect_uri: redirectUri,
        code,
      },
    });

    const shortToken = tokenRes.data.access_token;

    // Exchange for long-lived token
    const llRes = await axios.get('https://graph.facebook.com/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: process.env.META_APP_ID,
        client_secret: process.env.META_APP_SECRET,
        fb_exchange_token: shortToken,
      },
    });

    const longToken = llRes.data.access_token;

    // Forward to token connect
    req.body = { access_token: longToken };
    const fakeRes = {
      json: (data) => {
        if (data.success) {
          req.flash('success', `✅ Instagram connected! (${data.accounts.map(a => '@' + a.username).join(', ')})`);
        } else {
          req.flash('error', data.error);
        }
        res.redirect('/settings?tab=instagram');
      },
    };

    // Reuse token connect logic
    const pagesRes = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
      params: { access_token: longToken, fields: 'id,name,instagram_business_account,access_token' },
    });

    const pages = pagesRes.data?.data || [];
    let connected = 0;

    for (const page of pages) {
      if (!page.instagram_business_account) continue;
      const igId = page.instagram_business_account.id;
      const pageToken = page.access_token || longToken;
      const igRes = await axios.get(`https://graph.facebook.com/v19.0/${igId}`, {
        params: { access_token: pageToken, fields: 'id,username,name,profile_picture_url,followers_count,account_type' },
      });
      const ig = igRes.data;
      await db.query(`
        INSERT INTO ig_accounts (user_id, ig_user_id, username, display_name, avatar_url, followers_count, access_token, is_active, account_type)
        VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8)
        ON CONFLICT (ig_user_id) DO UPDATE SET user_id=$1,username=$3,access_token=$7,is_active=TRUE,updated_at=NOW()
      `, [req.session.user.id, ig.id, ig.username, ig.name, ig.profile_picture_url||null, ig.followers_count||0, pageToken, ig.account_type||'BUSINESS']);
      connected++;
    }

    if (connected > 0) {
      req.flash('success', `✅ Instagram account(s) connected successfully via Meta Login!`);
    } else {
      req.flash('error', 'No Instagram Business accounts found on that Facebook account.');
    }
    res.redirect('/settings?tab=instagram');

  } catch (err) {
    logger.error('OAuth callback error', { error: err.message });
    req.flash('error', 'Failed to connect Instagram. Please try again.');
    res.redirect('/settings?tab=instagram');
  }
});

// ── Get Posts for an account ──────────────────────────────────────────────
router.get('/posts/:accountId', requireAuth, async (req, res) => {
  try {
    const acc = await db.query('SELECT * FROM ig_accounts WHERE id=$1 AND user_id=$2', [req.params.accountId, req.session.user.id]);
    if (!acc.rows.length) return res.json({ success: false, error: 'Account not found' });

    const ig = acc.rows[0];
    const postsRes = await axios.get(`https://graph.facebook.com/v19.0/${ig.ig_user_id}/media`, {
      params: {
        access_token: ig.access_token,
        fields: 'id,caption,media_type,media_url,thumbnail_url,timestamp,like_count,comments_count,permalink',
        limit: 20,
      },
    });

    res.json({ success: true, posts: postsRes.data?.data || [] });
  } catch (err) {
    logger.error('Get posts error', { error: err.message });
    res.json({ success: false, error: 'Failed to fetch posts. Token may be expired.' });
  }
});

// ── Save post-keyword mapping ─────────────────────────────────────────────
router.post('/post-trigger', requireAuth, async (req, res) => {
  const { ig_account_id, ig_post_id, keywords, flow_id, trigger_on } = req.body;
  const userId = req.session.user.id;

  try {
    const kwList = Array.isArray(keywords) ? keywords : (keywords || '').split(',').map(k => k.trim()).filter(Boolean);

    for (const kw of kwList) {
      await db.query(`
        INSERT INTO keywords (user_id, flow_id, ig_account_id, keyword, match_type, trigger_on, is_active)
        VALUES ($1, $2, $3, $4, 'contains', $5, TRUE)
        ON CONFLICT DO NOTHING
      `, [userId, flow_id || null, ig_account_id || null, kw.toLowerCase(), trigger_on || 'both']);
    }

    // Store post trigger mapping if post selected
    if (ig_post_id) {
      await db.query(`
        INSERT INTO analytics_events (user_id, ig_account_id, event_type, metadata)
        VALUES ($1, $2, 'post_trigger_set', $3)
      `, [userId, ig_account_id || null, JSON.stringify({ ig_post_id, keywords: kwList, flow_id })]);
    }

    res.json({ success: true, message: `${kwList.length} keyword(s) saved!` });
  } catch (err) {
    logger.error('Save post trigger error', { error: err.message });
    res.json({ success: false, error: 'Failed to save keywords.' });
  }
});

module.exports = router;