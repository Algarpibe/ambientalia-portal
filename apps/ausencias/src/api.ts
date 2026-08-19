import { authHeaders, esAdmin } from '@suite/auth-client';
import { mensajeDeError } from '@suite/http';
// No cierra ciclo en runtime: lo que `dominio` coge de aquí son solo tipos, con
// `import type`, y con `verbatimModuleSyntax` esa línea se borra al compilar.
import { ETIQUETA_TIPO, rangoFechas } from './dominio';

export { esAdmin };

const API_BASE = import.meta.env.VITE_HUB_API_URL as string;

// Espejo de apps/hub-api/src/ausencias/types.ts. Si cambia allí, cambia aquí.

export type TipoSolicitud = 'vacaciones' | 'permiso' | 'compensatorio' | 'incapacidad';
/** `pendiente_2` = el jefe inmediato ya firmó y falta su superior. */
export type EstadoSolicitud = 'pendiente' | 'pendiente_2' | 'aprobada' | 'rechazada' | 'registrada';

export interface Empleado {
  id: string;
  nombreCompleto: string;
  correo: string;
  cargo: string | null;
  credencial: number | null;
  /** El correo de su jefe inmediato: la única arista del organigrama. */
  aprobadorCorreo: string;
  /** A quién se pone en copia de sus correos. `null` = a nadie. */
  copiaCorreo: string | null;
  /** Puede abrir CUALQUIER adjunto de CUALQUIER persona. Llave maestra. */
  veAdjuntos: boolean;
  /** Si sus solicitudes necesitan la firma del jefe de su jefe, o basta una. */
  requiereSegundaFirma: boolean;
  userId: string | null;
  activo: boolean;
}

/** Un empleado del maestro con su posición en el árbol, derivada por hub-api. */
export interface EmpleadoConJefatura extends Empleado {
  segundoAprobadorCorreo: string | null;
  /** El de segundo nivel cuando NO firma. Excluyente con el de arriba. */
  informadoCorreo: string | null;
  enCiclo: boolean;
}

export interface Adjunto {
  id: string;
  nombreArchivo: string;
  mime: string;
  bytes: number;
}

/** Qué se pide cambiar de una solicitud ya enviada. Ni el tipo ni la persona. */
export type ClaseModificacion = 'fechas' | 'anulacion';

/** `retirada` = la quitó su propio autor antes de que nadie la decidiera. */
export type EstadoModificacion = 'pendiente' | 'aprobada' | 'rechazada' | 'retirada';

/**
 * Una propuesta de cambio sobre una solicitud ya enviada.
 *
 * Los campos `*Previos` son la FOTO del instante en que se pidió, no una copia
 * redundante: son lo que permite escribir el «de estas fechas a estas otras» sin
 * volver a mirar la solicitud, que puede haber cambiado.
 */
export interface Modificacion {
  id: string;
  solicitudId: string;
  clase: ClaseModificacion;
  estadoPrevio: EstadoSolicitud;
  fechaInicioPrevia: string;
  fechaFinPrevia: string;
  diasHabilesPrevios: number;
  /** Los tres van `null` en una anulación; lo garantiza un CHECK en la BD. */
  fechaInicioNueva: string | null;
  fechaFinNueva: string | null;
  diasHabilesNuevos: number | null;
  motivo: string | null;
  estado: EstadoModificacion;
  /** Copiado de la SOLICITUD al pedirla, nunca rederivado del organigrama. */
  aprobadorCorreo: string;
  solicitanteEmail: string;
  decididaAt: string | null;
  motivoRechazo: string | null;
  createdAt: string;
}

