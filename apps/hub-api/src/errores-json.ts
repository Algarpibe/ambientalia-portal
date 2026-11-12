import type { ErrorRequestHandler } from 'express';
import { captureError } from './sentry.js';

/**
 * Manejador FINAL de errores de hub-api: lo que llegue a `next(err)` —o lo que lance
 * una ruta síncrona— sale siempre como JSON, sin traza, sea cual sea NODE_ENV.
 *
 * Sin él contestaba el de Express, con una página HTML. Fuera de «production», con la
 * traza dentro (rutas del servidor y de node_modules, versiones) y el mensaje del
 * error; y la escribía entera en el log. Le llegaban, sobre todo, los errores de
 * body-parser: un JSON roto, un cuerpo por encima del límite (2mb, 12mb en ausencias)
 * o un juego de caracteres que no conoce.
 *
 * - 4xx: un código estable y un texto FIJO. Nunca el `err.message` del parser (puede
 *   citar un trozo del cuerpo) ni el cuerpo. Es culpa del cliente: ni log ni Sentry.
 * - 5xx: el mismo cuerpo genérico que los routers (SEC-007), a Sentry con el helper
 *   de siempre y al log SOLO el nombre del error, como router-kiosco.ts.
 *
 * Tiene que montarse el ÚLTIMO (lo vigila errores-json.test.ts): un manejador de
 * errores de Express solo ve lo que se montó antes que él.
 */

/** Los `type` de body-parser que tienen código propio. */
const POR_TIPO: Record<string, string> = {
  'entity.parse.failed': 'invalid_json',
  'entity.too.large': 'payload_too_large',
  'charset.unsupported': 'unsupported_charset',
  'encoding.unsupported': 'unsupported_encoding',
};

const POR_ESTADO: Record<number, string> = {
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'too_many_requests',
};

const MENSAJES: Record<string, string> = {
  invalid_json: 'El cuerpo de la petición no es un JSON válido.',
  payload_too_large: 'El cuerpo de la petición supera el tamaño permitido.',
  unsupported_charset: 'El juego de caracteres de la petición no está soportado.',
  unsupported_encoding: 'La codificación de la petición no está soportada.',
  unauthorized: 'No autenticado.',
  forbidden: 'No autorizado.',
  not_found: 'Recurso no encontrado.',
  method_not_allowed: 'Método no permitido.',
  unsupported_media_type: 'Tipo de contenido no soportado.',
  too_many_requests: 'Demasiadas peticiones.',
  bad_request: 'Petición no válida.',
};

const campo = (err: unknown, k: string): unknown =>
  err !== null && typeof err === 'object' ? (err as Record<string, unknown>)[k] : undefined;

/** `err.status` o `err.statusCode` si es un código de error HTTP; si no, 500. */
function estadoDe(err: unknown): number {
  for (const k of ['status', 'statusCode']) {
    const v = campo(err, k);
    if (Number.isInteger(v) && (v as number) >= 400 && (v as number) <= 599) return v as number;
  }
  return 500;
}

export const errorEnJson: ErrorRequestHandler = (err, _req, res, next) => {
  // Con la respuesta ya empezada no se puede cambiar el estado ni el cuerpo: Express
  // corta la conexión, que es lo único que cabe.
  if (res.headersSent) return next(err);
  const estado = estadoDe(err);
  if (estado >= 500) {
    const nombre = String(campo(err, 'name') ?? 'desconocido').slice(0, 40);
    console.error('express_error_final error (' + nombre + ')');
    captureError(err, { endpoint: 'express_error_final' });
    res.status(estado).json({ error: 'internal error' });
    return;
  }
  const tipo = campo(err, 'type');
  const codigo = (typeof tipo === 'string' && POR_TIPO[tipo]) || POR_ESTADO[estado] || 'bad_request';
  res.status(estado).json({ error: codigo, message: MENSAJES[codigo] });
};
