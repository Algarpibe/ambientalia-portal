import { describe, it, expect } from 'vitest';
import {
  AusenciaError,
  nombreArchivoNormalizado,
  puedeDecidir,
  puedePedirModificacion,
  puedeVerAdjunto,
  validarNuevaModificacion,
  validarNuevaSolicitud,
  validarSaldo,
  type Sesion,
} from './service.js';
import { decisorDeModificacion, transicionAlDecidir, type EstadoSolicitud, type Solicitud } from './types.js';

const PDF_BASE64 = Buffer.from('%PDF-1.4 fake').toString('base64');

function nueva(over: Record<string, unknown> = {}) {
  return { tipo: 'vacaciones', fechaInicio: '2026-07-06', fechaFin: '2026-07-10', ...over };
}

/**
 * Un «hoy» anterior a las fechas de `nueva()`, para que su rango caiga en el
 * futuro. Va fijo y no `hoyEnColombia()`: con la fecha real, estos tests
 * empezarían a fallar solos el 7 de julio de 2026 por la regla de fechas
 * pasadas, sin que nadie hubiera tocado el código.
 */
const HOY = '2026-07-01';

/** `validarNuevaSolicitud` con el «hoy» fijo, que es lo que quiere casi todo el fichero. */
const validar = (body: unknown, hoy: string = HOY) => validarNuevaSolicitud(body, hoy);

function solicitud(over: Partial<Solicitud> = {}): Solicitud {
  return {
    id: 's1',
    tipo: 'vacaciones',
    empleadoId: 'e1',
    empleadoNombre: 'Gustavo Novoa',
    empleadoCargo: 'Director Técnico',
    solicitanteEmail: 'director.tecnico@ambientalia.com.co',
    fechaInicio: '2026-07-06',
    fechaFin: '2026-07-10',
    diasHabiles: 5,
    comentarios: 'Viaje familiar',
    observaciones: null,
    origen: 'portal',
    estado: 'pendiente',
    aprobadorCorreo: 'comercial@ambientalia.com.co',
    segundoAprobadorCorreo: null,
    informadoCorreo: null,
    primeraFirmaAt: null,
    decididaAt: null,
    motivoRechazo: null,
    createdAt: '2026-06-01T10:00:00Z',
    adjunto: null,
    // Este fichero no prueba copias: null es el valor neutro.
    copiaCorreo: null,
    // Sin propuesta de cambio viva y sin anular: el estado de casi todas.
    modificacionPendiente: null,
    anuladaAt: null,
    ...over,
  };
}

