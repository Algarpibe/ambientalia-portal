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

const DEFAULT_COLOR = '#3b82f6';

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
    <div className="p-8 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Categorías</h1>
          <p className="text-gray-500">Gestión de categorías de salestracker (nombre, descripción, color).</p>
        </div>
        {admin && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => importMut.mutate()}
              disabled={importMut.isPending}
              className="rounded-md border px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              {importMut.isPending ? 'Importando…' : 'Importar del hub'}
            </button>
            <button
              type="button"
              onClick={abrirCrear}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Nueva categoría
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}
      {aviso && (
        <div className="rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-700">{aviso}</div>
      )}

      {admin && form && (
        <form
          onSubmit={(e) => { e.preventDefault(); saveMut.mutate(form); }}
          className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4"
        >
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
            Descripción
            <input
              type="text"
              className="mt-1 w-64 rounded-md border px-2 py-1.5 text-gray-900"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
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

      {q.isLoading ? (
        <div className="text-gray-600">Cargando…</div>
      ) : q.error ? (
        <div className="text-red-600">{(q.error as Error).message}</div>
      ) : cats.length === 0 ? (
        <div className="rounded-xl border bg-white p-8 text-center text-gray-500">
          No hay categorías.
          {admin && <> Usa <span className="font-medium">Importar del hub</span> para traer las categorías reales.</>}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="w-16 px-3 py-2 text-left">Color</th>
                <th className="px-3 py-2 text-left">Nombre</th>
                <th className="px-3 py-2 text-left">Descripción</th>
                {admin && <th className="px-3 py-2 text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-3 py-2">
                    <span
                      className="inline-block h-4 w-4 rounded"
                      style={{ backgroundColor: c.color }}
                      title={c.color}
                    />
                  </td>
                  <td className="px-3 py-2 text-gray-900">{c.name}</td>
                  <td className="px-3 py-2 text-gray-600">{c.description ?? '—'}</td>
                  {admin && (
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => abrirEditar(c)}
                          className="rounded-md border px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => borrar(c)}
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

      <GroupingManager admin={admin} categories={cats} />
    </div>
  );
}
