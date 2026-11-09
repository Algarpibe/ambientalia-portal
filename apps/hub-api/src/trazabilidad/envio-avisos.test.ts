import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CABECERA_TOKEN, ESPERA_MAX_MS, crearCanalAvisos, modoEfectivo } from './envio-avisos.js';

const URL_N8N = 'https://n8n.example.com/webhook/tmc-avisos-ficticio';
const BUZON = 'buzon-prueba@ambientalia.com.co';
const BASE = { TMC_AVISOS_N8N_URL: URL_N8N, TMC_AVISOS_N8N_TOKEN: 'token-ficticio', TMC_AVISOS_BUZON_PRUEBA: BUZON };
const PRUEBA = { ...BASE, TMC_AVISOS_ENVIO: 'prueba' };
const REAL = { ...BASE, TMC_AVISOS_ENVIO: 'real' };
const CORREO_PRUEBA = { para: [BUZON], asunto: '[PRUEBA] Asunto ficticio', cuerpo: 'Cuerpo ficticio.' };
const CORREO_REAL = { para: ['compras@cliente-uno.example'], asunto: 'Asunto ficticio', cuerpo: 'Cuerpo ficticio.' };

/** Una red de mentira que apunta lo que se le pide y contesta lo que se le diga. */
function red(contestar: () => Promise<Response>) {
  const llamadas: { url: string; init: RequestInit }[] = [];
  return {
    llamadas,
    fn: async (url: string, init: RequestInit) => {
      llamadas.push({ url, init });
      return contestar();
    },
  };
}
const json = (status: number, cuerpo: unknown) => async () => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

// El envío de los avisos a clientes (2026-11-08): su registro (069), su canal
// de salida y sus candados. Nada de aquí llama a la red: la red es de mentira.

const fuente = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

describe('069_trazabilidad_avisos_envios.sql', () => {
  const sinComentarios = fuente('../users/migrations/069_trazabilidad_avisos_envios.sql').replace(/--.*$/gm, '');

  it('sólo crea, con IF NOT EXISTS, y da sus permisos a portal_app: sin semilla, sin claves foráneas y sin nada que cambie datos en un segundo arranque', () => {
    expect(sinComentarios).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+portal|DELETE\s+FROM|DROP|TRUNCATE|ALTER)\b/i);
    expect(sinComentarios.match(/CREATE (UNIQUE )?(TABLE|INDEX) (?!IF NOT EXISTS)/gi)).toBeNull();
    expect(sinComentarios).not.toMatch(/\bREFERENCES\b|\bdesk\./i);
    expect(sinComentarios).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'portal_app'\)/);
  });

  it('un solo «en curso» por cliente y tramo: el índice único parcial', () => {
    expect(sinComentarios).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS tmc_avisos_envios_en_curso_uq\s+ON portal\.tmc_avisos_envios \(clave_cliente, tramo\) WHERE estado = 'en_curso'/);
  });

  it('cuatro tramos, tres estados y dos modos, cerrados con CHECK (apagado no deja fila); y no guarda el cuerpo del correo', () => {
    expect(sinComentarios).toMatch(/tramo\s+VARCHAR\(10\)\s+NOT NULL CHECK \(tramo IN \('90', '60', '30', 'vencida'\)\)/);
    expect(sinComentarios).toMatch(/estado\s+VARCHAR\(10\)\s+NOT NULL DEFAULT 'en_curso' CHECK \(estado IN \('en_curso', 'enviado', 'fallido'\)\)/);
    expect(sinComentarios).toMatch(/modo\s+VARCHAR\(10\)\s+NOT NULL CHECK \(modo IN \('prueba', 'real'\)\)/);
    expect(sinComentarios).not.toMatch(/cuerpo/i);
  });

  it('está apuntada en MIGRATIONS, detrás de la 068', () => {
    expect(fuente('../db.ts')).toMatch(/'068_permisos_portal_app\.sql',\s*'069_trazabilidad_avisos_envios\.sql'/);
  });
});

