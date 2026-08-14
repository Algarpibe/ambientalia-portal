-- Migration 021: a quién se pone en copia, ficha por ficha.
--
-- Hasta ahora la copia era una constante para toda la empresa
-- (`COPIA_ADMINISTRACION` en config.ts, con `comercial@` y `administrativo@`).
-- Cambiarla exigía tocar código y desplegar, y era la misma para todo el mundo.
--
-- NULL = sin copia.
--
-- El DEFAULT es lo que hace el sembrado, y por eso NO hay ningún UPDATE aquí:
-- `initDb()` re-ejecuta esta migración en cada arranque, así que un UPDATE
-- volvería a poner `administrativo@` en cada despliegue y machacaría las copias
-- que se hubieran ajustado a mano desde el panel. `ADD COLUMN ... DEFAULT`
-- rellena las filas existentes UNA vez; a partir de ahí el IF NOT EXISTS hace
-- que esto no toque nada.
--
-- El DEFAULT se queda después del relleno, a propósito: `asegurarEmpleado` crea
-- fichas solas en el primer acceso de cada persona, y así ninguna nace sin copia
-- por descuido. Quitarla es una edición explícita desde el organigrama.
--
-- Lo que eso decide, dicho entero: quien entre por primera vez de aquí en
-- adelante nace con administración en copia sin que nadie lo haya decidido, y
-- eso incluye el acuse de sus incapacidades, que es información de salud.
-- Tampoco se podrá distinguir «configurado a administrativo@» de «nunca
-- revisado». Es reversible y limpio cuando se quiera: una 022 con
-- `ALTER TABLE portal.empleados ALTER COLUMN copia_correo DROP DEFAULT;`, que es
-- idempotente (no-op si ya no hay default) y por tanto re-ejecutable.
--
-- ⚠️ NO editar el literal de este fichero para cambiar la copia por defecto: las
-- bases que ya corrieron la migración no se enterarían (el IF NOT EXISTS corta)
-- pero una base nueva sí, y los entornos divergirían en silencio. Cambiarlo pide
-- una migración nueva con `ALTER COLUMN ... SET DEFAULT`.
--
-- Depende del orden del array `MIGRATIONS` de db.ts: la 015 crea
-- `portal.empleados`. El `CREATE SCHEMA` de abajo es estilo de la casa, no una
-- red — si la tabla faltara, crear el esquema vacío no evitaría el error, y como
-- `initDb()` no captura, hub-api no arrancaría. Que falle ruidosamente es lo
-- correcto: un `ALTER TABLE IF EXISTS` lo convertiría en un salto silencioso.
--
-- Aditiva y sin destruir nada: revertir el build no obliga a tocar la base, al
-- contrario que la 020.

CREATE SCHEMA IF NOT EXISTS portal;

ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS copia_correo VARCHAR(254) DEFAULT 'administrativo@ambientalia.com.co';
