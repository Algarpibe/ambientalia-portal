import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import logo from '../../assets/ambientalia-logo.png';
import { fileToResizedDataUrl } from '../../lib/image';
import { notify } from '../../lib/notify';
import { cargarVista, ErrorApi, guardarConfirmacion, guardarVotos, mensajeDeError, subirFotoCelebracion } from './api';
import { lanzarConfeti, prefiereMenosMovimiento } from './confeti';
import Confirmacion from './Confirmacion';
import CuentaAtras from './CuentaAtras';
import { BOTON } from './estilos';
import { diaYMes } from './fechas';
import { ESPECTRO, FUENTE_TEXTO, FUENTE_TITULOS, TITULO_DEGRADADO } from './marca';
import ModalCualidades from './ModalCualidades';
import MuroEquipo from './MuroEquipo';
import PanelAdmin from './PanelAdmin';
import PaseDigital from './PaseDigital';
import { primerNombre } from './persona';
import Portada from './Portada';
import TarjetasEvento from './TarjetasEvento';
import type { DatosConfirmacion, Miembro, Vista } from './tipos';
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

/** Lleva la vista hasta esa sección (jsdom no trae scrollIntoView). Respeta el movimiento reducido. */
function irA(ref: RefObject<HTMLElement | null>) {
  ref.current?.scrollIntoView?.({ behavior: prefiereMenosMovimiento() ? 'auto' : 'smooth', block: 'start' });
}

