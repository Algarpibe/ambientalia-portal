import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { esEmailInterno, type EquipoVista, type RespuestaHistorialCalibraciones } from '../dominio';
import { fmtFecha, textoVigencia } from '../lib/vistas';
import { usePermisos } from '../permisos';
import { Alert, Button, DESACTIVADO, Drawer, EstadoBadge, Tag } from '../ui';
import CalibracionesLista from './CalibracionesLista';
import Retiro from './Retiro';

interface Props {
  equipo: EquipoVista;
  onClose: () => void;
  onGuardado: () => Promise<void>;
  /** Tras corregir una calibración: vuelve a pedir el inventario (y la tabla de la pestaña F-ST-022). */
  onCambio: () => Promise<void>;
  notificar: (msg: string) => void;
}

const INPUT = `block w-full min-h-[44px] rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 ${DESACTIVADO}`;

/**
 * «Calibraciones»: el historial del equipo (lote 9c), con de dónde sale cada
 * fecha —la F-ST-022 congelada, un ticket de Desk 2.0 o una corrección
 * manual—, su estado y cuál es la que cuenta como última. Quién y cuándo, en
 * el `title` de cada línea. Con `calibraciones.write`, «Corregir fecha» y
 * «Anular» (lote 9d-2b, `CalibracionesLista`); tras un cambio se vuelve a
 * pedir el historial y el inventario (el estado del equipo cambia con él).
 */
function Calibraciones({ equipo, onCambio }: { equipo: EquipoVista; onCambio: () => Promise<void> }) {
  const [datos, setDatos] = useState<RespuestaHistorialCalibraciones | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editable = usePermisos().puede('calibraciones.write');
  const cargar = useCallback(() => api.calibracionesDeEquipo(equipo.clave).then(setDatos, (err: Error) => setError(err.message)), [equipo.clave]);
  useEffect(() => void cargar(), [cargar]);
  const filas = datos?.calibraciones ?? [];
  return (
    <section aria-labelledby="ficha-calibraciones" className="flex flex-col gap-1.5 border-t border-gray-200 pt-4 text-sm">
      <p id="ficha-calibraciones" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Calibraciones
      </p>
      {error && <Alert tone="red">{error}</Alert>}
      {!datos && !error && <p className="text-gray-500">Cargando…</p>}
      {datos && filas.length === 0 && (
        <p className="text-gray-500">{equipo.ultimaCalibracion ? `Aún no hay calibraciones registradas para este equipo: vale la fecha del inventario (${fmtFecha(equipo.ultimaCalibracion)}).` : 'Sin calibraciones registradas.'}</p>
      )}
      {datos && <CalibracionesLista items={filas} destino={{ clave: equipo.clave }} onCambio={async () => void (await Promise.all([cargar(), onCambio()]))} />}
      <p className="text-xs text-gray-500">
        {editable ? '' : 'Sólo lectura. '}Las fechas vienen de la F-ST-022 congelada, de los tickets de Desk 2.0 y de las correcciones hechas a mano; una fecha no se edita: se anula y se registra otra.
      </p>
    </section>
  );
}

