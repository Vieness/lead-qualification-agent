FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @lead-agent/api
COPY apps/api apps/api
RUN pnpm --filter @lead-agent/api build \
  && pnpm deploy --filter @lead-agent/api --prod /out

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
COPY data/portfolio /data/portfolio
COPY data/companies.json /data/companies.json
USER node
EXPOSE 3000
# Apply migrations and seed the portfolio (both idempotent), then start the API.
# `exec` makes node PID 1 so it receives SIGTERM from `docker stop` and shuts down gracefully.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/db/seed.js && exec node dist/index.js"]
