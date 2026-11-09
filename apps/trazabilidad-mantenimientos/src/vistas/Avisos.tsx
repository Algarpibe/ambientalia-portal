import { useCallback, useEffect, useMemo, useState } from 'react';
import { Send } from 'lucide-react';
import { api, type Inventario } from '../api';
import { ETIQUETA_TRAMO, correoQueSale, correoReal, type ContactoCliente, type CorreoAEnviar, type CorreoSimulado, type EnvioAviso, type EquipoVista, type EstadoCanal, type RespuestaEnvios } from '../dominio';
import { accionTarjeta, canalIgual, errorDeEnvio, msHastaRefresco, puedeResolver, rotuloModo, textoEstadoEnvio, textoFallo, ultimoEnvioDe } from '../lib/envios';
import { fmtFechaHora } from '../lib/vistas';
import { usePermisos } from '../permisos';
import { Alert, Button, Modal, Tag } from '../ui';
import TarjetasAvisos from './TarjetasAvisos';

interface Props {
  equipos: EquipoVista[];
  /** Veces que se ha pulsado «Actualizar» en la cabecera: con cada una, los envíos se vuelven a pedir. */
  recarga: number;
  hoy: string;
  /** Los contactos puestos a mano a clientes (destinatarios de las tarjetas). */
  contactos: ContactoCliente[];
  onFicha: (clave: string) => void;
  onCambio: () => Promise<void>;
  /** Sustituye el inventario por el que devuelve el servidor al guardar un contacto. */
  onInventario: (inv: Inventario) => void;
  notificar: (msg: string) => void;
}

/** El canal cuando deja enviar: prueba o real. */
type CanalAbierto = Exclude<EstadoCanal, { modo: 'apagado' }>;

/**
 * «Avisos a clientes», una sola pantalla (2026-11-08): arriba, la posición del
 * interruptor de envío, que decide el servidor; en medio, una tarjeta por
 * cliente y tramo (TarjetasAvisos.tsx) con su «Enviar correo»; abajo, los
 * últimos envíos, con «Sí salió» / «No salió» para los que quedaron sin
 * confirmar. Al enviar, la pantalla sólo dice qué tarjeta y qué equipos vio:
 * el servidor la vuelve a calcular y redacta él el correo, con el mismo texto
 * que aquí se enseña (avisos-correo.ts), que no se edita.
 *
 * El estado de cada tarjeta, su botón y «Sí salió» / «No salió» salen SIEMPRE
 * de la lista de GET /avisos/envios, que se vuelve a pedir tras cada envío y
 * cada resolución; la respuesta del POST sólo se enseña como aviso.
 */
