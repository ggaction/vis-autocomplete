FROM node:22.23.4-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22.23.4-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends fonts-liberation fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=10000
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/vendor ./vendor
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/web/research ./web/research
COPY --from=build --chown=node:node /app/output/deploy ./output/deploy
USER node
EXPOSE 10000
CMD ["node", "scripts/server.js"]
