import { describe, it, expect } from 'vitest';
import {
  buildNewAppsEmail,
  buildReactivatedEmail,
  buildWelcomeEmail,
  type AccessEmailContent,
  type AccessEmailInput,
} from './access-emails.js';

// Asunto y cuerpo de los tres correos de acceso (spec 2026-11-20, §4.3).
// Puras: ni red, ni reloj, ni entorno.

const PORTAL = 'https://portal.ejemplo.test';
const ENTRAR = `href="${PORTAL}/auth?modo=login"`;
const CONTABILIDAD = { label: 'Contabilidad', route: '/contabilidad' };
const AUSENCIAS = { label: 'Vacaciones y Permisos', route: '/ausencias' };
const SIN_APPS = 'Todavía no tienes aplicaciones asignadas; te avisaremos cuando te den acceso a alguna.';
const CIERRE = 'Si olvidas tu contraseña, usa “¿Olvidaste tu contraseña?” en la pantalla de acceso.';
const CORREO_EN_TEXTO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

const datos = (parcial: Partial<AccessEmailInput> = {}): AccessEmailInput => ({
  fullName: 'Ana Ruiz',
  portalUrl: PORTAL,
  apps: [CONTABILIDAD, AUSENCIAS],
  ...parcial,
});

// El logo va primero en los tres correos, desde una ruta fija del portal.
const LOGO_SRC = `${PORTAL}/email/logo-ambientalia.png`;
const LOS_TRES: [string, (input: AccessEmailInput) => AccessEmailContent][] = [
  ['buildWelcomeEmail', buildWelcomeEmail],
  ['buildReactivatedEmail', buildReactivatedEmail],
  ['buildNewAppsEmail', buildNewAppsEmail],
];

describe.each(LOS_TRES)('logo en %s', (_nombre, build) => {
  it('un solo logo, con src fijo y alt, antes del saludo', () => {
    const { cuerpo } = build(datos());
    expect(cuerpo.match(/<img/g)).toHaveLength(1);
    expect(cuerpo).toContain(`src="${LOGO_SRC}"`);
    expect(cuerpo).toContain('alt="Ambientalia"');
    expect(cuerpo.indexOf('<img')).toBeLessThan(cuerpo.indexOf('Hola, '));
  });

  it('una base con barra final no duplica la barra', () => {
    expect(build(datos({ portalUrl: `${PORTAL}//` })).cuerpo).toContain(`src="${LOGO_SRC}"`);
  });

  it('una comilla o & en la base se escapan dentro del src', () => {
    const { cuerpo } = build(datos({ portalUrl: 'https://x.test/?a=1&b="2' }));
    expect(cuerpo).toContain('src="https://x.test/?a=1&amp;b=&quot;2/email/logo-ambientalia.png"');
  });
});

// Bienvenida y reactivación comparten esquema; cambian el asunto y el saludo.
const CUENTA_ACTIVA: [string, (input: AccessEmailInput) => AccessEmailContent, string, string][] = [
  ['buildWelcomeEmail', buildWelcomeEmail, 'Bienvenido al Portal Ambientalia', 'Hola, Ana Ruiz: tu cuenta del Portal Ambientalia ya está activa.'],
  [
    'buildReactivatedEmail',
    buildReactivatedEmail,
    'Tu acceso al Portal Ambientalia está activo de nuevo',
    'Hola, Ana Ruiz: tu acceso al Portal Ambientalia está activo de nuevo.',
  ],
];

