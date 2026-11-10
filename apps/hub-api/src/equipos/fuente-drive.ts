/**
 * Google Drive para «Equipos en taller»: API v3 con una cuenta de servicio, por
 * `fetch` y sin dependencias (D3). Lectura de las tres carpetas y OCR de las
 * remisiones escaneadas: copia temporal como Google Doc (OCR en español),
 * exportación a texto y borrado de la copia. La cuenta solo puede editar en la
 * carpeta temporal.
 *
 * ⚠️ Ni la clave privada, ni el token, ni el cuerpo de una respuesta de Google
 * salen de aquí: los errores son `ErrorDrive` con el código HTTP y nada más, y
 * `motivoDrive` los traduce para la causa de la corrida.
 */
import { createSign } from 'node:crypto';
import type { ArchivoDrive, Fuentes } from './nucleo/tipos.js';

export interface CuentaServicioGoogle {
  client_email: string;
  private_key: string;
}
export interface CarpetasDrive {
  entradas: string;
  salidasGeneradas: string;
  salidasEscaneadas: string;
}
export interface ConfigDrive {
  cuentaServicio: CuentaServicioGoogle;
  carpetas: CarpetasDrive;
  /** Carpeta donde se crea (y se borra enseguida) la copia temporal del OCR. */
  carpetaTemporalOcr: string;
}

/** Lo que el núcleo lee de Drive. */
export type FuenteDrive = Pick<Fuentes, 'entradas' | 'salidasGeneradas' | 'salidasEscaneadas' | 'textoPdf'> & {
  remisionEntrada(carpetaId: string): Promise<string>;
};

/** Un fallo de Drive o del token de Google: solo el código, nunca el cuerpo. */
export class ErrorDrive extends Error {
  readonly status: number;
  readonly enToken: boolean;
  constructor(status: number, enToken = false) {
    super((enToken ? 'Google token HTTP ' : 'Drive HTTP ') + status);
    this.name = 'ErrorDrive';
    this.status = status;
    this.enToken = enToken;
  }
  get reintentar(): boolean {
    return !this.enToken && (this.status === 429 || this.status >= 500);
  }
}

/** Para la causa de una corrida fallida: «drive: <esto>». Sin datos de la respuesta. */
export function motivoDrive(e: unknown): string {
  if (e instanceof ErrorDrive) return e.enToken ? 'token rechazado (HTTP ' + e.status + ')' : 'HTTP ' + e.status;
  const nombre = String((e as { name?: unknown } | null)?.name ?? '');
  if (nombre === 'TimeoutError' || nombre === 'AbortError') return 'tiempo agotado';
  if (e instanceof TypeError) return 'sin conexión';
  return 'error inesperado';
}

/** Cuánto se espera, como mucho, cada petición a Google. */
export const ESPERA_MAX_MS = 60_000;

export interface OpcionesDrive {
  fetch?: typeof fetch;
  /** Pausa entre reintentos (las pruebas pasan una instantánea). */
  esperar?: (ms: number) => Promise<void>;
}

const pausa = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Token de acceso de la cuenta de servicio (JWT RS256), renovado antes de vencer. */
export function tokenGoogle(sa: CuentaServicioGoogle, scopes: string[], f: typeof fetch = fetch): () => Promise<string> {
  let tok = '';
  let exp = 0;
  return async () => {
    if (tok && Date.now() < exp - 60e3) return tok;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const body = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: sa.client_email, scope: scopes.join(' '), aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
    const sig = createSign('RSA-SHA256').update(body).sign(sa.private_key).toString('base64url');
    const r = await f('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: body + '.' + sig }),
      signal: AbortSignal.timeout(ESPERA_MAX_MS),
    });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!r.ok || !j.access_token) throw new ErrorDrive(r.status, true);
    tok = j.access_token;
    exp = Date.now() + (j.expires_in || 3600) * 1000;
    return tok;
  };
}

