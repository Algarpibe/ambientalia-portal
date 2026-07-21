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

const DEFAULT_COLOR = '#EE7A21';

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
          <h2 className="text-[17px] font-bold tracking-tight text-[#24231F]">Agrupaciones</h2>
          <p className="text-[#6E6B64]">Grupos de categorías (color + orden) para la analítica agregada.</p>
        </div>
        {admin && (
          <button
            type="button"
            onClick={abrirCrear}
            className="st-btn-primary"
          >
            Nueva agrupación
          </button>
        )}
      </div>

      {error && <div className="st-alert err">{error}</div>}

      {admin && form && (
        <form
          onSubmit={(e) => { e.preventDefault(); saveMut.mutate(form); }}
          className="st-card p-5 space-y-4"
        >
          <div className="flex flex-wrap items-end gap-3">
            <label className="st-field">
              Nombre
              <input
                type="text"
                required
                maxLength={100}
                className="st-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="st-field">
              Color
              <input
                type="color"
                className="h-9 w-14 rounded-lg border border-[#E5E2DB]"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
              />
            </label>
          </div>

          <div className="text-sm text-[#6E6B64]">
            <div className="mb-1 font-medium">Categorías ({form.categoryIds.length})</div>
            {categories.length === 0 ? (
              <div className="text-[#6E6B64]">No hay categorías. Crea o importa categorías primero.</div>
            ) : (
              <div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto rounded-2xl border border-[#E5E2DB] p-2 sm:grid-cols-3">
                {categories.map((c) => (
                  <label key={c.id} className="st-check px-1 py-0.5 rounded hover:bg-[#F3F1EC]">
                    <input
                      type="checkbox"
                      checked={form.categoryIds.includes(c.id)}
                      onChange={() => toggleCat(c.id)}
                    />
                    <span
                      className="inline-block h-3 w-3 shrink-0 rounded"
                      style={{ backgroundColor: c.color }}
                    />
                    <span className="truncate text-[#24231F]" title={c.name}>{c.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saveMut.isPending}
              className="st-btn-primary"
            >
              {saveMut.isPending ? 'Guardando…' : form.id ? 'Guardar cambios' : 'Crear'}
            </button>
            <button
              type="button"
              onClick={() => { setForm(null); setError(null); }}
              className="st-btn"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {groupsQ.isLoading ? (
        <div className="text-[#6E6B64]">Cargando…</div>
      ) : groupsQ.error ? (
        <div className="text-red-600">{(groupsQ.error as Error).message}</div>
      ) : groups.length === 0 ? (
        <div className="st-panel p-8 text-center text-[#6E6B64]">
          No hay agrupaciones.
          {admin && <> Usa <span className="font-medium">Nueva agrupación</span> para crear una.</>}
        </div>
      ) : (
        <div className="st-table-wrap">
          <table className="st-table">
            <thead>
              <tr>
                <th className="w-16">Color</th>
                <th>Nombre</th>
                <th>Categorías</th>
                {admin && <th className="num">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => (
                <tr key={g.id}>
                  <td>
                    <span
                      className="inline-block h-4 w-4 rounded"
                      style={{ backgroundColor: g.color || DEFAULT_COLOR }}
                      title={g.color || DEFAULT_COLOR}
                    />
                  </td>
                  <td>{g.name}</td>
                  <td className="text-[#6E6B64]">{g.mappings.length}</td>
                  {admin && (
                    <td className="num">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => mover(i, -1)}
                          disabled={i === 0 || reorderMut.isPending}
                          className="st-btn text-xs px-2 py-1"
                          title="Subir"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => mover(i, 1)}
                          disabled={i === groups.length - 1 || reorderMut.isPending}
                          className="st-btn text-xs px-2 py-1"
                          title="Bajar"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => abrirEditar(g)}
                          className="st-btn text-xs px-2 py-1"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => borrar(g)}
                          disabled={deleteMut.isPending}
                          className="st-btn-danger text-xs px-2 py-1"
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
