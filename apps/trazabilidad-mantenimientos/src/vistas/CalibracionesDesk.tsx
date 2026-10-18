import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { ConNocturna, RespuestaPlanCalibraciones } from '../dominio';
import { bloquesDetalle, hayQueTraer, lineasPlan, textoUltima } from '../lib/calibraciones';
import { usePermisos } from '../permisos';
import { Alert, Button, Card, Loading, Modal, Tag } from '../ui';
import { Bloque, LineaNocturna, Lineas } from './MaestroEquipos';

interface Props {
  notificar: (msg: string) => void;
  /** Tras traerlas: el inventario de la app (Resumen, Equipos, Calendario, Avisos) hay que leerlo otra vez. */
  onTraidas: () => void;
}

/**
 * «Calibraciones · Desk 2.0», en Configuración: la fecha de calibración de cada
 * equipo sale del campo «Fecha de Calibración» de los tickets de Desk 2.0, a
 * mano. La ve cualquiera con la app (si Desk 2.0 contesta, la última pasada, el
 * plan en recuentos y el aviso de salud de la lectura); «Traer calibraciones de
 * Desk 2.0» sólo le sale a quien tiene el permiso `calibraciones.write` (Técnico,
 * Director Técnico y administradores del portal), con una confirmación que
 * repite los recuentos y enseña el detalle en bloques. Aquí no se edita ninguna
 * fecha, y nada de esto envía un aviso a nadie.
 */
export default function CalibracionesDesk({ notificar, onTraidas }: Props) {
  const { puede, motivo } = usePermisos();
  const [datos, setDatos] = useState<ConNocturna<RespuestaPlanCalibraciones> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [errorAplicar, setErrorAplicar] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.planCalibraciones());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  const aplicar = async () => {
    if (!datos?.plan) return;
    setAplicando(true);
    setErrorAplicar(null);
    try {
      await api.traerCalibraciones(datos.plan.huella);
      setConfirmar(false);
      notificar('Calibraciones traídas de Desk 2.0');
      onTraidas();
    } catch (e) {
      setErrorAplicar((e as Error).message);
    } finally {
      setAplicando(false);
      // También tras un error: si el plan cambió, que se vea el de ahora.
      await cargar();
    }
  };

  const plan = datos?.plan ?? null;
  const salud = datos?.salud ?? null;
  const lineas = plan ? lineasPlan(plan.recuentos) : [];
  const pendiente = plan !== null && hayQueTraer(plan.recuentos);
  const trae = puede('calibraciones.write');
  const detalle = datos?.detalle ?? [];
  const sinEnsenar = (datos?.detalleTotal ?? 0) - detalle.length;
  const bloques = bloquesDetalle(detalle);

  return (
    <Card
      title="Calibraciones · Desk 2.0"
      hint="La última calibración de cada equipo sale del campo «Fecha de Calibración» de sus tickets en Desk 2.0, sobre el punto de partida de la F-ST-022 congelada. Cada noche a las 02:00 se traen solas si el plan es limpio; si no, quedan retenidas y se traen a mano, después de ver el plan. Aquí no se edita ninguna fecha."
      actions={trae && plan && !salud?.bloquea ? <Button variant="primary" onClick={() => { setErrorAplicar(null); setConfirmar(true); }}>Traer calibraciones de Desk 2.0</Button> : undefined}
    >
      {error && <Alert tone="red">{error}</Alert>}
      {/* Si al aplicar Desk 2.0 dejó de contestar ya no hay plan (ni diálogo): el motivo se dice aquí. */}
      {errorAplicar && !confirmar && <Alert tone="red">{errorAplicar}</Alert>}
      {!datos && !error && <Loading texto="Cargando el plan de las calibraciones…" />}
      {datos && (
        <div className="flex max-w-2xl flex-col gap-3 text-sm">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-gray-900">
            {datos.lectura.disponible ? <Tag tone="blue">Disponible</Tag> : <Tag tone="amber">No disponible</Tag>}
            {datos.lectura.disponible ? 'Desk 2.0 contesta' : 'Las calibraciones de Desk 2.0 no están disponibles'}
          </p>
          {!datos.lectura.disponible && (
            <Alert tone="amber" title="No se pueden traer ahora">
              {datos.lectura.mensaje} Las fechas siguen como estaban y el resto de la app funciona igual.
            </Alert>
          )}
          {salud?.alerta && (
            <Alert tone={salud.bloquea ? 'red' : 'amber'} title="La lectura no trae ninguna fecha">
              {salud.mensaje} Avisa antes de hacer nada.
            </Alert>
          )}
          <p className="text-xs text-gray-500">Última pasada: {datos.ultima ? textoUltima(datos.ultima) : 'todavía ninguna'}</p>
          <LineaNocturna nocturna={datos.nocturna ?? null} />
          {plan && (
            <>
              <h3 className="font-semibold text-gray-900">Plan: qué pasaría al traerlas ahora</h3>
              <Lineas lineas={lineas} />
              <p className="text-xs text-gray-500">
                {pendiente ? 'En azul, lo que cambiaría; en ámbar, lo que conviene mirar antes.' : 'Las calibraciones ya están como en Desk 2.0: traerlas no cambiaría nada.'} Una fecha no se edita nunca: si cambia en Zoho, la fila se anula y entra otra. No se envía ningún
                aviso: sólo cambia la fecha que ven Resumen, Equipos, Calendario y Avisos. {!trae && `Las traen el Técnico y el Director Técnico. ${motivo}`}
              </p>
            </>
          )}
        </div>
      )}
      {confirmar && plan && (
        <Modal
          title="Traer calibraciones de Desk 2.0"
          onClose={() => !aplicando && setConfirmar(false)}
          footer={
            <>
              <Button onClick={() => setConfirmar(false)} disabled={aplicando}>Cancelar</Button>
              <Button variant="primary" onClick={() => void aplicar()} busy={aplicando}>{pendiente ? 'Traer' : 'Confirmar sin cambios'}</Button>
            </>
          }
        >
          <div className="flex flex-col gap-3 text-sm">
            {errorAplicar && <Alert tone="red">{errorAplicar}</Alert>}
            <p>Se aplicará este plan, firmado con tu correo. Cambia la última calibración de {plan.recuentos.equiposCambian} {plan.recuentos.equiposCambian === 1 ? 'equipo' : 'equipos'}; no toca el inventario, el seguimiento ni los contactos, y no envía ningún aviso.</p>
            {/* Lo que hay que mirar antes de traer, lo primero; después los recuentos y, plegado, lo que entra sin más. */}
            {bloques.filter((b) => b.abierto).map((b) => <Bloque key={b.titulo} {...b} />)}
            <Lineas lineas={lineas} />
            {bloques.filter((b) => !b.abierto).map((b) => <Bloque key={b.titulo} {...b} />)}
            {sinEnsenar > 0 && <p className="text-xs text-gray-600">…y {sinEnsenar} líneas más que no caben aquí; quedarán en la auditoría de la pasada.</p>}
          </div>
        </Modal>
      )}
    </Card>
  );
}
