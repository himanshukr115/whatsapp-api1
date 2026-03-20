# 🚀 FlowGram — Production Deployment on Digital Ocean

## Prerequisites
- Digital Ocean Droplet: Ubuntu 22.04 LTS, 2 vCPU, 4GB RAM minimum
- Domain name pointed to your droplet IP (A record)
- GitHub repo with your code

---

## Step 1 — Initial Droplet Setup

```bash
# SSH in as root
ssh root@YOUR_DROPLET_IP

# Create deploy user
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
su - deploy

# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker deploy
newgrp docker

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install git and other tools
sudo apt install -y git certbot ufw htop
```

---

## Step 2 — Firewall Setup

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

---

## Step 3 — Clone and Configure

```bash
# Clone your repo
cd /home/deploy
git clone https://github.com/YOUR_USERNAME/flowgram.git
cd flowgram

# Create .env from example
cp .env.example .env
nano .env
# → Fill in ALL values (DB password, secrets, API keys, etc.)

# Generate strong secrets:
# SESSION_SECRET:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# JWT_SECRET:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## Step 4 — SSL Certificate (Let's Encrypt)

```bash
# Get SSL cert BEFORE starting nginx
sudo certbot certonly --standalone \
  --non-interactive \
  --agree-tos \
  --email your@email.com \
  -d yourdomain.com \
  -d www.yourdomain.com

# Update nginx.conf: replace 'yourdomain.com' with your actual domain
sed -i 's/yourdomain.com/YOURDOMAIN.COM/g' nginx/nginx.conf
```

---

## Step 5 — Build and Start

```bash
# Build the Docker image
docker-compose build --no-cache

# Start all services
docker-compose up -d

# Check all containers are running
docker-compose ps

# Watch logs
docker-compose logs -f app

# Run database migrations
docker-compose exec app node scripts/migrate.js

# Seed initial data (plans + admin user)
docker-compose exec app node scripts/seed.js
```

---

## Step 6 — Verify Deployment

```bash
# Health check
curl https://yourdomain.com/health
# Should return: {"status":"ok","time":"...","env":"production"}

# Check all containers
docker-compose ps
# Should show: app, db, redis, nginx — all "Up"

# View app logs
docker-compose logs app --tail=50

# View nginx access logs
docker-compose logs nginx --tail=20
```

---

## Step 7 — SSL Auto-Renewal

```bash
# Create cron job for SSL renewal
sudo crontab -e
# Add this line:
0 3 * * * certbot renew --quiet && docker-compose -f /home/deploy/flowgram/docker-compose.yml restart nginx
```

---

## Maintenance Commands

```bash
# Deploy updates
cd /home/deploy/flowgram
git pull origin main
docker-compose build app --no-cache
docker-compose up -d app
docker-compose exec app node scripts/migrate.js

# Restart app only
docker-compose restart app

# View real-time logs
docker-compose logs -f app

# Database backup
docker-compose exec db pg_dump -U $DB_USER $DB_NAME > backup_$(date +%Y%m%d).sql

# Restore database
cat backup_20250101.sql | docker-compose exec -T db psql -U $DB_USER $DB_NAME

# Scale (if moving to larger droplet)
docker-compose up -d --scale app=2

# Enter app container shell
docker-compose exec app sh

# Enter database shell
docker-compose exec db psql -U flowgram_user flowgram_db
```

---

## Monitoring Setup (Optional)

```bash
# Install Netdata for server monitoring
bash <(curl -Ss https://my-netdata.io/kickstart.sh)
# Access at: http://YOUR_IP:19999

# Or use DigitalOcean's built-in monitoring
# → Droplet → Enable monitoring in DO panel
```

---

## Scaling to 10K+ Users

When you outgrow a single droplet:

1. **Database**: Move to DO Managed PostgreSQL ($50/mo)
2. **Redis**: Move to DO Managed Redis ($15/mo)
3. **App**: Scale to 2-4 app instances behind load balancer
4. **Media**: Move uploads to DO Spaces (S3-compatible, $5/mo)
5. **CDN**: Enable DO CDN on Spaces for global static assets

**Estimated cost for 10K users:**
- 2x app droplet (4GB): $48/mo
- Managed PostgreSQL: $50/mo
- Managed Redis: $15/mo
- DO Spaces: $5/mo
- **Total: ~$120/month**

---

## Environment Variables Reference

| Variable | Description | Required |
|---|---|---|
| DATABASE_URL | PostgreSQL connection string | ✅ |
| REDIS_URL | Redis connection string | ✅ |
| SESSION_SECRET | 64-char random string | ✅ |
| JWT_SECRET | 64-char random string | ✅ |
| APP_URL | Your full domain with https | ✅ |
| RAZORPAY_KEY_ID | From Razorpay dashboard | 💳 |
| RAZORPAY_KEY_SECRET | From Razorpay dashboard | 💳 |
| CASHFREE_APP_ID | From Cashfree dashboard | 💳 |
| CASHFREE_SECRET_KEY | From Cashfree dashboard | 💳 |
| SMTP_HOST | Your SMTP server | 📧 |
| META_APP_ID | From Meta Developers | 📱 |

---

## Support
- Health endpoint: `GET /health`
- Logs: `docker-compose logs -f app`
- DB: `docker-compose exec db psql -U flowgram_user flowgram_db`
