import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// Tests de integración HTTP del router de ausencias: guards de auth, códigos de
// error y el ciclo del outbox con n8n. El repositorio se sustituye por un doble
// in-memory — su SQL necesita un Postgres real, igual que el del resto del repo.

const SECRET = 'test-secret-ausencias';
process.env.JWT_SECRET = SECRET;
process.env.AUSENCIAS_CRON_TOKEN = 'cron-ausencias';
process.env.WO_SALES_CRON_TOKEN = 'cron-wo-sales';

// ── Doble del repositorio ──────────────────────────────────────────────────

interface EventoFalso {
  id: number;
  evento: string;
  solicitudId: string;
  intentos: number;
  payload: unknown;
  enviado: boolean;
  /** Instante del reloj falso en que se sirvió. `undefined` = nunca. */
  servidoEn?: number;
}

/** La misma reserva que el SQL (`RESERVA` en repo.ts), en milisegundos. */
const RESERVA_MS = 5 * 60 * 1000;

/**
 * La ficha de empleado tal como la devuelven `asegurarEmpleado` y compañía.
 *
 * Existe para que los fixtures NUEVOS se declaren con tipo en vez de heredar el
 * `any` de `estado.empleado` (línea de abajo): ese truco ya costó una vez 11
 * tests caídos sin que el build dijera nada, porque `any` apaga la comprobación
 * de todo lo que se construya esparciéndolo. El campo viejo se deja como está
 * —tiparlo obliga a un `!` en las catorce asignaciones que ya existen, ruido
 * ajeno a este cambio—, pero nada nuevo entra por ahí sin tipo.
 */
interface EmpleadoFalso {
  id: string;
  nombreCompleto: string;
  correo: string;
  cargo: string | null;
  credencial: number | null;
  aprobadorCorreo: string;
  requiereSegundaFirma: boolean;
  userId: string | null;
  activo: boolean;
  /** Los que el doble cuelga de la ficha para modelar otras columnas. */
  copiaCorreo?: string | null;
  veAdjuntos?: boolean;
  saldoCorte?: number | null;
  fechaCorte?: string | null;
}

/** Una propuesta de cambio, tal como sale de `portal.solicitud_modificaciones`. */
interface ModificacionFalsa {
  id: string;
  solicitudId: string;
  clase: string;
  estadoPrevio: string;
  fechaInicioPrevia: string;
  fechaFinPrevia: string;
  diasHabilesPrevios: number;
  fechaInicioNueva: string | null;
  fechaFinNueva: string | null;
  diasHabilesNuevos: number | null;
  motivo: string | null;
  estado: string;
  aprobadorCorreo: string;
  solicitanteEmail: string;
  decididaAt: string | null;
  motivoRechazo: string | null;
  createdAt: string;
}

const estado = {
  /** Reloj falso, para poder pasar por delante de la reserva sin esperar. */
  ahora: 0,
  empleado: null as any,
  /** Si el usuario de la sesión existe en portal.users (falso = token legacy). */
  usuarioEnPortal: true,
  altasAutomaticas: 0,
  plantilla: [] as any[],
  yaEnBd: 0,
  historicoInsertado: 0,
  solicitudes: [] as Record<string, unknown>[],
  /** Argumentos de la última llamada a `decidirSolicitud`, para fijar el cableado. */
  ultimaDecision: null as { estadoEsperado: string; transicion: Record<string, unknown> } | null,
  /** Ídem para `crearModificacion`: qué testigo de concurrencia le llegó. */
  ultimaAlta: null as Record<string, unknown> | null,
  eventos: [] as EventoFalso[],
  /** La tabla `portal.solicitud_modificaciones`. */
  modificaciones: [] as ModificacionFalsa[],
  /**
   * Simula que OTRO mueve la solicitud justo entre el SELECT del servicio y el
   * INSERT de la propuesta. Es la única forma de reproducir esa carrera contra
   * un doble en memoria: dos peticiones HTTP no llegan a solaparse aquí.
   */
  pisarEstadoAlCrearModificacion: null as string | null,
  adjuntos: new Map<string, Record<string, unknown>>(),
  seq: 0,
  registroVisores: [] as Record<string, unknown>[],
  /** Para simular que la escritura del registro (dentro de la transacción) falla. */
  fallarRegistroVisor: false,
};

vi.mock('./repo.js', () => ({
  empleadoDeUsuario: async () => estado.empleado,
  // Modela el alta automática: si no hay ficha pero el usuario existe en el
  // portal, se crea sola. `usuarioEnPortal: false` simula el token legacy.
  asegurarEmpleado: async (_db: unknown, userId: string | null, email: string) => {
    if (estado.empleado) return estado.empleado;
    if (!estado.usuarioEnPortal) return null;
    estado.empleado = {
      id: 'e-auto',
      nombreCompleto: 'Ana Ruiz',
      correo: email,
      cargo: null,
      credencial: null,
      aprobadorCorreo: 'comercial@ambientalia.com.co',
      // El alta automática no lo elige: la columna es NOT NULL DEFAULT TRUE, así
      // que quien se da de alta solo nace con la cascada completa.
      requiereSegundaFirma: true,
      userId,
      activo: true,
    };
    estado.altasAutomaticas += 1;
    return estado.empleado;
  },
  sincronizarDesdeUsuarios: async () => ({ creados: 3, vinculados: 1 }),
  // El histórico: `yaEnBd` simula filas que ya estaban (importadas antes o
  // creadas por el propio portal).
  importarHistorico: async (_db: unknown, filas: unknown[], dryRun: boolean) => {
    const nuevas = Math.max(0, filas.length - estado.yaEnBd);
    if (!dryRun) estado.historicoInsertado += nuevas;
    return { total: filas.length, importadas: nuevas, yaExistian: filas.length - nuevas };
  },
  todasLasSolicitudes: async () => estado.solicitudes,
  actualizarSolicitud: async (_db: unknown, id: string, campos: Record<string, unknown>) => {
    const s = estado.solicitudes.find((x) => x.id === id);
    if (!s || !estado.plantilla.some((e) => e.id === campos.empleadoId)) return null;
    Object.assign(s, {
      empleadoId: campos.empleadoId,
      tipo: campos.tipo,
      fechaInicio: campos.fechaInicio,
      fechaFin: campos.fechaFin,
      diasHabiles: campos.dias,
      estado: campos.estado,
      comentarios: campos.comentarios,
      observaciones: campos.observaciones,
    });
    return s;
  },
  borrarSolicitud: async (_db: unknown, id: string) => {
    const i = estado.solicitudes.findIndex((s) => s.id === id);
    if (i < 0) return null;
    return estado.solicitudes.splice(i, 1)[0];
  },
  // Las dos ramas del SQL real: ser jefe de alguien en el maestro, O tener una
  // firma pendiente. La segunda es la que sostiene la pestaña del segundo
  // aprobador cuando le desactivan el jefe intermedio.
  esAprobadorDeAlguien: async (_db: unknown, email: string) => {
    const yo = email.toLowerCase();
    if (estado.plantilla.some((e: any) => String(e.aprobadorCorreo).toLowerCase() === yo)) return true;
    if (yo === 'comercial@ambientalia.com.co') return true;
    return estado.solicitudes.some(
      (s) =>
        (s.estado === 'pendiente' || s.estado === 'pendiente_2') &&
        (String(s.aprobadorCorreo ?? '').toLowerCase() === yo ||
          String(s.segundoAprobadorCorreo ?? '').toLowerCase() === yo),
    );
  },
  listarEmpleados: async () => estado.plantilla,
  solicitudesDeEmpleado: async () => estado.solicitudes,
  // Filtra por TURNO, como el WHERE real: en `pendiente` la ve quien firma
  // primero y en `pendiente_2` quien firma después, nunca los dos a la vez.
  solicitudesPendientes: async (_db: unknown, correo: string, todas: boolean) =>
    estado.solicitudes.filter((s) => {
      if (s.estado !== 'pendiente' && s.estado !== 'pendiente_2') return false;
      if (todas) return true;
      const turno = s.estado === 'pendiente' ? s.aprobadorCorreo : s.segundoAprobadorCorreo;
      return String(turno ?? '').toLowerCase() === correo.toLowerCase();
    }),
  // Modela el WHERE real: estado terminal Y aparecer como firmante en cualquiera
  // de los dos niveles.
  solicitudesDecididas: async (_db: unknown, correo: string) =>
    estado.solicitudes.filter(
      (s) =>
        (s.estado === 'aprobada' || s.estado === 'rechazada') &&
        (String(s.aprobadorCorreo ?? '').toLowerCase() === correo.toLowerCase() ||
          String(s.segundoAprobadorCorreo ?? '').toLowerCase() === correo.toLowerCase()),
    ),
  solicitudPorId: async (_db: unknown, id: string) => estado.solicitudes.find((s) => s.id === id) ?? null,
  // Saldo: se lee de `estado.plantilla`, con `saldoCorte`/`fechaCorte` colgados
  // ahí mismo (empiezan `undefined` = "sin configurar"). `vacacionesDeEmpleados`
  // se deriva de `estado.solicitudes`, que ya trae `empleadoId`/`tipo`/etc. desde
  // el mock de `crearSolicitud`.
  empleadosConSaldo: async (_db: unknown, soloDe: string | null, empleadoId: string | null) =>
    estado.plantilla
      .filter((e: any) => soloDe === null || String(e.aprobadorCorreo).toLowerCase() === soloDe.toLowerCase())
      .filter((e: any) => empleadoId === null || e.id === empleadoId)
      .map((e: any) => ({
        empleadoId: e.id,
        nombreCompleto: e.nombreCompleto,
        correo: e.correo,
        saldoCorte: e.saldoCorte ?? null,
        fechaCorte: e.fechaCorte ?? null,
      })),
  vacacionesDeEmpleados: async (_db: unknown, ids: string[]) =>
    estado.solicitudes
      .filter((s: any) => s.tipo === 'vacaciones' && ids.includes(s.empleadoId as string))
      .map((s: any) => ({
        empleadoId: s.empleadoId,
        tipo: s.tipo,
        fechaInicio: s.fechaInicio,
        diasHabiles: s.diasHabiles,
        estado: s.estado,
      })),
  fijarSaldo: async (_db: unknown, empleadoId: string, saldoCorte: number | null, fechaCorte: string | null) => {
    const e = estado.plantilla.find((x: any) => x.id === empleadoId);
    if (!e) return false;
    e.saldoCorte = saldoCorte;
    e.fechaCorte = fechaCorte;
    return true;
  },
  empleadoPorId: async (_db: unknown, id: string) => estado.plantilla.find((e: any) => e.id === id) ?? null,
  // `estado.plantilla` se construye esparciendo `estado.empleado`, que no define
  // `veAdjuntos`: por defecto nadie es visor, igual que en el SQL real (la
  // columna nace en `false`). `e.activo !== false` y no `=== true`: ninguna otra
  // función de este doble modela «inactivo» con el campo `activo` (lo hacen
  // sacando la ficha entera de `estado.plantilla`, ver el `.filter` de más abajo
  // en el fichero), así que no hay un `=== true` que igualar; se deja abierta a
  // que una ficha futura omita el campo sin dejar de contar como activa.
  esVisorDeAdjuntos: async (_db: unknown, email: string) =>
    estado.plantilla.some(
      (e: any) =>
        String(e.correo).toLowerCase() === email.toLowerCase() && e.activo !== false && e.veAdjuntos === true,
    ),
  fijarJefe: async (_db: unknown, empleadoId: string, aprobadorCorreo: string) => {
    const e = estado.plantilla.find((x: any) => x.id === empleadoId);
    if (!e) return false;
    e.aprobadorCorreo = aprobadorCorreo;
    return true;
  },
  fijarCopia: async (_db: unknown, empleadoId: string, copia: string | null) => {
    const e = estado.plantilla.find((x: any) => x.id === empleadoId);
    if (!e) return false;
    e.copiaCorreo = copia;
    return true;
  },
  fijarSegundaFirma: async (_db: unknown, empleadoId: string, requiere: boolean) => {
    const e = estado.plantilla.find((x: any) => x.id === empleadoId);
    if (!e) return false;
    e.requiereSegundaFirma = requiere;
    return true;
  },
  // Una sola función para dar la llave Y registrarla, reflejando que en el
  // repo real las dos escrituras van en la misma transacción (`repo.
  // fijarVisorConRegistro`). El doble simula esa atomicidad: si toca fallar,
  // lanza ANTES de tocar la ficha, para que el test de atomicidad de más abajo
  // pueda comprobar que un fallo no deja la llave concedida a medias.
  fijarVisorConRegistro: async (
    _db: unknown,
    cambio: { empleadoId: string; veAdjuntos: boolean; adminEmail: string; empleadoCorreo: string },
  ) => {
    const e = estado.plantilla.find((x: any) => x.id === cambio.empleadoId);
    if (!e) return false;
    if (estado.fallarRegistroVisor) throw new Error('fallo simulado en fijarVisorConRegistro');
    e.veAdjuntos = cambio.veAdjuntos;
    estado.registroVisores.push({
      adminEmail: cambio.adminEmail,
      empleadoId: cambio.empleadoId,
      empleadoCorreo: cambio.empleadoCorreo,
      concedido: cambio.veAdjuntos,
    });
    return true;
  },
  crearSolicitud: async (
    _db: unknown,
    datos: Record<string, unknown>,
    adjunto: { nombreArchivo: string } | null,
    eventos: string[],
    construirPayload: (s: unknown, evento: string) => unknown,
  ) => {
    const s = {
      id: `s${++estado.seq}`,
      ...datos,
      empleadoNombre: 'Ana Ruiz',
      empleadoCargo: 'Analista',
      decididaAt: null,
      motivoRechazo: null,
      createdAt: '2026-06-01T10:00:00Z',
      adjunto: adjunto ? { id: `a${estado.seq}`, nombreArchivo: adjunto.nombreArchivo, mime: 'application/pdf', bytes: 10 } : null,
      // Los dos campos que el LEFT JOIN de `SELECT_SOLICITUD` añade a TODA
      // solicitud. Nacen vacíos, como en el SQL real.
      modificacionPendiente: null,
      anuladaAt: null,
    };
    estado.solicitudes.push(s);
    for (const evento of eventos) {
      estado.eventos.push({
        id: estado.eventos.length + 1,
        evento,
        solicitudId: s.id,
        intentos: 0,
        payload: construirPayload(s, evento),
        enviado: false,
      });
    }
    return s;
  },
  decidirSolicitud: async (
    _db: unknown,
    id: string,
    estadoEsperado: string,
    transicion: { estado: string; evento: string; esPrimeraFirma: boolean; esDecisionFinal: boolean },
    motivo: string | null,
    _userId: string | null,
    construirPayload: (s: unknown, evento: string) => unknown,
  ) => {
    estado.ultimaDecision = { estadoEsperado, transicion };
    const s = estado.solicitudes.find((x) => x.id === id);
    // Refleja el `WHERE id = $1 AND estado = $7` del UPDATE real: si alguien se
    // adelantó, no hay fila y el servicio lo traduce a 409. Comparar contra el
    // estado ESPERADO y no contra una lista es lo que hace que un doble clic del
    // jefe inmediato no encadene las dos firmas de golpe.
    if (!s || s.estado !== estadoEsperado) return null;
    s.estado = transicion.estado;
    s.motivoRechazo = motivo;
    if (transicion.esPrimeraFirma) s.primeraFirmaAt = '2026-06-02T10:00:00Z';
    if (transicion.esDecisionFinal) s.decididaAt = '2026-06-02T10:00:00Z';
    estado.eventos.push({
      id: estado.eventos.length + 1,
      evento: transicion.evento,
      solicitudId: id,
      intentos: 0,
      payload: construirPayload(s, transicion.evento),
      enviado: false,
    });
    return s;
  },
  // Modela las TRES garantías que el SQL real pone en una sola sentencia (ver
  // `repo.crearModificacion`), porque de ellas dependen los candados de abajo:
  //  1. el testigo `AND s.estado = $8`, comparado contra el estado que leyó el
  //     servicio y NO contra una lista de estados admisibles;
  //  2. el índice único parcial, que solo cuenta las propuestas `pendiente`;
  //  3. la foto previa resuelta desde la SOLICITUD, no desde lo que mande quien
  //     llama: si el servicio se inventara un `estado_previo`, aquí daría igual.
  crearModificacion: async (
    _db: unknown,
    datos: Record<string, unknown>,
    construirPayload: (s: unknown, m: unknown, evento: string) => unknown,
  ) => {
    estado.ultimaAlta = datos;
    // El adelanto de otra transacción, si el test lo ha programado: ocurre
    // DESPUÉS de que el servicio leyera la solicitud y ANTES del INSERT.
    if (estado.pisarEstadoAlCrearModificacion) {
      const s = estado.solicitudes.find((x) => x.id === datos.solicitudId);
      if (s) s.estado = estado.pisarEstadoAlCrearModificacion;
    }

    const s = estado.solicitudes.find((x) => x.id === datos.solicitudId);
    if (!s || s.estado !== datos.estadoEsperado) return { ok: false, razon: 'estado' };

    if (estado.modificaciones.some((m) => m.solicitudId === datos.solicitudId && m.estado === 'pendiente')) {
      return { ok: false, razon: 'duplicada' };
    }

    const modificacion: ModificacionFalsa = {
      id: `m${estado.modificaciones.length + 1}`,
      solicitudId: String(datos.solicitudId),
      clase: String(datos.clase),
      // La foto sale de la fila, como el SELECT de dentro del INSERT.
      estadoPrevio: String(s.estado),
      fechaInicioPrevia: String(s.fechaInicio),
      fechaFinPrevia: String(s.fechaFin),
      diasHabilesPrevios: Number(s.diasHabiles),
      fechaInicioNueva: (datos.fechaInicioNueva as string | null) ?? null,
      fechaFinNueva: (datos.fechaFinNueva as string | null) ?? null,
      diasHabilesNuevos: (datos.diasHabilesNuevos as number | null) ?? null,
      motivo: (datos.motivo as string | null) ?? null,
      estado: 'pendiente',
      aprobadorCorreo: String(datos.aprobadorCorreo),
      solicitanteEmail: String(s.solicitanteEmail),
      decididaAt: null,
      motivoRechazo: null,
      createdAt: '2026-06-20T10:00:00Z',
    };
    estado.modificaciones.push(modificacion);
    // El LEFT JOIN: desde ya, la solicitud viaja con su propuesta viva.
    s.modificacionPendiente = modificacion;

    estado.eventos.push({
      id: estado.eventos.length + 1,
      evento: 'modificacion_solicitada',
      solicitudId: String(datos.solicitudId),
      intentos: 0,
      payload: construirPayload(s, modificacion, 'modificacion_solicitada'),
      enviado: false,
    });
    return { ok: true, modificacion };
  },
  // El `AND estado = 'pendiente'` del UPDATE real: si el jefe la decidió entre
  // medias, su decisión gana y esto no devuelve fila.
  retirarModificacion: async (_db: unknown, id: string) => {
    const m = estado.modificaciones.find((x) => x.id === id);
    if (!m || m.estado !== 'pendiente') return null;
    m.estado = 'retirada';
    m.decididaAt = '2026-01-15T12:00:00Z';
    const s = estado.solicitudes.find((x) => x.id === m.solicitudId);
    // Sale del índice único parcial, así que deja de colgar del LEFT JOIN.
    if (s) s.modificacionPendiente = null;
    return m;
  },
  modificacionPorId: async (_db: unknown, id: string) => estado.modificaciones.find((m) => m.id === id) ?? null,
  /**
   * Modela la transacción entera de `repo.decidirModificacion`, y el ORDEN
   * importa tanto como el resultado:
   *
   *  1. `AND m.estado = 'pendiente'` — el doble clic no decide dos veces.
   *  2. El **testigo TRIPLE** (estado + las dos fechas) contra la fila de la
   *     solicitud, comprobado ANTES de tocar nada. Así es como este doble modela
   *     el ROLLBACK: en el repo real el paso 1 ya ha escrito cuando el paso 2 no
   *     encuentra fila, y solo deshacer la transacción impide que la propuesta
   *     quede «aprobada» sobre una solicitud sin cambiar —con su correo ya
   *     encolado anunciando un cambio que no ocurrió—. Decidir primero y mirar
   *     después dejaría pasar justo eso.
   *  3. El evento del outbox, dentro. Si no se llega al paso 3, no se encola.
   */
  decidirModificacion: async (
    _db: unknown,
    id: string,
    aprueba: boolean,
    motivoRechazo: string | null,
    _userId: string | null,
    construirPayload: (s: unknown, m: unknown, evento: string) => unknown,
  ) => {
    const m = estado.modificaciones.find((x) => x.id === id);
    if (!m || m.estado !== 'pendiente') return { ok: false, razon: 'ya_decidida' };

    const s = estado.solicitudes.find((x) => x.id === m.solicitudId);
    if (
      aprueba &&
      (!s ||
        s.estado !== m.estadoPrevio ||
        s.fechaInicio !== m.fechaInicioPrevia ||
        s.fechaFin !== m.fechaFinPrevia)
    ) {
      return { ok: false, razon: 'solicitud_cambio_de_estado' };
    }

    m.estado = aprueba ? 'aprobada' : 'rechazada';
    m.decididaAt = '2026-01-15T12:00:00Z';
    m.motivoRechazo = motivoRechazo;

    if (aprueba && s) {
      if (m.clase === 'anulacion') {
        // No estrena estado: `rechazada` + la marca de cuándo se anuló.
        s.estado = 'rechazada';
        s.anuladaAt = '2026-01-15T12:00:00Z';
        s.motivoRechazo = m.motivo;
      } else {
        // Las tres columnas del cambio de fechas. El `estado` NO se toca.
        s.fechaInicio = m.fechaInicioNueva;
        s.fechaFin = m.fechaFinNueva;
        s.diasHabiles = m.diasHabilesNuevos;
      }
    }
    // Decidida = fuera del índice único parcial, así que deja de colgar del JOIN.
    if (s) s.modificacionPendiente = null;

    const evento = aprueba ? 'modificacion_aprobada' : 'modificacion_rechazada';
    estado.eventos.push({
      id: estado.eventos.length + 1,
      evento,
      solicitudId: m.solicitudId,
      intentos: 0,
      payload: construirPayload(s, m, evento),
      enviado: false,
    });
    return { ok: true, modificacion: m, solicitud: s };
  },
  // El `WHERE m.id IS NOT NULL` del SQL, que se apoya en el LEFT JOIN: solo las
  // solicitudes con propuesta VIVA, filtradas por el decisor CONGELADO en ella.
  modificacionesPendientes: async (_db: unknown, correo: string, todas: boolean) =>
    estado.solicitudes.filter((s) => {
      const m = s.modificacionPendiente as ModificacionFalsa | null | undefined;
      return !!m && (todas || m.aprobadorCorreo.toLowerCase() === correo.toLowerCase());
    }),
  enlaceDe: async (_db: unknown, correo: string) => {
    const e = estado.plantilla.find((x: any) => String(x.correo).toLowerCase() === correo.toLowerCase());
    return e ? { correo: String(e.correo).toLowerCase(), aprobadorCorreo: String(e.aprobadorCorreo).toLowerCase() } : null;
  },
  nombreDeCorreo: async (_db: unknown, correo: string) =>
    estado.plantilla.find((e: any) => String(e.correo).toLowerCase() === correo.toLowerCase())?.nombreCompleto ?? null,
  enlacesActivos: async () =>
    estado.plantilla.map((e: any) => ({
      correo: String(e.correo).toLowerCase(),
      aprobadorCorreo: String(e.aprobadorCorreo).toLowerCase(),
    })),
  adjuntoPorId: async (_db: unknown, id: string) => estado.adjuntos.get(id) ?? null,
  // Modela el `WHERE a.id IS NOT NULL`: solo las solicitudes que llevan PDF.
  solicitudesConAdjunto: async () => estado.solicitudes.filter((s) => s.adjunto !== null),
  // Modela las dos mitades del SQL real: servir NO marca como enviado (el estado
  // solo avanza al confirmar, para que un fallo se recupere solo), pero SÍ
  // reserva la fila unos minutos, o dos disparadores casi simultáneos se
  // llevarían el mismo evento y el correo saldría dos veces.
  eventosPendientes: async () => {
    const pend = estado.eventos.filter(
      (e) => !e.enviado && (e.servidoEn === undefined || estado.ahora - e.servidoEn >= RESERVA_MS),
    );
    pend.forEach((e) => {
      e.intentos += 1;
      e.servidoEn = estado.ahora;
    });
    return pend.map(({ enviado: _e, servidoEn: _s, ...resto }) => resto);
  },
  confirmarEventos: async (_db: unknown, ids: number[]) => {
    let n = 0;
    for (const e of estado.eventos) {
      if (ids.includes(e.id) && !e.enviado) {
        e.enviado = true;
        n++;
      }
    }
    return n;
  },
  // Los dos modelan el `($N::uuid IS NULL OR ...)` del SQL: null = sin acotar.
  empleadosActivos: async (_db: unknown, soloEmpleadoId: string | null) =>
    [
      { id: 'e1', nombreCompleto: 'Ana Ruiz' },
      { id: 'e2', nombreCompleto: 'Beto Díaz' },
    ].filter((e) => soloEmpleadoId === null || e.id === soloEmpleadoId),
  ausenciasEntre: async (_db: unknown, _desde: string, _hasta: string, soloEmpleadoId: string | null) =>
    [
      {
        empleadoId: 'e1',
        tipo: 'vacaciones',
        estado: 'aprobada',
        fechaInicio: '2026-08-10',
        fechaFin: '2026-08-12',
      },
      {
        empleadoId: 'e2',
        tipo: 'permiso',
        estado: 'aprobada',
        fechaInicio: '2026-08-11',
        fechaFin: '2026-08-11',
      },
    ].filter((a) => soloEmpleadoId === null || a.empleadoId === soloEmpleadoId),
}));

