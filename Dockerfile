# Build Stage
# INFRA-006 — imagen base pineada por digest (reproducibilidad/supply-chain).
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS build

WORKDIR /app

# Copiar configuraciones de workspaces y package.json de todas las apps
# Esto es vital para que npm resuelva todas las dependencias cruzadas
COPY package*.json ./
COPY apps/portal/package*.json ./apps/portal/
COPY apps/laboratorios-ambientales/package*.json ./apps/laboratorios-ambientales/
COPY apps/customer-profitability/package*.json ./apps/customer-profitability/
COPY apps/customer-valuation/package*.json ./apps/customer-valuation/
COPY apps/inventory-consolidation/package*.json ./apps/inventory-consolidation/
COPY apps/inventory-optimization/package*.json ./apps/inventory-optimization/
COPY apps/payment-reconciliation/package*.json ./apps/payment-reconciliation/
COPY apps/product-sales/package*.json ./apps/product-sales/
COPY apps/contabilidad/package*.json ./apps/contabilidad/
# WO-sales faltaba en esta lista: el build no se rompía porque el `COPY . .` de
# más abajo acaba trayendo su package.json, pero eso invalida la capa de
# `npm install` en cada cambio de código. Se añade junto con la app nueva.
COPY apps/WO-sales/package*.json ./apps/WO-sales/
COPY apps/ausencias/package*.json ./apps/ausencias/

# Instalar dependencias globales del monorepo
RUN npm install

# Copiar el resto del código fuente
COPY . .

# Variables de build del cliente: Vite las inyecta en el bundle en tiempo de build.
# EasyPanel pasa las variables de "Entorno" también como build args.
ARG VITE_HUB_API_URL
ARG VITE_SENTRY_DSN
ENV VITE_HUB_API_URL=$VITE_HUB_API_URL
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN

# Compilar la aplicación Portal con verificación estricta de tipos (tsc -b && vite build)
RUN npm run build --workspace=apps/portal

# Production Stage: Serving with Nginx
FROM nginx:stable-alpine@sha256:0d3b80406a13a767339fbe2f41406d6c7da727ab89cf8fae399e81f780f814d1

# Copiar los archivos compilados
COPY --from=build /app/apps/portal/dist /usr/share/nginx/html

# Copiar configuración de Nginx para rutas SPA de React
COPY apps/portal/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
# INFRA-002 — healthcheck del portal estático.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:80/ >/dev/null 2>&1 || exit 1
CMD ["nginx", "-g", "daemon off;"]
