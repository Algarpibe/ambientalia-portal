# Equipos en taller (sub-app)

Pantalla de la app `equipos-taller` del portal: qué equipos están físicamente en el taller. Documentación de operación (variables, causas de fallo, contratos de los flujos de n8n): `docs/equipos-taller.md`. Diseño: `docs/superpowers/specs/2026-11-10-equipos-taller-portal-design.md`, con la revisión «Drive vía n8n» del 10/11/2026.

## Dónde está cada cosa

- **Reglas:** `apps/hub-api/src/equipos/nucleo/` (puro). Es la ÚNICA fuente de verdad: la pantalla lo importa por ruta relativa (`src/nucleo.ts`) y no copia ninguna regla. `nucleo/pureza.test.ts` impide que importe nada de fuera de su carpeta.
- **Contrato de la API:** `apps/hub-api/src/equipos/contrato.ts`: tipos, claves de ajuste, el aviso de foto vieja y las causas de copia atrasada y de textos fallidos.
- **Servidor:** `apps/hub-api/src/equipos/` (servicio, repo, router, programador, fuente de Desk 2.0). Rutas bajo `/api/equipos-taller`.
- **Drive:** hub-api NO lo lee. El flujo de n8n «Equipos · Sincronizar remisiones» manda la copia cada hora:
  - `sync.ts` valida;
  - `router-sync.ts` la recibe;
  - `repo-sync.ts` la guarda en `portal.equipos_drive_archivos`;
  - `fuente-n8n.ts` se la da al núcleo.

  Hasta la primera pasada completa, la pantalla dice «Falta la primera sincronización con n8n».
- **Pantalla:** `src/EquiposServicio.tsx` (trasladada sin rediseño de Desk 2.0), `src/api.ts`. `src/PanelLlaves.tsx` (solo admin) NO se muestra aquí: lo renderiza la página Ajustes del portal (`apps/portal/src/pages/Configuracion.tsx`, sección «Equipos en taller · Llaves»).
- **Sin tarjeta en el Dashboard:** la app sale en la barra lateral (`apps/portal/src/lib/apps.ts`) y en Aplicaciones.

## Reglas de trabajo

- **No es un rediseño.** Vistas, filtros (Cliente, Estado en Desk, Sin ticket), columnas, motivos y ajustes manuales no cambian. Si algo de la clasificación está mal, se corrige en el núcleo, con su prueba.
- **Repo público.**
  - Ni clientes, ni seriales, ni tickets, ni IDs de Drive reales en el código, las pruebas o los comentarios. Los datos de prueba son inventados (`18A90417`, `CLIENTE A`…).
  - Los IDs de las carpetas y la URL de hub-api viven solo en el nodo «Configuración» del flujo de n8n.
  - Antes de commitear: `cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs`.
- La pantalla solo **oculta** botones según `permisos`: el servidor comprueba cada llave.
- `RETIRADOS_FIJOS` (núcleo) está vacío a propósito: los retirados se marcan con «Marcar retirado».

## Pruebas

```bash
npm test --workspace=apps/equipos-taller                 # api (node) y pantalla (jsdom)
npx tsc --noEmit -p apps/equipos-taller/tsconfig.json
cd apps/hub-api && npx vitest run src/equipos scripts     # núcleo y servidor (nunca desde la raíz)
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/equipos   # contra Postgres (Docker): migraciones, repo y copia de Drive
npm run build --workspace=apps/portal                    # tsc -b del portal comprueba esta sub-app
```