describe('validarNuevaSolicitud', () => {
  it('acepta una solicitud correcta y limpia los comentarios', () => {
    const r = validar(nueva({ comentarios: '  Viaje  ' }));
    expect(r).toMatchObject({ tipo: 'vacaciones', fechaInicio: '2026-07-06', comentarios: 'Viaje' });
  });

  it('rechaza un tipo que no existe', () => {
    expect(() => validar(nueva({ tipo: 'sabatico' }))).toThrow(
      expect.objectContaining({ code: 'tipo_invalido', status: 400 }),
    );
  });

  it('rechaza fechas que no son de calendario', () => {
    expect(() => validar(nueva({ fechaInicio: '2026-02-30' }))).toThrow(
      expect.objectContaining({ code: 'fecha_invalida', field: 'fechaInicio' }),
    );
  });

  it('rechaza unas vacaciones que empiezan antes de hoy', () => {
    // Pedir aprobación de algo que ya ocurrió no tiene sentido: cuando llegue la
    // firma, los días ya se disfrutaron (o no) y el saldo ya no se puede reservar.
    expect(() => validar(nueva({ fechaInicio: '2026-06-30', fechaFin: '2026-07-10' }))).toThrow(
      expect.objectContaining({ code: 'fecha_en_pasado', status: 400, field: 'fechaInicio' }),
    );
  });

  it('acepta unas vacaciones que empiezan HOY', () => {
    // El límite es «anterior a hoy», no «posterior a hoy»: pedir el mismo día es
    // legítimo y es justo el caso que un `<` mal puesto rompería en silencio.
    expect(validar(nueva({ fechaInicio: HOY, fechaFin: '2026-07-10' }))).toMatchObject({ fechaInicio: HOY });
  });

  it('acepta una incapacidad con fechas ya pasadas', () => {
    // La excepción que justifica que la regla mire el tipo. Una incapacidad se
    // INFORMA después de haber estado enfermo: uno va al médico, vuelve y sube el
    // soporte. Exigirle fecha de hoy en adelante haría imposible el caso normal.
    const r = validar(
      nueva({
        tipo: 'incapacidad',
        fechaInicio: '2026-06-01',
        fechaFin: '2026-06-03',
        adjunto: { nombreArchivo: 'inc.pdf', mime: 'application/pdf', contenidoBase64: PDF_BASE64 },
      }),
    );
    expect(r).toMatchObject({ tipo: 'incapacidad', fechaInicio: '2026-06-01' });
  });

  it('la regla del pasado también tapa permisos y compensatorios', () => {
    // Los tres tipos que requieren aprobación van juntos: si la regla mirara solo
    // `vacaciones`, quedaría abierta la misma puerta por otro lado.
    for (const tipo of ['permiso', 'compensatorio'] as const) {
      expect(() => validar(nueva({ tipo, fechaInicio: '2026-06-30' }))).toThrow(
        expect.objectContaining({ code: 'fecha_en_pasado', field: 'fechaInicio' }),
      );
    }
  });

  it('rechaza el rango invertido', () => {
    expect(() => validar(nueva({ fechaInicio: '2026-07-10', fechaFin: '2026-07-06' }))).toThrow(
      expect.objectContaining({ code: 'rango_invertido' }),
    );
  });

  it('rechaza rangos de más de un año', () => {
    expect(() => validar(nueva({ fechaFin: '2028-07-10' }))).toThrow(
      expect.objectContaining({ code: 'rango_demasiado_largo' }),
    );
  });

  it('exige adjunto en las incapacidades', () => {
    // Es el único tipo que nadie aprueba: el soporte médico es lo único que lo
    // respalda, así que sin él no se registra.
    expect(() => validar(nueva({ tipo: 'incapacidad' }))).toThrow(
      expect.objectContaining({ code: 'adjunto_requerido' }),
    );
  });

  it('acepta la incapacidad con su PDF', () => {
    const r = validar(
      nueva({ tipo: 'incapacidad', adjunto: { nombreArchivo: 'inc.pdf', mime: 'application/pdf', contenidoBase64: PDF_BASE64 } }),
    );
    expect(r.adjunto?.nombreArchivo).toBe('inc.pdf');
  });

  it('no permite adjuntar algo que no sea un PDF', () => {
    expect(() =>
      validar(
        nueva({ tipo: 'permiso', adjunto: { nombreArchivo: 'x.exe', mime: 'application/x-msdownload', contenidoBase64: PDF_BASE64 } }),
      ),
    ).toThrow(expect.objectContaining({ code: 'adjunto_no_es_pdf' }));
  });

  it('rechaza un adjunto por encima del tope sin llegar a decodificarlo', () => {
    const enorme = 'A'.repeat(12 * 1024 * 1024); // ~9 MB una vez decodificado
    expect(() =>
      validar(
        nueva({ tipo: 'incapacidad', adjunto: { nombreArchivo: 'i.pdf', mime: 'application/pdf', contenidoBase64: enorme } }),
      ),
    ).toThrow(expect.objectContaining({ code: 'adjunto_demasiado_grande' }));
  });

  it('el permiso puede ir sin adjunto', () => {
    expect(validar(nueva({ tipo: 'permiso' })).adjunto).toBeUndefined();
  });

  it('ignora cualquier empleadoId o diasHabiles que mande el cliente', () => {
    // La identidad sale de la sesión y los días se calculan en el servidor: si
    // estos campos se colaran, cualquiera podría pedir vacaciones a nombre de
    // otro o declararse 40 días hábiles en una semana.
    const r = validar(nueva({ empleadoId: 'otro', diasHabiles: 99 })) as unknown as Record<string, unknown>;
    expect(r.empleadoId).toBeUndefined();
    expect(r.diasHabiles).toBeUndefined();
  });
});

describe('nombreArchivoNormalizado', () => {
  it('mantiene la convención del flujo de n8n', () => {
    expect(nombreArchivoNormalizado('incapacidad', 'Ana Ruiz', '2026-07-06')).toBe(
      'Incapacidades_Ana_Ruiz_2026-07-06_1.pdf',
    );
  });

  it('quita tildes y ñ del nombre', () => {
    expect(nombreArchivoNormalizado('permiso', 'José Muñoz Peña', '2026-07-06')).toBe(
      'Permisos_Jose_Munoz_Pena_2026-07-06_1.pdf',
    );
  });

  it('aguanta un nombre de una sola palabra', () => {
    expect(nombreArchivoNormalizado('permiso', 'Madonna', '2026-07-06')).toBe('Permisos_Madonna_Apellidos_2026-07-06_1.pdf');
  });
});

