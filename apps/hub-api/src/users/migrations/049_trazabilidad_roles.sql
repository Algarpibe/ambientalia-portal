-- Migration 049: Trazabilidad Mantenimientos Clientes - rol de cada persona en la app.
--
-- Hasta aqui cualquiera con la app asignada podia hacerlo todo. Desde esta
-- migracion cada persona tiene un rol propio de la app (el mismo patron que
-- portal.cal_user_roles de Calibraciones, migracion 040), y cada escritura de
-- la API comprueba en el servidor si ese rol la permite.
--
-- Los roles y lo que puede cada uno viven en UN solo sitio:
-- apps/hub-api/src/trazabilidad/roles.ts (ROLES_APP y la matriz de permisos).
-- El CHECK de abajo lleva los mismos cuatro valores y plazos.test.ts vigila que
-- coincidan.
--
-- Quien tiene la app y NO tiene fila aqui es LECTOR: lo ve todo y no cambia
-- nada. Los administradores del portal (portal.users.role = 'admin') tienen
-- todos los permisos sin necesidad de fila, y son los unicos que reparten
-- roles.
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. Only
-- CREATE ... IF NOT EXISTS here. No seed on purpose: nobody starts with a role.
-- Any statement that writes would wipe or rewrite the roles an admin handed
-- out on the next restart. plazos.test.ts vigila esta regla.
--
-- Una fila por usuario. A diferencia del resto de tablas tmc_*, esta SI lleva
-- clave foranea a portal.users, con ON DELETE CASCADE: un rol sin su usuario no
-- significa nada, y al borrar al usuario se va con el. `role` no tiene valor
-- por defecto: la ausencia de fila ya es LECTOR. actualizado_* firma el cambio
-- (id + correo de quien lo repartio, sin clave foranea, como en la 042).

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.tmc_user_roles (
  user_id             UUID          PRIMARY KEY REFERENCES portal.users(id) ON DELETE CASCADE,
  role                VARCHAR(20)   NOT NULL CHECK (role IN ('LECTOR', 'COMERCIAL', 'TECNICO', 'DIRECTOR_TECNICO')),
  actualizado_por_id  UUID          NULL,
  actualizado_por     VARCHAR(254)  NOT NULL,
  actualizado_en      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