export function fuenteDrive(cfg: ConfigDrive, o: OpcionesDrive = {}): FuenteDrive {
  const f = o.fetch || fetch;
  const esperar = o.esperar || pausa;
  const gtok = tokenGoogle(cfg.cuentaServicio, ['https://www.googleapis.com/auth/drive'], f);
  const D = 'https://www.googleapis.com/drive/v3';
  const comunes = { supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives' };

  async function conReintento<T>(fn: () => Promise<T>, n = 3): Promise<T> {
    let e: unknown;
    for (let i = 0; i < n; i++) {
      try {
        return await fn();
      } catch (x) {
        e = x;
        if (!(x instanceof ErrorDrive && x.reintentar)) break;
        if (i < n - 1) await esperar(1500 * (i + 1));
      }
    }
    throw e;
  }
  const gget = (url: string, opt: RequestInit = {}) =>
    conReintento(async () => {
      const r = await f(url, {
        ...opt,
        headers: { Authorization: 'Bearer ' + (await gtok()), ...(opt.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(ESPERA_MAX_MS),
      });
      if (!r.ok) {
        await r.body?.cancel().catch(() => undefined);
        throw new ErrorDrive(r.status);
      }
      return r;
    });

  async function listar(parent: string, soloCarpetas: boolean): Promise<ArchivoDrive[]> {
    const out: ArchivoDrive[] = [];
    let tok = '';
    const q = "'" + parent + "' in parents and trashed = false and " +
      (soloCarpetas ? "mimeType = 'application/vnd.google-apps.folder'" : "(mimeType = 'application/pdf' or mimeType contains 'image/')");
    do {
      const u = D + '/files?' + new URLSearchParams({ q, pageSize: '1000', fields: 'nextPageToken,files(id,name)', ...comunes, ...(tok ? { pageToken: tok } : {}) });
      const j = (await (await gget(u)).json()) as { files?: { id: string; name: string }[]; nextPageToken?: string };
      (j.files || []).forEach((x) => out.push({ id: x.id, title: x.name }));
      tok = j.nextPageToken || '';
    } while (tok);
    return out;
  }

  /** Texto OCR: copia temporal como Google Doc (OCR en español), exportación a texto y borrado de la copia. */
  async function textoPdf(id: string): Promise<string> {
    const c = (await (await gget(D + '/files/' + encodeURIComponent(id) + '/copy?' + new URLSearchParams({ supportsAllDrives: 'true', ocrLanguage: 'es', fields: 'id' }), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mimeType: 'application/vnd.google-apps.document', name: 'ocr-tmp-' + id, parents: [cfg.carpetaTemporalOcr] }),
    })).json()) as { id: string };
    try {
      return await (await gget(D + '/files/' + encodeURIComponent(c.id) + '/export?mimeType=text/plain')).text();
    } finally {
      await gget(D + '/files/' + encodeURIComponent(c.id) + '?supportsAllDrives=true', { method: 'DELETE' }).catch(() => undefined);
    }
  }

  return {
    entradas: () => listar(cfg.carpetas.entradas, true),
    salidasGeneradas: () => listar(cfg.carpetas.salidasGeneradas, true),
    salidasEscaneadas: () => listar(cfg.carpetas.salidasEscaneadas, false),
    textoPdf,
    /** Remisión de entrada: el Google Doc de la carpeta, exportado como Markdown (conserva la tabla). */
    remisionEntrada: async (folder) => {
      const q = "'" + folder + "' in parents and trashed = false and mimeType = 'application/vnd.google-apps.document'";
      const j = (await (await gget(D + '/files?' + new URLSearchParams({ q, pageSize: '5', fields: 'files(id,name)', ...comunes }))).json()) as { files?: { id: string }[] };
      const d = j.files?.[0];
      if (!d) return '';
      return (await gget(D + '/files/' + encodeURIComponent(d.id) + '/export?mimeType=' + encodeURIComponent('text/markdown'))).text();
    },
  };
}
