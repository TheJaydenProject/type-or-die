# --- STAGE 1: BUILDER ---
FROM node:18-alpine AS builder

WORKDIR /app

# 1. Copy Manifests (Root + Shared + Server) to install dependencies
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/

# 2. Install ALL dependencies
RUN npm ci

# 3. Copy Source Code
COPY shared ./shared
COPY server ./server

# 4. Build Shared Library
RUN npm run build --workspace=@typeordie/shared

# 5. Build Server
RUN npm run build --workspace=@typeordie/server

# --- STAGE 2: RUNNER ---
FROM node:18-alpine

WORKDIR /app

# 1. Copy only necessary files from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# 2. Copy the compiled artifacts
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/shared/package.json ./shared/
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/package.json ./server/

# 3. [FIX] Manually copy Lua scripts to the expected runtime location
# The code expects them in dist/lua because of how the path is resolved in utils/luaScripts.ts
COPY --from=builder /app/server/src/lua ./server/dist/lua

# 4. Set Environment
ENV NODE_ENV=production

EXPOSE 3001

# 5. Run the compiled JS
CMD ["node", "server/dist/index.js"]