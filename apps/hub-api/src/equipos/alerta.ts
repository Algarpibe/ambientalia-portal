/**
 * Alerta de foto vieja de «Equipos en taller» (D6, §5.2): un correo por el
 * webhook de n8n «Equipos · Alerta de foto vieja», con su token en una cabecera.
 * Mismo patrón que trazabilidad/envio-avisos.ts. El contrato del webhook está en
 * docs/equipos-taller.md.
 *
 * ⚠️ El token no sale nunca: ni en el registro ni en el error que se guarda
 * (`alerta_ultimo_error`), que además se corta.
 */
import { DIRECCION_ALERTA, type ConfigAlerta } from './config.js';

/** La cabecera del token: la credencial «Header Auth» del Webhook de n8n la comprueba. */
export const CABECERA_TOKEN = 'X-Equipos-Alerta-Token';
/** Cuánto se espera, como mucho, la respuesta de n8n. */
export const ESPERA_MAX_MS = 30_000;

export interface CorreoAlerta {
  para: string[];
  asunto: string;
  cuerpo: string;
}
export type ResultadoAlerta = { ok: true } | { ok: false; error: string };

export interface CanalAlerta {
  encendido: boolean;
  enviar(correo: CorreoAlerta, referencia: number): Promise<ResultadoAlerta>;
}

type Red = (url: string, init: RequestInit) => Promise<Response>;

/** Los correos del dominio, sin repetir; si no queda ninguno, la dirección de reserva. */
export function destinatarios(correos: readonly string[], reserva: string): string[] {
  const del = [...new Set(correos.map((c) => c.trim().toLowerCase()).filter((c) => DIRECCION_ALERTA.test(c)))];
  return del.length ? del.sort() : [reserva];
}

/** Asunto y cuerpo del aviso. `fotoBuena` es el instante ISO de la última corrida buena. */
export function correoAlerta(d: { causa: string; fallosProgramados: number; fotoBuena: string | null }): { asunto: string; cuerpo: string } {
  const desde = d.fotoBuena
    ? new Date(d.fotoBuena).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota' })
    : null;
  return {
    asunto: 'Equipos en taller: la información no se actualiza' + (desde ? ' desde el ' + desde : ''),
    cuerpo: [
      'La actualización diaria de «Equipos en taller» ha fallado ' + d.fallosProgramados + ' veces seguidas.',
      'Motivo de la última: ' + d.causa + '.',
      desde ? 'La pantalla sigue mostrando los datos del ' + desde + '.' : 'Todavía no hay ninguna foto buena.',
      'Cuando se resuelva, basta pulsar «Actualizar información» en el portal. Este aviso no se repite mientras dure el incidente.',
    ].join('\n\n'),
  };
}

export function crearCanalAlerta(cfg: ConfigAlerta | null, red: Red = fetch, log: (t: string) => void = (t) => console.warn(t)): CanalAlerta {
  if (!cfg) {
    log('equipos-taller: alerta apagada (faltan EQUIPOS_ALERTA_WEBHOOK_URL y EQUIPOS_ALERTA_TOKEN)');
    return { encendido: false, enviar: async () => ({ ok: false, error: 'alerta apagada: falta configurar el webhook de n8n' }) };
  }
  const limpio = (s: string) => s.split(cfg.token).join('[token]').trim().slice(0, 300);
  return {
    encendido: true,
    async enviar(correo, referencia) {
      let res: Response;
      try {
        res = await red(cfg.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', [CABECERA_TOKEN]: cfg.token },
          body: JSON.stringify({ referencia, para: correo.para, asunto: correo.asunto, cuerpo: correo.cuerpo }),
          // Sin seguir redirecciones: el token no debe viajar a otro sitio.
          redirect: 'manual',
          signal: AbortSignal.timeout(ESPERA_MAX_MS),
        });
      } catch (e) {
        const nombre = String((e as { name?: unknown } | null)?.name ?? '');
        return { ok: false, error: nombre === 'TimeoutError' || nombre === 'AbortError' ? 'n8n no respondió a tiempo' : 'sin conexión con n8n' };
      }
      let cuerpo: { ok?: unknown; error?: unknown } = {};
      try {
        const j: unknown = await res.json();
        if (j && typeof j === 'object') cuerpo = j as typeof cuerpo;
      } catch {
        /* sin cuerpo JSON */
      }
      if (res.ok && cuerpo.ok === true) return { ok: true };
      const motivo = typeof cuerpo.error === 'string' && cuerpo.error.trim() ? limpio(cuerpo.error) : '';
      return { ok: false, error: 'n8n respondió ' + res.status + (motivo ? ': ' + motivo : '') };
    },
  };
}
