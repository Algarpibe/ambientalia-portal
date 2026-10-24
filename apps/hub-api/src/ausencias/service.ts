import type { Pool } from '@algarpibe/zoho-sync';
import { avisarN8n } from './avisar.js';
import { APROBADOR_POR_DEFECTO, COPIA_POR_DEFECTO } from './config.js';
import { contarDiasHabiles, esFechaValida } from './dias-habiles.js';
import { AusenciaError } from './errores.js';
import {
  absentismoPorMes,
  acumulacionExcesiva,
  diasDesde,
  estacionalidadPorMes,
  friccion,
  ventanaDeKpis,
  pendientesPorAntiguedad,
  tiemposPorAprobador,
  type Absentismo,
  type AcumulacionExcesiva,
  type Estacionalidad,
  type Friccion,
  type PendientesPorAntiguedad,
  type TiempoDeAprobador,
} from './kpis.js';
import { aprobadoresDe, construirIndice, creariaCiclo, detectarCiclos, jefeEfectivo } from './jerarquia.js';
import {
  construirPayload,
  construirPayloadModificacion,
  eventosDeAlta,
} from './notificaciones.js';
import * as repo from './repo.js';
import {
  calcularSaldo,
  calcularSaldoCompensatorios,
  hoyCongelado,
  hoyEnColombia,
  pedible,
  type SaldoCompensatorios,
  type SaldoVacaciones,
} from './saldo.js';
import { empleadoDeSesion, firmanteDeSesion, type Sesion } from './service/sesion.js';
import { errorDeSolape, exigirSinSolape } from './service/solapes.js';
import {
  MAX_ADJUNTO_BYTES,
  MAX_MOTIVO,
  nombreArchivoNormalizado,
  validarNuevaModificacion,
  validarNuevaSolicitud,
} from './service/validacion.js';
import {
  correoDelTurno,
  decisorDeModificacion,
  esOtorgamiento,
  requiereAprobacion,
  transicionAlDecidir,
  type Empleado,
  type EstadoModificacion,
  type EstadoSolicitud,
  type Modificacion,
  type NuevaSolicitud,
  type Solicitud,
  type TipoSolicitud,
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

// ARQ-612 — quién ve qué en el registro (los movimientos, la pestaña de
// adjuntos y la puerta de un PDF), en service/registro.ts. Se reexporta todo.
export * from './service/registro.js';

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

/**
 * Tope del saldo de corte, en valor absoluto. NUMERIC(5,1) admite hasta 9999,9,
 * pero 999 días son 66 años de devengo: por encima es un error de tecleo.
 *
 * Se aplica también hacia abajo: el saldo PUEDE ser negativo —quien ha
 * adelantado vacaciones ha disfrutado más días de los que lleva devengados, y
 * el Excel del que salen los saldos iniciales los trae así— pero -1000 sigue
 * siendo un tecleo.
 */
const MAX_SALDO = 999;

/** Lo que un admin puede fijar. Las dos a null vacía la configuración. */
export interface SaldoAFijar {
  saldoCorte: number | null;
  fechaCorte: string | null;
}

/**
 * Un saldo en texto: signo menos opcional, dígitos y, como mucho, una coma o un
 * punto decimal.
 *
 * Se comprueba la FORMA antes de convertir porque `Number()` es demasiado
 * permisivo para tratarlo como la respuesta a un formulario: acepta espacios
 * en blanco como 0 (`Number('  ') === 0`), hexadecimal (`Number('0x10') ===
 * 16`) y notación científica (`Number('1e2') === 100`). El panel de admin usa
 * `type="text"` —hace falta para admitir la coma decimal, que un
 * `type="number"` rechaza en la mayoría de locales—, así que cualquiera de
 * esas rarezas puede llegar tal cual desde el campo.
 */
const RE_SALDO = /^-?\d{1,3}([.,]\d+)?$/;

/** Las dos bolsas que puede traer el body del panel de admin. */
export interface SaldosAFijar {
  vacaciones: SaldoAFijar;
  /**
   * Null cuando el body NO traía la pareja de compensatorios: entonces la bolsa
   * no se toca. Es distinto de traerla con los dos campos vacíos, que sí la vacía.
   */
  compensatorios: SaldoAFijar | null;
}

/**
 * Valida una pareja saldo+fecha. Exige las dos claves, o ninguna cosa a medias.
 *
 * El operador `in` mira la CLAVE, no el valor: así se distingue «vaciar a
 * propósito» (las dos claves presentes y en null) de «el body no trae las
 * claves que se esperan» (un `{}`, o un renombrado en el front como
 * `{saldo: 20, fecha: '...'}`). Mirando solo el valor, los dos casos
 * colapsarían en el mismo `undefined` y un renombrado borraría en silencio
 * un saldo ya configurado.
 */
function validarPareja(b: Record<string, unknown>, claveSaldo: string, claveFecha: string): SaldoAFijar {
  const saldoPresente = claveSaldo in b;
  const fechaPresente = claveFecha in b;
  if (!saldoPresente || !fechaPresente) {
    throw new AusenciaError('saldo_incompleto', 400, !saldoPresente ? claveSaldo : claveFecha);
  }

  const valorSaldo = b[claveSaldo];
  const valorFecha = b[claveFecha];
  const saldoVacio = valorSaldo === null || valorSaldo === '';
  const fechaVacia = valorFecha === null || valorFecha === '';

  // Vaciar la configuración es legítimo: devuelve al empleado a «sin configurar».
  if (saldoVacio && fechaVacia) return { saldoCorte: null, fechaCorte: null };
  // A medias, no: es justo lo que impide el CHECK de la BD, y aquí el mensaje
  // se puede explicar. El campo señalado es el que FALTA, no el que sí llegó
  // (si no, la interfaz resaltaría el campo que el admin rellenó bien).
  if (saldoVacio || fechaVacia) {
    throw new AusenciaError('saldo_incompleto', 400, saldoVacio ? claveSaldo : claveFecha);
  }

  // Se exige el tipo ANTES de convertir: un array no debe llegar siquiera a
  // `String()` (que lo aplanaría a su primer elemento, o a "", y las dos
  // formas parecen un número válido para lo que sigue).
  if (typeof valorSaldo !== 'number' && typeof valorSaldo !== 'string') {
    throw new AusenciaError('saldo_invalido', 400, claveSaldo);
  }
  let saldo: number;
  if (typeof valorSaldo === 'number') {
    saldo = valorSaldo;
  } else {
    if (!RE_SALDO.test(valorSaldo)) throw new AusenciaError('saldo_invalido', 400, claveSaldo);
    saldo = Number(valorSaldo.replace(',', '.'));
  }
  if (!Number.isFinite(saldo) || Math.abs(saldo) > MAX_SALDO) {
    throw new AusenciaError('saldo_invalido', 400, claveSaldo);
  }

  // Mismo defecto de rebote que en el saldo: un array como `['2026-08-12']`
  // pasaría igual por `String()`, así que se exige el tipo antes de mirar el
  // contenido. `esFechaValida` descarta de paso los valores mágicos de
  // Postgres (`'infinity'`, `'today'`), que la columna DATE aceptaría sin
  // rechistar.
  if (typeof valorFecha !== 'string') throw new AusenciaError('fecha_invalida', 400, claveFecha);
  if (!esFechaValida(valorFecha)) throw new AusenciaError('fecha_invalida', 400, claveFecha);

  return { saldoCorte: Math.round(saldo * 10) / 10, fechaCorte: valorFecha };
}

/**
 * Valida a mano lo que llega del cliente; en este repo no hay zod.
 *
 * ⚠️ Las dos parejas NO se tratan igual, y la asimetría es deliberada. La de
 * vacaciones se EXIGE: lleva ahí desde el principio, así que si falta solo puede
 * ser un front renombrado, y dar eso por bueno borraría un saldo configurado. La
 * de compensatorios, en cambio, puede faltar por una razón legítima —un bundle
 * del portal anterior a esta función, que no la conoce— y tratar su ausencia
 * como «vacíala» borraría la bolsa de todo aquel a quien un admin le corrigiera
 * las vacaciones durante la ventana de despliegue. Ausente = no se toca.
 *
 * Basta con que asome UNA de las dos claves para exigir la otra: así un front que
 * sí las conoce pero manda media pareja sigue recibiendo su 400.
 */
export function validarSaldo(body: unknown): SaldosAFijar {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const traeCompensatorios = 'compensatoriosSaldoCorte' in b || 'compensatoriosFechaCorte' in b;
  return {
    vacaciones: validarPareja(b, 'saldoCorte', 'fechaCorte'),
    compensatorios: traeCompensatorios
      ? validarPareja(b, 'compensatoriosSaldoCorte', 'compensatoriosFechaCorte')
      : null,
  };
}

// ── Organigrama ────────────────────────────────────────────────────────────

/** Un empleado del maestro con su posición en el árbol ya derivada. */
export interface EmpleadoConJefatura extends Empleado {
  /** Quien firmaría en segundo lugar una solicitud suya creada ahora mismo. */
  segundoAprobadorCorreo: string | null;
  /**
   * Quien solo se enteraría del resultado, si su ficha no exige segunda firma.
   * Excluyente con el de arriba, y por eso van los dos: el panel necesita saber
   * QUIÉN está en el escalón de arriba aunque hoy no firme.
   *
   * No confundir con el `informadoCorreo` de `Solicitud`: aquel se congela en el
   * alta y vive con esa solicitud para siempre; este se recalcula en cada
   * consulta al maestro y cambia en cuanto se mueve el organigrama o se apaga la
   * casilla.
   */
  informadoCorreo: string | null;
  /** Su rama del organigrama forma un círculo. Se avisa, no se bloquea. */
  enCiclo: boolean;
  /**
   * Tiene rol de administrador en el portal.
   *
   * Existe para UNA cosa: que el panel no pinte las tres casillas de permisos
   * —soportes, exporta, empresa— en su fila. El rol ya se las da todas, plegadas
   * dentro de los booleanos del contexto, así que una casilla sin marcar ahí
   * afirmaba lo contrario de lo que pasa de verdad.
   *
   * NO es un permiso ni se guarda en `portal.empleados`: se deriva en cada
   * consulta del rol que tenga esa persona en `portal.users`. Si deja de ser
   * admin, sus casillas vuelven a aparecer con el valor que la columna tuviera
   * guardado — que es justo el que pasaría a aplicarle.
   */
  esAdminDelPortal: boolean;
}

/**
 * El maestro con el árbol resuelto. La derivación se hace AQUÍ y no en el
 * navegador para que la regla viva en un solo sitio: el admin ve exactamente lo
 * que se congelaría en una solicitud nueva, no una aproximación.
 */
export async function empleadosConJefatura(db: Pool): Promise<EmpleadoConJefatura[]> {
  const [empleados, enlaces, admins] = await Promise.all([
    repo.listarEmpleados(db),
    repo.enlacesActivos(db),
    repo.correosDeAdmin(db),
  ]);
  const porCorreo = new Map(enlaces.map((e) => [e.correo, e]));
  const enCiclo = new Set(detectarCiclos(construirIndice(enlaces)).flat());

  return empleados.map((e) => {
    // Por `jefeEfectivo` también, y no solo el alta: si no, el panel enseñaría a
    // la raíz del organigrama que se aprueba a sí misma mientras el alta la manda
    // a otro sitio. La derivación tiene que decir lo que de verdad va a pasar.
    const jefe = jefeEfectivo(e);
    const arriba = aprobadoresDe({ ...e, aprobadorCorreo: jefe }, porCorreo.get(jefe) ?? null);
    return {
      ...e,
      segundoAprobadorCorreo: arriba.segundo,
      informadoCorreo: arriba.informado,
      enCiclo: enCiclo.has(e.correo.toLowerCase()),
      // En minúsculas por los dos lados: el Set ya viene con `lower()` del SQL,
      // y el correo de la ficha lo escribe la hoja de Google sin garantía de
      // caja. Comparar en crudo dejaría a un admin con el correo en mayúsculas
      // fuera del conjunto y con sus tres casillas puestas otra vez — un fallo
      // que no rompe nada y que solo se nota mirando la fila de esa persona.
      esAdminDelPortal: admins.has(e.correo.toLowerCase()),
    };
  });
}

/**
 * Cambia el jefe inmediato de alguien.
 *
 * Autoasignarse es legítimo: así se declara la raíz del organigrama. Un ciclo se
 * rechaza al escribir (409), pero uno que YA esté en la base de datos no bloquea
 * la edición: si lo hiciera, sería imposible deshacerlo desde el panel.
 */
export async function fijarJefe(db: Pool, empleadoId: string, body: unknown): Promise<EmpleadoConJefatura> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof b.aprobadorCorreo !== 'string') throw new AusenciaError('jefe_requerido', 400, 'aprobadorCorreo');
  const jefe = b.aprobadorCorreo.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(jefe)) throw new AusenciaError('correo_invalido', 400, 'aprobadorCorreo');

  const empleado = await repo.empleadoPorId(db, empleadoId);
  if (!empleado) throw new AusenciaError('empleado_no_encontrado', 404);

  const enlaces = await repo.enlacesActivos(db);
  const conocido = enlaces.some((e) => e.correo === jefe);
  // El buzón por defecto se acepta aunque no tenga ficha de empleado: es de quien
  // cuelga toda la plantilla hoy, y rechazarlo dejaría el organigrama sin raíz.
  if (!conocido && jefe !== APROBADOR_POR_DEFECTO.toLowerCase()) {
    throw new AusenciaError('jefe_no_encontrado', 400, 'aprobadorCorreo');
  }
  if (creariaCiclo(construirIndice(enlaces), empleado.correo, jefe)) {
    throw new AusenciaError('ciclo_jerarquia', 409, 'aprobadorCorreo');
  }

  if (!(await repo.fijarJefe(db, empleadoId, jefe))) throw new AusenciaError('empleado_no_encontrado', 404);

  const actualizados = await empleadosConJefatura(db);
  const actualizado = actualizados.find((e) => e.id === empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}

