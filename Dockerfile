# syntax=docker/dockerfile:1.7

ARG PLAYWRIGHT_IMAGE_TAG=v1.58.2-jammy

FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_IMAGE_TAG} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build && npm prune --omit=dev

FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_IMAGE_TAG} AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV PROGRESS_WS_PORT=3210
ENV PUBLIC_PROGRESS_WS_PORT=3210

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts ./scripts
RUN chmod +x /app/scripts/docker-entrypoint.sh

EXPOSE 3000
EXPOSE 3210

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
