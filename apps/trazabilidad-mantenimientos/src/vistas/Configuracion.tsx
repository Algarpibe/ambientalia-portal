import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { PLAZO_MAX_DIAS, PLAZO_MIN_DIAS, type PlazoServicio } from '../dominio';
import { fmtFecha } from '../lib/vistas';
import { Alert, Button, Card, Loading } from '../ui';

/**
 * Configuración: el plazo, en días hábiles, de cada tipo de servicio de Zoho
 * Desk. Con él se calcula la fecha límite de la pestaña «Servicios» (ingreso +
 * plazo). Vacío = ese tipo no tiene plazo. Lo edita cualquiera con la app y
 * cada cambio queda firmado con su correo.
 */
interface Props {
  notificar: (msg: string) => void;
}

export default function Configuracion({ notificar }: Props) {
  const [plazos, setPlazos] = useState<PlazoServicio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Lo que hay escrito en cada casilla que se ha tocado, por clave. */
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setPlazos((await api.plazos()).plazos);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!plazos) return error ? <Alert tone="red">{error}</Alert> : <Loading texto="Cargando los plazos…" />;

  const escrito = (p: PlazoServicio) => borrador[p.clave] ?? (p.dias === null ? '' : String(p.dias));
  /** El valor a guardar, o un mensaje si lo escrito no vale. La misma regla que valida el servidor. */
  const leer = (txt: string): { dias: number | null } | { error: string } => {
    const t = txt.trim();
    if (t === '') return { dias: null };
    const n = Number(t);
    if (!/^\d+$/.test(t) || n < PLAZO_MIN_DIAS || n > PLAZO_MAX_DIAS) return { error: `Un número entero entre ${PLAZO_MIN_DIAS} y ${PLAZO_MAX_DIAS}, o vacío.` };
    return { dias: n };
  };

  const guardar = async (p: PlazoServicio) => {
    const v = leer(escrito(p));
    if ('error' in v) return;
    setGuardando(p.clave);
    try {
      setPlazos((await api.guardarPlazo(p.etiqueta, v.dias)).plazos);
      setBorrador((b) => {
        const resto = { ...b };
        delete resto[p.clave];
        return resto;
      });
      setError(null);
      notificar(v.dias === null ? `${p.etiqueta}: sin plazo` : `${p.etiqueta}: ${v.dias} día${v.dias === 1 ? '' : 's'} hábil${v.dias === 1 ? '' : 'es'}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(null);
    }
  };

  return (
    <Card
      title="Plazos por tipo de servicio"
      hint="Días hábiles (lunes a viernes, sin festivos de Colombia) desde el ingreso del equipo; el día de ingreso no cuenta. Cada servicio usa el plazo de su tipo. Vacío = sin plazo."
      className="max-w-4xl"
    >
      {error && (
        <div className="mb-3">
          <Alert tone="red">{error}</Alert>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2 font-semibold">Tipo de servicio</th>
              <th className="px-3 py-2 font-semibold">Plazo (días hábiles)</th>
              <th className="px-3 py-2 text-right font-semibold">Tickets abiertos</th>
              <th className="px-3 py-2 font-semibold">Último cambio</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {plazos.map((p) => {
              const txt = escrito(p);
              const v = leer(txt);
              const mal = 'error' in v;
              const cambiado = !mal && v.dias !== p.dias;
              return (
                <tr key={p.clave}>
                  <td className="px-3 py-2 font-medium text-gray-900">{p.etiqueta}</td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={PLAZO_MIN_DIAS}
                      max={PLAZO_MAX_DIAS}
                      step={1}
                      value={txt}
                      onChange={(e) => setBorrador((b) => ({ ...b, [p.clave]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && cambiado && void guardar(p)}
                      placeholder="sin plazo"
                      aria-label={`Plazo de ${p.etiqueta} en días hábiles`}
                      aria-invalid={mal}
                      className={`block min-h-[44px] w-32 rounded-xl border bg-white px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 ${
                        mal ? 'border-red-400 focus:ring-red-100' : 'border-gray-300 focus:border-blue-400 focus:ring-blue-100'
                      }`}
                    />
                    {mal && <p className="mt-1 text-xs text-red-600">{v.error}</p>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{p.ticketsAbiertos}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {p.actualizadoPor ? (
                      <>
                        {p.actualizadoPor} · {fmtFecha(p.actualizadoEn)}
                      </>
                    ) : (
                      <span className="text-gray-400">{p.dias === null ? 'sin configurar' : 'valor inicial'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button variant="primary" disabled={!cambiado} busy={guardando === p.clave} onClick={() => void guardar(p)}>
                      Guardar
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Los tipos salen de Zoho Desk: si un ticket abierto trae uno nuevo, aparece aquí sin plazo para que se lo pongas. Los plazos no se suman entre sí: un equipo en
        calibración tiene el plazo de «Calibración», no el de diagnóstico más el de calibración.
      </p>
    </Card>
  );
}
