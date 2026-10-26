import { authHeaders, esAdmin } from '@suite/auth-client';
import { mensajeDeError } from '@suite/http';
// No cierra ciclo en runtime: lo que `dominio` coge de aquí son solo tipos, con
// `import type`, y con `verbatimModuleSyntax` esa línea se borra al compilar.
import { CHIP_ESTADO, ETIQUETA_TIPO, rangoFechas } from './dominio';
// ARQ-612 — cómo se habla con hub-api (la URL base, los verbos y la lectura de
// los errores) vive en api/http.ts, que es INTERNO: de ahí solo se reexportan
// los tipos de los detalles de error. Los endpoints de abajo importan los verbos.
import { API_BASE, conCuerpo, errorGenerico, get } from './api/http';
import type { Empleado, EstadoSolicitud, SaldoCompensatorios, SaldoVacaciones, TipoSolicitud } from './api/tipos';

// ARQ-612 — este fichero se parte en trozos dentro de api/, con el mismo patrón
// que repo.ts y service.ts en hub-api: sigue siendo la ÚNICA puerta, y los
// componentes y sus tests (cuatro de ellos lo sustituyen por un doble con
// vi.mock) lo siguen importando como './api'. Lo vigila api/barril.test.ts.

export { esAdmin };

// Los tipos de las respuestas, en api/tipos.ts. Se reexportan todos.
export type * from './api/tipos';
export type { CompensatoriosDetalle, RetiroDetalle, SolapeDetalle } from './api/http';

// Los endpoints, por tema. Se reexporta todo de cada trozo.
export * from './api/solicitudes';
export * from './api/modificaciones';
export * from './api/saldos';
export * from './api/calendario';
export * from './api/adjuntos';
export * from './api/historico';
export * from './api/registro';
export * from './api/organigrama';

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

/** El tiempo que tarda un aprobador en firmar, ya agregado por hub-api. */
export interface TiempoDeAprobador {
  aprobadorCorreo: string;
  /** Cuántas decisiones sostienen la cifra: un p90 de una muestra no vale lo
   *  mismo que uno de cincuenta, y la pantalla tiene que poder decirlo. */
  n: number;
  medianaHoras: number;
  p90Horas: number;
}

/** Una ficha con demasiadas vacaciones sin disfrutar. */
export interface FichaAcumulada {
  empleadoId: string;
  nombreCompleto: string;
  /** Días de vacaciones disponibles. */
  dias: number;
  /**
   * Días de calendario desde que terminaron sus últimas vacaciones. `null` si
   * no ha disfrutado ninguna, que NO es cero: cero diría «acaba de volver».
   */
  diasSinVacaciones: number | null;
  /**
   * Días de vacaciones que ya tiene pedidos hacia adelante (incluidas las que
   * esperan firma). Separa a quien acumula porque no planifica de quien
   * acumula pero ya tiene el viaje reservado.
   */
  diasProgramados: number;
}

/**
 * Quién concentra el pasivo, en dos grupos EXCLUYENTES: nadie aparece en los
 * dos. Los umbrales los manda el servidor para que la pantalla no los
 * reinvente — si el 15 y el 30 vivieran aquí, cambiarlos allí dejaría el
 * rótulo mintiendo.
 */
export interface AcumulacionExcesiva {
  aviso: FichaAcumulada[];
  alarma: FichaAcumulada[];
  umbralAviso: number;
  umbralAlarma: number;
}

/** Un mes de la serie de absentismo. */
export interface MesDeAbsentismo {
  /** `YYYY-MM`. */
  mes: string;
  /** Días de TRABAJO perdidos, no de calendario. */
  diasHabiles: number;
  episodios: number;
  /** Personas distintas. Dos incapacidades de la misma persona son dos
   *  episodios y una persona. */
  personas: number;
  /** Quiénes, en orden alfabético. ⚠️ Son datos de salud: se enseñan en el
   *  tooltip a propósito, pero no se propaguen a un CSV sin pensarlo. */
  nombres: string[];
}

export interface Absentismo {
  /** Un elemento por mes, incluidos los que están a cero: si faltaran, la
   *  gráfica uniría dos meses separados y pintaría una tendencia inventada. */
  meses: MesDeAbsentismo[];
  totalDiasHabiles: number;
  /** Una incapacidad partida entre dos meses cuenta UNA vez aquí. */
  totalEpisodios: number;
}

