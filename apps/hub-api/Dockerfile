# Build context is the repo ROOT (needs .npmrc + apps/hub-api/*).
# In EasyPanel: Dockerfile path = apps/hub-api/Dockerfile, build context = repo root.
FROM node:20-alpine AS build
WORKDIR /app
ARG NPM_TOKEN
ENV NPM_TOKEN=$NPM_TOKEN
COPY apps/hub-api/package.json ./package.json
COPY .npmrc ./.npmrc
RUN npm install
COPY apps/hub-api/tsconfig.json ./tsconfig.json
COPY apps/hub-api/src ./src
RUN npm run build
ENV NPM_TOKEN=""

FROM node:20-alpine AS runtime
WORKDIR /app
ARG NPM_TOKEN
ENV NPM_TOKEN=$NPM_TOKEN
COPY apps/hub-api/package.json ./package.json
COPY .npmrc ./.npmrc
RUN npm install --omit=dev
ENV NPM_TOKEN=""
COPY --from=build /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/index.js"]
