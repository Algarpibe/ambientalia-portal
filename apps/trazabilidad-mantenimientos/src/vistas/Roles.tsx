import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { ETIQUETA_ROL_APP, ROLES_APP, esRolApp, type RolApp, type UsuarioRol } from '../dominio';
import { Alert, Card, DESACTIVADO, Loading, Tag } from '../ui';

interface Props {
  notificar: (msg: string) => void;
}

/** Lo que puede cada rol, en una línea. La regla de verdad es la matriz de roles.ts (hub-api). */
const PUEDE: Record<RolApp, string> = {
  LECTOR: 'Lo ve todo y no cambia nada. Es el rol de quien tiene la app y no tiene otro asignado.',
  COMERCIAL: 'Seguimiento de los equipos, avisos manuales (marcar como avisado) y contacto de cada cliente para los avisos.',
  TECNICO: 'Seguimiento de los equipos y tipo de servicio puesto a mano en un ticket.',
  DIRECTOR_TECNICO: 'Todo lo de Comercial y lo de Técnico, más importar la F-ST-022, toda la Configuración y, cuando llegue, la agenda del taller.',
};

const ESTADO: Record<string, string> = { active: 'activo', pending: 'pendiente', inactive: 'inactivo' };

/**
 * Sección «Roles» (sólo administradores del portal): la gente con la app y un
 * desplegable con su rol, que guarda al momento y queda firmado. El servidor
 * vuelve a comprobar que quien lo cambia es administrador.
 */
export default function Roles({ notificar }: Props) {
  const [usuarios, setUsuarios] = useState<UsuarioRol[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Usuario cuyo rol se está guardando. Mientras dura, ningún desplegable admite otro cambio. */
  const [guardando, setGuardando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setUsuarios((await api.roles()).usuarios);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const cambiar = async (u: UsuarioRol, role: RolApp) => {
    if (role === u.role) return;
    setGuardando(u.userId);
    try {
      const r = await api.guardarRol(u.userId, role);
      setUsuarios((us) => us?.map((x) => (x.userId === r.userId ? { ...x, role: r.role } : x)) ?? us);
      setError(null);
      notificar(`${u.fullName}: ${ETIQUETA_ROL_APP[r.role]}`);
    } catch (e) {
      setError(`No se pudo guardar el rol de ${u.fullName}: ${(e as Error).message}`);
    } finally {
      setGuardando(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card title="Roles de Trazabilidad" hint="Quién puede cambiar qué en esta app. Leer está abierto a cualquiera que la tenga asignada." className="max-w-4xl">
        {error && (
          <div className="mb-3">
            <Alert tone="red">{error}</Alert>
          </div>
        )}
        {!usuarios ? (
          !error && <Loading texto="Cargando los roles…" />
        ) : usuarios.length === 0 ? (
          <p className="text-sm text-gray-500">Nadie tiene la app asignada todavía.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2 font-semibold">Persona</th>
                  <th className="px-3 py-2 font-semibold">Estado</th>
                  <th className="px-3 py-2 font-semibold">Rol en la app</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {usuarios.map((u) => (
                  <tr key={u.userId}>
                    <td className="px-3 py-2">
                      <span className="font-medium text-gray-900">{u.fullName}</span>
                      <span className="block text-xs text-gray-500">{u.email}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{ESTADO[u.status] ?? u.status}</td>
                    <td className="px-3 py-1">
                      {/* Un administrador del portal no lleva rol en la app: lo puede todo. Sólo lectura, sin desplegable (el servidor tampoco lo aceptaría). */}
                      {u.admin ? (
                        <span className="inline-flex min-h-[44px] items-center gap-2" title="Administrador del portal: tiene todos los permisos de la app y reparte los roles. No lleva rol.">
                          <Tag tone="blue">Admin del portal</Tag>
                          <span className="text-xs text-gray-500">todos los permisos</span>
                        </span>
                      ) : (
                      <span className="inline-flex min-h-[44px] items-center gap-2">
                        <select
                          value={u.role}
                          disabled={guardando !== null}
                          aria-busy={guardando === u.userId}
                          aria-label={`Rol de ${u.fullName}`}
                          title={PUEDE[u.role]}
                          onChange={(ev) => {
                            const role = ev.target.value;
                            if (esRolApp(role)) void cambiar(u, role);
                          }}
                          className={`min-h-[36px] w-[190px] rounded-xl border bg-white px-2 py-1 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 ${DESACTIVADO} ${
                            u.role === 'LECTOR' ? 'border-gray-300 text-gray-500' : 'border-gray-400 font-medium text-gray-900'
                          }`}
                        >
                          {ROLES_APP.map((r) => (
                            <option key={r} value={r} title={PUEDE[r]}>
                              {ETIQUETA_ROL_APP[r]}
                            </option>
                          ))}
                        </select>
                        {guardando === u.userId && (
                          <span className="text-xs text-gray-500" role="status">
                            guardando…
                          </span>
                        )}
                      </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-gray-500">
          Salen quienes tienen la app asignada, quienes ya tienen un rol y los administradores del portal. El desplegable guarda al momento. Un administrador del portal lo
          puede todo y no lleva rol en la app: sale como «Admin del portal», sin desplegable. Sólo un administrador reparte roles.
        </p>
      </Card>

      <Card title="Qué puede cada rol" className="max-w-4xl">
        <dl className="flex flex-col gap-2 text-sm">
          {ROLES_APP.map((r) => (
            <div key={r} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
              <dt className="w-40 shrink-0 font-semibold text-gray-900">{ETIQUETA_ROL_APP[r]}</dt>
              <dd className="text-gray-600">{PUEDE[r]}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
