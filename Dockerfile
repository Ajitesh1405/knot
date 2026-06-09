# ── Build stage ──────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Copy manifest + schema first so the `postinstall` (prisma generate) works.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci                      # postinstall runs `prisma generate`

# Compile.
COPY . .
RUN npm run build

# ── Runtime stage ────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Prod deps only — `prisma` is a runtime dep (for `migrate deploy`), so it
# stays. Schema is present, so postinstall regenerates the client here too.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force

# Build output, Prisma config, static assets.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/public ./public

EXPOSE 3038

# Apply migrations, then start. (Checkpointer schema is created at boot.)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
