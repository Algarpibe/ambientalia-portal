-- Migración 029: el compensatorio deja de ser gratis y pasa a tener bolsa propia.
--
-- Un compensatorio son días que el empleado gana por horas extras, días extras o
-- un viaje que se alargó, y que la empresa le paga en tiempo libre. El tipo
-- existe desde la 015 y se podía solicitar sin descontar de ninguna parte: no
-- había forma de saber cuántos días le quedaban a nadie.
--
-- Columnas PROPIAS y no la pareja de la 017. Las dos bolsas se cuadran contra
-- recuentos distintos y en momentos distintos, así que compartir `fecha_corte`
-- obligaría a moverlas a la vez o a mentir en una — y corregir el corte de
-- vacaciones movería en silencio el conteo de compensatorios.
--
-- El compensatorio NO devenga con el tiempo: no hay ningún «+1,25 al mes» que
-- aplicarle, solo crece cuando alguien otorga. Por eso aquí `fecha_corte`
-- significa únicamente FRONTERA DE DESCUENTO, y no además origen de devengo como
-- en la 017. Es la diferencia que hace que las dos bolsas no puedan compartir
-- fórmula aunque compartan forma.
--
-- Solo DDL e idempotente: `initDb()` la re-ejecuta en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

-- NUMERIC(5,1) por lo mismo que `saldo_corte` en la 017: el medio día es un valor
-- real y la décima es la precisión con la que se enseña.
ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS compensatorios_saldo_corte NUMERIC(5,1);

ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS compensatorios_fecha_corte DATE;

-- Las dos o ninguna, gemelo de `empleados_saldo_completo` y por la misma razón:
-- media configuración enseñaría un saldo inventado.
--
-- La guarda mira `conname` porque este nombre lo ponemos nosotros — al contrario
-- que en la 028, donde lo había puesto Postgres y había que reconocer el
-- constraint por su contenido (`confdeltype`). Se acota igualmente por
-- `conrelid`: `conname` es único por tabla, no por esquema, y sin esa condición
-- un homónimo en otra tabla de `portal` dejaría este bloque sin ejecutarse en
-- silencio.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'portal.empleados'::regclass
       AND conname  = 'empleados_compensatorios_completo'
  ) THEN
    ALTER TABLE portal.empleados
      ADD CONSTRAINT empleados_compensatorios_completo
      CHECK ((compensatorios_saldo_corte IS NULL) = (compensatorios_fecha_corte IS NULL));
  END IF;
END $$;
