import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';
import type { AdminUser } from './types';

// Menú contextual de acciones por fila, según el estado del usuario (Req 2.2,
// 2.3, 2.5, 2.6, 3.2). Las acciones que apuntarían a la propia cuenta del admin
// (desactivar, eliminar) se deshabilitan (Req 2.7).
//
// El menú se renderiza en un PORTAL con posición fija calculada desde el botón,
// para no quedar recortado por el overflow de la tabla.

export interface UserActionsMenuProps {
  user: AdminUser;
  isSelf: boolean;
  onApprove: (u: AdminUser) => void;
  onDeactivate: (u: AdminUser) => void;
  onReactivate: (u: AdminUser) => void;
  onChangeRole: (u: AdminUser) => void;
  onDelete: (u: AdminUser) => void;
  onAssignApps?: (u: AdminUser) => void;
}

interface Action {
  label: string;
  run: (u: AdminUser) => void;
  disabled?: boolean;
  danger?: boolean;
}

export default function UserActionsMenu(props: UserActionsMenuProps) {
  const { user, isSelf } = props;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    }
    setOpen((o) => !o);
  };

  const actions: Action[] = [];
  if (user.status === 'pending') {
    actions.push({ label: 'Aprobar', run: props.onApprove });
  }
  if (user.status === 'active') {
    actions.push({ label: 'Desactivar', run: props.onDeactivate, disabled: isSelf });
    actions.push({ label: user.role === 'admin' ? 'Cambiar a lector' : 'Hacer admin', run: props.onChangeRole });
    if (props.onAssignApps) actions.push({ label: 'Asignar apps', run: props.onAssignApps });
  }
  if (user.status === 'inactive') {
    actions.push({ label: 'Reactivar', run: props.onReactivate });
  }
  if (user.status !== 'pending') {
    actions.push({ label: 'Eliminar', run: props.onDelete, disabled: isSelf, danger: true });
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label="Acciones"
        aria-haspopup="menu"
        aria-expanded={open}
        className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700">
        <MoreVertical className="w-5 h-5" />
      </button>

      {open &&
        pos &&
        createPortal(
          <>
            {/* Overlay para cerrar al hacer clic fuera */}
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              role="menu"
              style={{ top: pos.top, right: pos.right }}
              className="fixed z-50 w-48 bg-white border border-gray-200 rounded-xl shadow-xl ring-1 ring-black/5 py-1">
              {actions.map((a) => (
                <button
                  key={a.label}
                  role="menuitem"
                  disabled={a.disabled}
                  onClick={() => {
                    setOpen(false);
                    a.run(user);
                  }}
                  className={
                    'w-full text-left px-4 py-2 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ' +
                    (a.danger
                      ? 'text-red-600 hover:bg-red-50'
                      : 'text-gray-700 hover:bg-gray-50')
                  }>
                  {a.label}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
