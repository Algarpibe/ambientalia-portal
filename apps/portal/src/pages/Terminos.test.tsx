// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Terminos from './Terminos';
import { CORREO_CONTACTO, LINEA_VERSION, SECCIONES, TITULO_TERMINOS } from '../legal/terminos';

// /terminos: página pública con el texto de legal/terminos.ts. No lee la sesión
// ni pide nada al servidor, así que se pinta sin router y sin token.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/terminos', () => {
  it('pinta el título, la versión y la fecha de vigencia', () => {
    render(<Terminos />);
    expect(screen.getByRole('heading', { level: 1, name: TITULO_TERMINOS })).toBeTruthy();
    expect(screen.getByText(LINEA_VERSION)).toBeTruthy();
  });

  it('pinta las dos secciones y todos sus apartados con título', () => {
    render(<Terminos />);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
    for (const seccion of SECCIONES) {
      expect(screen.getByRole('heading', { level: 2, name: seccion.titulo })).toBeTruthy();
      for (const apartado of seccion.apartados) {
        if (apartado.titulo) expect(screen.getByRole('heading', { level: 3, name: apartado.titulo })).toBeTruthy();
      }
    }
  });

  it('los arranques de la sección 1 van en negrita delante de su párrafo', () => {
    render(<Terminos />);
    const arranque = screen.getByText('1.1 Quién puede usarlo.');
    expect(arranque.tagName).toBe('STRONG');
    expect(arranque.parentElement?.textContent).toMatch(/^1\.1 Quién puede usarlo\. El portal es para empleados/);
  });

  it('pinta las tablas con sus cabeceras y sus celdas', () => {
    render(<Terminos />);
    expect(screen.getByRole('cell', { name: '900.700.933-5' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Calle 86 # 24-27, Bogotá D.C., Colombia' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Plazo de respuesta' })).toBeTruthy();
  });

  it('en el celular una tabla ancha se desplaza dentro de su caja, no la página entera', () => {
    render(<Terminos />);
    const tablas = document.querySelectorAll('table');
    expect(tablas).toHaveLength(5);
    for (const t of tablas) expect(t.parentElement?.className).toContain('overflow-x-auto');
  });

  it('el ancho mínimo solo lo llevan las tablas de más de dos columnas', () => {
    render(<Terminos />);
    const tablas = Array.from(document.querySelectorAll('table'));
    const anchas = tablas.filter((t) => t.querySelectorAll('thead th').length > 2);
    const estrechas = tablas.filter((t) => t.querySelectorAll('thead th').length <= 2);
    expect(anchas).toHaveLength(2);
    expect(estrechas).toHaveLength(3);
    for (const t of anchas) expect(t.className).toContain('min-w-[28rem]');
    for (const t of estrechas) expect(t.className).not.toContain('min-w-');
  });

  it('la caja que desplaza cada tabla se puede enfocar con teclado y tiene nombre', () => {
    render(<Terminos />);
    const caja = screen.getByRole('region', { name: '2.5 Terceros que procesan datos' });
    expect(caja.getAttribute('tabindex')).toBe('0');
    expect(caja.className).toContain('overflow-x-auto');
    expect(caja.querySelector('table')).not.toBeNull();
    expect(screen.getAllByRole('region')).toHaveLength(5);
  });

  it('la primera celda de cada fila es la cabecera de la fila', () => {
    render(<Terminos />);
    const nit = screen.getByRole('rowheader', { name: 'NIT' });
    expect(nit.tagName).toBe('TH');
    expect(nit.getAttribute('scope')).toBe('row');
    expect(screen.getAllByRole('rowheader')).toHaveLength(4 + 4 + 3 + 2 + 4);
  });

  it('el título de la pestaña es el de las condiciones y se restaura al salir', () => {
    document.title = 'Portal Ambientalia';
    const { unmount } = render(<Terminos />);
    expect(document.title).toBe('Condiciones de uso y tratamiento de datos · Portal Ambientalia');
    unmount();
    expect(document.title).toBe('Portal Ambientalia');
  });

  it('tiene un enlace para volver al portal', () => {
    render(<Terminos />);
    const volver = screen.getByRole('link', { name: 'Volver al portal' });
    expect(volver.getAttribute('href')).toBe('/');
  });

  it('el correo de contacto se pinta como enlace mailto sin cambiar el texto', () => {
    render(<Terminos />);
    const enlaces = document.querySelectorAll(`a[href="mailto:${CORREO_CONTACTO}"]`);
    expect(enlaces).toHaveLength(2); // la celda del §2.1 y el párrafo del §2.7
    for (const a of enlaces) expect(a.textContent).toBe(CORREO_CONTACTO);
    const parrafo = enlaces[1].parentElement;
    expect(parrafo?.textContent).toMatch(/^Las solicitudes se envían a .+ con el asunto “Datos personales”/);
  });

  it('no necesita sesión: se pinta sin token y sin pedir nada al servidor', () => {
    localStorage.removeItem('ambientalia_token');
    const red = vi.fn();
    vi.stubGlobal('fetch', red);
    render(<Terminos />);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(red).not.toHaveBeenCalled();
  });
});

describe('App.tsx: /terminos es pública', () => {
  it('va FUERA de RequireAuth y antes de /*', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const ruta = src.indexOf('<Route path="/terminos" element={<Terminos />} />');
    expect(ruta).toBeGreaterThan(-1);
    expect(ruta).toBeLessThan(src.indexOf('<RequireAuth>'));
    expect(ruta).toBeLessThan(src.indexOf('path="/*"'));
  });
});
