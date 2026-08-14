import { describe, it, expect } from 'vitest';
import { normalizarNombre, resolverEmpleado, validarFilasHistorico } from './historico.js';
import type { Empleado } from './types.js';

// Nombres inventados a propósito: reproducen las CUATRO formas en que el Excel
// real escribe mal a la misma persona, sin versionar la plantilla de la empresa.
function empleado(nombreCompleto: string, correo: string): Empleado {
  return {
    id: `id-${correo}`,
    nombreCompleto,
    correo,
    cargo: null,
    credencial: null,
    aprobadorCorreo: 'jefe@empresa.test',
    copiaCorreo: null,
    veAdjuntos: false,
    userId: null,
    activo: true,
  };
}

const PLANTILLA = [
  empleado('Ricardo Peñalosa Quintero', 'ricardo@empresa.test'),
  empleado('Lucía Fernández Ortiz', 'lucia@empresa.test'),
  empleado('Ana Torres', 'ana@empresa.test'),
];

describe('normalizarNombre', () => {
  it('quita tildes y mayúsculas y parte en palabras', () => {
    expect(normalizarNombre('Lucía Fernández Ortiz')).toEqual(['LUCIA', 'FERNANDEZ', 'ORTIZ']);
  });

  it('trata la ñ como letra propia, no la borra', () => {
    // Si «Peñalosa» se normalizara a «PEALOSA» seguiría casando consigo mismo,
    // pero dejaría de casar con cualquier grafía que sí conserve la ñ.
    expect(normalizarNombre('Peñalosa')).toEqual(['PENALOSA']);
  });

  it('descarta puntuación y espacios de sobra', () => {
    expect(normalizarNombre('  ANA   TORRES.  ')).toEqual(['ANA', 'TORRES']);
  });
});

describe('resolverEmpleado', () => {
  it('casa el nombre exacto', () => {
    expect(resolverEmpleado('Ana Torres', PLANTILLA).empleado?.correo).toBe('ana@empresa.test');
  });

  it('casa aunque falte un apellido — «Lucía Fernández» es «Lucía Fernández Ortiz»', () => {
    expect(resolverEmpleado('Lucía Fernández', PLANTILLA).empleado?.correo).toBe('lucia@empresa.test');
  });

  it('casa aunque sobre un nombre de pila que el maestro no tiene', () => {
    // El caso real: en la hoja aparece un primer nombre que en el maestro no está.
    expect(resolverEmpleado('José Ricardo Peñalosa Quintero', PLANTILLA).empleado?.correo).toBe(
      'ricardo@empresa.test',
    );
  });

  it('casa en MAYÚSCULAS y sin tildes, como lo escribió alguien a mano', () => {
    expect(resolverEmpleado('LUCIA FERNANDEZ ORTIZ', PLANTILLA).empleado?.correo).toBe('lucia@empresa.test');
  });

  it('casa cuando solo cambia una tilde', () => {
    expect(resolverEmpleado('Lucia Fernandez Ortiz', PLANTILLA).empleado?.correo).toBe('lucia@empresa.test');
  });

  it('devuelve ambigüedad en vez de elegir al azar', () => {
    // Dos hermanas con el mismo apellido: «Ana» sola casa con las dos. Es mejor
    // que la previsualización lo enseñe a que la importación adivine.
    const conHermana = [...PLANTILLA, empleado('Ana Torres Vidal', 'ana.v@empresa.test')];
    const r = resolverEmpleado('Ana Torres', conHermana);
    expect(r.empleado).toBeUndefined();
    expect(r.ambiguo?.length).toBe(2);
  });

  it('devuelve nada cuando no hay a quién parecerse', () => {
    const r = resolverEmpleado('Pedro Ramírez', PLANTILLA);
    expect(r.empleado).toBeUndefined();
    expect(r.ambiguo).toBeUndefined();
  });

  it('no casa por un solo apellido compartido', () => {
    // «Fernández» a secas no debe resolver a «Lucía Fernández Ortiz»: es un
    // subconjunto, sí, pero de una sola palabra. Demasiado flojo para decidir.
    expect(resolverEmpleado('Fernández', PLANTILLA).empleado).toBeUndefined();
  });
});

