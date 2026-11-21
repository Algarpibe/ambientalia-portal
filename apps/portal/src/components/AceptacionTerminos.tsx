import { useId, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { authFetch } from '../lib/api';
import { notify } from '../lib/notify';
import { logout, RUTA_INICIAR_SESION } from '../auth';
import { leerTerminos, marcarTerminosAceptados } from '../lib/terminosSesion';
import { TERMS_VERSION, TEXTO_CASILLA } from '../legal/terminos';

// Pantalla de aceptación de las condiciones de uso (spec 2026-11-20-terminos, §3 y
// §5). Va DENTRO de RequireAuth para cubrir todas las rutas protegidas: el portal,
// la TV del taller y «Mis equipos».
//
// Solo aparece cuando hub-api dice que este usuario NO tiene aceptada la versión
// vigente. Mientras carga, si /users/me falla o si viene de un hub-api sin `terms`,
// se deja pasar: un fallo pasajero no debe dejar a nadie fuera, y la pantalla se
// pedirá en la siguiente carga que funcione. La prueba legal es la fila que guarda
// hub-api; esto solo impide seguir sin aceptar.

export default function AceptacionTerminos({ children }: { children: ReactNode }) {
  // useAuth y no una petición propia: la respuesta de /users/me que trae las apps
  // trae también `terms` (lib/terminosSesion), y su aviso al llegar es lo que
  // vuelve a pintar este componente.
  const { user_id } = useAuth();
  // Solo para volver a pintar tras aceptar: lo que decide es el almacén, que
  // `marcarTerminosAceptados` ya ha puesto al día.
  const [, setRecienAceptada] = useState(false);
  const terminos = leerTerminos(user_id);
  // Solo se pide la versión que este portal sabe mostrar: si hub-api va por delante
  // (otra versión publicada antes que el portal), aceptar daría 400 sin salida.
  if (!user_id || !terminos || terminos.accepted || terminos.current !== TERMS_VERSION) return <>{children}</>;
  return <PantallaTerminos userId={user_id} onAceptada={() => setRecienAceptada(true)} />;
}

function PantallaTerminos({ userId, onAceptada }: { userId: string; onAceptada: () => void }) {
  const navigate = useNavigate();
  const uid = useId();
  const [marcada, setMarcada] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const aceptar = async () => {
    setGuardando(true);
    try {
      // La versión del texto que se enseña, no la que diga hub-api: se acepta lo
      // que se leyó. El candado de hub-api (users/terms.test.ts) las mantiene iguales.
      const res = await authFetch('/api/users/me/terms', {
        method: 'POST',
        body: JSON.stringify({ version: TERMS_VERSION }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      marcarTerminosAceptados(userId);
      onAceptada();
    } catch {
      notify('No se pudo guardar tu aceptación. Inténtalo de nuevo.', 'error');
      setGuardando(false);
    }
  };

  const salir = async () => {
    await logout();
    navigate(RUTA_INICIAR_SESION);
  };

  return (
    <main className="min-h-screen bg-[#F7F8FA] flex items-center justify-center px-4 py-8">
      <section
        aria-labelledby={`${uid}-titulo`}
        className="w-full max-w-lg bg-white rounded-2xl border border-gray-100 shadow-sm p-6 md:p-8 space-y-5">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-blue-600 shrink-0" aria-hidden="true" />
          <h1 id={`${uid}-titulo`} className="text-xl font-bold text-gray-900">
            Condiciones de uso y tratamiento de datos
          </h1>
        </div>
        <p className="text-gray-700 leading-relaxed">
          Para seguir usando el portal, lee y acepta las condiciones de uso y la política de tratamiento de datos
          personales de AMBIENTALIA S.A.S. (versión {TERMS_VERSION}).
        </p>
        <a
          href="/terminos"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-sm font-semibold text-blue-700 hover:underline">
          Leer el documento completo
        </a>
        <div className="flex items-start gap-3">
          <input
            id={`${uid}-casilla`}
            type="checkbox"
            checked={marcada}
            onChange={(e) => setMarcada(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 accent-blue-600"
          />
          <label htmlFor={`${uid}-casilla`} className="text-sm text-gray-700 leading-relaxed">
            {TEXTO_CASILLA}
          </label>
        </div>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={salir}
            className="px-4 py-2.5 rounded-lg border border-gray-200 text-gray-700 font-semibold hover:bg-gray-50">
            Salir
          </button>
          <button
            type="button"
            onClick={aceptar}
            disabled={!marcada || guardando}
            className="px-4 py-2.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
            Aceptar y continuar
          </button>
        </div>
      </section>
    </main>
  );
}
