# Build Stage
FROM node:20-alpine AS build

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

# Instalar dependencias globales del monorepo
RUN npm install

# Copiar el resto del código fuente
COPY . .

# Variables de build del cliente: Vite las inyecta en el bundle en tiempo de build.
# EasyPanel pasa las variables de "Entorno" también como build args.
ARG VITE_HUB_API_URL
ARG VITE_HUB_API_KEY
ENV VITE_HUB_API_URL=$VITE_HUB_API_URL
ENV VITE_HUB_API_KEY=$VITE_HUB_API_KEY

# Compilar la aplicación Portal con verificación estricta de tipos (tsc -b && vite build)
RUN npm run build --workspace=apps/portal

# Production Stage: Serving with Nginx
FROM nginx:stable-alpine

# Copiar los archivos compilados
COPY --from=build /app/apps/portal/dist /usr/share/nginx/html

# Copiar configuración de Nginx para rutas SPA de React
COPY apps/portal/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
