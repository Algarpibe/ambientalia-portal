import { envolver, escapeHtml, portalBase } from '../password-reset/password-reset.emails.js';
import type { AccessApp } from './app-catalog.js';

/**
 * Asunto y cuerpo de los tres correos de acceso al portal (spec 2026-11-20,
 * §4.3): bienvenida al aprobar la cuenta, reactivación y apps nuevas. Funciones
 * puras —ni red, ni reloj, ni entorno—; los envía access-notifier.ts.
 *
 * Mismo HTML sencillo con estilos en línea que los de la recuperación de
 * contraseña (los clientes de correo ignoran las hojas de estilo). Se escapa
 * todo lo que se inserta: el nombre (lo escribió la persona al registrarse), los
 * nombres de las apps y los enlaces dentro del href, donde una comilla rompería
 * el atributo. Sin ningún correo de contacto: el repo es público.
 */

/** Lo que lleva cada correo; el destinatario lo pone quien lo envía. */
export interface AccessEmailContent {
  asunto: string;
  cuerpo: string;
}

export interface AccessEmailInput {
  fullName: string;
  /** Base pública del portal (urlPortal()); se toleran barras al final. */
  portalUrl: string;
  /** Las apps que se listan, ya filtradas y ordenadas por knownApps. */
  apps: readonly AccessApp[];
}

const base = portalBase;

/** El botón abre /auth directamente en «Iniciar sesión» (el portal lee `?modo=login`). */
const botonEntrar = (portalUrl: string): string =>
  `<p><a href="${escapeHtml(`${base(portalUrl)}/auth?modo=login`)}" style="display: inline-block; padding: 10px 18px; background: #1abc9c; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold;">Entrar al portal</a></p>`;

/** Cada app con el enlace a su ruta. Sin sesión, el portal pide entrar y después vuelve a esa ruta. */
const listaApps = (portalUrl: string, apps: readonly AccessApp[]): string =>
  `<ul>${apps
    .map((app) => `<li><a href="${escapeHtml(`${base(portalUrl)}${app.route}`)}">${escapeHtml(app.label)}</a></li>`)
    .join('')}</ul>`;

const SIN_APPS = '<p>Todavía no tienes aplicaciones asignadas; te avisaremos cuando te den acceso a alguna.</p>';
const CIERRE = '<p>Si olvidas tu contraseña, usa “¿Olvidaste tu contraseña?” en la pantalla de acceso.</p>';

/**
 * Bienvenida y reactivación comparten esquema: saludo, botón, las apps que la
 * cuenta tiene en ese momento (o el aviso de que aún no tiene) y el cierre.
 */
function cuentaActiva(saludo: string, { portalUrl, apps }: AccessEmailInput): string {
  const susApps = apps.length > 0 ? `<p>Tus aplicaciones:</p>${listaApps(portalUrl, apps)}` : SIN_APPS;
  return envolver(portalUrl, `<p>${saludo}</p>${botonEntrar(portalUrl)}${susApps}${CIERRE}`);
}

/** Al aprobar una cuenta pending. */
export function buildWelcomeEmail(input: AccessEmailInput): AccessEmailContent {
  return {
    asunto: 'Bienvenido al Portal Ambientalia',
    cuerpo: cuentaActiva(`Hola, ${escapeHtml(input.fullName)}: tu cuenta del Portal Ambientalia ya está activa.`, input),
  };
}

/** Al reactivar una cuenta inactive. */
export function buildReactivatedEmail(input: AccessEmailInput): AccessEmailContent {
  return {
    asunto: 'Tu acceso al Portal Ambientalia está activo de nuevo',
    cuerpo: cuentaActiva(`Hola, ${escapeHtml(input.fullName)}: tu acceso al Portal Ambientalia está activo de nuevo.`, input),
  };
}

/**
 * Al asignar apps nuevas a una cuenta activa: lista solo las nuevas. El asunto
 * va en texto plano (no es HTML) y los nombres salen del catálogo.
 */
export function buildNewAppsEmail({ fullName, portalUrl, apps }: AccessEmailInput): AccessEmailContent {
  const nombre = escapeHtml(fullName);
  const una = apps.length === 1 ? apps[0] : undefined;
  const saludo = una
    ? `Hola, ${nombre}: ya tienes acceso a ${escapeHtml(una.label)} en el Portal Ambientalia.`
    : `Hola, ${nombre}: tienes acceso a nuevas aplicaciones del Portal Ambientalia.`;
  return {
    asunto: una
      ? `Ya tienes acceso a ${una.label} en el Portal Ambientalia`
      : 'Tienes acceso a nuevas aplicaciones del Portal Ambientalia',
    cuerpo: envolver(portalUrl, `<p>${saludo}</p>${listaApps(portalUrl, apps)}${botonEntrar(portalUrl)}`),
  };
}
