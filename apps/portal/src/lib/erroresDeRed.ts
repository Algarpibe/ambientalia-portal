// FE-413 — errores de red crudos, en inglés, a la vista del usuario.
//
// Sin conexión (o con el servidor caído, o bloqueado por CORS), `fetch` no
// devuelve una respuesta: RECHAZA con un `TypeError` cuyo texto pone el
// navegador —«Failed to fetch» en Chrome, «NetworkError when attempting to fetch
// resource.» en Firefox, «Load failed» en Safari—. Unas 80 pantallas de las
// sub-apps hacen `setError(e.message)`, así que eso es lo que se leía.
//
// Mismo punto común que FE-412 (ver interceptor401.ts): las sub-apps corren
// dentro del portal y todas pasan por `fetch`. Va en un envoltorio aparte y no
// dentro del de FE-412 porque no depende de `VITE_HUB_API_URL` ni de la URL:
// el mensaje es para quien mira la pantalla, venga de hub-api o de otro
// servidor (laboratorios-ambientales consulta datos.gov.co con `fetch` a pelo y
// pinta `e.message` igual).
//
// Lo que NO se toca:
//  - El tipo: sigue siendo `TypeError`, por si alguien distingue «no hubo
//    respuesta» con `instanceof`. El original viaja en `cause` (Sentry lo sigue).
//  - Un `AbortError` (DOMException) o cualquier otro rechazo: cancelar es
//    deliberado y quien cancela lo reconoce por `name`.
//  - Las respuestas, incluidas las de error (4xx/5xx): esas ya las redacta cada
//    app o `mensajeDeError` de @suite/http.
//
// Contrapartida conocida: el navegador usa también `TypeError` para una petición
// mal construida (cabecera o URL inválidas). Es un fallo de programación, raro, y
// su texto real queda en `cause`; distinguirlo por el mensaje dependería de
// cadenas distintas en cada navegador, que es justo lo que se quiere evitar.

export const MENSAJE_SIN_CONEXION = 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';

const MARCA = Symbol.for('ambientalia.erroresDeRed');

interface Opciones {
  /** Dónde vive el `fetch` a envolver. `globalThis` en el navegador; un doble en los tests. */
  objetivo?: { fetch: typeof fetch };
}

export function instalarTraduccionDeErroresDeRed({ objetivo = globalThis }: Opciones = {}): void {
  const original = objetivo.fetch;
  // El HMR de Vite re-ejecuta main.tsx: sin esto, cada guardado añadiría otra capa.
  if ((original as unknown as Record<symbol, boolean>)[MARCA]) return;

  const envuelto = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      // Con su `this`: el fetch nativo llamado suelto lanza «Illegal invocation».
      return await original.call(objetivo, input, init);
    } catch (error) {
      if (error instanceof TypeError) throw new TypeError(MENSAJE_SIN_CONEXION, { cause: error });
      throw error;
    }
  };
  (envuelto as unknown as Record<symbol, boolean>)[MARCA] = true;
  objetivo.fetch = envuelto as typeof fetch;
}
