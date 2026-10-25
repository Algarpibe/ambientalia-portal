import type { Pool } from '@algarpibe/zoho-sync';
import { avisarN8n } from './avisar.js';
import { contarDiasHabiles } from './dias-habiles.js';
import { AusenciaError } from './errores.js';
import { construirPayloadModificacion } from './notificaciones.js';
import * as repo from './repo.js';
import { hoyEnColombia } from './saldo.js';
import { empleadoDeSesion, firmanteDeSesion, type Sesion } from './service/sesion.js';
import { errorDeSolape, exigirSinSolape } from './service/solapes.js';
import { MAX_MOTIVO, validarNuevaModificacion } from './service/validacion.js';
import {
  decisorDeModificacion,
  esOtorgamiento,
  type EstadoModificacion,
  type EstadoSolicitud,
  type Modificacion,
  type Solicitud,
} from './types.js';

// ARQ-612 — la clase vive en errores.ts; se reexporta para que quien la
// importaba de aquí (router.ts, los tests) no cambie.
export { AusenciaError };

// ARQ-612 — este fichero se parte en trozos dentro de service/, con el mismo
// patrón que repo.ts: sigue siendo la ÚNICA puerta y reexporta todo lo de los
// trozos, así que router.ts y los tests lo siguen llamando igual. Lo vigila
// service/barril.test.ts, que comprueba además que los trozos sigan dentro
// del umbral de cobertura.
//
// Quién es la sesión vive en service/sesion.ts: lo usan casi todos los casos
// de uso que siguen aquí, y por eso se importa arriba.
export * from './service/sesion.js';

// El contenido de los correos y los destinos de Google viven en
// notificaciones.ts y config.ts. Aquí solo se decide QUÉ eventos se encolan.

// ── Validación ─────────────────────────────────────────────────────────────

// ARQ-612 — en service/validacion.ts, pura: los topes, la validación de una
// solicitud y de una modificación, y el nombre del PDF. Los casos de uso de
// abajo importan lo que usan. Se reexporta todo.
export * from './service/validacion.js';

// ── Casos de uso ───────────────────────────────────────────────────────────

// ARQ-612 — el solapamiento visto desde el servicio, en service/solapes.ts: lo
// que se le cuenta al cliente del choque y la puerta que comparten el alta y
// proponer un cambio de fechas. Se reexporta todo.
export * from './service/solapes.js';

// ARQ-612 — la vida de una solicitud (el alta, las listas de quien pide y de
// quien firma, la decisión de la bandeja y la retirada por su propio dueño), en
// service/solicitudes.ts. Se reexporta todo.
export * from './service/solicitudes.js';

// ARQ-612 — quién ve qué en el registro (los movimientos, la pestaña de
// adjuntos y la puerta de un PDF), en service/registro.ts. Se reexporta todo.
export * from './service/registro.js';

// ── Modificación de una solicitud ya enviada ───────────────────────────────

/**
 * Los estados que admiten una enmienda.
 *
 * `rechazada` queda fuera porque los días nunca se concedieron: lo que su dueño
 * quiere es volver a pedirlos, y para eso está `POST /solicitudes`. `registrada`
 * queda fuera porque una incapacidad se informa, no se concede: no hay a quién
 * mandarle la petición (y `decisorDeModificacion` devuelve `null`, que es la
 * comprobación que de verdad lo cierra).
 */
const ESTADOS_MODIFICABLES: readonly EstadoSolicitud[] = ['pendiente', 'pendiente_2', 'aprobada'];

/** Lo mínimo de una solicitud para saber si admite un cambio. */
type SolicitudEnmendable = Pick<
  Solicitud,
  'tipo' | 'estado' | 'fechaInicio' | 'fechaFin' | 'aprobadorCorreo' | 'segundoAprobadorCorreo'
>;

function estadoAdmiteModificacion(s: SolicitudEnmendable): boolean {
  return ESTADOS_MODIFICABLES.includes(s.estado) && decisorDeModificacion(s) !== null;
}

