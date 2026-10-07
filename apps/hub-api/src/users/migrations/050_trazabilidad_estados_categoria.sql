-- Migration 050: Trazabilidad Mantenimientos Clientes - agenda del taller:
-- categoria y etapa de cada estado de Zoho.
--
-- Ademas de su papel en el reloj del plazo (migracion 046), cada estado tiene
-- una CATEGORIA en la agenda del taller, y solo una:
--   por_llegar - el equipo aun no ha llegado (lista aparte, sin proyectar);
--   entrada    - fila de entrada: el equipo llego y espera su primera etapa;
--   activa     - etapa activa: ocupa un puesto. Lleva ademas su ETAPA
--                (diagnostico, proceso o verificacion);
--   standby    - no ocupa puesto: depende del cliente, de Comercial, de Compras
--                o de terceros;
--   fin        - fin de taller: el trabajo esta hecho y libera el puesto;
--   fuera      - fuera de la agenda (soporte remoto).
-- Los valores son los de CATEGORIAS_AGENDA y ETAPAS_AGENDA en
-- trazabilidad/dominio.ts (agenda-config.test.ts vigila que coincidan).
--
-- Categoria y papel del reloj son cosas DISTINTAS con usos distintos, y cada
-- una lleva SU firma:
--   papel del reloj   -> actualizado_por_id, actualizado_por, actualizado_en
--                        (las de la 046);
--   categoria y etapa -> categoria_por_id, categoria_por, categoria_en
--                        (las de aqui).
-- Elegir una no toca la otra ni su firma. Esta migracion no nombra la columna
-- del papel en ninguna sentencia: ni la lee ni la escribe.
--
-- La firma del papel deja de ser obligatoria (DROP NOT NULL en actualizado_por
-- y actualizado_en): una fila puede existir solo porque tiene categoria, y
-- entonces su papel es el por defecto de la 046 -el mismo que vale para un
-- estado sin fila- y no lo ha elegido nadie. Con la firma vacia, la pantalla
-- lo ensena como lo que es: un estado que nadie ha tocado.
--
-- No se crea otra tabla: se extiende portal.tmc_estados_desk. La 046 no se
-- puede editar para esto (CREATE TABLE IF NOT EXISTS no altera una tabla que
-- ya existe), asi que las columnas llegan con ADD COLUMN IF NOT EXISTS y los
-- CHECK, con nombre, solo si faltan.
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. ADD COLUMN IF
-- NOT EXISTS and DROP NOT NULL are no-ops the second time. The seed below is
-- an upsert that ONLY fills a NULL category: a status somebody already
-- classified in the app is never touched again, on this boot or any other
-- (the app never stores a NULL category, so a choice cannot look "empty").
-- The seed never deletes, and in an existing row it writes the category, the
-- stage and the category signature, nothing else. Never add a statement that
-- fails or changes chosen data on a second run. agenda-config.test.ts vigila
-- esta regla.
--
-- La semilla es la propuesta de partida del analisis (seccion C.3 de
-- docs/trazabilidad-agenda-taller.md): los 23 estados del blueprint. `clave`
-- es el estado normalizado (claveEstadoDesk) y `etiqueta`, como se escribe.
-- La categoria sembrada va firmada por la semilla en categoria_por. En una
-- fila que ya existia, la firma de quien eligio su papel se conserva tal cual;
-- en una fila que la semilla CREA, la firma del papel queda vacia. Un estado
-- que no este en esta lista queda sin categoria (NULL) hasta que alguien se la
-- elija.
--
-- Nada de esto toca la replica de tickets ni la base de la herramienta de
-- tickets: son de otros servicios y aqui solo se leen.

ALTER TABLE portal.tmc_estados_desk
  ADD COLUMN IF NOT EXISTS categoria VARCHAR(12) NULL;

ALTER TABLE portal.tmc_estados_desk
  ADD COLUMN IF NOT EXISTS etapa VARCHAR(12) NULL;

ALTER TABLE portal.tmc_estados_desk
  ADD COLUMN IF NOT EXISTS categoria_por_id UUID NULL;

ALTER TABLE portal.tmc_estados_desk
  ADD COLUMN IF NOT EXISTS categoria_por VARCHAR(254) NULL;

