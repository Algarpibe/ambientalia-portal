-- Baja de empleados que se retiran de la compañía.
--
-- `fecha_retiro` es el ÚLTIMO DÍA QUE TRABAJA, y ese día la ficha todavía está
-- activa. No es el primer día que ya no está. De esa definición cuelgan todas
-- las comparaciones del código: el barrido usa `<` y no `<=`, y la congelación
-- del devengo usa `min(hoy, fecha_retiro)`. Con `<=` se retiraría a alguien en
-- su último día de trabajo y se le recortaría un día de devengo — sobre un
-- número que se le paga.
--
-- `retirado_por` y `retirado_at` no son adorno: son la constancia de quién fijó
-- ese número. Se rellenan al REGISTRAR la baja, no al aplicarla.
--
-- Sin CHECK que ate las tres: una ficha desactivada a mano antes de que esta
-- feature existiera tiene `activo = false` y las tres a null, y es un estado
-- legítimo que no hay que romper.
ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS fecha_retiro DATE;

ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS retirado_por VARCHAR(254);

ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS retirado_at TIMESTAMPTZ;

-- El barrido pregunta por las fichas activas con fecha vencida. Parcial porque
-- la inmensa mayoría de las filas tienen `fecha_retiro` a null y no interesan.
CREATE INDEX IF NOT EXISTS idx_empleados_fecha_retiro
  ON portal.empleados (fecha_retiro)
  WHERE fecha_retiro IS NOT NULL;
