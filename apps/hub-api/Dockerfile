# Build context is the repo ROOT (needs .npmrc + apps/hub-api/*).
# In EasyPanel: Dockerfile path = apps/hub-api/Dockerfile, build context = repo root.
#
# NPM_TOKEN (scope read:packages, para @algarpibe/zoho-sync privado) es un ARG
# usado INLINE en el RUN (nunca ENV), así que no queda en la historia de la
# imagen (docker history muestra "$NPM_TOKEN", no el valor).
#
# LIMITACIÓN CONOCIDA: BuildKit sustituye el ARG en la línea RUN al imprimirla,
# así que el token SÍ aparece en los *logs de build*. El arreglo limpio sería un
# secret mount (--mount=type=secret), pero EasyPanel no expone build-secrets:
# solo pasa las variables de Entorno como build-args. Mitigaciones vigentes:
#  - token de mínimo privilegio (read:packages) y rotable,
#  - logs de build de acceso restringido (tratarlos como sensibles),
#  - fix definitivo pendiente: construir la imagen en CI (GitHub Actions maneja
#    secrets bien) y que EasyPanel consuma "Imagen Docker" desde el registry.
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS build
WORKDIR /app
ARG NPM_TOKEN
COPY apps/hub-api/package.json ./package.json
COPY .npmrc ./.npmrc
RUN NPM_TOKEN=$NPM_TOKEN npm install
COPY apps/hub-api/tsconfig.json ./tsconfig.json
COPY apps/hub-api/src ./src
# tsc no emite los .sql; se copian a dist para que initDb() (node dist/index.js)
# encuentre las migraciones en runtime.
RUN npm run build && mkdir -p dist/users && cp -R src/users/migrations dist/users/

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
