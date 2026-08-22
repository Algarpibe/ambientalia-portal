import { authHeaders, esAdmin } from '@suite/auth-client';
import { mensajeDeError } from '@suite/http';
// No cierra ciclo en runtime: lo que `dominio` coge de aquí son solo tipos, con
// `import type`, y con `verbatimModuleSyntax` esa línea se borra al compilar.
import { ETIQUETA_TIPO, rangoFechas } from './dominio';

export { esAdmin };

const API_BASE = import.meta.env.VITE_HUB_API_URL as string;

// Espejo de apps/hub-api/src/ausencias/types.ts. Si cambia allí, cambia aquí.

/**
 * ⚠️ `otorgamiento` NO es una ausencia: es la petición de que te CONCEDAN días de
 * compensatorio por un trabajo extra. Sus columnas se leen distinto —`diasHabiles`
 * son días concedidos y `fechaInicio` es el día que se trabajó— y por eso hay un
 * predicado, `esOtorgamiento` en `dominio.ts`, en vez de comparaciones sueltas.
 */
export type TipoSolicitud = 'vacaciones' | 'permiso' | 'compensatorio' | 'incapacidad' | 'otorgamiento';
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
  /** Puede exportar a CSV el registro de movimientos de TODA la plantilla. */
  exportaRegistro: boolean;
  /**
   * Ve el calendario y el registro de TODA la compañía sin ser administrador.
   * No abre nada más: editar, borrar e importar siguen siendo solo de admin.
   */
  veTodaLaEmpresa: boolean;
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
  /**
   * Tiene rol de administrador en el portal, así que las tres llaves de permisos
   * ya las tiene todas por el rol. El panel usa esto para no pintarle unas
   * casillas que no deciden nada en su fila.
   *
   * Se deriva en el servidor a partir de `portal.users`; no se guarda en la
   * ficha. Puede llegar `undefined` en la ventana de despliegue en que el portal
   * va por delante de hub-api, y se lee con `!!` — degrada a «no es admin», que
   * enseña las casillas de siempre en vez de esconder una fila entera.
   */
  esAdminDelPortal: boolean;
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
  /**
   * Puede exportar el registro de movimientos: admin, o tener el permiso
   * concedido. Solo sirve para PINTAR el botón — quien de verdad decide qué se
   * puede sacar es el recorte por rama que hace el servidor en
   * `GET /ausencias/movimientos`, que no consulta esta bandera.
   */
  esExportadorRegistro: boolean;
  /**
   * Ve el calendario y el registro de toda la compañía: admin, o tener el
   * permiso concedido ficha a ficha.
   *
   * Aquí sí abre pantalla —es lo que le da la pestaña «Registro general» a quien
   * no aprueba a nadie—, pero no decide QUÉ datos salen: eso lo recorta el
   * servidor en el SQL de `GET /ausencias/movimientos` y `GET
   * /ausencias/calendario`, que vuelven a preguntarlo por su cuenta. Un `true`
   * inventado aquí abriría una pestaña vacía, no una fuga.
   *
   * Puede llegar `undefined` en runtime pese al tipo, por la ventana de
   * despliegue en la que el portal va por delante de hub-api. Se lee siempre
   * como `!!ctx.esVisorDeTodaLaEmpresa`, que degrada a «no lo tiene» — el lado
   * seguro: la pestaña tarda un despliegue en aparecer, en vez de aparecer
   * rota.
   */
  esVisorDeTodaLaEmpresa: boolean;
  /** El correo de la sesión, para poder decir cuál hay que dar de alta. */
  email: string;
  esAdmin: boolean;
  esAprobador: boolean;
  /** Festivos del año en curso y los dos siguientes, para contar días sin ir al servidor. */
  festivos: string[];
  /** Null si el usuario no tiene ficha de empleado, o si el cálculo del saldo falló. */
  saldo: SaldoVacaciones | null;
  /** La bolsa de compensatorios. Ver por qué es opcional en `SaldoCompensatorios`. */
  compensatorios?: SaldoCompensatorios | null;
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

