// «Mis equipos»: vista de solo lectura, pensada para el celular, de los equipos de un técnico. Reutiliza el
// sondeo y el modelo del tablero (no duplica reglas). Solo lo suyo (D4): las visitas que el portal asignó a su
// cuenta (`userId`) y las que tienen como Encargado de Desk el ÚNICO nombre del tablero que casa con el suyo. Los
// dos datos los da el portal. Sin coincidencia única no se pregunta nada: la vía es asignarle sus equipos desde la tabla.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { inicialesDe, type ColumnaTablero, type Tarjeta } from './nucleo';
import { apiEquipos } from './api';
import { Raiz, SinTablero, hhmm, useTableroDatos } from './tablero/Tablero';
import EscanearSerial from './EscanearSerial';
import { coincideTecnico, esMia, tecnicosDelTablero } from './tecnico';
import './tablero/tablero.css';
import './tablero/mis-equipos.css';

/** Donde antes se recordaba en el dispositivo el nombre elegido en «¿Quién eres?». Ya no se lee: se borra al abrir. */
export const CLAVE_TECNICO = 'equipos-taller:mis-equipos:tecnico';

// Sin esto, un nombre recordado de otra persona seguiría a la vista. El almacenamiento local puede no existir
// (modo privado, política del navegador): nunca rompe la vista.
const olvidarNombreRecordado = () => { try { localStorage.removeItem(CLAVE_TECNICO); } catch { /* sin almacenamiento: nada que borrar */ } };

export function Ficha({ t }: { t: Tarjeta }) {
  return (
    <article className="tt-tarjeta" aria-label={`Equipo ${t.sn}`}>
      <div className="tt-tarjeta-cab">
        <span className="tt-sn tt-mono">{t.sn}</span>
        <span className={`tt-dias-suave tt-dias-suave-${t.tono}`}>{`${t.dias} d`}</span>
      </div>
      <div className="tt-equipo">{t.equipo}</div>
      <div className="tt-cliente">{t.ticket ? `${t.cliente} · #${t.ticket}` : t.cliente}</div>
      {t.etiquetas.length ? <div className="tt-etiquetas">{t.etiquetas.map((e) => <span key={e.tipo + e.texto} className="tt-etiqueta">{e.texto}</span>)}</div> : null}
    </article>
  );
}

function Grupo({ col }: { col: ColumnaTablero }) {
  return (
    <section className={`tt-mis-grupo tt-col-${col.id}`} aria-label={col.nombre}>
      <div className="tt-col-cab">
        <span className="tt-punto" aria-hidden />
        <h3 className="tt-col-nombre">{col.nombre}</h3>
        <span className="tt-cuenta" aria-label={`Total ${col.tarjetas.length}`}>{col.tarjetas.length}</span>
      </div>
      {col.tarjetas.map((t) => <Ficha key={t.clave} t={t} />)}
    </section>
  );
}

export default function MisEquipos({ nombre, userId = null, pedir: pedirProp }: {
  nombre: string | null;
  /** La cuenta del usuario: reconoce las visitas que el portal le asignó aunque su nombre no coincida. */
  userId?: string | null;
  pedir?: (s: AbortSignal) => ReturnType<ReturnType<typeof apiEquipos>['estado']>;
}) {
  const pedirSesion = useMemo(() => apiEquipos().estado, []);
  const pedir = useCallback((s: AbortSignal) => (pedirProp ?? pedirSesion)(s), [pedirProp, pedirSesion]);
  const { datos, modelo, ajustes, okEn, fallo, obsoleto } = useTableroDatos(pedir);
  const [escaneando, setEscaneando] = useState(false);
  useEffect(olvidarNombreRecordado, []);
  if (!modelo) return <SinTablero tema="sistema" hayDatos={!!datos} fallo={fallo} />;

  // El único nombre de Desk que casa con el del usuario; si casan varios, o ninguno, null.
  const coinciden = nombre ? tecnicosDelTablero(modelo).filter((n) => coincideTecnico(nombre, n)) : [];
  const reconocido = coinciden.length === 1 ? coinciden[0] : null;
  const grupos = modelo.columnas
    .map((c) => ({ ...c, tarjetas: c.tarjetas.filter((t) => esMia(t, { userId, nombre: reconocido })) }))
    .filter((c) => c.tarjetas.length > 0);
  const todas = grupos.flatMap((g) => g.tarjetas);
  // La cabecera es del usuario aunque no tenga equipos: su nombre del portal y sus iniciales con la regla de las
  // tarjetas. El color, el de su primera tarjeta (como en el tablero); sin tarjetas, el neutro.
  const color = todas[0]?.tecnico?.avatar;
  const iniciales = nombre ? inicialesDe(nombre) : '';
  const kpis = [
    { e: 'Asignados', v: todas.length },
    { e: 'Esperan cliente', v: grupos.filter((g) => g.id === 'notificacion').reduce((s, g) => s + g.tarjetas.length, 0) },
    { e: `Más de ${ajustes.umbralRojo} d`, v: todas.filter((t) => t.dias > ajustes.umbralRojo).length },
  ];

  return (
    <Raiz tema="sistema" clase="tt-mis">
      <header className="tt-mis-cab">
        <span className={`tt-av tt-av-grande ${color !== undefined ? `tt-av-${color}` : 'tt-av-neutro'}`} aria-hidden>{iniciales || '–'}</span>
        <div className="tt-mis-id">
          <p>Mis equipos</p>
          <h1>{nombre ?? ''}</h1>
        </div>
      </header>
      {obsoleto && okEn !== null ? <p role="alert" className="tt-aviso">{`Datos desactualizados desde ${hhmm(okEn)}`}</p> : null}
      <ul className="tt-mis-kpis" aria-label="Indicadores">
        {kpis.map((k) => <li key={k.e} className="tt-kpi"><span className="tt-kpi-n">{k.v}</span><span className="tt-kpi-e">{k.e}</span></li>)}
      </ul>
      {todas.length === 0 ? <p className="tt-mensaje">No tienes equipos asignados. Si falta alguno, pide que te lo asignen desde la tabla.</p> : null}
      {escaneando ? <EscanearSerial tarjetas={modelo.columnas.flatMap((c) => c.tarjetas)} onCerrar={() => setEscaneando(false)} mostrar={(t) => <Ficha key={t.clave} t={t} />} /> : null}
      {grupos.map((g) => <Grupo key={g.id} col={g} />)}
      <nav className="tt-mis-barra" aria-label="Taller">
        <button type="button" className="tt-mis-boton" onClick={() => setEscaneando(true)}>Escanear S/N</button>
        <a className="tt-mis-boton" href="/equipos-taller?vista=tablero">Ver taller completo</a>
      </nav>
    </Raiz>
  );
}
