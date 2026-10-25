import type { Pool } from '@algarpibe/zoho-sync';
import { avisarN8n } from '../avisar.js';
import { contarDiasHabiles } from '../dias-habiles.js';
import { AusenciaError } from '../errores.js';
import { aprobadoresDe, jefeEfectivo } from '../jerarquia.js';
import { construirPayload, construirPayloadModificacion, eventosDeAlta } from '../notificaciones.js';
import * as repo from '../repo.js';
import { hoyEnColombia, pedible } from '../saldo.js';
import {
  correoDelTurno,
  esOtorgamiento,
  requiereAprobacion,
  transicionAlDecidir,
  type Empleado,
  type EstadoSolicitud,
  type NuevaSolicitud,
  type Solicitud,
  type TipoSolicitud,
} from '../types.js';
import { saldosDeSesion } from './saldos.js';
import { empleadoDeSesion, firmanteDeSesion, type Sesion } from './sesion.js';
import { exigirSinSolape } from './solapes.js';
import { MAX_ADJUNTO_BYTES, MAX_MOTIVO, nombreArchivoNormalizado, validarNuevaSolicitud } from './validacion.js';

// ARQ-612 — la vida de una solicitud vista desde el servicio, sacada de
// service.ts tal cual en cuatro bloques: el alta (con sus comprobaciones de
// saldo, todo bajo el candado del empleado), las listas de quien pide y de
// quien firma, la decisión de la bandeja y la retirada por su propio dueño
// (`puedeRetirarla` y `retirarSolicitud`, que vivían en la sección de
// modificaciones sin depender de nada de ella). service.ts lo reexporta (lo
// vigila barril.test.ts).

/**
 * Corta si esta persona no tiene compensatorios suficientes.
 *
 * Al contrario que las vacaciones —que solo avisan en el cliente y dejan la
 * decisión a quien firma— el compensatorio se BLOQUEA aquí. La razón es que no
 * se devenga con el tiempo: un descubierto no se cura esperando, y nadie puede
 * autorizarlo tampoco, porque los días o se han ganado o no.
 *
 * ⚠️ SIN CONFIGURAR CUENTA COMO CERO Y BLOQUEA. Es decisión de producto, y tiene
 * una consecuencia operativa que no se puede olvidar: las migraciones tienen
 * prohibido sembrar datos, así que el día que esto entra en producción la bolsa
 * está vacía para TODA la plantilla. Por eso esta función viaja en un despliegue
 * posterior al de la pestaña que permite sembrarla, y no en el mismo — si no,
 * nadie podría pedir un compensatorio durante el hueco. El contador de «sin
 * bolsa de compensatorios» del panel de Saldos es el que dice cuándo se puede
 * activar: mientras no esté en cero, esto corta a gente que no tiene forma de
 * arreglarlo por su cuenta.
 *
 * Se compara contra `pedible` (disponible − enTramite) y NO contra `disponible`:
 * con el firme a secas, tres solicitudes de un día con un día de bolsa pasarían
 * las tres, porque ninguna de las anteriores ha bajado el firme todavía (media
 * firma no descuenta, ver `calcularSaldo`).
 *
 * Solo al CREAR, nunca al aprobar. Bloquear en la firma dejaría solicitudes
 * pendientes imposibles de decidir si la bolsa baja entre medias, y al jefe con
 * una bandeja que no puede vaciar. Tampoco en el `PATCH` de admin: ahí no se
 * decide nada, se corrige el registro.
 *
 * Son dos SELECT sin `FOR UPDATE`: por sí sola esta comprobación no cierra la
 * carrera de dos altas simultáneas. La cierra que el alta la llame bajo
 * `repo.conCandadoDelEmpleado` y con su `tx` (DATA-336): la segunda pestaña
 * espera a que la primera confirme y ya ve su día en trámite.
 */
