-- Migration 045: Trazabilidad Mantenimientos Clientes - tipo de servicio
-- compuesto «Diagnóstico + Calibración».
--
-- Siembra la fila del tipo compuesto en portal.tmc_plazos para que se pueda
-- elegir a mano en la pestana «Servicios» y salga en «Configuración», igual
-- que cualquier otro tipo (la API solo deja elegir tipos con fila aqui).
--
-- Su plazo NO se guarda: dias_habiles queda NULL y nadie lo lee. El plazo es
-- la suma, calculada en vivo, de los plazos de sus partes (Diagnóstico y
-- Calibración). La composicion vive en un solo sitio del codigo:
-- TIPOS_COMPUESTOS en trazabilidad/dominio.ts. Por eso no hay columna nueva.
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. Only an
-- INSERT ... ON CONFLICT DO NOTHING here: a second run neither duplicates the
-- row nor overwrites it. Never add a statement that fails or changes data on
-- a second run. plazos.test.ts vigila esta regla.
--
-- `clave` es la normalizacion de `etiqueta` (claveTipoServicio: minusculas,
-- sin tildes, espacios simples; el « + » se conserva). plazos.test.ts vigila
-- que coincidan y que la clave sea una de TIPOS_COMPUESTOS.
--
-- Depende de la 043 (crea la tabla). Nada de esto toca el esquema desk: esa
-- replica es del worker de zoho-hub.

INSERT INTO portal.tmc_plazos (clave, etiqueta, dias_habiles) VALUES
  ('diagnostico + calibracion', 'Diagnóstico + Calibración', NULL)
ON CONFLICT (clave) DO NOTHING;
