import { authHeaders } from '@suite/auth-client';
import { mensajeDeError } from '@suite/http';
import { API_BASE, get, patch, patchSolapable } from './http';
import type { EstadoModificacion, EstadoSolicitud, Modificacion, Solicitud, TipoSolicitud } from './tipos';

// ARQ-612 — el registro de movimientos y las correcciones de admin sobre él,
// sacados de api.ts tal cual: leerlo, y corregir o borrar una solicitud o una
// fila del registro. api.ts lo reexporta (lo vigila barril.test.ts).

// ── El registro de movimientos ─────────────────────────────────────────────
// Espejo de `apps/hub-api/src/ausencias/types.ts`, a partir de `CLASES_MOVIMIENTO`.
// Sustituye a `GET /ausencias/historico`, que ya no existe.

/**
 * Las clases de movimiento del registro. Las dos de modificación se llaman
 * EXACTAMENTE igual que en la base de datos (`ClaseModificacion`), y no con
 * sinónimos como `cambio`: una traducción de vocabulario entre la tabla y la
 * pantalla es una capa más que puede derivar en silencio, y no compra nada.
 */
export const CLASES_MOVIMIENTO = ['solicitud', 'fechas', 'anulacion'] as const;
export type ClaseMovimiento = (typeof CLASES_MOVIMIENTO)[number];

/**
 * Quién tomó la decisión.
 *
 * `aproximado` no es decorativo: en las sesiones con token legacy
 * `aprobador_user_id` es NULL, y entonces esto sale del `aprobador_correo`
 * congelado en el alta, que es *quién debía firmar* y no necesariamente quién
 * firmó —un admin pudo destrabarla en su lugar—. Enseñarlo sin marca sería
 * afirmar una autoría que no consta.
 */
export interface DecididaPor {
  nombre: string | null;
  correo: string;
  aproximado: boolean;
}

/**
 * Los campos comunes a toda fila del registro. `clase` y `estado` quedan
 * fuera: van en `Movimiento`, que los une para poder discriminar por `clase`.
 *
 * Plana y no una unión con objetos anidados, porque los filtros por tipo,
 * persona y año, los contadores y el CSV ya operan sobre una lista plana de
 * solicitudes y así siguen valiendo casi sin tocarlos.
 */
interface MovimientoBase {
  /** El de la solicitud o el de la modificación, según la clase. */
  id: string;
  /** Siempre el de la solicitud afectada, también en anulaciones y cambios. */
  solicitudId: string;
  empleadoNombre: string;
  empleadoCargo: string | null;
  solicitanteEmail: string;
  /** El tipo de la SOLICITUD afectada, para que el filtro por tipo siga valiendo. */
  tipo: TipoSolicitud;
  /**
   * Las fechas y días EFECTIVOS del movimiento. En una `anulacion` son las
   * PREVIAS: un CHECK en la BD garantiza que las nuevas van a null. En un
   * `fechas` son las nuevas, que es lo que se propuso.
   */
  fechaInicio: string;
  fechaFin: string;
  /**
   * La franja del día, `HH:MM`. `null` en todo lo que no sea un permiso con
   * horario, y `null` SIEMPRE en una modificación: una anulación o un cambio de
   * fechas no tiene franja propia.
   *
   * Espejo manual de `MovimientoBase` en hub-api: mismos nombres, obligatorios.
   */
  horaInicio: string | null;
  horaFin: string | null;
  /** Decimal: el histórico de la hoja trae medios días (6,5) y son dato real. */
  diasHabiles: number;
  decididaAt: string | null;
  /**
   * Regla para quien escriba una consulta sobre esto: con
   * `estado === 'retirada'` esto va SIEMPRE a `null`. Una `retirada` la quita
   * el propio solicitante, no un aprobador —quién fue ya consta en
   * `solicitanteEmail`—, así que rellenarla con el `aprobadorCorreo`
   * congelado en el alta atribuiría el acto a alguien que nunca lo hizo.
   */
  decididaPor: DecididaPor | null;
  createdAt: string;
  /** `comentarios` en una solicitud; `motivo` en una anulación o un cambio. */
  motivo: string | null;
}

/**
 * Una fila del registro: una solicitud, o una anulación o cambio de fecha ya
 * cerrados.
 *
 * Unión discriminada por `clase`, y no un `estado: EstadoSolicitud |
 * EstadoModificacion` suelto: los dos enums comparten los literales
 * `'pendiente'`, `'aprobada'` y `'rechazada'`, así que sin el discriminante
 * TypeScript no puede afinar cuál de los dos describe la fila, y un `switch`
 * sobre `estado` en el front quedaría incompleto sin que el compilador se
 * quejara.
 */
