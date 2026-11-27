import { useState } from 'react';
import logo from '../../assets/ambientalia-logo.png';
import { notify } from '../../lib/notify';
import { descargarUrl } from './descargar';
import { BOTON_PRIMARIO } from './estilos';
import { fechaLarga, hora } from './fechas';
import { ESPECTRO, FUENTE_TITULOS } from './marca';
import { dibujarPase, nombreFicheroPase, type DatosPase } from './pase';
import type { Evento, Respuesta } from './tipos';

interface Props {
  nombre: string;
  evento: Pick<Evento, 'id' | 'titulo' | 'inicio' | 'lugar' | 'direccion' | 'preferencias'>;
  respuesta: Respuesta;
}

/** El pase de quien va: en pantalla y para descargar en PNG. */
export default function PaseDigital({ nombre, evento, respuesta }: Props) {
  const [descargando, setDescargando] = useState(false);
  const datos: DatosPase = {
    titulo: evento.titulo,
    nombre,
    fecha: fechaLarga(evento.inicio),
    hora: hora(evento.inicio),
    lugar: `${evento.lugar} · ${evento.direccion}`,
    preferencia: evento.preferencias.find((p) => p.codigo === respuesta.preferencia)?.texto ?? '',
    mensaje: respuesta.mensaje,
  };

  const descargar = async () => {
    setDescargando(true);
    try {
      descargarUrl(nombreFicheroPase(evento.id, nombre), await dibujarPase(datos, logo));
      notify('📸 Pase descargado.');
    } catch {
      notify('No se pudo generar el pase. Vuelve a intentarlo.', 'error');
    } finally {
      setDescargando(false);
    }
  };

  return (
    <div className="mt-8 border-t-[1.5px] border-dashed border-[#E6E8EF] pt-8">
      <div data-testid="pase" className="mx-auto mb-4 max-w-md overflow-hidden rounded-3xl border-2 border-[#E6E8EF] bg-white text-left shadow-lg">
        <div className="h-2" style={{ background: ESPECTRO }} />
        <div className="p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <img src={logo} alt="Ambientalia" className="h-8 w-auto" />
            <span className="rounded-full bg-[#FFF4E6] px-2.5 py-1 text-[11px] font-extrabold text-[#C95B00]">PASE OFICIAL 2026</span>
          </div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Invitado</p>
          <p className="mb-3 text-xl font-black text-[#1F2229]" style={{ fontFamily: FUENTE_TITULOS }}>
            {nombre}
          </p>
          <dl className="grid grid-cols-2 gap-2.5 rounded-2xl bg-[#F8F9FC] p-3 text-sm">
            <div>
              <dt className="text-xs text-gray-500">Fecha y hora</dt>
              <dd className="font-bold">
                {datos.fecha} · {datos.hora}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Preferencia</dt>
              <dd className="font-bold">{datos.preferencia}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-gray-500">Lugar</dt>
              <dd className="font-bold">{datos.lugar}</dd>
            </div>
          </dl>
          {respuesta.mensaje && <p className="mt-3 text-sm italic text-[#4E5362]">“{respuesta.mensaje}”</p>}
        </div>
      </div>
      <div className="text-center">
        <button type="button" disabled={descargando} onClick={() => void descargar()} className={`${BOTON_PRIMARIO} w-full max-w-xs`}>
          {descargando ? 'Generando…' : '📸 Descargar pase (PNG)'}
        </button>
      </div>
    </div>
  );
}
