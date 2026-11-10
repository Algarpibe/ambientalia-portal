/**
 * Configuración de «Equipos en taller» a partir del entorno de hub-api (§7 del
 * diseño). Sin la cuenta de servicio o sin alguna carpeta de Drive, el módulo
 * queda «sin configurar»: la pantalla lo dice y el botón queda desactivado.
 *
 * ⚠️ Lo que se informa de lo que falta son NOMBRES de variables. Nunca un valor:
 * la cuenta de servicio lleva la clave privada y el token de la alerta es un
 * secreto.
 *
 * Las variables se leen una a una por su nombre: así las ve el detector de
 * `.env.example` (env-example.test.ts, INFRA-537).
 */
import type { ConfigDrive, CuentaServicioGoogle } from './fuente-drive.js';

type Entorno = Readonly<Record<string, string | undefined>>;

const entornoDelProceso = (): Entorno => ({
  EQUIPOS_GOOGLE_CUENTA_SERVICIO: process.env.EQUIPOS_GOOGLE_CUENTA_SERVICIO,
  EQUIPOS_DRIVE_ENTRADAS: process.env.EQUIPOS_DRIVE_ENTRADAS,
  EQUIPOS_DRIVE_SALIDAS_N8N: process.env.EQUIPOS_DRIVE_SALIDAS_N8N,
  EQUIPOS_DRIVE_SALIDAS_ESCANEADAS: process.env.EQUIPOS_DRIVE_SALIDAS_ESCANEADAS,
  EQUIPOS_DRIVE_TEMPORAL: process.env.EQUIPOS_DRIVE_TEMPORAL,
  EQUIPOS_HORA_DIARIA: process.env.EQUIPOS_HORA_DIARIA,
  EQUIPOS_ALERTA_WEBHOOK_URL: process.env.EQUIPOS_ALERTA_WEBHOOK_URL,
  EQUIPOS_ALERTA_TOKEN: process.env.EQUIPOS_ALERTA_TOKEN,
  EQUIPOS_ALERTA_RESERVA: process.env.EQUIPOS_ALERTA_RESERVA,
});

export const HORA_POR_DEFECTO = '06:30';
export const RESERVA_POR_DEFECTO = 'comercial@ambientalia.com.co';
/** Solo salen correos a este dominio (la barrera de n8n dice lo mismo). */
export const DOMINIO_ALERTA = '@ambientalia.com.co';

export interface ConfigAlerta {
  url: string;
  token: string;
}

export interface ConfigEquipos {
  /** null = «sin configurar». */
  drive: ConfigDrive | null;
  /** Qué variables faltan o no valen para Drive (solo nombres). */
  faltaDrive: string[];
  /** HH:MM, hora de Colombia. */
  horaDiaria: string;
  /** null = alerta apagada. */
  alerta: ConfigAlerta | null;
  reserva: string;
}

const ID_DRIVE = /^[A-Za-z0-9_-]{10,100}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** https, o http sólo hacia un servidor de una sola etiqueta (un servicio de Docker); sin usuario ni clave. Igual que trazabilidad/envio-avisos.ts. */
function esUrl(v: string | undefined): boolean {
  if (!v) return false;
  try {
    const u = new URL(v);
    if (u.username !== '' || u.password !== '') return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && u.hostname !== '' && !u.hostname.includes('.') && !u.hostname.includes(':');
  } catch {
    return false;
  }
}
/** Un token válido como valor de cabecera: sólo ASCII visible, sin espacios. */
const esToken = (v: string | undefined): v is string => v !== undefined && /^[\x21-\x7E]+$/.test(v);

function cuenta(v: string | undefined): CuentaServicioGoogle | null {
  try {
    const j = JSON.parse(String(v ?? '')) as Partial<CuentaServicioGoogle>;
    return typeof j.client_email === 'string' && typeof j.private_key === 'string' && j.private_key.includes('PRIVATE KEY')
      ? { client_email: j.client_email, private_key: j.private_key }
      : null;
  } catch {
    return null;
  }
}

export function leerConfig(env: Entorno = entornoDelProceso()): ConfigEquipos {
  const faltaDrive: string[] = [];
  const sa = cuenta(env.EQUIPOS_GOOGLE_CUENTA_SERVICIO);
  if (!sa) faltaDrive.push('EQUIPOS_GOOGLE_CUENTA_SERVICIO');
  const carpeta = (nombre: string): string => {
    const v = (env[nombre] ?? '').trim();
    if (!ID_DRIVE.test(v)) faltaDrive.push(nombre);
    return v;
  };
  const entradas = carpeta('EQUIPOS_DRIVE_ENTRADAS');
  const salidasGeneradas = carpeta('EQUIPOS_DRIVE_SALIDAS_N8N');
  const salidasEscaneadas = carpeta('EQUIPOS_DRIVE_SALIDAS_ESCANEADAS');
  const carpetaTemporalOcr = carpeta('EQUIPOS_DRIVE_TEMPORAL');
  const hora = (env.EQUIPOS_HORA_DIARIA ?? '').trim();
  const url = (env.EQUIPOS_ALERTA_WEBHOOK_URL ?? '').trim();
  const token = env.EQUIPOS_ALERTA_TOKEN;
  const reserva = (env.EQUIPOS_ALERTA_RESERVA ?? '').trim().toLowerCase();
  return {
    drive: sa && !faltaDrive.length ? { cuentaServicio: sa, carpetas: { entradas, salidasGeneradas, salidasEscaneadas }, carpetaTemporalOcr } : null,
    faltaDrive,
    horaDiaria: HORA.test(hora) ? hora : HORA_POR_DEFECTO,
    alerta: esUrl(url) && esToken(token) ? { url, token } : null,
    reserva: /^[^\s@]+@ambientalia\.com\.co$/.test(reserva) ? reserva : RESERVA_POR_DEFECTO,
  };
}
