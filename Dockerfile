# One image serving both the website and the API on port 5000.
# Build:  docker build -t cab-system --build-arg VITE_GOOGLE_MAPS_API_KEY=your_browser_key .
# Run:    see DEPLOY.md (needs a volume at /data and production environment variables).

# ---- Website build ----
FROM node:22-bookworm-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --include=dev
COPY frontend/ ./
# The browser Maps key is public by nature; restrict it to your domain in Google Cloud.
ARG VITE_GOOGLE_MAPS_API_KEY=""
ARG VITE_API_BASE_URL=/api
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# ---- API dependencies (better-sqlite3 ships prebuilt Linux binaries) ----
FROM node:22-bookworm-slim AS api-deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# ---- Runtime ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=5000 DATA_DIR=/data STATIC_DIR=/app/frontend/dist
WORKDIR /app/backend
COPY --from=api-deps /app/backend/node_modules ./node_modules
COPY backend/package.json ./
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY --from=web /app/frontend/dist /app/frontend/dist
RUN mkdir -p /data && chown node:node /data
# Run as the unprivileged "node" user, never root.
USER node
VOLUME ["/data"]
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:5000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "src/server.js"]
