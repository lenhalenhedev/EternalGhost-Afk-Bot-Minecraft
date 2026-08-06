# syntax=docker/dockerfile:1

# ---- deps: install production dependencies only ----
FROM node:24-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:24-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /app/logs && chown -R node:node /app

USER node

VOLUME ["/app/logs"]

CMD ["npm", "run", "start"]
