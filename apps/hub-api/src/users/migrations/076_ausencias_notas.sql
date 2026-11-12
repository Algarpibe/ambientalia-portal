-- Migration 076: notas personales del administrador en Vacaciones y Permisos.
--
-- Lo que le piden a mano y no pasa por el flujo de solicitudes —un aviso de
-- retraso, una petición suelta, otros asuntos—, con su estado para saber qué
-- queda por atender.
--
-- Tablas propias y NO un tipo más de `solicitudes_ausencia`: meterlas ahí
-- obligaría a excluirlas en cada consulta de saldo, KPIs, calendario y Registro
-- general, y un solo olvido las mezclaría con los números de la empresa.
--
-- ⚠️ Cada nota es de quien la escribe (`autor_email`), y TODA consulta de
-- repo/notas.ts filtra por esa columna. Hoy solo hay un administrador, pero si
-- un día hay otro, no debe ver estas notas.
--
-- `empleado_id` con ON DELETE SET NULL más `empleado_nombre` copiado: RESTRICT
-- haría fallar el borrado de una ficha mal dada de alta por una nota que nadie
-- más ve, y CASCADE borraría notas sin avisar. Con la copia del nombre la nota
-- sigue legible aunque la ficha desaparezca.
--
-- ⚠️ NO siembra nada: initDb() re-ejecuta las migraciones en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.ausencias_notas (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  empleado_id     UUID         REFERENCES portal.empleados(id) ON DELETE SET NULL,
  empleado_nombre VARCHAR(255) NOT NULL,
  categoria       VARCHAR(20)  NOT NULL CONSTRAINT ausencias_notas_categoria_ck CHECK (categoria IN ('retraso', 'solicitud', 'otro')),
  fecha           DATE         NOT NULL,
  -- Ni btrim ni char_length(btrim(...)): btrim sin segundo argumento solo quita
  -- el espacio U+0020, así que un comentario de solo tabuladores o saltos de línea
  -- pasaría por «no vacío», y el tope de 2000 se mediría sobre el texto recortado
  -- y no sobre el que se guarda. '\S' exige algún carácter que no sea blanco y el
  -- tope se mide sobre lo guardado. Ojo: para Postgres el espacio duro (U+00A0)
  -- NO es blanco; un comentario solo de eso lo para el servicio, que guarda el
  -- texto tras el trim() de JS.
  comentario      TEXT         NOT NULL CONSTRAINT ausencias_notas_comentario_ck CHECK (comentario ~ '\S' AND char_length(comentario) <= 2000),
  estado          VARCHAR(10)  NOT NULL DEFAULT 'abierta' CONSTRAINT ausencias_notas_estado_ck CHECK (estado IN ('abierta', 'resuelta')),
  resuelta_at     TIMESTAMPTZ,
  autor_email     VARCHAR(254) NOT NULL CONSTRAINT ausencias_notas_autor_minusculas_ck CHECK (autor_email = lower(autor_email)),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- Resuelta si y solo si tiene fecha de resolución: así ningún UPDATE puede
  -- dejar una nota «resuelta» sin cuándo, ni una «abierta» con fecha colgando.
  CONSTRAINT ausencias_notas_resuelta_coherente CHECK ((estado = 'resuelta') = (resuelta_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_ausencias_notas_autor ON portal.ausencias_notas (autor_email, fecha DESC);

-- La imagen va aparte, como `solicitud_adjuntos`, para que listar notas no
-- arrastre los bytes. UNIQUE (nota_id): una imagen como máximo por nota.
CREATE TABLE IF NOT EXISTS portal.ausencias_nota_imagenes (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_id        UUID         NOT NULL UNIQUE REFERENCES portal.ausencias_notas(id) ON DELETE CASCADE,
  nombre_archivo VARCHAR(255) NOT NULL,
  mime           VARCHAR(20)  NOT NULL CONSTRAINT ausencias_nota_imagenes_mime_ck CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  contenido      BYTEA        NOT NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- DATA-332: con los roles activados, portal_app solo tiene lo que se le da. La
-- 068 concede ALL TABLES, pero corre antes que esta en el mismo arranque.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON portal.ausencias_notas, portal.ausencias_nota_imagenes TO portal_app;
  END IF;
END $$;