describe('validarFilasHistorico', () => {
  const fila = (over: Record<string, unknown> = {}) => ({
    nombre: 'Ana Torres',
    tipo: 'Vacaciones',
    fechaInicio: '2026-03-02',
    fechaFin: '2026-03-06',
    dias: 5,
    comentarios: 'Semana de descanso',
    ...over,
  });

  it('traduce la etiqueta de la hoja al tipo interno', () => {
    const r = validarFilasHistorico({ solicitudes: [fila(), fila({ tipo: 'Permisos' }), fila({ tipo: 'Compensatorios' }), fila({ tipo: 'Incapacidades' })] });
    expect(r.map((f) => f.tipo)).toEqual(['vacaciones', 'permiso', 'compensatorio', 'incapacidad']);
  });

  it('conserva el medio día', () => {
    // El 6.5 del Excel es un dato real: redondearlo descuadraría cualquier saldo.
    expect(validarFilasHistorico({ solicitudes: [fila({ dias: 6.5 })] })[0].dias).toBe(6.5);
  });

  it('acepta el «1*» y guarda el asterisco como observación', () => {
    const [f] = validarFilasHistorico({ solicitudes: [fila({ dias: '1*' })] });
    expect(f.dias).toBe(1);
    expect(f.observaciones).toContain('*');
  });

  it('junta la nota al margen con la marca del asterisco', () => {
    const [f] = validarFilasHistorico({
      solicitudes: [fila({ dias: '1*', observaciones: 'El día 13 se anula por incapacidad' })],
    });
    expect(f.observaciones).toContain('incapacidad');
    expect(f.observaciones).toContain('*');
  });

  it('saca el nombre del PDF del JSON que escribía n8n', () => {
    const [f] = validarFilasHistorico({
      solicitudes: [
        fila({
          tipo: 'Incapacidades',
          adjunto: '[{"filename":"Incapacidad Medica.pdf","mimetype":"application/pdf","size":50365}]',
        }),
      ],
    });
    expect(f.observaciones).toContain('Incapacidad Medica.pdf');
    // Y no el JSON entero, que no le dice nada a nadie.
    expect(f.observaciones).not.toContain('mimetype');
  });

  it('aguanta un adjunto que no es JSON', () => {
    const [f] = validarFilasHistorico({ solicitudes: [fila({ tipo: 'Incapacidades', adjunto: 'escaneo.pdf' })] });
    expect(f.observaciones).toContain('escaneo.pdf');
  });

  it('rechaza una fecha que no existe, diciendo qué fila', () => {
    expect(() => validarFilasHistorico({ solicitudes: [fila(), fila({ fechaInicio: '2026-02-30' })] })).toThrow(
      expect.objectContaining({ field: 'solicitudes[1].fechaInicio' }),
    );
  });

  it('rechaza el rango invertido', () => {
    expect(() => validarFilasHistorico({ solicitudes: [fila({ fechaFin: '2026-03-01' })] })).toThrow(
      expect.objectContaining({ code: 'rango_invertido' }),
    );
  });

  it('rechaza un tipo que no es de los cuatro', () => {
    expect(() => validarFilasHistorico({ solicitudes: [fila({ tipo: 'Licencia' })] })).toThrow(
      expect.objectContaining({ code: 'tipo_invalido' }),
    );
  });

  it('rechaza una lista vacía y una desmesurada', () => {
    expect(() => validarFilasHistorico({ solicitudes: [] })).toThrow();
    const muchas = Array.from({ length: 5001 }, () => fila());
    expect(() => validarFilasHistorico({ solicitudes: muchas })).toThrow(
      expect.objectContaining({ code: 'demasiadas_filas' }),
    );
  });
});