export default function Avisos({ equipos, recarga: pulsos, hoy, contactos, onFicha, onCambio, onInventario, notificar }: Props) {
  const [envios, setEnvios] = useState<RespuestaEnvios | null>(null);
  const [errorEnvios, setErrorEnvios] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<CorreoSimulado<EquipoVista> | null>(null);
  /** Lo que se dijo tras un error que obligó a actualizar la pantalla: se queda hasta que se cierra (un aviso de 3 s no basta). */
  const [aviso, setAviso] = useState<string | null>(null);
  /** Ver y copiar el aviso lo puede cualquiera; enviarlo y resolver un «sin confirmar» piden `avisos.write`. */
  const puedeEnviar = usePermisos().puede('avisos.write');

  const cargarEnvios = useCallback(async () => {
    try {
      setEnvios(await api.envios());
      setErrorEnvios(null);
    } catch (e) {
      setErrorEnvios((e as Error).message);
    }
  }, []);
  // Al entrar y con cada «Actualizar» de la cabecera.
  useEffect(() => {
    void cargarEnvios();
  }, [cargarEnvios, pulsos]);

  // Un envío «en curso» pasa a «sin confirmar» a los 2 minutos sin que nadie toque nada: un refresco único (cada cambio de la lista lo reprograma).
  const pendiente = msHastaRefresco(envios?.envios ?? []);
  useEffect(() => {
    if (pendiente === null) return;
    const t = setTimeout(() => void cargarEnvios(), pendiente);
    return () => clearTimeout(t);
  }, [envios, pendiente, cargarEnvios]);

  /** Tras enviar o resolver: el inventario (los avisados cambian de grupo) y los envíos. */
  const recargar = async () => {
    await Promise.all([onCambio(), cargarEnvios()]);
  };

  const canal = envios?.canal ?? null;
  const lista = envios?.envios ?? [];
  const rotulo = canal ? rotuloModo(canal) : null;

  return (
    <div className="flex flex-col gap-4">
      {rotulo && (
        <Alert tone={rotulo.tono} title={rotulo.titulo}>
          <p>{rotulo.texto}</p>
        </Alert>
      )}
      {errorEnvios && (
        <Alert tone="red">
          <div className="flex flex-wrap items-center gap-3">
            <span>No se pudo leer el estado del envío: {errorEnvios}</span>
            <Button onClick={() => void cargarEnvios()}>Reintentar</Button>
          </div>
        </Alert>
      )}
      {aviso && (
        <Alert tone="amber">
          <div className="flex flex-wrap items-center gap-3">
            <span>{aviso}</span>
            <Button variant="ghost" onClick={() => setAviso(null)}>
              Entendido
            </Button>
          </div>
        </Alert>
      )}
      <TarjetasAvisos
        equipos={equipos}
        hoy={hoy}
        contactos={contactos}
        envios={lista}
        onFicha={onFicha}
        onInventario={onInventario}
        notificar={notificar}
        accion={(c) => {
          const a = accionTarjeta({ puedeEnviar, canal, fallo: errorEnvios !== null, ultimo: ultimoEnvioDe(lista, c.claveCliente, c.tramo), para: correoReal(c).para });
          if (!a) return null;
          if (a.tipo === 'aviso') return <p className="text-xs text-amber-800">{a.texto}</p>;
          return (
            <Button variant="primary" disabled={!a.activo} onClick={() => setConfirmar(c)}>
              <Send className="h-4 w-4" aria-hidden /> {a.texto}
            </Button>
          );
        }}
      />
      <UltimosEnvios envios={lista} puedeResolverAqui={puedeEnviar} recargar={recargar} notificar={notificar} />
      {confirmar && canal && canal.modo !== 'apagado' && (
        <Confirmar
          correo={confirmar}
          canal={canal}
          onClose={() => setConfirmar(null)}
          onEnviado={async (e) => {
            // La respuesta del POST sólo se enseña; lo que decide la pantalla es lo que sirva GET.
            await recargar();
            if (e.estado === 'fallido') return;
            setAviso(null);
            setConfirmar(null);
            notificar(e.estado === 'enviado' ? `Aviso enviado a ${e.cliente}` : 'Sin confirmar: revisa Enviados de info@ en un par de minutos y resuélvelo en «Últimos envíos»');
          }}
          onFallo={async (texto, recargarPantalla) => {
            await recargar();
            if (recargarPantalla) {
              setConfirmar(null);
              setAviso(texto);
            }
          }}
        />
      )}
    </div>
  );
}