/**
 * Se mira `fechaFin` y NO `fechaInicio`, a propósito. Una ausencia en curso es
 * justo el caso donde «córtala, tengo que volver» es legítimo; una ya terminada
 * es corrección de nómina, no una aprobación que nadie pueda ya conceder.
 */
function sigueVigente(s: Pick<Solicitud, 'tipo' | 'fechaFin'>, hoy: string): boolean {
  // Un otorgamiento no caduca: su fecha es el día que se TRABAJÓ y está en el
  // pasado siempre, así que con la regla de las ausencias no se podría enmendar
  // ninguno — ni anularlo, que es lo que se decidió que tenía que poderse.
  //
  // Lo que le da o le quita vigencia es su ESTADO, y de eso ya se encarga
  // `estadoAdmiteModificacion`: los días concedidos siguen ahí mientras la
  // solicitud esté viva, se pidieran cuando se pidieran.
  if (esOtorgamiento(s.tipo)) return true;
  return s.fechaFin >= hoy;
}

/**
 * Anular exige que la ausencia **no haya empezado**, y por eso mira
 * `fechaInicio` donde `sigueVigente` mira `fechaFin`.
 *
 * No es simetría de más: anular deja la solicitud en `rechazada`, y `rechazada`
 * devuelve TODOS sus días —`disfrutadas` suma solo `['aprobada']`
 * (`saldo.ts`)— y la borra entera del calendario
 * (`calendario.ts`: «una rechazada no es una ausencia»). Sobre unas vacaciones
 * del 6 al 10 anuladas el día 8, eso regala los tres días que sí se
 * disfrutaron, sin que nada falle ni nadie se entere. Para ese caso la
 * herramienta es cambiar las fechas a 6–10 → 6–8, que recalcula `diasHabiles` y
 * deja el saldo correcto; por eso el error lo dice.
 *
 * ⚠️ `>=` y no `>`: una ausencia que EMPIEZA HOY sí se puede anular. Un día solo
 * queda consumido al terminar, y cancelar la mañana del primer día es un caso
 * real y frecuente. El riesgo residual —quien anule a las cinco de la tarde
 * habiendo disfrutado el día— es de UN día, exige mala fe, y deja rastro en el
 * outbox de quién lo pidió y cuándo. Con `>` se bloquearía el caso legítimo y
 * además esa persona se quedaría sin salida: una ausencia que empieza hoy no se
 * puede «acortar» a menos de un día. No cambiar a `>` sin releer esto.
 */
function noHaEmpezado(s: Pick<Solicitud, 'tipo' | 'fechaInicio'>, hoy: string): boolean {
  // Un otorgamiento no «empieza»: no hay días fuera que se estén consumiendo.
  // Toda la razón de esta regla —que anular devuelve TODOS los días, incluidos
  // los ya disfrutados— no le aplica: anularlo quita los días concedidos, y si la
  // persona ya se los gastó la bolsa queda en negativo, que es lo decidido y lo
  // que la app ya hace con el saldo de vacaciones.
  if (esOtorgamiento(s.tipo)) return true;
  return s.fechaInicio >= hoy;
}

/**
 * Si esta solicitud admite que su dueño pida cambiarle las FECHAS.
 *
 * Es el AND de las reglas que `pedirModificacion` comprueba por separado —él las
 * separa para poder dar el 409 exacto—, y vive aquí en una sola función porque
 * es lo que la interfaz necesita para decidir si enseña el botón. Duplicar la
 * regla en el navegador es cómo se llega a ofrecer un botón que responde 409 al
 * pulsarlo.
 */
export function puedePedirModificacion(s: SolicitudEnmendable, hoy: string): boolean {
  return estadoAdmiteModificacion(s) && sigueVigente(s, hoy);
}

/**
 * Si además admite que se pida ANULARLA. Estrictamente más exigente que
 * `puedePedirModificacion`: toda anulable es modificable, pero no al revés —una
 * ausencia ya empezada solo se puede acortar. Ver `noHaEmpezado`.
 */
