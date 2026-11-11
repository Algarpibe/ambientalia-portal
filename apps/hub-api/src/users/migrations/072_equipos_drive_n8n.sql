-- Migration 072: «Equipos en taller», Drive vía n8n (docs/superpowers/specs/2026-11-10-equipos-taller-portal-design.md,
-- revisión del 10/11/2026).
--
-- El Workspace de la empresa no deja compartir Drive con cuentas de servicio, así que hub-api ya
-- no lee Drive: el flujo de n8n «Equipos · Sincronizar remisiones» lista cada hora las tres
-- carpetas con su credencial de Google y manda aquí los nombres y los textos.
--   · equipos_drive_archivos: la copia, un archivo o carpeta de Drive por fila (su id de Drive),
--     con el nombre, el texto (remisión de entrada en Markdown u OCR de la salida escaneada) o el
--     código del fallo de ese archivo, y si ya no está en Drive (borrado).
--   · equipos_sincronizacion: una fila por pasada de n8n (el id de su ejecución). La corrida
--     diaria solo corre con una pasada COMPLETA reciente (EQUIPOS_SYNC_MAX_HORAS).
--
-- ⚠️ NO siembra nada: initDb() re-ejecuta las migraciones en cada arranque.
-- Solo DDL idempotente (IF NOT EXISTS).

CREATE SCHEMA IF NOT EXISTS portal;

-- texto          NULL = todavía no llegó, '' es válido (carpeta de entrada sin documento)
-- titulo_texto   el nombre cuando llegó el texto: si el archivo cambia de nombre, se vuelve a pedir
-- error_status   el último fallo de ESE archivo (4xx que no es 401 ni 429), que se vuelve a pedir cada 6 h
-- texto_sync     la pasada (equipos_sincronizacion.id) en la que llegó su último texto
-- error_sync     la pasada en la que empezó su racha de fallos (el primero tras su último texto); los
--                reintentos no la mueven
-- error_desde    cuándo empezó esa racha (reloj de la base): solo cuentan las de las últimas 24 h.
--                Con las tres, «fin» ve si el OCR o la exportación de n8n fallan en todo lo nuevo
--                (repo-sync.ts, cerrarPasada)
-- actualizado_en el último cambio del listado (alta, nombre, carpeta, borrado o reaparición)
CREATE TABLE IF NOT EXISTS portal.equipos_drive_archivos (
  id             text        PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{10,100}$'),
  carpeta        text        NOT NULL CHECK (carpeta IN ('entradas', 'salidas_n8n', 'salidas_escaneadas')),
  titulo         text        NOT NULL CHECK (char_length(titulo) BETWEEN 1 AND 300),
  texto          text        NULL CHECK (char_length(texto) <= 200000),
  titulo_texto   text        NULL,
  error_status   integer     NULL CHECK (error_status BETWEEN 400 AND 499 AND error_status NOT IN (401, 429)),
  texto_en       timestamptz NULL,
  texto_sync     bigint      NULL,
  error_sync     bigint      NULL,
  error_desde    timestamptz NULL,
  borrado        boolean     NOT NULL DEFAULT false,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipos_drive_archivos_sin_texto CHECK (carpeta <> 'salidas_n8n' OR (texto IS NULL AND error_status IS NULL))
);
CREATE INDEX IF NOT EXISTS equipos_drive_archivos_vivos ON portal.equipos_drive_archivos (carpeta) WHERE NOT borrado;

-- Una pasada está abierta mientras fin y ok son NULL. Con «fin», ok = true; si no vale, ok = false
-- con su motivo: 'abandonada' (sin «fin» en 2 h), 'tardia' («fin» pasadas 2 h) o 'textos_fallidos'
-- (2 o más archivos de una carpeta empezaron a fallar en las últimas 24 h, después de su último
-- texto bueno).
-- listados: carpeta → archivos recibidos; «fin» exige las tres carpetas.
CREATE TABLE IF NOT EXISTS portal.equipos_sincronizacion (
  id       bigserial   PRIMARY KEY,
  pasada   text        NOT NULL UNIQUE CHECK (pasada ~ '^[A-Za-z0-9_-]{1,64}$'),
  inicio   timestamptz NOT NULL DEFAULT now(),
  fin      timestamptz NULL,
  ok       boolean     NULL,
  motivo   text        NULL CHECK (motivo IN ('abandonada', 'tardia', 'textos_fallidos')),
  listados jsonb       NOT NULL DEFAULT '{}'::jsonb,
  conteos  jsonb       NULL,
  CONSTRAINT equipos_sincronizacion_estado CHECK ((fin IS NULL) = (ok IS NULL)),
  CONSTRAINT equipos_sincronizacion_motivo CHECK ((motivo IS NOT NULL) = (ok IS FALSE))
);
CREATE INDEX IF NOT EXISTS equipos_sincronizacion_completas ON portal.equipos_sincronizacion (fin DESC) WHERE ok;

-- DATA-332: con los roles activados, portal_app solo tiene lo que se le da.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON portal.equipos_drive_archivos, portal.equipos_sincronizacion TO portal_app;
    GRANT USAGE, SELECT ON SEQUENCE portal.equipos_sincronizacion_id_seq TO portal_app;
  END IF;
END $$;