export interface Solicitud {
  id: string;
  tipo: TipoSolicitud;
  empleadoId: string;
  empleadoNombre: string;
  empleadoCargo: string | null;
  solicitanteEmail: string;
  fechaInicio: string;
  fechaFin: string;
  /** Decimal: el histórico de la hoja trae medios días (6,5). */
  diasHabiles: number;
  comentarios: string | null;
  /** Notas al margen de la hoja, y el PDF de las incapacidades antiguas. */
  observaciones: string | null;
  /** `hoja` = importada del histórico; `portal` = nacida en la app. */
  origen: 'portal' | 'hoja';
  estado: EstadoSolicitud;
  /** Quien firma primero, congelado en el alta. No rota al avanzar de nivel. */
  aprobadorCorreo: string | null;
  /** Quien firma después, congelado. `null` = una sola firma. */
  segundoAprobadorCorreo: string | null;
  /** El de segundo nivel cuando NO firma: solo recibe el correo del resultado.
   *  Excluyente con `segundoAprobadorCorreo`. Congelado en el alta. */
  informadoCorreo: string | null;
  /** Leído de la ficha al consultar, no congelado en el alta. */
  copiaCorreo: string | null;
  primeraFirmaAt: string | null;
  decididaAt: string | null;
  motivoRechazo: string | null;
  createdAt: string;
  adjunto: Adjunto | null;
  /**
   * La propuesta de cambio viva, si la hay. Viaja con TODA solicitud —el
   * `LEFT JOIN` está en el SELECT común del servidor—, así que ninguna pantalla
   * puede olvidarse de pedirla y enseñar como firmes unas fechas en discusión.
   * Como mucho hay una: lo garantiza un índice único parcial en la BD.
   *
   * En el runtime puede llegar `undefined` pese al tipo, igual que `esMiTurno`:
   * hub-api y el portal se despliegan por separado y hay una ventana en que el
   * portal va por delante. Se lee siempre por veracidad (`s.modificacionPendiente
   * && …`) para que un campo ausente degrade a «no hay propuesta» —los botones
   * se ofrecen igual y, en el peor caso, el servidor contesta 409— y nunca a una
   * pantalla rota.
   */
  modificacionPendiente: Modificacion | null;
  /**
   * Cuándo se anuló. Anular NO estrena estado: la solicitud queda `rechazada`,
   * que ya hereda la semántica correcta en los filtros del servidor, así que
   * esta marca es lo ÚNICO que distingue «anulada» de «rechazada por el jefe».
   * La etiqueta se deriva al pintar (`chipDeSolicitud`), no se almacena.
   *
   * Misma ventana de despliegue que el campo de arriba: ausente se lee
   * «Rechazada», como antes de esta feature. Menos preciso, no roto.
   */
  anuladaAt: string | null;
  /**
   * El evento de Google Calendar del que esta solicitud es dueña, cuando lo
   * creó el portal con un id propio. Está aquí porque viaja en la respuesta y
   * este fichero es un espejo, no porque haga falta: **ninguna pantalla lo
   * lee**, y decide cosas que ocurren enteras en el servidor —si una anulación
   * corrige el calendario sola o si el correo pide hacerlo a mano—.
   *
   * Opcional a propósito: es más nuevo que los dos de arriba, así que la ventana
   * de despliegue en la que no llega es aún más ancha.
   */
  eventoCalendarioId?: string | null;
}

/** Una solicitud de la bandeja de aprobación. */
export interface SolicitudPendiente extends Solicitud {
  /**
   * Si le toca firmarla AHORA a quien mira la bandeja. Lo calcula hub-api, que
   * es donde vive la regla del turno.
   *
   * Solo llega en `false` a un **administrador**: a los demás la consulta ya les
   * entrega únicamente su turno. Es lo que separa en la bandeja lo que uno tiene
   * que firmar de lo que solo puede destrabar.
   *
   * En el runtime puede llegar `undefined` pese al tipo: hub-api y el portal se
   * despliegan por separado, y hay una ventana en que el portal va por delante.
   * Por eso el widget del dashboard (`resumirPendientes.ts`) comprueba
   * `!== false` y no `=== true` — así degrada a «cuéntalas todas» en vez de a
   * «nada pendiente».
   */
  esMiTurno: boolean;
}

