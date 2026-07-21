import * as Sentry from '@sentry/react';

// Observabilidad del frontend (ARQ-003). No-op si VITE_SENTRY_DSN no está
// configurado, así que es seguro construir/desplegar sin DSN.
const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
export const sentryEnabled = Boolean(dsn);

/**
 * Quita la query string de una URL. Varios endpoints del hub reciben el nombre
 * del cliente y rangos por query param (p. ej. `?cliente=…`), así que las URLs
 * capturadas por Sentry podrían llevar PII (PRIV-813/PRIV-815). Devuelve la URL
 * sin todo lo que va tras el primer `?`.
 */
export function stripQuery(url?: string | null): string | undefined {
  if (!url) return url ?? undefined;
  const i = url.indexOf('?');
  return i === -1 ? url : url.slice(0, i);
}

/**
 * `beforeSend`: elimina PII de un evento antes de enviarlo a Sentry —un tercero,
 * y transferencia internacional (Ley 1581, art. 26)—. Hoy sanea las URLs del
 * request y de los breadcrumbs de navegación/fetch (donde viaja el
 * `customer_name`) y descarta datos crudos del request. No cubre PII que aparezca
 * dentro del mensaje del error: eso debe evitarse en origen al construir errores.
 */
export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request) {
    event.request.url = stripQuery(event.request.url);
    delete event.request.query_string;
    delete event.request.data;
    delete event.request.cookies;
  }
  for (const b of event.breadcrumbs ?? []) {
    const d = b.data as Record<string, unknown> | undefined;
    if (d) {
      if (typeof d.url === 'string') d.url = stripQuery(d.url);
      if (typeof d.to === 'string') d.to = stripQuery(d.to);
      if (typeof d.from === 'string') d.from = stripQuery(d.from);
    }
  }
  return event;
}

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0, // solo errores
    sendDefaultPii: false, // no adjuntar IP/headers/cookies del usuario
    beforeSend: scrubEvent, // PRIV-813 — saneo de PII antes de enviar
  });
}

export function captureError(e: unknown): void {
  if (sentryEnabled) Sentry.captureException(e);
}

/**
 * Captura un error originado en un widget del Dashboard, enriquecido con el
 * contexto del widget para poder atribuirlo a su app de origen. No-op si Sentry
 * no está configurado.
 */
export function captureWidgetError(
  error: unknown,
  context: { widgetId: string; appId: string },
): void {
  if (!sentryEnabled) return;
  Sentry.withScope((scope) => {
    scope.setContext('widget', context);
    Sentry.captureException(error);
  });
}