describe.each(CUENTA_ACTIVA)('%s', (_nombre, build, asunto, saludo) => {
  it('asunto fijo y saludo por el nombre', () => {
    const correo = build(datos());
    expect(correo.asunto).toBe(asunto);
    expect(correo.cuerpo).toContain(`<p>${saludo}</p>`);
  });

  it('el botón «Entrar al portal» abre /auth en «Iniciar sesión»', () => {
    const { cuerpo } = build(datos());
    expect(cuerpo).toContain(ENTRAR);
    expect(cuerpo).toContain('>Entrar al portal</a>');
  });

  it('lista sus apps, cada una con el enlace a su ruta en el portal', () => {
    const { cuerpo } = build(datos());
    expect(cuerpo).toContain('<p>Tus aplicaciones:</p>');
    expect(cuerpo).toContain(`<a href="${PORTAL}/contabilidad">Contabilidad</a>`);
    expect(cuerpo).toContain(`<a href="${PORTAL}/ausencias">Vacaciones y Permisos</a>`);
    expect(cuerpo).not.toContain(SIN_APPS);
  });

  it('sin apps, dice que se le avisará cuando tenga alguna', () => {
    const { cuerpo } = build(datos({ apps: [] }));
    expect(cuerpo).toContain(SIN_APPS);
    expect(cuerpo).not.toContain('<ul>');
  });

  it('cierra recordando «¿Olvidaste tu contraseña?», tenga apps o no', () => {
    expect(build(datos()).cuerpo).toContain(CIERRE);
    expect(build(datos({ apps: [] })).cuerpo).toContain(CIERRE);
  });

  it('no duplica la barra si la base acaba en /', () => {
    const { cuerpo } = build(datos({ portalUrl: `${PORTAL}//` }));
    expect(cuerpo).toContain(ENTRAR);
    expect(cuerpo).toContain(`href="${PORTAL}/contabilidad"`);
    expect(cuerpo).not.toContain('.test//');
  });

  it('escapa el nombre: lo escribió la persona al registrarse', () => {
    const { cuerpo } = build(datos({ fullName: '<script>alert(1)</script>' }));
    expect(cuerpo).not.toContain('<script>');
    expect(cuerpo).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('no trae ningún correo de contacto (el repo es público)', () => {
    expect(build(datos()).cuerpo).not.toMatch(CORREO_EN_TEXTO);
  });
});

describe('buildNewAppsEmail', () => {
  it('con una app, el asunto y el saludo la nombran', () => {
    const correo = buildNewAppsEmail(datos({ apps: [CONTABILIDAD] }));
    expect(correo.asunto).toBe('Ya tienes acceso a Contabilidad en el Portal Ambientalia');
    expect(correo.cuerpo).toContain('<p>Hola, Ana Ruiz: ya tienes acceso a Contabilidad en el Portal Ambientalia.</p>');
  });

  it('con varias, el asunto va en plural', () => {
    const correo = buildNewAppsEmail(datos());
    expect(correo.asunto).toBe('Tienes acceso a nuevas aplicaciones del Portal Ambientalia');
    expect(correo.cuerpo).toContain('<p>Hola, Ana Ruiz: tienes acceso a nuevas aplicaciones del Portal Ambientalia.</p>');
  });

  it('lista las que recibe, con su enlace, y lleva el botón «Entrar al portal»', () => {
    const { cuerpo } = buildNewAppsEmail(datos());
    expect(cuerpo).toContain(`<a href="${PORTAL}/contabilidad">Contabilidad</a>`);
    expect(cuerpo).toContain(`<a href="${PORTAL}/ausencias">Vacaciones y Permisos</a>`);
    expect(cuerpo).toContain(ENTRAR);
    expect(cuerpo).toContain('>Entrar al portal</a>');
  });

  it('escapa el nombre de la app y su enlace dentro del href: una comilla no puede romper el atributo', () => {
    const { cuerpo } = buildNewAppsEmail(datos({ apps: [{ label: 'Informe <b>', route: '/x?a=1&b="y' }] }));
    expect(cuerpo).toContain('Informe &lt;b&gt;');
    expect(cuerpo).not.toContain('Informe <b>');
    expect(cuerpo).toContain(`href="${PORTAL}/x?a=1&amp;b=&quot;y"`);
    expect(cuerpo).not.toContain('"y');
  });

  it('escapa el nombre de la persona', () => {
    const { cuerpo } = buildNewAppsEmail(datos({ fullName: 'Ana <b>Ruiz</b>' }));
    expect(cuerpo).toContain('Ana &lt;b&gt;Ruiz&lt;/b&gt;');
  });

  it('no trae ningún correo de contacto (el repo es público)', () => {
    expect(buildNewAppsEmail(datos()).cuerpo).not.toMatch(CORREO_EN_TEXTO);
  });
});