describe('el interruptor: falla cerrado', () => {
  it.each([
    ['sin la variable', {}, 'sin_valor'],
    ['vacía', { TMC_AVISOS_ENVIO: '' }, 'sin_valor'],
    ['«apagado»', { ...BASE, TMC_AVISOS_ENVIO: 'apagado' }, null],
    ['un valor que no se conoce', { ...BASE, TMC_AVISOS_ENVIO: 'si' }, 'valor_desconocido'],
    ['en mayúsculas', { ...BASE, TMC_AVISOS_ENVIO: 'REAL' }, 'valor_desconocido'],
    ['con un espacio detrás', { ...BASE, TMC_AVISOS_ENVIO: 'real ' }, 'valor_desconocido'],
    ['real sin URL', { ...REAL, TMC_AVISOS_N8N_URL: undefined }, 'sin_canal'],
    ['real con algo que no es una URL', { ...REAL, TMC_AVISOS_N8N_URL: 'n8n.example.com' }, 'sin_canal'],
    ['real sin token', { ...REAL, TMC_AVISOS_N8N_TOKEN: ' ' }, 'sin_canal'],
    ['prueba sin token', { ...PRUEBA, TMC_AVISOS_N8N_TOKEN: undefined }, 'sin_canal'],
    ['prueba sin buzón', { ...PRUEBA, TMC_AVISOS_BUZON_PRUEBA: undefined }, 'sin_buzon_prueba'],
    ['prueba con un buzón de fuera', { ...PRUEBA, TMC_AVISOS_BUZON_PRUEBA: 'buzon@example.com' }, 'sin_buzon_prueba'],
    ['prueba con un subdominio', { ...PRUEBA, TMC_AVISOS_BUZON_PRUEBA: 'buzon@correo.ambientalia.com.co' }, 'sin_buzon_prueba'],
  ])('%s → apagado', (_caso, env, motivo) => {
    expect(modoEfectivo(env)).toEqual({ modo: 'apagado', motivo, buzonPrueba: null });
  });

  it('prueba, con todo y un buzón de @ambientalia.com.co (en minúsculas); real, con URL y token', () => {
    expect(modoEfectivo({ ...PRUEBA, TMC_AVISOS_BUZON_PRUEBA: ' Buzon-Prueba@Ambientalia.com.co ' })).toEqual({ modo: 'prueba', motivo: null, buzonPrueba: BUZON });
    expect(modoEfectivo({ ...REAL, TMC_AVISOS_BUZON_PRUEBA: undefined })).toEqual({ modo: 'real', motivo: null, buzonPrueba: null });
  });
});

describe('el canal: la entrega a n8n', () => {
  it('en prueba: POST a la URL, con el token en su cabecera, el correo en JSON y la espera máxima; confirmado → enviado', async () => {
    const r = red(json(200, { ok: true, messageId: 'msg-ficticio-1' }));
    expect(await crearCanalAvisos(PRUEBA, r.fn).remitir(CORREO_PRUEBA, 7)).toEqual({ tipo: 'enviado', messageId: 'msg-ficticio-1' });
    expect(r.llamadas).toHaveLength(1);
    const { url, init } = r.llamadas[0];
    expect([url, init.method, (init.headers as Record<string, string>)[CABECERA_TOKEN]]).toEqual([URL_N8N, 'POST', 'token-ficticio']);
    expect(JSON.parse(String(init.body))).toEqual({ referencia: 7, ...CORREO_PRUEBA });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(ESPERA_MAX_MS).toBe(30_000);
  });

  it('apagado, o en prueba con un destinatario que no es sólo el buzón, ni llama a la red', async () => {
    const r = red(json(200, { ok: true, messageId: 'x' }));
    expect((await crearCanalAvisos({}, r.fn).remitir(CORREO_REAL, 1)).tipo).toBe('rechazado');
    expect((await crearCanalAvisos(PRUEBA, r.fn).remitir(CORREO_REAL, 1)).tipo).toBe('rechazado');
    expect((await crearCanalAvisos(PRUEBA, r.fn).remitir({ ...CORREO_PRUEBA, para: [BUZON, 'compras@cliente-uno.example'] }, 1)).tipo).toBe('rechazado');
    expect(r.llamadas).toEqual([]);
  });

  it.each([
    ['n8n lo rechaza, con su motivo', json(422, { ok: false, error: 'Barrera ficticia.' }), { tipo: 'rechazado', motivo: 'Barrera ficticia.' }],
    ['un 200 con ok: false', json(200, { ok: false, error: 'Gmail no lo envió (ficticio).' }), { tipo: 'rechazado', motivo: 'Gmail no lo envió (ficticio).' }],
    ['el token no vale (sin JSON)', async () => new Response('Forbidden', { status: 403 }), { tipo: 'rechazado', motivo: 'El servicio de correo respondió 403: no ha salido nada.' }],
    ['un 200 que no dice nada claro', json(200, { recibido: true }), { tipo: 'sin_respuesta' }],
    ['no contesta a tiempo', async () => { throw new DOMException('La espera se acabó', 'TimeoutError'); }, { tipo: 'sin_respuesta' }],
    ['no se pudo conectar', async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); }, { tipo: 'rechazado', motivo: 'No se pudo conectar con el servicio de correo: no ha salido nada.' }],
    ['se cortó a mitad', async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } }); }, { tipo: 'sin_respuesta' }],
  ])('%s', async (_caso, contestar, esperado) => {
    expect(await crearCanalAvisos(REAL, red(contestar).fn).remitir(CORREO_REAL, 7)).toEqual(esperado);
  });
});

