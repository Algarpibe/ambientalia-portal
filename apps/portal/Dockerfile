# Use Node.js for building
FROM node:20-alpine AS build

WORKDIR /app

# Copy root workspace configuration
COPY package*.json ./
# Copy portal-specific metadata to leverage cache
COPY apps/portal/package*.json ./apps/portal/

# Install dependencies for the whole workspace
RUN npm install

# Copy the rest of the source code
COPY . .

# Build the portal app
RUN npm run build --workspace=apps/portal

# Use Nginx to serve the static files
FROM nginx:stable-alpine
COPY --from=build /app/apps/portal/dist /usr/share/nginx/html

# Copy custom Nginx configuration for React SPA routing
COPY apps/portal/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
