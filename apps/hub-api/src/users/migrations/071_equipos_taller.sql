-- Migration 071: «Equipos en taller» (docs/superpowers/specs/2026-11-10-equipos-taller-portal-design.md, §4).
--
-- Qué equipos están físicamente en el taller, cruzando las remisiones de Drive con los
-- tickets y comentarios de Desk 2.0. Las tablas van en `portal` con prefijo `equipos_`
-- (D8). Vienen de sql/equipos.sql del módulo original, adaptadas:
--   · `estado` guarda `foto`, `exits` y `ent` (ya no hay caché de comentarios);
--   · el ajuste se firma con el usuario del portal (`user_id`, `usuario`, `creado_en`);
--   · la corrida dice su origen (`programada` / `boton`), si salió bien y por qué no;
--   · nuevos: el incidente (alerta una vez por incidente, D6) y las llaves por usuario (D7).
--
-- ⚠️ NO siembra ni permisos ni apps: initDb() re-ejecuta las migraciones en cada
-- arranque, y una semilla devolvería un permiso que un admin hubiera quitado. La app y
-- las llaves se asignan a mano tras el despliegue.
--
-- Solo DDL idempotente (IF NOT EXISTS / OR REPLACE).

CREATE SCHEMA IF NOT EXISTS portal;

