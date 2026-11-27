import { notify } from '../../lib/notify';
import { urlGoogleCalendar } from './enlaces';
import { BOTON, BOTON_PRIMARIO } from './estilos';
import { fechaLarga, hora } from './fechas';
import type { Evento } from './tipos';
import { Etiqueta, Tarjeta, Titulo } from './ui';

function Detalle({ icono, titulo, texto }: { icono: string; titulo: string; texto: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F4F6FA] text-lg" aria-hidden="true">
        {icono}
      </span>
      <div>
        <strong className="block text-[#1F2229]">{titulo}</strong>
        <span className="text-sm text-gray-500">{texto}</span>
      </div>
    </li>
  );
}

/** Las dos tarjetas del evento: dónde y cuándo, y la agenda con el calendario. */
export default function TarjetasEvento({ evento }: { evento: Evento }) {
  const copiarDireccion = async () => {
    try {
      await navigator.clipboard.writeText(`${evento.lugar}, ${evento.direccion}`);
      notify('📋 Dirección copiada.');
    } catch {
      notify('No se pudo copiar la dirección.', 'error');
    }
  };

  return (
    <div className="mb-6 grid gap-6 md:grid-cols-2">
      <Tarjeta className="flex flex-col justify-between">
        <div>
          <Etiqueta tono="teal">📍 Coordenadas del encuentro</Etiqueta>
          <Titulo>Fecha, hora y lugar</Titulo>
          <ul className="mb-6 space-y-3.5">
            <Detalle icono="📅" titulo={fechaLarga(evento.inicio)} texto="Encuentro de cierre de año" />
            <Detalle icono="🕧" titulo={hora(evento.inicio)} texto="Bienvenida y brindis" />
            <Detalle icono="🍽️" titulo={evento.lugar} texto={evento.direccion} />
          </ul>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <a className={BOTON_PRIMARIO} href={evento.mapsUrl} target="_blank" rel="noopener noreferrer">
            🗺️ Google Maps
          </a>
          <button type="button" className={BOTON} onClick={() => void copiarDireccion()}>
            📋 Copiar dirección
          </button>
        </div>
      </Tarjeta>

      <Tarjeta className="flex flex-col justify-between">
        <div>
          <Etiqueta tono="green">🗓️ Agenda y detalles</Etiqueta>
          <Titulo>Prepárate para disfrutar</Titulo>
          <ul className="mb-6 space-y-3.5">
            <Detalle icono="🥂" titulo="Experiencia gastronómica" texto="Almuerzo especial de temporada y brindis corporativo" />
            <Detalle icono="👔" titulo={`Código de vestimenta: ${evento.vestimenta}`} texto="Cómodo, elegante y listo para celebrar" />
            <Detalle icono="⏰" titulo="Agéndalo en tu calendario" texto="Guarda el recordatorio con un solo clic" />
          </ul>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <a className={BOTON} href={urlGoogleCalendar(evento)} target="_blank" rel="noopener noreferrer">
            📆 Google Calendar
          </a>
        </div>
      </Tarjeta>
    </div>
  );
}