export function puedePedirAnulacion(s: SolicitudEnmendable, hoy: string): boolean {
  return puedePedirModificacion(s, hoy) && noHaEmpezado(s, hoy);
}

/**
 * El dueño de una solicitud pide cambiarle las fechas o anularla.
 *
 * Tres cosas que NO pasan aquí, y cada una es un fallo de seguridad si se cae:
 *
 *  - `empleadoId` no se lee del cuerpo: sale de la sesión, igual que en
 *    `crearSolicitud`. Solo el DUEÑO puede pedirlo, ni siquiera un admin en
 *    nombre de otro — para corregir una fila a mano ya está el `PATCH`, que
 *    además no manda correos.
 *  - Los firmantes NO se rederivan. `aprobadorCorreo` sale de
 *    `decisorDeModificacion(solicitud)`, que lee la propia solicitud. Llamar
 *    aquí a `aprobadoresDe` mandaría «anula mis vacaciones aprobadas» a un jefe
 *    nuevo que no sabe que se aprobaron.
 *  - Los días hábiles los cuenta el servidor, nunca el cliente.
 */
export async function pedirModificacion(
  db: Pool,
  sesion: Sesion,
  solicitudId: string,
  body: unknown,
): Promise<Modificacion> {
  const empleado = await empleadoDeSesion(db, sesion);
  const solicitud = await repo.solicitudPorId(db, solicitudId);
  if (!solicitud) throw new AusenciaError('no_encontrada', 404);
  if (solicitud.empleadoId !== empleado.id) throw new AusenciaError('no_es_su_solicitud', 403);

  // Un solo `hoy` para las dos reglas de fecha: leerlo dos veces del reloj
  // dejaría abierta la rendija de que una caiga a un lado de la medianoche de
  // Bogotá y la otra al otro.
  const hoy = hoyEnColombia();
  if (!estadoAdmiteModificacion(solicitud)) throw new AusenciaError('estado_no_admite_modificacion', 409);
  if (!sigueVigente(solicitud, hoy)) throw new AusenciaError('solicitud_ya_pasada', 409);

  const datos = validarNuevaModificacion(body, solicitud, hoy);
  // La vigencia depende de la CLASE, y esta comprobación va después de validar
  // porque hasta aquí no se sabe cuál es. Anular una ausencia ya empezada
  // devolvería también los días ya disfrutados: ver `noHaEmpezado`.
  if (datos.clase === 'anulacion' && !noHaEmpezado(solicitud, hoy)) {
    throw new AusenciaError('anulacion_ya_empezada', 409);
  }

  // Solo un cambio de fechas puede crear un solapamiento: anular quita una
  // ausencia, y quitar nunca choca con nada. Se le pasa `solicitud.id` como
  // `excluirSolicitudId` porque si no, moverle las fechas a una solicitud viva
  // —acortarla, alargarla o desplazarla— la haría chocar contra ella misma; y
  // acortar es la única salida que le queda a una ausencia ya empezada, que no
  // se puede anular (ver `noHaEmpezado`).
  //
  // Las dos mitades de la condición no comprueban lo mismo por partida doble:
  //  - `datos.fechaInicio && datos.fechaFin` la pide EL COMPILADOR:
  //    `NuevaModificacion` (types.ts) es una interface plana, no una unión
  //    discriminada, así que `clase === 'fechas'` no estrecha `string | null` a
  //    `string` y sin ese trozo `exigirSinSolape` no compila.
  //  - `datos.clase === 'fechas'` hoy no cambia nada: en toda anulación
  //    `validarNuevaModificacion` devuelve las dos fechas en `null`, así que el
  //    trozo del compilador ya excluye la anulación por su cuenta —quitarla no
  //    pone rojo ni un test—. Se deja porque nombra a qué clase se le aplica la
  //    regla. Lo que NO hace: obligar a nadie a volver aquí. Si mañana
  //    `CLASES_MODIFICACION` gana una tercera clase con fechas, quedará fuera
  //    del candado en silencio mientras nadie toque esta línea.
  //
  // DATA-336 — la comprobación NO corre aquí sino dentro de la transacción de
  // `repo.crearModificacion`, bajo el candado del empleado y con su `tx`: por el
  // pool miraba el destino mientras un alta de la misma persona ya lo había
  // comprobado y estaba a punto de confirmar, y la propuesta nacía apuntando a
  // un día ocupado. Se prepara aquí porque la REGLA sigue siendo del servicio.
  const fechaInicioNueva = datos.fechaInicio;
  const fechaFinNueva = datos.fechaFin;
  const comprobarSolape =
    datos.clase === 'fechas' && fechaInicioNueva && fechaFinNueva
      ? (tx: repo.PoolClient) =>
          exigirSinSolape(
            tx,
            empleado.id,
            solicitud.tipo,
            solicitud.estado,
            fechaInicioNueva,
            fechaFinNueva,
            solicitud.id,
          )
      : undefined;

  const decisor = decisorDeModificacion(solicitud);
  // `estadoAdmiteModificacion` ya lo ha exigido, pero eso vive treinta líneas
  // más arriba y en otra función: se comprueba aquí para que el tipo salga sin
  // aserción y para que reordenar los guards no abra un `null` silencioso.
  if (!decisor) throw new AusenciaError('estado_no_admite_modificacion', 409);

  const resultado = await repo.crearModificacion(
    db,
    {
      solicitudId,
      clase: datos.clase,
      // El estado que se acaba de LEER, como testigo de concurrencia hasta el
      // WHERE del INSERT. Ver `repo.crearModificacion`.
      estadoEsperado: solicitud.estado,
      fechaInicioNueva: datos.fechaInicio,
      fechaFinNueva: datos.fechaFin,
      diasHabilesNuevos:
        datos.fechaInicio && datos.fechaFin ? contarDiasHabiles(datos.fechaInicio, datos.fechaFin) : null,
      motivo: datos.motivo,
      aprobadorCorreo: decisor,
    },
    construirPayloadModificacion,
    comprobarSolape,
  );

  if (!resultado.ok) {
    throw resultado.razon === 'estado'
      ? new AusenciaError('solicitud_cambio_de_estado', 409)
      : new AusenciaError('ya_hay_modificacion_pendiente', 409);
  }

  void avisarN8n();
  return resultado.modificacion;
}

