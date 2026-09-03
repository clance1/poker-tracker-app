# ─── Build stage ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# better-sqlite3 publishes no musl (Alpine) prebuilt binaries for ANY version,
# so npm always falls back to compiling it with node-gyp. Without these three
# packages that fails with "Could not find any Python installation to use".
RUN apk add --no-cache python3 make g++

COPY package*.json ./

# npm ci, not `npm install ... || true`. The old form swallowed a failed install
# and carried on with a half-populated node_modules, which then surfaced much
# later and far less clearly as "sh: react-scripts: not found".
RUN npm ci

COPY . .
RUN npm run build

# Drop build- and test-only tooling (react-scripts and friends) here, BEFORE the
# runtime stage copies node_modules. Pruning after the copy would not shrink the
# image: layers are additive, so the files would still sit in the copied layer.
# Pruning rather than doing a fresh production install is deliberate, because a
# fresh install would try to recompile better-sqlite3 in the runtime stage,
# which has no toolchain.
RUN npm prune --omit=dev && npm cache clean --force

# ─── Runtime stage ──────────────────────────────────────────────────────────
# Separate stage so the C toolchain does not ship to production.
FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# The compiled better_sqlite3.node links against libstdc++ at runtime.
RUN apk add --no-cache libstdc++

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY package*.json ./
COPY server ./server

EXPOSE 3001

CMD ["node", "server/index.js"]
