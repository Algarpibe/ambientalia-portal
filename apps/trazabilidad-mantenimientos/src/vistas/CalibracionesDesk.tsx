import { useEffect, useState } from 'react';
import { api } from '../api';
import type { RespuestaPlanCalibraciones } from '../dominio';
import { hayQueTraer, lineasPlan, textoUltima } from '../lib/calibraciones';
import { Alert, Card, Loading, Tag } from '../ui';
import { Lineas } from './MaestroEquipos';

/**
 * «Calibraciones · Desk 2.0», en Configuración: la fecha de calibración de cada
 * equipo saldrá del campo «Fecha de Calibración» de los tickets de Desk 2.0.
 * Lote 9c-1: SÓLO LECTURA, para cualquiera con la app: si Desk 2.0 contesta, la
 * última pasada, el plan en recuentos (qué pasaría al traerlas) y el aviso de
 * salud de la lectura. Todavía no hay botón: traerlas es del lote 9c-2. Nada de
 * esto cambia una fecha ni envía un aviso a nadie.
 */
export default function CalibracionesDesk() {
  const [datos, setDatos] = useState<RespuestaPlanCalibraciones | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.planCalibraciones().then(setDatos, (e: Error) => setError(e.message));
  }, []);

  const plan = datos?.plan ?? null;
  const salud = datos?.salud ?? null;

  return (
    <Card
      title="Calibraciones · Desk 2.0"
      hint="La última calibración de cada equipo saldrá del campo «Fecha de Calibración» de sus tickets en Desk 2.0, sobre el punto de partida de la F-ST-022 congelada. De momento sólo se ve el plan: todavía no se traen, y las fechas de la app siguen como estaban."
    >
      {error && <Alert tone="red">{error}</Alert>}
      {!datos && !error && <Loading texto="Cargando el plan de las calibraciones…" />}
      {datos && (
        <div className="flex max-w-2xl flex-col gap-3 text-sm">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-gray-900">
            {datos.lectura.disponible ? <Tag tone="blue">Disponible</Tag> : <Tag tone="amber">No disponible</Tag>}
            {datos.lectura.disponible ? 'Desk 2.0 contesta' : 'Las calibraciones de Desk 2.0 no están disponibles'}
          </p>
          {!datos.lectura.disponible && (
            <Alert tone="amber" title="No se pueden leer ahora">
              {datos.lectura.mensaje} Las fechas siguen como estaban y el resto de la app funciona igual.
            </Alert>
          )}
          {salud?.alerta && (
            <Alert tone={salud.bloquea ? 'red' : 'amber'} title="La lectura no trae ninguna fecha">
              {salud.mensaje} Avisa antes de hacer nada.
            </Alert>
          )}
          <p className="text-xs text-gray-500">Última pasada: {datos.ultima ? textoUltima(datos.ultima) : 'todavía ninguna'}</p>
          {plan && (
            <>
              <h3 className="font-semibold text-gray-900">Plan: qué pasaría al traerlas ahora</h3>
              <Lineas lineas={lineasPlan(plan.recuentos)} />
              <p className="text-xs text-gray-500">
                {hayQueTraer(plan.recuentos) ? 'En azul, lo que cambiaría; en ámbar, lo que conviene mirar antes.' : 'Las calibraciones ya están como en Desk 2.0: traerlas no cambiaría nada.'} Una fecha no se editará nunca: si cambia en Zoho, la fila se anula y entra otra. Es sólo el plan:
                todavía no se puede traer nada desde aquí, y no se envía ningún aviso.
              </p>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
