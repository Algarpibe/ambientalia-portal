import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { QueryProvider } from './components/QueryProvider';
import Nav from './components/Nav';
import { APP_BASE } from './appBase';
import Home from './pages/Home';
import Articulos from './pages/Articulos';
import Clientes from './pages/Clientes';

// Layout con la navegación compartida (Nav + página vía <Outlet/>).
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
          {/* Ruta absoluta: bajo el splat, un `to="."` se resolvía contra la ruta
              actual y no volvía a la raíz de la sub-app. Ver appBase.ts. */}
          <Route path="*" element={<Navigate to={APP_BASE} replace />} />
        </Route>
      </Routes>
    </QueryProvider>
  );
}
