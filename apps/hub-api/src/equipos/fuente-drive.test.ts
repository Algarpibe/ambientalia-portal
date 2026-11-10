import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, createVerify, createPublicKey } from 'node:crypto';
import { ErrorDrive, fuenteDrive, motivoDrive, PREFIJO_COPIA_OCR, type ConfigDrive } from './fuente-drive.js';

// Google Drive con una API SIMULADA: token JWT de la cuenta de servicio, listado
// paginado, OCR (copia → exportar → borrar la copia) y que los errores no lleven nada
// de la respuesta. Carpetas, archivos y clave: ficticios (la clave se genera aquí).
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const CFG: ConfigDrive = {
  cuentaServicio: { client_email: 'sa@ficticio.iam.gserviceaccount.com', private_key: privateKey },
  carpetas: { entradas: 'CARPETA_ENTRADAS', salidasGeneradas: 'CARPETA_N8N', salidasEscaneadas: 'CARPETA_ESCANEOS' },
  carpetaTemporalOcr: 'CARPETA_TMP',
};
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

function googleFalso(o: { copiar?: () => Response; borrar?: (id: string) => Response; exportar?: (id: string) => Response; listar?: (q: string, pagina: string | null) => Response } = {}) {
  const copias = new Set<string>();
  const llamadas: string[] = [];
  let nc = 0;
  const f: typeof fetch = async (url, opt = {}) => {
    const u = new URL(String(url));
    const h = (opt.headers || {}) as Record<string, string>;
    llamadas.push((opt.method || 'GET') + ' ' + u.pathname);
    if (u.host === 'oauth2.googleapis.com') {
      const a = new URLSearchParams(String(opt.body)).get('assertion')!.split('.');
      const ok = createVerify('RSA-SHA256').update(a[0] + '.' + a[1]).verify(createPublicKey(privateKey), Buffer.from(a[2], 'base64url'));
      return ok ? J({ access_token: 'g', expires_in: 3600 }) : J({ error: 'firma' }, 400);
    }
    if (h.Authorization !== 'Bearer g') return J({}, 401);
    const m = u.pathname.match(/\/files\/([^/]+)(\/copy|\/export)?$/);
    if (u.pathname.endsWith('/files')) {
      const q = u.searchParams.get('q') || '';
      if (o.listar) return o.listar(q, u.searchParams.get('pageToken'));
      if (/google-apps\.document/.test(q)) return J({ files: [{ id: 'DOC1', name: 'Remisión' }] });
      return J({ files: [{ id: 'S1', name: '261009 - CLIENTE.pdf' }] });
    }
    if (m && m[2] === '/copy') {
      if (o.copiar) return o.copiar();
      const b = JSON.parse(String(opt.body));
      if (b.mimeType !== 'application/vnd.google-apps.document' || b.parents[0] !== 'CARPETA_TMP') return J({}, 400);
      const id = 'C' + nc++;
      copias.add(id);
      return J({ id });
    }
    if (m && m[2] === '/export') return o.exportar ? o.exportar(m[1]) : new Response(m[1] === 'DOC1' ? '| **TICKET** |' : 'REMISIÓN DE SERVICIO TÉCNICO\n18A90417\n');
    if (m && opt.method === 'DELETE') { if (o.borrar) return o.borrar(m[1]); copias.delete(m[1]); return new Response(null, { status: 204 }); }
    throw new Error('URL no simulada ' + url);
  };
  return { f, copias, llamadas };
}
const sinPausa = async () => {};

