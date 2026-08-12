-- Migration 015: app «Vacaciones y Permisos» (ausencias).
-- Traslada al portal el flujo de n8n «Solicitud vacaciones_permisos_
-- compensatorios_incapacidades 1.5»: maestro de empleados, solicitudes con su
-- ciclo de aprobación, adjuntos (PDF de incapacidades/permisos) y una cola de
-- salida que n8n consume para mandar correos, crear eventos de calendario,
-- subir a Drive y replicar en Google Sheets.
-- Vive en el esquema `portal` (escribible), NO en la réplica read-only de Zoho.
-- Idempotente: safe en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

-- ── Maestro de empleados ───────────────────────────────────────────────────
-- Sustituye a la hoja `consolidado` de Google Sheets, que hoy consulta un
-- agente de OpenAI a partir de un «número de credencial» tecleado. Aquí el
-- solicitante se identifica por su sesión del portal: `user_id` enlaza con
-- portal.users. `credencial` se conserva solo para poder cruzar con el
-- histórico de la hoja; ya no autentica a nadie.
CREATE TABLE IF NOT EXISTS portal.empleados (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_completo  VARCHAR(255) NOT NULL,
  correo           VARCHAR(254) NOT NULL,
  cargo            VARCHAR(255),
  credencial       INTEGER,
  aprobador_correo VARCHAR(254) NOT NULL DEFAULT 'comercial@ambientalia.com.co',
  user_id          UUID         REFERENCES portal.users(id) ON DELETE SET NULL,
  activo           BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT empleados_correo_unique UNIQUE (correo)
);

CREATE INDEX IF NOT EXISTS idx_empleados_user_id   ON portal.empleados (user_id);
CREATE INDEX IF NOT EXISTS idx_empleados_aprobador ON portal.empleados (aprobador_correo);

-- ── Solicitudes ────────────────────────────────────────────────────────────
-- `registrada` es el estado terminal de las INCAPACIDADES: se informan, no se
-- aprueban (en el flujo de n8n la rama de incapacidades se salta el
-- `sendAndWait`). Los otros tres tipos nacen `pendiente` y acaban en
-- `aprobada` o `rechazada`.
CREATE TABLE IF NOT EXISTS portal.solicitudes_ausencia (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo              VARCHAR(20) NOT NULL
                                CHECK (tipo IN ('vacaciones', 'permiso', 'compensatorio', 'incapacidad')),
  empleado_id       UUID        NOT NULL REFERENCES portal.empleados(id) ON DELETE CASCADE,
  solicitante_email VARCHAR(254) NOT NULL,
  fecha_inicio      DATE        NOT NULL,
  fecha_fin         DATE        NOT NULL,
  dias_habiles      INTEGER     NOT NULL,
  comentarios       TEXT,
  estado            VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                                CHECK (estado IN ('pendiente', 'aprobada', 'rechazada', 'registrada')),
  aprobador_correo  VARCHAR(254),
  aprobador_user_id UUID        REFERENCES portal.users(id) ON DELETE SET NULL,
  decidida_at       TIMESTAMPTZ,
  motivo_rechazo    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT solicitudes_rango_valido CHECK (fecha_fin >= fecha_inicio)
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_empleado  ON portal.solicitudes_ausencia (empleado_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_solicitudes_estado    ON portal.solicitudes_ausencia (estado);
CREATE INDEX IF NOT EXISTS idx_solicitudes_aprobador ON portal.solicitudes_ausencia (aprobador_correo) WHERE estado = 'pendiente';

-- ── Adjuntos ───────────────────────────────────────────────────────────────
-- El PDF se guarda en la BD (son pocos y pequeños) y n8n lo recoge para subirlo
-- a Google Drive; `drive_file_id` se rellena al confirmar. Guardarlo aquí
-- además de en Drive da un rastro auditable si alguien mueve la carpeta.
CREATE TABLE IF NOT EXISTS portal.solicitud_adjuntos (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id   UUID         NOT NULL REFERENCES portal.solicitudes_ausencia(id) ON DELETE CASCADE,
  nombre_archivo VARCHAR(255) NOT NULL,
  mime           VARCHAR(100) NOT NULL,
  contenido      BYTEA        NOT NULL,
  drive_file_id  TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_adjuntos_solicitud ON portal.solicitud_adjuntos (solicitud_id);

-- ── Cola de salida hacia n8n ───────────────────────────────────────────────
-- hub-api decide QUÉ hay que notificar; n8n pregunta por horario, ejecuta y
-- confirma (mismo patrón que WO-sales). `enviado_at IS NULL` = pendiente. El
-- estado NO avanza al servir el evento, solo al confirmarlo: si Gmail falla, el
-- siguiente ciclo reintenta solo.
CREATE TABLE IF NOT EXISTS portal.ausencias_outbox (
  id           BIGSERIAL   PRIMARY KEY,
  solicitud_id UUID        NOT NULL REFERENCES portal.solicitudes_ausencia(id) ON DELETE CASCADE,
  evento       VARCHAR(20) NOT NULL
                           CHECK (evento IN ('creada', 'aprobada', 'rechazada', 'registrada')),
  payload      JSONB       NOT NULL,
  intentos     INTEGER     NOT NULL DEFAULT 0,
  enviado_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice parcial: la consulta caliente (cada minuto) es «dame lo pendiente».
CREATE INDEX IF NOT EXISTS idx_outbox_pendiente ON portal.ausencias_outbox (id) WHERE enviado_at IS NULL;
