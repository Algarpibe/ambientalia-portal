import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { QueryProvider } from './components/QueryProvider';
import Nav from './components/Nav';
import Home from './pages/Home';
import Articulos from './pages/Articulos';
import Clientes from './pages/Clientes';

// Layout con la navegación. Al renderizar el <Nav/> DENTRO de una route (vía
// <Outlet/>), los NavLink relativos ('.', 'articulos', 'clientes') se resuelven
// desde la raíz de la sub-app (montada en /salestracker/*), no desde la ruta
// actual. Antes el <Nav/> vivía fuera de <Routes>, así que "Clientes" desde
// /salestracker/articulos apilaba a /salestracker/articulos/clientes (pantalla en
// blanco). Sin hardcodear el slug.
function Layout() {
  return (
    <>
      <Nav />
      <Outlet />
    </>
  );
}

export default function App() {
  return (
    <QueryProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="articulos" element={<Articulos />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="*" element={<Navigate to="." replace />} />
        </Route>
      </Routes>
    </QueryProvider>
  );
}