export interface Contexto {
  empleado: Empleado | null;
  /** Nombre de quien le aprueba. Null si ese correo no tiene ficha de empleado. */
  aprobadorNombre: string | null;
  /** Puede abrir cualquier adjunto: admin, o estar en la lista de administración. */
  esVisorAdjuntos: boolean;
  /** El correo de la sesión, para poder decir cuál hay que dar de alta. */
  email: string;
  esAdmin: boolean;
  esAprobador: boolean;
  /** Festivos del año en curso y los dos siguientes, para contar días sin ir al servidor. */
  festivos: string[];
  /** Null si el usuario no tiene ficha de empleado, o si el cálculo del saldo falló. */
  saldo: SaldoVacaciones | null;
}

/** El saldo de vacaciones de una persona, ya calculado por hub-api. */
export interface SaldoVacaciones {
  /** False si nadie ha configurado todavía su punto de corte. */
  configurado: boolean;
  saldoCorte: number;
  fechaCorte: string;
  devengadas: number;
  disfrutadas: number;
  /** Pendientes de aprobar. No bajan el saldo firme, pero sí el que se puede pedir. */
  enTramite: number;
  disponible: number;
}

export interface SaldoDeEmpleado {
  empleadoId: string;
  nombreCompleto: string;
  correo: string;
  saldo: SaldoVacaciones;
}

/** Un día del mes, con lo que hace falta para sombrearlo. */
export interface DiaCalendario {
  fecha: string;
  laborable: boolean;
}

/** Una celda pintada del calendario. */
export interface MarcaCalendario {
  empleadoId: string;
  fecha: string;
  tipo: TipoSolicitud;
  estado: EstadoSolicitud;
}

export interface CalendarioDelMes {
  empleados: { id: string; nombreCompleto: string }[];
  dias: DiaCalendario[];
  marcas: MarcaCalendario[];
}

export interface NuevaSolicitud {
  tipo: TipoSolicitud;
  fechaInicio: string;
  fechaFin: string;
  comentarios?: string;
  adjunto?: { nombreArchivo: string; mime: string; contenidoBase64: string };
}

// ── El 409 del solapamiento ────────────────────────────────────────────────

/** El conflicto que devuelve un `rango_solapado`. Espejo de `detalleDelSolape`. */
export interface SolapeDetalle {
  tipo: TipoSolicitud;
  estado: EstadoSolicitud;
  fechaInicio: string;
  fechaFin: string;
}

/**
 * Cómo se nombra el estado del choque, y qué se deduce de él.
 *
 * El estado va en el texto porque cambia lo que queda por hacer: una aprobada ya
 * concedió esos días y solo los suelta si se anula, mientras que una sin decidir
 * puede acabar rechazada y soltarlos sola.
 *
 * Falta `rechazada` porque el `WHERE` de `solapeDe` (`repo.ts`) solo devuelve
 * ausencias vivas y una rechazada no lo es, así que hoy el servidor no la manda
 * nunca en el `detalle`; si algún día llegara, o llegara un estado que este
 * bundle todavía no conozca, sale por la rama sin estado de `mensajeDeSolape`.
 *
 * Cada `salida` describe la CONDICIÓN —cuándo se sueltan esos días— y no receta
 * un botón, y eso no es estilo: es lo único que puede ser cierto a la vez para
 * los tres lectores posibles de estos cuatro 409. El dueño puede cambiar las
 * fechas o pedir la anulación; el admin que corrige el registro puede editar esa
 * otra solicitud —fechas o estado— o borrarla; y el jefe que firma una propuesta
 * no puede tocar la ausencia que choca, solo rechazar la propuesta que se la
 * pisa. «Anula esa solicitud primero» nombraba un botón que solo el dueño tiene.
 * Dicho como condición, cada uno lo mapea a lo que sí pueda hacer.
 *
 * Ojo al sujeto de los tres verbos de las `salida`: son cosas que le pasan a ESA
 * solicitud, la que choca. Rechazar la propuesta que se la pisa no es ninguna de
 * las tres —quita la demanda de esos días, no su ocupación—, y por eso no se
 * nombra.
 *
 * Por lo mismo no hay «ya tienes»: para el jefe y para el admin la ausencia que
 * choca no es suya. Es la trampa que `MENSAJE_DECISION` resuelve en la bandeja
 * con una segunda redacción; aquí se esquiva no hablándole a nadie en concreto.
 */
