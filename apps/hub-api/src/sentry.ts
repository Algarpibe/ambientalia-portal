import * as Sentry from '@sentry/node';

// Observabilidad (ARQ-003). No-op si SENTRY_DSN no está configurado, así que es
// seguro desplegar sin DSN; se activa en cuanto se fija la variable en EasyPanel.
const dsn = process.env.SENTRY_DSN;
export const sentryEnabled = Boolean(dsn);

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0, // solo errores, sin performance tracing (coste bajo)
  });
  console.log('Sentry habilitado (hub-api)');
}

export function captureError(e: unknown, context?: Record<string, unknown>): void {
  if (!sentryEnabled) return;
  Sentry.captureException(e, context ? { extra: context } : undefined);
}