/** `/celebracion-navidad-2026`: la invitación al almuerzo de fin de año. Fuera del shell; con sesión. */
export default function CelebracionNavidad() {
  const [vista, setVista] = useState<Vista | null>(null);
  const [fallo, setFallo] = useState(false);
  const [noInvitado, setNoInvitado] = useState(false);
  const [abierta, setAbierta] = useState(false);
  const [brindisPara, setBrindisPara] = useState<Miembro | null>(null);
  const [version, setVersion] = useState(0);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const muroRef = useRef<HTMLElement>(null);
  const confirmacionRef = useRef<HTMLElement>(null);

  const recargar = useCallback(async () => {
    try {
      setVista(await cargarVista());
      setFallo(false);
      setNoInvitado(false);
      setVersion((v) => v + 1);
    } catch (e) {
      setNoInvitado(e instanceof ErrorApi && e.codigo === 'no_invitado');
      setFallo(true);
    }
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  useEffect(() => {
    if (abierta) tituloRef.current?.focus();
  }, [abierta]);

  // Para responder hacen falta la foto graciosa y todos los brindis. Al cumplir lo último que faltaba
  // (bloqueada pasa de true a false), baja sola a la confirmación; nunca en la primera carga.
  const tieneFoto = vista?.equipo.find((m) => m.userId === vista.yo)?.foto != null;
  const bloqueadaODesconocido = vista ? vista.evento.confirmacionesAbiertas && (!tieneFoto || vista.brindis.dados < vista.brindis.minimo) : null;
  const bloqueadaAntes = useRef<boolean | null>(null);
  useEffect(() => {
    if (bloqueadaODesconocido === null) return;
    const antes = bloqueadaAntes.current;
    bloqueadaAntes.current = bloqueadaODesconocido;
    if (antes === true && !bloqueadaODesconocido) irA(confirmacionRef);
  }, [bloqueadaODesconocido]);

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
        {noInvitado ? (
          <>
            <p className="font-semibold text-[#3E4352]">Esta invitación no está disponible para tu cuenta.</p>
            <a href="/" className={BOTON}>
              Ir al Inicio
            </a>
          </>
        ) : fallo ? (
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
      if (e instanceof ErrorApi && e.status === 409) void recargar();
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

  const brindar = async (cualidades: string[]) => {
    if (!brindisPara) return;
    try {
      await guardarVotos(brindisPara.userId, cualidades);
    } catch (e) {
      notify(mensajeDeError(e), 'error');
      if (e instanceof ErrorApi && e.status === 409) {
        setBrindisPara(null);
        void recargar();
      }
      throw e;
    }
    if (cualidades.length > 0) {
      notify(`🥂 ¡Brindis enviado para ${primerNombre(brindisPara.nombre)}!`);
      lanzarConfeti();
    } else {
      notify('Brindis retirado.');
    }
    setBrindisPara(null);
    await recargar();
  };

  const subirFoto = async (archivo: File) => {
    try {
      // 256 px como las fotos de perfil: el muro la pinta a 74 px y la página
      // recarga el equipo entero tras cada brindis (datos móviles).
      await subirFotoCelebracion(await fileToResizedDataUrl(archivo, 256, 0.75));
    } catch (e) {
      notify(e instanceof ErrorApi ? mensajeDeError(e) : 'No se pudo subir la foto.', 'error');
      return;
    }
    notify('📸 ¡Foto graciosa lista!');
    await recargar();
  };

  const { evento } = vista;
  const bloqueada = bloqueadaODesconocido === true;
  const pendientes = [
    { hecho: tieneFoto, texto: 'Sube tu foto graciosa' },
    {
      hecho: vista.brindis.dados >= vista.brindis.minimo,
      texto: `Brinda por todos tus compañeros (${vista.brindis.dados} de ${vista.brindis.minimo})`,
    },
  ];

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#FAFAFC] text-[#2B2D35]" style={{ fontFamily: FUENTE_TEXTO }}>
      <Fondo />
      {!abierta && <Portada onAbrir={abrir} />}

      <main
        aria-hidden={!abierta}
        inert={!abierta}
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
            ref={tituloRef}
            tabIndex={-1}
            className="my-4 break-words bg-clip-text text-3xl font-black leading-tight text-transparent outline-none sm:text-5xl"
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

        <section ref={muroRef} aria-labelledby="titulo-equipo" className="mb-6 scroll-mt-4">
          <Tarjeta>
            <div className="mx-auto mb-6 max-w-2xl text-center">
              <Etiqueta tono="pink">🌟 El corazón de Ambientalia</Etiqueta>
              <Titulo id="titulo-equipo">Nuestro equipo</Titulo>
              <p className="text-sm text-[#5C6170]">
                Brinda por tus compañeros eligiendo hasta {evento.maxCualidades} cualidades: tu voto es anónimo.
              </p>
              {bloqueada && !pendientes[1].hecho && (
                <p className="mt-2 text-sm font-semibold text-[#C95B00]">
                  Llevas {vista.brindis.dados} de {vista.brindis.minimo} brindis para poder confirmar.
                </p>
              )}
              {bloqueada && !tieneFoto && (
                <p className="mt-2 text-sm font-semibold text-[#C95B00]">Sube tu foto graciosa desde tu tarjeta.</p>
              )}
            </div>
            <MuroEquipo
              equipo={vista.equipo}
              yo={vista.yo}
              misVotos={vista.misVotos}
              votosAbiertos={evento.votosAbiertos}
              onBrindis={setBrindisPara}
              onSubirFoto={subirFoto}
            />
          </Tarjeta>
        </section>

        <section ref={confirmacionRef} aria-labelledby="titulo-confirmacion" className="mb-6 scroll-mt-4">
          <Tarjeta>
            <Etiqueta tono="teal">🎟️ Confirmación y pase digital</Etiqueta>
            <Titulo id="titulo-confirmacion">¿Nos acompañas?</Titulo>
            {evento.confirmacionesAbiertas && (
              <p className="mb-5 text-sm text-[#5C6170]">
                Confirma hasta el {diaYMes(evento.cierreConfirmaciones)}. Puedes cambiar tu respuesta hasta esa fecha.
              </p>
            )}
            {bloqueada && (
              <div
                role="status"
                className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#FDB913] bg-[#FFF6E5] px-4 py-3 text-sm font-semibold text-[#8A4B00]"
              >
                <div>
                  <p>🔒 Para responder te falta:</p>
                  <ul className="mt-1 space-y-0.5">
                    {pendientes.map((p) => (
                      <li key={p.texto}>
                        {p.hecho ? '✅' : '⬜'} {p.texto}
                      </li>
                    ))}
                  </ul>
                </div>
                <button type="button" className={BOTON} onClick={() => irA(muroRef)}>
                  Ir al muro
                </button>
              </div>
            )}
            <div
              inert={bloqueada}
              aria-hidden={bloqueada || undefined}
              className={bloqueada ? 'pointer-events-none select-none opacity-40' : undefined}
            >
              <Confirmacion evento={evento} respuesta={vista.miRespuesta} onGuardar={confirmar} />
              {vista.miRespuesta?.asiste && (
                <PaseDigital
                  nombre={vista.equipo.find((m) => m.userId === vista.yo)?.nombre ?? ''}
                  evento={evento}
                  respuesta={vista.miRespuesta}
                />
              )}
            </div>
          </Tarjeta>
        </section>

        {vista.esAdmin && <PanelAdmin evento={evento} version={version} yo={vista.yo} onCambio={() => void recargar()} />}

        <footer className="mt-10 text-center text-sm text-gray-500">
          <strong>Ambientalia S.A.S.</strong> · {evento.titulo}
        </footer>
      </main>

      {brindisPara && (
        <ModalCualidades
          nombre={brindisPara.nombre}
          cualidades={evento.cualidades}
          max={evento.maxCualidades}
          seleccionInicial={vista.misVotos[brindisPara.userId] ?? []}
          onGuardar={brindar}
          onCerrar={() => setBrindisPara(null)}
        />
      )}
    </div>
  );
}