const SOLAPE_POR_ESTADO: Partial<Record<EstadoSolicitud, { estado: string; salida: string }>> = {
  pendiente: {
    estado: 'pendiente de aprobar',
    salida: 'Mientras siga en pie ocupa esos días: no se liberan hasta que se rechace, se cambie o se anule.',
  },
  pendiente_2: {
    estado: 'pendiente de la segunda firma',
    salida: 'Mientras siga en pie ocupa esos días: no se liberan hasta que se rechace, se cambie o se anule.',
  },
  aprobada: {
    estado: 'aprobada',
    salida: 'Esos días ya están concedidos: no se liberan hasta que esa solicitud se cambie o se anule.',
  },
  registrada: {
    estado: 'registrada',
    salida: 'Esos días ya están ocupados: no se liberan hasta que esa solicitud se cambie o se anule.',
  },
};

/**
 * El choque, dicho entero: contra qué se choca y qué hacer con ello.
 *
 * Decir el tipo y las fechas es toda su razón de ser: sin eso el aviso es «no
 * puedes» a secas, y quien lo lee no tiene por qué acordarse de qué días tenía
 * ya cogidos.
 *
 * Las fechas van por `rangoFechas`, que las pasa por el `formatFecha` con el que
 * las tablas pintan sus columnas: así el rango del aviso y la fila que se ve en
 * pantalla se escriben igual. De regalo, colapsa el rango de un solo día en una
 * fecha sola en vez de repetirla.
 *
 * El estado va PEGADO al tipo entre paréntesis y no como tercer elemento de la
 * lista. Con el `es-CO` de hoy `formatFecha` escribe «10 de jul de 2026», así que
 * un «…, 10 de jul de 2026 – 14 de jul de 2026, aprobada.» se lee un instante
 * como si «aprobada» calificara a la fecha de fin.
 */
function mensajeDeSolape(d: SolapeDetalle): string {
  const cuando = rangoFechas(d.fechaInicio, d.fechaFin);
  // Un tipo que este bundle no conozca cae en su propio código —feo, pero dice
  // algo— en vez de en un «undefined» a mitad de frase. Misma ventana de
  // despliegue que cubre la rama sin estado de aquí abajo.
  const tipo = ETIQUETA_TIPO[d.tipo] ?? d.tipo;
  const como = SOLAPE_POR_ESTADO[d.estado];
  if (!como) {
    return `Esas fechas chocan con otra ausencia: ${tipo}, ${cuando}. Esos días no se liberan hasta que esa solicitud se cambie o se anule.`;
  }
  return `Esas fechas chocan con otra ausencia: ${tipo} (${como.estado}), ${cuando}. ${como.salida}`;
}

/** El error de un endpoint corriente: el texto de `mensajeDeError` y nada más. */
async function errorGenerico(res: Response): Promise<Error> {
  return new Error(await mensajeDeError(res));
}

