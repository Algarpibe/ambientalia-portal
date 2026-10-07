import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardList, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { api, type Inventario } from './api';
import type { EstadoCalibracion, MiRol } from './dominio';
import { GRUPOS, SIN_ROL, etiquetaMiRol, grupoDe, motivoSinPermiso, primeraSeccion, seccionDeHash, seccionesDe, tiene, type Seccion } from './lib/navegacion';
import { fmtFecha } from './lib/vistas';
import { PermisosContext } from './permisos';
import { Alert, Button, Loading } from './ui';
import Resumen from './vistas/Resumen';
import Equipos, { FILTRO_VACIO, type Filtro } from './vistas/Equipos';
import Calendario from './vistas/Calendario';
import Avisos from './vistas/Avisos';
import FichaEquipo from './vistas/FichaEquipo';
import Importar from './vistas/Importar';
import Servicios from './vistas/Servicios';
import Configuracion from './vistas/Configuracion';
import Roles from './vistas/Roles';

/**
 * Trazabilidad Mantenimientos Clientes: vencimientos de calibración de los
 * GRIMM EDM 180 de los clientes (hoja F-ST-022), para avisarles antes de que
 * se les venza y programar el servicio.
 *
 * Además, «Servicios» sigue los tickets abiertos en Zoho Desk (de cualquier
 * marca) contra el plazo de su tipo de servicio, que se fija en «Configuración».
 *
 * Navegación en dos niveles (`lib/navegacion.ts`): arriba los grupos
 * («Clientes y calibraciones», «Taller», «Administración») y debajo las
 * secciones del grupo. Las secciones van por hash (#resumen, #equipos,
 * #calendario, #avisos, #servicios, #configuracion, #roles), igual que el
 * resto de apps del portal: el router del portal sólo ve
 * /trazabilidad-mantenimientos/*.
 *
 * Roles: al entrar se pide /roles/me y con sus `permissions` se oculta o se
 * desactiva lo que el rol no permite (`PermisosContext`). Es sólo comodidad:
 * quien cambia algo sin permiso recibe un 403 del servidor.
 */
const tabDeHash = (): Seccion => seccionDeHash(window.location.hash);

const NAV_GRUPO = 'min-h-[44px] whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition-colors';
const NAV_SECCION = '-mb-px min-h-[44px] whitespace-nowrap border-b-2 px-4 py-2 text-sm transition-colors';