export default function FichaEquipo({ equipo: e, onClose, onGuardado, onCambio, notificar }: Props) {
  const s = e.seguimiento;
  const [enAmbientalia, setEnAmbientalia] = useState(s?.enAmbientalia ?? false);
  const [avisoEnviado, setAvisoEnviado] = useState(s?.avisoEnviado ?? '');
  const [servicioProgramado, setServicioProgramado] = useState(s?.servicioProgramado ?? '');
  const [nota, setNota] = useState(s?.nota ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Sin el permiso, el seguimiento se enseña en sólo lectura (el servidor tampoco lo guardaría). */
  const { puede, motivo } = usePermisos();
  const editable = puede('seguimiento.write');

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    if (!editable) return;
    setGuardando(true);
    setError(null);
    try {
      await api.guardarSeguimiento(e.clave, {
        enAmbientalia,
        avisoEnviado: avisoEnviado || null,
        servicioProgramado: servicioProgramado || null,
        nota: nota.trim(),
      });
      await onGuardado();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  const datos: [string, string][] = [
    ['Última calibración', fmtFecha(e.ultimaCalibracion)],
    ['Vence', fmtFecha(e.vence)],
    ['Vigencia (días)', e.vigenciaDias === null ? '—' : String(e.vigenciaDias)],
    ['Última entrada', fmtFecha(e.ultimaEntrada)],
    ['Fecha factura', fmtFecha(e.fechaFactura)],
    ['Entradas al servicio técnico', e.entradasSt === null ? '—' : String(e.entradasSt)],
    ['Calibraciones 2024–2026', e.calibracionesPeriodo === null ? '—' : String(e.calibracionesPeriodo)],
    ['Correctivos 2024–2026', e.correctivosPeriodo === null ? '—' : String(e.correctivosPeriodo)],
    ['Hoja de vida', e.hojaVida ?? '—'],
  ];

  return (
    <Drawer
      onClose={onClose}
      title={<span className="font-mono">{e.serial}</span>}
      subtitle={
        <>
          {e.cliente} · GRIMM {e.modelo}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <EstadoBadge estado={e.estado} />
          <span className="text-sm text-gray-500">{textoVigencia(e.vigenciaDias)}</span>
          {e.serialRepetido && <Tag tone="amber">Serial repetido en la F-ST-022</Tag>}
        </div>

        {e.ticket && (
          <Alert tone={e.ticket.sinConfirmar ? 'amber' : 'blue'} title={`En servicio · ticket ${e.ticket.numero}`}>
            <p>Estado en Zoho Desk: {e.ticket.estado}</p>
            {e.ticket.sinConfirmar && <p className="mt-1">Sin confirmar: Desk lleva más de un día sin actualizar este ticket, así que puede estar ya cerrado.</p>}
          </Alert>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {datos.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-gray-500">{k}</dt>
              <dd className="break-words font-medium tabular-nums text-gray-900">{v}</dd>
            </div>
          ))}
        </dl>

        <Calibraciones equipo={e} onCambio={onCambio} />

        {/* Retirar el equipo (lote 9d-2b): al retirarlo sale del inventario y esta ficha se cierra sola. */}
        <Retiro accion={{ de: 'equipo', retirar: true, destino: { clave: e.clave } }} retirado={null} onCambio={async (hecho) => (await onCambio(), notificar(hecho))} />

        <section aria-labelledby="ficha-contacto" className="flex flex-col gap-1.5 border-t border-gray-200 pt-4 text-sm">
          <p id="ficha-contacto" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Contacto para el aviso
          </p>
          {e.contacto ? (
            <>
              <p className="break-words font-medium text-gray-900">
                {e.contacto.nombre && <>{e.contacto.nombre} · </>}
                <span className="break-all">{e.contacto.email}</span>
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Tag tone={e.contacto.origen === 'manual' ? 'blue' : 'gray'}>{e.contacto.origen === 'manual' ? 'Puesto a mano para el cliente' : 'De Zoho Desk'}</Tag>
                {e.contacto.ticket !== null && <Tag>ticket {e.contacto.ticket}</Tag>}
                {esEmailInterno(e.contacto.email) && <Tag tone="amber">interno</Tag>}
              </div>
            </>
          ) : (
            <p className="text-gray-500">Sin contacto: ningún ticket de Desk de este equipo trae un correo del cliente.</p>
          )}
          <p className="text-xs text-gray-500">Se cambia, para todos los equipos del cliente, en «Avisos a clientes» → «Simulación automática». Hoy no se envía ningún correo automático.</p>
        </section>

        <form onSubmit={(ev) => void guardar(ev)} className="flex flex-col gap-3 border-t border-gray-200 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Seguimiento</p>
          {/* Un <fieldset> desactivado desactiva de una vez todo lo que lleva dentro. */}
          <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-3">
            <label
              className={`flex min-h-[44px] items-center gap-3 rounded-xl border px-3 py-2 text-sm ${
                !editable ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-500' : `cursor-pointer ${enAmbientalia ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`
              }`}
            >
              <input type="checkbox" className="h-5 w-5 accent-blue-600 disabled:cursor-not-allowed" checked={enAmbientalia} onChange={(ev) => setEnAmbientalia(ev.target.checked)} />
              El equipo está ahora en Ambientalia
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Aviso enviado al cliente</span>
              <input type="date" className={INPUT} value={avisoEnviado} onChange={(ev) => setAvisoEnviado(ev.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Servicio programado para</span>
              <input type="date" className={INPUT} value={servicioProgramado} onChange={(ev) => setServicioProgramado(ev.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Nota</span>
              <textarea rows={3} maxLength={2000} className={INPUT} value={nota} onChange={(ev) => setNota(ev.target.value)} placeholder={editable ? 'Contacto, acuerdos, número de ticket…' : ''} />
            </label>
          </fieldset>
          {s && (
            <p className="text-xs text-gray-500">
              Última actualización el {fmtFecha(s.actualizadoEn)} por {s.actualizadoPor}
            </p>
          )}
          {error && <Alert tone="red">{error}</Alert>}
          {editable ? (
            <div className="flex gap-2">
              <Button type="submit" variant="primary" busy={guardando}>
                Guardar seguimiento
              </Button>
              <Button onClick={onClose}>Cancelar</Button>
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-500">{motivo}</p>
              <div>
                <Button onClick={onClose}>Cerrar</Button>
              </div>
            </>
          )}
        </form>
      </div>
    </Drawer>
  );
}
