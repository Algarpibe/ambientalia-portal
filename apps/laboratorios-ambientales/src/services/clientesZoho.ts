import { authHeaders } from '@suite/auth-client';
import type { CruceZoho, HechosZoho } from '../lib/clientes';
import { REQUEST_TIMEOUT_MS } from './api';

// Cruce de los prospectos con Zoho, servido por hub-api. Un 401 lo resuelve el
// interceptor del portal (parchea fetch): aquí basta con fallar.
const URL_CLIENTES = `${(import.meta.env.VITE_HUB_API_URL as string | undefined) ?? ''}/api/laboratorios/clientes`;

type ClienteZoho = HechosZoho & { nit: string };

/**
 * Pide a hub-api el cruce de estos NIT base. Sin NIT no llama. Con el mismo
 * tope de tiempo que datos.gov.co; `signal` permite cancelarla al cerrar la
 * vista. `cabeceras` solo se cambia en las pruebas.
 */
export async function fetchClientesZoho(
  nits: string[],
  signal?: AbortSignal,
  cabeceras: () => Record<string, string> = authHeaders,
): Promise<CruceZoho> {
  if (nits.length === 0) return new Map();

  const controller = new AbortController();
  let vencido = false;
  const timer = setTimeout(() => {
    vencido = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const alAbortar = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', alAbortar, { once: true });

  try {
    const respuesta = await fetch(URL_CLIENTES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cabeceras() },
      body: JSON.stringify({ nits }),
      signal: controller.signal,
    });
    if (!respuesta.ok) throw new Error(`hub-api respondió ${respuesta.status}`);
    const cuerpo = (await respuesta.json()) as { clientes?: ClienteZoho[] };
    if (!Array.isArray(cuerpo.clientes)) throw new Error('La respuesta de hub-api no trae «clientes»');
    return new Map(
      cuerpo.clientes.map(({ nit, ultimaFactura, ocmaVendido, ultimosRepuestos }) => [
        nit,
        { ultimaFactura, ocmaVendido, ultimosRepuestos },
      ]),
    );
  } catch (error) {
    if (vencido) throw new Error(`hub-api no respondió en ${REQUEST_TIMEOUT_MS / 1000} s`);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', alAbortar);
  }
}
