import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  esAdmin,
  fetchCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  importCategories,
  type Category,
} from '../api';
import GroupingManager from '../components/GroupingManager';

const DEFAULT_COLOR = '#EE7A21';

interface FormState {
  id: string | null; // null → crear; string → editar
  name: string;
  description: string;
  color: string;
}

const emptyForm: FormState = { id: null, name: '', description: '', color: DEFAULT_COLOR };

export default function Categorias() {
  const admin = esAdmin();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['st-categories'], queryFn: fetchCategories });

  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['st-categories'] });
  const onError = (e: unknown) => { setError((e as Error).message); setAviso(null); };

  const importMut = useMutation({
    mutationFn: importCategories,
    onSuccess: (added) => {
      setError(null);
      setAviso(added > 0 ? `${added} categoría(s) añadida(s) del hub.` : 'No había categorías nuevas en el hub.');
      void invalidate();
    },
    onError,
  });

  const saveMut = useMutation({
    mutationFn: (f: FormState) => {
      const description = f.description.trim() === '' ? undefined : f.description.trim();
      return f.id
        ? updateCategory(f.id, { name: f.name.trim(), description: description ?? null, color: f.color })
        : createCategory({ name: f.name.trim(), description, color: f.color });
    },
    onSuccess: () => {
      setError(null);
      setAviso(null);
      setForm(null);
      void invalidate();
    },
    onError,
  });

  const deleteMut = useMutation({
    mutationFn: deleteCategory,
    onSuccess: () => { setError(null); void invalidate(); },
    onError,
  });

  const abrirCrear = () => { setError(null); setAviso(null); setForm({ ...emptyForm }); };
  const abrirEditar = (c: Category) => {
    setError(null);
    setAviso(null);
    setForm({ id: c.id, name: c.name, description: c.description ?? '', color: c.color || DEFAULT_COLOR });
  };
  const borrar = (c: Category) => {
    if (window.confirm(`¿Borrar la categoría "${c.name}"?`)) deleteMut.mutate(c.id);
  };

  const cats = q.data ?? [];

  return (
    <div className="st-page">
      <div className="st-grain" />
      <div className="st-wrap px-6 md:px-8 py-8 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[26px] font-extrabold tracking-tight text-[#24231F]">Categorías</h1>
            <p className="text-[#6E6B64]">Gestión de categorías de salestracker (nombre, descripción, color).</p>
          </div>
          {admin && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => importMut.mutate()}
                disabled={importMut.isPending}
                className="st-btn"
              >
                {importMut.isPending ? 'Importando…' : 'Importar del hub'}
              </button>
              <button
                type="button"
                onClick={abrirCrear}
                className="st-btn-primary"
              >
                Nueva categoría
              </button>
            </div>
          )}
        </header>

        {error && <div className="st-alert err">{error}</div>}
        {aviso && <div className="st-alert ok">{aviso}</div>}

        {admin && form && (
          <form
            onSubmit={(e) => { e.preventDefault(); saveMut.mutate(form); }}
            className="st-card p-5 flex flex-wrap items-end gap-3"
          >
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
              Descripción
              <input
                type="text"
                className="st-input w-64"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
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

        {q.isLoading ? (
          <div className="text-[#6E6B64]">Cargando…</div>
        ) : q.error ? (
          <div className="text-red-600">{(q.error as Error).message}</div>
        ) : cats.length === 0 ? (
          <div className="st-panel p-8 text-center text-[#6E6B64]">
            No hay categorías.
            {admin && <> Usa <span className="font-medium">Importar del hub</span> para traer las categorías reales.</>}
          </div>
        ) : (
          <div className="st-table-wrap">
            <table className="st-table">
              <thead>
                <tr>
                  <th className="w-16">Color</th>
                  <th>Nombre</th>
                  <th>Descripción</th>
                  {admin && <th className="num">Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {cats.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <span
                        className="inline-block h-4 w-4 rounded"
                        style={{ backgroundColor: c.color }}
                        title={c.color}
                      />
                    </td>
                    <td>{c.name}</td>
                    <td className="text-[#6E6B64]">{c.description ?? '—'}</td>
                    {admin && (
                      <td className="num">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => abrirEditar(c)}
                            className="st-btn text-xs px-2 py-1"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => borrar(c)}
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

        <GroupingManager admin={admin} categories={cats} />
      </div>
    </div>
  );
}