export type Movimiento =
  | (MovimientoBase & {
      clase: 'solicitud';
      estado: EstadoSolicitud;
      /**
       * Cuándo se anuló la solicitud, o `null` si no se anuló.
       *
       * Va SOLO en esta rama y no en `MovimientoBase`: una unión discriminada
       * sirve justo para esto, y colgar aquí un campo que solo significa algo en
       * la clase `solicitud` ensuciaría la forma común de las tres —una
       * `fechas` o una `anulacion` no tienen un «¿se anuló ESTA fila?» que
       * contestar, son ellas mismas el movimiento de la anulación—.
       *
       * Hace falta porque una solicitud anulada y una rechazada por el jefe
       * comparten `estado: 'rechazada'`, y son cosas distintas: `chipDeSolicitud`
       * (`dominio.ts`) usa este campo para no rotular «Rechazada» una fila que
       * el propio dueño anuló, con el motivo que ESE dueño escribió al pedirlo
       * — leído junto a «Rechazada» ese motivo se entendería como la razón que
       * dio el jefe para negarla.
       */
      anuladaAt: string | null;
      /**
       * Notas al margen del histórico importado de la hoja, o `null` si no
       * hay ninguna.
       *
       * Va SOLO en esta rama, por la misma razón que `anuladaAt`: es un dato
       * DE LA SOLICITUD, no del movimiento en general —una `fechas` o una
       * `anulacion` no tienen observaciones propias, son ellas mismas el
       * cambio que se anota—, y colgarlo en `MovimientoBase` ensuciaría la
       * forma común de las tres ramas con un campo que dos de ellas no usan.
       *
       * Hace falta porque el CSV que sustituye al Excel de nómina lleva esta
       * columna desde siempre —era la octava—, y perderla al pasar de
       * `Solicitud` a `Movimiento` cambia la forma de un fichero del que
       * depende nómina. Mantenerla fuera de `MovimientoBase` es además lo que
       * hace que exportar una `fechas` o una `anulacion` no compile: ninguna
       * de las dos ramas tiene `observaciones` que leer.
       */
      observaciones: string | null;
    })
  | (MovimientoBase & { clase: 'fechas' | 'anulacion'; estado: EstadoModificacion });

/** El registro de movimientos que le toca ver a quien pregunta, ya recortado
 *  por rama en el servidor. */
export const fetchMovimientos = () =>
  get<{ movimientos: Movimiento[] }>('/api/ausencias/movimientos').then((d) => d.movimientos);

/**
 * Una solicitud entera por su id (solo admin). La usa el modal de edición del
 * registro: de un `Movimiento` faltan `empleadoId` y `observaciones`, y el
 * `PATCH` de abajo sobreescribe la fila entera, así que reconstruirla a partir
 * del movimiento borraría las observaciones y podría reasignarla a la persona
 * equivocada. Ver el fetcher de más abajo, `editarSolicitud`.
 */
export const fetchSolicitud = (id: string) => get<Solicitud>(`/api/ausencias/solicitudes/${encodeURIComponent(id)}`);

/** Los campos que un admin puede corregir desde el registro general. */
export interface EdicionSolicitud {
  empleadoId: string;
  tipo: TipoSolicitud;
  fechaInicio: string;
  fechaFin: string;
  dias: number;
  estado: EstadoSolicitud;
  /**
   * El estado que tenía la solicitud al abrir el formulario (DATA-337). hub-api
   * no guarda nada si ya no coincide: alguien la decidió entre medias.
   */
  estadoLeido: EstadoSolicitud;
  comentarios: string | null;
  observaciones: string | null;
}

/**
 * Corrige una solicitud (solo admin). No avisa a la cadena de firmas ni al
 * trabajador; si la corrección desajusta el calendario o la hoja de una que ya
 * estaba en Google, corrige el evento y avisa a administración.
 */
export const editarSolicitud = (id: string, campos: EdicionSolicitud) =>
  patchSolapable<Solicitud>(`/api/ausencias/solicitudes/${encodeURIComponent(id)}`, campos);

/** Borra una solicitud del registro (solo admin). Es irreversible. */
export async function borrarSolicitud(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/ausencias/solicitudes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await mensajeDeError(res));
}

/**
 * Los campos de un MOVIMIENTO —una anulación o un cambio de fechas ya cerrado—
 * que un admin puede corregir desde el registro.
 *
 * Los tres de fechas son opcionales porque en una anulación no existen: un CHECK
 * de la BD los obliga a ir NULL. El servidor lee la clase de la fila y los
 * ignora en ese caso, así que mandarlos no rompe nada — pero omitirlos es lo que
 * dice la verdad sobre lo que se está guardando.
 */
export interface CorreccionModificacion {
  estado: EstadoModificacion;
  motivo: string | null;
  fechaInicioNueva?: string;
  fechaFinNueva?: string;
  diasHabilesNuevos?: number;
}

/**
 * Corrige un movimiento del registro (solo admin).
 *
 * ⚠️ Corrige el ASIENTO, no la solicitud: pasar una anulación de `aprobada` a
 * `rechazada` NO la desanula. La solicitud tiene su propia fila y su propio
 * `editarSolicitud`.
 */
export const corregirModificacion = (id: string, campos: CorreccionModificacion) =>
  patch<Modificacion>(`/api/ausencias/modificaciones/${encodeURIComponent(id)}`, campos);

/**
 * Borra un movimiento del registro (solo admin). Es irreversible.
 *
 * No toca la solicitud ni deshace lo que ese movimiento hizo: borrar la
 * anulación que dejó unas vacaciones anuladas las deja anuladas.
 */
export async function borrarModificacion(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/ausencias/modificaciones/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await mensajeDeError(res));
}
