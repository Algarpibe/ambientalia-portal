/**
 * Configuración de «Equipos en taller» a partir del entorno de hub-api (§7 del diseño).
 * Drive ya no se configura aquí: lo lee n8n y manda la copia (revisión del
 * 10/11/2026). El módulo queda «sin configurar» mientras no haya ninguna sincronización
 * completa de n8n, y eso lo dice la base, no el entorno.
 *
 * ⚠️ Lo que se informa son NOMBRES de variables, nunca un valor: los tokens son secretos.
 *
 * Las variables se leen una a una por su nombre: así las ve el detector de
 * `.env.example` (env-example.test.ts, INFRA-537).
 */

type Entorno = Readonly<Record<string, string | undefined>>;

const entornoDelProceso = (): Entorno => ({
  EQUIPOS_SYNC_TOKEN: process.env.EQUIPOS_SYNC_TOKEN,
  EQUIPOS_SYNC_MAX_HORAS: process.env.EQUIPOS_SYNC_MAX_HORAS,
  EQUIPOS_HORA_DIARIA: process.env.EQUIPOS_HORA_DIARIA,
  EQUIPOS_ALERTA_WEBHOOK_URL: process.env.EQUIPOS_ALERTA_WEBHOOK_URL,
  EQUIPOS_ALERTA_TOKEN: process.env.EQUIPOS_ALERTA_TOKEN,
  EQUIPOS_ALERTA_RESERVA: process.env.EQUIPOS_ALERTA_RESERVA,
});

export const HORA_POR_DEFECTO = '06:30';
export const RESERVA_POR_DEFECTO = 'comercial@ambientalia.com.co';
/** Solo salen correos a este dominio (la barrera de n8n dice lo mismo). */
export const DOMINIO_ALERTA = '@ambientalia.com.co';

/** Una dirección de correo del dominio de alertas: una sola arroba, sin espacios. */
export const DIRECCION_ALERTA = /^[^\s@]+@ambientalia\.com\.co$/;

/** Horas que puede tener, como mucho, la última sincronización completa de n8n. */
export const MAX_HORAS_SYNC_POR_DEFECTO = 6;

export interface ConfigAlerta {
  url: string;
  token: string;
}

export interface ConfigEquipos {
  /** HH:MM, hora de Colombia. */
  horaDiaria: string;
  /** null = alerta apagada. */
  alerta: ConfigAlerta | null;
  reserva: string;
  /** EQUIPOS_SYNC_MAX_HORAS: con una copia de Drive más vieja, la corrida falla. */
  maxHorasSync: number;
  /** Si EQUIPOS_SYNC_TOKEN está y vale como cabecera. Nunca su valor: lo lee requireCronToken (auth.ts). */
  tokenSync: boolean;
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Un entero de hasta tres cifras (luego se acota de 1 a 168). */
const HORAS = /^\d{1,3}$/;

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

export function leerConfig(env: Entorno = entornoDelProceso()): ConfigEquipos {
  const hora = (env.EQUIPOS_HORA_DIARIA ?? '').trim();
  const url = (env.EQUIPOS_ALERTA_WEBHOOK_URL ?? '').trim();
  const token = env.EQUIPOS_ALERTA_TOKEN?.trim();
  const reserva = (env.EQUIPOS_ALERTA_RESERVA ?? '').trim().toLowerCase();
  const horas = (env.EQUIPOS_SYNC_MAX_HORAS ?? '').trim();
  const maxHoras = HORAS.test(horas) ? Number(horas) : NaN;
  return {
    horaDiaria: HORA.test(hora) ? hora : HORA_POR_DEFECTO,
    alerta: esUrl(url) && esToken(token) ? { url, token } : null,
    reserva: DIRECCION_ALERTA.test(reserva) ? reserva : RESERVA_POR_DEFECTO,
    maxHorasSync: maxHoras >= 1 && maxHoras <= 168 ? maxHoras : MAX_HORAS_SYNC_POR_DEFECTO,
    tokenSync: esToken(env.EQUIPOS_SYNC_TOKEN),
  };
}
