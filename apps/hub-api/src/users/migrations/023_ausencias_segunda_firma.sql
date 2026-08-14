-- Migration 023: si las solicitudes de alguien necesitan dos firmas o una.
--
-- Hasta ahora la cascada no era negociable: si por encima del jefe inmediato
-- había alguien más, ese alguien tenía que firmar. Cuando el jefe inmediato ya
-- tiene autoridad suficiente, eso solo añade espera.
--
-- Con la casilla apagada, el de segundo nivel deja de firmar pero NO deja de
-- enterarse: su correo se congela en `informado_correo` y entra en la cadena de
-- destinatarios de la aprobación y del rechazo. Firmante e informado son
-- EXCLUYENTES: cuando uno tiene valor, el otro es NULL. Esa exclusión es lo que
-- deja intacto todo lo que ya lee `segundo_aprobador_correo` — la máquina de
-- estados, el permiso de firma, el del adjunto y el historial de aprobaciones.
--
-- Sembrado uniforme, así que DEFAULT como en la 021 y NINGÚN UPDATE: `initDb()`
-- re-ejecuta esto en cada arranque y un UPDATE devolvería la doble firma a quien
-- se la hubieran quitado desde el panel. Toda la plantilla arranca con doble
-- firma, que es el comportamiento de hoy, así que el día del despliegue no
-- cambia nada para nadie.
--
-- El DEFAULT se queda después del relleno, a propósito: `asegurarEmpleado` crea
-- fichas solas en el primer acceso de cada persona, y así ninguna nace saltándose
-- una firma por descuido.
--
-- `informado_correo` nace sin valor: las solicitudes anteriores se quedan en NULL
-- y eso ya es correcto, porque todas nacieron con doble firma.
--
-- Depende del orden del array `MIGRATIONS` de db.ts: la 015 crea
-- `portal.empleados` y `portal.solicitudes_ausencia`. Aditiva y sin destruir
-- nada: revertir el build no obliga a tocar la base.

CREATE SCHEMA IF NOT EXISTS portal;

ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS requiere_segunda_firma BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE portal.solicitudes_ausencia
  ADD COLUMN IF NOT EXISTS informado_correo VARCHAR(254);
