// Store mínimo de notificaciones (toasts), sin dependencias. Un pub/sub global
// que sobrevive a la navegación de react-router: notify() puede llamarse justo
// antes de un <Navigate> y el NotificationHost (montado en App) renderiza el aviso.

export type NoticeKind = 'error' | 'info';
export interface Notice {
  id: number;
  message: string;
  kind: NoticeKind;
}

type Listener = (notices: Notice[]) => void;

let notices: Notice[] = [];
const listeners = new Set<Listener>();
let seq = 0;

const AUTO_DISMISS_MS = 5000;

function emit(): void {
  for (const l of listeners) l(notices);
}

/** Emite una notificación; se auto-descarta a los 5s. Devuelve su id. */
export function notify(message: string, kind: NoticeKind = 'info'): number {
  const id = ++seq;
  notices = [...notices, { id, message, kind }];
  emit();
  setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
  return id;
}

/** Descarta una notificación por id. */
export function dismiss(id: number): void {
  notices = notices.filter((n) => n.id !== id);
  emit();
}

/** Suscribe un listener; recibe el estado actual de inmediato. Devuelve el unsubscribe. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener(notices);
  return () => {
    listeners.delete(listener);
  };
}
