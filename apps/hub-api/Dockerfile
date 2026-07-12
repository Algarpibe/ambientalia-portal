# Build context is the repo ROOT (needs .npmrc + apps/hub-api/*).
# In EasyPanel: Dockerfile path = apps/hub-api/Dockerfile, build context = repo root.
# NPM_TOKEN is an ARG used INLINE in the RUN (never an ENV) so it is not baked
# into any image layer/history; docker history shows "$NPM_TOKEN", not the value.
FROM node:20-alpine AS build
WORKDIR /app
ARG NPM_TOKEN
COPY apps/hub-api/package.json ./package.json
COPY .npmrc ./.npmrc
RUN NPM_TOKEN=$NPM_TOKEN npm install
COPY apps/hub-api/tsconfig.json ./tsconfig.json
COPY apps/hub-api/src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ARG NPM_TOKEN
COPY apps/hub-api/package.json ./package.json
COPY .npmrc ./.npmrc
RUN NPM_TOKEN=$NPM_TOKEN npm install --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/index.js"]