describe('fuenteDrive', () => {
  it('lista con el token de la cuenta de servicio y sigue las páginas', async () => {
    const g = googleFalso({
      listar: (q, pagina) => {
        expect(q).toMatch(/^'CARPETA_ENTRADAS' in parents and trashed = false and mimeType = 'application\/vnd\.google-apps\.folder'$/);
        return pagina ? J({ files: [{ id: 'E2', name: '261002 - CLIENTE B - 18A90002' }] }) : J({ files: [{ id: 'E1', name: '261001 - CLIENTE A - 18A90001' }], nextPageToken: 'p2' });
      },
    });
    expect(await fuenteDrive(CFG, { fetch: g.f }).entradas()).toEqual([{ id: 'E1', title: '261001 - CLIENTE A - 18A90001' }, { id: 'E2', title: '261002 - CLIENTE B - 18A90002' }]);
  });

  it('OCR: copia en la carpeta temporal, exporta el texto y borra la copia', async () => {
    const g = googleFalso();
    expect(await fuenteDrive(CFG, { fetch: g.f }).textoPdf('S1')).toMatch(/18A90417/);
    expect(g.copias.size).toBe(0);
    expect(g.llamadas.filter((l) => l.startsWith('DELETE'))).toHaveLength(1);
  });

  it('si la exportación falla, la copia se borra igual y el error lleva solo el código HTTP', async () => {
    const g = googleFalso({ exportar: () => new Response('detalle interno de Google con datos', { status: 403 }) });
    const e = await fuenteDrive(CFG, { fetch: g.f, esperar: sinPausa }).textoPdf('S1').catch((x) => x);
    expect(e).toBeInstanceOf(ErrorDrive);
    expect(e.message).toBe('Drive HTTP 403');
    expect(g.copias.size).toBe(0);
    expect(motivoDrive(e)).toBe('HTTP 403');
  });

  it('reintenta los 429 y 5xx hasta 3 veces', async () => {
    let n = 0;
    const g = googleFalso({ listar: () => (++n < 3 ? new Response('x', { status: 503 }) : J({ files: [] })) });
    expect(await fuenteDrive(CFG, { fetch: g.f, esperar: sinPausa }).salidasGeneradas()).toEqual([]);
    expect(n).toBe(3);
  });

  it('la remisión de entrada es el Google Doc de la carpeta, en Markdown', async () => {
    const g = googleFalso();
    expect(await fuenteDrive(CFG, { fetch: g.f }).remisionEntrada('CARPETA_E1_0001')).toBe('| **TICKET** |');
  });

  it('un token rechazado es «token rechazado», sin el cuerpo de Google', async () => {
    const malo: typeof fetch = async () => J({ error: 'invalid_grant', error_description: 'cuenta borrada' }, 400);
    const e = await fuenteDrive(CFG, { fetch: malo }).entradas().catch((x) => x);
    expect(motivoDrive(e)).toBe('token rechazado (HTTP 400)');
    expect(String(e.message)).not.toMatch(/cuenta borrada/);
  });

  it('motivoDrive: sin conexión, tiempo agotado o inesperado', () => {
    expect(motivoDrive(new TypeError('fetch failed'))).toBe('sin conexión');
    expect(motivoDrive(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe('tiempo agotado');
    expect(motivoDrive(new Error('otra cosa'))).toBe('error inesperado');
  });
});

describe('fuenteDrive: validación de carpetas y copia sin id', () => {
  it('una carpeta con forma no válida se rechaza al construir, sin repetir el valor', () => {
    const malo = "x' or name contains 'y";
    for (const cfg of [
      { ...CFG, carpetaTemporalOcr: malo },
      { ...CFG, carpetas: { ...CFG.carpetas, entradas: malo } },
      { ...CFG, carpetas: { ...CFG.carpetas, salidasGeneradas: malo } },
      { ...CFG, carpetas: { ...CFG.carpetas, salidasEscaneadas: malo } },
    ]) {
      let msg = '';
      try { fuenteDrive(cfg); } catch (e) { msg = (e as Error).message; }
      expect(msg).not.toBe('');
      expect(msg).not.toContain(malo);
    }
  });

  it('si la copia no devuelve id, no se intenta borrar "undefined", no se cuenta y falla con texto fijo', async () => {
    const g = googleFalso({ copiar: () => J({}) });
    const d = fuenteDrive(CFG, { fetch: g.f, esperar: sinPausa });
    const e = await d.textoPdf('S1').catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect(motivoDrive(e)).toBe('error inesperado');
    expect(g.llamadas.some((l) => l.includes('undefined') || l.startsWith('DELETE'))).toBe(false);
    expect(d.copiasSinBorrar()).toBe(0);
  });
});

describe('fuenteDrive: copias del OCR y reintentos', () => {
  it('la copia NO se reintenta ante un 503 (no es idempotente) y no hay nada que borrar', async () => {
    const g = googleFalso({ copiar: () => new Response('x', { status: 503 }) });
    const e = await fuenteDrive(CFG, { fetch: g.f, esperar: sinPausa }).textoPdf('S1').catch((x) => x);
    expect(motivoDrive(e)).toBe('HTTP 503');
    expect(g.llamadas.filter((l) => l.endsWith('/copy'))).toHaveLength(1);
    expect(g.llamadas.filter((l) => l.startsWith('DELETE'))).toHaveLength(0);
  });

  it('un borrado fallido no tumba el texto, pero se cuenta', async () => {
    const g = googleFalso({ borrar: () => new Response('x', { status: 403 }) });
    const d = fuenteDrive(CFG, { fetch: g.f, esperar: sinPausa });
    expect(d.copiasSinBorrar()).toBe(0);
    expect(await d.textoPdf('S1')).toMatch(/18A90417/);
    expect(d.copiasSinBorrar()).toBe(1);
  });

  it('si la exportación y el borrado fallan, el error es el de la exportación y la copia se cuenta', async () => {
    const g = googleFalso({ exportar: () => new Response('x', { status: 403 }), borrar: () => new Response('x', { status: 500 }) });
    const d = fuenteDrive(CFG, { fetch: g.f, esperar: sinPausa });
    const e = await d.textoPdf('S1').catch((x) => x);
    expect(motivoDrive(e)).toBe('HTTP 403');
    expect(d.copiasSinBorrar()).toBe(1);
  });

  it('la copia lleva el prefijo exportado', async () => {
    let cuerpo: { name: string } | null = null;
    const base = googleFalso();
    const f: typeof fetch = async (url, opt) => {
      if (String(url).includes('/copy')) cuerpo = JSON.parse(String(opt?.body));
      return base.f(url, opt);
    };
    await fuenteDrive(CFG, { fetch: f }).textoPdf('S1');
    expect(cuerpo!.name.startsWith(PREFIJO_COPIA_OCR)).toBe(true);
  });

  it('limpiarTemporal borra solo lo que lleva el prefijo, solo en la carpeta temporal, y cuenta', async () => {
    const consultas: string[] = [];
    const g = googleFalso({
      listar: (q) => {
        consultas.push(q);
        return J({ files: [{ id: 'T1', name: PREFIJO_COPIA_OCR + 'a' }, { id: 'AJENO', name: 'otro.pdf' }, { id: 'T2', name: PREFIJO_COPIA_OCR + 'b' }, { id: 'T3', name: PREFIJO_COPIA_OCR + 'c' }] });
      },
      borrar: (id) => (id === 'T2' ? new Response('x', { status: 403 }) : new Response(null, { status: 204 })),
    });
    const r = await fuenteDrive(CFG, { fetch: g.f, esperar: sinPausa }).limpiarTemporal();
    expect(r).toEqual({ borradas: 2, fallidas: 1 });
    expect(consultas[0]).toContain("'CARPETA_TMP' in parents");
    expect(consultas[0]).toContain(PREFIJO_COPIA_OCR);
    const borrados = g.llamadas.filter((l) => l.startsWith('DELETE'));
    expect(borrados.some((l) => l.endsWith('/AJENO'))).toBe(false);
    expect(borrados.filter((l) => l.endsWith('/T1') || l.endsWith('/T3'))).toHaveLength(2);
  });

  it('un 4xx no se reintenta', async () => {
    let n = 0;
    const g = googleFalso({ listar: () => (++n, new Response('x', { status: 404 })) });
    const e = await fuenteDrive(CFG, { fetch: g.f, esperar: sinPausa }).entradas().catch((x) => x);
    expect(motivoDrive(e)).toBe('HTTP 404');
    expect(n).toBe(1);
  });

  it('tres 503 seguidos: falla tras exactamente 3 intentos', async () => {
    let n = 0;
    const g = googleFalso({ listar: () => (++n, new Response('x', { status: 503 })) });
    const e = await fuenteDrive(CFG, { fetch: g.f, esperar: sinPausa }).entradas().catch((x) => x);
    expect(motivoDrive(e)).toBe('HTTP 503');
    expect(n).toBe(3);
  });

  it('remisionEntrada rechaza un id de carpeta que no vale, sin llamar a Google y sin repetirlo', async () => {
    const g = googleFalso();
    const e = await fuenteDrive(CFG, { fetch: g.f }).remisionEntrada("x' or name contains '").catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect(String(e.message)).not.toMatch(/contains/);
    expect(g.llamadas).toHaveLength(0);
  });
});

describe('token de la cuenta de servicio', () => {
  function conToken(fn: (llamadaAFiles: number) => Response) {
    const o = { token: 0, files: 0, asercion: '' };
    const f: typeof fetch = async (url, opt = {}) => {
      const u = new URL(String(url));
      if (u.host === 'oauth2.googleapis.com') {
        o.token++;
        o.asercion = new URLSearchParams(String(opt.body)).get('assertion')!;
        await new Promise((r) => setTimeout(r, 5));
        return J({ access_token: 't' + o.token, expires_in: 3600 });
      }
      return fn(++o.files);
    };
    return { o, f };
  }

  it('se cachea entre llamadas', async () => {
    const t = conToken(() => J({ files: [] }));
    const d = fuenteDrive(CFG, { fetch: t.f });
    await d.entradas();
    await d.salidasGeneradas();
    expect(t.o.token).toBe(1);
  });

  it('las llamadas simultáneas comparten una sola petición de token', async () => {
    const t = conToken(() => J({ files: [] }));
    const d = fuenteDrive(CFG, { fetch: t.f });
    await Promise.all([d.entradas(), d.salidasGeneradas(), d.salidasEscaneadas()]);
    expect(t.o.token).toBe(1);
  });

  it('un 401 de Drive descarta el token: la siguiente petición pide uno nuevo', async () => {
    const t = conToken((n) => (n === 1 ? new Response('x', { status: 401 }) : J({ files: [] })));
    const d = fuenteDrive(CFG, { fetch: t.f, esperar: sinPausa });
    const e = await d.entradas().catch((x) => x);
    expect(motivoDrive(e)).toBe('HTTP 401');
    await d.entradas();
    expect(t.o.token).toBe(2);
  });

  it('el JWT lleva iss, aud, scope y una vigencia de una hora', async () => {
    const t = conToken(() => J({ files: [] }));
    await fuenteDrive(CFG, { fetch: t.f }).entradas();
    const c = JSON.parse(Buffer.from(t.o.asercion.split('.')[1], 'base64url').toString());
    expect(c.iss).toBe(CFG.cuentaServicio.client_email);
    expect(c.aud).toBe('https://oauth2.googleapis.com/token');
    expect(c.scope).toBe('https://www.googleapis.com/auth/drive');
    expect(c.exp - c.iat).toBe(3600);
  });
});
