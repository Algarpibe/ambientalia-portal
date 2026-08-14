import { describe, it, expect } from 'vitest';
import {
  AusenciaError,
  nombreArchivoNormalizado,
  puedeDecidir,
  puedeVerAdjunto,
  validarNuevaSolicitud,
  validarSaldo,
  type Sesion,
} from './service.js';
import { transicionAlDecidir, type Solicitud } from './types.js';

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
    primeraFirmaAt: null,
    decididaAt: null,
    motivoRechazo: null,
    createdAt: '2026-06-01T10:00:00Z',
    adjunto: null,
    // Este fichero no prueba copias: null es el valor neutro.
    copiaCorreo: null,
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

  it('el visor entra aunque su correo llegue en MAYÚSCULAS', () => {
    // La normalización de mayúsculas de la llave ya no pasa por aquí: vive en el
    // `lower()` del SQL de `repo.esVisorDeAdjuntos`, sin Postgres en este fichero.
    // Este test se conserva para dejar constancia de que la rama del visor sigue
    // ganando sin mirar el resto de la sesión, sea cual sea el casing con el que
    // llegue el correo.
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
