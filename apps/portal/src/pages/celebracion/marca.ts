// Colores de la marca Ambientalia (los del logo) y tipografías de la invitación.

export const COLORES = ['#D81B60', '#F47920', '#FDB913', '#8DC63F', '#008556', '#006699', '#3F3D99'] as const;

/** Los de buen contraste con texto blanco (sin el amarillo ni el lima). */
export const COLORES_AVATAR = ['#D81B60', '#F47920', '#008556', '#006699', '#3F3D99'] as const;

export const ESPECTRO =
  'linear-gradient(90deg, #D81B60 0%, #F47920 18%, #FDB913 36%, #8DC63F 54%, #008556 70%, #006699 85%, #3F3D99 100%)';

export const TITULO_DEGRADADO = 'linear-gradient(90deg, #D81B60, #F47920, #008556, #006699, #3F3D99)';

/** Ya se cargan en index.html; el body del portal usa las del sistema (decisión D12). */
export const FUENTE_TITULOS = "'Outfit', sans-serif";
export const FUENTE_TEXTO = "'Inter', sans-serif";
