// scripts/migrate.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const migrations = `
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Users ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255) NOT NULL,
  business_name VARCHAR(255),
  avatar_url    VARCHAR(500),
  email_verified BOOLEAN DEFAULT FALSE,
  email_verify_token VARCHAR(255),
  reset_token   VARCHAR(255),
  reset_token_expires TIMESTAMPTZ,
  timezone      VARCHAR(100) DEFAULT 'Asia/Kolkata',
  is_active     BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Plans ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(100) NOT NULL,
  slug          VARCHAR(50) UNIQUE NOT NULL,
  price_monthly INTEGER NOT NULL DEFAULT 0,
  price_yearly  INTEGER NOT NULL DEFAULT 0,
  dm_limit      INTEGER NOT NULL DEFAULT 1000,
  flow_limit    INTEGER NOT NULL DEFAULT 3,
  ig_accounts   INTEGER NOT NULL DEFAULT 1,
  ai_replies    BOOLEAN DEFAULT FALSE,
  priority_support BOOLEAN DEFAULT FALSE,
  features      JSONB DEFAULT '[]',
  is_active     BOOLEAN DEFAULT TRUE,
  sort_order    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Subscriptions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id        UUID NOT NULL REFERENCES plans(id),
  status         VARCHAR(50) DEFAULT 'active',
  billing_cycle  VARCHAR(20) DEFAULT 'monthly',
  current_period_start TIMESTAMPTZ DEFAULT NOW(),
  current_period_end   TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  payment_gateway VARCHAR(50),
  gateway_subscription_id VARCHAR(255),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Payments ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id),
  plan_id         UUID REFERENCES plans(id),
  amount          INTEGER NOT NULL,
  currency        VARCHAR(10) DEFAULT 'INR',
  status          VARCHAR(50) DEFAULT 'pending',
  gateway         VARCHAR(50) NOT NULL,
  gateway_order_id   VARCHAR(255),
  gateway_payment_id VARCHAR(255),
  gateway_signature  VARCHAR(500),
  invoice_url     VARCHAR(500),
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Instagram Accounts ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ig_accounts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ig_user_id      VARCHAR(100) UNIQUE NOT NULL,
  username        VARCHAR(255) NOT NULL,
  display_name    VARCHAR(255),
  avatar_url      VARCHAR(500),
  followers_count INTEGER DEFAULT 0,
  access_token    TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT TRUE,
  account_type    VARCHAR(50) DEFAULT 'BUSINESS',
  webhook_active  BOOLEAN DEFAULT FALSE,
  daily_dm_count  INTEGER DEFAULT 0,
  daily_dm_date   DATE DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Flows (Automations) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flows (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ig_account_id   UUID REFERENCES ig_accounts(id) ON DELETE SET NULL,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  trigger_type    VARCHAR(100) NOT NULL,
  trigger_config  JSONB DEFAULT '{}',
  nodes           JSONB DEFAULT '[]',
  is_active       BOOLEAN DEFAULT FALSE,
  is_draft        BOOLEAN DEFAULT TRUE,
  trigger_count   INTEGER DEFAULT 0,
  success_count   INTEGER DEFAULT 0,
  last_triggered_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Keywords ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS keywords (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flow_id         UUID REFERENCES flows(id) ON DELETE CASCADE,
  ig_account_id   UUID REFERENCES ig_accounts(id) ON DELETE SET NULL,
  keyword         VARCHAR(255) NOT NULL,
  match_type      VARCHAR(50) DEFAULT 'contains',
  trigger_on      VARCHAR(50) DEFAULT 'both',
  is_active       BOOLEAN DEFAULT TRUE,
  trigger_count   INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Contacts (DM users) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ig_account_id   UUID REFERENCES ig_accounts(id) ON DELETE SET NULL,
  ig_user_id      VARCHAR(100) NOT NULL,
  username        VARCHAR(255),
  display_name    VARCHAR(255),
  avatar_url      VARCHAR(500),
  is_subscribed   BOOLEAN DEFAULT TRUE,
  tags            TEXT[] DEFAULT '{}',
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, ig_user_id)
);

-- ─── Messages ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  ig_account_id   UUID REFERENCES ig_accounts(id) ON DELETE SET NULL,
  flow_id         UUID REFERENCES flows(id) ON DELETE SET NULL,
  direction       VARCHAR(10) NOT NULL,
  content         TEXT,
  message_type    VARCHAR(50) DEFAULT 'text',
  ig_message_id   VARCHAR(255),
  status          VARCHAR(50) DEFAULT 'sent',
  is_automated    BOOLEAN DEFAULT FALSE,
  sent_at         TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Analytics Events ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ig_account_id   UUID REFERENCES ig_accounts(id) ON DELETE SET NULL,
  event_type      VARCHAR(100) NOT NULL,
  flow_id         UUID REFERENCES flows(id) ON DELETE SET NULL,
  contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Webhook Logs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source          VARCHAR(100) NOT NULL,
  event_type      VARCHAR(100),
  payload         JSONB,
  processed       BOOLEAN DEFAULT FALSE,
  error           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Sessions ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    varchar NOT NULL COLLATE "default",
  "sess"   json NOT NULL,
  "expire" timestamp(6) NOT NULL
) WITH (OIDS=FALSE);
ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- ─── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_flows_user ON flows(user_id);
CREATE INDEX IF NOT EXISTS idx_keywords_user ON keywords(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id);
CREATE INDEX IF NOT EXISTS idx_analytics_user ON analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at DESC);

-- ─── Updated_at trigger ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ language 'plpgsql';

DO $$ BEGIN
  CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE PROCEDURE update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE PROCEDURE update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE PROCEDURE update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running migrations...');
    await client.query(migrations);
    console.log('✅ Migrations completed successfully');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
