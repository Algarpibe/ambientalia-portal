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
# y que EasyPanel consuma "Imagen Docker" desde un registry. Hecho en CI (job
# imagen-hub-api); falta que EasyPanel lo use.
#
# INFRA-536 — `npm ci` con el lockfile de la RAÍZ del monorepo, no `npm install`
# con el package.json de hub-api suelto. Antes no se copiaba ningún lockfile, así
# que cada build resolvía las versiones de nuevo dentro de los rangos `^`: un
# parche de express o de pg entraba en producción sin que ningún test lo hubiera
# visto. Ahora la imagen lleva EXACTAMENTE las versiones con las que pasó el CI, y
# el build falla si el lockfile no cuadra con el package.json.
#
# El lockfile es el de todo el monorepo, así que hub-api se instala como lo que es
# en él, un workspace: `--workspace=apps/hub-api` instala solo sus dependencias
# (los package.json de las demás apps no hacen falta y no se copian). Por eso el
# código vive en /app/apps/hub-api y no en /app: las dependencias quedan en
# /app/node_modules (y alguna, si choca de versión, en
# /app/apps/hub-api/node_modules), y Node las encuentra subiendo directorios.

# Dependencias de producción, para copiarlas a la imagen final sin el token.
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS deps
WORKDIR /app
ARG NPM_TOKEN
COPY package.json package-lock.json .npmrc ./
COPY apps/hub-api/package.json ./apps/hub-api/package.json
# El mkdir garantiza que exista la carpeta node_modules del workspace aunque npm
# lo haya subido todo a la raíz: el COPY de la etapa final falla si no existe.
RUN npm ci --workspace=apps/hub-api --omit=dev && mkdir -p apps/hub-api/node_modules

# Compilación: necesita también las dependencias de desarrollo (tsc).
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS build
WORKDIR /app
ARG NPM_TOKEN
COPY package.json package-lock.json .npmrc ./
COPY apps/hub-api/package.json ./apps/hub-api/package.json
RUN npm ci --workspace=apps/hub-api
COPY apps/hub-api/tsconfig.json ./apps/hub-api/tsconfig.json
COPY apps/hub-api/src ./apps/hub-api/src
# tsc no emite los .sql; se copian a dist para que initDb() (node dist/index.js)
# encuentre las migraciones en runtime.
WORKDIR /app/apps/hub-api
RUN npm run build && mkdir -p dist/users && cp -R src/users/migrations dist/users/

# Imagen final: sin ARG NPM_TOKEN y sin .npmrc (regla 2). El package.json de
# hub-api SÍ hace falta: su `"type": "module"` es lo que hace que Node cargue
# dist/*.js como ESM.
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runtime
WORKDIR /app/apps/hub-api
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/apps/hub-api/node_modules ./node_modules
COPY apps/hub-api/package.json ./package.json
COPY --from=build /app/apps/hub-api/dist ./dist
EXPOSE 3001
# (INFRA-001 USER node e INFRA-002 HEALTHCHECK retirados: EasyPanel no
#  promocionaba el contenedor y mantenía el viejo. Dockerfile mínimo, como el
#  original que sí desplegaba. Se re-harán con la config de healthcheck/usuario
#  propia de EasyPanel más adelante.)
CMD ["node", "dist/index.js"]
