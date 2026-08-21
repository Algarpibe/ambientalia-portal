-- Migration 032: quién ve el calendario y el registro de TODA la empresa sin
-- ser administrador, ficha por ficha.
--
-- Mismo patrón que la 022 (`ve_adjuntos`) y la 031 (`exporta_registro`), y por
-- el mismo motivo: si la lista de personas vive en el código, añadir a alguien
-- exige tocar código y desplegar.
--
-- Lo que abre son los DOS recortes por privacidad que hoy separan a un
-- administrador del resto:
--   · el calendario, que a quien no es admin le enseña solo su propia fila
--     (`service.calendarioDelMes`);
--   · el registro de movimientos, que a un aprobador le enseña solo su rama de
--     dos niveles y a quien no aprueba a nadie le contesta 403
--     (`service.movimientosVisibles`).
--
-- ⚠️ Es una columna sola para los dos y no una por cada uno, a sabiendas: los
-- dos son el MISMO eje —alcance: toda la compañía en vez de lo mío o mi rama—
-- y separarlos daría dos casillas que se marcan siempre juntas. Si algún día
-- hace falta dar el calendario sin el registro, partirla es una migración
-- pequeña; unir dos columnas que ya están repartidas por fichas distintas, no.
--
-- ⚠️ Lo que enseña el registro incluye los motivos de los permisos y las
-- incapacidades de la plantilla entera: datos personales y de salud, con lo que
-- implica la Ley 1581. La lista tiene que quedarse corta y cada persona estar
-- justificada. Lo que NO abre esta columna es editar, borrar ni importar: eso
-- sigue detrás de `requireAdmin`, ruta por ruta.
--
-- Igual que la 031 y al contrario que la 022, aquí NO se siembra a nadie: la
-- columna nace en FALSE para todos y el administrador da el permiso desde la
-- pestaña Organigrama. Así ningún correo concreto entra en el código.
--
-- El DEFAULT FALSE basta para ser idempotente: `initDb()` re-ejecuta esto en
-- cada arranque, y un ADD COLUMN IF NOT EXISTS no vuelve a tocar los valores.

CREATE SCHEMA IF NOT EXISTS portal;

ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS ve_toda_la_empresa BOOLEAN NOT NULL DEFAULT FALSE;

-- El registro de quién dio o quitó el permiso. En BD y no por stdout, por lo
-- mismo que la 022 y la 031: al salir la lista del código, git deja de ser el
-- historial de estos accesos, y los logs de EasyPanel se rotan.
--
-- Guarda el correo ADEMÁS del id, y sin clave foránea: si la ficha se borra, el
-- registro tiene que seguir diciendo a quién se le dio el permiso. Un registro
-- de auditoría que desaparece con su sujeto no es un registro de auditoría.
CREATE TABLE IF NOT EXISTS portal.visores_empresa_log (
  id              BIGSERIAL    PRIMARY KEY,
  admin_email     VARCHAR(254) NOT NULL,
  empleado_id     UUID         NOT NULL,
  empleado_correo VARCHAR(254) NOT NULL,
  concedido       BOOLEAN      NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
