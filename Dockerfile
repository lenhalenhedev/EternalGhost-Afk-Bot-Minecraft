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
COPY . .

RUN mkdir -p /app/logs && chown -R node:node /app

USER node

VOLUME ["/app/logs"]
EXPOSE 8080

CMD ["npm", "run", "start"]
