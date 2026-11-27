import { useState, type ChangeEvent } from 'react';
import { notify } from '../../lib/notify';
import AvatarPersona from './AvatarPersona';
import { BOTON } from './estilos';
import { FUENTE_TITULOS } from './marca';
import { primerNombre } from './persona';
import type { Miembro } from './tipos';

interface Props {
  equipo: Miembro[];
  yo: string;
  misVotos: Record<string, string[]>;
  votosAbiertos: boolean;
  /** Quien no es admin no recibe las cualidades: la tarjeta dice que se desvelan el día del almuerzo. */
  cualidadesOcultas: boolean;
  onBrindis: (miembro: Miembro) => void;
  onSubirFoto: (archivo: File) => Promise<void>;
}

/** Una tarjeta por persona activa; la mía primero (decisión D7). */
export default function MuroEquipo({ equipo, yo, misVotos, votosAbiertos, cualidadesOcultas, onBrindis, onSubirFoto }: Props) {
  const [subiendo, setSubiendo] = useState(false);
  const ordenados = [...equipo.filter((m) => m.userId === yo), ...equipo.filter((m) => m.userId !== yo)];

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

  const sinVotos = (m: Miembro, esMia: boolean) => {
    if (esMia) return 'Aún nadie ha brindado por ti.';
    return votosAbiertos ? `Sé el primero en brindar por ${primerNombre(m.nombre)}.` : 'Sin brindis.';
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {ordenados.map((m) => {
        const esMia = m.userId === yo;
        const yaVote = (misVotos[m.userId]?.length ?? 0) > 0;
        return (
          <article
            key={m.userId}
            aria-label={m.nombre}
            className="flex flex-col justify-between rounded-[22px] border-[1.5px] border-[#E6E8EF] bg-white p-5 text-center transition hover:-translate-y-1 hover:shadow-lg"
          >
            <div>
              <AvatarPersona persona={m} />
              <p className="mb-2.5 font-extrabold leading-snug text-[#1F2229]" style={{ fontFamily: FUENTE_TITULOS }}>
                {m.nombre}
              </p>
              {cualidadesOcultas ? (
                <p className="mb-4 text-sm font-semibold text-[#5C6170]">🤫 Se desvelan el día del almuerzo</p>
              ) : m.cualidades.length > 0 ? (
                <ul className="mb-4 flex flex-wrap justify-center gap-1.5">
                  {m.cualidades.map((c) => (
                    <li key={c.cualidad} className="rounded-full bg-[#F4F6FA] px-2.5 py-1 text-xs font-bold text-[#3E4352]">
                      ✨ {c.cualidad} · {c.votos}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-4 text-sm text-gray-500">{sinVotos(m, esMia)}</p>
              )}
            </div>

            {esMia ? (
              <label className={`${BOTON} cursor-pointer focus-within:ring-2 focus-within:ring-[#006699]/30`}>
                {subiendo ? 'Subiendo…' : m.foto ? '📷 Cambiar mi foto graciosa' : '📷 Subir mi foto graciosa'}
                <input type="file" accept="image/*" className="sr-only" disabled={subiendo} onChange={(e) => void elegirFoto(e)} />
              </label>
            ) : (
              votosAbiertos && (
                <button
                  type="button"
                  className={yaVote ? `${BOTON} border-[#008556] text-[#008556]` : BOTON}
                  onClick={() => onBrindis(m)}
                >
                  {yaVote ? '🥂 Brindis enviado' : '🥂 Enviar brindis'}
                </button>
              )
            )}
          </article>
        );
      })}
    </div>
  );
}
