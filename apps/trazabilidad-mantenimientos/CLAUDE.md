# Trazabilidad Mantenimientos Clientes

App interna del portal para seguir los vencimientos de calibración de los **GRIMM EDM 180**
(180C y 180D) instalados en clientes y avisarles antes de que se les venza, para programar el
servicio de calibración y mantenimiento en vez de recibir el equipo sin previo aviso.

Fuente de datos: la hoja **F-ST-022 «Trazabilidad Mttos Clientes»** (Excel), que se importa
desde la propia app. El seguimiento (aviso enviado, «en Ambientalia», servicio programado, nota)
se registra en la app y sobrevive a las reimportaciones.

## Regla de negocio (la de la F-ST-022)

- Vigencia de calibración (días) = (Última calibración − HOY) + 365 → `vigenciaDias`.
- Vence = última calibración + 365 días.
- Estados (`apps/hub-api/src/trazabilidad/dominio.ts`): `FUERA_CICLO` (vigencia < −365, la hoja
  lo marca con Estado = 1), `VENCIDA` (−365…−1, llegada urgente posible), `VENCE_30` (0…30),
  `VENCE_60` (31…60), `VENCE_90` (61…90), `AL_DIA` (> 90), `SIN_FECHA`.
- «Hoy» es el día en Colombia (`hoyEnColombia`), calculado en el servidor.

## Dónde vive cada cosa

| Pieza | Ruta |
|---|---|
| Dominio puro (sin imports; lo usa servidor y UI) | `apps/hub-api/src/trazabilidad/dominio.ts` |
| Validación de entrada (400 en español) | `apps/hub-api/src/trazabilidad/types.ts` |
| SQL | `apps/hub-api/src/trazabilidad/repo.ts` |
| HTTP (`requireAuth` + `requireApp('trazabilidad-mantenimientos')`) | `apps/hub-api/src/trazabilidad/router.ts` |
| Migración (esquema `portal`, idempotente) | `apps/hub-api/src/users/migrations/042_trazabilidad_mantenimientos.sql` |
| UI (Vite + React, cargada en `/trazabilidad-mantenimientos/*`) | `apps/trazabilidad-mantenimientos/src/` |
| Lectura del Excel en el navegador | `src/lib/importar.ts` |
| Agregados, calendario y texto del aviso | `src/lib/vistas.ts` |

Registro en el portal (los cinco puntos de siempre): `portal/src/lib/apps.ts`,
`portal/src/App.tsx`, `portal/src/pages/Aplicaciones.tsx`, `portal/tailwind.config.js` y el
`Dockerfile` raíz.

## Tablas

| Tabla | Contenido |
|---|---|
| `portal.tmc_equipos` | Un equipo por `clave` (el serial; si la hoja repite un serial, la 2.ª aparición lleva `-2`). `activo = false` cuando una importación ya no lo trae: no se borra |
| `portal.tmc_seguimiento` | Seguimiento por `clave`, sin FK a propósito (sobrevive a retiradas y vuelve con el equipo) |
| `portal.tmc_importaciones` | Registro de cada importación: archivo, recuentos y quién |

## API (`/api/trazabilidad/*`)

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/trazabilidad/equipos` (`?hoy=`) | Equipos activos con estado, seguimiento y `ticket` (el abierto en Zoho Desk, o `null`) + última importación |
| POST | `/trazabilidad/importaciones` (`?simular=1`) | `{archivo, filas[]}` → altas / cambios / retiradas. Con `simular` no escribe |
| PUT | `/trazabilidad/seguimiento/:clave` | `{enAmbientalia, avisoEnviado, servicioProgramado, nota}` |
| POST | `/trazabilidad/avisos` | `{claves[], fecha}`: marca el aviso en bloque sin tocar el resto del seguimiento |

Permisos: cualquiera con la app asignada lee, importa y registra seguimiento; todo queda firmado
con su correo.

## Cruce con Zoho Desk (ticket abierto)

`listarEquipos` (`repo.ts`) cruza cada equipo con la réplica `desk.tickets` —la escribe el worker
de zoho-hub; hub-api sólo la lee y no tiene migración para ella— y devuelve
`ticket: { numero, estado, sinConfirmar } | null`.

- Abierto = `status_type` distinto de `'Closed'` y con serial. Cruce por serial sin mayúsculas ni
  espacios; con varios abiertos gana el de `number` más alto.
- **«Sin confirmar»**: si `synced_at` tiene más de un día (o es NULL) el ticket no se oculta, se
  marca `sinConfirmar` (el worker a veces deja de refrescar tickets viejos y puede estar ya cerrado).
- En la UI, `enServicio(e)` (`src/lib/vistas.ts`) = «en Ambientalia» a mano **o** con ticket abierto:
  esos equipos no entran en los avisos a clientes y sí en el filtro e indicador «En Ambientalia».
  El campo manual no se toca.
- `modelo`, `marca` y `tipo_servicio` de la réplica vienen vacíos: no usarlos.
- En `test:db` la tabla la crea `asegurarDeskTickets` (`src/test-db/harness.ts`).

## Pruebas

- `npm test --workspace=apps/trazabilidad-mantenimientos` — lector del Excel, agregados, aviso.
- `npm test --workspace=apps/hub-api` — dominio y router (`src/trazabilidad/*.test.ts`).
- `npm run test:db` en hub-api — `trazabilidad.db.test.ts` contra Postgres real.