export default function App() {
  const [inv, setInv] = useState<Inventario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  /** Quién soy en la app. `null` mientras no ha llegado /roles/me: entre tanto, como un Lector. */
  const [yo, setYo] = useState<MiRol | null>(null);
  const [errorRol, setErrorRol] = useState<string | null>(null);
  const [tab, setTab] = useState<Seccion>(tabDeHash);
  const [filtro, setFiltro] = useState<Filtro>(FILTRO_VACIO);
  const [calMes, setCalMes] = useState<{ anio: number; mes: number } | null>(null);
  const [ficha, setFicha] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const avisoTimer = useRef<number | undefined>(undefined);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setInv(await api.inventario());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    api
      .yo()
      .then((r) => {
        setYo(r);
        setErrorRol(null);
      })
      .catch((e: Error) => setErrorRol(e.message));
  }, []);

  useEffect(() => {
    const onHash = () => setTab(tabDeHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const irA = useCallback((t: Seccion) => {
    window.history.pushState(null, '', `#${t}`);
    setTab(t);
    window.scrollTo({ top: 0 });
  }, []);

  const notificar = useCallback((msg: string) => {
    setAviso(msg);
    window.clearTimeout(avisoTimer.current);
    avisoTimer.current = window.setTimeout(() => setAviso(null), 3000);
  }, []);

  const verEquipos = useCallback(
    (f: Partial<Filtro>) => {
      setFiltro({ ...FILTRO_VACIO, ...f });
      irA('equipos');
    },
    [irA],
  );
  const verEstados = useCallback((estados: EstadoCalibracion[]) => verEquipos({ estados }), [verEquipos]);
  const verMes = useCallback(
    (anio: number, mes: number) => {
      setCalMes({ anio, mes });
      irA('calendario');
    },
    [irA],
  );

  const equipos = inv?.equipos ?? [];
  const equipoFicha = ficha ? equipos.find((e) => e.clave === ficha) ?? null : null;
  const ult = inv?.ultimaImportacion;
  const grupo = grupoDe(tab);
  /** Las secciones de «Clientes y calibraciones» pintan el inventario de la F-ST-022; las demás, no. */
  const deInventario = grupo === 'clientes';
  const gestionaRoles = yo?.canManageRoles ?? false;
  const puedeImportar = tiene(yo, 'importar');
  const secciones = seccionesDe(grupo, gestionaRoles);

  return (
    <PermisosContext.Provider value={yo ?? SIN_ROL}>
      <main className="min-w-0 flex-grow bg-transparent p-4 sm:p-6">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-4">
          <div className="flex items-center gap-3">
            <ClipboardList className="h-7 w-7 text-blue-600" aria-hidden />
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Trazabilidad Mantenimientos Clientes</h1>
              <p className="max-w-2xl text-sm text-gray-500">
                GRIMM EDM 180 · vigencia de calibración de 365 días · hoy {fmtFecha(inv?.hoy)}
                {ult && (
                  <>
                    {' '}
                    · importado el {fmtFecha(ult.en)} desde «{ult.archivo}» por {ult.por}
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {yo && (
              <span
                className="inline-flex min-h-[32px] items-center gap-1.5 whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"
                title={yo.permissions.length === 0 ? motivoSinPermiso(yo) : `Tu rol en esta app. Lo asigna un administrador del portal en «Administración» → «Roles».`}
              >
                Tu rol: <strong className="font-semibold text-gray-900">{etiquetaMiRol(yo)}</strong>
              </span>
            )}
            {deInventario && (
              <Button variant="ghost" onClick={() => void cargar()} busy={cargando} aria-label="Actualizar">
                {!cargando && <RefreshCw className="h-4 w-4" aria-hidden />} Actualizar
              </Button>
            )}
            {puedeImportar && (
              <Button variant="primary" onClick={() => setImportando(true)}>
                <FileSpreadsheet className="h-4 w-4" aria-hidden /> Importar F-ST-022
              </Button>
            )}
          </div>
        </header>

        {errorRol && (
          <div className="mb-4">
            <Alert tone="amber" title="No se pudo comprobar tu rol">
              {errorRol} Mientras tanto la app se muestra en modo de consulta.
            </Alert>
          </div>
        )}

        <nav aria-label="Áreas" className="mb-2 flex gap-1 overflow-x-auto">
          {GRUPOS.map((g) => (
            <button
              key={g.id}
              type="button"
              aria-current={grupo === g.id ? 'true' : undefined}
              onClick={() => irA(primeraSeccion(g.id))}
              className={`${NAV_GRUPO} ${grupo === g.id ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}
            >
              {g.label}
            </button>
          ))}
        </nav>
        <nav aria-label={`Secciones de ${GRUPOS.find((g) => g.id === grupo)?.label ?? ''}`} className="mb-5 flex gap-1 overflow-x-auto border-b border-gray-200">
          {secciones.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => irA(t.id)}
              className={`${NAV_SECCION} ${tab === t.id ? 'border-blue-500 font-semibold text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* Servicios, Configuración y Roles cargan lo suyo: funcionan aunque no haya inventario importado. */}
        {tab === 'servicios' && <Servicios onConfigurar={() => irA('configuracion')} notificar={notificar} />}
        {tab === 'configuracion' && <Configuracion notificar={notificar} />}
        {/* #roles escrito a mano por quien no es administrador: se le dice, y el servidor tampoco le daría la lista. */}
        {tab === 'roles' && !yo && !errorRol && <Loading texto="Comprobando tu rol…" />}
        {tab === 'roles' && (yo || errorRol) && !gestionaRoles && <Alert tone="amber">Sólo un administrador del portal puede ver y repartir los roles de Trazabilidad.</Alert>}
        {tab === 'roles' && gestionaRoles && <Roles notificar={notificar} />}

        {deInventario && error && (
          <div className="mb-4">
            <Alert tone="red">{error}</Alert>
          </div>
        )}
        {deInventario && !inv && !error && <Loading texto="Cargando el inventario de GRIMM EDM 180…" />}

        {deInventario && inv && equipos.length === 0 && (
          <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center shadow-sm">
            <FileSpreadsheet className="mx-auto mb-3 h-10 w-10 text-gray-300" aria-hidden />
            <p className="mb-1 font-semibold text-gray-800">Todavía no hay equipos cargados</p>
            {puedeImportar ? (
              <>
                <p className="mx-auto mb-4 max-w-md text-sm text-gray-500">
                  Importa la hoja F-ST-022 «Trazabilidad Mttos Clientes» para ver los GRIMM EDM 180, sus vencimientos de calibración y el calendario.
                </p>
                <Button variant="primary" onClick={() => setImportando(true)}>
                  Importar F-ST-022
                </Button>
              </>
            ) : (
              <p className="mx-auto max-w-md text-sm text-gray-500">
                Cuando el Director Técnico importe la hoja F-ST-022 «Trazabilidad Mttos Clientes» verás aquí los GRIMM EDM 180, sus vencimientos de calibración y el calendario.
              </p>
            )}
          </div>
        )}

        {deInventario && inv && equipos.length > 0 && (
          <>
            {tab === 'resumen' && (
              <Resumen equipos={equipos} hoy={inv.hoy} onEstados={verEstados} onCliente={(cliente) => verEquipos({ cliente })} onEnCasa={() => verEquipos({ enAmbientalia: true })} onMes={verMes} onAvisos={() => irA('avisos')} onFicha={setFicha} />
            )}
            {tab === 'equipos' && <Equipos equipos={equipos} filtro={filtro} onFiltro={setFiltro} onFicha={setFicha} />}
            {tab === 'calendario' && <Calendario equipos={equipos} hoy={inv.hoy} mes={calMes} onMes={setCalMes} onFicha={setFicha} />}
            {tab === 'avisos' && <Avisos equipos={equipos} hoy={inv.hoy} contactos={inv.contactos ?? []} onFicha={setFicha} onCambio={cargar} onInventario={setInv} notificar={notificar} />}
          </>
        )}

        {equipoFicha && <FichaEquipo equipo={equipoFicha} onClose={() => setFicha(null)} onGuardado={async () => { await cargar(); notificar('Seguimiento guardado'); }} />}
        {importando && puedeImportar && (
          <Importar
            onClose={() => setImportando(false)}
            onHecho={async (n) => {
              setImportando(false);
              await cargar();
              notificar(`Importación aplicada: ${n} equipos`);
            }}
          />
        )}
        {aviso && (
          <div role="status" className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-xl bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
            {aviso}
          </div>
        )}
      </main>
    </PermisosContext.Provider>
  );
}
