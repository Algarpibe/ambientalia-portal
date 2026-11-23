import { describe, it, expect } from 'vitest';
import { validarIncapacidadAjena, validarNuevaSolicitud } from './service.js';

// La validación del alta que hace el administrador a nombre de otro: la de una
// incapacidad del empleado, salvo el límite hacia atrás. Pura, con el «hoy»
// inyectado, como `validarNuevaSolicitud`.

/** Un «hoy» fijo, el mismo que service.test.ts: con el reloj real, «hace un año» se movería solo. */
const HOY = '2026-07-01';
/** Un año antes de HOY, de martes a jueves y sin festivos: muy fuera de la ventana de dos días. */
const HACE_UN_ANO_DESDE = '2025-07-01';
const HACE_UN_ANO_HASTA = '2025-07-03';
const E1 = '11111111-1111-4111-8111-111111111111';
const PDF_BASE64 = Buffer.from('%PDF-1.4 fake').toString('base64');
const soporte = { nombreArchivo: 'baja.pdf', mime: 'application/pdf', contenidoBase64: PDF_BASE64 };

const cuerpo = (over: Record<string, unknown> = {}) => ({
  empleadoId: E1,
  fechaInicio: HACE_UN_ANO_DESDE,
  fechaFin: HACE_UN_ANO_HASTA,
  adjunto: soporte,
  ...over,
});

/** El error que lanza, o null si no lanza. */
function fallo(body: unknown): unknown {
  try {
    validarIncapacidadAjena(body, HOY);
  } catch (e) {
    return e;
  }
  return null;
}

describe('validarIncapacidadAjena', () => {
  it('acepta una incapacidad de hace un año: aquí no hay ventana hacia atrás', () => {
    const r = validarIncapacidadAjena(cuerpo(), HOY);
    expect(r.empleadoId).toBe(E1);
    expect(r.datos).toMatchObject({ tipo: 'incapacidad', fechaInicio: HACE_UN_ANO_DESDE, fechaFin: HACE_UN_ANO_HASTA });
    expect(r.datos.adjunto?.nombreArchivo).toBe('baja.pdf');
  });

  it('CANDADO: la misma fecha por la validación del EMPLEADO se sigue rechazando', () => {
    // La exención es de esta puerta y de ninguna otra: si alguien la moviera a la
    // validación compartida, el empleado podría volver a informar bajas de hace
    // un año por su cuenta.
    expect(() => validarNuevaSolicitud({ ...cuerpo(), tipo: 'incapacidad' }, HOY)).toThrow(
      expect.objectContaining({ code: 'incapacidad_demasiado_antigua' }),
    );
  });

  it('acepta que empiece hoy y acabe después: el médico firma hoy una baja que cubre los próximos días', () => {
    expect(validarIncapacidadAjena(cuerpo({ fechaInicio: HOY, fechaFin: '2026-07-06' }), HOY).datos.fechaInicio).toBe(HOY);
  });

  it('rechaza mañana: incapacidad_en_el_futuro', () => {
    expect(fallo(cuerpo({ fechaInicio: '2026-07-02', fechaFin: '2026-07-03' }))).toMatchObject({
      code: 'incapacidad_en_el_futuro',
      status: 400,
      field: 'fechaInicio',
    });
  });

  it('sigue exigiendo el PDF', () => {
    expect(fallo(cuerpo({ adjunto: undefined }))).toMatchObject({ code: 'adjunto_requerido', status: 400, field: 'adjunto' });
  });

  it('y lo valida igual que al empleado: un no-PDF se rechaza', () => {
    expect(fallo(cuerpo({ adjunto: { ...soporte, mime: 'image/png' } }))).toMatchObject({ code: 'adjunto_no_es_pdf' });
  });

  it('400 empleado_requerido si falta empleadoId o no es una cadena con algo', () => {
    for (const empleadoId of [undefined, null, 42, '', {}]) {
      expect(fallo(cuerpo({ empleadoId })), String(empleadoId)).toMatchObject({
        code: 'empleado_requerido',
        status: 400,
        field: 'empleadoId',
      });
    }
  });

  it('404 empleado_no_encontrado si no tiene forma de uuid: Postgres contestaría un 500', () => {
    expect(fallo(cuerpo({ empleadoId: 'basura' }))).toMatchObject({ code: 'empleado_no_encontrado', status: 404 });
  });

  it('rechaza los días, igual que en la incapacidad del empleado', () => {
    expect(fallo(cuerpo({ dias: 3 }))).toMatchObject({ code: 'dias_no_aplica', field: 'dias' });
  });

  it('rechaza las horas, igual que en la incapacidad del empleado', () => {
    expect(fallo(cuerpo({ horaInicio: '09:00', horaFin: '11:00' }))).toMatchObject({ code: 'hora_no_permitida' });
  });

  it('el tipo lo pone esto: si viaja otro, tipo_invalido; si viaja el mismo, pasa', () => {
    expect(fallo(cuerpo({ tipo: 'vacaciones' }))).toMatchObject({ code: 'tipo_invalido', status: 400, field: 'tipo' });
    expect(validarIncapacidadAjena(cuerpo({ tipo: 'incapacidad' }), HOY).datos.tipo).toBe('incapacidad');
  });

  it('las reglas comunes siguen: rango invertido, más de un año, comentarios demasiado largos', () => {
    expect(fallo(cuerpo({ fechaInicio: HACE_UN_ANO_HASTA, fechaFin: HACE_UN_ANO_DESDE }))).toMatchObject({ code: 'rango_invertido' });
    expect(fallo(cuerpo({ fechaInicio: '2024-07-01', fechaFin: '2026-06-30' }))).toMatchObject({ code: 'rango_demasiado_largo' });
    expect(fallo(cuerpo({ comentarios: 'x'.repeat(2001) }))).toMatchObject({ code: 'comentarios_demasiado_largos' });
  });

  it('limpia los comentarios igual que el alta del empleado', () => {
    expect(validarIncapacidadAjena(cuerpo({ comentarios: '  Avisó su hermana  ' }), HOY).datos.comentarios).toBe(
      'Avisó su hermana',
    );
  });
});
