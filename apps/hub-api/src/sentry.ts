import * as Sentry from '@sentry/node';

// Observabilidad (ARQ-003). No-op si SENTRY_DSN no está configurado, así que es
// seguro desplegar sin DSN; se activa en cuanto se fija la variable en EasyPanel.
const dsn = process.env.SENTRY_DSN;
export const sentryEnabled = Boolean(dsn);

// PRIV-824 — Sentry es un tercero en EE. UU. (transferencia internacional, Ley
// 1581 art. 26), y lo que @sentry/node adjunta por defecto a un error del
// backend es mucho más que el error: la URL con su query (varios endpoints
// reciben el nombre del cliente por `?cliente=…`, PRIV-815), las cabeceras (el
// JWT del `Authorization`) y el CUERPO de la petición entrante —10 KB por
// defecto en la versión 10; el de un login lleva la contraseña—. Además, los
// mensajes de error de las apps nombran correos («saldo de vacaciones de
// ana.ruiz@…»). Es el mismo saneo que el portal (PRIV-813), copiado y ampliado
// porque hub-api no puede importar los paquetes del frontend.

/** Un correo en cualquier parte de un texto. */
const CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function tacharCorreos(texto: string): string {
  return texto.replace(CORREO, '[correo]');
}

/** La URL sin nada de lo que va tras el primer `?`. */
function sinQuery(url: string): string {
  const i = url.indexOf('?');
  return i === -1 ? url : url.slice(0, i);
}

/**
 * `beforeSend`: deja en el evento lo que sirve para depurar —qué ruta, qué
 * método, qué excepción y dónde— y quita lo que identifica a una persona.
 * Exportada para los tests.
 */
export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request) {
    if (typeof event.request.url === 'string') event.request.url = sinQuery(event.request.url);
    delete event.request.query_string;
    delete event.request.data;
    delete event.request.headers;
    delete event.request.cookies;
  }
  if (typeof event.message === 'string') event.message = tacharCorreos(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === 'string') ex.value = tacharCorreos(ex.value);
  }
  for (const b of event.breadcrumbs ?? []) {
    if (typeof b.message === 'string') b.message = tacharCorreos(b.message);
    const d = b.data as Record<string, unknown> | undefined;
    if (d) {
      for (const clave of ['url', 'to', 'from']) {
        if (typeof d[clave] === 'string') d[clave] = sinQuery(d[clave] as string);
      }
    }
  }
  return event;
}

/**
 * Las opciones de `Sentry.init`, aparte para poder probarlas. La integración
 * Http por defecto se cambia por una que no captura el cuerpo de las peticiones
 * entrantes: `scrubEvent` ya lo borra, pero así ni siquiera se guarda en memoria
 * a la espera de un error.
 */
export function opcionesSentry(dsnDado: string): Sentry.NodeOptions {
  return {
    dsn: dsnDado,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0, // solo errores, sin performance tracing (coste bajo)
    sendDefaultPii: false, // explícito: ni IP, ni usuario, ni cookies
    integrations: (porDefecto) => [
      ...porDefecto.filter((i) => i.name !== 'Http'),
      Sentry.httpIntegration({ maxIncomingRequestBodySize: 'none' }),
    ],
    beforeSend: scrubEvent,
  };
}

// Al final del módulo: `opcionesSentry` usa constantes de arriba (`CORREO`), y un
// `const` no existe hasta que se ejecuta su línea.
if (dsn) {
  Sentry.init(opcionesSentry(dsn));
  console.log('Sentry habilitado (hub-api)');
}

export function captureError(e: unknown, context?: Record<string, unknown>): void {
  if (!sentryEnabled) return;
  Sentry.captureException(e, context ? { extra: context } : undefined);
}
