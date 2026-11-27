import logo from '../../assets/ambientalia-logo.png';
import { ESPECTRO, FUENTE_TITULOS } from './marca';

/** El «sobre» que tapa la página hasta que se pulsa «Abrir invitación». */
export default function Portada({ onAbrir }: { onAbrir: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-gradient-to-br from-white via-[#f4f6fb] to-[#eef2f7] p-6">
      <div className="relative w-full max-w-md overflow-hidden rounded-[28px] bg-white px-7 py-10 text-center shadow-[0_25px_60px_-15px_rgba(63,61,153,0.16)] ring-1 ring-black/5">
        <div className="absolute inset-x-0 top-0 h-[7px]" style={{ background: ESPECTRO }} />
        <span className="inline-flex items-center gap-2 rounded-full bg-[#F47920]/10 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-[#D85B00]">
          ✨ Celebración de fin de año 2026
        </span>
        <img src={logo} alt="Ambientalia" className="mx-auto mt-6 h-16 w-auto" />
        <h1 className="mt-6 text-3xl font-black leading-tight text-[#22252E]" style={{ fontFamily: FUENTE_TITULOS }}>
          ¡Tenemos una cita especial para celebrar juntos!
        </h1>
        <p className="mt-3 leading-relaxed text-[#5C6170]">
          Un encuentro pensado para agradecer cada logro compartido durante este 2026 y brindar por un nuevo año lleno de éxitos
          en equipo.
        </p>
        <button
          type="button"
          onClick={onAbrir}
          className="mt-7 inline-flex items-center gap-2 rounded-full px-8 py-4 font-extrabold text-white shadow-lg transition hover:-translate-y-0.5"
          style={{ background: ESPECTRO }}
        >
          Abrir invitación 🎉
        </button>
      </div>
    </div>
  );
}
