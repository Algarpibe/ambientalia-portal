-- Migration 014: retirar la sub-app salestracker del portal.
-- La app se opera ahora de forma independiente en su propio dominio, con su
-- propia base de datos; estas tablas eran exclusivas de la sub-app embebida
-- (config y estado por usuario creados en las mig. 009-012, ya eliminadas).
--
-- No toca nada del esquema `books.*` (réplica de Zoho) ni el resto de `portal.*`.
-- Idempotente: en una base nueva estos DROP son no-op.
-- CASCADE se lleva índices y las FK st_favorites_user_fk / st_saved_views_user_fk
-- que añadía la mig. 013.

DROP TABLE IF EXISTS portal.st_category_group_mappings CASCADE;
DROP TABLE IF EXISTS portal.st_category_groups         CASCADE;
DROP TABLE IF EXISTS portal.st_categories              CASCADE;
DROP TABLE IF EXISTS portal.st_saved_views             CASCADE;
DROP TABLE IF EXISTS portal.st_favorites               CASCADE;

-- Asignaciones de la app a usuarios (app_id es texto libre, sin enum).
DELETE FROM portal.user_apps WHERE app_id = 'salestracker';
