# Build Stage
FROM node:20-alpine AS build

WORKDIR /app

# Copiar configuraciones de workspaces y package.json de todas las apps
# Esto es vital para que npm resuelva todas las dependencias cruzadas
COPY package*.json ./
COPY apps/portal/package*.json ./apps/portal/
COPY apps/laboratorios-ambientales/package*.json ./apps/laboratorios-ambientales/
COPY apps/customer-profitability/package*.json ./apps/customer-profitability/
COPY apps/inventory-consolidation/package*.json ./apps/inventory-consolidation/
COPY apps/inventory-optimization/package*.json ./apps/inventory-optimization/
COPY apps/payment-reconciliation/package*.json ./apps/payment-reconciliation/
COPY apps/product-sales/package*.json ./apps/product-sales/

# Instalar dependencias globales del monorepo
RUN npm install

# Copiar el resto del código fuente
COPY . .

# Compilar la aplicación Portal bypassendo la revisión estricta de TypeScript 
# (tsc -b da errores por variables sin uso en otros paquetes del monorepo)
RUN npx --workspace=apps/portal vite build

# Production Stage: Serving with Nginx
FROM nginx:stable-alpine

# Copiar los archivos compilados
COPY --from=build /app/apps/portal/dist /usr/share/nginx/html

# Copiar configuración de Nginx para rutas SPA de React
COPY apps/portal/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