/** Un mes de la serie de estacionalidad, con su desglose por tipo. */
export interface MesDeEstacionalidad {
  /** `YYYY-MM`. */
  mes: string;
  vacaciones: number;
  permiso: number;
  compensatorio: number;
  incapacidad: number;
  /** La suma de los cuatro, calculada en el servidor para que la barra y su
   *  etiqueta no puedan discrepar por sumar en dos sitios. */
  total: number;
  /** Quiénes, por tipo y en orden alfabético. La misma persona puede salir en
   *  dos tipos, pero nunca dos veces dentro del mismo. */
  nombres: { vacaciones: string[]; permiso: string[]; compensatorio: string[]; incapacidad: string[] };
}

export interface Estacionalidad {
  meses: MesDeEstacionalidad[];
  totalPorTipo: { vacaciones: number; permiso: number; compensatorio: number; incapacidad: number };
  total: number;
  /** El mes con más días de ausencia, o `null` si no hubo ninguna. */
  mesPico: string | null;
}

/**
 * Cuánto roce genera el proceso.
 *
 * ⚠️ `rechazadas` y `anuladas` NO son lo mismo aunque en la base compartan el
 * estado `rechazada`: un rechazo es «el jefe dijo que no» y una anulación es
 * «el solicitante cambió de idea». Piden acciones distintas y por eso viajan
 * separadas; no sumarlas en la pantalla.
 */
export interface Friccion {
  /** El denominador: solicitudes ya resueltas. Las pendientes no entran. */
  decididas: number;
  rechazadas: number;
  anuladas: number;
  cambiosDeFecha: number;
  /** `null` cuando no hay decididas. Un 0% se leería como «no se rechaza
   *  nada», y sin datos eso no se sabe: hay que pintar «—», no «0%». */
  pctRechazo: number | null;
  pctAnulacion: number | null;
  pctCambioDeFecha: number | null;
}

/** Los KPIs del panel. */
export interface Kpis {
  pasivo: {
    /** Días de vacaciones acumulados por la plantilla activa. Deuda real. */
    diasVacaciones: number;
    diasCompensatorios: number;
    /** El denominador: sobre cuántas fichas activas se ha sumado. */
    empleados: number;
  };
  /**
   * Quién concentra ese pasivo. El total de arriba dice cuánto se debe; esto
   * dice a quién, que es lo único con lo que se puede hacer algo.
   */
  acumulacion: AcumulacionExcesiva;
  /** Días perdidos por incapacidad, mes a mes. La tendencia se lee de la serie:
   *  el servidor no calcula ninguna pendiente ni media móvil. */
  absentismo: Absentismo;
  /**
   * Días de ausencia por mes y tipo. ⚠️ Su ventana es MÁS LARGA que la del
   * resto del panel (24 meses frente a 12), así que su serie NO se puede
   * comparar mes a mes con la de `absentismo`.
   */
  estacionalidad: Estacionalidad;
  /** Rechazos, anulaciones y cambios de fecha. Comparte ventana con `tiempos`:
   *  los dos miden el proceso de aprobación. */
  friccion: Friccion;
  /** De más lento a más rápido: el atasco va arriba. */
  tiempos: TiempoDeAprobador[];
  pendientes: {
    total: number;
    hasta2Dias: number;
    de2a5Dias: number;
    masDe5Dias: number;
  };
  /** Inicio de la ventana de `tiempos`, en ISO. La pantalla lo dice en voz alta. */
  desde: string;
  /** El año seleccionado, o `null` si es la ventana móvil. Lo manda el servidor
   *  para que el rótulo y los datos no puedan discrepar. */
  anio: number | null;
  /** Los años que el selector puede ofrecer, del más reciente al más antiguo. */
  aniosDisponibles: number[];
}

/**
 * El panel de KPIs. Contesta 403 a quien no tenga la llave `ve_kpis`, y ese
 * 403 es el candado de verdad: la respuesta lleva dentro el agregado de la
 * plantilla entera, así que esconder la pestaña no bastaría.
 */
export const kpis = (anio: number | null = null) =>
  get<Kpis>(anio === null ? '/api/ausencias/kpis' : `/api/ausencias/kpis?year=${anio}`);