async function exigirCompensatoriosSuficientes(
  db: repo.Consultable,
  empleado: Empleado,
  tipo: TipoSolicitud,
  dias: number,
): Promise<void> {
  if (tipo !== 'compensatorio') return;
  // Un rango entero de fines de semana da 0 días hábiles y no consume nada. Sin
  // este corte, con la bolsa en negativo —alcanzable: basta que un admin baje el
  // corte después de aprobar— `0 > -2` bloquearía una solicitud que no gasta un
  // solo día. `TarjetaCompensatorios` ya esquiva lo mismo con su `diasPedidos > 0`.
  if (dias <= 0) return;

  const { compensatorios } = await saldosDeSesion(db, empleado);
  // Se distingue de «no te alcanza» porque la acción es otra: aquí no hay nada
  // que el empleado pueda hacer salvo avisar a administración, y un mensaje
  // único lo dejaría dando vueltas.
  if (!compensatorios.configurado) {
    throw new AusenciaError('compensatorios_sin_saldo', 409, 'tipo');
  }

  const puedePedir = pedible(compensatorios);
  if (dias <= puedePedir) return;
  // El detalle es obligatorio, no decorativo: «no puedes» sin los números es
  // inaccionable. No hay riesgo de fuga — es el saldo de quien pregunta.
  throw new AusenciaError('compensatorios_insuficientes', 409, 'fechaFin', {
    pedidos: dias,
    pedible: puedePedir,
    disponible: compensatorios.disponible,
    enTramite: compensatorios.enTramite,
  });
}

/**
 * Nadie pide más vacaciones de las que tiene. Salvo un admin.
 *
 * Gemela de `exigirCompensatoriosSuficientes` y con las mismas tres decisiones,
 * que ya están razonadas allí y no se repiten: se compara contra `pedible`
 * (disponible − enTramite) y no contra el firme —si no, tres solicitudes que
 * quepan por separado pasarían las tres, porque media firma no descuenta—; el
 * corte por `dias <= 0` deja pasar un rango de solo fin de semana, que no gasta
 * nada; y solo actúa al CREAR, nunca al aprobar ni en el `PATCH` de admin.
 *
 * ⚠️ **Dos diferencias con su gemela, y las dos son deliberadas.**
 *
 * La primera: un ADMIN queda exento y puede meterse en negativo. Es lo que se
 * pidió, y la exención sale de la SESIÓN, así que cubre exactamente a quien
 * pulsa el botón — un admin sobre su propia solicitud. No existe hoy un alta en
 * nombre de otro, así que no hay forma de que un admin meta en negativo a nadie
 * más; si algún día se añade, esta línea hay que volver a mirarla.
 *
 * La segunda: sin saldo configurado **NO se bloquea**, al revés que los
 * compensatorios. La asimetría no es un descuido. Una bolsa de compensatorios
 * sin configurar significa «no tienes compensatorios», que es el estado normal
 * de casi toda la plantilla. Un saldo de vacaciones sin configurar significa
 * «administración todavía no ha puesto el punto de corte» — o sea DESCONOCIDO, no
 * cero—, y `sinConfigurar()` devuelve `disponible: 0`. Bloquear sobre eso le
 * cerraría las vacaciones a quien no puede arreglarlo por su cuenta, y encima el
 * día del despliegue y de golpe. Se deja pasar y se registra, que es lo que hace
 * visible a quién le falta el corte sin castigar a nadie por ello.
 */
