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

  // CANDADO. `ocupaAgenda` excluye las incapacidades porque contesta a la regla
  // de solapamiento; esta las incluye porque contesta a qué hay en Google. Una
  // incapacidad `registrada` que deja de estarlo también sale del calendario, y
  // si alguien "unifica" las dos funciones, este test cae. (Antes esta misma
  // aserción vivía duplicada en `estaEnElCalendario`, contra el propio `estado`
  // en vez de contra un par `previa`/`actual`; se movió aquí para que pruebe
  // algo que la aserción de arriba no prueba ya.)
  it('CANDADO: una incapacidad también sale del calendario si deja de estar registrada', () => {
    const previaIncapacidad = solicitud({ tipo: 'incapacidad', estado: 'registrada' });
    const actualIncapacidad = solicitud({ tipo: 'incapacidad', estado: 'rechazada' });
    expect(cambiaElCalendario(previaIncapacidad, actualIncapacidad)).toBe(true);
  });

  // CANDADO. Es el caso más corriente del histórico importado, donde el Excel
  // anotó recuentos que no cuadran. Sin este `false`, corregirlo manda a Google
  // un update idéntico y un correo diciendo que se corrigió algo.
  it('CANDADO: los días NO cambian el evento de Google', () => {
    expect(cambiaElCalendario(previa, solicitud({ diasHabiles: 4 }))).toBe(false);
  });

  it('CANDADO: los comentarios y las observaciones tampoco', () => {
    expect(cambiaElCalendario(previa, solicitud({ comentarios: 'otro' }))).toBe(false);
    expect(cambiaElCalendario(previa, solicitud({ observaciones: 'nota' }))).toBe(false);
  });

  it('una corrección que no toca nada de Google', () => {
    expect(cambiaElCalendario(previa, solicitud())).toBe(false);
  });
});

describe('cambiaLaHoja', () => {
  const previa = solicitud();

  it('sin ningún cambio no hay nada que ajustar', () => {
    expect(cambiaLaHoja(previa, solicitud())).toBe(false);
  });

  it('los días y los comentarios SÍ, que la hoja los enseña', () => {
    expect(cambiaLaHoja(previa, solicitud({ diasHabiles: 4 }))).toBe(true);
    expect(cambiaLaHoja(previa, solicitud({ comentarios: 'otro' }))).toBe(true);
  });

  it('las observaciones no: son una nota interna que no viaja a ningún sitio', () => {
    expect(cambiaLaHoja(previa, solicitud({ observaciones: 'nota' }))).toBe(false);
  });

  // CANDADO. La pestaña de incapacidad lleva «Adjunto?» en vez de «Comentarios»
  // y «Aprobado?» —ver `hoja()` en notificaciones.ts—, así que corregir solo
  // los comentarios de una incapacidad no toca ninguna celda que esa pestaña
  // tenga. Sin este `false`, el admin vería un aviso de «Ajustar la hoja» por
  // una columna que no existe.
  it('CANDADO: en una incapacidad, corregir los comentarios no cambia la hoja', () => {
    const previaIncapacidad = solicitud({ tipo: 'incapacidad', estado: 'registrada' });
    const actualIncapacidad = solicitud({ tipo: 'incapacidad', estado: 'registrada', comentarios: 'otro' });
    expect(cambiaLaHoja(previaIncapacidad, actualIncapacidad)).toBe(false);
  });

  // CANDADO. La celda «Aprobado?» tiene TRES valores («Sí», «No» y vacío), y
  // `aprobada → registrada` la cambia de «Sí» a vacío aunque las dos dejen un
  // evento en el calendario —por eso `cambiaElCalendario` da `false` para el
  // mismo par—. Si `cambiaLaHoja` mirara el estado a través de
  // `estaEnElCalendario` en vez del estado entero, este cambio no se vería
  // nunca.
  it('CANDADO: aprobada a registrada SÍ cambia la hoja, aunque no cambie el calendario', () => {
    const actual = solicitud({ estado: 'registrada' });
    expect(cambiaElCalendario(previa, actual)).toBe(false);
    expect(cambiaLaHoja(previa, actual)).toBe(true);
  });

  // CANDADO ESTRUCTURAL. `cambiaLaHoja` es el portón único de «hay algo que
  // ajustar»: si dejara de contener a `cambiaElCalendario`, habría correcciones
  // de calendario que no se emitirían nunca.
  it('CANDADO: contiene a cambiaElCalendario en los cinco campos', () => {
    const casos: Array<{ previa: Solicitud; actual: Solicitud }> = [
      { previa, actual: solicitud({ fechaInicio: '2026-07-07' }) },
      { previa, actual: solicitud({ fechaFin: '2026-07-13' }) },
      { previa, actual: solicitud({ tipo: 'permiso' }) },
      { previa, actual: solicitud({ empleadoId: 'e2' }) },
      { previa, actual: solicitud({ estado: 'rechazada' }) },
      // CANDADO DE ORDEN. Este caso es el que caza reordenar las ramas de
      // `cambiaLaHoja`: una incapacidad `registrada` no tiene «Comentarios» ni
      // «Aprobado?» en su pestaña, así que si el corte de incapacidad se
      // evaluara ANTES que la delegación en `cambiaElCalendario`, un cambio de
      // fecha —que sí hay que llevar a Google— daría `false` aquí sin que
      // nadie se enterara.
      {
        previa: solicitud({ tipo: 'incapacidad', estado: 'registrada' }),
        actual: solicitud({ tipo: 'incapacidad', estado: 'registrada', fechaInicio: '2026-07-07' }),
      },
    ];
    for (const { previa: p, actual } of casos) {
      expect(cambiaElCalendario(p, actual)).toBe(true);
      expect(cambiaLaHoja(p, actual)).toBe(true);
    }
  });
});
