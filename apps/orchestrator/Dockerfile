FROM node:22-slim AS builder
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .npmrc ./
COPY packages/ packages/
COPY apps/orchestrator/ apps/orchestrator/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @cognitive-substrate/orchestrator build

FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/apps/orchestrator/dist ./dist
COPY --from=builder /workspace/apps/orchestrator/package.json ./package.json
COPY --from=builder /workspace/packages ./packages
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/main.js"]
