-- Migration 068: permisos del rol de las peticiones, `portal_app` (DATA-332).
--
-- Hasta aquí un solo rol aplicaba el DDL de las migraciones Y atendía todas las
-- peticiones: una inyección SQL, si apareciera, tendría DROP TABLE. La
-- separación: el rol de migración (el de siempre, dueño de `portal`) corre las
-- migraciones al arrancar, vía HUB_MIGRATION_DB_URL; `portal_app` atiende las
-- peticiones, vía HUB_DB_URL, y solo lee y escribe filas.
--
-- Solo actúa si `portal_app` existe. Crearlo (con su contraseña) exige
-- CREATEROLE, que el rol de migración no tiene: se hace a mano una vez, con el
-- script de docs/data-332-roles.md. Mientras no exista, esto no hace nada y todo
-- sigue como antes.
--
-- Se re-ejecuta en cada arranque A PROPÓSITO, y por eso no lleva la guarda de
-- «ya está hecho» de la 028 o la 067: así, la tabla que traiga cualquier
-- migración futura le llega a `portal_app` en ese mismo arranque, sin que nadie
-- tenga que acordarse. No toma candados sobre las tablas (lo prueba
-- db.roles.db.test.ts con una transacción abierta), así que no se pone a
-- esperar a las peticiones del contenedor viejo.
--
-- Las secuencias, por los SERIAL/BIGSERIAL: sin USAGE, el INSERT falla al pedir
-- el siguiente id. Las funciones no hacen falta: EXECUTE se concede a PUBLIC
-- por defecto. Nada de TRUNCATE: ninguna ruta lo usa.
--
-- La réplica de Zoho (books, crm, desk) NO va aquí: esas tablas son del worker
-- de zoho-sync, no del rol de migración, y solo su dueño puede dar permisos
-- sobre ellas. Va en el mismo script manual.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT USAGE ON SCHEMA portal TO portal_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA portal TO portal_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA portal TO portal_app;
  END IF;
END $$;
