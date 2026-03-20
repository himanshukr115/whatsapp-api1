# Dockerfile
FROM node:20-alpine AS base

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Dependencies layer (cached separately)
FROM base AS deps
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Final image
FROM base AS production

ENV NODE_ENV=production
ENV PORT=3000

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Create necessary directories
RUN mkdir -p logs uploads && chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/app.js"]