describe('permisos', () => {
  const yo: Sesion = { email: 'comercial@ambientalia.com.co', userId: 'u1', esAdmin: false };
  const otro: Sesion = { email: 'alguien@ambientalia.com.co', userId: 'u2', esAdmin: false };
  const admin: Sesion = { email: 'admin@ambientalia.com.co', userId: 'u3', esAdmin: true };

  it('solo decide quien la tiene asignada', () => {
    expect(puedeDecidir(yo, solicitud())).toBe(true);
    expect(puedeDecidir(otro, solicitud())).toBe(false);
  });

  it('el admin puede decidir cualquiera — es quien destraba una aprobación parada', () => {
    expect(puedeDecidir(admin, solicitud())).toBe(true);
  });

  it('compara correos sin distinguir mayúsculas', () => {
    expect(puedeDecidir({ ...yo, email: 'COMERCIAL@Ambientalia.com.co' }, solicitud())).toBe(true);
  });

  it('el PDF solo lo ven el solicitante, sus dos aprobadores y un admin', () => {
    const adj = {
      solicitudId: 's1',
      solicitanteEmail: 'director.tecnico@ambientalia.com.co',
      aprobadorCorreo: 'comercial@ambientalia.com.co',
      segundoAprobadorCorreo: null,
      nombreArchivo: 'i.pdf',
      mime: 'application/pdf',
      contenido: Buffer.from(''),
    };
    expect(puedeVerAdjunto({ ...otro, email: 'director.tecnico@ambientalia.com.co' }, adj, false)).toBe(true);
    expect(puedeVerAdjunto(yo, adj, false)).toBe(true);
    expect(puedeVerAdjunto(admin, adj, false)).toBe(true);
    expect(puedeVerAdjunto(otro, adj, false)).toBe(false);
  });

  it('administración abre el PDF de un tercero con el que no tiene ninguna relación', () => {
    const adj = {
      solicitudId: 's1',
      solicitanteEmail: 'ajena@ambientalia.com.co',
      aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
      segundoAprobadorCorreo: null,
      nombreArchivo: 'incapacidad.pdf',
      mime: 'application/pdf',
      contenido: Buffer.from(''),
    };
    const visor = { email: 'administrativo@ambientalia.com.co', userId: null, esAdmin: false };
    expect(puedeVerAdjunto(visor, adj, true)).toBe(true);
    expect(puedeVerAdjunto(otro, adj, false)).toBe(false);
  });

  it('la llave no mira el correo de la sesión, al contrario que las demás ramas', () => {
    // Se llamaba «el visor entra aunque su correo llegue en MAYÚSCULAS», y dejó de
    // ser cierto: desde que `esVisor` entra por parámetro, la normalización vive
    // en el `lower()` del SQL de `repo.esVisorDeAdjuntos` y aquí ya no se puede
    // probar —no hay Postgres en este fichero—. Lo que sí fija, y por eso no se
    // retira, es que la rama de la llave gana SIN comparar correos, a diferencia
    // de las de solicitante y aprobadores: el correo va en mayúsculas justo para
    // que el test caiga si alguien la reescribiera para mirarlo.
    const adj = {
      solicitudId: 's1',
      solicitanteEmail: 'ajena@ambientalia.com.co',
      aprobadorCorreo: null,
      segundoAprobadorCorreo: null,
      nombreArchivo: 'i.pdf',
      mime: 'application/pdf',
      contenido: Buffer.from(''),
    };
    expect(puedeVerAdjunto({ email: 'ADMINISTRATIVO@AMBIENTALIA.COM.CO', userId: null, esAdmin: false }, adj, true)).toBe(
      true,
    );
  });

  it('el segundo aprobador ve el PDF aunque todavía no sea su turno', () => {
    // La ruta del adjunto devuelve 404, no 403: sin esto tendría que firmar un
    // permiso sin poder abrir su soporte y sin entender por qué.
    const adj = {
      solicitudId: 's1',
      solicitanteEmail: 'director.tecnico@ambientalia.com.co',
      aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
      segundoAprobadorCorreo: 'comercial@ambientalia.com.co',
      nombreArchivo: 'i.pdf',
      mime: 'application/pdf',
      contenido: Buffer.from(''),
    };
    expect(puedeVerAdjunto(yo, adj, false)).toBe(true);
    expect(puedeVerAdjunto(otro, adj, false)).toBe(false);
  });

  it('el visor puede abrir cualquier adjunto', () => {
    // El booleano entra por parámetro y no se consulta aquí: así la regla se
    // puede probar sin Postgres, que es como se prueba todo en este repo.
    const ajeno = { solicitanteEmail: 'otra@ambientalia.com.co', aprobadorCorreo: null, segundoAprobadorCorreo: null } as never;
    expect(puedeVerAdjunto({ email: 'quien.sea@ambientalia.com.co', userId: null, esAdmin: false }, ajeno, true)).toBe(true);
  });

  it('sin la llave no se abre un adjunto ajeno', () => {
    const ajeno = { solicitanteEmail: 'otra@ambientalia.com.co', aprobadorCorreo: null, segundoAprobadorCorreo: null } as never;
    expect(puedeVerAdjunto({ email: 'quien.sea@ambientalia.com.co', userId: null, esAdmin: false }, ajeno, false)).toBe(false);
  });

  it('quitar la llave no cierra el adjunto a quien lo pidió ni a quien lo firma', () => {
    // La llave AÑADE acceso, no lo condiciona: si al retirarla se perdiera el
    // acceso propio, quitársela a alguien le dejaría sin ver sus propias
    // solicitudes.
    const sesion = { email: 'ana@ambientalia.com.co', userId: null, esAdmin: false };
    const propio = { solicitanteEmail: 'ana@ambientalia.com.co', aprobadorCorreo: null, segundoAprobadorCorreo: null } as never;
    const aFirmar = { solicitanteEmail: 'otra@ambientalia.com.co', aprobadorCorreo: 'ana@ambientalia.com.co', segundoAprobadorCorreo: null } as never;
    expect(puedeVerAdjunto(sesion, propio, false)).toBe(true);
    expect(puedeVerAdjunto(sesion, aFirmar, false)).toBe(true);
  });
});