async function exigirVacacionesSuficientes(
  db: repo.Consultable,
  empleado: Empleado,
  tipo: TipoSolicitud,
  dias: number,
  esAdmin: boolean,
): Promise<void> {
  if (tipo !== 'vacaciones') return;
  if (esAdmin) return;
  if (dias <= 0) return;

  const { saldo } = await saldosDeSesion(db, empleado);

  if (!saldo.configurado) {
    // Una línea por solicitud, no un contador: lo que hace falta saber es a QUIÉN
    // le falta el corte, y eso es justo lo que administración necesita para
    // sembrarlo desde el panel de Saldos.
    console.log(
      JSON.stringify({
        event: 'ausencias_vacaciones_sin_saldo_configurado',
        timestamp: new Date().toISOString(),
        empleadoId: empleado.id,
        correo: empleado.correo,
        diasPedidos: dias,
      }),
    );
    return;
  }

  const puedePedir = pedible(saldo);
  if (dias <= puedePedir) return;
  // El detalle es obligatorio, no decorativo, por lo mismo que en la gemela: «no
  // puedes» sin los números es inaccionable. Y no hay fuga: es el saldo de quien
  // pregunta.
  throw new AusenciaError('vacaciones_insuficientes', 409, 'fechaFin', {
    pedidos: dias,
    pedible: puedePedir,
    disponible: saldo.disponible,
    enTramite: saldo.enTramite,
  });
}

/**
 * El tramo del alta que corre bajo el candado del empleado (DATA-336): las
 * comprobaciones que leen —solape, otorgamiento duplicado, saldo— y el INSERT,
 * todo por la MISMA transacción `tx`. Ver `repo.conCandadoDelEmpleado`.
 *
 * Es el cuerpo de `crearSolicitud` tal cual estaba, con `tx` donde ponía `db`:
 * se saca a una función propia para no tener que re-sangrarlo entero dentro
 * del callback del candado.
 */
