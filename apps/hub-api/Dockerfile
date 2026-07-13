# Build context is the repo ROOT (needs .npmrc + apps/hub-api/*).
# In EasyPanel: Dockerfile path = apps/hub-api/Dockerfile, build context = repo root.
# NPM_TOKEN is an ARG used INLINE in the RUN (never an ENV) so it is not baked
# into any image layer/history; docker history shows "$NPM_TOKEN", not the value.
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS build
WORKDIR /app
ARG NPM_TOKEN
COPY apps/hub-api/package.json ./package.json
COPY .npmrc ./.npmrc
RUN NPM_TOKEN=$NPM_TOKEN npm install
COPY apps/hub-api/tsconfig.json ./tsconfig.json
COPY apps/hub-api/src ./src
RUN npm run build

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runtime
WORKDIR /app
ARG NPM_TOKEN
COPY apps/hub-api/package.json ./package.json
COPY .npmrc ./.npmrc
RUN NPM_TOKEN=$NPM_TOKEN npm install --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3001
# (INFRA-001 USER node e INFRA-002 HEALTHCHECK retirados: EasyPanel no
#  promocionaba el contenedor y mantenía el viejo. Dockerfile mínimo, como el
#  original que sí desplegaba. Se re-harán con la config de healthcheck/usuario
#  propia de EasyPanel más adelante.)
CMD ["node", "dist/index.js"]
