import { useEffect, useState } from 'react';
import { api } from '../api';
import { ROLE_LABEL } from '../lib/domain';
import type { CalRole, RoleUser } from '../types';
import { Alert, Card, Loading, Select, TableWrap, TD, TH } from '../ui';

/** Portal admins assign the Calibraciones role (D-016: an admin is not a director by default). */
export default function RolesSection() {
  const [users, setUsers] = useState<RoleUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    api
      .listRoles()
      .then(setUsers)
      .catch((e: Error) => setError(e.message));
  }, []);

  async function change(userId: string, role: CalRole) {
    setSaving(userId);
    setError(null);
    try {
      await api.setRole(userId, role);
      setUsers((us) => us?.map((u) => (u.userId === userId ? { ...u, role } : u)) ?? us);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card title="Roles de Calibraciones">
      <p className="mb-4 text-sm text-gray-600">
        Quien tiene la app sin rol asignado es Lector. Solo el Director Técnico aprueba verificaciones y cambia límites; ser administrador del portal no lo
        convierte en director.
      </p>
      {error && <Alert tone="red">{error}</Alert>}
      {!users && !error && <Loading />}
      {users && users.length === 0 && <p className="text-sm text-gray-500">Nadie tiene la app asignada todavía.</p>}
      {users && users.length > 0 && (
        <TableWrap>
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr>
                <th className={TH}>Persona</th>
                <th className={TH}>Estado</th>
                <th className={TH}>Rol</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId}>
                  <td className={TD}>
                    <span className="font-medium">{u.fullName}</span>
                    <span className="block text-xs text-gray-500">{u.email}</span>
                  </td>
                  <td className={TD}>{u.status}</td>
                  <td className={TD}>
                    <Select
                      aria-label={`Rol de ${u.fullName}`}
                      value={u.role}
                      disabled={saving === u.userId}
                      onChange={(e) => void change(u.userId, e.target.value as CalRole)}
                      className="max-w-[14rem]"
                    >
                      {(Object.keys(ROLE_LABEL) as CalRole[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}
