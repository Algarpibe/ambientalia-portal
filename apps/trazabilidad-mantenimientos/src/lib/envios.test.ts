import { describe, it, expect } from 'vitest';
import { MAX_DESTINATARIOS, SIN_CONFIRMAR_MS, type EnvioAviso, type EstadoCanal } from '../dominio';
import { accionTarjeta, botonEnviar, canalIgual, envioDeEquipo, errorDeEnvio, msHastaRefresco, puedeResolver, rotuloModo, textoEstadoEnvio, textoFallo, ultimoEnvioDe } from './envios';

// Lo que la pantalla de avisos dice del envío. Sin red: los envíos son de mentira, y ficticios.

const BUZON = 'buzon-prueba@ambientalia.com.co';
const REAL = { modo: 'real', motivo: null, buzonPrueba: null } as const;
const PRUEBA = { modo: 'prueba', motivo: null, buzonPrueba: BUZON } as const;
let n = 0;
const envio = (x: Partial<EnvioAviso> = {}): EnvioAviso => ({
  id: ++n,
  creadoEn: '2026-11-08 15:00:00+00',
  por: 'comercial@example.com',
  modo: 'prueba',
  claveCliente: 'cliente uno',
  cliente: 'Cliente Uno',
  tramo: 30,
  equipos: ['18A00001'],
  destinatarios: ['compras@cliente-uno.example'],
  enviadoA: [BUZON],
  asunto: '[PRUEBA] Asunto ficticio',
  estado: 'enviado',
  messageId: 'msg-ficticio',
  error: null,
  resueltoPor: null,
  resueltoEn: null,
  ...x,
});

describe('el rótulo del interruptor', () => {
  it('real, y prueba con su buzón', () => {
    expect(rotuloModo(REAL)).toMatchObject({ tono: 'green', titulo: 'Envío real' });
    expect(rotuloModo(PRUEBA)).toEqual({ tono: 'blue', titulo: 'Envío en prueba', texto: `Todo va sólo a ${BUZON}, con «[PRUEBA]» en el asunto: ningún cliente recibe nada y ningún equipo queda marcado como avisado.` });
  });

  it('apagado, y por qué si nadie lo pidió', () => {
    expect(rotuloModo({ modo: 'apagado', motivo: null, buzonPrueba: null }).texto).toBe('No sale ningún correo. El interruptor se cambia sólo en el servidor.');
    expect(rotuloModo({ modo: 'apagado', motivo: 'sin_valor', buzonPrueba: null })).toEqual({ tono: 'amber', titulo: 'Envío apagado', texto: 'No sale ningún correo: nadie ha encendido el interruptor. El interruptor se cambia sólo en el servidor.' });
    expect(rotuloModo({ modo: 'apagado', motivo: 'sin_canal', buzonPrueba: null }).texto).toMatch(/https.*host interno.*token/);
    for (const motivo of ['valor_desconocido', 'sin_canal', 'sin_buzon_prueba'] as const) {
      expect(rotuloModo({ modo: 'apagado', motivo, buzonPrueba: null }).texto).toMatch(/^No sale ningún correo: .+\. El interruptor se cambia sólo en el servidor\.$/);
    }
  });
});

describe('cada envío y cada tarjeta', () => {
  it('el resultado de un envío, en palabras', () => {
    expect(textoEstadoEnvio({ estado: 'enviado', error: null })).toBe('Enviado');
    expect(textoEstadoEnvio({ estado: 'fallido', error: 'Barrera ficticia.' })).toBe('Fallido: Barrera ficticia.');
    expect(textoEstadoEnvio({ estado: 'fallido', error: null })).toBe('Fallido');
    expect(textoEstadoEnvio({ estado: 'sin_confirmar', error: null })).toBe('Sin confirmar: revisa Enviados de info@');
    expect(textoEstadoEnvio({ estado: 'en_curso', error: null })).toMatch(/^Enviando…/);
  });

  it('el último envío de una tarjeta es el primero de la lista con su cliente y su tramo', () => {
    const lista = [envio({ tramo: 'vencida' }), envio({ estado: 'fallido' }), envio()];
    expect(ultimoEnvioDe(lista, 'cliente uno', 30)).toBe(lista[1]);
    expect(ultimoEnvioDe(lista, 'cliente uno', 'vencida')).toBe(lista[0]);
    expect(ultimoEnvioDe(lista, 'cliente dos', 30)).toBeNull();
  });

  it('el botón: apagado, ocupado mientras hay un envío abierto, y listo tras uno cerrado', () => {
    expect(botonEnviar({ modo: 'apagado', motivo: null, buzonPrueba: null }, null)).toEqual({ activo: false, texto: 'Envío apagado' });
    expect(botonEnviar(PRUEBA, envio({ estado: 'en_curso' }))).toEqual({ activo: false, texto: 'Enviando…' });
    expect(botonEnviar(REAL, envio({ estado: 'sin_confirmar' }))).toEqual({ activo: false, texto: 'Sin confirmar' });
    for (const u of [null, envio(), envio({ estado: 'fallido' })]) expect(botonEnviar(REAL, u)).toEqual({ activo: true, texto: 'Enviar correo' });
  });

  it('quién avisó a un equipo desde aquí: sólo un envío real que salió', () => {
    const real = envio({ modo: 'real', equipos: ['18A00001', '18A00002'], enviadoA: ['compras@cliente-uno.example'] });
    expect(envioDeEquipo([envio(), real], '18A00002', 30)).toBe(real);
    expect(envioDeEquipo([envio({ modo: 'real', estado: 'fallido' })], '18A00001', 30)).toBeNull();
    expect(envioDeEquipo([envio()], '18A00001', 30)).toBeNull(); // en prueba no se avisa a nadie
  });

  it('...y del tramo en que está el equipo: un aviso real de otro tramo no cuenta', () => {
    const de90 = envio({ modo: 'real', tramo: 90 });
    expect(envioDeEquipo([de90], '18A00001', 30)).toBeNull();
    expect(envioDeEquipo([de90], '18A00001', 90)).toBe(de90);
    expect(envioDeEquipo([de90], '18A00001', null)).toBeNull();
  });
});

