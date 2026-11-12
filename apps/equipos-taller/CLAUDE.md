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
- **Tablero kanban** (cambio SDD `tablero-kanban-taller`; artefactos en `openspec/changes/tablero-kanban-taller/`, fuera de git):
  - Modelo puro en el núcleo: `nucleo/taller-board.ts` (columnas, tarjetas, días, semáforo, KPIs, validación de ajustes) y `nucleo/taller-columns.ts` (reparto de los estados de Desk; una prueba exige cubrir todos).
  - Pantallas en `src/tablero/` (`Tablero.tsx`, `temas.ts`, `medidas.ts`, `useSondeo.ts`, CSS) más `src/App.tsx` (botones «Tabla | Tablero»), `src/TvEquipos.tsx` (TV), `src/MisEquipos.tsx` + `src/tecnico.ts` + `src/EscanearSerial.tsx` («Mis equipos») y `src/PanelTablero.tsx` / `src/PanelKiosco.tsx` (Ajustes del portal).
  - Rutas del portal fuera del shell: `apps/portal/src/components/RutaTableroTv.tsx` y `RutaMisEquipos.tsx`.
  - Servidor: `servicio-tablero.ts`, `repo-tablero.ts`, `router-kiosco.ts` (la ÚNICA ruta que acepta la llave de kiosco) y migración 074. Operación: `docs/equipos-taller-kiosco.md`.

## Reglas de trabajo

- **No es un rediseño.** Vistas, filtros (Cliente, Estado en Desk, Sin ticket), columnas, motivos y ajustes manuales no cambian. Si algo de la clasificación está mal, se corrige en el núcleo, con su prueba.
- **Repo público.**
  - Ni clientes, ni seriales, ni tickets, ni IDs de Drive reales en el código, las pruebas o los comentarios. Los datos de prueba son inventados (`18A90417`, `CLIENTE A`…).
  - Los IDs de las carpetas y la URL de hub-api viven solo en el nodo «Configuración» del flujo de n8n.
  - Antes de commitear: `cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs`.
- La pantalla solo **oculta** botones según `permisos`: el servidor comprueba cada llave.
- `RETIRADOS_FIJOS` (núcleo) está vacío a propósito: los retirados se marcan con «Marcar retirado».
- **Tablero:** solo lectura (nada escribe en Desk ni en Zoho). Colores SOLO con los tokens `--tt-*` de `src/tablero/temas.ts`: `tablero.css.test.ts` rechaza literales de color en el CSS y los TSX del tablero, y `temas.test.ts` exige contraste 4,5:1 (3:1 desde 24 px) en los dos temas; si un par falla, se cambia el color, nunca el umbral. Los temporizadores se limpian al desmontar (pruebas con `vi.getTimerCount()`).
- **Llave de kiosco:** cualquier cambio en `router-kiosco.ts` o `servicio-tablero.ts` mantiene en verde las pruebas de amenazas T1–T8 de `router-kiosco.test.ts`.

## Pruebas

```bash
npm test --workspace=apps/equipos-taller                 # api (node) y pantalla (jsdom)
npx tsc --noEmit -p apps/equipos-taller/tsconfig.json
cd apps/hub-api && npx vitest run src/equipos scripts     # núcleo y servidor (nunca desde la raíz)
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/equipos   # contra Postgres (Docker): migraciones, repo y copia de Drive
npm run build --workspace=apps/portal                    # tsc -b del portal comprueba esta sub-app
```
