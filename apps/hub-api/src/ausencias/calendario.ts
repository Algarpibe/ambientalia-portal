import { esFechaValida } from './dias-habiles.js';
import { festivosColombia } from './festivos.js';
import type { EstadoSolicitud, TipoSolicitud } from './types.js';

// El calendario de ausencias. Puro a propósito: sin Pool y sin leer la hora del
// sistema, para que todas las reglas se puedan probar sin BD.
//
// La pieza que importa es que la expansión de un rango a días concretos vive
// AQUÍ y no en el navegador. Es el cálculo que más errores de un día produce, y
// esta app ya lleva dos: el `+1` del fin exclusivo de Google Calendar y el
// UTC−5 del saldo. Aquí hay tests; en el frontend del portal no.

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Un día del mes, con lo que el frontend necesita para sombrearlo. */
export interface DiaCalendario {
  fecha: string;
  laborable: boolean;
}

/** Una celda pintada: esta persona, este día. */
export interface MarcaCalendario {
  empleadoId: string;
  fecha: string;
  /** Null = incapacidad ajena: se dice que está ausente, no por qué. */
  tipo: TipoSolicitud | null;
  estado: EstadoSolicitud;
}

/** Una ausencia sin expandir, tal como sale del repo. */
export interface AusenciaRango {
  empleadoId: string;
  empleadoCorreo: string;
  /** El aprobador del EMPLEADO, no el de la solicitud. Ver `puedeVerElTipo`. */
  aprobadorCorreo: string;
  tipo: TipoSolicitud;
  estado: EstadoSolicitud;
  fechaInicio: string;
  fechaFin: string;
}

/** Quién está mirando, que es lo que decide si se revela una incapacidad. */
export interface QuienMira {
  email: string;
  esAdmin: boolean;
}

export function esMesValido(v: string): boolean {
  return MES.test(v);
}

/** Primer y último día de un mes `YYYY-MM`. */
export function rangoDelMes(mes: string): { desde: string; hasta: string } {
  if (!esMesValido(mes)) throw new Error(`mes inválido: ${JSON.stringify(mes)}`);
  const anio = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  // Día 0 del mes SIGUIENTE es el último del actual, y `Date.UTC` cuenta los
  // meses desde 0: por eso `m` sin restarle uno ya apunta al siguiente. Resuelve
  // solo los meses de 30, febrero bisiesto y el salto de diciembre a enero.
  const ultimo = new Date(Date.UTC(anio, m, 0)).toISOString().slice(0, 10);
  return { desde: `${mes}-01`, hasta: ultimo };
}

/** Los días del mes, marcando cuáles son laborables en Colombia. */
export function diasDelMes(mes: string): DiaCalendario[] {
  const { desde, hasta } = rangoDelMes(mes);
  const festivos = festivosColombia(Number(mes.slice(0, 4)));
  const dias: DiaCalendario[] = [];
  const fin = Date.parse(`${hasta}T00:00:00Z`);
  for (let ms = Date.parse(`${desde}T00:00:00Z`); ms <= fin; ms += 86_400_000) {
    const d = new Date(ms);
    const fecha = d.toISOString().slice(0, 10);
    const diaSemana = d.getUTCDay();
    dias.push({ fecha, laborable: diaSemana !== 0 && diaSemana !== 6 && !festivos.has(fecha) });
  }
  return dias;
}

/**
 * Si a quien mira se le puede decir que la ausencia es una incapacidad.
 *
 * `aprobadorCorreo` tiene que venir de `portal.empleados`, NO de la solicitud:
 * el de la solicitud está a null en todas las incapacidades a propósito —una
 * incapacidad se informa, no se aprueba, y dejar ahí un aprobador la metería en
 * su bandeja de pendientes—. Leerlo de ahí dejaría a todos los aprobadores
 * fuera y reduciría la regla, en silencio, a «solo el interesado y el admin».
 */
function puedeVerElTipo(a: AusenciaRango, quien: QuienMira): boolean {
  if (a.tipo !== 'incapacidad') return true;
  if (quien.esAdmin) return true;
  const yo = quien.email.toLowerCase();
  return a.empleadoCorreo.toLowerCase() === yo || a.aprobadorCorreo.toLowerCase() === yo;
}

/**
 * Expande las ausencias a una marca por día, acotadas al mes pedido.
 *
 * El acotado es lo que permite que una ausencia a caballo entre dos meses se
 * pinte entera en los dos, cada uno con su trozo.
 */
export function marcasDelMes(
  mes: string,
  ausencias: AusenciaRango[],
  quien: QuienMira,
): MarcaCalendario[] {
  const { desde, hasta } = rangoDelMes(mes);
  const marcas: MarcaCalendario[] = [];

  for (const a of ausencias) {
    // Una rechazada no es una ausencia: nunca llegó a ocurrir.
    if (a.estado === 'rechazada') continue;
    if (!esFechaValida(a.fechaInicio)) throw new Error(`fechaInicio inválida: ${JSON.stringify(a.fechaInicio)}`);
    if (!esFechaValida(a.fechaFin)) throw new Error(`fechaFin inválida: ${JSON.stringify(a.fechaFin)}`);

    // Comparación de cadenas: con YYYY-MM-DD el orden lexicográfico ES el
    // cronológico, y no hay zona horaria que pueda desplazar nada.
    const ini = a.fechaInicio > desde ? a.fechaInicio : desde;
    const fin = a.fechaFin < hasta ? a.fechaFin : hasta;
    if (ini > fin) continue;

    const tipo = puedeVerElTipo(a, quien) ? a.tipo : null;
    const ultimo = Date.parse(`${fin}T00:00:00Z`);
    for (let ms = Date.parse(`${ini}T00:00:00Z`); ms <= ultimo; ms += 86_400_000) {
      marcas.push({
        empleadoId: a.empleadoId,
        fecha: new Date(ms).toISOString().slice(0, 10),
        tipo,
        estado: a.estado,
      });
    }
  }

  return marcas;
}
