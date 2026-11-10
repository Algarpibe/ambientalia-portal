import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, createVerify, createPublicKey } from 'node:crypto';
import { ErrorDrive, fuenteDrive, motivoDrive, type ConfigDrive } from './fuente-drive.js';

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

function googleFalso(o: { exportar?: (id: string) => Response; listar?: (q: string, pagina: string | null) => Response } = {}) {
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
      const b = JSON.parse(String(opt.body));
      if (b.mimeType !== 'application/vnd.google-apps.document' || b.parents[0] !== 'CARPETA_TMP') return J({}, 400);
      const id = 'C' + nc++;
      copias.add(id);
      return J({ id });
    }
    if (m && m[2] === '/export') return o.exportar ? o.exportar(m[1]) : new Response(m[1] === 'DOC1' ? '| **TICKET** |' : 'REMISIÓN DE SERVICIO TÉCNICO\n18A90417\n');
    if (m && opt.method === 'DELETE') { copias.delete(m[1]); return new Response(null, { status: 204 }); }
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
    expect(await fuenteDrive(CFG, { fetch: g.f }).remisionEntrada('E1')).toBe('| **TICKET** |');
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
