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
-- Aditiva y sin destruir nada: revertir el build no obliga a tocar la base, al
-- contrario que la 020.

CREATE SCHEMA IF NOT EXISTS portal;

ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS copia_correo VARCHAR(254) DEFAULT 'administrativo@ambientalia.com.co';
