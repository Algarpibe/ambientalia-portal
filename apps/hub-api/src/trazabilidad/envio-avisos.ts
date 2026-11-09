/**
 * El canal de salida de los avisos a clientes: la ÚNICA pieza de
 * src/trazabilidad que habla con la red (envio-avisos.test.ts lo vigila). Lee
 * su configuración del entorno de hub-api —se cambia sólo en EasyPanel; el
 * portal no puede—, decide el modo efectivo y entrega cada correo a un flujo
 * de n8n (Webhook con token → barrera de dominio → Gmail de info@), esperando
 * su respuesta 30 s como mucho.
 *
 * Falla cerrado: sin TMC_AVISOS_ENVIO, con un valor que no sea exactamente
 * «apagado», «prueba» o «real», sin la URL o el token de n8n, o en prueba sin un
 * buzón de @ambientalia.com.co, el modo es «apagado» y no sale nada. En prueba,
 * además, aquí se vuelve a comprobar que el único destinatario es el buzón.
 *
 * Sin relojes ni programador: manda sólo cuando se le llama, y sólo lo llama la
 * ruta de «Enviar correo» (sólo lo importa router.ts). Es la pieza que cambiará
 * al pasar a Desk 2.0.
 */
import { esBuzonDePrueba, type CanalAvisos, type CorreoAEnviar, type EstadoCanal, type MotivoApagado, type ResultadoRemision } from './avisos-correo.js';
import { normalizarEmail } from './dominio.js';

/** Cuánto se espera, como mucho, la respuesta de n8n. */
export const ESPERA_MAX_MS = 30_000;
/** La cabecera del token: la credencial «Header Auth» del Webhook de n8n la comprueba. */
export const CABECERA_TOKEN = 'X-Tmc-Avisos-Token';
/** Errores de red que dicen que la petición no llegó a salir: entonces seguro que no se envió nada. */
const SIN_CONEXION = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

type Entorno = Readonly<Record<string, string | undefined>>;
type Red = (url: string, init: RequestInit) => Promise<Response>;

const apagado = (motivo: MotivoApagado | null): EstadoCanal => ({ modo: 'apagado', motivo, buzonPrueba: null });

function esUrl(v: string | undefined): boolean {
  try {
    return v !== undefined && ['http:', 'https:'].includes(new URL(v).protocol);
  } catch {
    return false;
  }
}

/** El modo efectivo según el entorno y, si queda apagado sin pedirlo, por qué. Sólo mira `env`. */
export function modoEfectivo(env: Entorno): EstadoCanal {
  const pedido = env.TMC_AVISOS_ENVIO;
  if (pedido === undefined || pedido === '') return apagado('sin_valor');
  if (pedido === 'apagado') return apagado(null);
  if (pedido !== 'prueba' && pedido !== 'real') return apagado('valor_desconocido');
  if (!esUrl(env.TMC_AVISOS_N8N_URL) || !env.TMC_AVISOS_N8N_TOKEN?.trim()) return apagado('sin_canal');
  if (pedido === 'real') return { modo: 'real', motivo: null, buzonPrueba: null };
  if (!esBuzonDePrueba(env.TMC_AVISOS_BUZON_PRUEBA)) return apagado('sin_buzon_prueba');
  return { modo: 'prueba', motivo: null, buzonPrueba: normalizarEmail(env.TMC_AVISOS_BUZON_PRUEBA) };
}

const esEspera = (e: unknown): boolean => ['TimeoutError', 'AbortError'].includes(String((e as { name?: unknown } | null)?.name));
const sinConexion = (e: unknown): boolean => SIN_CONEXION.has(String((e as { cause?: { code?: unknown } } | null)?.cause?.code));

/**
 * El canal de verdad. En producción, con el entorno del proceso y el `fetch` de
 * Node; las pruebas le pasan los suyos. Lee el entorno una vez, al crearse (al
 * arrancar hub-api): cambiar el modo es cambiar la variable y desplegar.
 */
export function crearCanalAvisos(env: Entorno = process.env, red: Red = fetch): CanalAvisos {
  const estado = modoEfectivo(env);
  const url = env.TMC_AVISOS_N8N_URL ?? '';
  const token = env.TMC_AVISOS_N8N_TOKEN ?? '';
  return {
    estado: () => estado,
    async remitir(correo: CorreoAEnviar, referencia: number): Promise<ResultadoRemision> {
      if (estado.modo === 'apagado') return { tipo: 'rechazado', motivo: 'El envío de avisos está apagado: no ha salido nada.' };
      if (estado.modo === 'prueba' && (correo.para.length !== 1 || correo.para[0] !== estado.buzonPrueba)) {
        return { tipo: 'rechazado', motivo: 'En modo prueba sólo se envía al buzón de prueba: no ha salido nada.' };
      }
      let res: Response;
      try {
        res = await red(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', [CABECERA_TOKEN]: token },
          body: JSON.stringify({ referencia, para: correo.para, asunto: correo.asunto, cuerpo: correo.cuerpo }),
          signal: AbortSignal.timeout(ESPERA_MAX_MS),
        });
      } catch (e) {
        return !esEspera(e) && sinConexion(e) ? { tipo: 'rechazado', motivo: 'No se pudo conectar con el servicio de correo: no ha salido nada.' } : { tipo: 'sin_respuesta' };
      }
      let cuerpo: { ok?: unknown; messageId?: unknown; error?: unknown } = {};
      try {
        const j: unknown = await res.json();
        if (j && typeof j === 'object') cuerpo = j as typeof cuerpo;
      } catch (e) {
        if (esEspera(e)) return { tipo: 'sin_respuesta' };
      }
      if (res.ok && cuerpo.ok === true && typeof cuerpo.messageId === 'string' && cuerpo.messageId !== '') return { tipo: 'enviado', messageId: cuerpo.messageId };
      if (!res.ok || cuerpo.ok === false) {
        const motivo = typeof cuerpo.error === 'string' && cuerpo.error.trim() !== '' ? cuerpo.error.trim().slice(0, 500) : `El servicio de correo respondió ${res.status}: no ha salido nada.`;
        return { tipo: 'rechazado', motivo };
      }
      return { tipo: 'sin_respuesta' };
    },
  };
}