/**
 * Igual, pero conservando el `detalle` de un `rango_solapado`.
 *
 * Hace falta porque `mensajeDeError` (@suite/http) devuelve para un 409 solo el
 * campo `error` y tira el resto del cuerpo — y el resto del cuerpo es justo
 * contra qué se choca. No se arregla allí: ese helper lo comparten las doce apps
 * del portal. El cuerpo se lee sobre un `clone()` porque el de una `Response` se
 * puede leer una sola vez, y el helper lo vuelve a leer para todo lo demás.
 *
 * Cualquier otro fallo —otro 409, un 400, un 500, un cuerpo que no sea JSON, o
 * un `rango_solapado` al que le faltara el `detalle`— sale por `mensajeDeError`
 * exactamente como antes de esto.
 */
async function errorDeAusencia(res: Response): Promise<Error> {
  const cuerpo = (await res
    .clone()
    .json()
    .catch(() => null)) as { error?: string; detalle?: SolapeDetalle } | null;
  if (cuerpo?.error === 'rango_solapado' && cuerpo.detalle) return new Error(mensajeDeSolape(cuerpo.detalle));
  return errorGenerico(res);
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return (await res.json()) as T;
}

async function conCuerpo<T>(
  metodo: 'POST' | 'PATCH' | 'PUT',
  path: string,
  body: unknown,
  leerError: (res: Response) => Promise<Error> = errorGenerico,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await leerError(res);
  return (await res.json()) as T;
}

const post = <T,>(path: string, body: unknown) => conCuerpo<T>('POST', path, body);
const put = <T,>(path: string, body: unknown) => conCuerpo<T>('PUT', path, body);

/**
 * Los verbos de las CUATRO puertas del solapamiento —el alta, pedir un cambio de
 * fechas, firmarlo y el `PATCH` del registro—, que son las cuatro que pueden
 * contestar `rango_solapado`. El resto de endpoints sigue con `post`/`put`.
 *
 * `patch` a secas ya no existe: el `PATCH` del registro era su único usuario.
 */
const postSolapable = <T,>(path: string, body: unknown) => conCuerpo<T>('POST', path, body, errorDeAusencia);
const patchSolapable = <T,>(path: string, body: unknown) => conCuerpo<T>('PATCH', path, body, errorDeAusencia);

export const fetchContexto = () => get<Contexto>('/api/ausencias/contexto');

/**
 * Solo el saldo de quien pregunta. Lo usa el widget del dashboard, que no
 * necesita el resto del contexto —festivos de tres años incluidos— y lo cargaría
 * en cada visita a la home del portal.
 */
export const fetchMiSaldo = () =>
  get<{ saldo: SaldoVacaciones | null }>('/api/ausencias/mi-saldo').then((d) => d.saldo);

export const fetchMisSolicitudes = () =>
  get<{ solicitudes: Solicitud[] }>('/api/ausencias/mis-solicitudes').then((d) => d.solicitudes);

export const fetchPendientes = () =>
  get<{ solicitudes: SolicitudPendiente[] }>('/api/ausencias/pendientes').then((d) => d.solicitudes);

export const crearSolicitud = (s: NuevaSolicitud) => postSolapable<Solicitud>('/api/ausencias/solicitudes', s);

export const decidirSolicitud = (id: string, aprueba: boolean, motivo?: string) =>
  post<Solicitud>(`/api/ausencias/solicitudes/${encodeURIComponent(id)}/decision`, { aprueba, motivo });

/**
 * Lo que el trabajador manda al pedir un cambio sobre una solicitud suya.
 *
 * Ni `empleadoId` ni los días hábiles: el primero sale de la sesión y los
 * segundos los cuenta el servidor, igual que en `NuevaSolicitud`.
 *
 * Las fechas son OPCIONALES y en una anulación se OMITEN: mandarlas con valor
 * es un 400 (`anulacion_con_fechas`) a propósito, para que un cliente con un bug
 * no crea haber pedido un cambio de fechas habiendo pedido una anulación.
 */
export interface NuevaModificacion {
  clase: ClaseModificacion;
  fechaInicio?: string;
  fechaFin?: string;
  motivo?: string;
}

