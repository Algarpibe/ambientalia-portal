import { useState, type FormEvent } from 'react';
import { BOTON, BOTON_ESPECTRO, CAMPO, opcion } from './estilos';
import { diaYMes } from './fechas';
import { ESPECTRO } from './marca';
import { MENSAJE_MAX, type DatosConfirmacion, type Evento, type Respuesta } from './tipos';

interface Props {
  evento: Pick<Evento, 'confirmacionesAbiertas' | 'cierreConfirmaciones' | 'preferencias'>;
  respuesta: Respuesta | null;
  /** Guarda; si falla, el padre avisa y relanza, y el formulario sigue abierto. */
  onGuardar: (datos: DatosConfirmacion) => Promise<void>;
}

/** «Sí voy / No podré ir», con sus tres estados: sin responder, respondida y cerrada. */
export default function Confirmacion({ evento, respuesta, onGuardar }: Props) {
  const menuPorDefecto = evento.preferencias[0]?.codigo ?? '';
  const [editando, setEditando] = useState(respuesta === null);
  const [asiste, setAsiste] = useState<boolean | null>(respuesta?.asiste ?? null);
  const [preferencia, setPreferencia] = useState(respuesta?.preferencia ?? menuPorDefecto);
  const [mensaje, setMensaje] = useState(respuesta?.mensaje ?? '');
  const [guardando, setGuardando] = useState(false);

  const textoMenu = (codigo: string | null) => evento.preferencias.find((p) => p.codigo === codigo)?.texto ?? '';

  const cambiar = () => {
    setAsiste(respuesta?.asiste ?? null);
    setPreferencia(respuesta?.preferencia ?? menuPorDefecto);
    setMensaje(respuesta?.mensaje ?? '');
    setEditando(true);
  };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (asiste === null) return;
    const limpio = mensaje.trim();
    setGuardando(true);
    try {
      await onGuardar({ asiste, preferencia: asiste ? preferencia : null, mensaje: limpio === '' ? null : limpio });
      setEditando(false);
    } catch {
      // El padre ya mostró el aviso; el formulario sigue abierto para reintentar.
    } finally {
      setGuardando(false);
    }
  };

  if (!evento.confirmacionesAbiertas || !editando) {
    return (
      <div className="space-y-4">
        {respuesta && (
          <div className="rounded-2xl bg-[#F8F9FC] p-4">
            <p className="font-bold text-[#1F2229]">
              {respuesta.asiste ? `✅ Vas al almuerzo · ${textoMenu(respuesta.preferencia)}` : '🙏 Nos dijiste que no podrás ir.'}
            </p>
            {respuesta.mensaje && <p className="mt-1 italic text-[#4E5362]">“{respuesta.mensaje}”</p>}
          </div>
        )}
        {evento.confirmacionesAbiertas ? (
          <button type="button" className={BOTON} onClick={cambiar}>
            ✏️ Cambiar respuesta
          </button>
        ) : (
          <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            Las confirmaciones se cerraron el {diaYMes(evento.cierreConfirmaciones)}.
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void enviar(e)} className="space-y-5">
      <div className="grid grid-cols-2 gap-3" role="group" aria-label="¿Vas al almuerzo?">
        <button type="button" aria-pressed={asiste === true} className={opcion(asiste === true)} onClick={() => setAsiste(true)}>
          🎉 Sí voy
        </button>
        <button type="button" aria-pressed={asiste === false} className={opcion(asiste === false)} onClick={() => setAsiste(false)}>
          😔 No podré ir
        </button>
      </div>

      {asiste === true && (
        <div>
          <label htmlFor="celebracion-menu" className="mb-1.5 block text-sm font-bold text-[#3E4352]">
            Preferencia de menú
          </label>
          <select id="celebracion-menu" className={CAMPO} value={preferencia} onChange={(e) => setPreferencia(e.target.value)}>
            {evento.preferencias.map((p) => (
              <option key={p.codigo} value={p.codigo}>
                {p.texto}
              </option>
            ))}
          </select>
        </div>
      )}

      {asiste !== null && (
        <div>
          <label htmlFor="celebracion-mensaje" className="mb-1.5 block text-sm font-bold text-[#3E4352]">
            Mensaje o brindis (opcional)
          </label>
          <input
            id="celebracion-mensaje"
            type="text"
            className={CAMPO}
            maxLength={MENSAJE_MAX}
            placeholder="¡Listo para celebrar con el equipo!"
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
          />
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <button type="submit" disabled={asiste === null || guardando} className={BOTON_ESPECTRO} style={{ background: ESPECTRO }}>
          {guardando ? 'Guardando…' : '✨ Confirmar respuesta'}
        </button>
        {respuesta && (
          <button type="button" className={BOTON} onClick={() => setEditando(false)}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
