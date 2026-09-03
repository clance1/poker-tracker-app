FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS development
ENV NODE_ENV=development
CMD ["npm", "start"]

FROM dependencies AS build
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Retain wget for the existing production Compose health check.
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/server ./server
COPY package.json ./
EXPOSE 3001
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=12 \
  CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1
CMD ["node", "server/index.js"]