describe('la entrega: nunca un segundo correo por un error ambiguo', () => {
  it('pide redirect: manual y un 3xx es rechazado (el flujo no corrió; el token no viaja a otro sitio)', async () => {
    const r = red(async () => new Response('', { status: 307, headers: { Location: 'https://otro.example.test/x' } }));
    const res = await crearCanalAvisos(REAL, r.fn).remitir(CORREO_REAL, 1);
    expect(r.llamadas[0].init.redirect).toBe('manual');
    expect(res.tipo).toBe('rechazado');
  });

  it.each([
    ['500 sin más', async () => new Response('', { status: 500 })],
    ['502 con HTML', async () => new Response('<html>Bad Gateway</html>', { status: 502 })],
    ['504 vacío', async () => new Response(null, { status: 504 })],
    ['500 con ok: true y messageId (pudo salir)', json(500, { ok: true, messageId: 'msg-ficticio-2' })],
    ['2xx con ok: true y messageId vacío', json(200, { ok: true, messageId: '' })],
    ['2xx con ok: true y messageId que no es texto', json(200, { ok: true, messageId: 42 })],
    ['2xx con ok: true sin messageId', json(200, { ok: true })],
  ])('%s → sin_respuesta', async (_caso, contestar) => {
    expect(await crearCanalAvisos(REAL, red(contestar).fn).remitir(CORREO_REAL, 1)).toEqual({ tipo: 'sin_respuesta' });
  });

  it('un 5xx con ok: false de nuestro flujo es rechazado; un 4xx sin JSON, también', async () => {
    expect(await crearCanalAvisos(REAL, red(json(502, { ok: false, error: 'Fallo ficticio.' })).fn).remitir(CORREO_REAL, 1)).toEqual({ tipo: 'rechazado', motivo: 'Fallo ficticio.' });
    expect((await crearCanalAvisos(REAL, red(async () => new Response('', { status: 429 })).fn).remitir(CORREO_REAL, 1)).tipo).toBe('rechazado');
  });

  it('si leer el cuerpo agota la espera: sin_respuesta', async () => {
    const r = red(async () => ({ ok: true, status: 200, json: async () => { throw new DOMException('La espera se acabó', 'TimeoutError'); } }) as unknown as Response);
    expect(await crearCanalAvisos(REAL, r.fn).remitir(CORREO_REAL, 1)).toEqual({ tipo: 'sin_respuesta' });
  });
});