async function altaBajoCandado(
  tx: repo.PoolClient,
  sesion: Sesion,
  empleado: Empleado,
  datos: NuevaSolicitud,
  aprueba: boolean,
  estado: EstadoSolicitud,
): Promise<Solicitud> {
  // Va aquí porque necesita el id del empleado, y antes de escribir nada DE LA
  // SOLICITUD: el alta automática de la ficha ya ha podido escribir en la línea
  // de arriba (`empleadoDeSesion` → `repo.asegurarEmpleado`, un INSERT ... ON
  // CONFLICT DO NOTHING idempotente), pero de ahí es de donde sale el id que
  // esta comprobación necesita, así que tiene que ir antes por fuerza.
  await exigirSinSolape(tx, empleado.id, datos.tipo, estado, datos.fechaInicio, datos.fechaFin, null);
  // El otorgamiento no pasa por la comprobación de arriba —está exento de
  // `ocupaAgenda` a propósito, porque su fecha es el día que se TRABAJÓ y tiene
  // que poder caer dentro de las propias vacaciones—, y esa exención dejaba
  // abierto reclamar DOS veces la misma jornada: dos peticiones por el mismo
  // sábado conceden el doble de días por un solo día de trabajo, y ninguna de
  // sus cuatro reglas propias lo miraba.
  //
  // Por eso una regla suya y estrecha, en vez de meterlo en `ocupaAgenda`:
  // aquello cerraría el duplicado y de paso rompería el caso más típico que
  // tiene este tipo.
  if (esOtorgamiento(datos.tipo) && (await repo.existeOtorgamientoDelDia(tx, empleado.id, datos.fechaInicio, null))) {
    throw new AusenciaError('otorgamiento_duplicado', 409, 'fechaInicio');
  }
  // En un otorgamiento los días NO se cuentan: se conceden. `contarDiasHabiles`
  // daría 0 justo en el caso normal —el sábado por el que se gana el
  // compensatorio no es hábil— y la concesión quedaría en nada. `datos.dias` ya
  // viene validado, y `validarNuevaSolicitud` garantiza que existe si y solo si
  // el tipo es otorgamiento.
  const diasHabiles = datos.dias ?? contarDiasHabiles(datos.fechaInicio, datos.fechaFin);
  // No puede subir más: necesita `diasHabiles`. Y va antes de resolver firmantes
  // y de decodificar el base64 del adjunto para no procesar 8 MB de una solicitud
  // que se va a rechazar.
  await exigirCompensatoriosSuficientes(tx, empleado, datos.tipo, diasHabiles);
  // Las dos puertas van seguidas y ninguna se solapa con la otra: cada una mira
  // su `tipo` y sale enseguida si no es el suyo, así que solo una llega a
  // consultar el saldo. Se llaman las dos, y no un `if/else` sobre el tipo,
  // porque el día que haya una tercera bolsa la lista crece sin tocar el flujo.
  await exigirVacacionesSuficientes(tx, empleado, datos.tipo, diasHabiles, sesion.esAdmin);

  // Los dos firmantes se congelan AQUÍ. La fuente de verdad sigue siendo el árbol
  // de `empleados`; esto es una foto, para que un cambio de organigrama a mitad de
  // trámite no mueva una solicitud que ya está en vuelo.
  //
  // El correo del jefe pasa por `jefeEfectivo` ANTES de resolver su enlace: quien
  // es su propio jefe firma con el aprobador de reserva, y el segundo nivel tiene
  // que subirse desde el árbol de ÉSE y no del suyo propio.
  //
  // Un otorgamiento se firma con UNA sola firma, sea cual sea la casilla de la
  // ficha: conceder días es una decisión del jefe inmediato y no hay nada que un
  // segundo escalón añada. No se inventa nada — es exactamente lo que ya hace una
  // ficha con `requiereSegundaFirma` apagada, y el de segundo nivel queda en
  // `informado`, enterándose del resultado.
  const correoDelJefe = jefeEfectivo(empleado);
  const firmantes = aprueba
    ? aprobadoresDe(
        {
          ...empleado,
          aprobadorCorreo: correoDelJefe,
          requiereSegundaFirma: empleado.requiereSegundaFirma && !esOtorgamiento(datos.tipo),
        },
        await repo.enlaceDe(tx, correoDelJefe),
      )
    : null;

  const adjunto = datos.adjunto
    ? {
        nombreArchivo: nombreArchivoNormalizado(datos.tipo, empleado.nombreCompleto, datos.fechaInicio),
        mime: datos.adjunto.mime,
        contenido: Buffer.from(datos.adjunto.contenidoBase64, 'base64'),
      }
    : null;

  // El tope real, ya decodificado: la estimación de base64 puede quedarse corta
  // si el cliente mete relleno o saltos de línea.
  if (adjunto && adjunto.contenido.length > MAX_ADJUNTO_BYTES) {
    throw new AusenciaError('adjunto_demasiado_grande', 400, 'adjunto');
  }

  return repo.insertarSolicitud(
    tx,
    {
      tipo: datos.tipo,
      empleadoId: empleado.id,
      solicitanteEmail: empleado.correo,
      fechaInicio: datos.fechaInicio,
      fechaFin: datos.fechaFin,
      diasHabiles,
      horaInicio: datos.horaInicio,
      horaFin: datos.horaFin,
      comentarios: datos.comentarios ?? null,
      estado,
      // Una incapacidad no la aprueba nadie: dejar aquí un aprobador la haría
      // aparecer en su bandeja de pendientes.
      aprobadorCorreo: firmantes ? firmantes.primero : null,
      segundoAprobadorCorreo: firmantes ? firmantes.segundo : null,
      informadoCorreo: firmantes ? firmantes.informado : null,
    },
    adjunto,
    eventosDeAlta(datos.tipo),
    construirPayload,
  );
}

