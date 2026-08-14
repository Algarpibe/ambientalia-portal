-- Migration 022: quién puede abrir CUALQUIER soporte, ficha por ficha.
--
-- Hasta ahora era la constante `VISORES_ADJUNTOS` de config.ts, con dos correos.
-- Añadir a alguien exigía tocar código y desplegar.
--
-- ⚠️ Esto es una llave maestra, y lo que abre incluye el soporte médico de las
-- incapacidades ajenas: dato de salud, con lo que implica la Ley 1581. La lista
-- tiene que quedarse corta y cada persona estar justificada.
--
-- El sembrado NO se puede hacer con un DEFAULT como en la 021, porque aquí el
-- valor no es el mismo para todos: solo dos correos arrancan en TRUE. Y un
-- UPDATE suelto está prohibido, porque `initDb()` re-ejecuta esto en cada
-- arranque y devolvería la llave a quien se la hubieran quitado. La salida es
-- condicionarlo a que la columna ACABE de crearse: en los arranques siguientes
-- ya existe, no se entra en el IF y nada se toca.
--
-- El UPDATE va dentro de un EXECUTE a propósito: una sentencia estática en
-- plpgsql se analiza contra el catálogo, y esta referencia una columna creada
-- dos líneas más arriba en el mismo bloque. EXECUTE difiere el análisis hasta
-- ejecutarla. Si fallara, la migración lanza, hub-api no arranca y se cae el
-- portal entero.

CREATE SCHEMA IF NOT EXISTS portal;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'portal' AND table_name = 'empleados'
                    AND column_name = 've_adjuntos') THEN
    ALTER TABLE portal.empleados ADD COLUMN ve_adjuntos BOOLEAN NOT NULL DEFAULT FALSE;
    EXECUTE $upd$
      UPDATE portal.empleados SET ve_adjuntos = TRUE
       WHERE lower(correo) IN ('comercial@ambientalia.com.co', 'administrativo@ambientalia.com.co')
    $upd$;
  END IF;
END $$;

-- El registro de quién dio o quitó la llave. En BD y no por stdout como el
-- AuditLogger de usuarios: al salir la lista del código, git deja de ser el
-- historial de estos accesos, y los logs de EasyPanel se rotan.
--
-- Guarda el correo ADEMÁS del id, y sin clave foránea: si la ficha se borra, el
-- registro tiene que seguir diciendo a quién se le dio la llave. Un registro de
-- auditoría que desaparece con su sujeto no es un registro de auditoría.
CREATE TABLE IF NOT EXISTS portal.visores_adjuntos_log (
  id              BIGSERIAL    PRIMARY KEY,
  admin_email     VARCHAR(254) NOT NULL,
  empleado_id     UUID         NOT NULL,
  empleado_correo VARCHAR(254) NOT NULL,
  concedido       BOOLEAN      NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
