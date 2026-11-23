// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatFecha, rangoFechas } from '../dominio';
import { registrarIncapacidadAjena, type IncapacidadAjena } from './registro';
import { crearSolicitud } from './solicitudes';

// El cliente de la incapacidad que registra el administrador a nombre de otro.
// Los mensajes del alta del empleado le hablan al empleado («Tu último día…»);
// este lector le habla al administrador, que está registrando la de otra persona.

const json = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

const responde = (res: Response) => {
  const fetchFalso = vi.fn(async () => res);
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
};

/** El error con el que rechaza, para poder mirar su texto. */
const errorDe = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: Error) => e,
  );

// Node 22+ trae un `localStorage` global que choca con el de jsdom; `authHeaders`
// lo lee al montar la petición.
beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => null }));
afterEach(() => vi.unstubAllGlobals());

const datos: IncapacidadAjena = {
  empleadoId: '11111111-1111-4111-8111-111111111111',
  fechaInicio: '2025-03-03',
  fechaFin: '2025-03-05',
  comentarios: 'Avisó su hermana',
  adjunto: { nombreArchivo: 'baja.pdf', mime: 'application/pdf', contenidoBase64: 'JVBERi0=' },
};

const CHOQUE = { tipo: 'vacaciones', estado: 'aprobada', fechaInicio: '2025-03-04', fechaFin: '2025-03-07' };

describe('registrarIncapacidadAjena', () => {
  it('manda un POST con los datos a la ruta del administrador y devuelve la solicitud', async () => {
    const fetchFalso = responde(json(201, { id: 's9', empleadoNombre: 'Ana Pérez' }));
    expect(await registrarIncapacidadAjena(datos)).toEqual({ id: 's9', empleadoNombre: 'Ana Pérez' });
    const [url, opciones] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/ausencias\/solicitudes\/incapacidad-ajena$/);
    expect(opciones.method).toBe('POST');
    expect(opciones.body).toBe(JSON.stringify(datos));
  });

  it('rango_solapado: habla de «esa persona», con el tipo, el estado y las fechas del choque', async () => {
    responde(json(409, { error: 'rango_solapado', field: 'fechaInicio', detalle: CHOQUE }));
    expect((await errorDe(registrarIncapacidadAjena(datos)))?.message).toBe(
      `Esas fechas chocan con otra ausencia de esa persona: Vacaciones (aprobada), ${rangoFechas('2025-03-04', '2025-03-07')}. ` +
        'Esos días ya están concedidos: no se liberan hasta que esa solicitud se cambie o se anule.',
    );
  });

  it('fecha_posterior_al_retiro: nombra el último día de ESA persona, sin «tu»', async () => {
    responde(json(409, { error: 'fecha_posterior_al_retiro', field: 'fechaFin', detalle: { fechaRetiro: '2025-03-04' } }));
    expect((await errorDe(registrarIncapacidadAjena(datos)))?.message).toBe(
      `El último día de esa persona en la compañía es el ${formatFecha('2025-03-04')} y estas fechas lo pasan.`,
    );
  });

  it('404 empleado_no_encontrado: la ficha ya no está activa', async () => {
    responde(json(404, { error: 'empleado_no_encontrado', field: 'empleadoId' }));
    await expect(registrarIncapacidadAjena(datos)).rejects.toThrow(new Error('Esa ficha ya no está activa. Recarga la lista.'));
  });

  it('un 404 SIN ese código (hub-api sin la ruta todavía) sale por el mensaje genérico', async () => {
    // Es lo que contestaría un hub-api antiguo si el portal se desplegara antes:
    // decir «la ficha no está activa» sería mentir.
    responde(new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } }));
    const error = await errorDe(registrarIncapacidadAjena(datos));
    expect(error?.message).not.toMatch(/ficha/);
    expect(error?.message).toMatch(/404/);
  });

  it('incapacidad_en_el_futuro: sin el «te firmó» del formulario del empleado', async () => {
    responde(json(400, { error: 'incapacidad_en_el_futuro', field: 'fechaInicio' }));
    await expect(registrarIncapacidadAjena(datos)).rejects.toThrow(new Error('La fecha de inicio no puede ser futura.'));
  });

  it('empleado_requerido: pide elegir a la persona', async () => {
    responde(json(400, { error: 'empleado_requerido', field: 'empleadoId' }));
    await expect(registrarIncapacidadAjena(datos)).rejects.toThrow(
      new Error('Elige la persona a la que pertenece la incapacidad.'),
    );
  });

  it('el resto sale por el lector del alta del empleado: un código con frase la conserva', async () => {
    responde(json(400, { error: 'hora_no_permitida', field: 'tipo' }));
    await expect(registrarIncapacidadAjena(datos)).rejects.toThrow(
      new Error('El horario solo se puede poner en un permiso de un único día. Si son varios días, quita las horas.'),
    );
  });

  it('y uno sin frase sale crudo, igual que en el alta del empleado', async () => {
    responde(json(400, { error: 'adjunto_no_es_pdf', field: 'adjunto' }));
    await expect(registrarIncapacidadAjena(datos)).rejects.toThrow(new Error('adjunto_no_es_pdf'));
  });
});

describe('el alta del EMPLEADO no cambia', () => {
  it('CANDADO: su choque sigue diciendo «otra ausencia», sin «de esa persona»', async () => {
    responde(json(409, { error: 'rango_solapado', field: 'fechaInicio', detalle: CHOQUE }));
    const error = await errorDe(crearSolicitud({ tipo: 'vacaciones', fechaInicio: '2025-03-03', fechaFin: '2025-03-05' }));
    expect(error?.message).toMatch(/^Esas fechas chocan con otra ausencia: Vacaciones \(aprobada\), /);
  });
});
