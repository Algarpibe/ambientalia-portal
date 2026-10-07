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
-- Categoria y papel del reloj son columnas DISTINTAS con usos distintos, y
-- esta migracion no nombra la del papel en ninguna sentencia: ni la lee ni la
-- escribe. Una fila que se crea aqui nace con el papel por defecto de la 046,
-- que es el mismo que vale para un estado sin fila.
--
-- No se crea otra tabla: se extiende portal.tmc_estados_desk. La 046 no se
-- puede editar para esto (CREATE TABLE IF NOT EXISTS no altera una tabla que
-- ya existe), asi que las columnas llegan con ADD COLUMN IF NOT EXISTS y los
-- CHECK, con nombre, solo si faltan.
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. The seed below
-- is an upsert that ONLY fills a NULL category: a status somebody already
-- classified in the app is never touched again, on this boot or any other
-- (the app never stores a NULL category, so a choice cannot look "empty").
-- The seed never deletes, and never writes any other column of an existing
-- row. Never add a statement that fails or changes chosen data on a second
-- run. agenda-config.test.ts vigila esta regla.
--
-- La semilla es la propuesta de partida del analisis (seccion C.3 de
-- docs/trazabilidad-agenda-taller.md): los 23 estados del blueprint. `clave`
-- es el estado normalizado (claveEstadoDesk) y `etiqueta`, como se escribe.
-- Las filas que la semilla CREA van firmadas por ella en actualizado_por; en
-- las que ya existian solo se rellenan categoria y etapa, y la firma de quien
-- eligio su papel se conserva. Un estado que no este en esta lista queda sin
-- categoria (NULL) hasta que alguien se la elija.
--
-- Nada de esto toca la replica de tickets ni la base de la herramienta de
-- tickets: son de otros servicios y aqui solo se leen.

ALTER TABLE portal.tmc_estados_desk
  ADD COLUMN IF NOT EXISTS categoria VARCHAR(12) NULL;

ALTER TABLE portal.tmc_estados_desk
  ADD COLUMN IF NOT EXISTS etapa VARCHAR(12) NULL;

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

INSERT INTO portal.tmc_estados_desk AS e (clave, etiqueta, categoria, etapa, actualizado_por) VALUES
  ('ov asignada', 'OV asignada', 'por_llegar', NULL, 'semilla (migracion 050)'),
  ('ticket creado', 'Ticket creado', 'por_llegar', NULL, 'semilla (migracion 050)'),
  ('remision creada', 'Remisión creada', 'entrada', NULL, 'semilla (migracion 050)'),
  ('ingresado', 'Ingresado', 'entrada', NULL, 'semilla (migracion 050)'),
  ('rev./diagnostico', 'Rev./Diagnostico', 'activa', 'diagnostico', 'semilla (migracion 050)'),
  ('notificado', 'Notificado', 'activa', 'diagnostico', 'semilla (migracion 050)'),
  ('en proceso', 'En Proceso', 'activa', 'proceso', 'semilla (migracion 050)'),
  ('continuacion del proceso', 'Continuación del proceso', 'activa', 'proceso', 'semilla (migracion 050)'),
  ('verificacion', 'Verificación', 'activa', 'verificacion', 'semilla (migracion 050)'),
  ('notificacion a compras', 'Notificación a Compras', 'standby', NULL, 'semilla (migracion 050)'),
  ('notificacion comercial', 'Notificación Comercial', 'standby', NULL, 'semilla (migracion 050)'),
  ('notificacion cliente', 'Notificación cliente', 'standby', NULL, 'semilla (migracion 050)'),
  ('en espera de sku inventario', 'En espera de SKU inventario', 'standby', NULL, 'semilla (migracion 050)'),
  ('en espera de repuestos', 'En Espera de Repuestos', 'standby', NULL, 'semilla (migracion 050)'),
  ('solicitado', 'Solicitado', 'standby', NULL, 'semilla (migracion 050)'),
  ('servicio externo', 'Servicio externo', 'standby', NULL, 'semilla (migracion 050)'),
  ('por facturar', 'Por Facturar', 'fin', NULL, 'semilla (migracion 050)'),
  ('liberacion comercial', 'Liberación Comercial', 'fin', NULL, 'semilla (migracion 050)'),
  ('por entregar', 'Por Entregar', 'fin', NULL, 'semilla (migracion 050)'),
  ('por entregar / sin facturar', 'Por Entregar / Sin facturar', 'fin', NULL, 'semilla (migracion 050)'),
  ('finalizado', 'Finalizado', 'fin', NULL, 'semilla (migracion 050)'),
  ('pendiente', 'Pendiente', 'fuera', NULL, 'semilla (migracion 050)'),
  ('solicitud soporte', 'Solicitud Soporte', 'fuera', NULL, 'semilla (migracion 050)')
ON CONFLICT (clave) DO UPDATE
  SET categoria = EXCLUDED.categoria, etapa = EXCLUDED.etapa
  WHERE e.categoria IS NULL;
