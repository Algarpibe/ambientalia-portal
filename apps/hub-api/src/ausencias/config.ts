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

/**
 * La copia con la que la migración 021 sembró toda la plantilla. Se acepta
 * aunque su ficha no esté activa, por lo mismo que `APROBADOR_POR_DEFECTO`:
 * si ese buzón se desactivara, rechazarlo convertiría el valor por defecto de
 * toda la empresa en algo que ya no se puede volver a poner desde el panel.
 */
export const COPIA_POR_DEFECTO = 'administrativo@ambientalia.com.co';

// Aquí vivía `COPIA_ADMINISTRACION`, con `comercial@` y `administrativo@` fijos
// para toda la empresa. La copia es ahora un campo de la ficha del empleado
// (`portal.empleados.copia_correo`, migración 021), editable desde la pestaña
// Organigrama. `comercial@` no se pierde de los correos de decisión (aprobada y
// rechazada): es primer o segundo firmante de toda la plantilla y sigue
// llegando por `cadenaDeDecision`. En el acuse de incapacidad no hay cadena de
// firmas que lo traiga —ver `COPIA_INCAPACIDADES`— así que ahí se conserva a
// propósito, explícito y aparte.

/**
 * Siempre en copia del acuse de una incapacidad, además de la copia de la ficha.
 *
 * Es fijo y no configurable a propósito, y es la única mitad de la vieja
 * `COPIA_ADMINISTRACION` que sobrevive. El motivo: una incapacidad solo genera
 * el evento `registrada`, nunca uno de decisión, así que —al contrario que en
 * aprobada y rechazada— este buzón NO llega por `cadenaDeDecision`. Sin esta
 * constante, gerencia dejaría de enterarse de las incapacidades el día del
 * despliegue.
 */
export const COPIA_INCAPACIDADES = 'comercial@ambientalia.com.co';

/**
 * Quién puede abrir CUALQUIER adjunto de CUALQUIER persona desde el portal,
 * además del solicitante, sus dos aprobadores y los administradores.
 *
 * ⚠️ Es una llave maestra, y lo que abre incluye **el soporte médico de las
 * incapacidades ajenas**: dato de salud, con lo que eso implica para la Ley 1581.
 * Esta lista tiene que quedarse corta y cada correo debe estar justificado; no se
 * añade a nadie «por si acaso». `comercial@` está aquí por lo mismo que en
 * `COPIA_INCAPACIDADES`: siempre recibe el acuse de cada incapacidad, fijo y no
 * editable, así que esta lista no le da acceso a información que no le llegara
 * ya. `administrativo@` es distinto desde que la copia se volvió configurable:
 * hoy sigue siendo el valor sembrado de `copia_correo` para toda la plantilla,
 * pero cualquier ficha puede cambiarlo desde el organigrama, así que su sitio
 * aquí ya no se apoya en «recibe el acuse» — es una decisión propia que hay que
 * revisar si alguna vez deja de tener sentido.
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
