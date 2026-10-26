import { authHeaders, esAdmin } from '@suite/auth-client';
import { mensajeDeError } from '@suite/http';
// No cierra ciclo en runtime: lo que `dominio` coge de aquí son solo tipos, con
// `import type`, y con `verbatimModuleSyntax` esa línea se borra al compilar.
import { CHIP_ESTADO, ETIQUETA_TIPO, rangoFechas } from './dominio';
// ARQ-612 — cómo se habla con hub-api (la URL base, los verbos y la lectura de
// los errores) vive en api/http.ts, que es INTERNO: de ahí solo se reexportan
// los tipos de los detalles de error. Los endpoints de abajo importan los verbos.
import { API_BASE, conCuerpo, errorGenerico, get, patch, patchSolapable, post, put } from './api/http';
import type {
  Empleado,
  EmpleadoConJefatura,
  EstadoModificacion,
  EstadoSolicitud,
  Modificacion,
  SaldoCompensatorios,
  SaldoVacaciones,
  Solicitud,
  TipoSolicitud,
} from './api/tipos';

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

/** Da de alta a todos los usuarios del portal que ya tienen la app asignada. */
export const sincronizarEmpleados = () =>
  post<{ creados: number; vinculados: number }>('/api/ausencias/empleados/sincronizar', {});

/** Una fila del Excel histórico, tal como la lee el navegador. */
export interface FilaHistorico {
  nombre: string;
  tipo: string;
  fechaInicio: string;
  fechaFin: string;
  dias: number | string;
  comentarios?: string | null;
  adjunto?: string | null;
  observaciones?: string | null;
}

export interface ResumenImportacion {
  total: number;
  resueltas: number;
  importadas: number;
  yaExistian: number;
  sinResolver: string[];
  ambiguos: { nombre: string; candidatos: string[] }[];
}

/** Con `dryRun` no escribe nada: solo devuelve el recuento para previsualizar. */
export const importarHistorico = (solicitudes: FilaHistorico[], dryRun: boolean) =>
  post<ResumenImportacion>('/api/ausencias/historico/import', { solicitudes, dryRun });

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

export const fetchEmpleados = () =>
  get<{ empleados: EmpleadoConJefatura[] }>('/api/ausencias/empleados').then((d) => d.empleados);

/**
 * Cambia el jefe inmediato de alguien (solo admin). No manda ningún correo.
 *
 * Autoasignarse declara la raíz del organigrama. Un ciclo se rechaza con 409.
 * Las solicitudes ya en vuelo no se mueven: llevan sus firmantes congelados.
 */
export const fijarJefe = (empleadoId: string, aprobadorCorreo: string) =>
  put<EmpleadoConJefatura>(`/api/ausencias/empleados/${encodeURIComponent(empleadoId)}/jefe`, { aprobadorCorreo });

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

/** Fija a quién se pone en copia. `null` = sin copia. */
export const fijarCopia = (id: string, copiaCorreo: string | null) =>
  put<EmpleadoConJefatura>(`/api/ausencias/empleados/${encodeURIComponent(id)}/copia`, { copiaCorreo });

/** Da o quita la llave maestra de los adjuntos. Queda registrado en el servidor. */
export const fijarVisor = (id: string, veAdjuntos: boolean) =>
  put<EmpleadoConJefatura>(`/api/ausencias/empleados/${encodeURIComponent(id)}/visor`, { veAdjuntos });

/**
 * Da o quita el permiso de exportar el registro. Solo admin. Queda registrado
 * en el servidor, igual que `fijarVisor`.
 *
 * Devuelve `{ ok: boolean }` y no la ficha: el permiso no se pinta en la fila
 * del maestro, así que quien lo cambia solo necesita saber que cuajó.
 */
export const fijarExportador = (id: string, concedido: boolean) =>
  put<{ ok: boolean }>(`/api/ausencias/empleados/${encodeURIComponent(id)}/exportador`, { concedido });

/**
 * Da o quita la vista del calendario y el registro de toda la empresa. Solo
 * admin, y queda registrado en el servidor igual que las otras dos llaves.
 *
 * Devuelve `{ ok: boolean }` y no la ficha, por lo mismo que `fijarExportador`:
 * quien lo cambia solo necesita saber que cuajó, y la fila la resincroniza la
 * recarga del maestro.
 */
export const fijarVisorDeEmpresa = (id: string, concedido: boolean) =>
  put<{ ok: boolean }>(`/api/ausencias/empleados/${encodeURIComponent(id)}/visor-empresa`, { concedido });

/**
 * Da o quita la llave del panel de KPIs. Solo admin, y queda registrado en el
 * servidor igual que las otras tres.
 *
 * Sirve para dárselo a quien NO es administrador: a los que lo son se lo da ya
 * el rol, y por eso su casilla tampoco se pinta en esas filas.
 */
export const fijarVisorDeKpis = (id: string, concedido: boolean) =>
  put<{ ok: boolean }>(`/api/ausencias/empleados/${encodeURIComponent(id)}/visor-kpis`, { concedido });

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

/** Enciende o apaga la segunda firma de alguien. No mueve lo que ya está en vuelo. */
export const fijarSegundaFirma = (id: string, requiereSegundaFirma: boolean) =>
  put<EmpleadoConJefatura>(`/api/ausencias/empleados/${encodeURIComponent(id)}/segunda-firma`, {
    requiereSegundaFirma,
  });
