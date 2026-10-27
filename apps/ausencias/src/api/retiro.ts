import { authHeaders } from '@suite/auth-client';
import { mensajeDeError } from '@suite/http';
// Sin ciclo en runtime: lo que `dominio` coge de api.ts son solo tipos, con
// `import type`, y con `verbatimModuleSyntax` esa línea se borra al compilar.
import { CHIP_ESTADO, ETIQUETA_TIPO, rangoFechas } from '../dominio';
import { API_BASE, conCuerpo, errorGenerico, get } from './http';
import type { Empleado, EstadoSolicitud, SaldoCompensatorios, SaldoVacaciones, TipoSolicitud } from './tipos';

// ARQ-612 — la baja de quien se va de la compañía, sacada de api.ts tal cual:
// registrarla —con lo que se le cuenta a quien la intenta y no puede— y
// deshacerla, y la lista de retirados con su saldo congelado. `errorDeRetiro`
// se queda privado aquí: solo lo usa `fijarRetiro`. api.ts lo reexporta (lo
// vigila barril.test.ts).

// ── La baja de quien se va de la compañía ──────────────────────────────────

/**
 * Lo que manda el servidor con un `retiro_bloqueado`.
 *
 * Las DOS listas llegan siempre, y la que no aplica llega vacía. Es un error
 * único con las dos mitades y no dos códigos: quien se topa con los dos es el
 * jefe que se va —tiene equipo por definición y suele tener vacaciones
 * pendientes—, y los dos remedios se ejecutan en pantallas distintas, así que
 * descubrirlos de uno en uno puede costar días.
 */
export interface RetiroBloqueadoDetalle {
  solicitudes: { tipo: TipoSolicitud; fechaInicio: string; fechaFin: string; estado: EstadoSolicitud }[];
  personas: { nombre: string; correo: string }[];
}

/** Cuántos elementos de cada lista se nombran antes de resumir el resto. */
const A_NOMBRAR = 3;

/** «a, b y 2 más» — para no volcar una lista de veinte en una caja roja. */
function conResto(items: string[]): string {
  if (items.length <= A_NOMBRAR) return items.join('; ');
  return `${items.slice(0, A_NOMBRAR).join('; ')} y ${items.length - A_NOMBRAR} más`;
}

/**
 * El mensaje del bloqueo, con las dos mitades y qué hacer con cada una.
 *
 * Dice el remedio y no solo el problema: el servidor bloquea a propósito en vez
 * de arreglar por su cuenta —no cierra solicitudes ajenas ni reasigna equipos—,
 * así que la única salida es que el admin lo resuelva a mano y vuelva. Sin decir
 * dónde, ese diseño se lee como un muro.
 */
export function mensajeDeRetiroBloqueado(d: RetiroBloqueadoDetalle): string {
  const partes: string[] = ['No se puede registrar la baja con esa fecha:'];
  if (d.solicitudes.length > 0) {
    const cuales = d.solicitudes.map(
      (s) =>
        `${ETIQUETA_TIPO[s.tipo] ?? s.tipo} ${rangoFechas(s.fechaInicio, s.fechaFin)} ` +
        `(${CHIP_ESTADO[s.estado]?.label ?? s.estado})`,
    );
    partes.push(
      `• Tiene ${d.solicitudes.length === 1 ? 'una solicitud que termina' : `${d.solicitudes.length} solicitudes que terminan`} ` +
        `después de ese día: ${conResto(cuales)}. Recházalas o pídele que las retire, y vuelve a intentarlo.`,
    );
  }
  if (d.personas.length > 0) {
    const quienes = d.personas.map((p) => `${p.nombre} (${p.correo})`);
    partes.push(
      `• ${d.personas.length === 1 ? 'Una persona lo tiene' : `${d.personas.length} personas lo tienen`} ` +
        `como jefe o en copia: ${conResto(quienes)}. Reasígnalas en Organigrama antes de darlo de baja.`,
    );
  }
  return partes.join('\n');
}

/** Igual que `errorGenerico`, pero conservando el detalle de un `retiro_bloqueado`. */
async function errorDeRetiro(res: Response): Promise<Error> {
  const cuerpo = (await res
    .clone()
    .json()
    .catch(() => null)) as { error?: string; detalle?: RetiroBloqueadoDetalle } | null;
  if (cuerpo?.error === 'retiro_bloqueado' && cuerpo.detalle) {
    return new Error(mensajeDeRetiroBloqueado(cuerpo.detalle));
  }
  if (cuerpo?.error === 'fecha_retiro_invalida') {
    return new Error('Esa fecha no vale. Elige el último día que la persona trabaja.');
  }
  return errorGenerico(res);
}

/**
 * Registra la baja. La fecha es el ÚLTIMO DÍA que la persona trabaja.
 *
 * No usa el helper `put` porque ese decodifica con `errorGenerico`, y un
 * `retiro_bloqueado` saldría en la caja roja como el código crudo — justo el
 * error que trae en el cuerpo todo lo que hay que arreglar para desbloquearlo.
 */
export const fijarRetiro = (id: string, fechaRetiro: string) =>
  conCuerpo<Empleado>('PUT', `/api/ausencias/empleados/${encodeURIComponent(id)}/retiro`, { fechaRetiro }, errorDeRetiro);

/**
 * Deshace una baja y devuelve la ficha a Activos.
 *
 * A mano y no con un helper: en este fichero no hay ninguno para `DELETE`
 * —solo `post` y `put` sobre `conCuerpo`—, y a diferencia de `borrarSolicitud`
 * este sí lee la respuesta, que es la ficha ya reactivada.
 */
export async function reactivarEmpleado(id: string): Promise<Empleado> {
  const res = await fetch(`${API_BASE}/api/ausencias/empleados/${encodeURIComponent(id)}/retiro`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return (await res.json()) as Empleado;
}

/**
 * Una ficha retirada con su saldo ya congelado. Espejo manual de `Retirado`.
 *
 * `compensatorios` va obligatorio, al revés que en `SaldoDeEmpleado`: aquella
 * interfaz lo dejó opcional por la ventana de despliegue en que el portal iba
 * por delante de hub-api, y esta pantalla nace DESPUÉS de que hub-api mande la
 * clave, así que aquí no hay ventana que cubrir.
 */
export interface Retirado {
  empleadoId: string;
  nombreCompleto: string;
  correo: string;
  saldo: SaldoVacaciones;
  compensatorios: SaldoCompensatorios;
  /** `null` en las fichas que se apagaron a mano antes de que esto existiera. */
  fechaRetiro: string | null;
  retiradoPor: string | null;
  /** Mientras sea > 0, el saldo de al lado todavía puede moverse. */
  solicitudesVivas: number;
  /** La fecha de retiro es anterior al corte del saldo. Se avisa, no se bloquea. */
  retiroAntesDelCorte: boolean;
}

export const fetchRetirados = () =>
  get<{ retirados: Retirado[] }>('/api/ausencias/empleados/retirados').then((d) => d.retirados);
