import { describe, it, expect } from 'vitest';
import {
  AusenciaError,
  nombreArchivoNormalizado,
  puedeDecidir,
  puedeVerAdjunto,
  validarFilasEmpleados,
  validarNuevaSolicitud,
  validarSaldo,
  type Sesion,
} from './service.js';
import type { Solicitud } from './types.js';

const PDF_BASE64 = Buffer.from('%PDF-1.4 fake').toString('base64');

function nueva(over: Record<string, unknown> = {}) {
  return { tipo: 'vacaciones', fechaInicio: '2026-07-06', fechaFin: '2026-07-10', ...over };
}

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
    decididaAt: null,
    motivoRechazo: null,
    createdAt: '2026-06-01T10:00:00Z',
    adjunto: null,
    ...over,
  };
}

describe('validarNuevaSolicitud', () => {
  it('acepta una solicitud correcta y limpia los comentarios', () => {
    const r = validarNuevaSolicitud(nueva({ comentarios: '  Viaje  ' }));
    expect(r).toMatchObject({ tipo: 'vacaciones', fechaInicio: '2026-07-06', comentarios: 'Viaje' });
  });

  it('rechaza un tipo que no existe', () => {
    expect(() => validarNuevaSolicitud(nueva({ tipo: 'sabatico' }))).toThrow(
      expect.objectContaining({ code: 'tipo_invalido', status: 400 }),
    );
  });

  it('rechaza fechas que no son de calendario', () => {
    expect(() => validarNuevaSolicitud(nueva({ fechaInicio: '2026-02-30' }))).toThrow(
      expect.objectContaining({ code: 'fecha_invalida', field: 'fechaInicio' }),
    );
  });

  it('rechaza el rango invertido', () => {
    expect(() => validarNuevaSolicitud(nueva({ fechaInicio: '2026-07-10', fechaFin: '2026-07-06' }))).toThrow(
      expect.objectContaining({ code: 'rango_invertido' }),
    );
  });

  it('rechaza rangos de más de un año', () => {
    expect(() => validarNuevaSolicitud(nueva({ fechaFin: '2028-07-10' }))).toThrow(
      expect.objectContaining({ code: 'rango_demasiado_largo' }),
    );
  });

  it('exige adjunto en las incapacidades', () => {
    // Es el único tipo que nadie aprueba: el soporte médico es lo único que lo
    // respalda, así que sin él no se registra.
    expect(() => validarNuevaSolicitud(nueva({ tipo: 'incapacidad' }))).toThrow(
      expect.objectContaining({ code: 'adjunto_requerido' }),
    );
  });

  it('acepta la incapacidad con su PDF', () => {
    const r = validarNuevaSolicitud(
      nueva({ tipo: 'incapacidad', adjunto: { nombreArchivo: 'inc.pdf', mime: 'application/pdf', contenidoBase64: PDF_BASE64 } }),
    );
    expect(r.adjunto?.nombreArchivo).toBe('inc.pdf');
  });

  it('no permite adjuntar algo que no sea un PDF', () => {
    expect(() =>
      validarNuevaSolicitud(
        nueva({ tipo: 'permiso', adjunto: { nombreArchivo: 'x.exe', mime: 'application/x-msdownload', contenidoBase64: PDF_BASE64 } }),
      ),
    ).toThrow(expect.objectContaining({ code: 'adjunto_no_es_pdf' }));
  });

  it('rechaza un adjunto por encima del tope sin llegar a decodificarlo', () => {
    const enorme = 'A'.repeat(12 * 1024 * 1024); // ~9 MB una vez decodificado
    expect(() =>
      validarNuevaSolicitud(
        nueva({ tipo: 'incapacidad', adjunto: { nombreArchivo: 'i.pdf', mime: 'application/pdf', contenidoBase64: enorme } }),
      ),
    ).toThrow(expect.objectContaining({ code: 'adjunto_demasiado_grande' }));
  });

  it('el permiso puede ir sin adjunto', () => {
    expect(validarNuevaSolicitud(nueva({ tipo: 'permiso' })).adjunto).toBeUndefined();
  });

  it('ignora cualquier empleadoId o diasHabiles que mande el cliente', () => {
    // La identidad sale de la sesión y los días se calculan en el servidor: si
    // estos campos se colaran, cualquiera podría pedir vacaciones a nombre de
    // otro o declararse 40 días hábiles en una semana.
    const r = validarNuevaSolicitud(nueva({ empleadoId: 'otro', diasHabiles: 99 })) as unknown as Record<string, unknown>;
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

  it('el PDF solo lo ven el solicitante, su aprobador y un admin', () => {
    const adj = {
      solicitudId: 's1',
      solicitanteEmail: 'director.tecnico@ambientalia.com.co',
      aprobadorCorreo: 'comercial@ambientalia.com.co',
      nombreArchivo: 'i.pdf',
      mime: 'application/pdf',
      contenido: Buffer.from(''),
    };
    expect(puedeVerAdjunto({ ...otro, email: 'director.tecnico@ambientalia.com.co' }, adj)).toBe(true);
    expect(puedeVerAdjunto(yo, adj)).toBe(true);
    expect(puedeVerAdjunto(admin, adj)).toBe(true);
    expect(puedeVerAdjunto(otro, adj)).toBe(false);
  });
});

describe('validarFilasEmpleados', () => {
  it('normaliza correos a minúsculas', () => {
    const r = validarFilasEmpleados({
      empleados: [{ nombreCompleto: 'Ana Ruiz', correo: 'Ana.Ruiz@Ambientalia.com.co', cargo: ' Analista ' }],
    });
    expect(r[0]).toMatchObject({ correo: 'ana.ruiz@ambientalia.com.co', cargo: 'Analista', credencial: null });
  });

  it('rechaza una fila sin nombre o con correo inválido, diciendo cuál', () => {
    expect(() => validarFilasEmpleados({ empleados: [{ nombreCompleto: '', correo: 'a@b.co' }] })).toThrow(
      expect.objectContaining({ field: 'empleados[0].nombreCompleto' }),
    );
    expect(() =>
      validarFilasEmpleados({ empleados: [{ nombreCompleto: 'Ana', correo: 'a@b.co' }, { nombreCompleto: 'Luis', correo: 'no-es-correo' }] }),
    ).toThrow(expect.objectContaining({ field: 'empleados[1].correo' }));
  });

  it('rechaza una lista vacía y una desmesurada', () => {
    expect(() => validarFilasEmpleados({ empleados: [] })).toThrow(AusenciaError);
    const muchos = Array.from({ length: 501 }, (_, i) => ({ nombreCompleto: `N${i}`, correo: `n${i}@a.co` }));
    expect(() => validarFilasEmpleados({ empleados: muchos })).toThrow(
      expect.objectContaining({ code: 'demasiados_empleados' }),
    );
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

  it('rechaza un saldo negativo', () => {
    expect(() => validarSaldo({ saldoCorte: -1, fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
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
    expect(() => validarSaldo({ saldoCorte: '-5', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
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