/**
 * Fija a quién se pone en copia de los correos de alguien. `null` = a nadie.
 *
 * Se valida contra los empleados ACTIVOS, no solo el formato del correo: el
 * desplegable del panel solo ofrece personas de la plantilla, y aceptar aquí
 * cualquier cosa dejaría entrar erratas que mandarían los avisos al vacío sin
 * que nadie se enterara. No hay comprobación de ciclos, a diferencia del jefe:
 * esto no es un árbol y estar en copia no da ningún permiso.
 */
export async function fijarCopia(db: Pool, empleadoId: string, body: unknown): Promise<EmpleadoConJefatura> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const bruto = b.copiaCorreo;
  if (bruto !== null && typeof bruto !== 'string') {
    throw new AusenciaError('copia_invalida', 400, 'copiaCorreo');
  }

  const copia = typeof bruto === 'string' && bruto.trim() ? bruto.trim().toLowerCase() : null;
  if (copia !== null) {
    const enlaces = await repo.enlacesActivos(db);
    // El buzón por defecto se acepta aunque no tenga ficha activa, igual que
    // `APROBADOR_POR_DEFECTO` en `fijarJefe`: es el valor con el que la migración
    // 021 sembró toda la plantilla, y rechazarlo lo dejaría irreponible desde el
    // panel en cuanto su ficha se desactivara.
    if (!enlaces.some((e) => e.correo === copia) && copia !== COPIA_POR_DEFECTO.toLowerCase()) {
      throw new AusenciaError('copia_no_encontrada', 400, 'copiaCorreo');
    }
  }

  if (!(await repo.fijarCopia(db, empleadoId, copia))) throw new AusenciaError('empleado_no_encontrado', 404);

  const actualizados = await empleadosConJefatura(db);
  const actualizado = actualizados.find((e) => e.id === empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}