describe('qué ofrece cada tarjeta', () => {
  const ACEPTABLE = ['compras@cliente-uno.example'];
  const base = { puedeEnviar: true, canal: PRUEBA as EstadoCanal | null, fallo: false, ultimo: null, para: ACEPTABLE };

  it('sin permiso para enviar, nada', () => {
    expect(accionTarjeta({ ...base, puedeEnviar: false })).toBeNull();
  });

  it('con destinatarios aceptables, el botón de siempre; apagado, desactivado', () => {
    expect(accionTarjeta(base)).toEqual({ tipo: 'boton', activo: true, texto: 'Enviar correo' });
    expect(accionTarjeta({ ...base, canal: { modo: 'apagado', motivo: null, buzonPrueba: null } })).toEqual({ tipo: 'boton', activo: false, texto: 'Envío apagado' });
    expect(accionTarjeta({ ...base, ultimo: envio({ estado: 'en_curso' }) })).toEqual({ tipo: 'boton', activo: false, texto: 'Enviando…' });
  });

  it('con más de MAX_DESTINATARIOS, repetidos o ninguno, una indicación en lugar del botón', () => {
    const seis = ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => `${x}@cliente-uno.example`);
    for (const para of [seis, [], ['a@cliente-uno.example', 'A@cliente-uno.example']]) {
      expect(accionTarjeta({ ...base, para })).toEqual({ tipo: 'aviso', texto: `No se puede enviar: tiene que ir a entre 1 y ${MAX_DESTINATARIOS} correos válidos y distintos. Pon a mano el contacto del cliente.` });
    }
    // apagado manda sobre la indicación: ahí no hay nada que enviar de todos modos
    expect(accionTarjeta({ ...base, para: seis, canal: { modo: 'apagado', motivo: null, buzonPrueba: null } })).toMatchObject({ tipo: 'boton', activo: false });
  });

  it('sin el estado del envío todavía: «Cargando…», o «Sin estado del envío» si la lectura falló', () => {
    expect(accionTarjeta({ ...base, canal: null })).toEqual({ tipo: 'boton', activo: false, texto: 'Cargando…' });
    expect(accionTarjeta({ ...base, canal: null, fallo: true })).toEqual({ tipo: 'boton', activo: false, texto: 'Sin estado del envío' });
  });
});

describe('lo que se confirmó y lo que dice el servidor ahora', () => {
  it('el mismo canal: igual modo y mismo buzón', () => {
    expect(canalIgual(PRUEBA, { ...PRUEBA })).toBe(true);
    expect(canalIgual(PRUEBA, REAL)).toBe(false);
    expect(canalIgual(PRUEBA, { ...PRUEBA, buzonPrueba: 'otro@ambientalia.com.co' })).toBe(false);
    expect(canalIgual(REAL, { modo: 'apagado', motivo: null, buzonPrueba: null })).toBe(false);
  });

  it('el motivo de un apagado no cuenta como cambio de modo', () => {
    expect(canalIgual({ modo: 'apagado', motivo: 'sin_valor', buzonPrueba: null }, { modo: 'apagado', motivo: 'sin_canal', buzonPrueba: null })).toBe(true);
  });
});

