# ── Build stage ──────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Install deps (with dev deps for the build).
COPY package*.json ./
RUN npm ci

# Generate Prisma client + compile.
COPY . .
RUN npx prisma generate && npm run build

# ── Runtime stage ────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Bring over the build output, Prisma schema/migrations, generated client, and static assets.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/public ./public

EXPOSE 3038

# Apply migrations, then start. (Checkpointer schema is created at boot.)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