/**
 * Por qué una propuesta ya no se puede retirar. Son dos cosas distintas y el
 * cliente tiene que poder distinguirlas: «tu jefe ya la decidió» exige mirar el
 * resultado, y «ya la retiraste» —el doble clic— no exige nada.
 */
function codigoNoPendiente(estado: EstadoModificacion): string {
  return estado === 'retirada' ? 'ya_retirada' : 'ya_decidida';
}

/**
 * El autor retira su propia propuesta. Sin correo a nadie: retirar deja la
 * solicitud exactamente como estaba, así que no hay nada que comunicar.
 *
 * El dueño se comprueba por `empleadoId` contra la SOLICITUD, la misma noción
 * que usa `pedirModificacion`. Comparar aquí el `solicitanteEmail` congelado en
 * el satélite —que es el dato que la fila ya trae, y ahorraba esta consulta—
 * daba un 403 sobre su propia propuesta a quien hubiera cambiado de correo
 * entre pedirla y retirarla.
 */
export async function retirarModificacion(db: Pool, sesion: Sesion, id: string): Promise<Modificacion> {
  const empleado = await empleadoDeSesion(db, sesion);
  const modificacion = await repo.modificacionPorId(db, id);
  if (!modificacion) throw new AusenciaError('no_encontrada', 404);

  const solicitud = await repo.solicitudPorId(db, modificacion.solicitudId);
  // La FK va con ON DELETE CASCADE, así que una propuesta sin solicitud no
  // debería existir; si existiera, no hay dueño contra quien comparar y negarla
  // es lo único seguro.
  if (!solicitud) throw new AusenciaError('no_encontrada', 404);
  if (solicitud.empleadoId !== empleado.id) throw new AusenciaError('no_es_su_modificacion', 403);

  if (modificacion.estado !== 'pendiente') {
    throw new AusenciaError(codigoNoPendiente(modificacion.estado), 409);
  }

  const retirada = await repo.retirarModificacion(db, id);
  if (!retirada) {
    // Sin fila: alguien la movió entre la lectura y el UPDATE. Se relee para
    // decir cuál de las dos cosas pasó en vez de acusar al jefe por defecto —el
    // caso más probable aquí es el doble clic del propio autor.
    const actual = await repo.modificacionPorId(db, id);
    throw new AusenciaError(actual ? codigoNoPendiente(actual.estado) : 'no_encontrada', actual ? 409 : 404);
  }
  return retirada;
}

