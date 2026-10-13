# Next.js image for apps/web, apps/menu and apps/admin (build arg APP=web|menu|admin).
# Production builds pass NEXT_PUBLIC_API_URL and NEXT_PUBLIC_MENU_URL EMPTY: the apps call /api on
# their own address (the proxy forwards it), so no domain is baked into the image.
FROM node:24-alpine AS base
RUN corepack enable pnpm
WORKDIR /repo
ARG APP

FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2 prune @app/${APP} --docker

FROM base AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:3333
ARG NEXT_PUBLIC_MENU_URL=http://localhost:3001
# Next build workers (low-memory machines: 1).
ARG NEXT_BUILD_CPUS=2
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} NEXT_PUBLIC_MENU_URL=${NEXT_PUBLIC_MENU_URL} \
    NEXT_BUILD_CPUS=${NEXT_BUILD_CPUS} NEXT_TELEMETRY_DISABLED=1
COPY --from=prune /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
COPY --from=prune /repo/scripts ./scripts
RUN pnpm turbo run build --filter=@app/${APP}

FROM node:24-alpine AS runtime
ARG APP
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 TZ=UTC
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/${APP}/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=build --chown=node:node /repo/apps/${APP}/public ./apps/${APP}/public
ENV APP_DIR=apps/${APP}
USER node
EXPOSE 3000
CMD ["sh", "-c", "node ${APP_DIR}/server.js"]
