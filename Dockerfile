# ---- web: build the Vite frontend ----
FROM node:24-slim AS web-build

WORKDIR /app/web

COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- deps: install production backend dependencies only ----
FROM node:24-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:24-slim AS runtime

ENV NODE_ENV=production
ENV WEB_PORT=8080
ENV WEB_HTTPS=false

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=web-build /app/web/dist ./web/dist

# EG-012: copy an explicit allowlist of runtime artefacts instead of the whole
# build context. `COPY . .` shipped developer-only material into the production
# image -- the security audit report under report/, the browser-verification
# notes and other docs, the tasks/ probe helpers (which include a helper that
# binds a listener), the Dockerfile and compose file themselves -- plus any
# operator credential that happened to be sitting in the checkout. It also ran
# *after* the web-build stage, so a stale host-side web/dist silently replaced
# the freshly built bundle.
COPY package.json ./
COPY index.js run.js deploy-commands.js ./
COPY src/ ./src/

# Make only the log directory writable by the runtime user. The application
# code and node_modules stay root-owned and read-only for uid `node` so a
# compromised process cannot tamper with the code it executes (EG-011).
RUN mkdir -p /app/logs && chown -R node:node /app/logs

USER node

VOLUME ["/app/logs"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WEB_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Equivalent to `npm run start` but without the npm wrapper, which needs no
# writable filesystem beyond the log volume under a read-only rootfs.
CMD ["node", "index.js"]