/** El dueño pide cambiar las fechas de una solicitud suya, o anularla. */
export const pedirModificacion = (solicitudId: string, m: NuevaModificacion) =>
  postSolapable<Modificacion>(`/api/ausencias/solicitudes/${encodeURIComponent(solicitudId)}/modificaciones`, m);

/**
 * El autor se echa atrás. Sin correo a nadie: retirar deja la solicitud tal como
 * estaba. La propuesta no se borra, pasa a `retirada`; por eso es un POST y no
 * un DELETE.
 */
export const retirarModificacion = (id: string) =>
  post<Modificacion>(`/api/ausencias/modificaciones/${encodeURIComponent(id)}/retirar`, {});

/**
 * Una solicitud con la propuesta de cambio que espera decisión. Espejo de
 * `SolicitudConPropuesta` en `apps/hub-api/src/ausencias/service.ts`.
 *
 * Es una SOLICITUD y no una propuesta suelta a propósito: la propuesta por sí
 * sola no dice de quién es ni de qué tipo, y la bandeja del jefe necesita las
 * dos cosas para pintar la fila con la misma tabla que el resto.
 */
export interface SolicitudConPropuesta extends Solicitud {
  /** No nula: esta respuesta solo trae solicitudes que tienen una viva. */
  modificacionPendiente: Modificacion;
  /**
   * El `esMiTurno` de esta bandeja: si a quien pregunta le toca decidir ESTA
   * propuesta. Lo calcula hub-api con el MISMO guard que el endpoint de
   * decisión, y por eso el navegador no lo recalcula: la parte que un espejo
   * manual se deja es justo la que más importa —la raíz del organigrama es su
   * propio jefe, así que sobre sus propias solicitudes el decisor congelado es
   * ella misma y no puede autoaprobarse—. Un admin también recibe las de todo
   * el mundo, y sobre esas sí puede.
   *
   * En el runtime puede llegar `undefined` pese al tipo, igual que `esMiTurno`:
   * se lee `!== false` para que un campo ausente degrade a «ofrécele los
   * botones» —en el peor caso el servidor contesta 403 y se enseña el porqué— y
   * nunca a una bandeja de filas muertas que nadie puede tocar.
   */
  puedoDecidirla: boolean;
}

/** Las propuestas de cambio que esperan la decisión de quien pregunta. */
export const fetchModificacionesPendientes = () =>
  get<{ solicitudes: SolicitudConPropuesta[] }>('/api/ausencias/modificaciones/pendientes').then(
    (d) => d.solicitudes,
  );

/**
 * Lo que devuelve decidir una propuesta: las DOS filas que toca la decisión.
 *
 * `solicitud` viene releída después de aplicarla, así que ya trae las fechas
 * nuevas (o la anulación) y `modificacionPendiente` en `null` —la propuesta
 * dejó de estar viva—, que es justo lo que la interfaz necesita para repintar
 * la fila sin una segunda llamada.
 */
export interface DecisionModificacion {
  modificacion: Modificacion;
  solicitud: Solicitud;
}

/**
 * El jefe aprueba o rechaza el cambio. Mismo cuerpo que `decidirSolicitud`
 * (`{ aprueba, motivo? }`) a propósito, para reutilizar el patrón de la bandeja.
 */
export const decidirModificacion = (id: string, aprueba: boolean, motivo?: string) =>
  postSolapable<DecisionModificacion>(`/api/ausencias/modificaciones/${encodeURIComponent(id)}/decision`, {
    aprueba,
    motivo,
  });

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

/** Todas las solicitudes de la compañía (solo admin). */
export const fetchHistorico = () =>
  get<{ solicitudes: Solicitud[] }>('/api/ausencias/historico').then((d) => d.solicitudes);

/** Los campos que un admin puede corregir desde el registro general. */
export interface EdicionSolicitud {
  empleadoId: string;
  tipo: TipoSolicitud;
  fechaInicio: string;
  fechaFin: string;
  dias: number;
  estado: EstadoSolicitud;
  comentarios: string | null;
  observaciones: string | null;
}

