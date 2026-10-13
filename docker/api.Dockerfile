# API image (production, and `docker compose --profile full`).
# The migrations are a separate one-off step with this same image, before the API starts:
#   node_modules/.bin/prisma migrate deploy   (the `migrate` service of the compose files)
# Other commands of the image: node dist/cli/platform-admin.js, node dist/cli/demo-reset.js.
FROM node:24-alpine AS base
RUN corepack enable pnpm
WORKDIR /repo

FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2 prune @app/api --docker

FROM base AS build
COPY --from=prune /repo/out/json/ .
# The postinstall of @app/api runs `prisma generate`: it needs the schema and its config.
COPY --from=prune /repo/out/full/apps/api/prisma ./apps/api/prisma
COPY --from=prune /repo/out/full/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
RUN pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
# Generated again with the whole project in place: during the install the tsconfig was missing and
# the client would import its own files as ".ts" (fails at runtime).
RUN pnpm --filter @app/api exec prisma generate
RUN pnpm turbo run build --filter=@app/api
RUN pnpm --filter @app/api deploy --prod --legacy /app

FROM node:24-alpine AS runtime
ENV NODE_ENV=production TZ=UTC STORAGE_DIR=/data/uploads
WORKDIR /app
COPY --from=build --chown=node:node /app .
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
COPY --from=build --chown=node:node /repo/apps/api/prisma ./prisma
COPY --from=build --chown=node:node /repo/apps/api/prisma.config.ts ./prisma.config.ts
# Uploaded images (logos, product photos): a volume in production.
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
EXPOSE 3333
CMD ["node", "dist/main.js"]
