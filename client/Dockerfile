# --- STAGE 1: BUILDER ---
FROM node:22-alpine AS builder

WORKDIR /app

# 1. Copy Manifests (Root + Shared + Client)
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY client/package.json ./client/

# 2. Install dependencies
# npm ci will now automatically pick the correct rollup binary 
# based on the CPU architecture (ARM64 vs x64).
RUN npm ci

# 3. Copy Source Code
COPY shared ./shared
COPY client ./client

# 4. Build Shared Library
RUN npm run build --workspace=@typeordie/shared

# 5. Build Client
ARG VITE_API_URL
RUN npm run build --workspace=client

# --- STAGE 2: SERVE ---
FROM nginx:alpine

# 6. Copy build output
COPY --from=builder /app/client/dist /usr/share/nginx/html

# 7. Copy Nginx config
COPY client/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]