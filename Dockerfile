# ─── build stage ────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

# ─── runtime stage ──────────────────────────────────────────────
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# /assets (brand icons, wiki images, the built desktop shell in public/shell).
COPY --from=build /app/public ./public
COPY supabase ./supabase

EXPOSE 3000
# Simple healthcheck against the web server.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/healthz || exit 1

CMD ["node", "dist/index.js"]
