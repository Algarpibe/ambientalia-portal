import type { TipoSolicitud } from './types.js';

// Destinos y textos fijos de la app de ausencias. Todo lo que el flujo de n8n
// llevaba repartido por 44 nodos vive aquí, en un único sitio versionado:
// n8n ya no decide nada, solo ejecuta lo que hub-api le manda.
//
// Los ids son los MISMOS que usaba el flujo «Solicitud vacaciones_permisos_
// compensatorios_incapacidades 1.5», para que las hojas y el calendario sigan
// siendo exactamente los de siempre.

/** Buzón que aprueba por defecto cuando el empleado no tiene otro asignado. */
export const APROBADOR_POR_DEFECTO = 'comercial@ambientalia.com.co';

/** En copia en los avisos de decisión y en el acuse de incapacidad. */
export const COPIA_ADMINISTRACION = ['comercial@ambientalia.com.co', 'administrativo@ambientalia.com.co'];

/**
 * Quién puede abrir CUALQUIER adjunto de CUALQUIER persona desde el portal,
 * además del solicitante, sus dos aprobadores y los administradores.
 *
 * ⚠️ Es una llave maestra, y lo que abre incluye **el soporte médico de las
 * incapacidades ajenas**: dato de salud, con lo que eso implica para la Ley 1581.
 * Esta lista tiene que quedarse corta y cada correo debe estar justificado; no se
 * añade a nadie «por si acaso». Hoy son los mismos dos buzones que ya reciben el
 * acuse de cada incapacidad, así que no ensancha a quién llega la información,
 * solo le da una vía para consultarla sin salir del portal.
 *
 * No hay registro de descargas: `GET /ausencias/adjuntos/:id` no loguea nada, a
 * diferencia del PATCH y el DELETE del registro. Si esta lista crece, ese log es
 * lo siguiente que hay que añadir.
 */
export const VISORES_ADJUNTOS = ['comercial@ambientalia.com.co', 'administrativo@ambientalia.com.co'];

export const FIRMA_GERENCIA = 'Alfonso García del Pino Beneitez\nGerente General\nAmbientalia S.A.S.';
export const FIRMA_EMPRESA = 'Ambientalia S.A.S.';

/** Calendario compartido «Ambientalia Staff». */
export const CALENDARIO_STAFF =
  'c_3e3d01dfc8de570a77186b44e11b4cc64c222c74f6cd1dc2e51083ba2d12a842@group.calendar.google.com';

// Aquí vivían `DRIVE_ID` y `CARPETA_DRIVE`. La copia de los adjuntos a Google
// Drive se retiró: el PDF está en `portal.solicitud_adjuntos.contenido` desde el
// instante del alta, y ahora se consulta desde la propia app. Los ficheros que ya
// estaban en Drive se quedan ahí; esto solo cortó los nuevos.

/** Libro de Google Sheets `consulta_vacaciones`. */
export const HOJA_ID = '10vStWIghTjmsCar8n6wJySYDBhrV5UXsdcoQZEW-Jao';

/** Pestaña de destino por tipo. Nómina las sigue consultando tal cual. */
export const PESTANA: Record<TipoSolicitud, string> = {
  vacaciones: 'vacaciones_solicitadas',
  compensatorio: 'compensatorios_solicitados',
  permiso: 'permisos_solicitados',
  incapacidad: 'incapacidades_informadas',
};

/** Base pública del portal, para el enlace «ver en el portal» de los correos. */
export function urlPortal(): string {
  return (process.env.PORTAL_URL || 'https://portal.ambientalia.cloud').replace(/\/+$/, '');
}
