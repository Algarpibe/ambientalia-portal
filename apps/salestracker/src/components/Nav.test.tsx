// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import Nav from './Nav';

afterEach(cleanup);

// Reproduce el montaje real: el portal monta la sub-app bajo un splat
// (<Route path="/salestracker/*">) y la sub-app usa <Routes> descendiente. En ese
// contexto los NavLink RELATIVOS se apilan contra la ruta actual, así que estando
// en /salestracker/articulos, "Clientes" resolvía a /salestracker/articulos/clientes
// (pantalla en blanco). Este test fija que los enlaces del Nav son absolutos y
// estables independientemente de la página en la que estés.
function mountAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/salestracker/*"
          element={
            <Routes>
              <Route element={<><Nav /><Outlet /></>}>
                <Route index element={<div>home</div>} />
                <Route path="articulos" element={<div>articulos</div>} />
                <Route path="clientes" element={<div>clientes</div>} />
              </Route>
            </Routes>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href');

describe('Nav (enlaces absolutos, estables bajo el splat del portal)', () => {
  it('desde /salestracker/articulos los enlaces NO se apilan', () => {
    mountAt('/salestracker/articulos');
    expect(href('Inicio')).toBe('/salestracker');
    expect(href('Artículos')).toBe('/salestracker/articulos');
    expect(href('Clientes')).toBe('/salestracker/clientes');
  });

  it('desde /salestracker/clientes tampoco se apilan', () => {
    mountAt('/salestracker/clientes');
    expect(href('Inicio')).toBe('/salestracker');
    expect(href('Artículos')).toBe('/salestracker/articulos');
    expect(href('Clientes')).toBe('/salestracker/clientes');
  });

  it('desde la raíz /salestracker', () => {
    mountAt('/salestracker');
    expect(href('Artículos')).toBe('/salestracker/articulos');
    expect(href('Clientes')).toBe('/salestracker/clientes');
  });
});
