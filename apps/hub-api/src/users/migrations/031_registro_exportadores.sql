-- Migration 031: quién puede exportar el CSV del registro, ficha por ficha.
--
-- Mismo patrón que la 022 (`ve_adjuntos`) y por el mismo motivo: si la lista de
-- personas vive en el código, añadir a alguien exige tocar código y desplegar.
--
-- ⚠️ Lo que abre este permiso es un fichero con las ausencias de la plantilla:
-- datos personales, con lo que implica la Ley 1581. La lista tiene que quedarse
-- corta y cada persona estar justificada.
--
-- A DIFERENCIA de la 022, aquí NO se siembra a nadie. La 022 tuvo que hacerlo
-- porque venía de una constante del código que había que preservar; aquí no hay
-- nada que preservar, así que la columna nace en FALSE para todos y el
-- administrador da el permiso desde la pestaña Organigrama. Así ningún correo
-- concreto entra en el código.
--
-- El DEFAULT FALSE basta para ser idempotente: `initDb()` re-ejecuta esto en
-- cada arranque, y un ADD COLUMN IF NOT EXISTS no vuelve a tocar los valores.

CREATE SCHEMA IF NOT EXISTS portal;

ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS exporta_registro BOOLEAN NOT NULL DEFAULT FALSE;

-- El registro de quién dio o quitó el permiso. En BD y no por stdout, por lo
-- mismo que la 022: al salir la lista del código, git deja de ser el historial
-- de estos accesos, y los logs de EasyPanel se rotan.
--
-- Guarda el correo ADEMÁS del id, y sin clave foránea: si la ficha se borra, el
-- registro tiene que seguir diciendo a quién se le dio el permiso.
CREATE TABLE IF NOT EXISTS portal.exportadores_registro_log (
  id              BIGSERIAL    PRIMARY KEY,
  admin_email     VARCHAR(254) NOT NULL,
  empleado_id     UUID         NOT NULL,
  empleado_correo VARCHAR(254) NOT NULL,
  concedido       BOOLEAN      NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
