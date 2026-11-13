/**
 * Asunto y cuerpo de los dos correos de la recuperación de contraseña: el del
 * enlace y el aviso de que la contraseña cambió. Funciones puras —ni red, ni
 * reloj, ni entorno—; los envía password-reset.mailer.ts.
 *
 * HTML sencillo con estilos en línea (los clientes de correo ignoran las hojas
 * de estilo). El nombre de la persona se escapa siempre: lo escribió ella al
 * registrarse, y un `<` suelto rompería el correo o colaría marcado.
 */

/** Lo que lleva cada correo; el destinatario lo pone quien lo envía. */
export interface ResetEmailContent {
  asunto: string;
  cuerpo: string;
}

/** Fecha y hora de Colombia, p. ej. «13 de noviembre de 2026, 22:30». */
const FECHA_COLOMBIA = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'America/Bogota',
});

/** Escapa los cinco caracteres con significado en HTML (vale para texto y atributos). */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * El enlace del correo. El token va tras el `#`, que el navegador no envía al
 * servidor: no queda en los logs de nginx ni en la cabecera Referer.
 */
export function resetLink(portalUrl: string, token: string): string {
  return `${portalUrl.replace(/\/+$/, '')}/auth/restablecer#t=${token}`;
}

const envolver = (html: string): string =>
  `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.5; color: #1f2937;">${html}</div>`;

/** El correo con el enlace para elegir una contraseña nueva. */
export function buildResetLinkEmail({
  fullName,
  portalUrl,
  token,
}: {
  fullName: string;
  portalUrl: string;
  token: string;
}): ResetEmailContent {
  const nombre = escapeHtml(fullName);
  const enlace = escapeHtml(resetLink(portalUrl, token));
  return {
    asunto: 'Restablecer tu contraseña del Portal Ambientalia',
    cuerpo: envolver(
      `<p>Hola, ${nombre}:</p>` +
        '<p>Hemos recibido una solicitud para restablecer la contraseña de tu cuenta del Portal Ambientalia.</p>' +
        `<p><a href="${enlace}" style="display: inline-block; padding: 10px 18px; background: #1abc9c; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold;">Elegir una contraseña nueva</a></p>` +
        `<p>Si el botón no funciona, copia este enlace en el navegador:<br><a href="${enlace}">${enlace}</a></p>` +
        '<p>El enlace vale 30 minutos y se puede usar una sola vez.</p>' +
        '<p>Si no lo has pedido tú, puedes ignorar este correo: tu contraseña no cambia.</p>',
    ),
  };
}

/** El aviso que sale después de cambiar la contraseña. */
export function buildPasswordChangedEmail({ fullName, changedAt }: { fullName: string; changedAt: Date }): ResetEmailContent {
  return {
    asunto: 'Tu contraseña del Portal Ambientalia se ha cambiado',
    cuerpo: envolver(
      `<p>Hola, ${escapeHtml(fullName)}:</p>` +
        `<p>La contraseña de tu cuenta del Portal Ambientalia se cambió el ${FECHA_COLOMBIA.format(changedAt)} (hora de Colombia).</p>` +
        '<p>Si no fuiste tú, avisa al administrador del portal cuanto antes.</p>',
    ),
  };
}