const { createAusenciasRouter } = await import('./router.js');

// ── Utilidades ─────────────────────────────────────────────────────────────

function token(over: Record<string, unknown> = {}): string {
  // Sin `user_id`: requireAuth acepta los tokens legacy sin consultar la BD, lo
  // que nos deja probar el router sin montar un pool de usuarios.
  return jwt.sign({ sub: 'ana.ruiz@ambientalia.com.co', role: 'reader', apps: ['ausencias'], ...over }, SECRET);
}

function app() {
  const a = express();
  // Mismo orden que index.ts: el parser holgado de la ruta de creación va antes
  // que el global, o el de 2mb rechazaría el adjunto con un 413.
  a.use('/api/ausencias/solicitudes', express.json({ limit: '12mb' }));
  a.use(express.json({ limit: '2mb' }));
  a.use('/api', createAusenciasRouter({} as never));
  return a;
}

// Ids con forma de UUID: el validador de la edición la exige, para que un id
// con basura se quede en un 400 en vez de reventar el ::uuid del SQL con un 500.
const E1 = '11111111-1111-4111-8111-111111111111';
const E2 = '22222222-2222-4222-8222-222222222222';
const E_FANTASMA = '33333333-3333-4333-8333-333333333333';

const PDF = Buffer.from('%PDF-1.4 fake').toString('base64');
const nueva = (over: Record<string, unknown> = {}) => ({
  tipo: 'vacaciones',
  fechaInicio: '2026-07-06',
  fechaFin: '2026-07-10',
  ...over,
});

beforeEach(() => {
  // El reloj se congela en enero de 2026, antes que la más temprana de las
  // fechas que este fichero manda por POST (2026-03-30).
  //
  // Hace falta desde la regla de «no se piden días pasados»: las fechas de estos
  // tests son literales a propósito —caen en días concretos de la semana y
  // rodean festivos concretos, y de ahí salen los recuentos de días hábiles que
  // se afirman—, así que no se pueden volver relativas a hoy sin perder lo que
  // comprueban. Con el reloj real, en cambio, el servidor empezaría a
  // rechazarlas por «pasadas» en cuanto el calendario las dejara atrás.
  //
  // Se falsea SOLO `Date`: los temporizadores de verdad los necesita supertest
  // para resolver sus peticiones HTTP.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));

  estado.empleado = {
    id: 'e1',
    nombreCompleto: 'Ana Ruiz',
    correo: 'ana.ruiz@ambientalia.com.co',
    cargo: 'Analista',
    credencial: 1002,
    aprobadorCorreo: 'comercial@ambientalia.com.co',
    // Como el DEFAULT del SQL: quien no diga lo contrario firma en cascada. Sin
    // esto el campo llega `undefined` y todas las solicitudes de estos tests se
    // cerrarían con una firma, que es justo lo que NO están comprobando.
    requiereSegundaFirma: true,
    userId: null,
    activo: true,
  };
  estado.usuarioEnPortal = true;
  estado.altasAutomaticas = 0;
  estado.plantilla = [
    { ...(estado.empleado as Record<string, unknown>), id: E1, nombreCompleto: 'Ana Ruiz Molina' },
    { ...(estado.empleado as Record<string, unknown>), id: E2, nombreCompleto: 'Luis Prieto Cano' },
  ];
  estado.yaEnBd = 0;
  estado.historicoInsertado = 0;
  estado.solicitudes = [];
  estado.ultimaDecision = null;
  estado.ultimaAlta = null;
  estado.ahora = 0;
  estado.eventos = [];
  estado.modificaciones = [];
  estado.pisarEstadoAlCrearModificacion = null;
  estado.adjuntos = new Map();
  estado.seq = 0;
  estado.registroVisores = [];
  estado.fallarRegistroVisor = false;
});

// Sin esto, el reloj falso se filtraría a los ficheros de test que corran
// después en el mismo proceso.
afterEach(() => {
  vi.useRealTimers();
});

// ── Guards ─────────────────────────────────────────────────────────────────

