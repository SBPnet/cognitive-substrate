FROM node:22-slim AS base
RUN npm install -g pnpm@10.33.2
WORKDIR /workspace
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .npmrc ./
COPY packages/ packages/
COPY apps/workers/aiven-collector/ apps/workers/aiven-collector/
RUN pnpm install --frozen-lockfile --prod=false
RUN pnpm --filter @cognitive-substrate/aiven-collector-worker... build

FROM node:22-slim AS runtime
RUN npm install -g pnpm@10.33.2
WORKDIR /app
COPY --from=base /workspace/node_modules /app/node_modules
COPY --from=base /workspace/packages /app/packages
COPY --from=base /workspace/apps/workers/aiven-collector ./apps/workers/aiven-collector
WORKDIR /app/apps/workers/aiven-collector
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/main.js"]
