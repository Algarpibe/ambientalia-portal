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
# INFRA-002 — healthcheck contra el endpoint /health.
# (INFRA-001 USER node retirado: EasyPanel no promocionaba el contenedor no-root;
#  se re-hará como non-root con permisos explícitos en un paso posterior.)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:3001/health || exit 1
CMD ["node", "dist/index.js"]