/**
 * Enciende o apaga la segunda firma de alguien.
 *
 * Sin registro de auditoría, al contrario que `fijarVisor`: esto no da acceso a
 * ningún dato personal, así que se queda al nivel del jefe y de la copia. Y sin
 * comprobación de ciclos, al contrario que `fijarJefe`: no se toca ninguna arista
 * del árbol, solo si el escalón de arriba firma o se limita a enterarse.
 *
 * Las solicitudes ya en vuelo no se mueven: llevan su reparto congelado del alta.
 */
export async function fijarSegundaFirma(
  db: Pool,
  empleadoId: string,
  body: unknown,
): Promise<EmpleadoConJefatura> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  // El tipo se exige, no se interpreta: `'no'` es una cadena con valor de verdad,
  // y aceptarla dejaría encendida una casilla que alguien quiso apagar.
  if (typeof b.requiereSegundaFirma !== 'boolean') {
    throw new AusenciaError('segunda_firma_invalida', 400, 'requiereSegundaFirma');
  }

  if (!(await repo.fijarSegundaFirma(db, empleadoId, b.requiereSegundaFirma))) {
    throw new AusenciaError('empleado_no_encontrado', 404);
  }

  const actualizados = await empleadosConJefatura(db);
  const actualizado = actualizados.find((e) => e.id === empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}

/**
 * Da o quita la llave maestra de los adjuntos, dejando constancia.
 *
 * Recibe la `Sesion` —al contrario que `fijarJefe` y `fijarCopia`— porque el
 * registro tiene que decir QUIÉN lo hizo. Es lo que sustituye al historial de
 * git desde que la lista dejó de vivir en `config.ts`.
 *
 * Si el valor no cambia no se escribe nada, ni en la tabla ni en el registro:
 * el botón del panel guarda la fila entera, así que llegaría aquí también
 * cuando lo tocado fuera el jefe o la copia.
 */
export async function fijarVisor(
  db: Pool,
  sesion: Sesion,
  empleadoId: string,
  body: unknown,
): Promise<EmpleadoConJefatura> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof b.veAdjuntos !== 'boolean') throw new AusenciaError('visor_invalido', 400, 'veAdjuntos');

  const empleado = await repo.empleadoPorId(db, empleadoId);
  if (!empleado) throw new AusenciaError('empleado_no_encontrado', 404);

  if (empleado.veAdjuntos !== b.veAdjuntos) {
    // Una sola llamada que da la llave Y la registra en la misma transacción:
    // ver el porqué en `repo.fijarVisorConRegistro`.
    if (
      !(await repo.fijarVisorConRegistro(db, {
        empleadoId,
        veAdjuntos: b.veAdjuntos,
        adminEmail: sesion.email,
        empleadoCorreo: empleado.correo,
      }))
    ) {
      throw new AusenciaError('empleado_no_encontrado', 404);
    }
  }

  const actualizados = await empleadosConJefatura(db);
  const actualizado = actualizados.find((e) => e.id === empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}

