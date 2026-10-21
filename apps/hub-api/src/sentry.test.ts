import { describe, it, expect } from 'vitest';
import type { ErrorEvent } from '@sentry/node';
import { opcionesSentry, scrubEvent } from './sentry.js';

// PRIV-824 — Sentry es un tercero en EE. UU. (transferencia internacional, Ley
// 1581 art. 26). Lo que el SDK adjunta por defecto a un error del backend es
// mucho: la URL con su query (`?cliente=…`), las cabeceras (el JWT del
// `Authorization`) y hasta el CUERPO de la petición entrante, 10 KB por defecto
// en @sentry/node 10 — el de un login lleva la contraseña. Y los mensajes de
// error de las apps nombran correos («saldo de vacaciones de ana.ruiz@…»).

function evento(parcial: Partial<ErrorEvent>): ErrorEvent {
  return { type: undefined, ...parcial } as ErrorEvent;
}

describe('scrubEvent (PRIV-824)', () => {
  it('de la petición deja el método y la ruta: ni query, ni cuerpo, ni cabeceras, ni cookies', () => {
    const limpio = scrubEvent(
      evento({
        request: {
          method: 'POST',
          url: 'https://api.ambientalia.cloud/api/login?cliente=ACME%20SAS',
          query_string: 'cliente=ACME%20SAS',
          data: '{"email":"ana@ambientalia.com.co","password":"secreta"}',
          headers: { authorization: 'Bearer eyJhbGciOi…', 'content-type': 'application/json' },
          cookies: { sesion: 'x' },
        },
      }),
    );
    expect(limpio.request).toEqual({ method: 'POST', url: 'https://api.ambientalia.cloud/api/login' });
  });

  it('tacha los correos del mensaje y de las excepciones', () => {
    const limpio = scrubEvent(
      evento({
        message: 'falló el aviso a jefe.area@ambientalia.com.co',
        exception: {
          values: [
            {
              type: 'Error',
              value: 'saldo de vacaciones de ana.ruiz@ambientalia.com.co: fechaCorte inválida',
            },
          ],
        },
      }),
    );
    expect(limpio.message).toBe('falló el aviso a [correo]');
    expect(limpio.exception?.values?.[0].value).toBe('saldo de vacaciones de [correo]: fechaCorte inválida');
    expect(limpio.exception?.values?.[0].type).toBe('Error');
  });

  it('en las migas quita la query de las URLs y tacha los correos de los mensajes', () => {
    const limpio = scrubEvent(
      evento({
        breadcrumbs: [
          { category: 'http', data: { url: 'https://n8n.example/webhook?correo=ana@x.co', method: 'POST' } },
          { category: 'console', message: 'enviando a ana.ruiz@ambientalia.com.co' },
        ],
      }),
    );
    expect(limpio.breadcrumbs?.[0].data).toEqual({ url: 'https://n8n.example/webhook', method: 'POST' });
    expect(limpio.breadcrumbs?.[1].message).toBe('enviando a [correo]');
  });

  it('un evento sin nada de eso pasa igual', () => {
    const e = evento({ message: 'nada sensible', extra: { endpoint: 'health' } });
    expect(scrubEvent(e)).toEqual({ type: undefined, message: 'nada sensible', extra: { endpoint: 'health' } });
  });
});

describe('opcionesSentry (PRIV-824)', () => {
  it('pasa todo evento por scrubEvent y no adjunta PII por defecto', () => {
    const o = opcionesSentry('https://clave@o1.ingest.sentry.io/1');
    expect(o.beforeSend).toBe(scrubEvent);
    expect(o.sendDefaultPii).toBe(false);
    expect(o.tracesSampleRate).toBe(0);
  });

  it('sustituye la integración Http por una que no captura el cuerpo de las peticiones', () => {
    const o = opcionesSentry('https://clave@o1.ingest.sentry.io/1');
    expect(typeof o.integrations).toBe('function');
    const integraciones = (o.integrations as (d: { name: string }[]) => { name: string }[])([
      { name: 'Http' },
      { name: 'Console' },
    ]);
    // Una sola Http (la propia, no la de por defecto) y el resto intacto.
    expect(integraciones.filter((i) => i.name === 'Http')).toHaveLength(1);
    expect(integraciones.find((i) => i.name === 'Http')).not.toEqual({ name: 'Http' });
    expect(integraciones.some((i) => i.name === 'Console')).toBe(true);
  });
});
