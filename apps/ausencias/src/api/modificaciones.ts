import { get, post, postSolapable } from './http';
import type { ClaseModificacion, Modificacion, Solicitud } from './tipos';

// ARQ-612 — los endpoints de las propuestas de cambio sobre una solicitud ya
// enviada, sacados de api.ts tal cual en dos bloques: pedirla y retirarla, y la
// bandeja de propuestas con su decisión. api.ts lo reexporta (lo vigila
// barril.test.ts).

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
