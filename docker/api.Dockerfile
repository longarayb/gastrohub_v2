# API image (used by `docker compose --profile full`).
FROM node:24-alpine AS base
RUN corepack enable pnpm
WORKDIR /repo

FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2 prune @gastrohub/api --docker

FROM base AS build
COPY --from=prune /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
RUN pnpm turbo run build --filter=@gastrohub/api
RUN pnpm --filter @gastrohub/api deploy --prod --legacy /app

FROM node:24-alpine AS runtime
ENV NODE_ENV=production TZ=UTC
WORKDIR /app
COPY --from=build /app .
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/prisma ./prisma
COPY --from=build /repo/apps/api/prisma.config.ts ./prisma.config.ts
EXPOSE 3333
# Apply pending migrations on start, then run the API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