/** La confirmación: a quién sale, con qué asunto y con qué texto, tal como lo enviará el servidor. */
function Confirmar({
  correo,
  canal,
  onClose,
  onEnviado,
  onFallo,
}: {
  correo: CorreoSimulado<EquipoVista>;
  canal: CanalAbierto;
  onClose: () => void;
  onEnviado: (e: EnvioAviso) => Promise<void>;
  onFallo: (texto: string, recargar: boolean) => Promise<void>;
}) {
  const real = useMemo(() => correoReal(correo), [correo]);
  const sale = correoQueSale(correo, canal) as CorreoAEnviar; // el canal está abierto: no es null
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar() {
    setEnviando(true);
    setError(null);
    try {
      // Lo que se confirma es lo que sale: si el interruptor ya no está como lo enseña esta confirmación, no se envía.
      const ahora = (await api.envios()).canal;
      if (!canalIgual(ahora, canal)) {
        await onFallo(errorDeEnvio({ code: 'modo_cambiado' }).texto, true);
        return;
      }
      const e = await api.enviarAviso(correo.claveCliente, correo.tramo, correo.equipos.map((a) => a.equipo.clave), canal.modo, real.para);
      if (e.estado === 'fallido') setError(textoFallo(e.error));
      await onEnviado(e);
    } catch (x) {
      const m = errorDeEnvio(x);
      if (!m.recargar) setError(m.texto);
      await onFallo(m.texto, m.recargar);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      title={`Enviar el aviso a ${correo.cliente}`}
      onClose={enviando ? () => undefined : onClose} // mientras sale, no se cierra (ni con la X, Escape o el fondo): el resultado se tiene que ver
      footer={
        <>
          <Button onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button variant="primary" busy={enviando} onClick={() => void enviar()}>
            <Send className="h-4 w-4" aria-hidden /> Enviar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {canal.modo === 'prueba' && (
          <Alert tone="blue" title="Modo prueba">
            <p>
              Sale sólo hacia {canal.buzonPrueba}, con «[PRUEBA]» en el asunto. Al cliente no le llega nada y ningún equipo queda marcado como avisado. En modo real iría a: {real.para.join(', ')}.
            </p>
          </Alert>
        )}
        <p>
          <span className="text-gray-500">Para: </span>
          <span className="break-all font-medium text-gray-900">{sale.para.join(', ')}</span>
        </p>
        <p>
          <span className="text-gray-500">Asunto: </span>
          <span className="font-medium text-gray-900">{sale.asunto}</span>
        </p>
        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 font-sans text-sm text-gray-800">{sale.cuerpo}</pre>
        <p className="text-xs text-gray-500">
          {ETIQUETA_TRAMO[correo.tramo]} · {correo.equipos.length === 1 ? '1 equipo' : `${correo.equipos.length} equipos`}. El texto no se edita: es el que redacta el servidor al enviar.
        </p>
        {error && <Alert tone="red">{error}</Alert>}
      </div>
    </Modal>
  );
}

/** «Últimos envíos», plegado: fecha, quién, cliente, grupo, modo y resultado; con «Sí salió» / «No salió» en los que GET presenta sin confirmar. */
function UltimosEnvios({ envios, puedeResolverAqui, recargar, notificar }: { envios: EnvioAviso[]; puedeResolverAqui: boolean; recargar: () => Promise<void>; notificar: (m: string) => void }) {
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolver(e: EnvioAviso, salio: boolean) {
    setOcupado(e.id);
    setError(null);
    try {
      await api.resolverEnvio(e.id, salio);
      await recargar();
      notificar(salio ? 'Apuntado como enviado' : 'Apuntado como no enviado: la tarjeta se puede volver a enviar');
    } catch (x) {
      const m = errorDeEnvio(x);
      setError(m.texto);
      if (m.recargar) await recargar();
    } finally {
      setOcupado(null);
    }
  }

  return (
    <details className="rounded-2xl border border-gray-200 bg-white">
      <summary className="flex min-h-[44px] cursor-pointer flex-wrap items-center gap-2 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50">
        Últimos envíos <Tag>{envios.length}</Tag>
      </summary>
      <div className="flex flex-col gap-2 border-t border-gray-200 px-4 py-3">
        {error && <Alert tone="red">{error}</Alert>}
        {envios.length === 0 ? (
          <p className="text-sm text-gray-500">Todavía no se ha enviado ninguno.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {envios.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="tabular-nums text-gray-500">{fmtFechaHora(e.creadoEn)}</span>
                <span className="text-gray-700">{e.por}</span>
                <span className="min-w-0 break-words font-medium text-gray-900">{e.cliente}</span>
                <span className="text-gray-600">{ETIQUETA_TRAMO[e.tramo]}</span>
                <Tag tone={e.modo === 'real' ? 'blue' : 'gray'}>{e.modo}</Tag>
                <span className={e.estado === 'enviado' ? 'text-emerald-700' : e.estado === 'fallido' ? 'text-red-700' : 'text-amber-800'}>{textoEstadoEnvio(e)}</span>
                {e.resueltoPor && (
                  <span className="text-xs text-gray-500">
                    resuelto por {e.resueltoPor} el {fmtFechaHora(e.resueltoEn)}
                  </span>
                )}
                {puedeResolverAqui && puedeResolver(e) && (
                  <span className="flex gap-2">
                    <Button busy={ocupado === e.id} onClick={() => void resolver(e, true)}>
                      Sí salió
                    </Button>
                    <Button disabled={ocupado === e.id} onClick={() => void resolver(e, false)}>
                      No salió
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