describe('la configuración del canal, más estricta', () => {
  it.each([
    ['http con un punto en el servidor', 'http://n8n.example.test/webhook/x'],
    ['http con una IP', 'http://10.0.0.5/webhook/x'],
    ['http con IPv6', 'http://[::1]/webhook/x'],
    ['con usuario y clave', 'https://usuario:clave@n8n.example.test/webhook/x'],
    ['con sólo usuario', 'https://usuario@n8n.example.test/webhook/x'],
    ['otro protocolo', 'ftp://n8n.example.test/x'],
  ])('URL %s → apagado (sin_canal)', (_caso, u) => {
    expect(modoEfectivo({ ...REAL, TMC_AVISOS_N8N_URL: u })).toEqual({ modo: 'apagado', motivo: 'sin_canal', buzonPrueba: null });
  });

  it('https, o http sólo con un servidor de una sola etiqueta (un servicio de Docker), valen', () => {
    expect(modoEfectivo({ ...REAL, TMC_AVISOS_N8N_URL: 'https://n8n.example.test/webhook/x' }).modo).toBe('real');
    expect(modoEfectivo({ ...REAL, TMC_AVISOS_N8N_URL: 'http://n8n:5678/webhook/x' }).modo).toBe('real');
  });

  it.each([
    ['con un espacio dentro', 'token con espacio'],
    ['con un salto de línea', 'token\nmalo'],
    ['con una tilde', 'tokenñ'],
    ['con espacios alrededor', ' token-ficticio '],
  ])('token %s → apagado (sin_canal)', (_caso, t) => {
    expect(modoEfectivo({ ...REAL, TMC_AVISOS_N8N_TOKEN: t })).toEqual({ modo: 'apagado', motivo: 'sin_canal', buzonPrueba: null });
  });
});

describe('lo que no debe salir ni cambiar', () => {
  it('el motivo de n8n no repite el token', async () => {
    const res = await crearCanalAvisos(REAL, red(json(422, { ok: false, error: 'Token token-ficticio inválido; otra vez token-ficticio.' })).fn).remitir(CORREO_REAL, 1);
    expect(res).toEqual({ tipo: 'rechazado', motivo: 'Token [token] inválido; otra vez [token].' });
  });

  it('el estado devuelto está congelado y tocarlo no abre la prueba a otros destinatarios', async () => {
    const r = red(json(200, { ok: true, messageId: 'x' }));
    const canal = crearCanalAvisos(PRUEBA, r.fn);
    const e = canal.estado() as { buzonPrueba: string };
    expect(Object.isFrozen(e)).toBe(true);
    try {
      e.buzonPrueba = 'compras@cliente-uno.example';
    } catch {
      /* congelado: en modo estricto lanza */
    }
    expect((await canal.remitir(CORREO_REAL, 1)).tipo).toBe('rechazado');
    expect(r.llamadas).toEqual([]);
  });

  it.each([
    ['sin destinatarios', { ...CORREO_REAL, para: [] }],
    ['seis destinatarios', { ...CORREO_REAL, para: ['a1@cliente-uno.example', 'a2@cliente-uno.example', 'a3@cliente-uno.example', 'a4@cliente-uno.example', 'a5@cliente-uno.example', 'a6@cliente-uno.example'] }],
    ['uno que no es un correo', { ...CORREO_REAL, para: ['no-es-un-correo'] }],
    ['repetidos (aunque cambie la caja)', { ...CORREO_REAL, para: ['compras@cliente-uno.example', ' Compras@Cliente-Uno.example'] }],
    ['asunto vacío', { ...CORREO_REAL, asunto: '  ' }],
  ])('en real, %s → rechazado y sin llamar a la red', async (_caso, correo) => {
    const r = red(json(200, { ok: true, messageId: 'x' }));
    expect((await crearCanalAvisos(REAL, r.fn).remitir(correo, 1)).tipo).toBe('rechazado');
    expect(r.llamadas).toEqual([]);
  });

  it('en real, de uno a cinco destinatarios válidos y distintos sí sale', async () => {
    const r = red(json(200, { ok: true, messageId: 'msg-ficticio-3' }));
    const para = ['a1@cliente-uno.example', 'a2@cliente-uno.example', 'a3@cliente-uno.example', 'a4@cliente-uno.example', 'a5@cliente-uno.example'];
    expect((await crearCanalAvisos(REAL, r.fn).remitir({ ...CORREO_REAL, para }, 1)).tipo).toBe('enviado');
  });
});

