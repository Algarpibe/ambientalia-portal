# syntax=docker/dockerfile:1
# Build context is the repo ROOT (needs .npmrc + apps/hub-api/*).
# In EasyPanel: Dockerfile path = apps/hub-api/Dockerfile, build context = repo root.
#
# NPM_TOKEN (scope read:packages, para el paquete privado @algarpibe/zoho-sync)
# se inyecta como BuildKit *secret*, NO como ARG/ENV. Al leerse de /run/secrets
# (no sustituir un $ARG), el valor no aparece en los logs de build ni en la
# historia de la imagen. El build DEBE pasar el secreto, p. ej.:
#   docker build --secret id=npm_token,env=NPM_TOKEN ...
# En EasyPanel: configurar NPM_TOKEN como *build secret* con id "npm_token".
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS build
WORKDIR /app
COPY apps/hub-api/package.json ./package.json
COPY .npmrc ./.npmrc
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN="$(cat /run/secrets/npm_token)" npm install
COPY apps/hub-api/tsconfig.json ./tsconfig.json
COPY apps/hub-api/src ./src
RUN npm run build

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runtime
WORKDIR /app
COPY apps/hub-api/package.json ./package.json
COPY .npmrc ./.npmrc
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN="$(cat /run/secrets/npm_token)" npm install --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3001
# (INFRA-001 USER node e INFRA-002 HEALTHCHECK retirados: EasyPanel no
#  promocionaba el contenedor y mantenía el viejo. Dockerfile mínimo, como el
#  original que sí desplegaba. Se re-harán con la config de healthcheck/usuario
#  propia de EasyPanel más adelante.)
CMD ["node", "dist/index.js"]