describe('guards de la app', () => {
  it('401 sin token', async () => {
    await request(app()).get('/api/ausencias/mis-solicitudes').expect(401);
  });

  it('403 con token válido pero sin la app asignada', async () => {
    await request(app())
      .get('/api/ausencias/mis-solicitudes')
      .set('Authorization', `Bearer ${token({ apps: ['contabilidad'] })}`)
      .expect(403);
  });

  it('un usuario sin ficha se da de alta solo al pedir', async () => {
    // Tener la app asignada YA es el permiso; exigir además un alta manual solo
    // dejaba a la gente ante una pantalla sin formulario y sin explicación.
    estado.empleado = null;
    await request(app())
      .post('/api/ausencias/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send(nueva())
      .expect(201);
    expect(estado.altasAutomaticas).toBe(1);
  });

  it('403 solo si no hay de dónde sacar la ficha (token legacy sin usuario en BD)', async () => {
    estado.empleado = null;
    estado.usuarioEnPortal = false;
    const r = await request(app())
      .post('/api/ausencias/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send(nueva())
      .expect(403);
    expect(r.body.error).toBe('empleado_no_registrado');
  });

  it('el alta en bloque es solo para admin', async () => {
    await request(app())
      .post('/api/ausencias/empleados/sincronizar')
      .set('Authorization', `Bearer ${token()}`)
      .expect(403);

    const r = await request(app())
      .post('/api/ausencias/empleados/sincronizar')
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .expect(200);
    expect(r.body).toEqual({ creados: 3, vinculados: 1 });
  });

  it('el maestro de empleados es solo para admin', async () => {
    await request(app()).get('/api/ausencias/empleados').set('Authorization', `Bearer ${token()}`).expect(403);

    await request(app())
      .get('/api/ausencias/empleados')
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .expect(200);
  });
});

// ── Creación ───────────────────────────────────────────────────────────────

describe('POST /ausencias/solicitudes', () => {
  it('crea unas vacaciones con los días hábiles calculados en el servidor', async () => {
    // 6 al 10 de julio de 2026 es una semana de lunes a viernes sin festivos.
    const r = await request(app())
      .post('/api/ausencias/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send(nueva({ diasHabiles: 99 }))
      .expect(201);
    expect(r.body.diasHabiles).toBe(5);
    expect(r.body.estado).toBe('pendiente');
    expect(r.body.aprobadorCorreo).toBe('comercial@ambientalia.com.co');
  });

  it('descuenta los festivos del rango', async () => {
    // Semana Santa de 2026: jueves 2 y viernes 3 de abril son festivos.
    const r = await request(app())
      .post('/api/ausencias/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send(nueva({ fechaInicio: '2026-03-30', fechaFin: '2026-04-03' }))
      .expect(201);
    expect(r.body.diasHabiles).toBe(3);
  });

  it('400 al pedir días que ya pasaron', async () => {
    // El reloj de este fichero está congelado en 2026-01-15 (ver el beforeEach),
    // así que el 14 es ayer. Cubre el cableado entero —router → servicio→ error
    // HTTP—, no solo la función pura: el `min` del input es cómodo pero se puede
    // teclear por encima, y esto es lo que de verdad cierra la puerta.
    const r = await request(app())
      .post('/api/ausencias/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send(nueva({ fechaInicio: '2026-01-14', fechaFin: '2026-01-20' }))
      .expect(400);
    expect(r.body).toMatchObject({ error: 'fecha_en_pasado', field: 'fechaInicio' });
    // Y no deja rastro: ni solicitud ni evento que mandar por correo.
    expect(estado.eventos).toHaveLength(0);
  });

  it('una incapacidad SÍ puede ser de días pasados', async () => {
    // La excepción, por HTTP y no solo en la función pura: si alguien "unificara"
    // la regla para todos los tipos, el flujo normal de informar una incapacidad
    // —volver del médico y subir el soporte— dejaría de funcionar.
    await request(app())
      .post('/api/ausencias/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send(
        nueva({
          tipo: 'incapacidad',
          fechaInicio: '2026-01-08',
          fechaFin: '2026-01-09',
          adjunto: { nombreArchivo: 'i.pdf', mime: 'application/pdf', contenidoBase64: PDF },
        }),
      )
      .expect(201);
  });

  it('la incapacidad se registra sin pasar por aprobación', async () => {
    const r = await request(app())
      .post('/api/ausencias/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send(nueva({ tipo: 'incapacidad', adjunto: { nombreArchivo: 'i.pdf', mime: 'application/pdf', contenidoBase64: PDF } }))
      .expect(201);
    expect(r.body.estado).toBe('registrada');
    // Sin aprobador: si lo tuviera, aparecería en su bandeja de pendientes.
    expect(r.body.aprobadorCorreo).toBeNull();
    expect(estado.eventos[0].evento).toBe('registrada');
  });

  it('renombra el adjunto a la convención de Drive', async () => {
    const r = await request(app())
      .post('/api/ausencias/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send(nueva({ tipo: 'incapacidad', fechaInicio: '2026-07-06', adjunto: { nombreArchivo: 'escaneo (1).pdf', mime: 'application/pdf', contenidoBase64: PDF } }))
      .expect(201);
    expect(r.body.adjunto.nombreArchivo).toBe('Incapacidades_Ana_Ruiz_2026-07-06_1.pdf');
  });

  it('400 con su código de error cuando el cuerpo no es válido', async () => {
    const r = await request(app())
      .post('/api/ausencias/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send(nueva({ tipo: 'incapacidad' }))
      .expect(400);
    expect(r.body).toMatchObject({ error: 'adjunto_requerido', field: 'adjunto' });
  });

  it('acepta un cuerpo por encima de los 2mb del parser global', async () => {
    // Regresión del orden de middleware: si el parser global corriera primero,
    // esto sería un 413 y ninguna incapacidad escaneada podría subirse.
    const grande = Buffer.alloc(3 * 1024 * 1024, 7).toString('base64'); // 3 MB → 4 MB en base64
    await request(app())
      .post('/api/ausencias/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send(nueva({ tipo: 'incapacidad', adjunto: { nombreArchivo: 'i.pdf', mime: 'application/pdf', contenidoBase64: grande } }))
      .expect(201);
  });
});

// ── Aprobación ─────────────────────────────────────────────────────────────

describe('decisión', () => {
  async function crear() {
    const r = await request(app())
      .post('/api/ausencias/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send(nueva())
      .expect(201);
    return r.body.id as string;
  }

  const aprobador = () => token({ sub: 'comercial@ambientalia.com.co' });

  it('el aprobador la aprueba', async () => {
    const id = await crear();
    const r = await request(app())
      .post(`/api/ausencias/solicitudes/${id}/decision`)
      .set('Authorization', `Bearer ${aprobador()}`)
      .send({ aprueba: true })
      .expect(200);
    expect(r.body.estado).toBe('aprobada');
  });

  it('quien no es su aprobador recibe 403', async () => {
    const id = await crear();
    await request(app())
      .post(`/api/ausencias/solicitudes/${id}/decision`)
      .set('Authorization', `Bearer ${token({ sub: 'otro@ambientalia.com.co' })}`)
      .send({ aprueba: true })
      .expect(403);
  });

  it('409 al decidir dos veces — un doble clic no manda dos correos contradictorios', async () => {
    const id = await crear();
    await request(app()).post(`/api/ausencias/solicitudes/${id}/decision`).set('Authorization', `Bearer ${aprobador()}`).send({ aprueba: true }).expect(200);
    const r = await request(app()).post(`/api/ausencias/solicitudes/${id}/decision`).set('Authorization', `Bearer ${aprobador()}`).send({ aprueba: false }).expect(409);
    expect(r.body.error).toBe('ya_decidida');
    // Y solo se encoló UNA notificación de decisión (además de las del alta).
    expect(estado.eventos.filter((e) => e.evento === 'aprobada' || e.evento === 'rechazada')).toHaveLength(1);
  });

  it('404 si la solicitud no existe', async () => {
    await request(app())
      .post('/api/ausencias/solicitudes/no-existe/decision')
      .set('Authorization', `Bearer ${aprobador()}`)
      .send({ aprueba: true })
      .expect(404);
  });

  it('el rechazo guarda el motivo', async () => {
    const id = await crear();
    const r = await request(app())
      .post(`/api/ausencias/solicitudes/${id}/decision`)
      .set('Authorization', `Bearer ${aprobador()}`)
      .send({ aprueba: false, motivo: 'Coincide con el cierre contable' })
      .expect(200);
    expect(r.body.motivoRechazo).toBe('Coincide con el cierre contable');
  });

  it('la bandeja solo muestra lo que le toca a cada uno', async () => {
    await crear();
    const mias = await request(app()).get('/api/ausencias/pendientes').set('Authorization', `Bearer ${aprobador()}`).expect(200);
    expect(mias.body.solicitudes).toHaveLength(1);

    const ajenas = await request(app()).get('/api/ausencias/pendientes').set('Authorization', `Bearer ${token({ sub: 'otro@ambientalia.com.co' })}`).expect(200);
    expect(ajenas.body.solicitudes).toHaveLength(0);
  });

  it('el admin ve las pendientes de todo el mundo', async () => {
    await crear();
    const r = await request(app()).get('/api/ausencias/pendientes').set('Authorization', `Bearer ${token({ sub: 'admin@ambientalia.com.co', role: 'admin' })}`).expect(200);
    expect(r.body.solicitudes).toHaveLength(1);
  });
});

// ── Cascada de dos firmas ──────────────────────────────────────────────────

describe('aprobación en cascada', () => {
  const JEFA = 'jefa.directa@ambientalia.com.co';
  const GERENCIA = 'comercial@ambientalia.com.co';

  const jefa = () => token({ sub: JEFA });
  const gerencia = () => token({ sub: GERENCIA });

  beforeEach(() => {
    // Ana → Jefa → Gerencia. La ficha de la jefa TIENE que estar en la plantilla:
    // `enlaceDe` solo sube por fichas activas, y sin ella el árbol se cortaría en
    // el primer escalón.
    estado.empleado.aprobadorCorreo = JEFA;
    estado.plantilla.push({
      id: '44444444-4444-4444-8444-444444444444',
      nombreCompleto: 'Jefa Directa',
      correo: JEFA,
      cargo: 'Coordinadora',
      credencial: 900,
      aprobadorCorreo: GERENCIA,
      // También aquí: `empleadosConJefatura` pasa CADA ficha de la plantilla por
      // `aprobadoresDe`, así que sin el campo esta caería por la rama del
      // informado y su segunda firma desaparecería del maestro.
      requiereSegundaFirma: true,
      userId: null,
      activo: true,
    });
  });

  async function crear(over: Record<string, unknown> = {}) {
    const r = await request(app())
      .post('/api/ausencias/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send(nueva(over))
      .expect(201);
    return r.body as Record<string, unknown>;
  }

  const decidir = (id: string, quien: string, body: Record<string, unknown>) =>
    request(app())
      .post(`/api/ausencias/solicitudes/${id}/decision`)
      .set('Authorization', `Bearer ${quien}`)
      .send(body);

  it('el alta congela los dos firmantes', async () => {
    const s = await crear();
    expect(s.aprobadorCorreo).toBe(JEFA);
    expect(s.segundoAprobadorCorreo).toBe(GERENCIA);
  });

  it('el circuito completo: la primera firma sube, la segunda cierra', async () => {
    const s = await crear();
    const id = s.id as string;

    const primera = await decidir(id, jefa(), { aprueba: true }).expect(200);
    expect(primera.body.estado).toBe('pendiente_2');
    // Todavía NO está decidida: si `decididaAt` se sellara aquí, el registro
    // diría que se aprobó cuando solo se subió un escalón.
    expect(primera.body.decididaAt).toBeNull();
    expect(primera.body.primeraFirmaAt).not.toBeNull();
    // Y NO se ha encolado el correo de aprobada ni el evento de calendario.
    expect(estado.eventos.filter((e) => e.evento === 'aprobada')).toHaveLength(0);
    expect(estado.eventos.filter((e) => e.evento === 'aprobacion_2')).toHaveLength(1);

    const segunda = await decidir(id, gerencia(), { aprueba: true }).expect(200);
    expect(segunda.body.estado).toBe('aprobada');
    expect(segunda.body.decididaAt).not.toBeNull();
    expect(estado.eventos.filter((e) => e.evento === 'aprobada')).toHaveLength(1);
  });

  it('el aviso de la segunda firma va SOLO al segundo aprobador', async () => {
    const s = await crear();
    await decidir(s.id as string, jefa(), { aprueba: true }).expect(200);
    const aviso = estado.eventos.find((e) => e.evento === 'aprobacion_2');
    expect((aviso!.payload as any).correo.para).toBe(GERENCIA);
  });

  it('la segunda firma no toca calendario ni hoja: la solicitud aún no es firme', async () => {
    const s = await crear({ tipo: 'permiso', adjunto: { nombreArchivo: 'x.pdf', mime: 'application/pdf', contenidoBase64: PDF } });
    await decidir(s.id as string, jefa(), { aprueba: true }).expect(200);
    const p = estado.eventos.find((e) => e.evento === 'aprobacion_2')!.payload as any;
    expect(p.calendario).toBeNull();
    expect(p.hoja).toBeNull();
  });

  it('el UPDATE se condiciona al estado que se leyó, no a una lista', async () => {
    // Es lo que separa dos clics simultáneos del jefe: los dos leen `pendiente` y
    // los dos pasan el guard, así que lo único que impide que una sola persona
    // encadene `pendiente → pendiente_2 → aprobada` es que el UPDATE exija
    // exactamente el estado leído.
    //
    // No se puede probar de verdad desde aquí: dos peticiones por HTTP no llegan
    // a solaparse contra un doble en memoria, y el SQL real necesita Postgres.
    // Lo que sí se fija es el cableado — que el servicio pasa el estado que leyó,
    // en vez de un literal o una lista.
    const s = await crear();
    await decidir(s.id as string, jefa(), { aprueba: true }).expect(200);
    expect(estado.ultimaDecision).toMatchObject({
      estadoEsperado: 'pendiente',
      transicion: { estado: 'pendiente_2', evento: 'aprobacion_2' },
    });

    await decidir(s.id as string, gerencia(), { aprueba: true }).expect(200);
    expect(estado.ultimaDecision).toMatchObject({ estadoEsperado: 'pendiente_2' });
  });

  it('si otro se adelantó, la firma da 409 y no encola nada', async () => {
    const s = await crear();
    const id = s.id as string;
    await decidir(id, jefa(), { aprueba: true }).expect(200);
    const eventosAntes = estado.eventos.length;

    // Un admin pasa el guard en cualquier estado, así que llega hasta el UPDATE.
    // Se simula el adelanto cerrando la solicitud por debajo, como habría hecho
    // la petición que ganó la carrera.
    (estado.solicitudes.find((x) => x.id === id) as Record<string, unknown>).estado = 'aprobada';
    const r = await decidir(id, token({ sub: 'admin@ambientalia.com.co', role: 'admin' }), {
      aprueba: true,
    }).expect(409);
    expect(r.body.error).toBe('ya_decidida');
    expect(estado.eventos).toHaveLength(eventosAntes);
  });

  it('el segundo aprobador no se salta la cola', async () => {
    const s = await crear();
    await decidir(s.id as string, gerencia(), { aprueba: true }).expect(403);
  });

  it('tras subir, el jefe inmediato ya no puede firmar', async () => {
    const s = await crear();
    const id = s.id as string;
    await decidir(id, jefa(), { aprueba: true }).expect(200);
    await decidir(id, jefa(), { aprueba: false, motivo: 'me arrepiento' }).expect(403);
  });

  it('la bandeja cambia de dueño al subir de nivel', async () => {
    const s = await crear();
    const bandeja = async (quien: string) =>
      (await request(app()).get('/api/ausencias/pendientes').set('Authorization', `Bearer ${quien}`).expect(200)).body
        .solicitudes;

    expect(await bandeja(jefa())).toHaveLength(1);
    expect(await bandeja(gerencia())).toHaveLength(0);

    await decidir(s.id as string, jefa(), { aprueba: true }).expect(200);

    expect(await bandeja(jefa())).toHaveLength(0);
    expect(await bandeja(gerencia())).toHaveLength(1);
  });

  it('a cada firmante se le marca como suya solo la que le toca', async () => {
    // `esMiTurno` es lo que deja separar en la bandeja lo que uno tiene que
    // firmar de lo que solo puede destrabar. Para quien no es admin siempre es
    // true —la consulta ya filtra por turno—, pero se fija aquí porque de ese
    // campo depende que los botones aparezcan donde deben.
    const s = await crear();
    const bandeja = async (quien: string) =>
      (await request(app()).get('/api/ausencias/pendientes').set('Authorization', `Bearer ${quien}`).expect(200)).body
        .solicitudes;

    expect((await bandeja(jefa()))[0].esMiTurno).toBe(true);
    await decidir(s.id as string, jefa(), { aprueba: true }).expect(200);
    expect((await bandeja(gerencia()))[0].esMiTurno).toBe(true);
  });

  it('el admin ve los dos niveles en su bandeja, y ninguno es su turno', async () => {
    const a = await crear();
    const b = await crear({ fechaInicio: '2026-08-03', fechaFin: '2026-08-05' });
    await decidir(a.id as string, jefa(), { aprueba: true }).expect(200);
    const r = await request(app())
      .get('/api/ausencias/pendientes')
      .set('Authorization', `Bearer ${token({ sub: 'admin@ambientalia.com.co', role: 'admin' })}`)
      .expect(200);
    expect(r.body.solicitudes).toHaveLength(2);
    expect(r.body.solicitudes.map((s: any) => s.estado).sort()).toEqual(['pendiente', 'pendiente_2']);
    // Ninguna de las dos le toca a él: las ve por ser admin, para poder
    // destrabarlas. Sin esta marca, la bandeja no puede distinguir el trabajo
    // propio del rescate y ofrece los botones como si le tocara firmar.
    expect(r.body.solicitudes.every((s: any) => s.esMiTurno === false)).toBe(true);
    expect(b.id).toBeTruthy();
  });

  it('el admin destraba avanzando un escalón, no saltando al final', async () => {
    const s = await crear();
    const r = await decidir(s.id as string, token({ sub: 'admin@ambientalia.com.co', role: 'admin' }), {
      aprueba: true,
    }).expect(200);
    expect(r.body.estado).toBe('pendiente_2');
  });

  it('un rechazo en el segundo nivel es terminal y guarda el motivo', async () => {
    const s = await crear();
    const id = s.id as string;
    await decidir(id, jefa(), { aprueba: true }).expect(200);
    const r = await decidir(id, gerencia(), { aprueba: false, motivo: 'Coincide con el cierre' }).expect(200);
    expect(r.body.estado).toBe('rechazada');
    expect(r.body.motivoRechazo).toBe('Coincide con el cierre');
    expect(estado.eventos.filter((e) => e.evento === 'rechazada')).toHaveLength(1);
  });

  it('sin jefe del jefe basta una firma: el organigrama vacío no atasca a nadie', async () => {
    // Es el estado del día del despliegue, cuando todo el mundo cuelga aún del
    // buzón por defecto. Si esto mandara todo a `pendiente_2`, media plantilla se
    // quedaría esperando una firma que nadie tiene asignada.
    estado.empleado.aprobadorCorreo = GERENCIA;
    const s = await crear();
    expect(s.segundoAprobadorCorreo).toBeNull();
    const r = await decidir(s.id as string, gerencia(), { aprueba: true }).expect(200);
    expect(r.body.estado).toBe('aprobada');
  });

  it('el segundo aprobador puede abrir el PDF antes de que sea su turno', async () => {
    // La ruta devuelve 404 y no 403, así que sin esto tendría que firmar un
    // permiso sin poder abrir su soporte y sin ninguna pista de por qué.
    estado.adjuntos.set('a1', {
      solicitudId: 's1',
      solicitanteEmail: 'ana.ruiz@ambientalia.com.co',
      aprobadorCorreo: JEFA,
      segundoAprobadorCorreo: GERENCIA,
      nombreArchivo: 'Permisos_Ana_Ruiz_2026-07-06_1.pdf',
      mime: 'application/pdf',
      contenido: Buffer.from('%PDF-1.4 fake'),
    });
    await request(app()).get('/api/ausencias/adjuntos/a1').set('Authorization', `Bearer ${gerencia()}`).expect(200);
    await request(app())
      .get('/api/ausencias/adjuntos/a1')
      .set('Authorization', `Bearer ${token({ sub: 'curioso@ambientalia.com.co' })}`)
      .expect(404);
  });

  it('la pestaña sigue apareciendo si desactivan al jefe intermedio', async () => {
    const s = await crear();
    await decidir(s.id as string, jefa(), { aprueba: true }).expect(200);
    // La jefa desaparece del maestro: gerencia ya no es jefe de nadie, pero tiene
    // una firma pendiente. Sin la segunda rama de `esAprobadorDeAlguien` perdería
    // la pestaña y la solicitud quedaría muerta.
    estado.plantilla = estado.plantilla.filter((e: any) => e.correo !== JEFA);
    estado.empleado.aprobadorCorreo = 'nadie@ambientalia.com.co';
    const r = await request(app())
      .get('/api/ausencias/contexto')
      .set('Authorization', `Bearer ${gerencia()}`)
      .expect(200);
    expect(r.body.esAprobador).toBe(true);
  });
});

// ── La segunda firma, apagada por ficha ────────────────────────────────────

describe('la segunda firma se puede apagar por ficha', () => {
  const JEFA = 'jefa.directa@ambientalia.com.co';
  const GERENCIA = 'comercial@ambientalia.com.co';

  beforeEach(() => {
    // Ana → Jefa → Gerencia. La ficha de la jefa TIENE que estar en la plantilla:
    // `enlaceDe` solo sube por fichas activas.
    estado.empleado.aprobadorCorreo = JEFA;
    estado.plantilla.push({
      id: '55555555-5555-4555-8555-555555555555',
      nombreCompleto: 'Jefa Directa',
      correo: JEFA,
      cargo: 'Coordinadora',
      credencial: 900,
      aprobadorCorreo: GERENCIA,
      requiereSegundaFirma: true,
      userId: null,
      activo: true,
    });
  });

  const crear = async () =>
    (
      await request(app())
        .post('/api/ausencias/solicitudes')
        .set('Authorization', `Bearer ${token()}`)
        .send(nueva())
        .expect(201)
    ).body as Record<string, unknown>;

  it('con la casilla apagada, el alta congela al informado y a ningún segundo firmante', async () => {
    estado.empleado.requiereSegundaFirma = false;
    const s = await crear();
    expect(s.aprobadorCorreo).toBe(JEFA);
    expect(s.segundoAprobadorCorreo).toBeNull();
    expect(s.informadoCorreo).toBe(GERENCIA);
  });

  it('con la casilla encendida hay segunda firma y nadie a quien informar', async () => {
    estado.empleado.requiereSegundaFirma = true;
    const s = await crear();
    expect(s.segundoAprobadorCorreo).toBe(GERENCIA);
    expect(s.informadoCorreo).toBeNull();
  });

  it('la primera firma cierra la solicitud cuando la casilla está apagada', async () => {
    // El comportamiento que justifica el diseño entero: con `segundo` en null, la
    // máquina de estados ya cierra en la primera firma sin tocarla.
    estado.empleado.requiereSegundaFirma = false;
    const s = await crear();
    const r = await request(app())
      .post(`/api/ausencias/solicitudes/${s.id}/decision`)
      .set('Authorization', `Bearer ${token({ sub: JEFA })}`)
      .send({ aprueba: true })
      .expect(200);
    expect(r.body.estado).toBe('aprobada');
    expect(r.body.decididaAt).not.toBeNull();
    // Y no se encola ningún aviso de segunda firma: no hay segunda firma.
    expect(estado.eventos.filter((e) => e.evento === 'aprobacion_2')).toHaveLength(0);
  });

  it('el de segundo nivel no puede firmar una solicitud que ya no le toca', async () => {
    // Candado. Si `informadoCorreo` acabara alguna vez leyéndose como firmante,
    // esto se pondría rojo — que es justo lo que hay que impedir.
    estado.empleado.requiereSegundaFirma = false;
    const s = await crear();
    await request(app())
      .post(`/api/ausencias/solicitudes/${s.id}/decision`)
      .set('Authorization', `Bearer ${token({ sub: GERENCIA })}`)
      .send({ aprueba: true })
      .expect(403);
  });

  it.each([true, false])(
    'una incapacidad no congela ni firmante ni informado (casilla: %s)',
    async (requiereSegundaFirma) => {
      // Las incapacidades se INFORMAN, no se aprueban: dejar aquí a alguien la
      // haría aparecer en una bandeja de pendientes que nadie tiene que atender.
      // La casilla no interviene siquiera —`requiereAprobacion` corta antes—, y
      // por eso se prueban los dos valores: para que ese corte quede fijado.
      // Su aviso a gerencia sale por `COPIA_INCAPACIDADES`, que esto no toca.
      estado.empleado.requiereSegundaFirma = requiereSegundaFirma;
      const s = (
        await request(app())
          .post('/api/ausencias/solicitudes')
          .set('Authorization', `Bearer ${token()}`)
          .send(
            nueva({
              tipo: 'incapacidad',
              adjunto: { nombreArchivo: 'i.pdf', mime: 'application/pdf', contenidoBase64: PDF },
            }),
          )
          .expect(201)
      ).body;
      expect(s.estado).toBe('registrada');
      expect(s.aprobadorCorreo).toBeNull();
      expect(s.segundoAprobadorCorreo).toBeNull();
      expect(s.informadoCorreo).toBeNull();
    },
  );

  it('el maestro dice quién es el de segundo nivel aunque no firme', async () => {
    // Si esto devolviera null, el panel pintaría «una sola firma» donde sí hay
    // alguien arriba, y ocultaría justo lo que esta feature quiere hacer visible.
    estado.plantilla[0].aprobadorCorreo = JEFA;
    estado.plantilla[0].requiereSegundaFirma = false;
    const r = await request(app())
      .get('/api/ausencias/empleados')
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .expect(200);
    const ana = r.body.empleados.find((e: any) => e.id === E1);
    expect(ana.segundoAprobadorCorreo).toBeNull();
    expect(ana.informadoCorreo).toBe(GERENCIA);
    expect(ana.requiereSegundaFirma).toBe(false);
  });
});

// ── Adjuntos para administración ───────────────────────────────────────────

describe('GET /ausencias/adjuntos', () => {
  const visor = () => token({ sub: 'administrativo@ambientalia.com.co' });

  async function crearConPdf() {
    return (
      await request(app())
        .post('/api/ausencias/solicitudes')
        .set('Authorization', `Bearer ${token()}`)
        .send(nueva({ tipo: 'incapacidad', adjunto: { nombreArchivo: 'i.pdf', mime: 'application/pdf', contenidoBase64: PDF } }))
        .expect(201)
    ).body;
  }

  const lista = async (quien: string) =>
    (await request(app()).get('/api/ausencias/adjuntos').set('Authorization', `Bearer ${quien}`).expect(200)).body
      .solicitudes;

  it('devuelve SOLO las solicitudes que llevan PDF', async () => {
    // El mutante que muere: olvidar el `WHERE a.id IS NOT NULL` y devolver el
    // registro entero — que es justo la fuga que esta pestaña quería evitar,
    // porque quien la abre no es admin y no debería ver el resto.
    estado.plantilla[0].correo = 'administrativo@ambientalia.com.co';
    estado.plantilla[0].veAdjuntos = true;
    await crearConPdf();
    await request(app()).post('/api/ausencias/solicitudes').set('Authorization', `Bearer ${token()}`).send(nueva()).expect(201);

    const r = await lista(visor());
    expect(r).toHaveLength(1);
    expect(r[0].adjunto).not.toBeNull();
  });

  it('un admin también la ve', async () => {
    await crearConPdf();
    expect(await lista(token({ sub: 'admin@ambientalia.com.co', role: 'admin' }))).toHaveLength(1);
  });

  it('un empleado normal recibe 403', async () => {
    await request(app())
      .get('/api/ausencias/adjuntos')
      .set('Authorization', `Bearer ${token({ sub: 'ana.ruiz@ambientalia.com.co' })}`)
      .expect(403);
  });

  it('403 a quien tiene token válido pero no la app asignada', async () => {
    // Con el `sub` de un visor real, para que la única razón posible del 403 sea
    // la app que falta y no la lista.
    estado.plantilla[0].correo = 'administrativo@ambientalia.com.co';
    estado.plantilla[0].veAdjuntos = true;
    await request(app())
      .get('/api/ausencias/adjuntos')
      .set('Authorization', `Bearer ${token({ sub: 'administrativo@ambientalia.com.co', apps: ['contabilidad'] })}`)
      .expect(403);
  });

  it('el visor descarga el PDF de una incapacidad ajena', async () => {
    // La feature entera: una incapacidad no pasa por ninguna bandeja ni por el
    // historial, así que sin esto administración no tenía dónde abrirla.
    estado.plantilla[0].correo = 'administrativo@ambientalia.com.co';
    estado.plantilla[0].veAdjuntos = true;
    estado.adjuntos.set('a1', {
      solicitudId: 's1',
      solicitanteEmail: 'ana.ruiz@ambientalia.com.co',
      aprobadorCorreo: null,
      segundoAprobadorCorreo: null,
      nombreArchivo: 'Incapacidades_Ana_Ruiz_2026-07-06_1.pdf',
      mime: 'application/pdf',
      contenido: Buffer.from('%PDF-1.4 fake'),
    });
    const r = await request(app()).get('/api/ausencias/adjuntos/a1').set('Authorization', `Bearer ${visor()}`).expect(200);
    expect(r.headers['content-type']).toContain('application/pdf');
  });
});

// ── Historial del aprobador ────────────────────────────────────────────────

describe('GET /ausencias/decididas', () => {
  const aprobador = () => token({ sub: 'comercial@ambientalia.com.co' });

  async function crearYDecidir(aprueba: boolean) {
    const r = await request(app())
      .post('/api/ausencias/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send(nueva())
      .expect(201);
    await request(app())
      .post(`/api/ausencias/solicitudes/${r.body.id}/decision`)
      .set('Authorization', `Bearer ${aprobador()}`)
      .send({ aprueba, motivo: aprueba ? undefined : 'no toca' })
      .expect(200);
    return r.body.id as string;
  }

  const decididas = async (quien: string) =>
    (await request(app()).get('/api/ausencias/decididas').set('Authorization', `Bearer ${quien}`).expect(200)).body
      .solicitudes;

  it('lista lo aprobado y lo rechazado, no lo que sigue pendiente', async () => {
    await crearYDecidir(true);
    await crearYDecidir(false);
    await request(app())
      .post('/api/ausencias/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send(nueva())
      .expect(201);

    const r = await decididas(aprobador());
    expect(r).toHaveLength(2);
    expect(r.map((s: { estado: string }) => s.estado).sort()).toEqual(['aprobada', 'rechazada']);
  });

  it('el rechazo conserva su motivo, que es media razón de existir del historial', async () => {
    await crearYDecidir(false);
    const r = await decididas(aprobador());
    expect(r[0].motivoRechazo).toBe('no toca');
  });

  it('no enseña las decisiones de otro aprobador', async () => {
    await crearYDecidir(true);
    expect(await decididas(token({ sub: 'otro@ambientalia.com.co' }))).toHaveLength(0);
  });

  it('a un admin le enseña lo suyo, no la empresa entera', async () => {
    // Para verlo todo está «Registro general»: duplicarlo aquí sería un peor
    // registro general y una sorpresa para quien abra la pestaña.
    await crearYDecidir(true);
    expect(await decididas(token({ sub: 'admin@ambientalia.com.co', role: 'admin' }))).toHaveLength(0);
  });

  it('403 a quien tiene token válido pero no la app asignada', async () => {
    await request(app())
      .get('/api/ausencias/decididas')
      .set('Authorization', `Bearer ${token({ apps: [] })}`)
      .expect(403);
  });
});

// ── Organigrama ────────────────────────────────────────────────────────────

describe('PUT /ausencias/empleados/:id/jefe', () => {
  const GERENCIA = 'comercial@ambientalia.com.co';
  const admin = () => token({ sub: 'admin@ambientalia.com.co', role: 'admin' });

  const fijar = (id: string, body: Record<string, unknown>, quien = admin()) =>
    request(app()).put(`/api/ausencias/empleados/${id}/jefe`).set('Authorization', `Bearer ${quien}`).send(body);

  beforeEach(() => {
    // E1 y E2 comparten correo en el `beforeEach` global (son copias de la misma
    // ficha), y aquí hace falta que sean personas distintas para poder encadenar.
    estado.plantilla[0].correo = 'ana.ruiz@ambientalia.com.co';
    estado.plantilla[1].correo = 'luis.prieto@ambientalia.com.co';
  });

  it('un no-admin no toca el organigrama', async () => {
    await fijar(E1, { aprobadorCorreo: GERENCIA }, token()).expect(403);
  });

  it('404 si el empleado no existe', async () => {
    await fijar(E_FANTASMA, { aprobadorCorreo: GERENCIA }).expect(404);
  });

  it('400 si el correo no tiene forma de correo', async () => {
    const r = await fijar(E1, { aprobadorCorreo: 'no-es-un-correo' }).expect(400);
    expect(r.body.error).toBe('correo_invalido');
  });

  it('400 si el jefe no está en el maestro', async () => {
    const r = await fijar(E1, { aprobadorCorreo: 'fantasma@ambientalia.com.co' }).expect(400);
    expect(r.body.error).toBe('jefe_no_encontrado');
  });

  it('acepta el buzón por defecto aunque no tenga ficha de empleado', async () => {
    // Es de quien cuelga toda la plantilla hoy. Rechazarlo dejaría el organigrama
    // sin raíz posible.
    estado.plantilla.forEach((e: any) => (e.aprobadorCorreo = 'ana.ruiz@ambientalia.com.co'));
    await fijar(E2, { aprobadorCorreo: GERENCIA }).expect(200);
  });

  it('autoasignarse es como se declara la raíz, no un ciclo', async () => {
    const r = await fijar(E1, { aprobadorCorreo: 'ana.ruiz@ambientalia.com.co' }).expect(200);
    expect(r.body.aprobadorCorreo).toBe('ana.ruiz@ambientalia.com.co');
    expect(r.body.segundoAprobadorCorreo).toBeNull();
  });

  it('409 si el cambio cerraría un círculo', async () => {
    // Ana cuelga de Luis; poner a Ana como jefa de Luis cerraría el círculo.
    estado.plantilla[0].aprobadorCorreo = 'luis.prieto@ambientalia.com.co';
    const r = await fijar(E2, { aprobadorCorreo: 'ana.ruiz@ambientalia.com.co' }).expect(409);
    expect(r.body.error).toBe('ciclo_jerarquia');
  });

  it('devuelve la segunda firma ya derivada, no solo el jefe', async () => {
    // Es lo que hace comprensible el panel: al cambiar el jefe de alguien se ve
    // al instante a quién subiría su solicitud.
    estado.plantilla[1].aprobadorCorreo = GERENCIA;
    const r = await fijar(E1, { aprobadorCorreo: 'luis.prieto@ambientalia.com.co' }).expect(200);
    expect(r.body.aprobadorCorreo).toBe('luis.prieto@ambientalia.com.co');
    expect(r.body.segundoAprobadorCorreo).toBe(GERENCIA);
  });

  it('el maestro marca a quien está en un círculo, sin bloquear nada', async () => {
    estado.plantilla[0].aprobadorCorreo = 'luis.prieto@ambientalia.com.co';
    estado.plantilla[1].aprobadorCorreo = 'ana.ruiz@ambientalia.com.co';
    const r = await request(app())
      .get('/api/ausencias/empleados')
      .set('Authorization', `Bearer ${admin()}`)
      .expect(200);
    expect(r.body.empleados.every((e: any) => e.enCiclo)).toBe(true);
    expect(r.body.empleados).toHaveLength(2);
  });
});

// ── Histórico ──────────────────────────────────────────────────────────────

describe('importación del histórico', () => {
  const fila = (over: Record<string, unknown> = {}) => ({
    nombre: 'Ana Ruiz Molina',
    tipo: 'Vacaciones',
    fechaInicio: '2025-11-10',
    fechaFin: '2025-11-14',
    dias: 5,
    ...over,
  });

  const importar = (body: Record<string, unknown>, tok = token({ role: 'admin' })) =>
    request(app()).post('/api/ausencias/historico/import').set('Authorization', `Bearer ${tok}`).send(body);

  it('es solo para admin', async () => {
    await importar({ solicitudes: [fila()] }, token()).expect(403);
  });

  it('la previsualización cuenta pero no escribe', async () => {
    const r = await importar({ solicitudes: [fila(), fila({ fechaInicio: '2026-01-05', fechaFin: '2026-01-09' })], dryRun: true }).expect(200);
    expect(r.body).toMatchObject({ total: 2, resueltas: 2, importadas: 2, yaExistian: 0 });
    expect(estado.historicoInsertado).toBe(0);
  });

  it('sin dryRun sí escribe', async () => {
    await importar({ solicitudes: [fila()] }).expect(200);
    expect(estado.historicoInsertado).toBe(1);
  });

  it('lo que ya estaba no se duplica', async () => {
    estado.yaEnBd = 1;
    const r = await importar({ solicitudes: [fila(), fila({ fechaFin: '2025-11-11' })] }).expect(200);
    expect(r.body).toMatchObject({ importadas: 1, yaExistian: 1 });
  });

  it('reporta los nombres que no casan en vez de abortar el lote entero', async () => {
    // Importa lo que puede y enseña el resto: corregir el maestro y reimportar
    // es inocuo, así que bloquear las 52 buenas por una mala sería peor.
    const r = await importar({ solicitudes: [fila(), fila({ nombre: 'Fulano de Tal' })], dryRun: true }).expect(200);
    expect(r.body.total).toBe(2);
    expect(r.body.resueltas).toBe(1);
    expect(r.body.sinResolver).toEqual(['Fulano de Tal']);
  });

  it('señala la fila exacta cuando el Excel trae una fecha imposible', async () => {
    const r = await importar({ solicitudes: [fila(), fila({ fechaInicio: '2026-02-30' })] }).expect(400);
    expect(r.body.field).toBe('solicitudes[1].fechaInicio');
  });

  it('la vista global es solo para admin', async () => {
    await request(app()).get('/api/ausencias/historico').set('Authorization', `Bearer ${token()}`).expect(403);
    await request(app()).get('/api/ausencias/historico').set('Authorization', `Bearer ${token({ role: 'admin' })}`).expect(200);
  });
});

describe('edición de solicitudes', () => {
  const admin = () => token({ role: 'admin' });

  async function crear() {
    const r = await request(app())
      .post('/api/ausencias/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send(nueva())
      .expect(201);
    return r.body.id as string;
  }

  const edicion = (over: Record<string, unknown> = {}) => ({
    empleadoId: E1,
    tipo: 'permiso',
    fechaInicio: '2026-07-06',
    fechaFin: '2026-07-08',
    dias: 2.5,
    estado: 'aprobada',
    comentarios: 'Corregido a mano',
    observaciones: null,
    ...over,
  });

  const editar = (id: string, body: Record<string, unknown>, tok = admin()) =>
    request(app()).patch(`/api/ausencias/solicitudes/${id}`).set('Authorization', `Bearer ${tok}`).send(body);

  it('solo el admin puede editar', async () => {
    await editar(await crear(), edicion(), token()).expect(403);
  });

  it('corrige tipo, fechas, días y estado de una vez', async () => {
    const r = await editar(await crear(), edicion()).expect(200);
    expect(r.body).toMatchObject({ tipo: 'permiso', fechaInicio: '2026-07-06', fechaFin: '2026-07-08', estado: 'aprobada' });
    expect(r.body.diasHabiles).toBe(2.5);
  });

  it('conserva el medio día en vez de recalcular por las fechas', async () => {
    // El histórico está lleno de valores que no cuadran con el conteo de días
    // hábiles; recalcular al guardar destruiría justo lo que se corrige.
    const r = await editar(await crear(), edicion({ dias: 6.5 })).expect(200);
    expect(r.body.diasHabiles).toBe(6.5);
  });

  it('editar NO encola notificaciones: corregir no es decidir', async () => {
    estado.eventos = [];
    await editar(await crear(), edicion({ estado: 'rechazada' })).expect(200);
    expect(estado.eventos.filter((e) => e.evento === 'rechazada')).toHaveLength(0);
  });

  it('permite reasignar la solicitud a otra persona', async () => {
    const r = await editar(await crear(), edicion({ empleadoId: E2 })).expect(200);
    expect(r.body.empleadoId).toBe(E2);
  });

  it('404 si la solicitud no existe o el empleado destino tampoco', async () => {
    await editar('no-existe', edicion()).expect(404);
    await editar(await crear(), edicion({ empleadoId: E_FANTASMA })).expect(404);
  });

  it('rechaza el rango invertido, el estado inventado y los días negativos', async () => {
    const id = await crear();
    await editar(id, edicion({ fechaFin: '2026-07-01' })).expect(400);
    await editar(id, edicion({ estado: 'en_tramite' })).expect(400);
    await editar(id, edicion({ dias: -1 })).expect(400);
  });

  it('un empleadoId con basura es 400, no un 500 del ::uuid del SQL', async () => {
    await editar(await crear(), edicion({ empleadoId: "'; DROP TABLE" })).expect(400);
  });
});

describe('borrado de solicitudes', () => {
  async function crear() {
    const r = await request(app())
      .post('/api/ausencias/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send(nueva())
      .expect(201);
    return r.body.id as string;
  }

  it('solo el admin puede borrar', async () => {
    const id = await crear();
    await request(app()).delete(`/api/ausencias/solicitudes/${id}`).set('Authorization', `Bearer ${token()}`).expect(403);
    expect(estado.solicitudes).toHaveLength(1);
  });

  it('el admin la borra y desaparece del registro', async () => {
    const id = await crear();
    const r = await request(app())
      .delete(`/api/ausencias/solicitudes/${id}`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .expect(200);
    expect(r.body.borrada.id).toBe(id);
    expect(estado.solicitudes).toHaveLength(0);
  });

  it('404 si ya no existe — borrar dos veces no revienta', async () => {
    const id = await crear();
    const admin = token({ role: 'admin' });
    await request(app()).delete(`/api/ausencias/solicitudes/${id}`).set('Authorization', `Bearer ${admin}`).expect(200);
    await request(app()).delete(`/api/ausencias/solicitudes/${id}`).set('Authorization', `Bearer ${admin}`).expect(404);
  });
});

// ── Ciclo con n8n ──────────────────────────────────────────────────────────

describe('endpoints de n8n', () => {
  it('401 sin el token de cron', async () => {
    await request(app()).get('/api/ausencias/n8n/pendiente').expect(401);
  });

  it('401 con el token de WO-sales: los secretos no son intercambiables', async () => {
    await request(app())
      .get('/api/ausencias/n8n/pendiente')
      .set('X-WO-Sales-Cron-Token', 'cron-wo-sales')
      .expect(401);
  });

  it('el endpoint que servía el PDF a n8n ya no existe', async () => {
    // Se retiró con la copia a Drive. Que volviera a responder significaría que
    // alguien reintrodujo la subida sin los nodos que la gobernaban.
    await request(app())
      .get('/api/ausencias/n8n/adjunto/a1')
      .set('X-Ausencias-Cron-Token', 'cron-ausencias')
      .expect(404);
  });

  it('confirmar sigue funcionando aunque el cuerpo traiga el viejo `adjuntos`', async () => {
    // Un workflow antiguo que alguien reactive tiene que poder confirmar: lo
    // único que importa es que los eventos no se queden atascados en la cola. Se
    // ignora el campo en vez de rechazar la petición con un 400.
    await request(app()).post('/api/ausencias/solicitudes').set('Authorization', `Bearer ${token()}`).send(nueva()).expect(201);
    const p = await request(app()).get('/api/ausencias/n8n/pendiente').set('X-Ausencias-Cron-Token', 'cron-ausencias').expect(200);
    const r = await request(app())
      .post('/api/ausencias/n8n/confirmado')
      .set('X-Ausencias-Cron-Token', 'cron-ausencias')
      .send({ ids: [p.body.eventos[0].id], adjuntos: [{ id: 'a1', driveFileId: 'loquesea' }] })
      .expect(200);
    expect(r.body.confirmados).toBe(1);
  });

  it('crear → pendiente devuelve los eventos → confirmado → pendiente devuelve 0', async () => {
    await request(app()).post('/api/ausencias/solicitudes').set('Authorization', `Bearer ${token()}`).send(nueva()).expect(201);

    const p1 = await request(app()).get('/api/ausencias/n8n/pendiente').set('X-Ausencias-Cron-Token', 'cron-ausencias').expect(200);
    expect(p1.body.hay).toBe(true);
    // Un alta son dos correos: acuse al solicitante y aviso a quien aprueba.
    expect(p1.body.eventos.map((e: { evento: string }) => e.evento)).toEqual(['creada', 'aprobacion']);
    expect(p1.body.eventos[0].payload.tipoEtiqueta).toBe('Vacaciones');
    expect(p1.body.eventos[0].payload.correo.para).toBe('ana.ruiz@ambientalia.com.co');
    expect(p1.body.eventos[1].payload.correo.para).toBe('comercial@ambientalia.com.co');

    await request(app())
      .post('/api/ausencias/n8n/confirmado')
      .set('X-Ausencias-Cron-Token', 'cron-ausencias')
      .send({ ids: p1.body.eventos.map((e: { id: number }) => e.id) })
      .expect(200);

    const p2 = await request(app()).get('/api/ausencias/n8n/pendiente').set('X-Ausencias-Cron-Token', 'cron-ausencias').expect(200);
    expect(p2.body.hay).toBe(false);
    expect(p2.body.eventos).toHaveLength(0);
  });

  const pedirPendiente = () =>
    request(app()).get('/api/ausencias/n8n/pendiente').set('X-Ausencias-Cron-Token', 'cron-ausencias').expect(200);

  it('un evento servido pero NO confirmado se vuelve a entregar al expirar la reserva', async () => {
    // Es lo que hace que un fallo de Gmail se recupere solo, sin intervención.
    await request(app()).post('/api/ausencias/solicitudes').set('Authorization', `Bearer ${token()}`).send(nueva()).expect(201);
    await pedirPendiente();

    estado.ahora += RESERVA_MS; // pasa la reserva; el barrido siguiente lo recoge
    const otra = await pedirPendiente();
    expect(otra.body.eventos).toHaveLength(2);
    expect(otra.body.eventos[0].intentos).toBe(2);
  });

  it('dos disparadores casi a la vez NO se llevan el mismo evento', async () => {
    // El fallo real de producción: el webhook del portal y el barrido de diez
    // minutos arrancaron con 0,7 s de diferencia, los dos leyeron las mismas
    // filas —servir no marca nada hasta confirmar— y el empleado recibió el
    // correo por duplicado. Sobre un evento `aprobada` habrían sido además un
    // evento de calendario y una fila de la hoja de Nómina repetidos.
    await request(app()).post('/api/ausencias/solicitudes').set('Authorization', `Bearer ${token()}`).send(nueva()).expect(201);

    const primera = await pedirPendiente();
    expect(primera.body.eventos).toHaveLength(2);

    // Sin avanzar el reloj: es el segundo disparador, unos segundos después.
    const segunda = await pedirPendiente();
    expect(segunda.body.hay).toBe(false);
    expect(segunda.body.eventos).toHaveLength(0);
  });

  it('confirmar sin ids es un 400, no un no-op silencioso', async () => {
    await request(app())
      .post('/api/ausencias/n8n/confirmado')
      .set('X-Ausencias-Cron-Token', 'cron-ausencias')
      .send({})
      .expect(400);
  });

  it('confirmar dos veces los mismos ids es inocuo', async () => {
    await request(app()).post('/api/ausencias/solicitudes').set('Authorization', `Bearer ${token()}`).send(nueva()).expect(201);
    const body = { ids: [1] }; // solo el primero de los dos eventos del alta
    const a = await request(app()).post('/api/ausencias/n8n/confirmado').set('X-Ausencias-Cron-Token', 'cron-ausencias').send(body).expect(200);
    const b = await request(app()).post('/api/ausencias/n8n/confirmado').set('X-Ausencias-Cron-Token', 'cron-ausencias').send(body).expect(200);
    expect(a.body.confirmados).toBe(1);
    expect(b.body.confirmados).toBe(0);
  });
});

// ── Adjuntos ───────────────────────────────────────────────────────────────

describe('descarga del adjunto', () => {
  beforeEach(() => {
    estado.adjuntos.set('a1', {
      solicitudId: 's1',
      solicitanteEmail: 'ana.ruiz@ambientalia.com.co',
      aprobadorCorreo: 'comercial@ambientalia.com.co',
      nombreArchivo: 'Incapacidades_Ana_Ruiz_2026-07-06_1.pdf',
      mime: 'application/pdf',
      contenido: Buffer.from('%PDF-1.4 fake'),
    });
  });

  it('el solicitante puede descargarlo', async () => {
    const r = await request(app()).get('/api/ausencias/adjuntos/a1').set('Authorization', `Bearer ${token()}`).expect(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(r.headers['content-disposition']).toContain('Incapacidades_Ana_Ruiz');
  });

  it('un tercero recibe 404, no 403: no debe poder confirmar que existe', async () => {
    await request(app())
      .get('/api/ausencias/adjuntos/a1')
      .set('Authorization', `Bearer ${token({ sub: 'curioso@ambientalia.com.co' })}`)
      .expect(404);
  });
});

// ── Contexto ───────────────────────────────────────────────────────────────

describe('GET /ausencias/contexto', () => {
  it('devuelve el empleado y los festivos con los que el formulario cuenta días', async () => {
    const r = await request(app()).get('/api/ausencias/contexto').set('Authorization', `Bearer ${token()}`).expect(200);
    expect(r.body.empleado.correo).toBe('ana.ruiz@ambientalia.com.co');
    expect(r.body.festivos).toContain('2026-12-25');
    // Tres años: una solicitud a caballo entre diciembre y enero no puede
    // quedarse sin los festivos del año siguiente.
    const anios = new Set((r.body.festivos as string[]).map((f) => f.slice(0, 4)));
    expect(anios.size).toBe(3);
  });

  it('da de alta la ficha al abrir la app, para que aparezcan las pestañas', async () => {
    // Es lo que evita el caso que rompió el despliegue: entrar y encontrarte una
    // pantalla sin formulario y sin ninguna pista de por qué.
    estado.empleado = null;
    const r = await request(app()).get('/api/ausencias/contexto').set('Authorization', `Bearer ${token()}`).expect(200);
    expect(r.body.empleado).not.toBeNull();
    expect(estado.altasAutomaticas).toBe(1);
  });

  it('esVisorAdjuntos pliega admin dentro, o el admin perdería la pestaña', async () => {
    estado.plantilla[0].correo = 'administrativo@ambientalia.com.co';
    estado.plantilla[0].veAdjuntos = true;
    const flag = async (over: Record<string, unknown>) =>
      (await request(app()).get('/api/ausencias/contexto').set('Authorization', `Bearer ${token(over)}`).expect(200))
        .body.esVisorAdjuntos;

    expect(await flag({ sub: 'admin@ambientalia.com.co', role: 'admin' })).toBe(true);
    expect(await flag({ sub: 'administrativo@ambientalia.com.co' })).toBe(true);
    expect(await flag({ sub: 'ana.ruiz@ambientalia.com.co' })).toBe(false);
  });

  it('trae el nombre de quien aprueba, para no enseñar un buzón al solicitante', async () => {
    estado.empleado.aprobadorCorreo = 'jefa.directa@ambientalia.com.co';
    estado.plantilla.push({
      id: '55555555-5555-4555-8555-555555555555',
      nombreCompleto: 'Jefa Directa',
      correo: 'jefa.directa@ambientalia.com.co',
      activo: true,
      aprobadorCorreo: 'comercial@ambientalia.com.co',
    });
    const r = await request(app()).get('/api/ausencias/contexto').set('Authorization', `Bearer ${token()}`).expect(200);
    expect(r.body.aprobadorNombre).toBe('Jefa Directa');
  });

  it('sin ficha del aprobador manda null y la app cae de vuelta al correo', async () => {
    // Es el caso de hoy: el buzón por defecto no está dado de alta como empleado.
    // Inventar un nombre aquí sería peor que enseñar el correo.
    estado.empleado.aprobadorCorreo = 'buzon.sin.ficha@ambientalia.com.co';
    const r = await request(app()).get('/api/ausencias/contexto').set('Authorization', `Bearer ${token()}`).expect(200);
    expect(r.body.aprobadorNombre).toBeNull();
  });

  it('marca como aprobador a quien lo es, aunque no tenga nada pendiente', async () => {
    // Si dependiera de que haya solicitudes en cola, la pestaña de la bandeja
    // desaparecería en cuanto se vaciara y parecería que se ha perdido.
    const r = await request(app())
      .get('/api/ausencias/contexto')
      .set('Authorization', `Bearer ${token({ sub: 'comercial@ambientalia.com.co' })}`)
      .expect(200);
    expect(r.body.esAprobador).toBe(true);

    const otro = await request(app()).get('/api/ausencias/contexto').set('Authorization', `Bearer ${token()}`).expect(200);
    expect(otro.body.esAprobador).toBe(false);
  });

  it('incluye el saldo de vacaciones del empleado de la sesión', async () => {
    const r = await request(app()).get('/api/ausencias/contexto').set('Authorization', `Bearer ${token()}`).expect(200);
    // No está en `estado.plantilla` (el mock de saldo vive ahí), así que sale
    // "sin configurar"; lo que importa aquí es que el campo viaja, no null.
    expect(r.body.saldo).not.toBeNull();
    expect(r.body.saldo).toMatchObject({ configurado: false });
  });

  it('sin ficha de empleado, el saldo viaja como `null` explícito, no como una clave ausente', async () => {
    // `undefined` desaparece al serializar a JSON: una UI que distinga "sin
    // ficha" de "sin configurar" comprobando `saldo === null` se rompería en
    // silencio si aquí se colara un `undefined` en vez de un `null`.
    estado.empleado = null;
    estado.usuarioEnPortal = false;
    const r = await request(app()).get('/api/ausencias/contexto').set('Authorization', `Bearer ${token()}`).expect(200);
    expect(r.body.empleado).toBeNull();
    expect(r.body).toHaveProperty('saldo', null);
  });

  it('si el saldo falla al calcularse, el contexto arranca igual con `saldo: null`', async () => {
    // El contrario de /ausencias/saldos a propósito: allí el saldo ES la
    // respuesta y un fallo debe salir como 500 (ver el JSDoc de esa ruta). Aquí
    // es un campo accesorio de un payload que la app necesita para poder
    // arrancar, así que un fallo al calcularlo no puede tumbar `empleado` ni
    // `festivos`, que sí son imprescindibles para que aparezcan las pestañas.
    // Una `fechaCorte` con formato inválido es lo que hace lanzar a
    // `calcularSaldo` (ver su JSDoc en saldo.ts).
    estado.plantilla.push({ ...(estado.empleado as Record<string, unknown>), saldoCorte: 10, fechaCorte: 'fecha-invalida' });
    const r = await request(app()).get('/api/ausencias/contexto').set('Authorization', `Bearer ${token()}`).expect(200);
    expect(r.body.empleado).not.toBeNull();
    expect(r.body.festivos.length).toBeGreaterThan(0);
    expect(r.body).toHaveProperty('saldo', null);
  });
});

// ── Saldo de vacaciones ────────────────────────────────────────────────────

describe('GET /ausencias/saldos', () => {
  it('el admin recibe la lista completa', async () => {
    const r = await request(app())
      .get('/api/ausencias/saldos')
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .expect(200);
    expect(Array.isArray(r.body.saldos)).toBe(true);
    expect(r.body.saldos).toHaveLength(2); // E1 y E2 de la plantilla
  });

  it('403 a quien no es admin ni aprueba a nadie', async () => {
    await request(app())
      .get('/api/ausencias/saldos')
      .set('Authorization', `Bearer ${token({ sub: 'nadie@ambientalia.com.co' })}`)
      .expect(403);
  });

  it('403 con token válido pero sin la app asignada, aunque sí aprobaría a alguien', async () => {
    // Distinto del 403 de arriba: ese lo lanza el SERVICIO (`no_es_aprobador`).
    // Este debe pincharse en el `requireApp` del ROUTER, antes de llegar al
    // servicio: por eso el `sub` es el de un aprobador real, para que la única
    // razón posible del 403 sea la app que falta y no que el servicio también
    // lo habría rechazado.
    await request(app())
      .get('/api/ausencias/saldos')
      .set('Authorization', `Bearer ${token({ sub: 'comercial@ambientalia.com.co', apps: ['contabilidad'] })}`)
      .expect(403);
  });
});

describe('GET /ausencias/mi-saldo', () => {
  it('devuelve el saldo de quien pregunta', async () => {
    estado.plantilla.push({ ...(estado.empleado as Record<string, unknown>), saldoCorte: 10, fechaCorte: '2026-01-01' });
    const r = await request(app()).get('/api/ausencias/mi-saldo').set('Authorization', `Bearer ${token()}`).expect(200);
    expect(r.body.saldo).toMatchObject({ configurado: true, saldoCorte: 10, fechaCorte: '2026-01-01' });
    // No se fija un `disponible` exacto: crece con el devengo cada día que pasa,
    // así que un número literal convertiría este test en una bomba de relojería
    // que estallaría sola dentro de un mes. Lo invariante es que sin vacaciones
    // aprobadas nunca puede quedar por debajo del saldo de corte.
    expect(r.body.saldo.disponible).toBeGreaterThanOrEqual(10);
  });

  it('sin ficha de empleado responde `saldo: null` explícito, no una clave ausente', async () => {
    // `undefined` desaparece al serializar a JSON, y el widget distingue "sin
    // ficha" de "sin configurar" mirando el valor: si aquí se colara un
    // `undefined`, el widget se rompería en silencio.
    estado.empleado = null;
    estado.usuarioEnPortal = false;
    const r = await request(app()).get('/api/ausencias/mi-saldo').set('Authorization', `Bearer ${token()}`).expect(200);
    expect(r.body).toHaveProperty('saldo', null);
  });

  it('con ficha pero sin saldo de corte devuelve `configurado: false`, no null', async () => {
    // La otra mitad del caso «no hay número que enseñar», y la que de verdad se
    // da hoy: hay ficha, pero nadie ha fijado el punto de partida. El widget las
    // trata igual, pero llegan por caminos distintos y la de aquí no la cubría
    // ningún test. `estado.empleado` no está en `estado.plantilla` (ids
    // distintos), así que `empleadosConSaldo` no lo encuentra.
    const r = await request(app()).get('/api/ausencias/mi-saldo').set('Authorization', `Bearer ${token()}`).expect(200);
    expect(r.body.saldo).toMatchObject({ configurado: false });
  });

  it('401 sin token', async () => {
    await request(app()).get('/api/ausencias/mi-saldo').expect(401);
  });

  it('403 con token válido pero sin la app asignada', async () => {
    await request(app())
      .get('/api/ausencias/mi-saldo')
      .set('Authorization', `Bearer ${token({ apps: ['contabilidad'] })}`)
      .expect(403);
  });

  it('500 si el cálculo del saldo lanza, en vez de un saldo en blanco', async () => {
    // Lo CONTRARIO de /ausencias/contexto, y a propósito: allí el saldo es un
    // accesorio de un payload que la app necesita para arrancar, y degradarlo a
    // `null` permite abrir la app. Aquí el saldo ES la respuesta, así que
    // devolverlo en blanco sería mentir por omisión. Sin este test, alguien
    // "arreglaría" el endpoint copiando el try/catch del contexto y el widget
    // pasaría a enseñar «sin configurar» ante un fallo real, mandando a la
    // persona a administración a arreglar algo que no está roto.
    // Una `fechaCorte` con formato inválido es lo que hace lanzar a `calcularSaldo`.
    estado.plantilla.push({ ...(estado.empleado as Record<string, unknown>), saldoCorte: 10, fechaCorte: 'fecha-invalida' });
    await request(app()).get('/api/ausencias/mi-saldo').set('Authorization', `Bearer ${token()}`).expect(500);
  });

  it('ignora cualquier identidad que venga del cliente: siempre el saldo de la sesión', async () => {
    // La identidad sale de `sesionDe(req)` y de ningún otro sitio. Este test no
    // prueba una rama de código: fija que no EXISTA la rama. Si alguien añadiera
    // un parámetro para pedir el saldo de otra persona, se pondría rojo aquí.
    estado.plantilla.push({ ...(estado.empleado as Record<string, unknown>), saldoCorte: 10, fechaCorte: '2026-01-01' });
    const r = await request(app())
      .get('/api/ausencias/mi-saldo')
      .query({ empleadoId: E2, correo: 'otro@ambientalia.com.co' })
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(r.body.saldo).toMatchObject({ saldoCorte: 10 });
  });
});

describe('PUT /ausencias/empleados/:id/saldo', () => {
  it('solo el admin puede fijar el saldo', async () => {
    await request(app())
      .put(`/api/ausencias/empleados/${E1}/saldo`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ saldoCorte: 10, fechaCorte: '2026-01-01' })
      .expect(403);
  });

  // Un saldo negativo NO es un 400: es quien ha adelantado vacaciones, y el
  // Excel del que salen los saldos iniciales los trae. Lo que sí se rechaza es
  // un valor absurdo en cualquiera de los dos sentidos.
  it('400 si el saldo es absurdo, también hacia abajo', async () => {
    await request(app())
      .put(`/api/ausencias/empleados/${E1}/saldo`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ saldoCorte: -1000, fechaCorte: '2026-01-01' })
      .expect(400);
  });

  it('400 si la configuración va a medias (falta fechaCorte)', async () => {
    await request(app())
      .put(`/api/ausencias/empleados/${E1}/saldo`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ saldoCorte: 10 })
      .expect(400);
  });
});

// ── Calendario ─────────────────────────────────────────────────────────────

describe('GET /ausencias/calendario', () => {
  const admin = () => token({ sub: 'admin@ambientalia.com.co', role: 'admin' });

  it('un admin ve empleados, días y marcas de toda la plantilla', async () => {
    const r = await request(app())
      .get('/api/ausencias/calendario?mes=2026-08')
      .set('Authorization', `Bearer ${admin()}`)
      .expect(200);
    expect(r.body.empleados).toHaveLength(2);
    expect(r.body.dias).toHaveLength(31);
    // Tres días de Ana (del 10 al 12) y uno de Beto (el 11).
    expect(r.body.marcas).toHaveLength(4);
  });

  it('quien no es admin solo se ve a sí mismo', async () => {
    // El recorte lo hace el SQL: las marcas ajenas no llegan al navegador, no es
    // que no se pinten. Si viajaran, estarían expuestas igual.
    const r = await request(app())
      .get('/api/ausencias/calendario?mes=2026-08')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(r.body.empleados).toEqual([{ id: 'e1', nombreCompleto: 'Ana Ruiz' }]);
    expect(r.body.marcas).toHaveLength(3);
    expect(r.body.marcas.every((m: { empleadoId: string }) => m.empleadoId === 'e1')).toBe(true);
  });

  it('un aprobador tampoco ve a su equipo: solo admin ve a los demás', async () => {
    const r = await request(app())
      .get('/api/ausencias/calendario?mes=2026-08')
      .set('Authorization', `Bearer ${token({ sub: 'comercial@ambientalia.com.co' })}`)
      .expect(200);
    expect(r.body.empleados).toHaveLength(1);
  });

  it('sin ficha de empleado devuelve una rejilla vacía, no la plantilla entera', async () => {
    // El fallo que evita: `null` significa «sin acotar» en el repo, así que caer
    // en esa rama por no tener ficha enseñaría justo lo contrario de lo que toca.
    estado.empleado = null;
    estado.usuarioEnPortal = false;
    const r = await request(app())
      .get('/api/ausencias/calendario?mes=2026-08')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(r.body.empleados).toEqual([]);
    expect(r.body.marcas).toEqual([]);
  });

  it('400 si el mes viene mal formado', async () => {
    for (const mes of ['2026-13', 'agosto', '2026', '']) {
      await request(app())
        .get(`/api/ausencias/calendario?mes=${encodeURIComponent(mes)}`)
        .set('Authorization', `Bearer ${token()}`)
        .expect(400);
    }
  });

  it('403 a quien tiene token válido pero no la app asignada', async () => {
    await request(app())
      .get('/api/ausencias/calendario?mes=2026-08')
      .set('Authorization', `Bearer ${token({ apps: [] })}`)
      .expect(403);
  });
});

describe('PUT /ausencias/empleados/:id/copia', () => {
  it('un admin fija la copia de alguien', async () => {
    const r = await request(app())
      .put(`/api/ausencias/empleados/${E1}/copia`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ copiaCorreo: 'ana.ruiz@ambientalia.com.co' })
      .expect(200);
    expect(r.body).toMatchObject({ id: E1, copiaCorreo: 'ana.ruiz@ambientalia.com.co' });
  });

  it('acepta `null` para dejar a alguien sin copia', async () => {
    const r = await request(app())
      .put(`/api/ausencias/empleados/${E1}/copia`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ copiaCorreo: null })
      .expect(200);
    expect(r.body).toHaveProperty('copiaCorreo', null);
  });

  it('400 si el correo no es de nadie de la plantilla', async () => {
    // Se valida contra los empleados ACTIVOS y no solo el formato: una errata
    // mandaría los avisos al vacío sin que nadie se enterara nunca.
    const r = await request(app())
      .put(`/api/ausencias/empleados/${E1}/copia`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ copiaCorreo: 'nadie@ambientalia.com.co' })
      .expect(400);
    // Cierra el motivo: sin esto, el test seguiría en verde si el 400 viniera de
    // otra rama distinta a «no está en la plantilla».
    expect(r.body.error).toBe('copia_no_encontrada');
  });

  it('acepta la copia por defecto aunque su ficha no esté activa', async () => {
    // Mismo motivo que `APROBADOR_POR_DEFECTO` en el jefe: es el correo con el
    // que la migración 021 sembró toda la plantilla, y rechazarlo lo volvería
    // irreponible desde el panel en cuanto alguien lo cambiara.
    //
    // No se vacía `estado.plantilla` entera: el doble de `fijarCopia` busca ahí
    // la ficha de E1, y sin ella el PUT daría 404 en vez de probar lo que toca.
    // Basta con que el correo por defecto no esté entre los activos que devuelve
    // `enlacesActivos`, así que se deja solo la ficha de E1 (su correo ya es
    // `ana.ruiz@...`, no el de administración).
    estado.plantilla = [estado.plantilla[0]];
    const r = await request(app())
      .put(`/api/ausencias/empleados/${E1}/copia`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ copiaCorreo: 'administrativo@ambientalia.com.co' })
      .expect(200);
    expect(r.body).toHaveProperty('copiaCorreo', 'administrativo@ambientalia.com.co');
  });

  it('400 si `copiaCorreo` no es ni texto ni null', async () => {
    const r = await request(app())
      .put(`/api/ausencias/empleados/${E1}/copia`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ copiaCorreo: 42 })
      .expect(400);
    expect(r.body.error).toBe('copia_invalida');
  });

  it('400 si el cuerpo no trae `copiaCorreo`', async () => {
    // `undefined` no es null: un PUT sin el campo NO significa «sin copia», y
    // tratarlo así borraría la copia de alguien por un error del cliente.
    const r = await request(app())
      .put(`/api/ausencias/empleados/${E1}/copia`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({})
      .expect(400);
    expect(r.body.error).toBe('copia_invalida');
  });

  it('403 a quien no es admin', async () => {
    await request(app())
      .put(`/api/ausencias/empleados/${E1}/copia`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ copiaCorreo: 'ana.ruiz@ambientalia.com.co' })
      .expect(403);
  });
});

describe('PUT /ausencias/empleados/:id/visor', () => {
  it('un admin da la llave, y el registro dice quién la dio y a quién', async () => {
    // El `sub` del admin es DISTINTO del correo del empleado afectado a
    // propósito: en el fixture por defecto coinciden, y con esa coincidencia un
    // swap de `adminEmail` por `empleadoCorreo` pasaría este test sin
    // inmutarse. El registro es lo único que dice quién dio acceso a datos de
    // salud desde que la lista salió del código, así que tiene que distinguir
    // al actor del sujeto.
    const r = await request(app())
      .put(`/api/ausencias/empleados/${E1}/visor`)
      .set('Authorization', `Bearer ${token({ role: 'admin', sub: 'gerencia@ambientalia.com.co' })}`)
      .send({ veAdjuntos: true })
      .expect(200);
    expect(r.body).toMatchObject({ id: E1, veAdjuntos: true });
    expect(estado.registroVisores).toHaveLength(1);
    expect(estado.registroVisores[0]).toMatchObject({
      adminEmail: 'gerencia@ambientalia.com.co',
      empleadoCorreo: 'ana.ruiz@ambientalia.com.co',
      empleadoId: E1,
      concedido: true,
    });
  });

  it('quitarla también se registra', async () => {
    estado.plantilla[0].veAdjuntos = true;
    await request(app())
      .put(`/api/ausencias/empleados/${E1}/visor`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ veAdjuntos: false })
      .expect(200);
    expect(estado.registroVisores[0]).toMatchObject({ concedido: false });
  });

  it('sin cambio no se escribe nada en el registro', async () => {
    // Si «Guardar» dejara una línea cada vez aunque la casilla no cambie, el
    // registro se llenaría de ruido y dejaría de leerse — y un registro que
    // nadie lee no es un control, es un fichero que crece.
    estado.plantilla[0].veAdjuntos = false;
    await request(app())
      .put(`/api/ausencias/empleados/${E1}/visor`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ veAdjuntos: false })
      .expect(200);
    expect(estado.registroVisores).toHaveLength(0);
  });

  it('si el registro falla, la llave no se queda concedida a medias', async () => {
    // No se puede probar la transacción de verdad sin Postgres, así que esto fija
    // el CABLEADO: que el servicio hace UNA llamada que escribe las dos cosas, y
    // no dos que puedan cuajar por separado. Si alguien volviera a partirlas, el
    // fallo del registro dejaría la llave dada y sin rastro, y el reintento no lo
    // arreglaría porque ya no habría cambio que detectar.
    estado.fallarRegistroVisor = true;
    await request(app())
      .put(`/api/ausencias/empleados/${E1}/visor`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ veAdjuntos: true })
      .expect(500);
    expect(estado.plantilla[0].veAdjuntos).not.toBe(true);
    expect(estado.registroVisores).toHaveLength(0);
  });

  it('400 si `veAdjuntos` no es booleano', async () => {
    const r = await request(app())
      .put(`/api/ausencias/empleados/${E1}/visor`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ veAdjuntos: 'si' })
      .expect(400);
    expect(r.body.error).toBe('visor_invalido');
  });

  it('404 si el empleado no existe', async () => {
    await request(app())
      .put(`/api/ausencias/empleados/${E_FANTASMA}/visor`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ veAdjuntos: true })
      .expect(404);
    // Y no deja rastro: un intento fallido no puede ensuciar el registro.
    expect(estado.registroVisores).toHaveLength(0);
  });

  it('403 a quien no es admin', async () => {
    await request(app())
      .put(`/api/ausencias/empleados/${E1}/visor`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ veAdjuntos: true })
      .expect(403);
  });
});

// ── Modificación de una solicitud ya enviada ───────────────────────────────

describe('POST /ausencias/solicitudes/:id/modificaciones', () => {
  const APROBADOR = 'comercial@ambientalia.com.co';
  const LUIS = 'luis.prieto@ambientalia.com.co';

  /** Un cambio de fechas al 13-17 de julio de 2026: lunes a viernes, 5 hábiles. */
  const CAMBIO = { clase: 'fechas', fechaInicio: '2026-07-13', fechaFin: '2026-07-17', motivo: 'Cita médica' };

  /**
   * La ficha de OTRA persona. `asegurarEmpleado` del doble devuelve siempre
   * `estado.empleado` sin mirar el correo, así que cambiar de sesión es cambiar
   * esta ficha. Tipada, para que un renombrado del contrato salga en el build.
   */
  const otraFicha = (): EmpleadoFalso => ({
    id: 'e9',
    nombreCompleto: 'Luis Prieto',
    correo: LUIS,
    cargo: 'Analista',
    credencial: 1003,
    aprobadorCorreo: APROBADOR,
    requiereSegundaFirma: true,
    userId: null,
    activo: true,
  });

  async function crear(over: Record<string, unknown> = {}) {
    const r = await request(app())
      .post('/api/ausencias/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send(nueva(over))
      .expect(201);
    return r.body as Record<string, unknown>;
  }

  /** La fila tal como está guardada, para poder moverla por debajo. */
  const fila = (id: string) => estado.solicitudes.find((s) => s.id === id) as Record<string, unknown>;

  const pedir = (id: string, body: Record<string, unknown>, tok = token()) =>
    request(app())
      .post(`/api/ausencias/solicitudes/${id}/modificaciones`)
      .set('Authorization', `Bearer ${tok}`)
      .send(body);

  const avisos = () => estado.eventos.filter((e) => e.evento === 'modificacion_solicitada');

  it('el dueño pide cambiar las fechas: 201 y el aviso va al decisor', async () => {
    const s = await crear();
    const r = await pedir(s.id as string, CAMBIO).expect(201);
    expect(r.body).toMatchObject({
      clase: 'fechas',
      estado: 'pendiente',
      fechaInicioNueva: '2026-07-13',
      fechaFinNueva: '2026-07-17',
      motivo: 'Cita médica',
    });
    expect(avisos()).toHaveLength(1);
    expect((avisos()[0].payload as any).correo.para).toBe(APROBADOR);
  });

  it('la foto previa sale de la SOLICITUD, no del cuerpo de la petición', async () => {
    // Es lo que sostiene el «de estas fechas a estas otras» del correo. Si el
    // cliente pudiera dictarla, el jefe leería un antes que nunca existió.
    const s = await crear();
    const r = await pedir(s.id as string, {
      ...CAMBIO,
      estadoPrevio: 'aprobada',
      fechaInicioPrevia: '1999-01-01',
      diasHabilesPrevios: 99,
    }).expect(201);
    expect(r.body).toMatchObject({
      estadoPrevio: 'pendiente',
      fechaInicioPrevia: '2026-07-06',
      fechaFinPrevia: '2026-07-10',
      diasHabilesPrevios: 5,
    });
  });

  it('los días hábiles nuevos los cuenta el servidor', async () => {
    const s = await crear();
    const r = await pedir(s.id as string, { ...CAMBIO, diasHabilesNuevos: 99 }).expect(201);
    expect(r.body.diasHabilesNuevos).toBe(5);
  });

  it('una anulación se guarda con las tres columnas de lo propuesto en null', async () => {
    const s = await crear();
    const r = await pedir(s.id as string, { clase: 'anulacion', motivo: 'Se cancela el viaje' }).expect(201);
    expect(r.body).toMatchObject({ clase: 'anulacion', fechaInicioNueva: null, fechaFinNueva: null });
    expect(r.body.diasHabilesNuevos).toBeNull();
    expect((avisos()[0].payload as any).correo.cuerpo).toContain('ANULAR');
  });

  it('la solicitud viaja con su propuesta viva colgada, sin pedir nada aparte', async () => {
    // El LEFT JOIN de `SELECT_SOLICITUD`: ninguna pantalla puede olvidarse de
    // preguntar y enseñar como firmes unas fechas que están en discusión.
    const s = await crear();
    await pedir(s.id as string, CAMBIO).expect(201);
    const r = await request(app())
      .get('/api/ausencias/mis-solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(r.body.solicitudes).toHaveLength(1);
    expect(r.body.solicitudes[0].modificacionPendiente).toMatchObject({ clase: 'fechas', estado: 'pendiente' });
    expect(r.body.solicitudes[0]).toHaveProperty('anuladaAt', null);
  });

  it('404 si la solicitud no existe', async () => {
    const r = await pedir('no-existe', CAMBIO).expect(404);
    expect(r.body.error).toBe('no_encontrada');
  });

  it('403 si la solicitud es de otro', async () => {
    const s = await crear();
    // Ahora quien pregunta es Luis, que no tiene nada que ver con esa solicitud.
    estado.empleado = otraFicha();
    const r = await pedir(s.id as string, CAMBIO, token({ sub: LUIS })).expect(403);
    expect(r.body.error).toBe('no_es_su_solicitud');
    expect(estado.modificaciones).toHaveLength(0);
  });

  it('CANDADO: mandar `empleadoId` en el cuerpo no abre la solicitud de otro', async () => {
    // La identidad sale de la sesión y de ningún otro sitio. Este test no
    // prueba una rama: fija que NO exista. Si alguien añadiera un `empleadoId`
    // «para que administración pueda pedirlo en nombre de», se pondría rojo.
    const s = await crear();
    const dueña = estado.empleado.id;
    estado.empleado = otraFicha();
    const r = await pedir(s.id as string, { ...CAMBIO, empleadoId: dueña }, token({ sub: LUIS })).expect(403);
    expect(r.body.error).toBe('no_es_su_solicitud');
    expect(estado.modificaciones).toHaveLength(0);
    expect(avisos()).toHaveLength(0);
  });

  it('ni un admin lo pide en nombre de otro: para corregir a mano está el PATCH', async () => {
    // El PATCH además no manda correos, que es lo que lo hace apto para
    // corregir el registro. Esto es el debido proceso, y tiene un solo dueño.
    const s = await crear();
    estado.empleado = otraFicha();
    await pedir(s.id as string, CAMBIO, token({ sub: 'admin@ambientalia.com.co', role: 'admin' })).expect(403);
  });

  it.each(['rechazada', 'registrada'])('409 sobre una solicitud %s', async (est) => {
    const s = await crear();
    fila(s.id as string).estado = est;
    const r = await pedir(s.id as string, CAMBIO).expect(409);
    expect(r.body.error).toBe('estado_no_admite_modificacion');
    expect(estado.modificaciones).toHaveLength(0);
  });

  it('una incapacidad no admite cambio: no hay a quién mandárselo', async () => {
    const s = await crear({
      tipo: 'incapacidad',
      adjunto: { nombreArchivo: 'i.pdf', mime: 'application/pdf', contenidoBase64: PDF },
    });
    expect(s.aprobadorCorreo).toBeNull();
    const r = await pedir(s.id as string, CAMBIO).expect(409);
    expect(r.body.error).toBe('estado_no_admite_modificacion');
  });

  it.each(['pendiente', 'pendiente_2', 'aprobada'])('%s sí admite cambio', async (est) => {
    const s = await crear();
    fila(s.id as string).estado = est;
    // En `pendiente_2` decide el segundo firmante; aquí no hay, así que el
    // decisor cae al jefe inmediato, que es lo que hace `decisorDeModificacion`.
    fila(s.id as string).segundoAprobadorCorreo = est === 'pendiente_2' ? APROBADOR : null;
    await pedir(s.id as string, CAMBIO).expect(201);
  });

  it('409 si la ausencia ya terminó', async () => {
    const s = await crear();
    // Se mueve la fila por debajo: el alta no deja crear nada en el pasado.
    Object.assign(fila(s.id as string), { fechaInicio: '2026-01-10', fechaFin: '2026-01-14' });
    const r = await pedir(s.id as string, CAMBIO).expect(409);
    expect(r.body.error).toBe('solicitud_ya_pasada');
  });

  it('una ausencia EN CURSO sí se puede acortar por la cola', async () => {
    // El caso que justifica que la regla mire `fechaFin` y no `fechaInicio`:
    // hoy es el 15 (reloj congelado), la ausencia va del 10 al 20.
    const s = await crear();
    Object.assign(fila(s.id as string), { fechaInicio: '2026-01-10', fechaFin: '2026-01-20' });
    const r = await pedir(s.id as string, {
      clase: 'fechas',
      fechaInicio: '2026-01-10',
      fechaFin: '2026-01-16',
    }).expect(201);
    expect(r.body.fechaFinNueva).toBe('2026-01-16');
  });

  it('400 al RETROCEDER una solicitud vigente a fechas ya pasadas', async () => {
    // La otra cara del test de arriba, y por HTTP porque es el camino real: la
    // solicitud (julio) sigue vigente y sin empezar, así que pasa los dos 409;
    // lo único que impide reservar días de enero es la regla de la validación.
    const s = await crear();
    const r = await pedir(s.id as string, {
      clase: 'fechas',
      fechaInicio: '2026-01-05',
      fechaFin: '2026-01-08',
    }).expect(400);
    expect(r.body).toMatchObject({ error: 'fecha_en_pasado', field: 'fechaInicio' });
    expect(estado.modificaciones).toHaveLength(0);
    expect(avisos()).toHaveLength(0);
  });

  it('el último día cuenta: una ausencia que acaba HOY todavía se puede cambiar', async () => {
    // El borde de `fechaFin >= hoy`. Se pide un CAMBIO DE FECHAS y no una
    // anulación: esta ausencia empezó el 10, así que anularla devolvería los
    // días ya disfrutados y tiene su propia regla (ver el bloque de anulación).
    const s = await crear();
    Object.assign(fila(s.id as string), { fechaInicio: '2026-01-10', fechaFin: '2026-01-15' });
    const r = await pedir(s.id as string, {
      clase: 'fechas',
      fechaInicio: '2026-01-10',
      fechaFin: '2026-01-14',
    }).expect(201);
    expect(r.body.fechaFinNueva).toBe('2026-01-14');
  });

  // ── Anular exige que no haya empezado ──────────────────────────────────
  //
  // El reloj de este fichero está congelado en el jueves 15 de enero de 2026.
  // Las fechas de este bloque son relativas a ese día y se mueven por debajo,
  // porque el alta no deja crear nada que empiece en el pasado.

  it('anular una ausencia que empieza MAÑANA vale', async () => {
    const s = await crear();
    Object.assign(fila(s.id as string), { fechaInicio: '2026-01-16', fechaFin: '2026-01-20' });
    const r = await pedir(s.id as string, { clase: 'anulacion' }).expect(201);
    expect(r.body.clase).toBe('anulacion');
  });

  it('anular una que empieza HOY vale: el día no está consumido hasta que acaba', async () => {
    // El `>=` deliberado. Cancelar la mañana del primer día es el caso normal,
    // y con `>` esa persona se quedaría sin salida: no se puede acortar una
    // ausencia a menos de un día.
    const s = await crear();
    Object.assign(fila(s.id as string), { fechaInicio: '2026-01-15', fechaFin: '2026-01-20' });
    await pedir(s.id as string, { clase: 'anulacion' }).expect(201);
  });

  it('CANDADO: anular una ausencia YA EMPEZADA es 409, no un regalo de días', async () => {
    // Empezó ayer y acaba el viernes. Anularla la dejaría `rechazada`, y una
    // rechazada devuelve TODOS sus días al saldo y desaparece del calendario:
    // los de ayer y hoy, que sí se disfrutaron, volverían como si nada.
    const s = await crear();
    Object.assign(fila(s.id as string), { fechaInicio: '2026-01-14', fechaFin: '2026-01-16' });
    const r = await pedir(s.id as string, { clase: 'anulacion' }).expect(409);
    expect(r.body.error).toBe('anulacion_ya_empezada');
    expect(estado.modificaciones).toHaveLength(0);
    expect(avisos()).toHaveLength(0);
  });

  it('pero ACORTAR esa misma sigue valiendo: la regla es de la clase, no del estado', async () => {
    // El test que demuestra que la restricción vive en la clase. Acortar
    // recalcula `diasHabiles`, así que el saldo queda en los días que de verdad
    // se tomaron — que es lo que hay que hacer en vez de anular.
    const s = await crear();
    Object.assign(fila(s.id as string), { fechaInicio: '2026-01-14', fechaFin: '2026-01-16' });
    const r = await pedir(s.id as string, {
      clase: 'fechas',
      fechaInicio: '2026-01-14',
      fechaFin: '2026-01-15',
    }).expect(201);
    expect(r.body.fechaFinNueva).toBe('2026-01-15');
  });

  it('409 al pedir una segunda propuesta teniendo una viva', async () => {
    const s = await crear();
    await pedir(s.id as string, CAMBIO).expect(201);
    const r = await pedir(s.id as string, { ...CAMBIO, fechaFin: '2026-07-16' }).expect(409);
    expect(r.body.error).toBe('ya_hay_modificacion_pendiente');
    expect(estado.modificaciones).toHaveLength(1);
    expect(avisos()).toHaveLength(1);
  });

  it('400 si pide exactamente las fechas que ya tiene', async () => {
    const s = await crear();
    const r = await pedir(s.id as string, {
      clase: 'fechas',
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-10',
    }).expect(400);
    expect(r.body.error).toBe('sin_cambios');
    expect(estado.modificaciones).toHaveLength(0);
    expect(avisos()).toHaveLength(0);
  });

  it('400 si una anulación viene con fechas', async () => {
    const s = await crear();
    const r = await pedir(s.id as string, {
      clase: 'anulacion',
      fechaInicio: '2026-07-13',
      fechaFin: '2026-07-17',
    }).expect(400);
    expect(r.body).toMatchObject({ error: 'anulacion_con_fechas', field: 'clase' });
    expect(estado.modificaciones).toHaveLength(0);
  });

  it('400 con su código si el cuerpo no vale', async () => {
    const s = await crear();
    await pedir(s.id as string, { clase: 'cambiar_tipo' }).expect(400);
    await pedir(s.id as string, { ...CAMBIO, fechaFin: '2026-02-30' }).expect(400);
    await pedir(s.id as string, { ...CAMBIO, fechaInicio: '2026-07-17', fechaFin: '2026-07-13' }).expect(400);
  });

  it('el alta viaja con el estado que el servicio LEYÓ, no con un literal', async () => {
    // Lo que el testigo del SQL compara. Con un literal escrito a mano, una
    // solicitud ya aprobada guardaría `estado_previo = 'pendiente'` y el correo
    // de la decisión no avisaría de tocar el calendario de Google.
    const s = await crear();
    fila(s.id as string).estado = 'aprobada';
    await pedir(s.id as string, CAMBIO).expect(201);
    expect(estado.ultimaAlta).toMatchObject({ estadoEsperado: 'aprobada' });
  });

  it('CANDADO: si la solicitud cambia de estado entre el read y el insert, 409 y ni una fila', async () => {
    // La carrera real: el jefe aprueba mientras el trabajador rellena el
    // formulario.
    //
    // ⚠️ Esto fija el CABLEADO DEL SERVICIO —que traduce `razon: 'estado'` a un
    // 409 sin escribir nada—, NO el SQL. El `AND s.estado = $8` no lo ejecuta
    // ningún test: este doble es in-memory y modela el testigo por su cuenta,
    // así que quitarlo del SQL real dejaría los 677 en verde. Lo único que
    // vigila el SQL es la aserción de forma de repo.test.ts.
    const s = await crear();
    estado.pisarEstadoAlCrearModificacion = 'aprobada';
    const r = await pedir(s.id as string, CAMBIO).expect(409);
    expect(r.body.error).toBe('solicitud_cambio_de_estado');
    expect(estado.modificaciones).toHaveLength(0);
    expect(avisos()).toHaveLength(0);
  });

  it('CANDADO: los firmantes NO se rederivan — el aviso va al jefe VIEJO', async () => {
    const JEFA = 'jefa.directa@ambientalia.com.co';
    const NUEVO = 'jefe.nuevo@ambientalia.com.co';
    estado.empleado.aprobadorCorreo = JEFA;
    estado.plantilla.push({
      id: '66666666-6666-4666-8666-666666666666',
      nombreCompleto: 'Jefa Directa',
      correo: JEFA,
      aprobadorCorreo: APROBADOR,
      requiereSegundaFirma: false,
      activo: true,
    });
    const s = await crear();
    expect(s.aprobadorCorreo).toBe(JEFA);

    // Reorganización: a partir de ahora Ana cuelga de otro jefe.
    estado.empleado.aprobadorCorreo = NUEVO;
    estado.plantilla.push({
      id: '77777777-7777-4777-8777-777777777777',
      nombreCompleto: 'Jefe Nuevo',
      correo: NUEVO,
      aprobadorCorreo: APROBADOR,
      requiereSegundaFirma: false,
      activo: true,
    });

    const r = await pedir(s.id as string, CAMBIO).expect(201);
    // La propuesta la decide quien firmó la original, no quien manda hoy: al
    // jefe nuevo «anula mis vacaciones aprobadas» no le diría nada, porque no
    // sabe que se aprobaron ni por qué.
    expect(r.body.aprobadorCorreo).toBe(JEFA);
    expect((avisos()[0].payload as any).correo.para).toBe(JEFA);
  });

  it('el aviso sale por la cola de n8n con calendario y hoja en null', async () => {
    // Comprobado sobre el payload HTTP, que es el contrato que n8n lee: si
    // emitiera `calendario`, n8n crearía un evento duplicado en el Calendar en
    // vez de corregir el viejo.
    const s = await crear();
    await pedir(s.id as string, CAMBIO).expect(201);
    const p = await request(app())
      .get('/api/ausencias/n8n/pendiente')
      .set('X-Ausencias-Cron-Token', 'cron-ausencias')
      .expect(200);
    const evento = p.body.eventos.find((e: { evento: string }) => e.evento === 'modificacion_solicitada');
    expect(evento).toBeTruthy();
    expect(evento.payload).toHaveProperty('calendario', null);
    expect(evento.payload).toHaveProperty('hoja', null);
  });

  it('401 sin token y 403 sin la app asignada', async () => {
    const s = await crear();
    await request(app()).post(`/api/ausencias/solicitudes/${s.id}/modificaciones`).send(CAMBIO).expect(401);
    await pedir(s.id as string, CAMBIO, token({ apps: ['contabilidad'] })).expect(403);
  });
});

describe('POST /ausencias/modificaciones/:id/retirar', () => {
  const LUIS = 'luis.prieto@ambientalia.com.co';
  const CAMBIO = { clase: 'fechas', fechaInicio: '2026-07-13', fechaFin: '2026-07-17' };

  async function crearYPedir() {
    const s = (
      await request(app())
        .post('/api/ausencias/solicitudes')
        .set('Authorization', `Bearer ${token()}`)
        .send(nueva())
        .expect(201)
    ).body as Record<string, unknown>;
    const m = (
      await request(app())
        .post(`/api/ausencias/solicitudes/${s.id}/modificaciones`)
        .set('Authorization', `Bearer ${token()}`)
        .send(CAMBIO)
        .expect(201)
    ).body as Record<string, unknown>;
    return { solicitudId: s.id as string, modificacionId: m.id as string };
  }

  const retirar = (id: string, tok = token()) =>
    request(app()).post(`/api/ausencias/modificaciones/${id}/retirar`).set('Authorization', `Bearer ${tok}`);

  it('el autor la retira: 200, queda `retirada` y NO se encola ningún correo', async () => {
    // Retirar deja la solicitud exactamente como estaba: la propuesta
    // desaparece de la bandeja del jefe y ya. Avisar de eso sería ruido.
    const { modificacionId } = await crearYPedir();
    const eventosAntes = estado.eventos.length;

    const r = await retirar(modificacionId).expect(200);
    expect(r.body).toMatchObject({ id: modificacionId, estado: 'retirada' });
    expect(estado.eventos).toHaveLength(eventosAntes);
    // La fila NO se borra: queda el rastro de que se pidió y se echó atrás.
    expect(estado.modificaciones).toHaveLength(1);
  });

  it('la solicitud queda intacta y sin propuesta colgando', async () => {
    const { solicitudId, modificacionId } = await crearYPedir();
    const antes = { ...(estado.solicitudes.find((s) => s.id === solicitudId) as Record<string, unknown>) };
    await retirar(modificacionId).expect(200);
    const despues = estado.solicitudes.find((s) => s.id === solicitudId) as Record<string, unknown>;
    expect(despues).toMatchObject({
      estado: antes.estado,
      fechaInicio: antes.fechaInicio,
      fechaFin: antes.fechaFin,
      diasHabiles: antes.diasHabiles,
    });
    expect(despues.modificacionPendiente).toBeNull();
  });

  it('tras retirarla se puede pedir otra: el índice único solo mira las vivas', async () => {
    const { solicitudId, modificacionId } = await crearYPedir();
    await retirar(modificacionId).expect(200);
    await request(app())
      .post(`/api/ausencias/solicitudes/${solicitudId}/modificaciones`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ ...CAMBIO, fechaFin: '2026-07-16' })
      .expect(201);
    expect(estado.modificaciones).toHaveLength(2);
  });

  it('403 a un tercero', async () => {
    const { modificacionId } = await crearYPedir();
    estado.empleado = {
      id: 'e9',
      nombreCompleto: 'Luis Prieto',
      correo: LUIS,
      cargo: null,
      credencial: null,
      aprobadorCorreo: 'comercial@ambientalia.com.co',
      requiereSegundaFirma: true,
      userId: null,
      activo: true,
    } satisfies EmpleadoFalso;
    const r = await retirar(modificacionId, token({ sub: LUIS })).expect(403);
    expect(r.body.error).toBe('no_es_su_modificacion');
    expect(estado.modificaciones[0].estado).toBe('pendiente');
  });

  it('409 `ya_decidida` si el jefe ya la decidió: su decisión gana', async () => {
    const { modificacionId } = await crearYPedir();
    estado.modificaciones[0].estado = 'aprobada';
    const r = await retirar(modificacionId).expect(409);
    expect(r.body.error).toBe('ya_decidida');
    expect(estado.modificaciones[0].estado).toBe('aprobada');
  });

  it('409 `ya_retirada` al retirar dos veces: el doble clic no acusa al jefe', async () => {
    // Dos 409 distintos porque son dos cosas distintas: «tu jefe ya la decidió»
    // manda a mirar el resultado, y «ya la habías retirado» no manda a nada.
    // Con un solo código, la UI tendría que enseñar el mensaje equivocado en
    // uno de los dos casos.
    const { modificacionId } = await crearYPedir();
    await retirar(modificacionId).expect(200);
    const r = await retirar(modificacionId).expect(409);
    expect(r.body.error).toBe('ya_retirada');
  });

  it('404 si no existe', async () => {
    const r = await retirar('no-existe').expect(404);
    expect(r.body.error).toBe('no_encontrada');
  });

  it('401 sin token y 403 sin la app asignada', async () => {
    const { modificacionId } = await crearYPedir();
    await request(app()).post(`/api/ausencias/modificaciones/${modificacionId}/retirar`).expect(401);
    await retirar(modificacionId, token({ apps: ['contabilidad'] })).expect(403);
  });
});

describe('POST /ausencias/modificaciones/:id/decision', () => {
  const JEFA = 'jefa.directa@ambientalia.com.co';
  const GERENCIA = 'comercial@ambientalia.com.co';

  /** 13 al 15 de julio de 2026: lunes a miércoles, 3 hábiles (la original tiene 5). */
  const CAMBIO = { clase: 'fechas', fechaInicio: '2026-07-13', fechaFin: '2026-07-15', motivo: 'Cita médica' };

  beforeEach(() => {
    // Ana → Jefa → Gerencia. Hacen falta los DOS firmantes congelados: sin el
    // segundo no habría ningún correo «del otro firmante» que colar por error, y
    // el candado de más abajo pasaría por construcción.
    estado.empleado.aprobadorCorreo = JEFA;
    estado.plantilla.push({
      id: '88888888-8888-4888-8888-888888888888',
      nombreCompleto: 'Jefa Directa',
      correo: JEFA,
      cargo: 'Coordinadora',
      credencial: 900,
      aprobadorCorreo: GERENCIA,
      requiereSegundaFirma: true,
      userId: null,
      activo: true,
    } satisfies EmpleadoFalso);
  });

  const fila = (id: string) => estado.solicitudes.find((s) => s.id === id) as Record<string, unknown>;

  /**
   * Crea una solicitud, la deja en `estadoSolicitud` y pide el cambio.
   *
   * Por defecto `aprobada`, que es el caso principal de la feature: es el único
   * en el que la original ya está en el calendario de Google.
   */
  async function conPropuesta(cuerpo: Record<string, unknown> = CAMBIO, estadoSolicitud = 'aprobada') {
    const s = (
      await request(app())
        .post('/api/ausencias/solicitudes')
        .set('Authorization', `Bearer ${token()}`)
        .send(nueva())
        .expect(201)
    ).body as Record<string, unknown>;
    fila(s.id as string).estado = estadoSolicitud;
    const m = (
      await request(app())
        .post(`/api/ausencias/solicitudes/${s.id}/modificaciones`)
        .set('Authorization', `Bearer ${token()}`)
        .send(cuerpo)
        .expect(201)
    ).body as Record<string, unknown>;
    return { solicitudId: s.id as string, modificacionId: m.id as string };
  }

  const decidir = (id: string, body: Record<string, unknown>, tok = token({ sub: JEFA })) =>
    request(app()).post(`/api/ausencias/modificaciones/${id}/decision`).set('Authorization', `Bearer ${tok}`).send(body);

  /** Los avisos de la DECISIÓN, sin contar el del alta de la propuesta. */
  const decisiones = () =>
    estado.eventos.filter((e) => e.evento === 'modificacion_aprobada' || e.evento === 'modificacion_rechazada');

  it('CANDADO: aprobar un cambio de fechas reescribe las tres columnas y NO re-decide la solicitud', async () => {
    // Aprobar un cambio no es aprobar la solicitud: una `aprobada` sigue
    // `aprobada` y una `pendiente` sigue `pendiente`. Si esto tocara el estado,
    // una solicitud en trámite quedaría concedida por la puerta de atrás, sin
    // que ninguno de sus firmantes la hubiera firmado.
    const { solicitudId, modificacionId } = await conPropuesta();
    const r = await decidir(modificacionId, { aprueba: true }).expect(200);

    expect(r.body.modificacion).toMatchObject({ id: modificacionId, estado: 'aprobada' });
    expect(fila(solicitudId)).toMatchObject({
      fechaInicio: '2026-07-13',
      fechaFin: '2026-07-15',
      diasHabiles: 3,
      estado: 'aprobada',
    });
    // Y no se ha anulado nada por el camino.
    expect(fila(solicitudId).anuladaAt).toBeNull();
    expect(decisiones()).toHaveLength(1);
  });

  it('sobre una PENDIENTE, el estado tampoco se mueve', async () => {
    const { solicitudId, modificacionId } = await conPropuesta(CAMBIO, 'pendiente');
    await decidir(modificacionId, { aprueba: true }).expect(200);
    expect(fila(solicitudId)).toMatchObject({ estado: 'pendiente', fechaInicio: '2026-07-13' });
  });

  it('aprobar una anulación deja la solicitud rechazada CON `anuladaAt`', async () => {
    // `anulada_at` es lo único que distingue «anulada» de «rechazada por el
    // jefe»: sin él, el historial diría que se la tumbaron.
    const { solicitudId, modificacionId } = await conPropuesta({
      clase: 'anulacion',
      motivo: 'Se cancela el viaje',
    });
    await decidir(modificacionId, { aprueba: true }).expect(200);

    expect(fila(solicitudId)).toMatchObject({
      estado: 'rechazada',
      // El motivo del TRABAJADOR: es lo único que explica por qué unos días
      // concedidos no se disfrutaron.
      motivoRechazo: 'Se cancela el viaje',
      // Las fechas no se tocan: la ausencia anulada sigue diciendo cuál era.
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-10',
    });
    expect(fila(solicitudId).anuladaAt).not.toBeNull();
  });

  it('CANDADO: rechazar deja la solicitud IDÉNTICA', async () => {
    const { solicitudId, modificacionId } = await conPropuesta();
    const { modificacionPendiente: _viva, ...antes } = { ...fila(solicitudId) };

    const r = await decidir(modificacionId, { aprueba: false, motivo: 'Ya está cubierto el turno' }).expect(200);

    const { modificacionPendiente: despuesViva, ...despues } = fila(solicitudId);
    // El objeto ENTERO y no campo a campo: así un campo que alguien empiece a
    // tocar al rechazar —`decididaAt`, `motivoRechazo`, `anuladaAt`— sale rojo
    // sin que nadie tenga que acordarse de añadirlo a la lista.
    expect(despues).toEqual(antes);
    // Lo único que cambia es que la propuesta deja de estar viva: sale del
    // índice único parcial y por tanto del LEFT JOIN.
    expect(despuesViva).toBeNull();
    expect(r.body.modificacion).toMatchObject({ estado: 'rechazada', motivoRechazo: 'Ya está cubierto el turno' });
  });

  it('403 al OTRO firmante congelado de la solicitud', async () => {
    // Gerencia es el segundo firmante de esta solicitud, pero el decisor
    // congelado en la propuesta es la jefa. Un OR de los dos correos —la forma
    // natural de escribir el guard— dejaría pasar esto.
    const { modificacionId } = await conPropuesta();
    const r = await decidir(modificacionId, { aprueba: true }, token({ sub: GERENCIA })).expect(403);
    expect(r.body.error).toBe('no_es_su_aprobacion');
    expect(estado.modificaciones[0].estado).toBe('pendiente');
    expect(decisiones()).toHaveLength(0);
  });

  it('CANDADO: 403 al propio solicitante aunque sea SU PROPIO decisor congelado', async () => {
    // La raíz del organigrama se declara como su propio jefe —`fijarJefe` lo
    // admite y hay un test que lo fija—, así que `decisorDeModificacion` le
    // devuelve su propio correo y sin el guard se autoaprobaría el cambio.
    //
    // Se monta ese caso y no uno con Ana pidiendo sobre la propuesta de la jefa:
    // ahí el 403 saldría igual por no ser la decisora, y el candado pasaría por
    // construcción sin vigilar nada.
    const s = (
      await request(app())
        .post('/api/ausencias/solicitudes')
        .set('Authorization', `Bearer ${token()}`)
        .send(nueva())
        .expect(201)
    ).body as Record<string, unknown>;
    Object.assign(fila(s.id as string), {
      estado: 'aprobada',
      aprobadorCorreo: 'ana.ruiz@ambientalia.com.co',
      segundoAprobadorCorreo: null,
    });
    const m = (
      await request(app())
        .post(`/api/ausencias/solicitudes/${s.id}/modificaciones`)
        .set('Authorization', `Bearer ${token()}`)
        .send(CAMBIO)
        .expect(201)
    ).body as Record<string, unknown>;
    expect(m.aprobadorCorreo).toBe('ana.ruiz@ambientalia.com.co');

    const r = await decidir(m.id as string, { aprueba: true }, token()).expect(403);
    expect(r.body.error).toBe('no_es_su_aprobacion');
    expect(estado.modificaciones[0].estado).toBe('pendiente');
    expect(decisiones()).toHaveLength(0);
  });

  it('200 al admin: es quien destraba una decisión bloqueada', async () => {
    const { solicitudId, modificacionId } = await conPropuesta();
    await decidir(modificacionId, { aprueba: true }, token({ sub: 'admin@ambientalia.com.co', role: 'admin' })).expect(
      200,
    );
    expect(fila(solicitudId).fechaInicio).toBe('2026-07-13');
  });

  it('CANDADO de doble clic: 200 y 409, y UN SOLO evento en el outbox', async () => {
    // Dos clics no pueden mandar dos correos contradictorios sobre la misma
    // propuesta.
    const { modificacionId } = await conPropuesta();
    await decidir(modificacionId, { aprueba: true }).expect(200);
    const r = await decidir(modificacionId, { aprueba: false, motivo: 'me arrepiento' }).expect(409);
    expect(r.body.error).toBe('ya_decidida');
    expect(decisiones()).toHaveLength(1);
    expect(decisiones()[0].evento).toBe('modificacion_aprobada');
  });

  it('CANDADO del testigo triple: un PATCH de admin entre medias da 409 y NO le pisa las fechas', async () => {
    // La carrera que solo detectan los tres campos: el estado no cambia, las
    // fechas sí. Y el `PATCH` no encola nada —corregir el registro no es
    // decidir—, así que sin el testigo la aprobación borraría la corrección del
    // admin sin dejar rastro en ningún sitio.
    const { solicitudId, modificacionId } = await conPropuesta();
    await request(app())
      .patch(`/api/ausencias/solicitudes/${solicitudId}`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({
        empleadoId: E1,
        tipo: 'vacaciones',
        fechaInicio: '2026-07-07',
        fechaFin: '2026-07-09',
        dias: 3,
        estado: 'aprobada',
        comentarios: 'Corregido a mano',
        observaciones: null,
      })
      .expect(200);

    const r = await decidir(modificacionId, { aprueba: true }).expect(409);
    expect(r.body.error).toBe('solicitud_cambio_de_estado');
    // Las fechas del admin siguen ahí.
    expect(fila(solicitudId)).toMatchObject({ fechaInicio: '2026-07-07', fechaFin: '2026-07-09' });
    // Y la propuesta sigue viva, para que alguien la mire.
    expect(estado.modificaciones[0].estado).toBe('pendiente');
    expect(decisiones()).toHaveLength(0);
  });

  it('CANDADO de atomicidad: si el UPDATE de la solicitud no encuentra fila, no se decide NI se encola nada', async () => {
    // El jefe rechaza la solicitud entera mientras la propuesta espera. Sin la
    // transacción, la propuesta quedaría «aprobada» sobre una solicitud sin
    // cambiar y el correo anunciaría un cambio que no ha ocurrido: el trabajador
    // se iría las fechas del correo y en el registro constarían otras.
    const { solicitudId, modificacionId } = await conPropuesta();
    fila(solicitudId).estado = 'rechazada';

    const r = await decidir(modificacionId, { aprueba: true }).expect(409);
    expect(r.body.error).toBe('solicitud_cambio_de_estado');
    expect(estado.modificaciones[0].estado).toBe('pendiente');
    expect(estado.modificaciones[0].decididaAt).toBeNull();
    expect(decisiones()).toHaveLength(0);
  });

  it('rechazar SÍ funciona aunque la solicitud se haya movido: no hay nada que aplicar', async () => {
    // La asimetría es deliberada: el testigo protege la ESCRITURA sobre la
    // solicitud, y un rechazo no escribe nada en ella. Bloquearlo también
    // dejaría la propuesta muerta en la bandeja del jefe sin forma de quitarla.
    const { solicitudId, modificacionId } = await conPropuesta();
    fila(solicitudId).estado = 'rechazada';
    await decidir(modificacionId, { aprueba: false, motivo: 'Ya no aplica' }).expect(200);
    expect(estado.modificaciones[0].estado).toBe('rechazada');
  });

  it('404 si la propuesta no existe', async () => {
    const r = await decidir('no-existe', { aprueba: true }).expect(404);
    expect(r.body.error).toBe('no_encontrada');
  });

  it('409 al decidir una que el autor ya había retirado', async () => {
    const { modificacionId } = await conPropuesta();
    await request(app())
      .post(`/api/ausencias/modificaciones/${modificacionId}/retirar`)
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    const r = await decidir(modificacionId, { aprueba: true }).expect(409);
    expect(r.body.error).toBe('ya_decidida');
    expect(decisiones()).toHaveLength(0);
  });

  it('400 si falta `aprueba` o el motivo es kilométrico', async () => {
    const { modificacionId } = await conPropuesta();
    const sin = await decidir(modificacionId, {}).expect(400);
    expect(sin.body).toMatchObject({ error: 'aprueba_requerido', field: 'aprueba' });
    const largo = await decidir(modificacionId, { aprueba: false, motivo: 'x'.repeat(1001) }).expect(400);
    expect(largo.body).toMatchObject({ error: 'motivo_demasiado_largo', field: 'motivo' });
    expect(estado.modificaciones[0].estado).toBe('pendiente');
  });

  it('el aviso de la decisión va a la cadena ENTERA y sale sin calendario ni hoja', async () => {
    // Comprobado sobre el payload HTTP, que es el contrato que n8n lee: con un
    // `calendario` aquí, n8n crearía un evento nuevo en vez de corregir el viejo
    // y la persona aparecería dos veces de vacaciones.
    const { modificacionId } = await conPropuesta();
    await decidir(modificacionId, { aprueba: true }).expect(200);

    const p = await request(app())
      .get('/api/ausencias/n8n/pendiente')
      .set('X-Ausencias-Cron-Token', 'cron-ausencias')
      .expect(200);
    const evento = p.body.eventos.find((e: { evento: string }) => e.evento === 'modificacion_aprobada');
    expect(evento).toBeTruthy();
    expect(evento.payload).toHaveProperty('calendario', null);
    expect(evento.payload).toHaveProperty('hoja', null);
    // El primer firmante avaló unas fechas: tiene que enterarse de que cambiaron.
    expect(evento.payload.correo.para).toContain('ana.ruiz@ambientalia.com.co');
    expect(evento.payload.correo.para).toContain(JEFA);
    expect(evento.payload.correo.para).toContain(GERENCIA);
    // Y lleva las cuatro fechas, no solo las nuevas.
    expect(evento.payload.correo.cuerpo).toContain('2026-07-06 a 2026-07-10');
    expect(evento.payload.correo.cuerpo).toContain('2026-07-13 a 2026-07-15');
  });

  it('401 sin token y 403 sin la app asignada', async () => {
    const { modificacionId } = await conPropuesta();
    await request(app()).post(`/api/ausencias/modificaciones/${modificacionId}/decision`).send({ aprueba: true }).expect(401);
    await decidir(modificacionId, { aprueba: true }, token({ sub: JEFA, apps: ['contabilidad'] })).expect(403);
  });
});

describe('GET /ausencias/modificaciones/pendientes', () => {
  const JEFA = 'jefa.directa@ambientalia.com.co';
  const OTRO_JEFE = 'otro.jefe@ambientalia.com.co';
  const CAMBIO = { clase: 'fechas', fechaInicio: '2026-07-13', fechaFin: '2026-07-15' };

  const fila = (id: string) => estado.solicitudes.find((s) => s.id === id) as Record<string, unknown>;

  /** Una solicitud con propuesta viva, con el decisor que se le indique. */
  async function conPropuesta(decisor: string, over: Record<string, unknown> = {}) {
    const s = (
      await request(app())
        .post('/api/ausencias/solicitudes')
        .set('Authorization', `Bearer ${token()}`)
        .send(nueva(over))
        .expect(201)
    ).body as Record<string, unknown>;
    // El decisor sale de la SOLICITUD (`decisorDeModificacion`), así que se
    // ajusta ahí y no en el cuerpo de la petición: el cliente no lo elige.
    Object.assign(fila(s.id as string), { aprobadorCorreo: decisor, segundoAprobadorCorreo: null });
    await request(app())
      .post(`/api/ausencias/solicitudes/${s.id}/modificaciones`)
      .set('Authorization', `Bearer ${token()}`)
      .send(CAMBIO)
      .expect(201);
    return s.id as string;
  }

  const bandeja = async (tok: string) =>
    (
      await request(app())
        .get('/api/ausencias/modificaciones/pendientes')
        .set('Authorization', `Bearer ${tok}`)
        .expect(200)
    ).body.solicitudes as Record<string, unknown>[];

  it('el jefe ve las suyas y solo las suyas', async () => {
    await conPropuesta(JEFA);
    await conPropuesta(OTRO_JEFE, { fechaInicio: '2026-08-03', fechaFin: '2026-08-05' });

    const suyas = await bandeja(token({ sub: JEFA }));
    expect(suyas).toHaveLength(1);
    // Viene la solicitud entera con su propuesta colgada: sin ella la bandeja no
    // podría pintar ni de quién es ni qué se pide.
    expect(suyas[0].modificacionPendiente).toMatchObject({ clase: 'fechas', aprobadorCorreo: JEFA });
    expect(suyas[0].empleadoNombre).toBe('Ana Ruiz');
  });

  it('un admin las ve todas', async () => {
    await conPropuesta(JEFA);
    await conPropuesta(OTRO_JEFE, { fechaInicio: '2026-08-03', fechaFin: '2026-08-05' });
    expect(await bandeja(token({ sub: 'admin@ambientalia.com.co', role: 'admin' }))).toHaveLength(2);
  });

  it('quien no tiene ninguna recibe lista vacía y 200, no 403', async () => {
    // Mismo criterio que `/ausencias/decididas`: va acotada al propio correo, así
    // que un 403 no aportaría nada y obligaría a la app a saber de antemano si
    // alguien es decisor de algo.
    await conPropuesta(JEFA);
    expect(await bandeja(token({ sub: 'nadie@ambientalia.com.co' }))).toEqual([]);
  });

  it('la solicitud sin propuesta viva no sale, aunque le toque a ese jefe', async () => {
    const id = await conPropuesta(JEFA);
    const m = estado.modificaciones[0];
    await request(app())
      .post(`/api/ausencias/modificaciones/${m.id}/decision`)
      .set('Authorization', `Bearer ${token({ sub: JEFA })}`)
      .send({ aprueba: true })
      .expect(200);
    expect(await bandeja(token({ sub: JEFA }))).toHaveLength(0);
    // La solicitud sigue ahí: lo que desapareció es la propuesta.
    expect(fila(id)).toBeTruthy();
  });

  it('401 sin token y 403 sin la app asignada', async () => {
    await request(app()).get('/api/ausencias/modificaciones/pendientes').expect(401);
    await request(app())
      .get('/api/ausencias/modificaciones/pendientes')
      .set('Authorization', `Bearer ${token({ apps: ['contabilidad'] })}`)
      .expect(403);
  });
});

describe('PUT /ausencias/empleados/:id/segunda-firma', () => {
  it('un admin apaga la segunda firma de alguien', async () => {
    const r = await request(app())
      .put(`/api/ausencias/empleados/${E1}/segunda-firma`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ requiereSegundaFirma: false })
      .expect(200);
    expect(r.body).toMatchObject({ id: E1, requiereSegundaFirma: false });
  });

  it('y la vuelve a encender', async () => {
    estado.plantilla[0].requiereSegundaFirma = false;
    const r = await request(app())
      .put(`/api/ausencias/empleados/${E1}/segunda-firma`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ requiereSegundaFirma: true })
      .expect(200);
    expect(r.body).toHaveProperty('requiereSegundaFirma', true);
  });

  it('400 si el cuerpo no trae un booleano', async () => {
    // `'no'` es una cadena con valor de verdad: sin la comprobación de tipo,
    // apagar la casilla desde un cliente descuidado la dejaría encendida.
    const r = await request(app())
      .put(`/api/ausencias/empleados/${E1}/segunda-firma`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ requiereSegundaFirma: 'no' })
      .expect(400);
    expect(r.body.error).toBe('segunda_firma_invalida');
  });

  it('400 si el cuerpo viene vacío', async () => {
    const r = await request(app())
      .put(`/api/ausencias/empleados/${E1}/segunda-firma`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({})
      .expect(400);
    expect(r.body.error).toBe('segunda_firma_invalida');
  });

  it('404 si el empleado no existe', async () => {
    const r = await request(app())
      .put(`/api/ausencias/empleados/${E_FANTASMA}/segunda-firma`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ requiereSegundaFirma: false })
      .expect(404);
    // Sin esto, el test también pasaría si la ruta no estuviera montada: Express
    // devuelve 404 para cualquier path desconocido y los dos casos serían
    // indistinguibles.
    expect(r.body.error).toBe('empleado_no_encontrado');
  });

  it('403 a quien no es admin', async () => {
    await request(app())
      .put(`/api/ausencias/empleados/${E1}/segunda-firma`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ requiereSegundaFirma: false })
      .expect(403);
  });
});
