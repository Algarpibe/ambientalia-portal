// Piezas compartidas de la recuperación de contraseña entre el panel de acceso
// (modo «¿Olvidaste tu contraseña?») y la página /auth/restablecer. Spec
// 2026-11-13, §6.

/** Con qué se abre /auth cuando se llega desde otra pantalla (`location.state.modo`). */
export type ModoAuth = 'login' | 'olvido';

/** Tras pedir el enlace: el mismo texto exista o no la cuenta. */
export const MENSAJE_ENLACE_PEDIDO =
  'Si el correo está registrado, recibirás un enlace en unos minutos. Revisa también la carpeta de spam.';
export const MENSAJE_DEMASIADOS_INTENTOS = 'Demasiados intentos, espera unos minutos.';
export const MENSAJE_SIN_SERVIDOR = 'No se pudo conectar con el servidor. Reintenta.';
/** Cualquier otra respuesta que no sea 200 ni 429 (no debería darse: hub-api responde 200 antes de trabajar). */
export const MENSAJE_NO_ENVIADO = 'No se pudo enviar el enlace. Reintenta.';
