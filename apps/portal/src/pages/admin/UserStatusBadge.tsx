import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import type { UserStatus } from './types';

const CONFIG: Record<UserStatus, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  active: { label: 'Aprobado', className: 'bg-green-50 text-green-700', Icon: CheckCircle2 },
  pending: { label: 'Pendiente', className: 'bg-amber-50 text-amber-700', Icon: Clock },
  inactive: { label: 'Inactivo', className: 'bg-gray-100 text-gray-500', Icon: XCircle },
};

export default function UserStatusBadge({ status }: { status: UserStatus }) {
  const { label, className, Icon } = CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${className}`}>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  );
}
