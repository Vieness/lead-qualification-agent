FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @lead-agent/web
COPY apps/web apps/web
# Sample leads are bundled into the UI ("Try a sample" buttons)
COPY data/samples data/samples
# Form limits shared with the API (plain constants, no dependencies)
COPY apps/api/src/contracts/limits.ts apps/api/src/contracts/limits.ts
# Type-checking (it needs the API contracts) runs in CI; the image only bundles
RUN pnpm --filter @lead-agent/web build:bundle

FROM nginx:1.29-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
