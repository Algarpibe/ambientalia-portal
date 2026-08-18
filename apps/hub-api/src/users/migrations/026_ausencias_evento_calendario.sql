-- Migración 026: de qué evento de Google Calendar es dueña cada solicitud.
--
-- Hasta ahora el sistema creaba el evento y se olvidaba de él: el payload que
-- consume n8n no llevaba ninguna identidad, así que anular o reprogramar una
-- ausencia ya aprobada no podía corregir nada. La compensación era un correo
-- con el asunto «⚠️ Ajustar calendario y hoja — » pidiendo que alguien de
-- Administración fuera a Google a mano.
--
-- El id no hace falta averiguarlo: se impone. Google acepta que el que crea el
-- evento le fije el id, siempre que sea base32hex (de 5 a 1024 caracteres de
-- [0-9a-v]), y un uuid sin guiones son 32 caracteres de [0-9a-f], que cae
-- dentro. Así que el evento pasa a llamarse como la solicitud, y corregirlo
-- después es un `update` y borrarlo un `delete`, sin nada que reconciliar.
--
-- Entonces, ¿para qué esta columna, si el id se puede derivar del `id` de la
-- fila en cualquier momento? Por dos razones, y ninguna es guardar el valor:
--
--   1. NULL responde a la única pregunta que importa: «¿este evento lo creamos
--      nosotros?». Las solicitudes aprobadas ANTES de este cambio tienen en
--      Google un evento con el id que Google inventó, que nadie apuntó y que
--      por tanto no se puede tocar. Esas se quedan con el aviso manual de
--      siempre. Sin esta columna no hay forma de distinguirlas, y el sistema
--      emitiría correcciones contra ids que no existen.
--   2. Guarda el valor, no la receta. Si algún día cambia la derivación, las
--      filas viejas siguen apuntando a su evento de verdad. Una columna que
--      dijera solo «sí, lo creamos nosotros» sería una afirmación que caduca.
--
-- Sin backfill a propósito: rellenarla para las viejas sería justo la mentira
-- que el punto 1 evita.
--
-- Solo DDL e idempotente: `initDb()` la re-ejecuta en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

-- `ADD COLUMN IF NOT EXISTS` sin DEFAULT es metadato puro: no reescribe la
-- tabla. Toma el ACCESS EXCLUSIVE un instante, que en esta tabla —consultada
-- por el portal entero— es justo lo que hay que mantener corto.
ALTER TABLE portal.solicitudes_ausencia
  ADD COLUMN IF NOT EXISTS evento_calendario_id TEXT;
