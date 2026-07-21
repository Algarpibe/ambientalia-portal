import { describe, it, expect } from 'vitest';
import * as Sentry from '@sentry/react';
import { stripQuery, scrubEvent } from './sentry';

describe('stripQuery', () => {
  it('quita la query string (donde viaja customer_name)', () => {
    expect(stripQuery('https://api/x?cliente=ACME%20SAS&from=2026')).toBe('https://api/x');
  });
  it('deja intacta una URL sin query', () => {
    expect(stripQuery('https://api/x')).toBe('https://api/x');
  });
  it('tolera undefined/null', () => {
    expect(stripQuery(undefined)).toBeUndefined();
    expect(stripQuery(null)).toBeUndefined();
  });
});

describe('scrubEvent (PRIV-813)', () => {
  it('sanea la URL del request y elimina query_string/data/cookies', () => {
    const event = {
      request: {
        url: 'https://portal/api/wo-sales/preview?cliente=ACME',
        query_string: 'cliente=ACME',
        data: { cliente: 'ACME' },
        cookies: { session: 'x' },
      },
    } as unknown as Sentry.ErrorEvent;

    const out = scrubEvent(event);
    expect(out.request?.url).toBe('https://portal/api/wo-sales/preview');
    expect(out.request?.query_string).toBeUndefined();
    expect(out.request?.data).toBeUndefined();
    expect(out.request?.cookies).toBeUndefined();
  });

  it('sanea las URLs de los breadcrumbs (url/to/from)', () => {
    const event = {
      breadcrumbs: [
        { data: { url: 'https://api/reconciliation/data?cliente=ACME' } },
        { data: { to: '/x?cliente=ACME', from: '/y?nit=900' } },
        { message: 'sin data' },
      ],
    } as unknown as Sentry.ErrorEvent;

    const out = scrubEvent(event);
    const bc = out.breadcrumbs!;
    expect((bc[0].data as Record<string, unknown>).url).toBe('https://api/reconciliation/data');
    expect((bc[1].data as Record<string, unknown>).to).toBe('/x');
    expect((bc[1].data as Record<string, unknown>).from).toBe('/y');
  });

  it('no falla si el evento no trae request ni breadcrumbs', () => {
    expect(() => scrubEvent({} as Sentry.ErrorEvent)).not.toThrow();
  });
});
