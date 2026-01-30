# --- STAGE 1: BUILDER ---
FROM node:18-alpine AS builder

WORKDIR /app

# 1. Copy Manifests (Root + Shared + Client)
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY client/package.json ./client/

# 2. Install dependencies (Root level to handle workspaces)
RUN npm ci

# 2.5 CRITICAL FIX: Manually install the Linux Musl binary for Rollup
# This fixes the "Cannot find module @rollup/rollup-linux-x64-musl" error
# common when building on Alpine from a Windows-generated lockfile.
RUN npm install @rollup/rollup-linux-x64-musl --no-save

# 3. Copy Source Code (Shared + Client)
COPY shared ./shared
COPY client ./client

# 4. Build Shared Library (Client depends on this)
#    This generates the .d.ts files Vite needs
RUN npm run build --workspace=@typeordie/shared

# 5. Build Client
#    Targeting the workspace explicitly
RUN npm run build --workspace=client

# --- STAGE 2: SERVE ---
FROM nginx:alpine

# 6. Copy build output from the CLIENT workspace folder
COPY --from=builder /app/client/dist /usr/share/nginx/html

# 7. Copy Nginx config
COPY client/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]