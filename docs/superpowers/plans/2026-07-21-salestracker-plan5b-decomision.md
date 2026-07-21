# salestracker → Portal — Plan 5b: decomisión de la app Next (checklist)

**Objetivo:** retirar de forma segura la app **Next antigua** (servicio EasyPanel + BD `sales_tracker` + better-auth), ahora que la sub-app del portal tiene paridad funcional. **Lo ejecuta el usuario**; este doc es la guía. Staged y reversible hasta la Fase 3.

## Contexto (de la auditoría de paridad)
- La app Next corre como **servicio propio en EasyPanel**, con su **BD `sales_tracker`** (tablas better-auth `user/session/account/verification` + dominio `categories/category_groups/category_group_mappings/favorites/saved_views/companies/profiles` + `sales_records` de fallback).
- Ya era **read-only para ventas**: lee del `zoho-hub` (o de `sales_records`, alimentado por un **job externo de n8n**). No tiene captura de ventas.
- La sub-app del portal lee **en vivo del hub vía hub-api** — NO usa la BD vieja ni el job de n8n.
- ⚠️ **Datos NO migrados:** favoritos, vistas guardadas y agrupaciones creadas por usuarios en la app Next **no** están en el portal (nacen vacíos). Las descripciones/colores de categorías sí se sembraron (migración 011). Las agrupaciones ya se recrearon en el portal.
- El repo GitHub `Algarpibe/Sales-Tracker` **no se toca** (se conserva como archivo).

---

## Fase 0 — Verificaciones previas (antes de tocar nada)

- [ ] **Smoke test de paridad en el portal (nube):** entrar a `/salestracker` y recorrer Inicio (KPIs + gráficos), Artículos, Tablas, Clientes (+ficha), Cliente×Artículo, Análisis (4 pestañas, incl. Agrupaciones y Forecast por grupo), Categorías. Que todo cargue con datos reales.
- [ ] **Identificar el servicio y su BD en EasyPanel:** nombre del servicio Next, su BD `sales_tracker` (¿es un Postgres **dedicado** o comparte instancia con otra app?), y su dominio/subdominio.
- [ ] **Job de n8n del `sales_records` viejo:** localizar el workflow que rellenaba `sales_records`. Confirmar que **solo** servía a la app Next (la app del portal NO lo usa). Si alimenta algo más, **no** lo toques.
- [ ] **¿Alguien quiere conservar datos de usuario de la app vieja?** Si sí, exportarlos ahora (ver Fase 2). Si no, seguir.
- [ ] **Avisar a usuarios:** si alguien usaba la URL de la app Next, comunicar la nueva ruta del portal (`/salestracker`) y que la asignación de la app se gestiona en Admin del portal.

## Fase 1 — Parada suave (reversible, periodo de gracia)

- [ ] En EasyPanel, **DETENER** (no eliminar) el servicio de la app Next.
- [ ] (Opcional) Quitar/redirigir su dominio hacia el portal.
- [ ] (Si aplica) **Desactivar** (no borrar) el job de n8n del `sales_records` viejo.
- [ ] **Periodo de gracia** (sugerido 1–2 semanas): observar si alguien reporta que falta algo o si salta alguna alerta. El servicio se puede re-encender al instante si hace falta.

## Fase 2 — Backup (antes de borrar nada)

- [ ] `pg_dump` **completo** de la BD `sales_tracker` y guardar el archivo **fuera de EasyPanel** (descarga local / almacenamiento aparte). Comando de referencia (ajusta credenciales/host):
  ```bash
  pg_dump "postgresql://USER:PASS@HOST:PORT/sales_tracker" -Fc -f sales_tracker_backup_$(date +%Y%m%d).dump
  ```
  Interesa sobre todo: `categories`, `category_groups`, `category_group_mappings`, `favorites`, `saved_views`, `companies`, `profiles`, `sales_records`.

## Fase 3 — Eliminación definitiva (tras el periodo de gracia — IRREVERSIBLE)

- [ ] Eliminar el **servicio** de la app Next en EasyPanel.
- [ ] Eliminar la **BD `sales_tracker`** (y su servicio Postgres **solo si es dedicado** y no lo comparte nada más).
- [ ] Eliminar el **job de n8n** del `sales_records` viejo (si se desactivó y nadie lo necesita).
- [ ] Limpiar **variables/secrets huérfanos**: `DATABASE_URL` de la app vieja, `BETTER_AUTH_SECRET`, y cualquier env exclusivo del servicio Next.
- [ ] Repo GitHub `Algarpibe/Sales-Tracker`: **dejarlo** (no borrar). Opcional: marcarlo *Archived* en GitHub.

## Fase 4 — Limpieza del monorepo (opcional, código — lo hago yo si quieres)

- [ ] `reference/salestracker-next/` (gitignored, oráculo de paridad) puede quedarse o retirarse una vez cerrado el cutover. No urge.
- [ ] (Opcional futuro) diferidos: gemelas por-categoría (`HistoricalSalesCategory`/`ForecastSalesCategory`), export xlsx real, command palette.

---

## 🔒 Salvaguardas — NO tocar
- **NO** eliminar el `zoho-hub` (Postgres de `books.*`) ni **hub-api**: el portal depende de ellos en vivo.
- **NO** eliminar la BD del portal/hub-api (esquema `portal.*` con `st_categories/st_category_groups/st_favorites/st_saved_views`): es la config/estado del portal, distinta de `sales_tracker`.
- **NO** eliminar el Postgres compartido si `sales_tracker` vive en una instancia con otras BDs — borra solo la base `sales_tracker`.
- **NO** tocar el repo git en la nube de la app (`Algarpibe/Sales-Tracker`).

## Rollback
Hasta la Fase 3 todo es reversible: re-encender el servicio en EasyPanel y reactivar el job de n8n. Tras la Fase 3, el `pg_dump` de la Fase 2 es la única vía de recuperación.