/**
 * Da o quita el permiso de exportar el registro, dejando constancia.
 *
 * Recibe la `Sesion` por lo mismo que `fijarVisor`: el registro tiene que decir
 * QUIÉN lo concedió. Exportar es sacar de la aplicación las incapacidades y los
 * permisos de la plantilla —con sus motivos— a un fichero que ya nadie
 * controla, así que quién dio esa llave es tan auditable como quién dio la de
 * los adjuntos.
 *
 * Sin el «si no cambia, no se escribe» de `fijarVisor`, y no por descuido: aquel
 * lo necesita porque su botón guarda la fila entera del panel y llegaría aquí
 * también al tocar el jefe o la copia. Este interruptor es propio y no
 * comparte botón con nada más, así que cada llamada ya es una decisión de
 * cambiar el permiso, no un efecto colateral de guardar otra cosa —no hace
 * falta el guard para evitar ruido. `exportaRegistro` ya viaja en `Empleado`
 * (ver `repo.ts`), así que si el panel acabara fusionando este botón con el
 * del resto de la fila, añadir el guard sería tan barato como en `fijarVisor`:
 * una comparación contra la ficha que ya trae `repo.empleadoPorId`, sin
 * consulta extra.
 *
 * Devuelve `{ ok: true }` y nada más —no la ficha, al contrario que `fijarVisor`—
 * porque el permiso no se pinta en la fila del maestro: quien lo cambia solo
 * necesita saber que cuajó. Los caminos que no cuajan salen por `AusenciaError`,
 * así que el `ok` nunca llega a ser `false`; el tipo lo admite para que añadir un
 * «no se pudo» no cambie el contrato del cliente.
 */
export async function fijarExportador(
  db: Pool,
  sesion: Sesion,
  empleadoId: string,
  body: { concedido?: unknown },
): Promise<{ ok: boolean }> {
  // El tipo se exige, no se interpreta, igual que en `fijarSegundaFirma`: `'no'`
  // es una cadena con valor de verdad, y aceptarla concedería el permiso que
  // alguien quiso quitar.
  const concedido = (body ?? {}).concedido;
  if (typeof concedido !== 'boolean') {
    throw new AusenciaError('exportador_invalido', 400, 'concedido');
  }

  // Una sola llamada que cambia el permiso Y lo registra en la misma
  // transacción: el porqué está en `repo.fijarExportador`.
  if (!(await repo.fijarExportador(db, sesion.email, empleadoId, concedido))) {
    // Ficha inexistente o inactiva. Las dos son un 404 para quien llama, y en
    // las dos el repo se ha guardado de escribir nada en la auditoría.
    throw new AusenciaError('empleado_no_encontrado', 404);
  }
  return { ok: true };
}

/**
 * Da o quita la vista de toda la empresa —el calendario y el registro—, dejando
 * constancia.
 *
 * Copia la forma de `fijarExportador` punto por punto, y no la de `fijarVisor`:
 * recibe la `Sesion` porque el registro tiene que decir QUIÉN lo concedió, exige
 * el booleano en vez de interpretarlo —`'no'` es una cadena con valor de verdad,
 * y aceptarla concedería el permiso que alguien quiso quitar— y devuelve
 * `{ ok: true }` en vez de la ficha, porque quien lo cambia solo necesita saber
 * que cuajó.
 *
 * Sin el «si no cambia, no se escribe» de `fijarVisor`, por lo mismo que su
 * gemelo de exportación: este interruptor no comparte endpoint con el resto de
 * la fila, así que cada llamada ya es una decisión de cambiar el permiso y no un
 * efecto colateral de guardar otra cosa. El panel llama solo si el valor cambió.
 */
export async function fijarVisorDeEmpresa(
  db: Pool,
  sesion: Sesion,
  empleadoId: string,
  body: { concedido?: unknown },
): Promise<{ ok: boolean }> {
  const concedido = (body ?? {}).concedido;
  if (typeof concedido !== 'boolean') {
    throw new AusenciaError('visor_empresa_invalido', 400, 'concedido');
  }

  // Una sola llamada que cambia el permiso Y lo registra en la misma
  // transacción: el porqué está en `repo.fijarVisorDeEmpresa`.
  if (!(await repo.fijarVisorDeEmpresa(db, sesion.email, empleadoId, concedido))) {
    // Ficha inexistente o inactiva. Las dos son un 404 para quien llama, y en
    // las dos el repo se ha guardado de escribir nada en la auditoría.
    throw new AusenciaError('empleado_no_encontrado', 404);
  }
  return { ok: true };
}

/**
 * Da o quita la llave del panel de KPIs (migración 038).
 *
 * Copia exacta de `fijarVisorDeEmpresa` de aquí arriba, y por los mismos
 * motivos: exige el booleano en vez de interpretarlo —`'no'` es una cadena con
 * valor de verdad, y aceptarla concedería el permiso que alguien quiso quitar—,
 * devuelve `{ ok: true }` porque quien lo cambia solo necesita saber que cuajó,
 * y delega en el repo el UPDATE y el registro en una sola transacción.
 *
 * Sirve para dar el panel a quien NO es administrador: a los que lo son se lo
 * da ya el rol, plegado en el contexto igual que las otras tres llaves.
 */
export async function fijarVisorDeKpis(
  db: Pool,
  sesion: Sesion,
  empleadoId: string,
  body: { concedido?: unknown },
): Promise<{ ok: boolean }> {
  const concedido = (body ?? {}).concedido;
  if (typeof concedido !== 'boolean') {
    throw new AusenciaError('visor_kpis_invalido', 400, 'concedido');
  }

  if (!(await repo.fijarVisorDeKpis(db, sesion.email, empleadoId, concedido))) {
    throw new AusenciaError('empleado_no_encontrado', 404);
  }
  return { ok: true };
}

// ── Panel de KPIs ──────────────────────────────────────────────────────────

/** Cuántos meses hacia atrás mira el KPI de tiempos de aprobación. */
const MESES_DE_VENTANA = 12;

/**
 * La ventana de la ESTACIONALIDAD, más larga que la de los demás a propósito.
 *
 * Con doce meses cada mes aparece una sola vez, y una serie así es descriptiva
 * —«esto pasó»— pero no estacional: no hay con qué comparar agosto. Con
 * veinticuatro se ve el mismo mes dos veces, que es el mínimo para empezar a
 * distinguir un patrón de una casualidad. Aprovecha además el histórico
 * importado de la hoja, que llega más atrás que el uso de la app.
 */