export async function crearSolicitud(db: Pool, sesion: Sesion, body: unknown): Promise<Solicitud> {
  const datos = validarNuevaSolicitud(body, hoyEnColombia());
  const empleado = await empleadoDeSesion(db, sesion);
  // La otra mitad del bloqueo de la baja: allí se impide fijar una fecha que
  // deje días huérfanos detrás, y aquí se impide crear esos días después. Sin
  // las dos, la regla se puede saltar por el otro extremo.
  //
  // Va aquí y no en `validarNuevaSolicitud` porque esa función es pura y no
  // conoce la ficha; mismo criterio que `exigirSinSolape` y
  // `exigirVacacionesSuficientes`.
  //
  // `>` y no `>=`: la fecha de retiro es su último día trabajado, así que unas
  // vacaciones que acaban justo ese día caben.
  //
  // El otorgamiento NO queda exento, aunque sí lo está de `ocupaAgenda` y del
  // solape. La mitad gemela de este candado —`repo.diasPosterioresA`, la que
  // bloquea FIJAR el retiro— tampoco lo excluye por tipo: su WHERE solo mira
  // `fecha_fin > fecha` y el estado, sin `tipo <> 'otorgamiento'`. Exceptuarlo
  // aquí rompería esa simetría: un otorgamiento posterior bloquearía fijar el
  // retiro, pero crear ese mismo otorgamiento DESPUÉS de fijarlo no chocaría
  // con nada. Y tiene sentido por sí solo: la fecha de un otorgamiento es el
  // día que se TRABAJÓ, y reclamar uno posterior al último día trabajado es la
  // misma contradicción que agendar una ausencia después de haberse ido —
  // aunque uno sume días y la otra los gaste. En la práctica esta guarda casi
  // nunca la alcanza un otorgamiento: no se puede pedir para el futuro
  // (`trabajo_en_el_futuro`), así que si el retiro sigue siendo futuro la
  // comparación nunca da `>`. Solo se dispara si `fechaRetiro` ya quedó en el
  // pasado antes de que el barrido desactivara la ficha.
  if (empleado.fechaRetiro !== null && datos.fechaFin > empleado.fechaRetiro) {
    throw new AusenciaError('fecha_posterior_al_retiro', 409, 'fechaFin', {
      fechaRetiro: empleado.fechaRetiro,
    });
  }
  // Los dos suben aquí porque la comprobación de solape pregunta por la fila que
  // se va a crear, y eso incluye con qué estado nace. Son derivaciones puras de
  // `datos.tipo`, así que adelantarlas no cambia nada más.
  const aprueba = requiereAprobacion(datos.tipo);
  const estado = aprueba ? 'pendiente' : 'registrada';
  // DATA-336 — de aquí al INSERT, todo bajo el candado del empleado: sin él, dos
  // altas simultáneas comprobaban las dos antes de que ninguna escribiera, y las
  // dos pasaban. Ver `repo.conCandadoDelEmpleado`.
  const solicitud = await repo.conCandadoDelEmpleado(db, empleado.id, (tx) =>
    altaBajoCandado(tx, sesion, empleado, datos, aprueba, estado),
  );

  // Sin await: el aviso es un atajo para que el correo salga en un segundo en vez
  // de en unos minutos. La solicitud ya está guardada y encolada, así que esto no
  // puede fallar de forma que importe. Ver avisar.ts.
  void avisarN8n();
  return solicitud;
}

export async function misSolicitudes(db: Pool, sesion: Sesion): Promise<Solicitud[]> {
  const empleado = await empleadoDeSesion(db, sesion);
  return repo.solicitudesDeEmpleado(db, empleado.id);
}

/** Una solicitud de la bandeja, con si le toca firmarla a quien la mira. */
export interface SolicitudPendiente extends Solicitud {
  /**
   * Si le toca firmar AHORA a quien pregunta.
   *
   * Solo puede ser `false` para un **admin**: `solicitudesPendientes` ya filtra
   * por turno para todos los demás, y a un admin le entrega la empresa entera
   * para que pueda destrabar una aprobación cuyo firmante no está disponible.
   *
   * Se calcula aquí y no en el navegador para que la regla del turno siga
   * viviendo en un solo sitio (`correoDelTurno`). Duplicarla en el cliente es
   * cómo se llega a que la interfaz y el servidor discrepen sin que nada falle:
   * el 403 saltaría al pulsar, con el botón ya ofrecido.
   */
  esMiTurno: boolean;
}

