/**
 * Contrato de la API de «Equipos en taller» (`/api/equipos-taller`), compartido por
 * el servidor (hub-api) y la pantalla (apps/equipos-taller). Solo tipos y funciones
 * puras: la pantalla lo importa por ruta relativa y el `tsc -b` del portal lo
 * comprueba con su propia configuración, así que aquí no entra nada de Node.
 */
import type { Ajuste, Foto } from './nucleo/tipos.js';

/** Id de la app en `portal.user_apps` y en el JWT. */
export const APP_ID = 'equipos-taller';

export type OrigenCorrida = 'programada' | 'boton';

/** Una fila de `portal.equipos_ejecucion`. */
export interface Corrida {
  id: number;
  origen: OrigenCorrida;
  inicio: string;
  fin: string | null;
  enCurso: boolean;
  /** null mientras corre. */
  ok: boolean | null;
  /** Por qué falló («desk2: …», «drive: …»). Nunca lleva secretos. */
  causa: string | null;
  avisos: string[];
  conteos: Record<string, number> | null;
}

/** El incidente abierto (`portal.equipos_incidente`). */
export interface Incidente {
  id: number;
  abiertoEn: string;
  fallosProgramados: number;
  alertaEnviadaEn: string | null;
  alertaUltimoError: string | null;
}

/** Las llaves de un usuario (`portal.equipos_llaves`). */
export interface LlavesUsuario {
  editaAjustes: boolean;
  recibeAlertas: boolean;
}

/** Lo que puede hacer en la pantalla quien la abre. La pantalla solo oculta botones: el servidor vuelve a comprobarlo. */
export interface PermisosPantalla extends LlavesUsuario {
  esAdmin: boolean;
  /** `edita_ajustes` o admin. */
  puedeEditar: boolean;
}

/** Un ajuste manual con su firma: quién y cuándo. */
export type AjusteFirmado = Ajuste & { usuario: string; creadoEn: string };

/** Respuesta de GET /api/equipos-taller. */
export interface RespuestaEquipos {
  snap: Foto | null;
  ajustes: Record<string, AjusteFirmado>;
  actualizando: boolean;
  /** false si falta la configuración de Google Drive. */
  configurado: boolean;
  ultima: Corrida | null;
  ultimaBuena: Corrida | null;
  incidente: Incidente | null;
  permisos: PermisosPantalla;
}

/** Una fila de GET /api/equipos-taller/llaves. */
export interface UsuarioConLlaves extends LlavesUsuario {
  userId: string;
  nombre: string;
  email: string;
  esAdmin: boolean;
  actualizadoPor: string | null;
  actualizadoEn: string | null;
}

const CLAVE = /^(\*[A-Z0-9]{3,20}|[A-Z0-9]{3,20}\|\d{4}-\d{2}-\d{2}|pdf:[A-Za-z0-9_-]{10,80})$/;
/** Claves de ajuste: «SERIAL|AAAA-MM-DD», «*SERIAL» o «pdf:<idDrive>» (el serial, en clase OCR). */
export const claveValida = (k: string): boolean => CLAVE.test(k);

export const TIPOS_AJUSTE: readonly Ajuste['t'][] = ['in', 'out', 'ret', 'pdf'];

/** ¿Clave válida y tipo que casa con ella? «pdf» solo para «pdf:<id>», y al revés. */
export function ajusteValido(clave: string, t: unknown): t is Ajuste['t'] {
  return claveValida(clave) && TIPOS_AJUSTE.includes(t as Ajuste['t']) && (t === 'pdf') === clave.startsWith('pdf:');
}

export interface AvisoFoto {
  texto: string;
  /** Incidente con 2 o más corridas programadas fallidas. */
  destacado: boolean;
}

/** Qué fuente falló, dicho para la pantalla. */
function queFallo(causa: string | null): string {
  if (causa?.startsWith('desk2:')) return 'No se pudo leer Desk 2.0';
  if (causa?.startsWith('drive:')) return 'No se pudo leer Google Drive';
  return 'No se pudo actualizar la información';
}

/**
 * El aviso de foto vieja de la pantalla (§5.3 del diseño), o null si no hay nada
 * que avisar. `fecha` da formato a un instante ISO (la pantalla usa es-CO).
 */
export function avisoFoto(
  e: Pick<RespuestaEquipos, 'configurado' | 'ultima' | 'ultimaBuena' | 'incidente'>,
  fecha: (iso: string) => string,
): AvisoFoto | null {
  if (!e.configurado) return { texto: 'Falta configurar Google Drive', destacado: false };
  if (!e.ultima || e.ultima.ok !== false) return null;
  const datos = e.ultimaBuena?.fin ? '; datos del ' + fecha(e.ultimaBuena.fin) : '; todavía no hay datos';
  return { texto: queFallo(e.ultima.causa) + datos, destacado: (e.incidente?.fallosProgramados ?? 0) >= 2 };
}
