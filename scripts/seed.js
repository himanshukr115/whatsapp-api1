// scripts/seed.js
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🌱 Seeding database...');

    // Plans
    await client.query(`
      INSERT INTO plans (name, slug, price_monthly, price_yearly, dm_limit, flow_limit, ig_accounts, ai_replies, priority_support, features, sort_order)
      VALUES
        ('Free', 'free', 0, 0, 1000, 3, 1, FALSE, FALSE,
         '["1,000 DMs/month","3 active flows","Basic analytics","1 Instagram account","Email support"]', 1),
        ('Pro', 'pro', 99900, 999900, 10000, 20, 3, TRUE, FALSE,
         '["10,000 DMs/month","Unlimited flows","Advanced analytics","3 Instagram accounts","AI smart replies","Priority support"]', 2),
        ('Business', 'business', 299900, 2999900, 0, 0, 10, TRUE, TRUE,
         '["Unlimited DMs","Unlimited flows","Full analytics suite","10 Instagram accounts","AI smart replies","24/7 priority support","Custom webhooks","API access"]', 3)
      ON CONFLICT (slug) DO UPDATE SET
        price_monthly = EXCLUDED.price_monthly,
        price_yearly = EXCLUDED.price_yearly,
        features = EXCLUDED.features;
    `);

    // Demo admin user
    const hash = await bcrypt.hash('Admin@12345', 12);
    await client.query(`
      INSERT INTO users (email, password_hash, role, full_name, business_name, email_verified)
      VALUES ('admin@flowgram.in', $1, 'admin', 'Admin User', 'FlowGram', TRUE)
      ON CONFLICT (email) DO UPDATE SET role = 'admin';
    `, [hash]);

    console.log('✅ Seeding completed');
    console.log('   Plans: Free / Pro / Business created');
    console.log('   Admin: admin@flowgram.in / Admin@12345');
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

seed();
