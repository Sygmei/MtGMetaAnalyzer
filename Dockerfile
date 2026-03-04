# syntax=docker/dockerfile:1.7

FROM mcr.microsoft.com/playwright:v1.55.0-jammy AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build && npm prune --omit=dev

FROM mcr.microsoft.com/playwright:v1.55.0-jammy AS runtime
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

EXPOSE 3000
EXPOSE 3210

CMD ["npm", "run", "start"]