export async function pendientesDeAprobar(db: Pool, sesion: Sesion): Promise<SolicitudPendiente[]> {
  const pendientes = await repo.solicitudesPendientes(db, sesion.email, sesion.esAdmin);
  const yo = sesion.email.toLowerCase();
  return pendientes.map((s) => ({ ...s, esMiTurno: (correoDelTurno(s) ?? '').toLowerCase() === yo }));
}

export async function decidir(db: Pool, sesion: Sesion, id: string, body: unknown): Promise<Solicitud> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.aprueba !== 'boolean') throw new AusenciaError('aprueba_requerido', 400, 'aprueba');
  const motivo = typeof b.motivo === 'string' ? b.motivo.trim() : '';
  if (motivo.length > MAX_MOTIVO) throw new AusenciaError('motivo_demasiado_largo', 400, 'motivo');

  const solicitud = await repo.solicitudPorId(db, id);
  if (!solicitud) throw new AusenciaError('no_encontrada', 404);
  if (!puedeDecidir(sesion, solicitud)) throw new AusenciaError('no_es_su_aprobacion', 403);

  const transicion = transicionAlDecidir(solicitud, b.aprueba);
  // Estado terminal: `puedeDecidir` deja pasar a los dos firmantes precisamente
  // para llegar aquí, porque «ya decidida» describe mejor lo ocurrido que un 403.
  if (!transicion) throw new AusenciaError('ya_decidida', 409);

  const firmante = await firmanteDeSesion(db, sesion);
  const actualizada = await repo.decidirSolicitud(
    db,
    id,
    solicitud.estado,
    transicion,
    b.aprueba ? null : motivo || null,
    sesion.userId,
    // Una clausura con el firmante ya dentro, en vez de pasar la función a pelo.
    // Así el contrato que el repo pide —`(solicitud, evento) => PayloadEvento`—
    // no cambia y `construirPayload` sigue siendo pura: quien consulta la ficha
    // es el servicio, que es quien tiene el `Pool` y la sesión.
    (s, evento) => construirPayload(s, evento, firmante),
    // El aviso de la propuesta que caduca. Va SIN firmante y no es un olvido: no
    // la cierra nadie, la cierra el sistema porque la firma la dejó inaplicable.
    construirPayloadModificacion,
  );
  // El UPDATE lleva `AND estado = <el que se leyó>`: si no devolvió fila es que
  // otro (o un doble clic) se adelantó. Es un conflicto, no un fallo del servidor.
  if (!actualizada) throw new AusenciaError('ya_decidida', 409);

  void avisarN8n();
  return actualizada;
}

/**
 * Quien tiene el TURNO, o un admin (que destraba aprobaciones bloqueadas).
 *
 * ⚠️ Las ramas están separadas por estado a propósito. Escribirlo como un OR de
 * los dos correos —que es la forma más natural— dejaría al segundo aprobador
 * firmar una solicitud que su jefe inmediato todavía no ha visto: la cascada
 * dejaría de existir sin que nada fallara.
 *
 * En estado terminal pasan los dos firmantes, para que el 409 de «ya decidida»
 * gane al 403: es más informativo, y es lo que ya hacía la versión de una firma.
 */
export function puedeDecidir(sesion: Sesion, s: Solicitud): boolean {
  if (sesion.esAdmin) return true;
  const yo = sesion.email.toLowerCase();
  // **El propio solicitante no, aunque él mismo sea el aprobador congelado.**
  // Faltaba, y era el agujero: la raíz del organigrama se declara siendo su
  // propio jefe, así que su solicitud aterrizaba en su propia bandeja y se la
  // firmaba ella. Valía para TODOS los tipos, no solo para los otorgamientos.
  //
  // Gemela de la que `puedeDecidirModificacion` ya tenía, y con el mismo orden:
  // el admin va PRIMERO y queda fuera del candado, a sabiendas —ya puede
  // reescribir la fila entera con el PATCH, que no manda ningún correo, así que
  // cerrarle esta puerta solo lo empujaría a la silenciosa—.
  //
  // Se compara contra `solicitanteEmail`, el de la fila que el PATCH mantiene al
  // día, y no contra el congelado en ningún satélite.
  //
  // La otra mitad de la regla está en `jefeEfectivo` (jerarquia.ts), que manda
  // esas solicitudes al aprobador de reserva: sin ella esto no cerraría el
  // agujero, lo convertiría en un callejón sin salida.
  if (s.solicitanteEmail.toLowerCase() === yo) return false;
  if (s.estado === 'pendiente') return (s.aprobadorCorreo ?? '').toLowerCase() === yo;
  if (s.estado === 'pendiente_2') return (s.segundoAprobadorCorreo ?? '').toLowerCase() === yo;
  return (
    (s.aprobadorCorreo ?? '').toLowerCase() === yo || (s.segundoAprobadorCorreo ?? '').toLowerCase() === yo
  );
}

