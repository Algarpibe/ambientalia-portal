import { describe, it, expect } from 'vitest';
import { estaEnElCalendario, cambiaElCalendario, cambiaLaHoja, type Solicitud } from './types.js';

function solicitud(over: Partial<Solicitud> = {}): Solicitud {
  return {
    id: 's1',
    tipo: 'vacaciones',
    empleadoId: 'e1',
    empleadoNombre: 'Ana Ruiz',
    empleadoCargo: 'Analista',
    solicitanteEmail: 'ana.ruiz@ambientalia.com.co',
    fechaInicio: '2026-07-06',
    fechaFin: '2026-07-10',
    diasHabiles: 5,
    comentarios: 'Viaje familiar',
    observaciones: null,
    origen: 'portal',
    estado: 'aprobada',
    aprobadorCorreo: 'comercial@ambientalia.com.co',
    segundoAprobadorCorreo: null,
    informadoCorreo: null,
    primeraFirmaAt: null,
    decididaAt: null,
    motivoRechazo: null,
    createdAt: '2026-06-01T10:00:00Z',
    adjunto: null,
    copiaCorreo: 'administrativo@ambientalia.com.co',
    modificacionPendiente: null,
    anuladaAt: null,
    eventoCalendarioId: null,
    ...over,
  };
}

describe('estaEnElCalendario', () => {
  it('los dos estados que dejan un evento en Google', () => {
    expect(estaEnElCalendario('aprobada')).toBe(true);
    expect(estaEnElCalendario('registrada')).toBe(true);
  });

  it('los tres que no', () => {
    expect(estaEnElCalendario('pendiente')).toBe(false);
    expect(estaEnElCalendario('pendiente_2')).toBe(false);
    expect(estaEnElCalendario('rechazada')).toBe(false);
  });

  // CANDADO. `ocupaAgenda` excluye las incapacidades porque contesta a la regla
  // de solapamiento; esta las incluye porque contesta a que hay en Google. Si
  // alguien "unifica" las dos, este test cae.
  it('CANDADO: una incapacidad registrada SI esta en el calendario', () => {
    expect(estaEnElCalendario('registrada')).toBe(true);
  });
});

describe('cambiaElCalendario', () => {
  const previa = solicitud();

  it('las fechas', () => {
    expect(cambiaElCalendario(previa, solicitud({ fechaInicio: '2026-07-07' }))).toBe(true);
    expect(cambiaElCalendario(previa, solicitud({ fechaFin: '2026-07-13' }))).toBe(true);
  });

  it('el resumen: tipo y empleado', () => {
    expect(cambiaElCalendario(previa, solicitud({ tipo: 'permiso' }))).toBe(true);
    expect(cambiaElCalendario(previa, solicitud({ empleadoId: 'e2' }))).toBe(true);
  });

  it('la presencia: salir del calendario cuenta', () => {
    expect(cambiaElCalendario(previa, solicitud({ estado: 'rechazada' }))).toBe(true);
  });

  // CANDADO. Es el caso mas corriente del historico importado, donde el Excel
  // anoto recuentos que no cuadran. Sin este `false`, corregirlo manda a Google
  // un update identico y un correo diciendo que se corrigio algo.
  it('CANDADO: los dias NO cambian el evento de Google', () => {
    expect(cambiaElCalendario(previa, solicitud({ diasHabiles: 4 }))).toBe(false);
  });

  it('CANDADO: los comentarios y las observaciones tampoco', () => {
    expect(cambiaElCalendario(previa, solicitud({ comentarios: 'otro' }))).toBe(false);
    expect(cambiaElCalendario(previa, solicitud({ observaciones: 'nota' }))).toBe(false);
  });

  it('una correccion que no toca nada de Google', () => {
    expect(cambiaElCalendario(previa, solicitud())).toBe(false);
  });
});

describe('cambiaLaHoja', () => {
  const previa = solicitud();

  it('los dias y los comentarios SI, que la hoja los enseña', () => {
    expect(cambiaLaHoja(previa, solicitud({ diasHabiles: 4 }))).toBe(true);
    expect(cambiaLaHoja(previa, solicitud({ comentarios: 'otro' }))).toBe(true);
  });

  it('las observaciones no: son una nota interna que no viaja a ningun sitio', () => {
    expect(cambiaLaHoja(previa, solicitud({ observaciones: 'nota' }))).toBe(false);
  });

  // CANDADO ESTRUCTURAL. `cambiaLaHoja` es el porton unico de "hay algo que
  // ajustar": si dejara de contener a `cambiaElCalendario`, habria correcciones
  // de calendario que no se emitirian nunca.
  it('CANDADO: contiene a cambiaElCalendario en los cinco campos', () => {
    const cambios: Partial<Solicitud>[] = [
      { fechaInicio: '2026-07-07' },
      { fechaFin: '2026-07-13' },
      { tipo: 'permiso' },
      { empleadoId: 'e2' },
      { estado: 'rechazada' },
    ];
    for (const c of cambios) {
      const actual = solicitud(c);
      expect(cambiaElCalendario(previa, actual)).toBe(true);
      expect(cambiaLaHoja(previa, actual)).toBe(true);
    }
  });
});