const MESES_DE_ESTACIONALIDAD = 24;

/**
 * Los dos umbrales de acumulación de vacaciones, EN DÍAS.
 *
 * No son números redondos por casualidad: esta app devenga 1,25 días al mes
 * (`DEVENGO_MENSUAL` en `saldo.ts`), o sea unos 15 al año. Así que 15 días de
 * saldo son UN AÑO sin disfrutar vacaciones —todavía corregible planificando— y
 * 30 son DOS, que ya es un problema que hay que gestionar.
 *
 * Quien los cambie debería pensarlos en años y mover los dos a la vez: el par
 * es el que separa «hay que hablarlo» de «hay que actuar».
 */
const UMBRAL_ACUMULACION_AVISO = 15;
const UMBRAL_ACUMULACION_ALARMA = 30;

export interface Kpis {
  /**
   * La deuda: cuántos días de vacaciones y de compensatorios tiene acumulados
   * la plantilla activa, sumados. Es la cifra que hoy no ve nadie —Saldos la
   * enseña persona a persona y nunca sumada—.
   */
  pasivo: {
    diasVacaciones: number;
    diasCompensatorios: number;
    /** Sobre cuántas fichas activas se ha sumado. Un total sin su denominador
     *  no se puede comparar con el del mes que viene. */
    empleados: number;
  };
  /**
   * Quién concentra ese pasivo. El total de arriba dice cuánto se debe; esto
   * dice a quién, que es lo único con lo que se puede hacer algo.
   */
  acumulacion: AcumulacionExcesiva;
  /**
   * Días de trabajo perdidos por incapacidad, mes a mes. La tendencia se lee de
   * la serie: aquí no se calcula ninguna pendiente ni media móvil, porque con
   * el histórico que hay una línea así invita a ver señal donde hay ruido.
   */
  absentismo: Absentismo;
  /**
   * Días de ausencia por mes y tipo, para ver cuándo se concentran. Su ventana
   * es MÁS LARGA que la del resto (ver `MESES_DE_ESTACIONALIDAD`), así que su
   * serie no se puede comparar mes a mes con la de `absentismo`.
   */
  estacionalidad: Estacionalidad;
  /**
   * Cuánto roce genera el proceso: rechazos, anulaciones y cambios de fecha.
   * Comparte ventana con `tiempos` —los dos miden el proceso de aprobación—.
   */
  friccion: Friccion;
  tiempos: TiempoDeAprobador[];
  pendientes: PendientesPorAntiguedad;
  /** El inicio de la ventana de `tiempos`, en ISO, para poder decirlo en la
   *  pantalla en vez de que el lector tenga que suponerlo. */
  desde: string;
  /**
   * El año que se está mirando, o `null` si es la ventana móvil por defecto.
   * Viaja de vuelta para que la pantalla sepa qué tiene seleccionado sin
   * guardarlo por su cuenta y arriesgarse a que discrepen.
   */
  anio: number | null;
  /** Los años que el selector puede ofrecer, del más reciente al más antiguo. */
  aniosDisponibles: number[];
}

/**
 * Los tres KPIs del panel.
 *
 * ⚠️ NO recibe `Sesion`, y es deliberado: esto es un agregado de la compañía
 * entera, no una vista recortada por quien pregunta. Quién puede pedirlo lo
 * decide el router ANTES de llamar aquí —rol de admin, o la llave `ve_kpis`—,
 * y ese sí es un candado de verdad: la respuesta lleva los datos dentro, así
 * que no basta con no pintar el botón.
 *
 * ⚠️ EL PASIVO SE REUTILIZA, NO SE RECALCULA. Sale del mismo `combinar()` que
 * alimenta la pestaña Saldos, y no de un `SUM()` en SQL, aunque un SUM sería
 * más corto. El motivo: `disponible` no es una columna, es el resultado de
 * `saldoCorte + devengado − disfrutado` con el devengo congelado ficha a ficha
 * (ver `saldo.ts`). Reescribir esa cuenta en SQL crearía una segunda verdad, y
 * el día que las dos pantallas discreparan nadie sabría cuál creer.
 */
export async function kpis(db: Pool, anio: number | null = null): Promise<Kpis> {
  const hoy = hoyEnColombia();

  // Las dos ventanas. Con `anio` las dos son ese año natural; sin él, cada una
  // mira sus meses (12 el general, 24 la estacionalidad — ver por qué en
  // `MESES_DE_ESTACIONALIDAD`).
  const general = ventanaDeKpis(anio, hoy, MESES_DE_VENTANA);
  const estacional = ventanaDeKpis(anio, hoy, MESES_DE_ESTACIONALIDAD);

  // `decisionesParaKpi` y `solicitudesParaFriccion` comparan contra
  // `created_at`, que es TIMESTAMPTZ: se les pasa el instante y no el día.
  const desdeIso = `${general.desde}T00:00:00Z`;

  const empleados = await repo.empleadosConSaldo(db, null, null);
  const [
    ausenciasDelSaldo,
    decisiones,
    pendientes,
    incapacidades,
    ausencias,
    paraFriccion,
    planificacion,
    aniosDisponibles,
  ] = await Promise.all([
      repo.ausenciasQueTocanElSaldo(
        db,
        empleados.map((e) => e.empleadoId),
      ),
      repo.decisionesParaKpi(db, desdeIso),
      repo.pendientesParaKpi(db),
      repo.incapacidadesParaKpi(db, general.desde, general.hasta),
      repo.ausenciasParaKpi(db, estacional.desde, estacional.hasta),
      repo.solicitudesParaFriccion(db, desdeIso),
      // La planificación NO se filtra por año: son las señales de HOY —cuánto
      // lleva sin descansar, qué tiene pedido—, igual que el pasivo y las
      // pendientes. Pasarle la ventana convertiría «no tiene nada previsto» en
      // «no tenía nada previsto en 2024», que no significa lo mismo.
      repo.planificacionDeVacaciones(db, hoy),
      repo.aniosConAusencias(db),
    ]);

  const saldos = combinar(empleados, ausenciasDelSaldo, hoy);
  const porEmpleado = new Map(planificacion.map((p) => [p.empleadoId, p]));

  return {
    pasivo: {
      diasVacaciones: redondearDias(saldos.reduce((t, s) => t + s.saldo.disponible, 0)),
      diasCompensatorios: redondearDias(saldos.reduce((t, s) => t + s.compensatorios.disponible, 0)),
      empleados: saldos.length,
    },
    // Sale de la MISMA lista `saldos` que el pasivo, sin consulta añadida: es
    // el mismo número desglosado por persona en vez de sumado, así que el
    // total de arriba y estas listas no pueden discrepar.
    acumulacion: acumulacionExcesiva(
      saldos.map((s) => {
        // Por `empleadoId` y no por posición: las dos listas salen de consultas
        // distintas y que vengan en el mismo orden es cierto hoy pero no lo
        // comprueba nadie. Equivocarse de fila aquí le atribuiría a alguien el
        // «lleva dos años sin vacaciones» de otro.
        const plan = porEmpleado.get(s.empleadoId);
        return {
          empleadoId: s.empleadoId,
          nombreCompleto: s.nombreCompleto,
          dias: s.saldo.disponible,
          // `?? null` y no `?? 0`: sin fila de planificación no sabemos cuándo
          // descansó, que no es lo mismo que saber que fue hoy.
          diasSinVacaciones: diasDesde(plan?.ultimasVacaciones ?? null, hoy),
          diasProgramados: plan?.diasProgramados ?? 0,
        };
      }),
      UMBRAL_ACUMULACION_AVISO,
      UMBRAL_ACUMULACION_ALARMA,
    ),
    // La serie va del primer mes de la ventana al mes en curso, incluido: el
    // mes actual sale a medias por definición, y esconderlo dejaría la gráfica
    // terminando siempre en el mes pasado.
    absentismo: absentismoPorMes(incapacidades, general.desde.slice(0, 7), general.hasta.slice(0, 7)),
    estacionalidad: estacionalidadPorMes(
      ausencias,
      estacional.desde.slice(0, 7),
      estacional.hasta.slice(0, 7),
    ),
    friccion: friccion(paraFriccion),
    tiempos: tiemposPorAprobador(decisiones),
    pendientes: pendientesPorAntiguedad(pendientes, new Date().toISOString()),
    desde: desdeIso,
    anio,
    aniosDisponibles,
  };
}