// ── Decidir la modificación ────────────────────────────────────────────────

/**
 * Quién puede aprobar o rechazar una propuesta.
 *
 * ⚠️ El decisor sale de la PROPUESTA (`m.aprobadorCorreo`, congelado al pedirla)
 * y de ningún otro sitio. La solicitud entra por parámetro para el guard del
 * solicitante —y para que el llamante ya la tenga cargada—, pero **sus firmantes
 * NO se miran**: escribir esto como un OR de `s.aprobadorCorreo` y
 * `s.segundoAprobadorCorreo` es lo natural y es exactamente el bug que
 * `puedeDecidir` documenta treinta líneas más arriba. Sobre una `pendiente_2`,
 * ese OR dejaría decidir el cambio al jefe inmediato, que ya perdió el turno.
 *
 * **El propio solicitante no, aunque la propuesta sea suya**: autoaprobarse
 * convierte el debido proceso en un formulario. Se compara contra
 * `s.solicitanteEmail` —el de la fila, que el PATCH mantiene al día— y no contra
 * el congelado en el satélite: quien cambiara de correo entre pedirla y
 * decidirla se saltaría el candado con la copia vieja.
 *
 * El admin va PRIMERO, como en `puedeDecidir`: es quien destraba una decisión
 * cuyo firmante no está disponible. Eso deja fuera del candado a un admin que
 * decidiera su propia propuesta, y se acepta a sabiendas: ese admin ya puede
 * reescribir la fila entera con el `PATCH`, que **no manda ningún correo**,
 * mientras que por aquí la decisión sale por correo a toda la cadena. Cerrarle
 * esta puerta solo lo empujaría a la silenciosa.
 */
export function puedeDecidirModificacion(sesion: Sesion, m: Modificacion, s: Solicitud): boolean {
  if (sesion.esAdmin) return true;
  const yo = sesion.email.toLowerCase();
  if (s.solicitanteEmail.toLowerCase() === yo) return false;
  return m.aprobadorCorreo.toLowerCase() === yo;
}

/**
 * Una solicitud de la bandeja de cambios: su propuesta viva, y si quien mira
 * puede decidirla.
 *
 * `modificacionPendiente` se estrecha a NO nula: en esta respuesta nunca lo es
 * —la consulta filtra por `m.id IS NOT NULL`—, y dejarla nullable obligaría al
 * espejo manual del frontend a un `!` por fila para algo que no puede pasar.
 *
 * `puedoDecidirla` es el `esMiTurno` de esta bandeja, y existe por la misma
 * razón: que la regla viva en un solo sitio. Duplicar el guard en el navegador
 * es cómo se llega a ofrecer un botón que responde 403 al pulsarlo, y aquí la
 * parte que un espejo manual se deja es justo la que más importa (la exclusión
 * del solicitante).
 */
export type SolicitudConPropuesta = Solicitud & {
  modificacionPendiente: Modificacion;
  puedoDecidirla: boolean;
};

