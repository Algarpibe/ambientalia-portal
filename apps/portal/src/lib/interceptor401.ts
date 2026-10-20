// FE-412 — sesión revocada en el servidor que el portal no detectaba.
//
// hub-api relee rol, apps y token_version en CADA petición (requireAuth), así
// que una baja, un cambio de rol o un «cerrar todas las sesiones» invalidan el
// token al momento. Pero el portal no se enteraba: cada pantalla enseñaba su
// propio error («Tu sesión ha caducado…») y el usuario se quedaba dentro, con
// un token muerto en localStorage, hasta que caducara por fecha.
//
// Por qué un envoltorio de `fetch` y no un helper compartido: las sub-apps se
// empaquetan DENTRO del portal y corren en esta misma página, pero casi todas
// llaman a `fetch` a pelo con `authHeaders()` (unos 16 ficheros en 9 apps; ver
// ARQ-611). El único punto por el que pasan todas es el propio `fetch`, y
// envolverlo aquí las cubre a todas sin tocar ninguna. Migrarlas a un cliente
// común es el arreglo de fondo, y está en el backlog.
//
// ⚠️ Quien lea una sub-app no verá esto: un 401 de hub-api, en cualquier
// pantalla, saca al usuario del portal. Es a propósito.

/** Rutas donde un 401 es la respuesta normal y no una sesión revocada. */
const RUTAS_EXENTAS = ['/api/login', '/api/auth/logout'];

const MARCA = Symbol.for('ambientalia.interceptor401');

interface Opciones {
  /** `VITE_HUB_API_URL`: solo los 401 de hub-api son asunto de la sesión. */
  apiBase: string;
  /** Qué hacer al detectar la sesión revocada (borrar el token y volver a /auth). */
  alExpirar: () => void;
  /** Dónde vive el `fetch` a envolver. `globalThis` en el navegador; un doble en los tests. */
  objetivo?: { fetch: typeof fetch };
}

function urlDe(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function instalarInterceptor401({ apiBase, alExpirar, objetivo = globalThis }: Opciones): void {
  const original = objetivo.fetch;
  // El HMR de Vite re-ejecuta main.tsx: sin esto, cada guardado añadiría otra
  // capa y un solo 401 dispararía la salida varias veces.
  if ((original as unknown as Record<symbol, boolean>)[MARCA]) return;

  const base = apiBase.replace(/\/+$/, '');
  // Una pantalla lanza varias peticiones a la vez y todas vuelven 401: la
  // salida tiene que ocurrir UNA vez, no una por petición.
  let yaSalio = false;

  const envuelto = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Con su `this`: el fetch nativo llamado suelto lanza «Illegal invocation»,
  // y eso tumbaría todas las peticiones del portal.
  const respuesta = await original.call(objetivo, input, init);
    if (respuesta.status === 401 && !yaSalio) {
      const url = urlDe(input);
      if (url.startsWith(`${base}/`)) {
        const ruta = url.slice(base.length).split(/[?#]/)[0];
        if (!RUTAS_EXENTAS.includes(ruta)) {
          yaSalio = true;
          alExpirar();
        }
      }
    }
    // La respuesta sigue llegando al que llamó: su propio manejo de errores no
    // cambia, solo deja de quedarse dentro el usuario.
    return respuesta;
  };
  (envuelto as unknown as Record<symbol, boolean>)[MARCA] = true;
  objetivo.fetch = envuelto as typeof fetch;
}
