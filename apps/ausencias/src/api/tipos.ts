// ARQ-612 — los tipos de las respuestas de hub-api, sacados de api.ts tal cual.
// Solo tipos: api.ts los reexporta con `export type *`, y si dejara de hacerlo
// lo diría el typecheck de cada componente que los importa.

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
  /**
   * Abre la pestaña de KPIs: el pasivo de vacaciones de toda la plantilla, los
   * tiempos de aprobación por aprobador y las pendientes por antigüedad. Como
   * las tres de arriba, el rol de administrador ya la concede.
   */
  veKpis: boolean;
  /** Si sus solicitudes necesitan la firma del jefe de su jefe, o basta una. */
  requiereSegundaFirma: boolean;
  userId: string | null;
  activo: boolean;
  /**
   * El ÚLTIMO DÍA que trabaja, no el primero que ya no. Ese día sigue activa:
   * de apagar la ficha se encarga el barrido del servidor cuando la fecha
   * vence, así que una fecha futura aquí solo significa «salida prevista».
   *
   * `null` mientras no haya baja registrada. Obligatorio y no opcional aunque
   * hub-api y el portal se desplieguen por separado: hub-api va PRIMERO, así
   * que cuando este bundle llegue, las tres claves ya vienen en la respuesta.
   */
  fechaRetiro: string | null;
  /** Quién registró la baja. Sale de la sesión del admin, nunca del body. */
  retiradoPor: string | null;
  retiradoAt: string | null;
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
/** `caducada` la cierra el sistema al decidirse la solicitud. Ver `types.ts`. */
export type EstadoModificacion = 'pendiente' | 'aprobada' | 'rechazada' | 'retirada' | 'caducada';

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
  /**
   * La franja del día, solo en un permiso de un solo día. `null` = día completo.
   * Espejo manual de `Solicitud` en hub-api: mismo nombre, obligatorio.
   */
  horaInicio: string | null;
  horaFin: string | null;
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
  /**
   * Abre la pestaña de KPIs: admin, o tener la llave concedida ficha a ficha.
   * Como los tres de arriba, pliega `esAdmin` dentro, así que NO hace falta
   * añadirle un `|| ctx.esAdmin` en el navegador.
   *
   * A diferencia de los otros, esconder la pestaña no es lo único que protege
   * estos datos: `GET /ausencias/kpis` aplica la MISMA regla por su cuenta y
   * contesta 403, porque su respuesta lleva dentro el agregado de la plantilla
   * entera. Este booleano solo evita enseñar una pestaña que daría error.
   *
   * Puede llegar `undefined` en la ventana de despliegue en que el portal va
   * por delante de hub-api. Se lee como `!!ctx.esVisorDeKpis`, que degrada a
   * «no la tiene»: la pestaña tarda un despliegue en aparecer, en vez de
   * aparecer rota.
   */
  esVisorDeKpis: boolean;
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

/** Un mes dentro de la franja anual: dónde empieza y cuánto ocupa. */
export interface MesDelAnio {
  /** `YYYY-MM`, para poder saltar a la vista mensual desde su etiqueta. */
  mes: string;
  /** Ordinal del día 1 de ese mes dentro del año, empezando en 1. */
  desdeDia: number;
  dias: number;
}

/**
 * Una ausencia como barra de la franja anual.
 *
 * Los ordinales vienen calculados del servidor a propósito: aquí solo se
 * dividen entre `diasDelAnio` para sacar el porcentaje. La aritmética de fechas
 * vive donde hay tests, y esta app no tiene ninguno.
 */
export interface FranjaCalendario {
  empleadoId: string;
  tipo: TipoSolicitud;
  estado: EstadoSolicitud;
  /** Ya recortadas al año: una ausencia a caballo entre dos años se parte. */
  fechaInicio: string;
  fechaFin: string;
  /** Ambos inclusive y empezando en 1. */
  desdeDia: number;
  hastaDia: number;
}

export interface CalendarioDelAnio {
  empleados: { id: string; nombreCompleto: string }[];
  anio: string;
  /** 365, o 366 si es bisiesto. Es el denominador de todos los anchos. */
  diasDelAnio: number;
  meses: MesDelAnio[];
  franjas: FranjaCalendario[];
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
  /** Solo en un permiso de un solo día, y las dos o ninguna. `HH:MM`. */
  horaInicio?: string;
  horaFin?: string;
}