ALTER TABLE portal.tmc_estados_desk
  ADD COLUMN IF NOT EXISTS categoria_en TIMESTAMPTZ NULL;

ALTER TABLE portal.tmc_estados_desk
  ALTER COLUMN actualizado_por DROP NOT NULL,
  ALTER COLUMN actualizado_en DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tmc_estados_desk_categoria_check') THEN
    ALTER TABLE portal.tmc_estados_desk
      ADD CONSTRAINT tmc_estados_desk_categoria_check
      CHECK (categoria IN ('por_llegar', 'entrada', 'activa', 'standby', 'fin', 'fuera'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tmc_estados_desk_etapa_check') THEN
    ALTER TABLE portal.tmc_estados_desk
      ADD CONSTRAINT tmc_estados_desk_etapa_check
      CHECK (etapa IN ('diagnostico', 'proceso', 'verificacion'));
  END IF;
  -- Solo una etapa activa lleva etapa, y la lleva siempre. Sin categoria (NULL)
  -- tampoco puede haber etapa.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tmc_estados_desk_etapa_activa_check') THEN
    ALTER TABLE portal.tmc_estados_desk
      ADD CONSTRAINT tmc_estados_desk_etapa_activa_check
      CHECK ((categoria IS NOT DISTINCT FROM 'activa') = (etapa IS NOT NULL));
  END IF;
END $$;

-- La firma del papel va en la lista de columnas solo para dejarla VACIA en las
-- filas nuevas (sin nombrarla, la fecha cogeria su valor por defecto y la fila
-- pareceria tocada). En una fila que ya existe no se escribe: no esta en el SET.
INSERT INTO portal.tmc_estados_desk AS e (clave, etiqueta, categoria, etapa, categoria_por, categoria_en, actualizado_por, actualizado_en)
SELECT s.clave, s.etiqueta, s.categoria, s.etapa, 'semilla (migracion 050)', NOW(), NULL::varchar, NULL::timestamptz
  FROM (VALUES
    ('ov asignada', 'OV asignada', 'por_llegar', NULL),
    ('ticket creado', 'Ticket creado', 'por_llegar', NULL),
    ('remision creada', 'Remisión creada', 'entrada', NULL),
    ('ingresado', 'Ingresado', 'entrada', NULL),
    ('rev./diagnostico', 'Rev./Diagnostico', 'activa', 'diagnostico'),
    ('notificado', 'Notificado', 'activa', 'diagnostico'),
    ('en proceso', 'En Proceso', 'activa', 'proceso'),
    ('continuacion del proceso', 'Continuación del proceso', 'activa', 'proceso'),
    ('verificacion', 'Verificación', 'activa', 'verificacion'),
    ('notificacion a compras', 'Notificación a Compras', 'standby', NULL),
    ('notificacion comercial', 'Notificación Comercial', 'standby', NULL),
    ('notificacion cliente', 'Notificación cliente', 'standby', NULL),
    ('en espera de sku inventario', 'En espera de SKU inventario', 'standby', NULL),
    ('en espera de repuestos', 'En Espera de Repuestos', 'standby', NULL),
    ('solicitado', 'Solicitado', 'standby', NULL),
    ('servicio externo', 'Servicio externo', 'standby', NULL),
    ('por facturar', 'Por Facturar', 'fin', NULL),
    ('liberacion comercial', 'Liberación Comercial', 'fin', NULL),
    ('por entregar', 'Por Entregar', 'fin', NULL),
    ('por entregar / sin facturar', 'Por Entregar / Sin facturar', 'fin', NULL),
    ('finalizado', 'Finalizado', 'fin', NULL),
    ('pendiente', 'Pendiente', 'fuera', NULL),
    ('solicitud soporte', 'Solicitud Soporte', 'fuera', NULL)
  ) AS s (clave, etiqueta, categoria, etapa)
ON CONFLICT (clave) DO UPDATE
  SET categoria = EXCLUDED.categoria, etapa = EXCLUDED.etapa,
      categoria_por = EXCLUDED.categoria_por, categoria_en = EXCLUDED.categoria_en
  WHERE e.categoria IS NULL;
