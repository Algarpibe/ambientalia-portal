// @vitest-environment jsdom
// Entrada de «Equipos en taller»: en el celular, sin ?vista=, abre «Mis equipos» con el router del portal. Todo ficticio.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate, useNavigationType } from 'react-router-dom';
import EntradaEquiposTaller from './EntradaEquiposTaller';

// jsdom no trae matchMedia: cada prueba fija el ancho de la pantalla.
const pantalla = (celular: boolean) => {
  const consulta = vi.fn((q: string) => ({ matches: celular, media: q }));
  vi.stubGlobal('matchMedia', consulta);
  return consulta;
};
// Dice cómo se llegó (REPLACE si sustituyó la entrada, PUSH si añadió otra) y permite volver atrás.
function SondaMisEquipos() {
  const navegar = useNavigate();
  return <button type="button" onClick={() => navegar(-1)}>{`MIS EQUIPOS (${useNavigationType()})`}</button>;
}
// Antes de la app, el usuario estaba en el inicio: «Atrás» debe devolverle ahí.
const arbol = (entrada: string) => (
  <MemoryRouter initialEntries={['/', entrada]} initialIndex={1}>
    <Routes>
      <Route path="/equipos-taller/mis-equipos" element={<SondaMisEquipos />} />
      <Route path="/equipos-taller/*" element={<EntradaEquiposTaller><div>LA APP</div></EntradaEquiposTaller>} />
      <Route path="/" element={<div>INICIO</div>} />
    </Routes>
  </MemoryRouter>
);
const montar = (entrada: string) => render(arbol(entrada));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('EntradaEquiposTaller', () => {
  it.each(['/equipos-taller', '/equipos-taller/'])('en el celular, %s sin ?vista= abre «Mis equipos» sustituyendo la entrada', async (entrada) => {
    const consulta = pantalla(true);
    montar(entrada);
    expect(await screen.findByText('MIS EQUIPOS (REPLACE)')).toBeTruthy();
    expect(consulta).toHaveBeenCalledWith('(max-width: 767px)');
    expect(screen.queryByText('LA APP')).toBeNull();
  });

  it('«Atrás» desde «Mis equipos» vuelve a donde estaba, sin rebotar a la app', async () => {
    pantalla(true);
    montar('/equipos-taller');
    fireEvent.click(await screen.findByText('MIS EQUIPOS (REPLACE)'));
    expect(await screen.findByText('INICIO')).toBeTruthy();
  });

  it.each(['?vista=tabla', '?vista=tablero', '?vista=otra', '?vista='])('con %s manda la dirección también en el celular', async (busqueda) => {
    pantalla(true);
    montar('/equipos-taller' + busqueda);
    expect(await screen.findByText('LA APP')).toBeTruthy();
    expect(screen.queryByText(/MIS EQUIPOS/)).toBeNull();
  });

  it('en pantalla ancha se queda en la app', async () => {
    pantalla(false);
    montar('/equipos-taller');
    expect(await screen.findByText('LA APP')).toBeTruthy();
    expect(screen.queryByText(/MIS EQUIPOS/)).toBeNull();
  });

  it('sin matchMedia (navegadores viejos) se queda en la app', async () => {
    expect(typeof window.matchMedia).toBe('undefined');
    montar('/equipos-taller');
    expect(await screen.findByText('LA APP')).toBeTruthy();
  });

  it('una subruta de la app no salta', async () => {
    pantalla(true);
    montar('/equipos-taller/otra');
    expect(await screen.findByText('LA APP')).toBeTruthy();
  });

  it('mira el ancho una sola vez, al abrir: girar el teléfono después no mueve a nadie', async () => {
    const consulta = pantalla(false);
    const { rerender } = montar('/equipos-taller');
    await screen.findByText('LA APP');
    pantalla(true);
    fireEvent(window, new Event('resize'));
    rerender(arbol('/equipos-taller'));
    expect(screen.getByText('LA APP')).toBeTruthy();
    expect(consulta).toHaveBeenCalledTimes(1);
  });
});
