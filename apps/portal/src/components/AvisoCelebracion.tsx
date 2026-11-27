import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cargarMiEstado } from '../pages/celebracion/api';
import { RUTA_CELEBRACION } from '../pages/celebracion/ruta';

/** En el Inicio: «Confirma tu asistencia» mientras no hayas respondido y sigan abiertas. Si falla, no sale. */
export default function AvisoCelebracion() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let vivo = true;
    cargarMiEstado()
      .then((estado) => {
        if (vivo) setVisible(!estado.respondido && estado.confirmacionesAbiertas);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  if (!visible) return null;
  return (
    <Link
      to={RUTA_CELEBRACION}
      className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 transition hover:bg-amber-100"
    >
      <span className="font-semibold">🥂 Confirma tu asistencia al almuerzo de fin de año</span>
      <span className="shrink-0 text-sm font-bold">Abrir invitación →</span>
    </Link>
  );
}
