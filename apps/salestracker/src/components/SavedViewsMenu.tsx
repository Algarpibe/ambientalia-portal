import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchSavedViews, saveView, deleteSavedView } from '../api';
import { parseClientesState, type ClientesViewState } from '../lib/clientes-view-state';

export default function SavedViewsMenu({
  viewKey,
  currentState,
  onApply,
}: {
  viewKey: string;
  currentState: ClientesViewState;
  onApply: (s: ClientesViewState) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['saved-views', viewKey], queryFn: () => fetchSavedViews(viewKey) });
  const inval = () => qc.invalidateQueries({ queryKey: ['saved-views', viewKey] });
  const save = useMutation({ mutationFn: (name: string) => saveView(viewKey, name, currentState), onSuccess: inval });
  const del = useMutation({ mutationFn: (id: string) => deleteSavedView(id), onSuccess: inval });

  const onSave = () => {
    const name = window.prompt('Nombre de la vista:');
    const trimmed = name?.trim().slice(0, 120);
    if (trimmed) save.mutate(trimmed);
  };
  const apply = (raw: unknown) => {
    const s = parseClientesState(raw);
    if (s) onApply(s);
  };

  return (
    <div className="relative">
      <div className="flex gap-2">
        <button onClick={onSave} className="st-btn">Guardar vista</button>
        <button onClick={() => setOpen((v) => !v)} className="st-btn">Vistas ({q.data?.length ?? 0})</button>
      </div>
      {open && (
        <div
          className="absolute right-0 z-10 mt-1 w-64 rounded-2xl"
          style={{ background: '#FCFBF9', border: '1px solid #E5E2DB', boxShadow: '0 10px 30px rgba(35,30,22,0.10), 0 2px 8px rgba(35,30,22,0.05)' }}
        >
          {(q.data ?? []).length === 0 ? (
            <p className="p-3 text-sm text-[#6E6B64]">Sin vistas guardadas.</p>
          ) : (
            <ul className="max-h-64 overflow-auto py-1">
              {(q.data ?? []).map((v) => (
                <li key={v.id} className="flex items-center justify-between px-3 py-1.5 text-sm hover:bg-[#F3F1EC]">
                  <button className="text-left flex-1 truncate" onClick={() => { apply(v.state); setOpen(false); }}>{v.name}</button>
                  <button className="text-gray-400 hover:text-[#9F2F2D] ml-2" onClick={() => del.mutate(v.id)} aria-label="Borrar vista">✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