/**
 * Si su dueño puede RETIRARLA él mismo, sin pedirle permiso a nadie.
 *
 * Mucho más estrecho que `puedePedirModificacion`: solo mientras esté
 * `pendiente` y **sin ninguna firma dada**. En `pendiente_2` el jefe inmediato ya
 * dio su visto bueno, y hacerlo desaparecer sin decírselo sería borrarle una
 * decisión; para eso está pedir la anulación, que él firma.
 *
 * Las dos condiciones y no solo el estado: un admin puede devolver una solicitud
 * a `pendiente` desde el PATCH del registro sin limpiar `primeraFirmaAt`, y en
 * esa fila «pendiente» convive con una firma ya dada. Es el mismo par que
 * defiende el WHERE de `repo.retirarSolicitud`, y están en los dos sitios a
 * propósito: aquí decide el 409 con su mensaje, allí cierra la carrera.
 *
 * No mira la fecha, al revés que `puedePedirAnulacion`. No hace falta: una
 * solicitud sin firmar no ha reservado nada ni ha llegado al calendario, así que
 * retirar una que ya empezó no regala días de nadie — simplemente deja de pedir
 * unos que nunca se concedieron.
 */
export function puedeRetirarla(s: Pick<Solicitud, 'estado' | 'primeraFirmaAt'>): boolean {
  return s.estado === 'pendiente' && s.primeraFirmaAt === null;
}

/**
 * El dueño retira su propia solicitud. No la decide nadie: la quita él.
 *
 * Los tres guards van en este orden y no es indiferente:
 *  1. Existe. 404 si no.
 *  2. Es SUYA. 403 — y se compara contra el empleado de la sesión, nunca contra
 *     nada que venga en la petición. Ni un admin puede retirar la de otro: para
 *     tocar la fila de un tercero está el `DELETE` del registro, que además deja
 *     rastro de quién lo hizo.
 *  3. Está retirable. 409 con el porqué.
 *
 * El 403 va ANTES que el 409 a propósito: a quien no es el dueño no se le dice
 * en qué estado está la solicitud de otro, ni siquiera para negarle la acción.
 */
export async function retirarSolicitud(db: Pool, sesion: Sesion, id: string): Promise<Solicitud> {
  const empleado = await empleadoDeSesion(db, sesion);
  const solicitud = await repo.solicitudPorId(db, id);
  if (!solicitud) throw new AusenciaError('no_encontrada', 404);
  if (solicitud.empleadoId !== empleado.id) throw new AusenciaError('no_es_su_solicitud', 403);
  if (!puedeRetirarla(solicitud)) throw new AusenciaError('ya_no_se_puede_retirar', 409, 'estado');

  const retirada = await repo.retirarSolicitud(db, id, construirPayload);
  // Sin fila: el jefe firmó entre la lectura y el UPDATE, y su firma gana. Es un
  // conflicto, no un fallo — el mismo 409 que da el doble clic en la bandeja.
  if (!retirada) throw new AusenciaError('ya_no_se_puede_retirar', 409, 'estado');

  void avisarN8n();
  return retirada;
}
