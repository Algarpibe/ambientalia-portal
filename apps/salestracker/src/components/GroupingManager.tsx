import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchCategoryGroups,
  createCategoryGroup,
  updateCategoryGroup,
  deleteCategoryGroup,
  reorderCategoryGroups,
  type Category,
  type CategoryGroup,
} from '../api';

const DEFAULT_COLOR = '#6366f1';

interface GroupFormState {
  id: string | null; // null → crear; string → editar
  name: string;
  color: string;
  categoryIds: string[];
}

const emptyForm: GroupFormState = { id: null, name: '', color: DEFAULT_COLOR, categoryIds: [] };

interface Props {
  admin: boolean;
  categories: Category[];
}

export default function GroupingManager({ admin, categories }: Props) {
  const qc = useQueryClient();
  const groupsQ = useQuery({ queryKey: ['st-groups'], queryFn: fetchCategoryGroups });

  const [form, setForm] = useState<GroupFormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['st-groups'] });
  const onError = (e: unknown) => setError((e as Error).message);

  const saveMut = useMutation({
    mutationFn: (f: GroupFormState) => {
      const payload = { name: f.name.trim(), categoryIds: f.categoryIds, color: f.color };
      return f.id ? updateCategoryGroup(f.id, payload) : createCategoryGroup(payload);
    },
    onSuccess: () => { setError(null); setForm(null); void invalidate(); },
    onError,
  });

  const deleteMut = useMutation({
    mutationFn: deleteCategoryGroup,
    onSuccess: () => { setError(null); void invalidate(); },
    onError,
  });

  const reorderMut = useMutation({
    mutationFn: reorderCategoryGroups,
    onSuccess: () => { setError(null); void invalidate(); },
    onError,
  });

  const groups = groupsQ.data ?? [];

  const abrirCrear = () => { setError(null); setForm({ ...emptyForm, categoryIds: [] }); };
  const abrirEditar = (g: CategoryGroup) => {
    setError(null);
    setForm({ id: g.id, name: g.name, color: g.color || DEFAULT_COLOR, categoryIds: g.mappings.map((m) => m.category_id) });
  };
  const borrar = (g: CategoryGroup) => {
    if (window.confirm(`¿Borrar la agrupación "${g.name}"?`)) deleteMut.mutate(g.id);
  };

  const mover = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= groups.length) return;
    const ids = groups.map((g) => g.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorderMut.mutate(ids);
  };

  const toggleCat = (catId: string) => {
    if (!form) return;
    const has = form.categoryIds.includes(catId);
    setForm({
      ...form,
      categoryIds: has ? form.categoryIds.filter((x) => x !== catId) : [...form.categoryIds, catId],
    });
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Agrupaciones</h2>
          <p className="text-gray-500">Grupos de categorías (color + orden) para la analítica agregada.</p>
        </div>
        {admin && (
          <button
            type="button"
            onClick={abrirCrear}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Nueva agrupación
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {admin && form && (
        <form
          onSubmit={(e) => { e.preventDefault(); saveMut.mutate(form); }}
          className="space-y-4 rounded-xl border bg-white p-4"
        >
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-sm text-gray-600">
              Nombre
              <input
                type="text"
                required
                maxLength={100}
                className="mt-1 rounded-md border px-2 py-1.5 text-gray-900"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="flex flex-col text-sm text-gray-600">
              Color
              <input
                type="color"
                className="mt-1 h-9 w-16 rounded-md border"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
              />
            </label>
          </div>

          <div className="text-sm text-gray-600">
            <div className="mb-1 font-medium">Categorías ({form.categoryIds.length})</div>
            {categories.length === 0 ? (
              <div className="text-gray-500">No hay categorías. Crea o importa categorías primero.</div>
            ) : (
              <div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-3">
                {categories.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={form.categoryIds.includes(c.id)}
                      onChange={() => toggleCat(c.id)}
                    />
                    <span
                      className="inline-block h-3 w-3 shrink-0 rounded"
                      style={{ backgroundColor: c.color }}
                    />
                    <span className="truncate text-gray-900" title={c.name}>{c.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saveMut.isPending}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saveMut.isPending ? 'Guardando…' : form.id ? 'Guardar cambios' : 'Crear'}
            </button>
            <button
              type="button"
              onClick={() => { setForm(null); setError(null); }}
              className="rounded-md border px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {groupsQ.isLoading ? (
        <div className="text-gray-600">Cargando…</div>
      ) : groupsQ.error ? (
        <div className="text-red-600">{(groupsQ.error as Error).message}</div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border bg-white p-8 text-center text-gray-500">
          No hay agrupaciones.
          {admin && <> Usa <span className="font-medium">Nueva agrupación</span> para crear una.</>}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="w-16 px-3 py-2 text-left">Color</th>
                <th className="px-3 py-2 text-left">Nombre</th>
                <th className="px-3 py-2 text-left">Categorías</th>
                {admin && <th className="px-3 py-2 text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => (
                <tr key={g.id} className="border-t">
                  <td className="px-3 py-2">
                    <span
                      className="inline-block h-4 w-4 rounded"
                      style={{ backgroundColor: g.color || DEFAULT_COLOR }}
                      title={g.color || DEFAULT_COLOR}
                    />
                  </td>
                  <td className="px-3 py-2 text-gray-900">{g.name}</td>
                  <td className="px-3 py-2 text-gray-600">{g.mappings.length}</td>
                  {admin && (
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => mover(i, -1)}
                          disabled={i === 0 || reorderMut.isPending}
                          className="rounded-md border px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-30"
                          title="Subir"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => mover(i, 1)}
                          disabled={i === groups.length - 1 || reorderMut.isPending}
                          className="rounded-md border px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-30"
                          title="Bajar"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => abrirEditar(g)}
                          className="rounded-md border px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => borrar(g)}
                          disabled={deleteMut.isPending}
                          className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Borrar
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
