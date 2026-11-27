import { useCallback, useEffect, useState, type ReactNode } from 'react';
import logo from '../../assets/ambientalia-logo.png';
import { notify } from '../../lib/notify';
import { cargarVista, guardarConfirmacion, mensajeDeError } from './api';
import { lanzarConfeti } from './confeti';
import Confirmacion from './Confirmacion';
import CuentaAtras from './CuentaAtras';
import { BOTON } from './estilos';
import { diaYMes } from './fechas';
import { ESPECTRO, FUENTE_TEXTO, FUENTE_TITULOS, TITULO_DEGRADADO } from './marca';
import Portada from './Portada';
import TarjetasEvento from './TarjetasEvento';
import type { DatosConfirmacion, Vista } from './tipos';
import { Etiqueta, Tarjeta, Titulo } from './ui';

const TITULO_PESTANA = 'Almuerzo de fin de año · Portal Ambientalia';

const MANCHAS = [
  { color: '#D81B60', clase: '-left-16 -top-20 h-80 w-80' },
  { color: '#FDB913', clase: '-right-24 top-1/3 h-96 w-96' },
  { color: '#008556', clase: 'bottom-[5%] left-[10%] h-80 w-80' },
  { color: '#006699', clase: '-bottom-16 right-[15%] h-72 w-72' },
];

function Fondo() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
      {MANCHAS.map((m) => (
        <div key={m.color} className={`absolute rounded-full opacity-[0.12] blur-[45px] ${m.clase}`} style={{ background: m.color }} />
      ))}
    </div>
  );
}

function Centro({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#FAFAFC] p-6 text-center">{children}</div>;
}

/** `/celebracion-navidad-2026`: la invitación al almuerzo de fin de año. Fuera del shell; con sesión. */
export default function CelebracionNavidad() {
  const [vista, setVista] = useState<Vista | null>(null);
  const [fallo, setFallo] = useState(false);
  const [abierta, setAbierta] = useState(false);

  const recargar = useCallback(async () => {
    try {
      setVista(await cargarVista());
      setFallo(false);
    } catch {
      setFallo(true);
    }
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  useEffect(() => {
    const anterior = document.title;
    document.title = TITULO_PESTANA;
    return () => {
      document.title = anterior;
    };
  }, []);

  if (!vista) {
    return (
      <Centro>
        {fallo ? (
          <>
            <p className="font-semibold text-[#3E4352]">No se pudo cargar la invitación.</p>
            <button type="button" className={BOTON} onClick={() => void recargar()}>
              Reintentar
            </button>
          </>
        ) : (
          <p role="status" className="text-[#5C6170]">
            Cargando invitación…
          </p>
        )}
      </Centro>
    );
  }

  const abrir = () => {
    setAbierta(true);
    lanzarConfeti();
  };

  const confirmar = async (datos: DatosConfirmacion) => {
    try {
      await guardarConfirmacion(datos);
    } catch (e) {
      notify(mensajeDeError(e), 'error');
      throw e;
    }
    if (datos.asiste) {
      notify('🎟️ ¡Asistencia confirmada!');
      lanzarConfeti();
    } else {
      notify('Gracias por avisarnos. ¡Te echaremos de menos!');
    }
    await recargar();
  };

  const { evento } = vista;

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#FAFAFC] text-[#2B2D35]" style={{ fontFamily: FUENTE_TEXTO }}>
      <Fondo />
      {!abierta && <Portada onAbrir={abrir} />}

      <main
        aria-hidden={!abierta}
        className={`relative z-10 mx-auto max-w-5xl px-4 pb-20 pt-5 transition-all duration-700 sm:px-5 ${
          abierta ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'
        }`}
      >
        <header className="mb-6 flex items-center justify-between gap-4 rounded-[22px] border border-[#E6E8EF] bg-white/90 px-4 py-3 shadow-sm backdrop-blur sm:px-6">
          <img src={logo} alt="Ambientalia" className="h-10 w-auto sm:h-12" />
          <button
            type="button"
            onClick={() => lanzarConfeti()}
            className="rounded-full border-[1.5px] border-[#FDB913] bg-[#FFF6E5] px-4 py-2 text-sm font-bold text-[#C95B00] transition hover:bg-[#FDB913] hover:text-[#1F2229]"
          >
            🎊 ¡Celebrar!
          </button>
        </header>

        <section className="relative mb-6 overflow-hidden rounded-[30px] border border-[#E6E8EF] bg-white/90 px-4 pb-12 pt-10 text-center shadow-sm sm:px-8">
          <span className="inline-flex rounded-full bg-[#F47920]/10 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-[#D85B00]">
            🥂 Almuerzo corporativo de fin de año
          </span>
          <h1
            className="my-4 bg-clip-text text-4xl font-black leading-tight text-transparent sm:text-5xl"
            style={{ fontFamily: FUENTE_TITULOS, backgroundImage: TITULO_DEGRADADO }}
          >
            Brindemos por un 2026 extraordinario
          </h1>
          <p className="mx-auto mb-8 max-w-2xl leading-relaxed text-[#4E5362]">
            Queremos compartir una tarde inolvidable entre amigos y compañeros en un espacio gastronómico único en Bogotá. ¡Tu
            presencia hace la diferencia!
          </p>
          <CuentaAtras objetivo={evento.inicio} />
          <div className="absolute inset-x-0 bottom-0 h-1.5" style={{ background: ESPECTRO }} />
        </section>

        <TarjetasEvento evento={evento} />

        <section aria-labelledby="titulo-confirmacion" className="mb-6">
          <Tarjeta>
            <Etiqueta tono="teal">🎟️ Confirmación y pase digital</Etiqueta>
            <Titulo id="titulo-confirmacion">¿Nos acompañas?</Titulo>
            {evento.confirmacionesAbiertas && (
              <p className="mb-5 text-sm text-[#5C6170]">
                Confirma antes del {diaYMes(evento.cierreConfirmaciones)}. Puedes cambiar tu respuesta hasta esa fecha.
              </p>
            )}
            <Confirmacion evento={evento} respuesta={vista.miRespuesta} onGuardar={confirmar} />
          </Tarjeta>
        </section>

        <footer className="mt-10 text-center text-sm text-gray-500">
          <strong>Ambientalia S.A.S.</strong> · {evento.titulo}
        </footer>
      </main>
    </div>
  );
}
