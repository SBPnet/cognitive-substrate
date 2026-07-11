FROM node:22-slim AS builder
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .npmrc ./
COPY packages/ packages/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @cognitive-substrate/ingest-worker... build

FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/packages ./packages
WORKDIR /app/packages/ingest-worker
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
