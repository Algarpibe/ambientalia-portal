-- Migration 038: quién abre el panel de KPIs de la app de Vacaciones y
-- Permisos, ficha por ficha.
--
-- Mismo patrón que la 022 (`ve_adjuntos`), la 031 (`exporta_registro`) y la 032
-- (`ve_toda_la_empresa`), y por el mismo motivo: si la lista de personas vive
-- en el código, añadir a alguien exige tocar código y desplegar.
--
-- Lo que abre es una pestaña de análisis agregado que hoy no existe en ninguna
-- pantalla:
--   · el PASIVO DE VACACIONES de la plantilla activa —la suma del disponible,
--     que es deuda real de la compañía y hoy solo se ve persona a persona en
--     Saldos;
--   · los TIEMPOS DE APROBACIÓN (mediana y p90 de `decidida_at − created_at`)
--     desglosados POR APROBADOR, que señalan qué bandeja está atascada;
--   · las solicitudes PENDIENTES por antigüedad.
--
-- ⚠️ ESTA LLAVE NO SE PLIEGA DENTRO DE `esAdmin`, y ahí se separa de sus tres
-- hermanas. Las otras se conceden solas a cualquier administrador del portal
-- (`sesion.esAdmin || repo.esVisorDeX(...)`), porque son recortes de privacidad
-- que el rol ya levanta. Aquí eso vaciaría el permiso de contenido: quien pidió
-- el panel YA es administrador, luego plegarlo lo abriría a TODOS los
-- administradores y no distinguiría a nadie. La columna es la ÚNICA fuente.
--
-- Consecuencia deliberada: la casilla se pinta también en las filas de los
-- administradores del panel Organigrama —al revés que las otras tres, que ahí
-- se ocultan porque el rol ya las da—, porque en esta sí decide.
--
-- ⚠️ Lo que enseña son datos agregados de la plantilla entera, incluido el
-- desglose de tiempos por aprobador, que es una medida del desempeño de
-- personas concretas. La lista tiene que quedarse corta y cada persona estar
-- justificada. Lo que NO abre esta columna es editar, borrar ni importar: eso
-- sigue detrás de `requireAdmin`, ruta por ruta.
--
-- Igual que la 031 y la 032, aquí NO se siembra a nadie: la columna nace en
-- FALSE para todos y un administrador da el permiso desde la pestaña
-- Organigrama. Así ningún correo concreto entra en el código, que es justo lo
-- que esta columna viene a evitar.
--
-- El DEFAULT FALSE basta para ser idempotente: `initDb()` re-ejecuta esto en
-- cada arranque, y un ADD COLUMN IF NOT EXISTS no vuelve a tocar los valores.

CREATE SCHEMA IF NOT EXISTS portal;

ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS ve_kpis BOOLEAN NOT NULL DEFAULT FALSE;

-- El registro de quién dio o quitó el permiso. En BD y no por stdout, por lo
-- mismo que la 022, la 031 y la 032: al salir la lista del código, git deja de
-- ser el historial de estos accesos, y los logs de EasyPanel se rotan.
--
-- Guarda el correo ADEMÁS del id, y sin clave foránea: si la ficha se borra, el
-- registro tiene que seguir diciendo a quién se le dio el permiso. Un registro
-- de auditoría que desaparece con su sujeto no es un registro de auditoría.
CREATE TABLE IF NOT EXISTS portal.visores_kpis_log (
  id              BIGSERIAL    PRIMARY KEY,
  admin_email     VARCHAR(254) NOT NULL,
  empleado_id     UUID         NOT NULL,
  empleado_correo VARCHAR(254) NOT NULL,
  concedido       BOOLEAN      NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
