import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cargarCualidades } from './api';
import AvatarPersona from './AvatarPersona';
import { BOTON, BOTON_PRIMARIO } from './estilos';
import { FUENTE_TEXTO, FUENTE_TITULOS } from './marca';
import type { Miembro } from './tipos';

interface Props {
  /** Cierra la presentación; el panel sale también de la pantalla completa. */
  onCerrar: () => void;
}

// Al imprimir solo sale la presentación (decisión P1). Cuelga directamente de <body>, así que basta ocultar a
// sus hermanos: el #root con todo el portal, los avisos y cualquier otra capa. La regla vive dentro de la
// propia presentación: existe solo mientras está abierta.
const REGLA_IMPRESION = `@media print {
  body > :not([data-presentacion-cualidades]) { display: none !important; }
  [data-presentacion-cualidades] { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;

/** Las que van en grande, como el top 3 del muro. */
const EN_GRANDE = 3;

/** Una persona: en pantalla solo se ve la actual; al imprimir, todas, cada una en su hoja. */
function Hoja({ persona, actual }: { persona: Miembro; actual: boolean }) {
  const grandes = persona.cualidades.slice(0, EN_GRANDE);
  const resto = persona.cualidades.slice(EN_GRANDE);
  return (
    <section
      data-testid="hoja"
      aria-label={persona.nombre}
      aria-hidden={!actual}
      className={`${actual ? 'flex' : 'hidden print:flex'} flex-1 break-after-page flex-col items-center justify-center px-6 py-10 text-center last:break-after-auto print:py-8`}
    >
      <AvatarPersona persona={persona} className="mb-6 h-44 w-44 p-1.5 sm:h-60 sm:w-60" claseIniciales="text-6xl" />
      <h2 className="mb-8 text-4xl font-black text-[#1F2229] sm:text-6xl" style={{ fontFamily: FUENTE_TITULOS }}>
        {persona.nombre}
      </h2>
      {persona.cualidades.length === 0 ? (
        <p className="text-2xl font-bold text-[#5C6170]">Sin brindis</p>
      ) : (
        <>
          <ol aria-label="Top 3" className="mb-8 space-y-3">
            {grandes.map((c) => (
              <li key={c.cualidad} className="text-3xl font-extrabold text-[#2B2D35] sm:text-5xl" style={{ fontFamily: FUENTE_TITULOS }}>
                ✨ {c.cualidad} · {c.votos}
              </li>
            ))}
          </ol>
          {resto.length > 0 && (
            <ul aria-label="Más cualidades" className="flex max-w-3xl flex-wrap justify-center gap-2">
              {resto.map((c) => (
                <li key={c.cualidad} className="rounded-full bg-[#F4F6FA] px-3 py-1 text-base font-bold text-[#3E4352]">
                  {c.cualidad} · {c.votos}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** «🎤 Presentar cualidades» (solo admin): una persona por pantalla y, al imprimir, una por hoja. */
export default function PresentacionCualidades({ onCerrar }: Props) {
  const [equipo, setEquipo] = useState<Miembro[] | null>(null);
  const [fallo, setFallo] = useState(false);
  const [indice, setIndice] = useState(0);
  const capaRef = useRef<HTMLDivElement>(null);
  const total = equipo?.length ?? 0;
  const listo = equipo !== null && total > 0;

  // Se piden al abrirla, no con el panel: así las fotos no se descargan en cada recarga.
  const cargar = useCallback(async () => {
    try {
      setEquipo((await cargarCualidades()).equipo);
      setFallo(false);
    } catch {
      setFallo(true);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    capaRef.current?.focus();
  }, []);

  const mover = useCallback(
    (paso: number) => setIndice((i) => Math.min(Math.max(i + paso, 0), Math.max(total - 1, 0))),
    [total],
  );

  // Con la pantalla completa del sistema, la primera Esc se la queda el navegador para salir de ella (decisión P2).
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
      else if (e.key === 'ArrowRight') mover(1);
      else if (e.key === 'ArrowLeft') mover(-1);
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [mover, onCerrar]);

  const reintentar = () => {
    setFallo(false);
    void cargar();
  };

  return createPortal(
    <div
      ref={capaRef}
      data-presentacion-cualidades=""
      role="dialog"
      aria-modal="true"
      aria-label="Presentación de cualidades"
      tabIndex={-1}
      className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-white text-[#2B2D35] outline-none print:static print:block print:overflow-visible"
      style={{ fontFamily: FUENTE_TEXTO }}
    >
      <style>{REGLA_IMPRESION}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6E8EF] px-4 py-3 print:hidden">
        <span data-testid="contador" className="text-lg font-extrabold" style={{ fontFamily: FUENTE_TITULOS }}>
          {listo ? `${indice + 1} / ${total}` : ''}
        </span>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BOTON} disabled={!listo || indice === 0} onClick={() => mover(-1)}>
            ← Anterior
          </button>
          <button type="button" className={BOTON} disabled={!listo || indice >= total - 1} onClick={() => mover(1)}>
            Siguiente →
          </button>
          <button type="button" className={BOTON} disabled={!listo} onClick={() => window.print()}>
            🖨️ Imprimir
          </button>
          <button type="button" className={BOTON_PRIMARIO} onClick={onCerrar}>
            Cerrar
          </button>
        </div>
      </div>

      {equipo === null ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          {fallo ? (
            <>
              <p className="font-semibold text-[#3E4352]">No se pudieron cargar las cualidades.</p>
              <button type="button" className={`${BOTON} flex-none`} onClick={reintentar}>
                Reintentar
              </button>
            </>
          ) : (
            <p role="status" className="text-[#5C6170]">
              Cargando…
            </p>
          )}
        </div>
      ) : total === 0 ? (
        <p className="flex-1 p-6 text-center text-[#5C6170]">No hay nadie en la invitación.</p>
      ) : (
        <div className="flex flex-1 flex-col print:block">
          {equipo.map((persona, i) => (
            <Hoja key={persona.userId} persona={persona} actual={i === indice} />
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
