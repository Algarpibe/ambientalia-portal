import { useState, type FormEvent } from 'react';
import { api } from '../api';
import type { EquipoVista } from '../dominio';
import { fmtFecha, textoVigencia } from '../lib/vistas';
import { Alert, Button, Drawer, EstadoBadge, Tag } from '../ui';

interface Props {
  equipo: EquipoVista;
  onClose: () => void;
  onGuardado: () => Promise<void>;
}

const INPUT =
  'block w-full min-h-[44px] rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100';

export default function FichaEquipo({ equipo: e, onClose, onGuardado }: Props) {
  const s = e.seguimiento;
  const [enAmbientalia, setEnAmbientalia] = useState(s?.enAmbientalia ?? false);
  const [avisoEnviado, setAvisoEnviado] = useState(s?.avisoEnviado ?? '');
  const [servicioProgramado, setServicioProgramado] = useState(s?.servicioProgramado ?? '');
  const [nota, setNota] = useState(s?.nota ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
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

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {datos.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-gray-500">{k}</dt>
              <dd className="break-words font-medium tabular-nums text-gray-900">{v}</dd>
            </div>
          ))}
        </dl>

        <form onSubmit={(ev) => void guardar(ev)} className="flex flex-col gap-3 border-t border-gray-200 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Seguimiento</p>
          <label className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm ${enAmbientalia ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}>
            <input type="checkbox" className="h-5 w-5 accent-blue-600" checked={enAmbientalia} onChange={(ev) => setEnAmbientalia(ev.target.checked)} />
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
            <textarea rows={3} maxLength={2000} className={INPUT} value={nota} onChange={(ev) => setNota(ev.target.value)} placeholder="Contacto, acuerdos, número de ticket…" />
          </label>
          {s && (
            <p className="text-xs text-gray-500">
              Última actualización el {fmtFecha(s.actualizadoEn)} por {s.actualizadoPor}
            </p>
          )}
          {error && <Alert tone="red">{error}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" busy={guardando}>
              Guardar seguimiento
            </Button>
            <Button onClick={onClose}>Cancelar</Button>
          </div>
        </form>
      </div>
    </Drawer>
  );
}