/** Corrige una solicitud (solo admin). No manda correos a nadie. */
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

/** Fija a quién se pone en copia. `null` = sin copia. */
export const fijarCopia = (id: string, copiaCorreo: string | null) =>
  put<EmpleadoConJefatura>(`/api/ausencias/empleados/${encodeURIComponent(id)}/copia`, { copiaCorreo });

/** Da o quita la llave maestra de los adjuntos. Queda registrado en el servidor. */
export const fijarVisor = (id: string, veAdjuntos: boolean) =>
  put<EmpleadoConJefatura>(`/api/ausencias/empleados/${encodeURIComponent(id)}/visor`, { veAdjuntos });

/** Enciende o apaga la segunda firma de alguien. No mueve lo que ya está en vuelo. */
export const fijarSegundaFirma = (id: string, requiereSegundaFirma: boolean) =>
  put<EmpleadoConJefatura>(`/api/ausencias/empleados/${encodeURIComponent(id)}/segunda-firma`, {
    requiereSegundaFirma,
  });

/**
 * Descarga el PDF de una solicitud. Va por fetch y no por `<a href>` porque el
 * endpoint exige la cabecera Authorization, que un enlace no puede mandar.
 */
export async function descargarAdjunto(adjunto: Adjunto): Promise<void> {
  const res = await fetch(`${API_BASE}/api/ausencias/adjuntos/${encodeURIComponent(adjunto.id)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = adjunto.nombreArchivo;
  a.click();
  URL.revokeObjectURL(url);
}

/** Lee un File como base64 sin la cabecera `data:...;base64,`. */
export function leerComoBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    lector.onload = () => {
      const r = String(lector.result);
      const coma = r.indexOf(',');
      resolve(coma >= 0 ? r.slice(coma + 1) : r);
    };
    lector.readAsDataURL(file);
  });
}

/** Las solicitudes con PDF. Solo para admin y la lista de administración. */
export const fetchConAdjunto = () =>
  get<{ solicitudes: Solicitud[] }>('/api/ausencias/adjuntos').then((d) => d.solicitudes);

/** Lo que a quien pregunta le tocaba firmar y ya está cerrado. */
export const fetchDecididas = () =>
  get<{ solicitudes: Solicitud[] }>('/api/ausencias/decididas').then((d) => d.solicitudes);

/** Los saldos que puede ver quien pregunta: todos si es admin, si no los suyos. */
export const fetchSaldos = () =>
  get<{ saldos: SaldoDeEmpleado[] }>('/api/ausencias/saldos').then((d) => d.saldos);

/**
 * Fija el punto de corte de un empleado (solo admin). Las dos a null lo vacía.
 *
 * `saldoCorte` admite `string` a propósito, además de `number`: si el panel
 * convirtiera con `Number()` antes de mandarlo, un `'abc'` tecleado por error
 * se volvería `NaN`, y `JSON.stringify(NaN)` produce `null` — con lo que el
 * backend recibiría «vaciar la configuración» en vez de «esto no es un
 * número», y respondería un 400 confuso o, peor, borraría un saldo ya puesto.
 * Mandando la cadena tal cual, la validación de forma vive en un solo sitio
 * (el backend, con su regex) y el mensaje de error que llega es el correcto.
 */
export const fijarSaldo = (empleadoId: string, saldoCorte: number | string | null, fechaCorte: string | null) =>
  put<SaldoDeEmpleado>(`/api/ausencias/empleados/${encodeURIComponent(empleadoId)}/saldo`, {
    saldoCorte,
    fechaCorte,
  });

/** El calendario de un mes `YYYY-MM`. Lo ve cualquiera que tenga la app. */
export const fetchCalendario = (mes: string) =>
  get<CalendarioDelMes>(`/api/ausencias/calendario?mes=${encodeURIComponent(mes)}`);
