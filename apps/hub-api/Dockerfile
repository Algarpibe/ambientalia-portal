# Build context is the repo ROOT (needs .npmrc + apps/hub-api/*).
# In EasyPanel: Dockerfile path = apps/hub-api/Dockerfile, build context = repo root.
#
# NPM_TOKEN (scope read:packages, para @algarpibe/zoho-sync privado) llega como
# build-arg: EasyPanel no expone build-secrets, solo pasa las variables de
# Entorno como `--build-arg`. INFRA-534 — dos reglas para que no se escape:
#
#  1. El token NO se nombra en ningún RUN. Docker entrega los ARG declarados en
#     la etapa a los RUN como variables de entorno, y el `${NPM_TOKEN}` de .npmrc
#     lo lee npm de ahí. Escrito `RUN NPM_TOKEN=$NPM_TOKEN npm install`, BuildKit
#     imprimía la línea con el valor sustituido en el log de build.
#  2. La etapa final NO declara el ARG. Toda etapa que lo declara y ejecuta un
#     RUN deja `RUN |1 NPM_TOKEN=<valor> ...` en `docker history`, con o sin la
#     regla 1 (comprobado con BuildKit el 2026-10-20; lo que decía este comentario,
#     que la historia solo mostraba "$NPM_TOKEN", era falso). Por eso las
#     dependencias se instalan en `deps` y a `runtime` solo se copia node_modules:
#     la historia de las etapas intermedias no viaja en la imagen final.
#
# LO QUE ESTO NO ARREGLA: cuando un build FALLA, EasyPanel imprime al final la
# línea de `docker buildx build` con TODAS las variables del servicio como
# `--build-arg` (JWT_SECRET, HUB_DB_URL...). Eso es de EasyPanel, no de Docker:
# solo se corta construyendo la imagen en CI (GitHub Actions maneja secrets bien)
# y que EasyPanel consuma "Imagen Docker" desde un registry. Pendiente.

# Dependencias de producción, para copiarlas a la imagen final sin el token.
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS deps
WORKDIR /app
ARG NPM_TOKEN
COPY apps/hub-api/package.json ./package.json
COPY .npmrc ./.npmrc
RUN npm install --omit=dev

# Compilación: necesita también las dependencias de desarrollo (tsc).
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS build
WORKDIR /app
ARG NPM_TOKEN
COPY apps/hub-api/package.json ./package.json
COPY .npmrc ./.npmrc
RUN npm install
COPY apps/hub-api/tsconfig.json ./tsconfig.json
COPY apps/hub-api/src ./src
# tsc no emite los .sql; se copian a dist para que initDb() (node dist/index.js)
# encuentre las migraciones en runtime.
RUN npm run build && mkdir -p dist/users && cp -R src/users/migrations dist/users/

# Imagen final: sin ARG NPM_TOKEN y sin .npmrc (regla 2).
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runtime
WORKDIR /app
COPY apps/hub-api/package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3001
# (INFRA-001 USER node e INFRA-002 HEALTHCHECK retirados: EasyPanel no
#  promocionaba el contenedor y mantenía el viejo. Dockerfile mínimo, como el
#  original que sí desplegaba. Se re-harán con la config de healthcheck/usuario
#  propia de EasyPanel más adelante.)
CMD ["node", "dist/index.js"]
