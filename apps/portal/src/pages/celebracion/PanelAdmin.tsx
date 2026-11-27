import { useCallback, useEffect, useState } from 'react';
import { notify } from '../../lib/notify';
import { cargarResumen, excluirInvitado, mensajeDeError, readmitirInvitado } from './api';
import { BOTON, BOTON_PRIMARIO } from './estilos';
import { filasExcel, HOJA_EXCEL, nombreFicheroExcel } from './excel';
import { fechaHoraCorta } from './fechas';
import type { EstadoRespuesta, Evento, Resumen } from './tipos';
import { Etiqueta, Tarjeta, Titulo } from './ui';

interface Props {
  evento: Pick<Evento, 'id' | 'preferencias'>;
  /** Sube cada vez que la página recarga sus datos: el panel relee el resumen (decisión D14). */
  version: number;
  /** El admin que mira: no puede quitarse a sí mismo de la invitación. */
  yo: string;
  /** Avisa a la página de que cambió quién está invitado, para que recargue. */
  onCambio: () => void;
}

const BOTON_CHICO =
  'rounded-lg border border-[#D5D8E2] bg-white px-2.5 py-1.5 min-h-[36px] text-xs font-bold text-[#3E4352] transition hover:bg-[#F4F6FA] disabled:cursor-not-allowed disabled:opacity-60';

const ESTADO: Record<EstadoRespuesta, { texto: string; clase: string }> = {
  va: { texto: 'Va', clase: 'bg-[#008556]/10 text-[#008556]' },
  no_va: { texto: 'No va', clase: 'bg-[#D81B60]/10 text-[#D81B60]' },
  sin_responder: { texto: 'Sin responder', clase: 'bg-amber-50 text-amber-800' },
};

function Cifra({ id, etiqueta, valor, color }: { id: string; etiqueta: string; valor: number; color: string }) {
  return (
    <div data-testid={`cifra-${id}`} className="rounded-2xl border border-[#E6E8EF] bg-white p-3 text-center" style={{ borderTop: `4px solid ${color}` }}>
      <span className="block text-3xl font-black text-[#1F2229]">{valor}</span>
      <span className="text-xs font-bold uppercase tracking-wide text-gray-500">{etiqueta}</span>
    </div>
  );
}

/** Solo para el admin: quién va, quién no y quién falta, y el Excel para el restaurante. */
export default function PanelAdmin({ evento, version, yo, onCambio }: Props) {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [fallo, setFallo] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const cambiarInvitacion = async (accion: () => Promise<void>, aviso: string) => {
    setOcupado(true);
    try {
      await accion();
      notify(aviso);
      onCambio();
    } catch (e) {
      notify(mensajeDeError(e), 'error');
    } finally {
      setOcupado(false);
    }
  };

  const cargar = useCallback(async () => {
    try {
      setResumen(await cargarResumen());
      setFallo(false);
    } catch {
      setFallo(true);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar, version]);

  const textoMenu = (codigo: string | null) =>
    codigo ? (evento.preferencias.find((p) => p.codigo === codigo)?.texto ?? codigo) : '';

  // SheetJS pesa unos 430 KB: se descarga al pulsar, no con la página.
  const exportar = async () => {
    if (!resumen) return;
    setExportando(true);
    try {
      const XLSX = await import('xlsx');
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filasExcel(resumen, evento.preferencias)), HOJA_EXCEL);
      XLSX.writeFile(libro, nombreFicheroExcel(evento.id, fechaHoraCorta(new Date().toISOString()).slice(0, 10)));
    } catch {
      notify('No se pudo generar el Excel. Vuelve a intentarlo.', 'error');
    } finally {
      setExportando(false);
    }
  };

  return (
    <section aria-labelledby="titulo-panel" className="mb-6">
      <Tarjeta className="border-[#3F3D99]/30">
        <Etiqueta tono="indigo">🔒 Solo administración</Etiqueta>
        <Titulo id="titulo-panel">Panel de confirmaciones</Titulo>

        {!resumen ? (
          fallo ? (
            <div className="space-y-3">
              <p className="text-sm text-[#3E4352]">No se pudo cargar el resumen.</p>
              <button type="button" className={BOTON} onClick={() => void cargar()}>
                Reintentar
              </button>
            </div>
          ) : (
            <p role="status" className="text-sm text-gray-500">
              Cargando resumen…
            </p>
          )
        ) : (
          <>
            <div className="mb-5 grid grid-cols-3 gap-3">
              <Cifra id="van" etiqueta="Van" valor={resumen.totales.van} color="#008556" />
              <Cifra id="no-van" etiqueta="No van" valor={resumen.totales.noVan} color="#D81B60" />
              <Cifra id="sin-responder" etiqueta="Sin responder" valor={resumen.totales.sinResponder} color="#F47920" />
            </div>

            <h3 className="mb-2 text-sm font-bold text-[#3E4352]">Menús de quienes van</h3>
            <ul className="mb-5 flex flex-wrap gap-2">
              {resumen.porPreferencia.map((p) => (
                <li key={p.codigo} className="rounded-full bg-[#F4F6FA] px-3 py-1 text-sm">
                  {p.texto}: <strong>{p.total}</strong>
                </li>
              ))}
            </ul>

            <div className="mb-5 overflow-x-auto rounded-2xl border border-[#E6E8EF]">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-[#F8F9FC] text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Nombre</th>
                    <th className="px-3 py-2">Respuesta</th>
                    <th className="px-3 py-2">Preferencia</th>
                    <th className="px-3 py-2">Mensaje</th>
                    <th className="px-3 py-2">Invitación</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.filas.map((f) => (
                    <tr key={f.userId} className="border-t border-[#E6E8EF]">
                      <td className="px-3 py-2 font-semibold">{f.nombre}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${ESTADO[f.estado].clase}`}>{ESTADO[f.estado].texto}</span>
                      </td>
                      <td className="px-3 py-2">{textoMenu(f.preferencia)}</td>
                      <td className="px-3 py-2 italic text-[#4E5362]">{f.mensaje ?? ''}</td>
                      <td className="px-3 py-2">
                        {f.userId !== yo && (
                          <button
                            type="button"
                            disabled={ocupado}
                            aria-label={`Quitar a ${f.nombre} de la invitación`}
                            className={BOTON_CHICO}
                            onClick={() =>
                              void cambiarInvitacion(() => excluirInvitado(f.userId), `${f.nombre} ya no está en la invitación.`)
                            }
                          >
                            Quitar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {(resumen.excluidos ?? []).length > 0 && (
              <div className="mb-5">
                <h3 className="mb-2 text-sm font-bold text-[#3E4352]">No invitados ({resumen.excluidos.length})</h3>
                <ul className="space-y-2">
                  {resumen.excluidos.map((x) => (
                    <li key={x.userId} className="flex items-center justify-between gap-3 rounded-xl bg-[#F4F6FA] px-3 py-2 text-sm">
                      <span className="font-semibold">{x.nombre}</span>
                      <button
                        type="button"
                        disabled={ocupado}
                        aria-label={`Volver a invitar a ${x.nombre}`}
                        className={BOTON_CHICO}
                        onClick={() =>
                          void cambiarInvitacion(() => readmitirInvitado(x.userId), `${x.nombre} vuelve a estar en la invitación.`)
                        }
                      >
                        Volver a invitar
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button type="button" disabled={exportando} onClick={() => void exportar()} className={BOTON_PRIMARIO}>
              {exportando ? 'Generando…' : '⬇️ Descargar Excel'}
            </button>
          </>
        )}
      </Tarjeta>
    </section>
  );
}
