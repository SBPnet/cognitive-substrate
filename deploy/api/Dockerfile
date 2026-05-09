FROM node:22-slim AS builder
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .npmrc ./
COPY packages/ packages/
COPY apps/api/ apps/api/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter api build

FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/apps/api/dist ./dist
COPY --from=builder /workspace/apps/api/package.json ./package.json
COPY --from=builder /workspace/packages ./packages
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/main.js"]
