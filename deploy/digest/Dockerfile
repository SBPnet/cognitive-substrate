FROM node:22-slim AS builder
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .npmrc ./
COPY packages/ packages/
COPY apps/workers/digest/ apps/workers/digest/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @cognitive-substrate/digest-worker... build

FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/packages ./packages
COPY --from=builder /workspace/apps/workers/digest ./apps/workers/digest
WORKDIR /app/apps/workers/digest
ENV NODE_ENV=production
CMD ["node", "dist/main.js"]
