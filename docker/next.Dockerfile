# Next.js image for apps/web and apps/menu (build arg APP=web|menu).
FROM node:24-alpine AS base
RUN corepack enable pnpm
WORKDIR /repo
ARG APP

FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2 prune @app/${APP} --docker

FROM base AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:3333
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} NEXT_TELEMETRY_DISABLED=1
COPY --from=prune /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
RUN pnpm turbo run build --filter=@app/${APP}

FROM node:24-alpine AS runtime
ARG APP
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/${APP}/.next/standalone ./
COPY --from=build /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
ENV APP_DIR=apps/${APP}
EXPOSE 3000
CMD ["sh", "-c", "node ${APP_DIR}/server.js"]