// CANDADO (2026-11-08). Hasta aquí, nada de src/trazabilidad podía enviar. Ahora hay UN camino, y se vigila con lupa:
//   · sólo envio-avisos.ts llama a la red, nombra n8n o lee TMC_AVISOS_* (los candados «nada de esto envía» de router.ts,
//     repo.ts, dominio.ts, types.ts y demás siguen en pie, sin tocar);
//   · no tiene relojes ni programador: la espera máxima es AbortSignal.timeout;
//   · sólo lo importa router.ts, y nadie más que la ruta del botón llama a enviarAviso;
//   · un modo desconocido es apagado y, en prueba, el único destinatario es el buzón (arriba: «el interruptor» y «el canal»).
describe('CANDADO: el canal de salida', () => {
  const SRC = fileURLToPath(new URL('..', import.meta.url));
  const APP = fileURLToPath(new URL('../../../trazabilidad-mantenimientos/src', import.meta.url));
  const listar = (raiz: string) =>
    (readdirSync(raiz, { recursive: true }) as string[]).map((f) => f.replace(/\\/g, '/')).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith('test-db/'));
  const fuentes = listar(SRC);
  const leer = (f: string) => readFileSync(`${SRC}/${f}`, 'utf8');
  const canal = leer('trazabilidad/envio-avisos.ts');

  it('es el único fuente de src/trazabilidad que llama a la red, nombra n8n o mira el entorno, y el único de hub-api que lee TMC_AVISOS_*', () => {
    const red = /\bfetch\b|n8n|webhook|nodemailer|smtp|sendMail|outbox|https?\.request|\bhttps?\.(get|request)\b|undici|AbortSignal|from ['"]node:(http|https|net|tls|dgram)['"]|from ['"](http|https|net|tls|dgram)['"]/i;
    const deTrazabilidad = fuentes.filter((f) => f.startsWith('trazabilidad/'));
    expect(deTrazabilidad.filter((f) => red.test(leer(f)))).toEqual(['trazabilidad/envio-avisos.ts']);
    expect(deTrazabilidad.filter((f) => /process\.env/.test(leer(f)))).toEqual(['trazabilidad/envio-avisos.ts']);
    expect(fuentes.filter((f) => /TMC_AVISOS_/.test(leer(f)))).toEqual(['trazabilidad/envio-avisos.ts']);
  });

  it('no tiene relojes ni programador: espera con AbortSignal.timeout y nada más', () => {
    expect(canal).not.toMatch(/setInterval|setTimeout|setImmediate|\bcron\b|schedule/i);
    expect(canal).toMatch(/signal: AbortSignal\.timeout\(ESPERA_MAX_MS\)/);
  });

  /** Si un fuente nombra ese módulo en una cadena —import estático o dinámico, con cualquier comilla—. */
  const loNombra = (modulo: string) => new RegExp(`['"\`][^'"\`\\n]*\\b${modulo}(\\.js)?['"\`]`);

  it('sólo lo importa router.ts —ni otro fuente de hub-api ni la app—, y él sólo importa el correo del aviso y el dominio', () => {
    expect(fuentes.filter((f) => loNombra('envio-avisos').test(leer(f)))).toEqual(['trazabilidad/router.ts']);
    expect(listar(APP).filter((f) => readFileSync(`${APP}/${f}`, 'utf8').includes('envio-avisos'))).toEqual([]);
    expect([...canal.matchAll(/^import\b[^;]*?from '([^']+)';/gms)].map((m) => m[1]).sort()).toEqual(['./avisos-correo.js', './dominio.js']);
  });

  it('nada envía por su cuenta: sólo la ruta del botón llama a enviarAviso, sólo el flujo del envío llama a remitir, y el arranque no sabe de ellos', () => {
    expect(fuentes.filter((f) => /\benviarAviso\(/.test(leer(f))).sort()).toEqual(['trazabilidad/avisos-envios-repo.ts', 'trazabilidad/router.ts']);
    expect(fuentes.filter((f) => /\.remitir\(/.test(leer(f)))).toEqual(['trazabilidad/avisos-envios-repo.ts']);
    expect(leer('index.ts')).not.toMatch(/enviarAviso|crearCanalAvisos|remitir|envio-avisos/);
    // Ni a pelo ni de otra forma (desestructurar, `canal['remitir']`): sólo nombran `remitir` quien lo declara (el tipo), quien lo
    // implementa (el canal) y quien lo llama (el flujo del envío). Y el flujo del envío sólo lo importa el router.
    expect(fuentes.filter((f) => /remitir/.test(leer(f))).sort()).toEqual(['trazabilidad/avisos-correo.ts', 'trazabilidad/avisos-envios-repo.ts', 'trazabilidad/envio-avisos.ts']);
    expect(fuentes.filter((f) => loNombra('avisos-envios-repo').test(leer(f)))).toEqual(['trazabilidad/router.ts']);
  });
});
