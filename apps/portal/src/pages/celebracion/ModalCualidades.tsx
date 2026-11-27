import { useEffect, useId, useRef, useState } from 'react';
import { BOTON } from './estilos';
import { ESPECTRO, FUENTE_TITULOS } from './marca';
import { primerNombre } from './persona';

interface Props {
  nombre: string;
  cualidades: string[];
  max: number;
  seleccionInicial: string[];
  /** Guarda; si falla, el padre avisa y relanza, y el modal sigue abierto. */
  onGuardar: (seleccion: string[]) => Promise<void>;
  onCerrar: () => void;
}

/** «Enviar brindis»: elegir hasta `max` cualidades para un compañero. */
export default function ModalCualidades({ nombre, cualidades, max, seleccionInicial, onGuardar, onCerrar }: Props) {
  const tituloId = useId();
  const dialogoRef = useRef<HTMLDivElement>(null);
  const [seleccion, setSeleccion] = useState<string[]>(seleccionInicial);
  const [guardando, setGuardando] = useState(false);
  const lleno = seleccion.length >= max;

  useEffect(() => {
    dialogoRef.current?.focus();
  }, []);

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [onCerrar]);

  const alternar = (cualidad: string) =>
    setSeleccion((actual) => {
      if (actual.includes(cualidad)) return actual.filter((c) => c !== cualidad);
      return actual.length >= max ? actual : [...actual, cualidad];
    });

  const guardar = async () => {
    setGuardando(true);
    try {
      await onGuardar(seleccion);
    } catch {
      // El padre ya avisó; el modal sigue abierto para reintentar.
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onCerrar}>
      <div
        ref={dialogoRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl outline-none sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={tituloId} className="text-xl font-black text-[#1F2229]" style={{ fontFamily: FUENTE_TITULOS }}>
          🥂 Brinda por {primerNombre(nombre)}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Elige hasta {max} cualidades. Tu voto es anónimo. ({seleccion.length}/{max})
        </p>

        <div className="my-5 flex flex-wrap gap-2">
          {cualidades.map((c) => {
            const activa = seleccion.includes(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={activa}
                disabled={!activa && lleno}
                onClick={() => alternar(c)}
                className={`rounded-full border-[1.5px] px-3 py-1.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  activa ? 'border-[#008556] bg-[#008556]/10 text-[#008556]' : 'border-[#E6E8EF] bg-white text-[#3E4352] hover:border-[#CBD2E1]'
                }`}
              >
                {activa ? '✓ ' : ''}
                {c}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col-reverse gap-2.5 sm:flex-row">
          <button type="button" className={BOTON} onClick={onCerrar}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={guardando}
            onClick={() => void guardar()}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-60"
            style={{ background: ESPECTRO }}
          >
            {guardando ? 'Guardando…' : 'Guardar brindis'}
          </button>
        </div>
      </div>
    </div>
  );
}