/**
 * La bolsa de compensatorios, ya calculada por hub-api.
 *
 * NO tiene `devengadas`, y no es un olvido: un compensatorio se gana por horas o
 * días extra y hay que otorgarlo, no crece con el tiempo. Además es lo único que
 * impide en compilación pasarle esta bolsa a algo escrito para la de vacaciones
 * —TypeScript compara por forma, así que dos tipos idénticos serían
 * intercambiables—.
 *
 * Los campos que se declaren aquí tienen que existir en
 * `apps/hub-api/src/ausencias/saldo.ts`.
 */
export interface SaldoCompensatorios {
  configurado: boolean;
  saldoCorte: number;
  fechaCorte: string;
  disfrutadas: number;
  enTramite: number;
  disponible: number;
}

export interface SaldoDeEmpleado {
  empleadoId: string;
  nombreCompleto: string;
  correo: string;
  saldo: SaldoVacaciones;
  /**
   * Opcional a propósito, y no `| null`. Hub-api y el portal son dos servicios
   * que se despliegan por separado, así que hay una ventana en la que este
   * bundle habla con un hub-api que todavía no manda la clave. Declararlo
   * obligatorio haría que `tsc` diera por buenos accesos que revientan en
   * ejecución; opcional obliga a poner el guard en cada punto de lectura. Mismo
   * criterio que el `esMiTurno` de `SolicitudPendiente`.
   */
  compensatorios?: SaldoCompensatorios | null;
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
  /**
   * Días a conceder. SOLO en un otorgamiento, y ahí obligatorio.
   *
   * En los demás tipos los cuenta el servidor, y mandarlo es un 400: aceptarlo e
   * ignorarlo dejaría creer que se puede fijar desde aquí el recuento de unas
   * vacaciones. Aquí no se puede calcular — un compensatorio se gana por
   * trabajar un sábado, y un sábado da cero días hábiles.
   */
  dias?: number;
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
    // `detalle` es la MISMA clave para todos los errores que la llevan; lo que
    // cambia de forma según el `error` es su contenido, así que se estrecha con
    // el código antes de usarlo y no al revés.
    .catch(() => null)) as { error?: string; detalle?: SolapeDetalle | CompensatoriosDetalle } | null;
  if (cuerpo?.error === 'rango_solapado' && cuerpo.detalle) {
    return new Error(mensajeDeSolape(cuerpo.detalle as SolapeDetalle));
  }
  // Sin estas dos ramas el usuario leería literalmente `compensatorios_insuficientes`
  // en la caja roja: `mensajeDeError` devuelve el código crudo en los 400 y 409.
  // Los códigos del otorgamiento. Sin estas ramas el usuario leería
  // `trabajo_demasiado_antiguo` tal cual en la caja roja: `mensajeDeError`
  // devuelve el código crudo en los 400 y 409.
  const DEL_OTORGAMIENTO: Record<string, string> = {
    otorgamiento_un_solo_dia:
      'Un compensatorio se pide por UN día trabajado, no por un rango. Si trabajaste varios días, manda una petición por cada uno.',
    trabajo_demasiado_antiguo:
      'Ese trabajo es de hace más de tres meses. Los compensatorios hay que pedirlos dentro de ese plazo; si se te pasó, habla con administración.',
    trabajo_en_el_futuro: 'Un compensatorio se pide por un día ya trabajado, no por uno que todavía no ha llegado.',
    motivo_requerido: 'Cuéntale a quien aprueba por qué pides esos días: sin motivo no se puede valorar.',
    dias_invalidos: 'Los días a conceder tienen que ser un número mayor que cero, con una décima como mucho (por ejemplo 0,5 o 1).',
    dias_demasiados: 'Como máximo se pueden pedir 30 días en una sola petición.',
    otorgamiento_solo_anulable: 'Un compensatorio concedido no tiene fechas que cambiar: solo se puede anular.',
    // Nombra el día porque el error llega sin detalle: quien lo lee acaba de
    // teclear esa fecha y no siempre recuerda haberla pedido ya —justo lo que
    // hacía que se reclamara dos veces—.
    otorgamiento_duplicado:
      'Ya pediste un compensatorio por ese mismo día trabajado. Si el anterior sigue pendiente o te lo concedieron, ' +
      'esos días ya están contados; si te lo rechazaron, puedes volver a pedirlo.',
  };
  if (cuerpo?.error && DEL_OTORGAMIENTO[cuerpo.error]) return new Error(DEL_OTORGAMIENTO[cuerpo.error]);

  // Los de la incapacidad. Mapa aparte del de arriba y no una entrada más: son
  // de otro tipo de solicitud, y juntarlos haría que un vistazo al nombre del
  // mapa dijera algo falso sobre la mitad de sus claves.
  const DE_LA_INCAPACIDAD: Record<string, string> = {
    incapacidad_en_el_futuro:
      'Una incapacidad se informa por días que ya empezaron, no por unos que todavía no han llegado. ' +
      'Si el médico te firmó una baja que arranca más adelante, infórmala el primer día.',
    // No promete que administración pueda crearla: NO hay vía para que un admin
    // dé de alta una incapacidad en nombre de otro —solo puede corregir una fila
    // que ya exista, o importarla del histórico—. Decir «que te la registren»
    // mandaría a la gente a pedir algo que hoy no se puede hacer de un clic.
    incapacidad_demasiado_antigua:
      'Esa baja empieza hace más de dos días, que es todo lo que se puede informar por aquí. ' +
      'Habla con administración para que la registren ellos.',
  };
  if (cuerpo?.error && DE_LA_INCAPACIDAD[cuerpo.error]) return new Error(DE_LA_INCAPACIDAD[cuerpo.error]);
  if (cuerpo?.error === 'compensatorios_sin_saldo') {
    return new Error(
      'Todavía no tienes bolsa de compensatorios configurada, así que no se puede descontar de ella. ' +
        'Habla con administración para que fije tu punto de partida.',
    );
  }
  if (cuerpo?.error === 'compensatorios_insuficientes' && cuerpo.detalle) {
    return new Error(mensajeDeCompensatorios(cuerpo.detalle as CompensatoriosDetalle));
  }
  return errorGenerico(res);
}