-- foto  → la última foto buena: filas y remisiones ilegibles (claves cortas d, c, sn, est…)
-- exits → caché del texto útil de las remisiones escaneadas (versión CV del núcleo)
-- ent   → remisiones de entrada ya leídas (nombre del equipo y número de ticket)
CREATE TABLE IF NOT EXISTS portal.equipos_estado (
  clave          text        PRIMARY KEY CHECK (clave IN ('foto', 'exits', 'ent')),
  valor          jsonb       NOT NULL,
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

-- Ajustes manuales. Clave «SERIAL|AAAA-MM-DD» (una entrada), «*SERIAL» (todas las del
-- serial) o «pdf:<idDrive>» (remisión ilegible revisada); el serial, en clase OCR.
-- tipo: in = sigue en taller · out = salida confirmada · ret = retirado · pdf = revisada
CREATE TABLE IF NOT EXISTS portal.equipos_ajuste (
  clave     text        PRIMARY KEY
                        CHECK (clave ~ '^(\*[A-Z0-9]{3,20}|[A-Z0-9]{3,20}\|\d{4}-\d{2}-\d{2}|pdf:[A-Za-z0-9_-]{10,80})$'),
  tipo      text        NOT NULL CHECK (tipo IN ('in', 'out', 'ret', 'pdf')),
  nota      text        NOT NULL DEFAULT '' CHECK (char_length(nota) <= 300),
  user_id   uuid        NULL REFERENCES portal.users(id) ON DELETE SET NULL,
  usuario   text        NOT NULL DEFAULT '',
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipos_ajuste_tipo_clave CHECK ((tipo = 'pdf') = (clave LIKE 'pdf:%'))
);

-- Una fila por corrida. `en_curso` es TRUE mientras corre y NULL al terminar: el índice
-- único parcial impide dos corridas a la vez (servidor y programador, o dos réplicas).
-- `avisos`: lo que el núcleo avisó en una corrida buena (no hay avisos de error: un
-- fallo hace fallida la corrida). `causa` nunca lleva secretos.
CREATE TABLE IF NOT EXISTS portal.equipos_ejecucion (
  id       bigserial   PRIMARY KEY,
  origen   text        NOT NULL CHECK (origen IN ('programada', 'boton')),
  user_id  uuid        NULL REFERENCES portal.users(id) ON DELETE SET NULL,
  inicio   timestamptz NOT NULL DEFAULT now(),
  fin      timestamptz NULL,
  en_curso boolean     NULL DEFAULT true,
  ok       boolean     NULL,
  causa    text        NULL CHECK (char_length(causa) <= 300),
  conteos  jsonb       NULL,
  avisos   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT equipos_ejecucion_estado CHECK (
    (en_curso IS TRUE AND fin IS NULL AND ok IS NULL) OR (en_curso IS NULL AND fin IS NOT NULL AND ok IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS equipos_ejecucion_una_a_la_vez ON portal.equipos_ejecucion (en_curso) WHERE en_curso;
CREATE INDEX IF NOT EXISTS equipos_ejecucion_buenas ON portal.equipos_ejecucion (id DESC) WHERE ok;

-- Incidentes: se abre con la primera corrida fallida tras una buena y se cierra con la
-- siguiente buena. Como mucho uno abierto (índice único parcial).
CREATE TABLE IF NOT EXISTS portal.equipos_incidente (
  id                  bigserial   PRIMARY KEY,
  abierto_en          timestamptz NOT NULL DEFAULT now(),
  cerrado_en          timestamptz NULL,
  fallos_programados  integer     NOT NULL DEFAULT 0 CHECK (fallos_programados >= 0),
  alerta_enviada_en   timestamptz NULL,
  alerta_ultimo_error text        NULL CHECK (char_length(alerta_ultimo_error) <= 300)
);
CREATE UNIQUE INDEX IF NOT EXISTS equipos_incidente_uno_abierto ON portal.equipos_incidente ((true)) WHERE cerrado_en IS NULL;

-- Llaves por usuario (mismo modelo que las de las fichas de Ausencias). Nacen en FALSE;
-- un admin las da desde el panel de la app.
CREATE TABLE IF NOT EXISTS portal.equipos_llaves (
  user_id         uuid        PRIMARY KEY REFERENCES portal.users(id) ON DELETE CASCADE,
  edita_ajustes   boolean     NOT NULL DEFAULT false,
  recibe_alertas  boolean     NOT NULL DEFAULT false,
  actualizado_por text        NOT NULL,
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);

-- Para consultar en psql: la última foto, plana (sin ajustes manuales aplicados)…
CREATE OR REPLACE VIEW portal.equipos_v_equipos AS
SELECT r->>'sn'                                           AS serial,
       r->>'c'                                            AS cliente,
       (r->>'d')::date                                    AS fecha_entrada,
       r->>'est'                                          AS estado,
       r->>'src'                                          AS fuente,
       r->'z'->>'n'                                       AS ticket,
       r->'z'->>'st'                                      AS estado_ticket,
       NULLIF(r->>'xd', '')::date                         AS fecha_salida,
       jsonb_array_length(COALESCE(r->'pa', '[]'::jsonb)) AS salidas_parciales,
       r->'why'                                           AS motivos,
       r->>'id'                                           AS carpeta_entrada
  FROM portal.equipos_estado e, jsonb_array_elements(e.valor->'rows') r
 WHERE e.clave = 'foto';

-- …y las remisiones escaneadas ilegibles que nadie ha marcado como revisadas.
CREATE OR REPLACE VIEW portal.equipos_v_remisiones_ilegibles AS
SELECT i->>'id'                  AS archivo,
       i->>'n'                   AS nombre,
       NULLIF(i->>'d', '')::date AS fecha,
       i->>'m'                   AS motivo,
       i->>'q'                   AS detalle,
       i->'p'                    AS posibles_equipos
  FROM portal.equipos_estado e, jsonb_array_elements(COALESCE(e.valor->'ilegibles', '[]'::jsonb)) i
 WHERE e.clave = 'foto'
   AND NOT EXISTS (SELECT 1 FROM portal.equipos_ajuste a WHERE a.clave = 'pdf:' || (i->>'id'));

-- DATA-332: con los roles activados, portal_app solo tiene lo que se le da.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON portal.equipos_estado, portal.equipos_ajuste, portal.equipos_ejecucion,
                                            portal.equipos_incidente, portal.equipos_llaves TO portal_app;
    GRANT USAGE, SELECT ON SEQUENCE portal.equipos_ejecucion_id_seq, portal.equipos_incidente_id_seq TO portal_app;
    GRANT SELECT ON portal.equipos_v_equipos, portal.equipos_v_remisiones_ilegibles TO portal_app;
  END IF;
END $$;
