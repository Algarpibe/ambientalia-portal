import { describe, it, expect } from 'vitest';
import { buildPasswordChangedEmail, buildResetLinkEmail, escapeHtml, resetLink } from './password-reset.emails.js';

// Asunto y cuerpo de los dos correos de la recuperación de contraseña. Puras:
// ni red, ni reloj, ni entorno.

const PORTAL = 'https://portal.ejemplo.test';
const TOKEN = 'AbC123_-xyz';
const ENLACE = `${PORTAL}/auth/restablecer#t=${TOKEN}`;
const CORREO_EN_TEXTO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

describe('resetLink', () => {
  it('lleva el token tras #t=, en /auth/restablecer', () => {
    expect(resetLink(PORTAL, TOKEN)).toBe(ENLACE);
  });

  it('no duplica la barra si la base acaba en /', () => {
    expect(resetLink(`${PORTAL}/`, TOKEN)).toBe(ENLACE);
  });
});

describe('escapeHtml', () => {
  it('escapa los cinco caracteres con significado en HTML', () => {
    expect(escapeHtml(`<b>"Ana" & 'Luis'</b>`)).toBe('&lt;b&gt;&quot;Ana&quot; &amp; &#39;Luis&#39;&lt;/b&gt;');
  });
});

describe('buildResetLinkEmail', () => {
  const correo = buildResetLinkEmail({ fullName: 'Ana Ruiz', portalUrl: PORTAL, token: TOKEN });

  it('asunto fijo', () => {
    expect(correo.asunto).toBe('Restablecer tu contraseña del Portal Ambientalia');
  });

  it('el enlace va como botón y también en texto, con el token tras #t=', () => {
    expect(correo.cuerpo.split(`href="${ENLACE}"`).length - 1).toBe(2);
    expect(correo.cuerpo).toContain(`>${ENLACE}</a>`);
  });

  it('saluda por el nombre y explica la caducidad, el solo uso y qué hacer si no lo pidió', () => {
    expect(correo.cuerpo).toContain('Hola, Ana Ruiz:');
    expect(correo.cuerpo).toContain('30 minutos');
    expect(correo.cuerpo).toContain('una sola vez');
    expect(correo.cuerpo).toContain('tu contraseña no cambia');
  });

  it('escapa el nombre: lo escribió la persona al registrarse', () => {
    const c = buildResetLinkEmail({ fullName: '<script>alert(1)</script>', portalUrl: PORTAL, token: TOKEN });
    expect(c.cuerpo).not.toContain('<script>');
    expect(c.cuerpo).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('buildPasswordChangedEmail', () => {
  // 03:30 UTC del 14 son las 22:30 del 13 en Bogotá (UTC-5): manda la hora de Colombia.
  const correo = buildPasswordChangedEmail({ fullName: 'Ana Ruiz', changedAt: new Date('2026-11-14T03:30:00Z') });

  it('asunto fijo', () => {
    expect(correo.asunto).toBe('Tu contraseña del Portal Ambientalia se ha cambiado');
  });

  it('saluda por el nombre y da fecha y hora de Colombia', () => {
    expect(correo.cuerpo).toContain('Hola, Ana Ruiz:');
    expect(correo.cuerpo).toContain('13 de noviembre de 2026');
    expect(correo.cuerpo).toContain('22:30');
    expect(correo.cuerpo).not.toContain('14 de noviembre');
  });

  it('pide avisar al administrador y no trae ningún correo de contacto (el repo es público)', () => {
    expect(correo.cuerpo).toContain('avisa al administrador');
    expect(correo.cuerpo).not.toMatch(CORREO_EN_TEXTO);
  });

  it('escapa el nombre', () => {
    const c = buildPasswordChangedEmail({ fullName: 'Ana <b>Ruiz</b>', changedAt: new Date('2026-11-14T03:30:00Z') });
    expect(c.cuerpo).toContain('Ana &lt;b&gt;Ruiz&lt;/b&gt;');
  });
});