describe('el refresco de los envíos en curso y el texto de un fallo', () => {
  it('con algún «en curso» en la lista de GET, un refresco a los 2 minutos y 5 segundos; si no, ninguno', () => {
    expect(msHastaRefresco([envio({ estado: 'enviado' }), envio({ estado: 'sin_confirmar' })])).toBeNull();
    expect(msHastaRefresco([])).toBeNull();
    expect(msHastaRefresco([envio({ estado: 'enviado' }), envio({ estado: 'en_curso' })])).toBe(SIN_CONFIRMAR_MS + 5000);
  });

  it('el fallo no repite el punto del motivo', () => {
    expect(textoFallo('Barrera ficticia.')).toBe('No salió: Barrera ficticia. No se ha marcado nada; puedes volver a intentarlo.');
    expect(textoFallo('Barrera ficticia')).toBe('No salió: Barrera ficticia. No se ha marcado nada; puedes volver a intentarlo.');
    expect(textoFallo(null)).toBe('No salió: sin motivo. No se ha marcado nada; puedes volver a intentarlo.');
  });
});

describe('«Sí salió» / «No salió»', () => {
  it('sólo con un envío que la lista del servidor (GET) ya presenta como sin confirmar', () => {
    expect(puedeResolver(envio({ estado: 'sin_confirmar' }))).toBe(true);
    for (const estado of ['en_curso', 'enviado', 'fallido'] as const) expect(puedeResolver(envio({ estado }))).toBe(false);
    expect(puedeResolver(null)).toBe(false);
  });

  it('la respuesta del POST no manda: el POST dice «sin confirmar» al momento, el GET dice «en curso» hasta los 2 minutos', () => {
    const delPost = envio({ estado: 'sin_confirmar' }); // lo que contesta POST ante un tiempo agotado
    const delGet = { ...delPost, estado: 'en_curso' as const }; // el mismo envío, tal como lo sirve GET con menos de 2 minutos
    // La pantalla busca el último envío en la lista de GET, nunca en la respuesta del POST.
    const ultimo = ultimoEnvioDe([delGet], delPost.claveCliente, delPost.tramo);
    expect(puedeResolver(ultimo)).toBe(false);
    expect(botonEnviar(REAL, ultimo)).toEqual({ activo: false, texto: 'Enviando…' });
  });
});

describe('los errores del envío, en palabras de la pantalla', () => {
  it('cada código conocido tiene su mensaje, y los de «recarga» piden recargar', () => {
    expect(errorDeEnvio({ status: 409, code: 'envio_apagado', message: 'x' })).toEqual({ texto: 'El envío está apagado: no se ha enviado nada. Se ha actualizado la pantalla.', recargar: true });
    for (const [status, code] of [[404, 'tarjeta_no_encontrada'], [409, 'tarjeta_cambiada'], [410, 'marcar_retirado'], [409, 'modo_cambiado'], [409, 'destinatarios_cambiados'], [409, 'texto_cambiado']] as const) {
      const e = errorDeEnvio({ status, code, message: 'x' });
      expect([code, e.recargar, e.texto.endsWith('Se ha actualizado la pantalla.'), /recarga la página/i.test(e.texto)]).toEqual([code, true, true, false]);
    }
    expect(errorDeEnvio({ status: 409, code: 'modo_cambiado', message: 'x' }).texto).toMatch(/modo/);
    expect(errorDeEnvio({ status: 409, code: 'destinatarios_cambiados', message: 'x' }).texto).toMatch(/destinatarios/);
    expect(errorDeEnvio({ status: 409, code: 'texto_cambiado', message: 'x' }).texto).toMatch(/texto/);
    expect(errorDeEnvio({ status: 409, code: 'ya_enviando', message: 'x' })).toMatchObject({ recargar: false, texto: expect.stringMatching(/Últimos envíos/) });
    expect(errorDeEnvio({ status: 409, code: 'destinatarios_no_validos', message: 'x' })).toMatchObject({ recargar: false, texto: expect.stringMatching(/contacto.*5/) });
    expect(errorDeEnvio({ status: 409, code: 'no_sin_confirmar', message: 'x' })).toMatchObject({ recargar: true, texto: expect.stringMatching(/sin confirmar/) });
  });

  it('un código que no se conoce deja el mensaje del servidor; sin mensaje, uno genérico', () => {
    expect(errorDeEnvio({ status: 400, code: 'invalid_input', message: 'Faltan los equipos de la tarjeta.' })).toEqual({ texto: 'Faltan los equipos de la tarjeta.', recargar: false });
    expect(errorDeEnvio(new Error('Fallo de red'))).toEqual({ texto: 'Fallo de red', recargar: false });
    expect(errorDeEnvio('rareza')).toEqual({ texto: 'No se pudo completar la operación. Inténtalo de nuevo en un momento.', recargar: false });
  });

  it('una sesión caducada (401) conserva su mensaje, sea cual sea el código', () => {
    expect(errorDeEnvio({ status: 401, code: 'envio_apagado', message: 'Tu sesión ha caducado.' })).toEqual({ texto: 'Tu sesión ha caducado.', recargar: false });
  });
});