describe('transicionAlDecidir', () => {
  const conSegundo = { estado: 'pendiente' as const, segundoAprobadorCorreo: 'comercial@ambientalia.com.co' };
  const sinSegundo = { estado: 'pendiente' as const, segundoAprobadorCorreo: null };

  it('la primera firma de dos sube a pendiente_2 y NO cierra la solicitud', () => {
    // El mutante que muere aquí: encolar `aprobada` en la primera firma manda el
    // correo de aprobada y crea el evento de Google Calendar antes de tiempo.
    expect(transicionAlDecidir(conSegundo, true)).toEqual({
      estado: 'pendiente_2',
      evento: 'aprobacion_2',
      esPrimeraFirma: true,
      esDecisionFinal: false,
    });
  });

  it('sin segundo aprobador, una sola firma la deja aprobada', () => {
    // Es el comportamiento anterior a la cascada, y el de toda la plantilla hasta
    // que se rellene el organigrama. Mandar todo a pendiente_2 atascaría a medio
    // mundo el día del despliegue.
    expect(transicionAlDecidir(sinSegundo, true)).toEqual({
      estado: 'aprobada',
      evento: 'aprobada',
      esPrimeraFirma: true,
      esDecisionFinal: true,
    });
  });

  it('la segunda firma cierra la solicitud y no vuelve a sellar la primera', () => {
    expect(transicionAlDecidir({ estado: 'pendiente_2', segundoAprobadorCorreo: 'x@y.com' }, true)).toEqual({
      estado: 'aprobada',
      evento: 'aprobada',
      esPrimeraFirma: false,
      esDecisionFinal: true,
    });
  });

  it('el rechazo es terminal en los dos niveles', () => {
    expect(transicionAlDecidir(conSegundo, false)?.estado).toBe('rechazada');
    expect(transicionAlDecidir({ estado: 'pendiente_2', segundoAprobadorCorreo: 'x@y.com' }, false)?.estado).toBe(
      'rechazada',
    );
  });

  it('un rechazo en el primer nivel también sella la primera firma: el jefe actuó', () => {
    expect(transicionAlDecidir(conSegundo, false)?.esPrimeraFirma).toBe(true);
  });

  it('los estados terminales no admiten firma', () => {
    for (const estado of ['aprobada', 'rechazada', 'registrada'] as const) {
      expect(transicionAlDecidir({ estado, segundoAprobadorCorreo: null }, true)).toBeNull();
    }
  });
});

describe('puedeDecidir con dos firmas', () => {
  const primero = { email: 'jefa.directa@ambientalia.com.co', userId: null, esAdmin: false };
  const segundo = { email: 'comercial@ambientalia.com.co', userId: null, esAdmin: false };
  const enCascada = solicitud({
    aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
    segundoAprobadorCorreo: 'comercial@ambientalia.com.co',
  });

  it('en pendiente firma el jefe inmediato', () => {
    expect(puedeDecidir(primero, enCascada)).toBe(true);
  });

  it('en pendiente el segundo NO se salta la cola', () => {
    // El mutante que muere aquí: escribirlo como un OR de los dos correos —que es
    // la forma más natural— deja al superior firmar solo, y la cascada desaparece
    // sin que nada falle.
    expect(puedeDecidir(segundo, enCascada)).toBe(false);
  });

  it('en pendiente_2 firma el segundo y ya no el primero', () => {
    const subida = { ...enCascada, estado: 'pendiente_2' as const };
    expect(puedeDecidir(segundo, subida)).toBe(true);
    expect(puedeDecidir(primero, subida)).toBe(false);
  });

  it('en estado terminal pasan los dos, para que gane el 409 sobre el 403', () => {
    const cerrada = { ...enCascada, estado: 'aprobada' as const };
    expect(puedeDecidir(primero, cerrada)).toBe(true);
    expect(puedeDecidir(segundo, cerrada)).toBe(true);
  });

  it('un admin destraba en cualquier nivel', () => {
    expect(puedeDecidir({ email: 'a@b.com', userId: null, esAdmin: true }, enCascada)).toBe(true);
  });
});


