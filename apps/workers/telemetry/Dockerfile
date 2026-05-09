FROM node:22-slim AS base
RUN npm install -g pnpm@10
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .npmrc ./
COPY packages/ packages/
COPY apps/workers/telemetry/ apps/workers/telemetry/
RUN pnpm install --frozen-lockfile --prod=false
RUN pnpm --filter @cognitive-substrate/telemetry-worker... build

FROM node:22-slim AS runtime
RUN npm install -g pnpm@10
WORKDIR /app/apps/workers/telemetry
COPY --from=base /app/node_modules /app/node_modules
COPY --from=base /app/packages /app/packages
COPY --from=base /app/apps/workers/telemetry/dist ./dist
COPY --from=base /app/apps/workers/telemetry/package.json ./package.json
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/main.js"]
