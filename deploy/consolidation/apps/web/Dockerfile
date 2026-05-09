# Build arg for browser-facing API URL (baked at build time). Default matches kubectl port-forward to api on 3001.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001

FROM node:22-slim AS builder
WORKDIR /workspace
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .npmrc ./
COPY apps/web/ apps/web/
RUN mkdir -p apps/web/public
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @cognitive-substrate/web build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
COPY --from=builder /workspace/apps/web/.next/standalone ./
COPY --from=builder /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /workspace/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
