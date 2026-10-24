import type { Pool } from '@algarpibe/zoho-sync';
import type { EventoOutbox, EventoPendiente, PayloadEvento } from '../types.js';

// ARQ-612 — el lado LECTOR del outbox, el que n8n consulta y confirma, sacado
// de repo.ts tal cual. Los INSERT de eventos NO están aquí: van dentro de la
// transacción de cada escritura de solicitudes y modificaciones, que es lo que
// garantiza que un cambio y su aviso se guarden juntos o no se guarde ninguno.
// repo.ts lo reexporta: el resto del código lo sigue llamando como `repo.*`
// (lo vigila barril.test.ts).

/**
 * Cuánto queda reservado un evento tras servirlo. Tiene que ser holgadamente
 * mayor que lo que tarda un lote en enviarse y confirmarse (Gmail, calendario y
 * hoja, hasta 20 eventos), y menor que el barrido de 10 minutos, para que un
 * envío que se cayó de verdad se reintente en la pasada siguiente.
 */
const RESERVA = '5 minutes';

/**
 * Cuántas veces se sirve un evento antes de aparcarlo.
 *
 * ⚠️ Nació de un incidente, y conviene saber cuál antes de tocarlo. El
 * 2026-08-24 se borraron unas solicitudes desde el Registro general; sus seis
 * eventos `borrado_admin` fallaban al borrar el evento de Google —ya no estaba—
 * y el workflow de n8n no llegaba nunca al paso de confirmar. Como el correo se
 * manda ANTES de tocar el calendario, cada ciclo de diez minutos reenviaba los
 * seis. Se descubrió al día siguiente, con 119 intentos y unos setecientos
 * correos.
 *
 * El fallo de n8n se arregló aparte. Esto es el respaldo: **un evento que no se
 * confirma deja de servirse**, pase lo que pase aguas abajo. Con este tope aquel
 * incidente habrían sido treinta correos en vez de setecientos.
 *
 * Cinco y no más: el reintento existe para cubrir un fallo pasajero (Gmail que
 * no responde, un timeout), y eso se resuelve en el segundo o el tercero. Lo que
 * falla cinco veces seguidas está roto, y seguir insistiendo no lo arregla; solo
 * multiplica el daño.
 *
 * Aparcado NO es enviado: la fila conserva `enviado_at` a null a propósito, para
 * que siga saliendo en una consulta de diagnóstico como lo que es — un aviso que
 * NO se entregó y que hay que mirar a mano.
 */
export const MAX_INTENTOS = 5;

/**
 * Los eventos aún no ejecutados, del más antiguo al más nuevo.
 *
 * Sirve el evento **sin marcarlo como enviado**: el estado solo avanza en
 * `confirmarEventos`. Si Gmail falla a mitad, el evento vuelve a la cola solo. El
 * precio es que un fallo DESPUÉS de enviar el correo puede duplicarlo; se
 * prefiere un correo repetido a una solicitud que nadie ve.
 *
 * Pero servir **sí reserva**: `servido_at` lo aparta de la cola durante unos
 * minutos. Sin eso, los dos disparadores del workflow —el webhook del portal y el
 * barrido de diez minutos— pueden leer las mismas filas si arrancan con pocos
 * segundos de diferencia, porque entre servir y confirmar pasa lo que tarde el
 * envío. Ocurrió en producción: 0,7 s de separación, correo duplicado. Sobre un
 * evento `aprobada` habría sido además un evento de calendario y una fila de la
 * hoja por duplicado.
 *
 * `intentos` se incrementa aquí para poder detectar en la BD un evento que lleva
 * reintentándose sin éxito — y, desde el incidente del 2026-08-24, para dejar de
 * servirlo pasado `MAX_INTENTOS`.
 *
 * ⚠️ `FOR UPDATE SKIP LOCKED` en la subconsulta (DATA-338): la reserva por sí
 * sola no cerraba dos peticiones SOLAPADAS. La subconsulta elige los ids con la
 * foto del inicio de la sentencia; la segunda petición esperaba el candado de la
 * primera y, al soltarse, Postgres solo revisaba el WHERE de fuera —`id IN
 * (...)`, que seguía siendo cierto—, así que las dos marcaban y devolvían las
 * mismas filas. Ahora la segunda salta las que la primera tiene cogidas y se
 * lleva otras, o ninguna.
 */
export async function eventosPendientes(db: Pool, limite = 20): Promise<EventoPendiente[]> {
  const { rows } = await db.query(
    `UPDATE portal.ausencias_outbox o
        SET intentos = o.intentos + 1, servido_at = now()
      WHERE o.id IN (
              SELECT id FROM portal.ausencias_outbox
               WHERE enviado_at IS NULL
                 AND intentos < $3
                 AND (servido_at IS NULL OR servido_at < now() - $2::interval)
               ORDER BY id LIMIT $1
                 FOR UPDATE SKIP LOCKED)
      RETURNING o.id, o.evento, o.solicitud_id, o.intentos, o.payload`,
    [limite, RESERVA, MAX_INTENTOS],
  );
  // `solicitud_id` nulable desde la 028: la clave ajena es `ON DELETE SET NULL`
  // para que el borrado de un evento de Google sobreviva a la solicitud que lo
  // pidio. El cast tiene que decirlo o `tsc` se cree un `string` que puede no
  // serlo, y eso convierte un null real en un fallo en tiempo de ejecucion.
  return (rows as {
    id: string;
    evento: EventoOutbox;
    solicitud_id: string | null;
    intentos: number;
    payload: PayloadEvento;
  }[])
    .map((r) => ({
      id: Number(r.id),
      evento: r.evento,
      solicitudId: r.solicitud_id,
      intentos: r.intentos,
      payload: r.payload,
    }))
    .sort((a, b) => a.id - b.id);
}

/** Marca como enviados los ids que n8n confirma. Idempotente. */
export async function confirmarEventos(db: Pool, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { rowCount } = await db.query(
    'UPDATE portal.ausencias_outbox SET enviado_at = now() WHERE id = ANY($1::bigint[]) AND enviado_at IS NULL',
    [ids],
  );
  return rowCount ?? 0;
}
