import { useState, type ChangeEvent } from 'react';
import { notify } from '../../lib/notify';
import { BOTON, BOTON_PRIMARIO } from './estilos';
import { FUENTE_TITULOS } from './marca';

interface Props {
  tieneFoto: boolean;
  brindis: { dados: number; minimo: number };
  /** Las confirmaciones están abiertas: si no, no hay nada que pedir. */
  abiertas: boolean;
  onSubirFoto: (archivo: File) => Promise<void>;
  onIrAConfirmar: () => void;
}

/** Los dos pasos que hay que cumplir en «Nuestro equipo» antes de poder responder. */
export default function PasosEquipo({ tieneFoto, brindis, abiertas, onSubirFoto, onIrAConfirmar }: Props) {
  const [subiendo, setSubiendo] = useState(false);
  if (!abiertas) return null;

  const brindisHechos = brindis.dados >= brindis.minimo;
  const completo = tieneFoto && brindisHechos;
  const porcentaje = brindis.minimo > 0 ? Math.min(100, (brindis.dados / brindis.minimo) * 100) : 100;

  const elegirFoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo
    if (!archivo) return;
    if (!archivo.type.startsWith('image/')) {
      notify('El archivo debe ser una imagen.', 'error');
      return;
    }
    setSubiendo(true);
    try {
      await onSubirFoto(archivo);
    } finally {
      setSubiendo(false);
    }
  };

  if (completo) {
    return (
      <div className="mx-auto mb-6 flex max-w-2xl flex-col items-center gap-3 rounded-2xl border border-[#008556]/30 bg-[#008556]/5 p-4 text-center sm:flex-row sm:justify-between sm:text-left">
        <p className="font-extrabold text-[#006B45]" style={{ fontFamily: FUENTE_TITULOS }}>
          🎉 ¡Listo! Ya puedes confirmar tu asistencia
        </p>
        <button type="button" className={`${BOTON_PRIMARIO} w-full flex-none sm:w-auto`} onClick={onIrAConfirmar}>
          Ir a confirmar ↓
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto mb-6 max-w-2xl rounded-2xl border border-[#006699]/20 bg-[#006699]/5 p-4 sm:p-5">
      <p className="mb-3 font-extrabold text-[#1F2229]" style={{ fontFamily: FUENTE_TITULOS }}>
        Antes de confirmar tu asistencia, completa estos 2 pasos:
      </p>
      <ol className="space-y-4">
        <li data-testid="paso-foto" className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-semibold text-[#2B2D35]">① 📸 Sube tu foto más graciosa</span>
          {tieneFoto ? (
            <span className="font-bold text-[#008556]">✅ Hecha</span>
          ) : (
            <label className={`${BOTON} flex-none cursor-pointer focus-within:ring-2 focus-within:ring-[#006699]/30`}>
              {subiendo ? 'Subiendo…' : 'Subir foto'}
              <input
                type="file"
                accept="image/*"
                aria-label="Subir mi foto graciosa"
                className="sr-only"
                disabled={subiendo}
                onChange={(e) => void elegirFoto(e)}
              />
            </label>
          )}
        </li>
        <li data-testid="paso-brindis">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="font-semibold text-[#2B2D35]">② 🥂 Brinda por cada compañero</span>
            <span className="font-bold text-[#3E4352]">
              {brindisHechos && <span aria-hidden="true">✅ </span>}
              <span>
                {brindis.dados} de {brindis.minimo}
              </span>
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Brindis enviados"
            aria-valuenow={brindis.dados}
            aria-valuemin={0}
            aria-valuemax={brindis.minimo}
            className="h-2.5 overflow-hidden rounded-full bg-[#E6E8EF]"
          >
            <div className="h-full rounded-full bg-[#008556] transition-all" style={{ width: `${porcentaje}%` }} />
          </div>
          <p className="mt-1.5 text-sm text-[#5C6170]">Toca «Enviar brindis» en cada tarjeta.</p>
        </li>
      </ol>
    </div>
  );
}
