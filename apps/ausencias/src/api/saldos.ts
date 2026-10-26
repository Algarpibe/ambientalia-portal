import { get, put } from './http';
import type { SaldoCompensatorios, SaldoDeEmpleado, SaldoVacaciones } from './tipos';

// ARQ-612 — los endpoints de los saldos, sacados de api.ts tal cual en dos
// bloques: los de quien pregunta, y los de todos con el saldo de corte que fija
// un admin. api.ts lo reexporta (lo vigila barril.test.ts).

/** Las dos bolsas de quien pregunta, tal como vienen: claves hermanas. */
export interface MisSaldos {
  saldo: SaldoVacaciones | null;
  compensatorios?: SaldoCompensatorios | null;
}

/**
 * Solo los saldos de quien pregunta. Lo usa el widget del dashboard, que no
 * necesita el resto del contexto —festivos de tres años incluidos— y lo cargaría
 * en cada visita a la home del portal.
 *
 * Se llama `fetchMisSaldos` y no `fetchMiSaldo` a propósito: cambia la forma de
 * lo que devuelve, y el rename obliga a `tsc` a señalar a sus dos llamantes en
 * vez de dejar que alguien siga creyendo que sale el saldo pelado.
 */
export const fetchMisSaldos = () => get<MisSaldos>('/api/ausencias/mi-saldo');

/** Los saldos que puede ver quien pregunta: todos si es admin, si no los suyos. */
export const fetchSaldos = () =>
  get<{ saldos: SaldoDeEmpleado[] }>('/api/ausencias/saldos').then((d) => d.saldos);

/** Un punto de corte a mandar. Los dos a null vacían esa bolsa. */
export interface CorteAFijar {
  saldoCorte: number | string | null;
  fechaCorte: string | null;
}

/**
 * Fija los puntos de corte de un empleado (solo admin).
 *
 * `saldoCorte` admite `string` a propósito, además de `number`: si el panel
 * convirtiera con `Number()` antes de mandarlo, un `'abc'` tecleado por error
 * se volvería `NaN`, y `JSON.stringify(NaN)` produce `null` — con lo que el
 * backend recibiría «vaciar la configuración» en vez de «esto no es un
 * número», y respondería un 400 confuso o, peor, borraría un saldo ya puesto.
 * Mandando la cadena tal cual, la validación de forma vive en un solo sitio
 * (el backend, con su regex) y el mensaje de error que llega es el correcto.
 *
 * Las CUATRO claves van siempre, incluso si el admin no tocó los compensatorios.
 * El backend lee «clave ausente» como «no toques esa bolsa», y esa lectura está
 * ahí para el bundle viejo, no para éste: mandarlas siempre deja esa rama como
 * lo que es, una red para la ventana de despliegue, y no como algo que dependa
 * de qué campos rellenó el admin.
 */
export const fijarSaldo = (empleadoId: string, vacaciones: CorteAFijar, compensatorios: CorteAFijar) =>
  put<SaldoDeEmpleado>(`/api/ausencias/empleados/${encodeURIComponent(empleadoId)}/saldo`, {
    saldoCorte: vacaciones.saldoCorte,
    fechaCorte: vacaciones.fechaCorte,
    compensatoriosSaldoCorte: compensatorios.saldoCorte,
    compensatoriosFechaCorte: compensatorios.fechaCorte,
  });
