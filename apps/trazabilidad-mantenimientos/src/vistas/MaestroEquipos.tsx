import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { RespuestaCruceFst022, RespuestaPlanMaestro } from '../dominio';
import { hayQueAplicar, lineasPlan, textoCambio, textoUltima, type LineaPlan } from '../lib/maestro';
import { usePermisos } from '../permisos';
import { Alert, Button, Card, Loading, Modal, Tag } from '../ui';

interface Props {
  notificar: (msg: string) => void;
  /** Tras sincronizar: el inventario de la app (Resumen, Equipos, Calendario, Avisos) hay que leerlo otra vez. */
  onSincronizado: () => void;
}

const COLUMNAS_CRUCE = ['Marca', 'En la hoja', 'En Desk 2.0', 'Casan', 'Sólo en la hoja', 'Sólo en Desk 2.0', 'Ambiguos', 'Casarían sin ceros a la izquierda'];

function Lineas({ lineas }: { lineas: LineaPlan[] }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
      {lineas.map((l) => (
        <div key={l.texto} className={`contents ${l.cambia ? 'font-semibold text-blue-900' : ''}`}>
          <dt className={l.cambia ? '' : 'text-gray-600'}>{l.texto}</dt>
          <dd className="text-right font-semibold tabular-nums">{l.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * «Maestro de equipos · Desk 2.0», en Configuración: el inventario de GRIMM EDM
 * 180 se alimenta de los equipos de Desk 2.0, a mano. La ve cualquiera con la
 * app (el plan del cruce en recuentos, la última sincronización y el cruce
 * informativo por marca con la F-ST-022 congelada); «Sincronizar con Desk 2.0»
 * sólo le sale a quien tiene el permiso `maestro.sincronizar` (el Director
 * Técnico y los administradores del portal), con una confirmación que repite
 * los recuentos y enseña los cambios uno a uno. Sin Desk 2.0 no deja aplicar.
 */
export default function MaestroEquipos({ notificar, onSincronizado }: Props) {
  const { puede, motivo } = usePermisos();
  const [datos, setDatos] = useState<RespuestaPlanMaestro | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cruce, setCruce] = useState<RespuestaCruceFst022 | null>(null);
  const [errorCruce, setErrorCruce] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [errorAplicar, setErrorAplicar] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.planMaestro());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  /** El cruce por marca se pide al desplegarlo (una vez): es otra lectura de Desk 2.0. */
  const abrirCruce = (abierto: boolean) => {
    if (!abierto || cruce) return;
    setErrorCruce(null);
    api.cruceMaestro().then(setCruce, (e: Error) => setErrorCruce(e.message));
  };

  const aplicar = async () => {
    if (!datos?.plan) return;
    setAplicando(true);
    setErrorAplicar(null);
    try {
      await api.sincronizarMaestro(datos.plan.huella);
      setConfirmar(false);
      setCruce(null);
      notificar('Inventario sincronizado con Desk 2.0');
      onSincronizado();
    } catch (e) {
      setErrorAplicar((e as Error).message);
    } finally {
      setAplicando(false);
      // También tras un error: si el plan cambió, que se vea el de ahora.
      await cargar();
    }
  };

  const plan = datos?.plan ?? null;
  const lineas = plan ? lineasPlan(plan.recuentos) : [];
  const pendiente = plan !== null && hayQueAplicar(plan.recuentos);
  const sincroniza = puede('maestro.sincronizar');
  const detalle = datos?.detalle ?? [];
  const sinEnsenar = (datos?.detalleTotal ?? 0) - detalle.length;

  return (
    <Card
      title="Maestro de equipos · Desk 2.0"
      hint="El inventario de GRIMM EDM 180 sale de los equipos de Desk 2.0. Se sincroniza a mano, después de ver el plan: no hay sincronización automática. La fecha de calibración no se toca."
      actions={sincroniza && plan ? <Button variant="primary" onClick={() => { setErrorAplicar(null); setConfirmar(true); }}>Sincronizar con Desk 2.0</Button> : undefined}
    >
      {error && <Alert tone="red">{error}</Alert>}
      {/* Si al aplicar el maestro dejó de contestar ya no hay plan (ni diálogo): el motivo se dice aquí. */}
      {errorAplicar && !plan && <Alert tone="red">{errorAplicar}</Alert>}
      {!datos && !error && <Loading texto="Cargando el plan del maestro de equipos…" />}
      {datos && (
        <div className="flex max-w-2xl flex-col gap-3 text-sm">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-gray-900">
            {datos.maestro.disponible ? <Tag tone="blue">Disponible</Tag> : <Tag tone="amber">No disponible</Tag>}
            {datos.maestro.disponible ? 'Desk 2.0 contesta' : 'El maestro de equipos no está disponible'}
          </p>
          {!datos.maestro.disponible && (
            <Alert tone="amber" title="No se puede sincronizar ahora">
              {datos.maestro.mensaje} El inventario sigue como estaba y el resto de la app funciona igual.
            </Alert>
          )}
          <p className="text-xs text-gray-500">Última sincronización: {datos.ultima ? textoUltima(datos.ultima) : 'todavía ninguna'}</p>
          {plan && (
            <>
              <h3 className="font-semibold text-gray-900">Plan: qué pasaría al sincronizar ahora</h3>
              <Lineas lineas={lineas} />
              <p className="text-xs text-gray-500">
                {pendiente ? 'En azul, lo que cambiaría.' : 'El inventario ya está como el maestro: sincronizar no cambiaría nada.'} Lo que sólo está en el portal y los ambiguos no se borran ni se desactivan; el seguimiento y los
                contactos se conservan. {!sincroniza && `Sincroniza el Director Técnico. ${motivo}`}
              </p>
            </>
          )}
          <details className="text-xs text-gray-600" onToggle={(e) => abrirCruce(e.currentTarget.open)}>
            <summary className="cursor-pointer text-sm font-medium text-gray-700">Cruce informativo con la F-ST-022 congelada, por marca</summary>
            {errorCruce && <Alert tone="red">{errorCruce}</Alert>}
            {!cruce && !errorCruce && <Loading texto="Cruzando la hoja congelada con Desk 2.0…" />}
            {cruce && (!cruce.maestro.disponible || !cruce.congelacion) && (
              <p className="mt-2">{cruce.maestro.disponible ? 'Este entorno no tiene ninguna congelación de la F-ST-022 con la que cruzar.' : cruce.maestro.mensaje}</p>
            )}
            {cruce && cruce.marcas.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <p className="mb-2">Todas las marcas, por serial, entre «{cruce.congelacion?.archivo}» y Desk 2.0. Sólo informa: al inventario sólo entran los GRIMM EDM 180.</p>
                <table className="w-full text-left tabular-nums">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-500">
                      {COLUMNAS_CRUCE.map((t, i) => <th key={t} className={`px-2 py-1 font-medium ${i > 0 ? 'text-right' : ''}`}>{t}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {cruce.marcas.map((m) => (
                      <tr key={m.marca} className="border-b border-gray-100">
                        <td className="px-2 py-1 font-medium text-gray-800">{m.marca}</td>
                        {[m.v3, m.desk, m.casan, m.soloV3, m.soloDesk, m.ambiguos, m.sinCeros].map((n, i) => <td key={i} className="px-2 py-1 text-right">{n}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>
        </div>
      )}
      {confirmar && plan && (
        <Modal
          title="Sincronizar con Desk 2.0"
          onClose={() => !aplicando && setConfirmar(false)}
          footer={
            <>
              <Button onClick={() => setConfirmar(false)} disabled={aplicando}>Cancelar</Button>
              <Button variant="primary" onClick={() => void aplicar()} busy={aplicando}>{pendiente ? 'Sincronizar' : 'Confirmar sin cambios'}</Button>
            </>
          }
        >
          <div className="flex flex-col gap-3 text-sm">
            {errorAplicar && <Alert tone="red">{errorAplicar}</Alert>}
            <p>Se aplicará este plan al inventario de GRIMM EDM 180, firmado con tu correo. La fecha de calibración, el seguimiento y los contactos no se tocan, y no se borra ningún equipo.</p>
            <Lineas lineas={lineas} />
            {detalle.length > 0 && (
              <details open className="text-xs text-gray-700">
                <summary className="cursor-pointer text-sm font-medium text-gray-700">Los {datos?.detalleTotal} cambios, uno a uno</summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {detalle.map((c) => <li key={`${c.clave}-${c.campo}`}><span className="font-mono font-semibold">{c.clave}</span> · {textoCambio(c)}</li>)}
                </ul>
                {sinEnsenar > 0 && <p className="mt-2">…y {sinEnsenar} más, que quedarán en la auditoría.</p>}
              </details>
            )}
          </div>
        </Modal>
      )}
    </Card>
  );
}
