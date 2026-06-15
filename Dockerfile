# Imagen única para API y worker (Railway corre 2 servicios con el mismo image,
# cambiando solo el start command). Incluye Chromium porque el worker bootstrapea
# Playwright para el crawler ACF. Ver docs/19-deploy-railway.md.
FROM node:22-bookworm

WORKDIR /app
RUN corepack enable

# 1) Dependencias (con devDeps: se necesitan para `nest build` y `prisma generate`).
#    pnpm 9 (packageManager pin) corre los postinstall sin gate.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# 2) Chromium + libs del SO para Playwright (lo usa el worker).
RUN pnpm exec playwright install --with-deps chromium

# 3) Código + build (genera el cliente Prisma y compila a dist/).
COPY . .
RUN pnpm prisma generate && pnpm build

ENV NODE_ENV=production

# Por defecto arranca la API. El worker se lanza con otro start command en Railway:
#   node dist/worker.main.js
CMD ["node", "dist/main.js"]
