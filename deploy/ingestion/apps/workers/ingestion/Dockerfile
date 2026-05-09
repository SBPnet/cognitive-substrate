FROM node:22-slim AS base
RUN npm install -g pnpm@10

WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json .npmrc ./
COPY packages/core-types/package.json ./packages/core-types/
COPY packages/kafka-bus/package.json ./packages/kafka-bus/
COPY packages/memory-opensearch/package.json ./packages/memory-opensearch/
COPY packages/memory-objectstore/package.json ./packages/memory-objectstore/
COPY packages/telemetry-otel/package.json ./packages/telemetry-otel/
COPY apps/workers/ingestion/package.json ./apps/workers/ingestion/

RUN pnpm install --frozen-lockfile --prod=false

# Build sources
COPY packages/ ./packages/
COPY apps/workers/ingestion/ ./apps/workers/ingestion/

RUN pnpm --filter @cognitive-substrate/ingestion-worker... build

# Runtime stage — minimal image
FROM node:22-slim AS runtime
RUN npm install -g pnpm@10

WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages ./packages
COPY --from=base /app/apps/workers/ingestion ./apps/workers/ingestion

WORKDIR /app/apps/workers/ingestion

ENV NODE_ENV=production

EXPOSE 3000
CMD ["node", "dist/main.js"]
