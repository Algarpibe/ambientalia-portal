-- Migración 080: quién registró una incapacidad, cuando no fue la propia persona
-- (spec docs/superpowers/specs/2026-11-23-incapacidad-por-admin-design.md).
--
-- Desde aquí el administrador puede registrar una incapacidad a nombre de
-- cualquier empleado activo, desde el Registro general. Esta columna deja la
-- constancia: NULL significa que la registró la propia persona (o que viene del
-- histórico de la hoja); con valor, es el correo, en minúsculas, del
-- administrador que la registró. NULL por defecto, así que ninguna solicitud
-- existente cambia.
--
-- VARCHAR(254), como el resto de correos del esquema (`empleados.correo`).
--
-- Sin GRANT: es una columna nueva de una tabla que portal_app ya tiene concedida
-- entera (la 068), y un permiso de tabla alcanza a sus columnas futuras. Lo
-- vigila db.roles.db.test.ts.
--
-- Idempotente: las migraciones se re-ejecutan en cada arranque. No siembra nada.

ALTER TABLE portal.solicitudes_ausencia
  ADD COLUMN IF NOT EXISTS registrada_por VARCHAR(254);