/** Estrecha el tipo sin `!`, y de paso descarta una fila imposible. */
const tienePropuesta = (s: Solicitud): s is Solicitud & { modificacionPendiente: Modificacion } =>
  s.modificacionPendiente !== null;

/**
 * Las solicitudes con una propuesta viva que le toca decidir a quien pregunta.
 *
 * Sin guard de aprobador: quien no tenga ninguna recibe lista vacía, no un 403.
 * Mismo criterio que `pendientesDeAprobar` — un 403 no aportaría nada y
 * obligaría a la app a saber de antemano si alguien es decisor.
 *
 * Es el criterio CONTRARIO al de `movimientosVisibles`, y a propósito: esta
 * bandeja acota por el decisor congelado en cada propuesta, así que quien no
 * decide nada recibe de verdad una lista vacía. Aquella acota por RAMA del
 * organigrama, y ahí no ponerle guard sería dejar la puerta abierta.
 *
 * ⚠️ La fila puede venir con `puedoDecidirla: false`, y no es un caso raro: la
 * RAÍZ del organigrama es su propio jefe (`aprobadoresDe` lo trata así a
 * propósito), así que sobre sus propias solicitudes el decisor congelado es ella
 * misma y el guard del solicitante la frena. Se le enseña la fila apagada —y con
 * el botón de retirar, que sí es suyo— en vez de esconderla o de ofrecerle un
 * botón que responde 403. Un admin también las ve todas, como en la bandeja de
 * solicitudes.
 */
export async function modificacionesPendientes(db: Pool, sesion: Sesion): Promise<SolicitudConPropuesta[]> {
  const solicitudes = await repo.modificacionesPendientes(db, sesion.email, sesion.esAdmin);
  return solicitudes.filter(tienePropuesta).map((s) => ({
    ...s,
    puedoDecidirla: puedeDecidirModificacion(sesion, s.modificacionPendiente, s),
  }));
}

/**
 * El jefe decide la propuesta. El cuerpo es `{ aprueba, motivo? }`, **idéntico**
 * al de la decisión de una solicitud, para que la interfaz pueda reutilizar el
 * mismo componente y el mismo manejo de errores.
 *
 * Decide UNA sola persona: la modificación no estrena segunda firma. La segunda
 * firma valida la concesión, que ya está validada, y exigir dos para *renunciar*
 * a unas vacaciones es absurdo.
 *
 * ⚠️ Limitación conocida y deliberada: aprobar un cambio de fechas sobre una
 * `pendiente_2` **no la devuelve a `pendiente`** para que el primer jefe
 * refirme. `transicionAlDecidir` es monótona por diseño, y esa arista hacia
 * atrás repoblaría la bandeja del primer firmante mientras el segundo está
 * decidiendo, además de romper el razonamiento del testigo (el estado previo
 * dejaría de describir la fila). El primer firmante se entera por el correo, que
 * va a la cadena entera.
 */
