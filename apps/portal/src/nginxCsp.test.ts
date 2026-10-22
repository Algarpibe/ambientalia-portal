import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

// SEC-234 — la CSP del portal vive en nginx.conf, no en el código: nada de lo
// que se compila la comprueba. Esto lee el fichero tal cual lo copia el
// Dockerfile y fija lo que importa, para que un cambio que la desactive, la
// pase a enforcing antes de tiempo o se deje fuera un host real no llegue a
// producción en silencio. La sintaxis de nginx la valida `nginx -t`, no esto.

const conf = readFileSync(join(__dirname, '..', 'nginx.conf'), 'utf8');

/** Las directivas `add_header` activas (no comentadas), con su nombre y valor. */
function cabecerasActivas(): Map<string, string> {
  const cabeceras = new Map<string, string>();
  for (const linea of conf.split(/\r?\n/)) {
    // Entre comillas dobles o simples: `Reporting-Endpoints` lleva dobles dentro.
    const m = linea.trim().match(/^add_header\s+(\S+)\s+(?:"([^"]*)"|'([^']*)')/);
    if (m) cabeceras.set(m[1], m[2] ?? m[3]);
  }
  return cabeceras;
}

/** La CSP partida en directivas: `connect-src` → ['self', 'https://…']. */
function directivas(csp: string): Map<string, string[]> {
  const d = new Map<string, string[]>();
  for (const trozo of csp.split(';')) {
    const [nombre, ...valores] = trozo.trim().split(/\s+/);
    if (nombre) d.set(nombre, valores);
  }
  return d;
}

const SENTRY_INGEST = 'https://o4511725706805248.ingest.us.sentry.io';
const SENTRY_SECURITY = `${SENTRY_INGEST}/api/4511725746716672/security/?sentry_key=`;

describe('CSP del portal (SEC-234)', () => {
  it('está activa en modo Report-Only, todavía sin la cabecera que bloquea', () => {
    const cabeceras = cabecerasActivas();
    expect(cabeceras.has('Content-Security-Policy-Report-Only')).toBe(true);
    expect(cabeceras.has('Content-Security-Policy')).toBe(false);
  });

  it('deja conectar con los servidores que el portal usa de verdad, Sentry incluido', () => {
    const csp = directivas(cabecerasActivas().get('Content-Security-Policy-Report-Only') ?? '');
    const connect = csp.get('connect-src') ?? [];
    expect(connect).toEqual(
      expect.arrayContaining(["'self'", 'https://api.ambientalia.cloud', 'https://www.datos.gov.co', SENTRY_INGEST])
    );
  });

  it('no abre el host de Gemini, que nadie usa (INFRA-539)', () => {
    expect(cabecerasActivas().get('Content-Security-Policy-Report-Only') ?? '').not.toContain(
      'generativelanguage.googleapis.com'
    );
  });

  it('manda las violaciones al endpoint de seguridad de Sentry, por las dos vías', () => {
    const cabeceras = cabecerasActivas();
    const csp = directivas(cabeceras.get('Content-Security-Policy-Report-Only') ?? '');
    const uri = (csp.get('report-uri') ?? [])[0] ?? '';
    expect(uri.startsWith(SENTRY_SECURITY)).toBe(true);
    // report-to es el mecanismo nuevo (Chrome); report-uri cubre a Firefox y Safari.
    expect(csp.get('report-to')).toEqual(['csp']);
    expect(cabeceras.get('Reporting-Endpoints')).toBe(`csp="${uri}"`);
  });

  it('conserva las defensas que no dependen de ningún host', () => {
    const csp = directivas(cabecerasActivas().get('Content-Security-Policy-Report-Only') ?? '');
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.get('script-src')).toEqual(["'self'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'self'"]);
  });
});

// INFRA-540 — sin `server_tokens off;` nginx anuncia su versión exacta en la
// cabecera Server y en sus páginas de error, lo que regala a un atacante qué
// CVE probar. Debe ser una directiva activa (no comentada) del bloque server.
describe('nginx no publica su versión (INFRA-540)', () => {
  it('tiene `server_tokens off;` activo', () => {
    const activas = conf.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim());
    expect(activas).toContain('server_tokens off;');
  });
});
