import { describe, it, expect } from 'vitest';
import { lineasDelCsv } from './registroCsv';
import type { Movimiento } from './api';

// SEC-231 — el CSV del Registro General lleva texto libre que escribe CUALQUIER
// empleado (el motivo de su solicitud), y lo abre en Excel quien lo exporta.
// Un motivo `=HYPERLINK(...)` llegaba como fórmula viva.

type MovimientoDeSolicitud = Extract<Movimiento, { clase: 'solicitud' }>;

const fila = (cambios: Partial<MovimientoDeSolicitud>): MovimientoDeSolicitud =>
  ({
    clase: 'solicitud',
    id: 's1',
    solicitudId: 's1',
    empleadoNombre: 'Ana Ruiz',
    empleadoCargo: null,
    solicitanteEmail: 'ana@ambientalia.com.co',
    tipo: 'vacaciones',
    fechaInicio: '2026-11-02',
    fechaFin: '2026-11-06',
    horaInicio: null,
    horaFin: null,
    diasHabiles: 5,
    decididaAt: null,
    decididaPor: null,
    createdAt: '2026-10-19T10:00:00Z',
    motivo: null,
    estado: 'aprobada',
    anuladaAt: null,
    observaciones: null,
    ...cambios,
  }) as MovimientoDeSolicitud;

describe('lineasDelCsv', () => {
  it('neutraliza un motivo que Excel ejecutaría como fórmula', () => {
    const [, linea] = lineasDelCsv([fila({ motivo: '=HYPERLINK("http://x";"Ver")' })]);
    expect(linea.split(';').length).toBeGreaterThan(1);
    expect(linea).toContain(`"'=HYPERLINK(""http://x"";""Ver"")"`);
    expect(linea).not.toMatch(/(^|;)=/);
  });

  it('las observaciones también: es la otra columna de texto libre', () => {
    const [, linea] = lineasDelCsv([fila({ observaciones: '@SUM(A1)' })]);
    expect(linea.endsWith(";'@SUM(A1)")).toBe(true);
  });

  it('una fila normal sale igual que antes: cabecera, ocho columnas y los días como número', () => {
    const [cab, linea] = lineasDelCsv([fila({ diasHabiles: 6.5, motivo: 'Viaje familiar' })]);
    expect(cab).toBe('Nombre y Apellidos;Tipo;Fecha Inicio;Fecha Fin;Días;Estado;Comentarios;Observaciones');
    expect(linea.split(';')).toEqual(['Ana Ruiz', 'Vacaciones', '2026-11-02', '2026-11-06', '6.5', 'Aprobada', 'Viaje familiar', '']);
  });
});
