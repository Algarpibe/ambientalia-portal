import * as Sentry from '@sentry/react';

// Observabilidad del frontend (ARQ-003). No-op si VITE_SENTRY_DSN no está
// configurado, así que es seguro construir/desplegar sin DSN.
const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
export const sentryEnabled = Boolean(dsn);

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0, // solo errores
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