/**
 * El día 1 del mes que queda `meses` hacia atrás desde `hoy`.
 *
 * Va por `Date.UTC` con el día fijado en 1 y no restando meses a la fecha
 * completa: `setUTCMonth` sobre un día 31 desborda al mes siguiente —el 31 de
 * marzo menos un mes daría el 3 de marzo—, y aquí eso desplazaría el primer mes
 * de la serie sin más síntoma que una barra de menos.
 */
function primerDiaMesesAtras(hoy: string, meses: number): string {
  const [anio, mes] = hoy.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1 - meses, 1)).toISOString().slice(0, 10);
}

/**
 * Un decimal. Sumar cien `disponible` en coma flotante produce colas del tipo
 * `1234.5999999999999`, y esta cifra se lee como si fuera contable.
 */
function redondearDias(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Las dos bolsas de un empleado, listas para enseñar. */
export interface SaldoDeEmpleado {
  empleadoId: string;
  nombreCompleto: string;
  correo: string;
  saldo: SaldoVacaciones;
  compensatorios: SaldoCompensatorios;
}

/**
 * Reetiqueta con el correo Y con la bolsa el error de una fila corrupta.
 *
 * El cálculo lanza si alguna fecha viniera mal. Esto recorre a toda la plantilla,
 * así que sin el correo una sola fila mala dejaría la lista del admin a oscuras
 * sin decir de quién es el problema. Y ahora hay dos bolsas con dos fechas de
 * corte distintas: sin decir CUÁL de las dos envenenó la fila, el admin sabría a
 * quién mirar pero no qué columna arreglar.
 */
function conEtiqueta<T>(correo: string, bolsa: string, calcular: () => T): T {
  try {
    return calcular();
  } catch (err) {
    throw new Error(`saldo de ${bolsa} de ${correo}: ${(err as Error).message}`);
  }
}

/** Calcula las dos bolsas de cada empleado a partir de sus ausencias. */
function combinar(
  empleados: repo.EmpleadoConSaldo[],
  ausencias: repo.AusenciaDeEmpleado[],
  hoy: string,
): SaldoDeEmpleado[] {
  return empleados.map((e) => {
    // Una sola pasada por empleado: las dos bolsas miran la misma lista y cada
    // una descarta los tipos de la otra.
    const suyas = ausencias.filter((a) => a.empleadoId === e.empleadoId);
    // El «hoy» de ESTA ficha, no el de la pantalla: un retirado dejó de devengar
    // en su último día. Va aquí y no dentro de `calcularSaldo` porque el corte
    // es una propiedad del empleado, no del cálculo.
    const suHoy = hoyCongelado(e.fechaRetiro, hoy);
    const configVacaciones =
      e.saldoCorte !== null && e.fechaCorte !== null
        ? { saldoCorte: e.saldoCorte, fechaCorte: e.fechaCorte }
        : null;
    const configCompensatorios =
      e.compensatoriosSaldoCorte !== null && e.compensatoriosFechaCorte !== null
        ? { saldoCorte: e.compensatoriosSaldoCorte, fechaCorte: e.compensatoriosFechaCorte }
        : null;
    return {
      empleadoId: e.empleadoId,
      nombreCompleto: e.nombreCompleto,
      correo: e.correo,
      saldo: conEtiqueta(e.correo, 'vacaciones', () => calcularSaldo(configVacaciones, suyas, suHoy)),
      compensatorios: conEtiqueta(e.correo, 'compensatorios', () =>
        calcularSaldoCompensatorios(configCompensatorios, suyas, suHoy),
      ),
    };
  });
}

/**
 * Los saldos que esta sesión puede ver: todos si es admin, y solo los de la
 * gente que aprueba si no lo es.
 */
export async function saldosVisibles(db: Pool, sesion: Sesion): Promise<SaldoDeEmpleado[]> {
  // El `null` explícito es obligatorio: sin él, TypeScript ya no compila (ver
  // el porqué en el JSDoc de `empleadosConSaldo`).
  const empleados = await repo.empleadosConSaldo(db, sesion.esAdmin ? null : sesion.email, null);
  // Para quien no es admin, no aprobar a nadie es un 403. Para un admin, una
  // lista vacía es solo una lista vacía: la BD sin empleados todavía.
  if (!sesion.esAdmin && empleados.length === 0) throw new AusenciaError('no_es_aprobador', 403);
  const ausencias = await repo.ausenciasQueTocanElSaldo(
    db,
    empleados.map((e) => e.empleadoId),
  );
  return combinar(empleados, ausencias, hoyEnColombia());
}

/** Las dos bolsas de quien pregunta. Viajan juntas: la app siempre quiere las dos. */
export interface SaldosDeSesion {
  saldo: SaldoVacaciones;
  compensatorios: SaldoCompensatorios;
}

/**
 * Las bolsas del usuario logueado. Van dentro del contexto que carga la app.
 *
 * No comprueba que `empleado` sea el de la sesión que llama —no tiene con qué:
 * solo recibe la ficha, no la sesión—, así que esa garantía de privacidad vive
 * ENTERA en el llamante (que debe sacarla de `empleadoDeSesion`, nunca de un
 * id que decida el cliente). Pasarle la ficha de otro devuelve el saldo de ese
 * otro sin rechistar.
 */
export async function saldosDeSesion(db: repo.Consultable, empleado: Empleado): Promise<SaldosDeSesion> {
  const hoy = hoyEnColombia();
  const [fila] = await repo.empleadosConSaldo(db, null, empleado.id);
  // Sin fila —la ficha se desactivó después de que la sesión ya estuviera
  // abierta, por ejemplo— se devuelve un saldo en blanco en vez de lanzar:
  // esto viaja dentro del contexto que carga la app entera, y un 500 aquí
  // tumbaría toda la sesión por un dato que ni siquiera es crítico para poder
  // navegar.
  if (!fila) {
    return { saldo: calcularSaldo(null, [], hoy), compensatorios: calcularSaldoCompensatorios(null, [], hoy) };
  }
  const ausencias = await repo.ausenciasQueTocanElSaldo(db, [empleado.id]);
  const fusionada = combinar([fila], ausencias, hoy)[0];
  return { saldo: fusionada.saldo, compensatorios: fusionada.compensatorios };
}

/** Fija los puntos de corte de un empleado. Solo admin (lo exige el router). */
export async function fijarSaldo(db: Pool, empleadoId: string, body: unknown): Promise<SaldoDeEmpleado> {
  const { vacaciones, compensatorios } = validarSaldo(body);
  const existe = await repo.fijarSaldo(db, empleadoId, vacaciones, compensatorios);
  if (!existe) throw new AusenciaError('empleado_no_encontrado', 404);

  const empleados = await repo.empleadosConSaldo(db, null, empleadoId);
  // El 404 de arriba certifica que la fila existía y estaba activa en el
  // instante del UPDATE, pero este SELECT es una consulta aparte, sin
  // transacción que las una: entre una y otra, una desactivación concurrente
  // de ese mismo empleado dejaría `empleados` vacío. Sin esta guarda,
  // `combinar([], ...)[0]` sería `undefined` y el 404 correcto degradaría en
  // un 500 al intentar leer `.saldo` aguas arriba.
  if (empleados.length === 0) throw new AusenciaError('empleado_no_encontrado', 404);
  const ausencias = await repo.ausenciasQueTocanElSaldo(db, [empleadoId]);
  return combinar(empleados, ausencias, hoyEnColombia())[0];
}

// ── Calendario ─────────────────────────────────────────────────────────────

// ARQ-612 — en service/calendario.ts, las dos vistas con el alcance que
// comparten. Se reexporta todo.
export * from './service/calendario.js';

// ── Baja de un empleado ─────────────────────────────────────────────────────

/**
 * Registra la baja de un empleado: fija `fecha_retiro` tras comprobar que
 * nada la contradice. Solo admin.
 *
 * **Bloquea en vez de arreglar por su cuenta.** El saldo que `hoyCongelado`
 * calcula a partir de `fechaRetiro` es literalmente lo que se le paga a esa
 * persona en la liquidación, así que este servicio no puede tomar decisiones
 * sobre ausencias de otro: no cierra solicitudes ajenas ni recorta días para
 * que la fecha "encaje". Si algo choca, se lo dice al admin con el detalle
 * necesario para que lo resuelva a mano (rechazando o retirando la
 * solicitud, cambiando de jefe a quien la tiene a cargo) y vuelva a intentar
 * el retiro. El único que sí escribe es el barrido (`aplicarRetirosVencidos`),
 * que solo APAGA el acceso cuando la fecha ya fijada vence.
 *
 * Los días POSTERIORES a la fecha bloquean; los ANTERIORES no, y no es un
 * descuido: son legítimos. Quien se va el 30 de septiembre puede tener unas
 * vacaciones pendientes de firma para la semana anterior a esa fecha, y su
 * jefe tiene que poder firmarlas con normalidad — la bandeja de aprobación no
 * filtra por `activo`, así que nada se lo impide, y bloquear el retiro por
 * ellas sería inventar un problema donde no lo hay. La frontera exacta entre
 * "antes" y "después" la traza `repo.diasPosterioresA`.
 *
 * **Los dos bloqueos —días posteriores y personas a cargo— se informan
 * JUNTOS, en un solo 409, y nunca el primero que salte.** Cortocircuitar
 * dejaría a quien se topa con los dos enterarse de uno, arreglarlo, reintentar
 * y toparse con el otro. Y esa población no es rara: es el jefe que se va, que
 * tiene equipo por definición y suele tener vacaciones pendientes. Los dos
 * remedios además los ejecutan personas y pantallas distintas —rechazar o
 * retirar la solicitud vs. reasignar el equipo en Organigrama—, así que
 * descubrirlos de uno en uno puede costar días.
 *
 * ⚠️ No es transaccional: entre las dos comprobaciones y `fijarRetiro` puede
 * colarse una solicitud nueva o un cambio de jefe (dos `SELECT` sin `FOR
 * UPDATE`, ni las dos ni la escritura comparten conexión). Se acepta a
 * propósito, mismo criterio que `solapeDe`: el daño es leve porque aquí no se
 * congela nada en columnas —`hoyCongelado` deriva el saldo en cada cálculo, no
 * en el instante del retiro—, así que colarse solo caduca la comprobación de
 * este momento, no corrompe ningún dato, y la baja se puede deshacer con
 * `reactivarEmpleado` si hiciera falta.
 */
export async function retirarEmpleado(
  db: Pool,
  empleadoId: string,
  body: unknown,
  adminEmail: string,
): Promise<Empleado> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const fecha = typeof b.fechaRetiro === 'string' ? b.fechaRetiro.trim() : '';
  // `esFechaValida` y no un parseo laxo: 'YYYY-MM-DD' es el formato con el que
  // esta fecha se compara lexicográficamente contra otras (el barrido, el
  // congelado). Una '30/09/2026' compilaría y rompería esas comparaciones en
  // silencio, que es el gotcha que documenta `sumarDesdeElCorte`.
  if (!esFechaValida(fecha)) throw new AusenciaError('fecha_retiro_invalida', 400, 'fechaRetiro');

  const empleado = await repo.empleadoPorIdIncluyendoInactivos(db, empleadoId);
  if (!empleado) throw new AusenciaError('empleado_no_encontrado', 404);

  const posteriores = await repo.diasPosterioresA(db, empleadoId, fecha);
  const aCargo = await repo.personasACargoDe(db, empleado.correo);
  if (posteriores.length > 0 || aCargo.length > 0) {
    // Los DOS de una vez, y no el primero que salte: quien se topa con ambos es
    // el jefe que se va —tiene equipo por definicion y suele tener vacaciones
    // pendientes—, y los dos remedios se ejecutan en pantallas distintas. Decirle
    // solo uno le hace descubrir el otro despues de haberlo arreglado.
    throw new AusenciaError('retiro_bloqueado', 409, 'fechaRetiro', {
      solicitudes: posteriores,
      personas: aCargo,
    });
  }

  if (!(await repo.fijarRetiro(db, empleadoId, fecha, adminEmail))) {
    throw new AusenciaError('empleado_no_encontrado', 404);
  }
  // Se relee en vez de construir la respuesta a mano: `retirado_at` lo pone la
  // BD con NOW(), así que el único sitio donde está el valor real es la fila.
  const actualizado = await repo.empleadoPorIdIncluyendoInactivos(db, empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}

/**
 * Deshace una baja y devuelve la ficha a la lista de activos. Solo admin.
 *
 * `limpiarRetiro` borra `retirado_por`/`retirado_at` en la propia fila —así
 * es como "deshacer" tiene que funcionar, la ficha vuelve a nacer sin
 * retiro—, y eso deja la reactivación sin ningún rastro: la migración 035
 * documenta esas dos columnas como «la constancia de quién fijó ese número»,
 * y borrarlas sin dejar nada en su lugar convertiría a `reactivarEmpleado` en
 * la única operación de esta funcionalidad que BORRA auditoría en vez de
 * crearla. Por eso la ficha se lee ANTES de limpiar —después ya no queda
 * dónde consultar qué fecha tenía ni quién la había puesto— y se deja un
 * evento estructurado con esos datos, mismo patrón que
 * `ausencias_vacaciones_sin_saldo_configurado` más arriba.
 */
export async function reactivarEmpleado(db: Pool, empleadoId: string, adminEmail: string): Promise<Empleado> {
  const antes = await repo.empleadoPorIdIncluyendoInactivos(db, empleadoId);
  if (!antes) throw new AusenciaError('empleado_no_encontrado', 404);

  console.log(
    JSON.stringify({
      event: 'ausencias_baja_deshecha',
      timestamp: new Date().toISOString(),
      empleadoId,
      correo: antes.correo,
      fechaRetiroQueTenia: antes.fechaRetiro,
      retiradoPor: antes.retiradoPor,
      deshechoPor: adminEmail,
    }),
  );

  if (!(await repo.limpiarRetiro(db, empleadoId))) {
    throw new AusenciaError('empleado_no_encontrado', 404);
  }
  const actualizado = await repo.empleadoPorIdIncluyendoInactivos(db, empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}

/** Una ficha retirada, con lo que hace falta para liquidarla. */
export interface Retirado extends SaldoDeEmpleado {
  /** El último día que trabajó. `null` en las fichas apagadas a mano. */
  fechaRetiro: string | null;
  retiradoPor: string | null;
  /** Mientras sea > 0, el saldo de arriba todavía puede moverse. */
  solicitudesVivas: number;
  /**
   * True cuando la fecha de retiro es ANTERIOR al corte del saldo.
   * Aritméticamente da un devengo de cero y no revienta, pero casi siempre
   * significa que alguien se equivocó de año al teclear. Se avisa, no se
   * bloquea: puede ser legítimo, y no es esta pantalla quien debe decidirlo.
   */
  retiroAntesDelCorte: boolean;
}

/**
 * Las fichas retiradas con su saldo ya congelado. Solo admin (lo exige el router).
 *
 * Es la vista de liquidación: el `disponible` de cada fila es el número que se
 * le paga a esa persona. Por eso viaja acompañado de la constancia de quién
 * registró la baja y del recuento de solicitudes vivas — un número sin esas dos
 * cosas al lado se lee como definitivo cuando puede no serlo.
 */
export async function listaDeRetirados(db: Pool): Promise<Retirado[]> {
  const fichas = await repo.retiradosConSaldo(db);
  if (fichas.length === 0) return [];
  const ids = fichas.map((f) => f.empleadoId);
  const ausencias = await repo.ausenciasQueTocanElSaldo(db, ids);
  const vivas = await repo.solicitudesVivasDe(db, ids);
  // `combinar` ya congela ficha a ficha vía `hoyCongelado`: se le pasa el mismo
  // `hoy` a todas y cada una decide el suyo. No hay que congelar nada aquí.
  const conSaldo = combinar(fichas, ausencias, hoyEnColombia());
  // Por `empleadoId` y no por posición: que `combinar` devuelva la lista en el
  // mismo orden que la recibe es cierto hoy, pero es una invariante que no
  // comprueba nadie, y equivocarse de fila aquí le pondría a alguien la fecha
  // de retiro de otro justo en la pantalla desde la que se paga.
  const porId = new Map(fichas.map((f) => [f.empleadoId, f]));
  return conSaldo.map((s) => {
    const ficha = porId.get(s.empleadoId)!;
    return {
      ...s,
      fechaRetiro: ficha.fechaRetiro,
      retiradoPor: ficha.retiradoPor,
      solicitudesVivas: vivas.get(s.empleadoId) ?? 0,
      retiroAntesDelCorte:
        ficha.fechaRetiro !== null && s.saldo.configurado && ficha.fechaRetiro < s.saldo.fechaCorte,
    };
  });
}
