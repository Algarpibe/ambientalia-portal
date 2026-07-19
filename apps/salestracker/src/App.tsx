import { Routes, Route, Navigate } from 'react-router-dom';
import { QueryProvider } from './components/QueryProvider';
import Nav from './components/Nav';
import Home from './pages/Home';
import Articulos from './pages/Articulos';

export default function App() {
  return (
    <QueryProvider>
      <Nav />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="articulos" element={<Articulos />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
    </QueryProvider>
  );
}