/** Lo que manda el servidor con un `compensatorios_insuficientes`. */
export interface CompensatoriosDetalle {
  pedidos: number;
  pedible: number;
  disponible: number;
  enTramite: number;
}

/**
 * El mensaje del bloqueo por bolsa insuficiente.
 *
 * Dice el déficit SIN `Math.max(0, …)`, por lo mismo que las tarjetas: redondear
 * el rojo a cero borra el dato por el que existe el aviso. Y explica de dónde
 * sale el número cuando hay días esperando firma, porque si no la cifra de aquí
 * y la de la tarjeta de arriba parecen contradecirse.
 */
function mensajeDeCompensatorios(d: CompensatoriosDetalle): string {
  const dias = (n: number) => `${n.toLocaleString('es-CO', { maximumFractionDigits: 1 })}`;
  const base =
    `Pides ${dias(d.pedidos)} días de compensatorio y solo puedes pedir ${dias(d.pedible)}: ` +
    `te faltan ${dias(d.pedidos - d.pedible)}.`;
  const tramite =
    d.enTramite > 0
      ? ` En la cuenta entran los ${dias(d.enTramite)} días que ya tienes pendientes de aprobar.`
      : '';
  return (
    `${base}${tramite} Los compensatorios no se devengan con el tiempo: se ganan por horas o días ` +
    'extra y hay que otorgarlos, así que esperar no los aumenta. Si crees que te faltan días por ' +
    'reconocer, habla con administración.'
  );
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

/** El calendario de un mes `YYYY-MM`. Lo ve cualquiera que tenga la app. */
export const fetchCalendario = (mes: string) =>
  get<CalendarioDelMes>(`/api/ausencias/calendario?mes=${encodeURIComponent(mes)}`);