export async function decidirModificacion(
  db: Pool,
  sesion: Sesion,
  id: string,
  body: unknown,
): Promise<{ modificacion: Modificacion; solicitud: Solicitud }> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.aprueba !== 'boolean') throw new AusenciaError('aprueba_requerido', 400, 'aprueba');
  const motivo = typeof b.motivo === 'string' ? b.motivo.trim() : '';
  // El tope del rechazo, no el de la petición: aquí se justifica un no, que es
  // exactamente lo mismo que hace `decidir`.
  if (motivo.length > MAX_MOTIVO) throw new AusenciaError('motivo_demasiado_largo', 400, 'motivo');

  const modificacion = await repo.modificacionPorId(db, id);
  if (!modificacion) throw new AusenciaError('no_encontrada', 404);
  const solicitud = await repo.solicitudPorId(db, modificacion.solicitudId);
  // La FK va con ON DELETE CASCADE, así que esto no debería ocurrir; si
  // ocurriera, no hay solicitud a la que aplicar nada y negarlo es lo único
  // seguro. Mismo criterio que `retirarModificacion`.
  if (!solicitud) throw new AusenciaError('no_encontrada', 404);
  if (!puedeDecidirModificacion(sesion, modificacion, solicitud)) {
    throw new AusenciaError('no_es_su_aprobacion', 403);
  }
  // El guard va antes que este 409 —al revés que en `decidir`— porque aquí un
  // tercero no tiene ningún derecho a saber si la propuesta ya se decidió.
  if (modificacion.estado !== 'pendiente') throw new AusenciaError('ya_decidida', 409);

  const firmante = await firmanteDeSesion(db, sesion);
  const resultado = await repo.decidirModificacion(
    db,
    id,
    b.aprueba,
    b.aprueba ? null : motivo || null,
    sesion.userId,
    // Clausura con el firmante dentro, por lo mismo que en `decidir`.
    (s, m, evento) => construirPayloadModificacion(s, m, evento, firmante),
  );
  if (!resultado.ok) {
    // Los tres son 409 y cuentan cosas distintas: `ya_decidida` es el doble clic
    // o alguien que se adelantó; `solicitud_cambio_de_estado` es que la
    // solicitud se movió debajo —un PATCH de admin, una decisión del jefe— y
    // aplicar el cambio habría pisado esa corrección en silencio; `rango_solapado`
    // es que a esa persona le aprobaron OTRA ausencia sobre esos días entre que
    // se propuso el cambio y se firma, así que la propuesta era legal cuando se
    // pidió y ha dejado de serlo sin que nadie hiciera nada mal.
    if (resultado.razon === 'solape') {
      // Mismo `code`, mismo `field` y mismo `detalle` que las otras tres puertas,
      // y ya no por buena voluntad: los cuatro salen de `errorDeSolape`. Llegar
      // aquí con una forma distinta obligaría a la interfaz a aprender un segundo
      // caso para decir lo mismo.
      throw errorDeSolape(resultado.solape);
    }
    throw resultado.razon === 'ya_decidida'
      ? new AusenciaError('ya_decidida', 409)
      : new AusenciaError('solicitud_cambio_de_estado', 409);
  }

  void avisarN8n();
  // Se devuelven las DOS filas: la decisión toca dos, y quien pintaba la
  // solicitud necesita la versión nueva. Devolver solo la propuesta obligaría a
  // una segunda llamada cuyo resultado podría ya no ser este.
  return { modificacion: resultado.modificacion, solicitud: resultado.solicitud };
}

// ── Importación del histórico de la hoja ───────────────────────────────────

// ARQ-612 — en service/historico.ts. Se reexporta todo.
export * from './service/historico.js';

// ── Saldo de vacaciones ────────────────────────────────────────────────────

// ARQ-612 — en service/saldos.ts: validar el saldo de corte, juntar cada ficha
// con sus ausencias (`combinar`) y las consultas que lo usan. Las dos
// comprobaciones del alta y el panel de KPIs importan lo que usan. Se
// reexporta todo.
export * from './service/saldos.js';

// ── Organigrama ────────────────────────────────────────────────────────────

// ARQ-612 — en service/organigrama.ts: los empleados con su posición en el
// árbol y las puertas que lo cambian o que reparten las llaves de la ficha. Se
// reexporta todo.
export * from './service/organigrama.js';

// ── Panel de KPIs ──────────────────────────────────────────────────────────

// ARQ-612 — en service/kpis.ts. Se reexporta todo.
export * from './service/kpis.js';

// ── Calendario ─────────────────────────────────────────────────────────────

// ARQ-612 — en service/calendario.ts, las dos vistas con el alcance que
// comparten. Se reexporta todo.
export * from './service/calendario.js';

// ── Baja de un empleado ─────────────────────────────────────────────────────

// ARQ-612 — en service/retiro.ts: registrar la baja, deshacerla y la lista de
// retirados. Se reexporta todo.
export * from './service/retiro.js';
