import type { TipoSolicitud } from './types.js';

// Destinos y textos fijos de la app de ausencias. Todo lo que el flujo de n8n
// llevaba repartido por 44 nodos vive aquí, en un único sitio versionado:
// n8n ya no decide nada, solo ejecuta lo que hub-api le manda.
//
// Los ids son los MISMOS que usaba el flujo «Solicitud vacaciones_permisos_
// compensatorios_incapacidades 1.5», para que las hojas, el calendario y las
// carpetas de Drive sigan siendo exactamente los de siempre.

/** Buzón que aprueba por defecto cuando el empleado no tiene otro asignado. */
export const APROBADOR_POR_DEFECTO = 'comercial@ambientalia.com.co';

/** En copia en los avisos de decisión y en el acuse de incapacidad. */
export const COPIA_ADMINISTRACION = ['comercial@ambientalia.com.co', 'administrativo@ambientalia.com.co'];

export const FIRMA_GERENCIA = 'Alfonso García del Pino Beneitez\nGerente General\nAmbientalia S.A.S.';
export const FIRMA_EMPRESA = 'Ambientalia S.A.S.';

/** Calendario compartido «Ambientalia Staff». */
export const CALENDARIO_STAFF =
  'c_3e3d01dfc8de570a77186b44e11b4cc64c222c74f6cd1dc2e51083ba2d12a842@group.calendar.google.com';

/** Unidad compartida «1. ADMON CONTABILIDAD Y FINANZAS». */
export const DRIVE_ID = '0AEOBz8bVbyfFUk9PVA';

/** Carpeta de Drive donde aterriza el PDF, por tipo. */
export const CARPETA_DRIVE: Partial<Record<TipoSolicitud, string>> = {
  incapacidad: '1s0ZNfbJ8sHxBcTxkBcWaUN-N55r_m5vi', // «Adjuntos incapacidades»
  permiso: '1wi4HrRUIC08BbC8wriS-RLX9An37MyNV', // «Adjuntos permisos»
};

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