describe('validarSaldo', () => {
  it('acepta un saldo con decimal y su fecha', () => {
    expect(validarSaldo({ saldoCorte: 12.5, fechaCorte: '2026-08-12' })).toEqual({
      saldoCorte: 12.5,
      fechaCorte: '2026-08-12',
    });
  });

  it('acepta la coma decimal que teclea la gente', () => {
    expect(validarSaldo({ saldoCorte: '12,5', fechaCorte: '2026-08-12' }).saldoCorte).toBe(12.5);
  });

  it('acepta vaciar la configuración con las dos a null', () => {
    expect(validarSaldo({ saldoCorte: null, fechaCorte: null })).toEqual({
      saldoCorte: null,
      fechaCorte: null,
    });
  });

  it('acepta un saldo negativo, que es quien ha adelantado vacaciones', () => {
    // El Excel del que salen los saldos iniciales los trae: significa que esa
    // persona ha disfrutado más días de los que lleva devengados. Rechazarlos
    // era una suposición equivocada, y además contradecía al resto de la app,
    // que sí calcula y pinta un disponible negativo.
    expect(validarSaldo({ saldoCorte: -2.8, fechaCorte: '2026-08-12' }).saldoCorte).toBe(-2.8);
    expect(validarSaldo({ saldoCorte: '-2,8', fechaCorte: '2026-08-12' }).saldoCorte).toBe(-2.8);
    expect(validarSaldo({ saldoCorte: '-2.8333', fechaCorte: '2026-08-12' }).saldoCorte).toBe(-2.8);
  });

  it('rechaza un saldo absurdamente negativo, que es un tecleo', () => {
    expect(() => validarSaldo({ saldoCorte: -1000, fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
  });

  it('no confunde el signo con basura', () => {
    expect(() => validarSaldo({ saldoCorte: '-', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: '--5', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: '5-', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: '-0x10', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
  });

  it('rechaza un saldo que no es número', () => {
    expect(() => validarSaldo({ saldoCorte: 'x', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
  });

  it('rechaza un saldo absurdo por tecleo', () => {
    // NUMERIC(5,1) admite hasta 9999,9, pero 999 días son 66 años de devengo.
    expect(() => validarSaldo({ saldoCorte: 5000, fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
  });

  it('rechaza una fecha inválida', () => {
    expect(() => validarSaldo({ saldoCorte: 10, fechaCorte: '12/08/2026' })).toThrow(AusenciaError);
  });

  it('rechaza los valores mágicos de fecha de Postgres', () => {
    // `'infinity'` y `'today'` son fechas válidas para Postgres. Si se colaran,
    // `::text` las devolvería tal cual y el cálculo del saldo lanzaría.
    expect(() => validarSaldo({ saldoCorte: 10, fechaCorte: 'infinity' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: 10, fechaCorte: 'today' })).toThrow(AusenciaError);
  });

  it('rechaza la configuración a medias', () => {
    // Espejo del CHECK de la BD, para dar un error legible en vez de un fallo de
    // constraint de Postgres.
    expect(() => validarSaldo({ saldoCorte: 10, fechaCorte: null })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: null, fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
  });

  it('en la configuración a medias, señala el campo que falta y no el que sí llegó', () => {
    // Si señalara el que sí llegó, la interfaz resaltaría como culpable
    // justo el campo que el admin rellenó bien.
    expect(() => validarSaldo({ saldoCorte: 10, fechaCorte: null })).toThrow(
      expect.objectContaining({ field: 'fechaCorte' }),
    );
    expect(() => validarSaldo({ saldoCorte: null, fechaCorte: '2026-08-12' })).toThrow(
      expect.objectContaining({ field: 'saldoCorte' }),
    );
  });

  it('rechaza espacios en blanco como saldo, aunque Number() los acepte como 0', () => {
    // Camino de usuario real: el panel de admin usa `type="text"` y teclear
    // solo espacios y guardar no debe colar un saldo de 0 días con un 200.
    expect(() => validarSaldo({ saldoCorte: '  ', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: '\t\n', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
  });

  it('rechaza un array como saldo, que Number() aceptaría vía toString', () => {
    expect(() => validarSaldo({ saldoCorte: [], fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: [5], fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
  });

  it('rechaza hexadecimal y notación científica, que Number() entiende pero nadie teclea a mano', () => {
    expect(() => validarSaldo({ saldoCorte: '0x10', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: '1e2', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
  });

  it('sigue aceptando lo que ya funcionaba bien', () => {
    expect(validarSaldo({ saldoCorte: '12,5', fechaCorte: '2026-08-12' }).saldoCorte).toBe(12.5);
    expect(validarSaldo({ saldoCorte: 0, fechaCorte: '2026-08-12' }).saldoCorte).toBe(0);
    expect(validarSaldo({ saldoCorte: '0', fechaCorte: '2026-08-12' }).saldoCorte).toBe(0);
    expect(validarSaldo({ saldoCorte: 999, fechaCorte: '2026-08-12' }).saldoCorte).toBe(999);
  });

  it('sigue rechazando lo que ya rechazaba bien', () => {
    expect(() => validarSaldo({ saldoCorte: '12.5abc', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: true, fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: {}, fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: '5 ', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: Infinity, fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
  });

  it('rechaza una fecha que no sea string, aunque String() la convierta a algo con forma de fecha', () => {
    expect(() => validarSaldo({ saldoCorte: 10, fechaCorte: ['2026-08-12'] })).toThrow(AusenciaError);
  });

  it('vacía la configuración solo si las dos claves están presentes y en null', () => {
    // Un body sin las claves esperadas no debe colarse como «las dos vacías»:
    // un renombrado de campo en el front (`saldo`/`fecha` en vez de
    // `saldoCorte`/`fechaCorte`) borraría en silencio un saldo ya configurado.
    expect(() => validarSaldo(null)).toThrow(AusenciaError);
    expect(() => validarSaldo({})).toThrow(AusenciaError);
    expect(() => validarSaldo('hola')).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldo: 12.5, fecha: '2026-08-12' })).toThrow(AusenciaError);
  });
});

describe('el informado no hereda ningún permiso del segundo firmante', () => {
  const INFORMADO = 'gerencia@ambientalia.com.co';
  const suSesion = { email: INFORMADO, userId: null, esAdmin: false };

  const sinSegundaFirma = solicitud({
    aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
    segundoAprobadorCorreo: null,
    informadoCorreo: INFORMADO,
  });

  it('no puede firmarla mientras está pendiente', () => {
    expect(puedeDecidir(suSesion, sinSegundaFirma)).toBe(false);
  });

  it('tampoco cuando ya está decidida', () => {
    // En estado terminal `puedeDecidir` deja pasar a los firmantes para que el
    // 409 gane al 403. El informado no es firmante, así que sigue siendo 403.
    expect(puedeDecidir(suSesion, { ...sinSegundaFirma, estado: 'aprobada' })).toBe(false);
  });

  /**
   * El adjunto lleva `informadoCorreo` aunque `AdjuntoCompleto` NO tenga ese
   * campo: hoy la consulta de adjuntos no lo selecciona, y por eso el dato no
   * llega hasta aquí.
   *
   * Ponerlo igualmente es lo que convierte los dos tests de abajo en candados de
   * verdad. Sin él, ampliar `puedeVerAdjunto` para mirar al informado los dejaría
   * en VERDE —la comparación caería contra `undefined`— y estarían afirmando algo
   * mucho más flojo: que un tercero cualquiera no abre el soporte, que ya cubren
   * los tests de más arriba. Se comprobó rompiendo el código a propósito.
   */
  const adjuntoDeLaSolicitud = {
    solicitanteEmail: 'ana.ruiz@ambientalia.com.co',
    aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
    segundoAprobadorCorreo: null,
    informadoCorreo: INFORMADO,
  } as never;

  it('no puede abrir el soporte', () => {
    // Que reciba el correo del resultado no le da acceso al dato de salud que lo
    // respalda: los soportes de las incapacidades son historia clínica.
    expect(puedeVerAdjunto(suSesion, adjuntoDeLaSolicitud, false)).toBe(false);
  });

  it('con la llave maestra sí lo abre, como cualquiera que la tenga', () => {
    // La llave AÑADE acceso y nunca lo condiciona: no ser firmante no puede
    // quitársela a quien la tiene por otra vía.
    expect(puedeVerAdjunto(suSesion, adjuntoDeLaSolicitud, true)).toBe(true);
  });
});

// ── Modificación de una solicitud ya enviada ───────────────────────────────

describe('validarNuevaModificacion', () => {
  /** Las fechas que la solicitud tiene AHORA, contra las que se compara. */
  const ACTUAL = { fechaInicio: '2026-07-06', fechaFin: '2026-07-10' };
  const cambio = (over: Record<string, unknown> = {}) => ({
    clase: 'fechas',
    fechaInicio: '2026-07-13',
    fechaFin: '2026-07-15',
    ...over,
  });
  const validar = (body: unknown) => validarNuevaModificacion(body, ACTUAL);

  it('acepta un cambio de fechas y limpia el motivo', () => {
    expect(validar(cambio({ motivo: '  Cita médica  ' }))).toEqual({
      clase: 'fechas',
      fechaInicio: '2026-07-13',
      fechaFin: '2026-07-15',
      motivo: 'Cita médica',
    });
  });

  it('acepta una anulación, con las tres fechas en null', () => {
    expect(validar({ clase: 'anulacion', motivo: 'Se cancela el viaje' })).toEqual({
      clase: 'anulacion',
      fechaInicio: null,
      fechaFin: null,
      motivo: 'Se cancela el viaje',
    });
  });

  it('rechaza una clase que no existe', () => {
    expect(() => validar(cambio({ clase: 'cambiar_tipo' }))).toThrow(
      expect.objectContaining({ code: 'clase_invalida', status: 400, field: 'clase' }),
    );
    expect(() => validar({})).toThrow(expect.objectContaining({ code: 'clase_invalida' }));
  });

  it('CANDADO: una anulación que trae fechas es 400, no se ignoran en silencio', () => {
    // Un cliente con un bug creería haber pedido un cambio de fechas y habría
    // pedido que le anularan las vacaciones. Aceptarlo «quedándose con la
    // clase» es la forma silenciosa de borrarle los días a alguien.
    expect(() => validar({ clase: 'anulacion', fechaInicio: '2026-07-13', fechaFin: '2026-07-15' })).toThrow(
      expect.objectContaining({ code: 'clase_invalida', status: 400, field: 'clase' }),
    );
    // Con una sola de las dos, también.
    expect(() => validar({ clase: 'anulacion', fechaFin: '2026-07-15' })).toThrow(AusenciaError);
    // Y un input vacío del formulario NO cuenta como fecha.
    expect(() => validar({ clase: 'anulacion', fechaInicio: '', fechaFin: '' })).not.toThrow();
  });

  it('rechaza fechas que no son de calendario', () => {
    expect(() => validar(cambio({ fechaInicio: '2026-02-30' }))).toThrow(
      expect.objectContaining({ code: 'fecha_invalida', field: 'fechaInicio' }),
    );
    expect(() => validar(cambio({ fechaFin: 'mañana' }))).toThrow(
      expect.objectContaining({ code: 'fecha_invalida', field: 'fechaFin' }),
    );
  });

  it('rechaza el rango invertido', () => {
    expect(() => validar(cambio({ fechaInicio: '2026-07-15', fechaFin: '2026-07-13' }))).toThrow(
      expect.objectContaining({ code: 'rango_invertido' }),
    );
  });

  it('rechaza rangos de más de un año', () => {
    expect(() => validar(cambio({ fechaFin: '2028-07-15' }))).toThrow(
      expect.objectContaining({ code: 'rango_demasiado_largo' }),
    );
  });

  it('CANDADO: pedir exactamente las fechas que ya tiene es 400', () => {
    // Si pasara, el jefe recibiría un correo pidiéndole que apruebe dejar todo
    // igual — y a la tercera vez deja de leerlos.
    expect(() => validar(cambio({ fechaInicio: ACTUAL.fechaInicio, fechaFin: ACTUAL.fechaFin }))).toThrow(
      expect.objectContaining({ code: 'sin_cambios', status: 400 }),
    );
  });

  it('cambiar solo una de las dos fechas SÍ es un cambio', () => {
    // El caso principal de la feature: acortar por la cola una ausencia en curso.
    expect(validar(cambio({ fechaInicio: ACTUAL.fechaInicio, fechaFin: '2026-07-08' }))).toMatchObject({
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-08',
    });
  });

  it('NO aplica la regla de «fecha en pasado» del alta', () => {
    // La sustituye la de `fechaFin >= hoy` sobre la solicitud. Sin esto no se
    // podría acortar una ausencia ya empezada, que es el caso que más importa.
    expect(validar(cambio({ fechaInicio: '2020-01-06', fechaFin: '2020-01-08' }))).toMatchObject({
      fechaInicio: '2020-01-06',
    });
  });

  it('rechaza un motivo kilométrico', () => {
    expect(() => validar(cambio({ motivo: 'x'.repeat(2001) }))).toThrow(
      expect.objectContaining({ code: 'motivo_demasiado_largo', field: 'motivo' }),
    );
    expect(validar(cambio({ motivo: 'x'.repeat(2000) })).motivo).toHaveLength(2000);
  });

  it('sin motivo se guarda null, no una cadena vacía', () => {
    expect(validar(cambio()).motivo).toBeNull();
    expect(validar(cambio({ motivo: '   ' })).motivo).toBeNull();
  });

  it('ignora cualquier empleadoId o diasHabiles que mande el cliente', () => {
    // Igual que en el alta: la identidad sale de la sesión y los días los cuenta
    // el servidor. Este test fija que no EXISTA la rama que los lea.
    const r = validar(cambio({ empleadoId: 'otro', diasHabiles: 99 })) as unknown as Record<string, unknown>;
    expect(r.empleadoId).toBeUndefined();
    expect(r.diasHabiles).toBeUndefined();
  });
});

describe('decisorDeModificacion', () => {
  const PRIMERO = 'jefa.directa@ambientalia.com.co';
  const SEGUNDO = 'comercial@ambientalia.com.co';
  const enCascada = (estado: EstadoSolicitud) =>
    solicitud({ estado, aprobadorCorreo: PRIMERO, segundoAprobadorCorreo: SEGUNDO });

  it('en `pendiente` decide el primer firmante', () => {
    expect(decisorDeModificacion(enCascada('pendiente'))).toBe(PRIMERO);
  });

  it('en `pendiente_2` decide el segundo: es a quien le toca el turno', () => {
    expect(decisorDeModificacion(enCascada('pendiente_2'))).toBe(SEGUNDO);
  });

  it('en `aprobada` decide el jefe inmediato, no el segundo', () => {
    // Ya no hay turno que respetar, y exigir dos firmas para RENUNCIAR a unas
    // vacaciones es absurdo. El jefe inmediato es quien reorganiza el trabajo.
    expect(decisorDeModificacion(enCascada('aprobada'))).toBe(PRIMERO);
  });

  it('una incapacidad (`registrada`, sin aprobador) no tiene decisor', () => {
    // Se informa, no se concede: no hay a quién mandarle la petición.
    expect(
      decisorDeModificacion(
        solicitud({ estado: 'registrada', aprobadorCorreo: null, segundoAprobadorCorreo: null }),
      ),
    ).toBeNull();
  });
});

describe('puedePedirModificacion', () => {
  const HOY_MOD = '2026-07-08';
  /** Una solicitud en cascada: los dos firmantes con valor en todos los estados. */
  const conFechaFin = (estado: EstadoSolicitud, fechaFin: string) =>
    solicitud({
      estado,
      fechaFin,
      aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
      segundoAprobadorCorreo: 'comercial@ambientalia.com.co',
    });

  const FUTURA = '2026-07-20';
  const HOY_MISMO = HOY_MOD;
  const PASADA = '2026-07-07';

  it.each(['pendiente', 'pendiente_2', 'aprobada'] as const)('%s admite cambio si aún no ha terminado', (estado) => {
    expect(puedePedirModificacion(conFechaFin(estado, FUTURA), HOY_MOD)).toBe(true);
    // El último día cuenta: la ausencia todavía está en curso.
    expect(puedePedirModificacion(conFechaFin(estado, HOY_MISMO), HOY_MOD)).toBe(true);
    // Ya terminada, no: eso es corrección de nómina, no una aprobación.
    expect(puedePedirModificacion(conFechaFin(estado, PASADA), HOY_MOD)).toBe(false);
  });

  it.each(['rechazada', 'registrada'] as const)('%s no admite cambio en ninguna fecha', (estado) => {
    for (const fechaFin of [FUTURA, HOY_MISMO, PASADA]) {
      expect(puedePedirModificacion(conFechaFin(estado, fechaFin), HOY_MOD)).toBe(false);
    }
  });

  it('la regla mira `fechaFin` y NO `fechaInicio`: una ausencia en curso se puede acortar', () => {
    // Es el caso «córtala, tengo que volver». Con `fechaInicio` esto sería false
    // y la feature no cubriría justo el momento en que más se necesita.
    const enCurso = solicitud({
      estado: 'aprobada',
      fechaInicio: '2026-07-06',
      fechaFin: FUTURA,
      aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
    });
    expect(puedePedirModificacion(enCurso, HOY_MOD)).toBe(true);
  });

  it('sin decisor no admite cambio, aunque el estado y la fecha acompañen', () => {
    // La incapacidad llega aquí por el estado `registrada`, pero el candado real
    // es que no hay a quién mandárselo: una fila sin aprobador tampoco vale.
    const huerfana = solicitud({
      estado: 'aprobada',
      fechaFin: FUTURA,
      aprobadorCorreo: null,
      segundoAprobadorCorreo: null,
    });
    expect(puedePedirModificacion(huerfana, HOY_MOD)).toBe(false);
  });
});
