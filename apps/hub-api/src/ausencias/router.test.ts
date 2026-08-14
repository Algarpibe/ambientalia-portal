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
  eventos: [] as EventoFalso[],
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
  estado.ahora = 0;
  estado.eventos = [];
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

  it('el admin ve los dos niveles en su bandeja', async () => {
    const a = await crear();
    const b = await crear({ fechaInicio: '2026-08-03', fechaFin: '2026-08-05' });
    await decidir(a.id as string, jefa(), { aprueba: true }).expect(200);
    const r = await request(app())
      .get('/api/ausencias/pendientes')
      .set('Authorization', `Bearer ${token({ sub: 'admin@ambientalia.com.co', role: 'admin' })}`)
      .expect(200);
    expect(r.body.solicitudes).toHaveLength(2);
    expect(r.body.solicitudes.map((s: any) => s.estado).sort()).toEqual(['pendiente', 'pendiente_2']);
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

  it('una incapacidad no congela ni firmante ni informado, apagada la casilla o no', async () => {
    // Las incapacidades se INFORMAN, no se aprueban: dejar aquí a alguien la
    // haría aparecer en una bandeja de pendientes que nadie tiene que atender.
    // Su aviso a gerencia sale por `COPIA_INCAPACIDADES`, que esto no toca.
    estado.empleado.requiereSegundaFirma = false;
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
