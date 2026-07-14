// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import UserRowActions from './UserRowActions';
import type { AdminUser } from './types';

const base: AdminUser = {
  id: 'u1',
  full_name: 'Test',
  email: 't@x.com',
  role: 'reader',
  status: 'active',
  created_at: '2025-01-01T00:00:00.000Z',
};

const handlers = () => ({
  onApprove: vi.fn(),
  onDeactivate: vi.fn(),
  onReactivate: vi.fn(),
  onChangeRole: vi.fn(),
  onDelete: vi.fn(),
  onAssignApps: vi.fn(),
});

function renderActions(user: AdminUser, isSelf = false) {
  const h = handlers();
  render(<UserRowActions user={user} isSelf={isSelf} {...h} />);
  return h;
}

afterEach(cleanup);

describe('UserRowActions', () => {
  it('pending → Aprobar y Eliminar; sin Desactivar', () => {
    renderActions({ ...base, status: 'pending' });
    expect(screen.getByText('Aprobar')).toBeTruthy();
    expect(screen.getByLabelText('Eliminar usuario')).toBeTruthy();
    expect(screen.queryByText('Desactivar')).toBeNull();
  });

  it('active (no propio) → Asignar apps, selector de rol, Desactivar y Eliminar', () => {
    renderActions({ ...base, status: 'active' }, false);
    expect(screen.getByText('Asignar apps')).toBeTruthy();
    expect(screen.getByLabelText('Cambiar rol')).toBeTruthy();
    expect(screen.getByText('Desactivar')).toBeTruthy();
    expect(screen.getByLabelText('Eliminar usuario')).toBeTruthy();
  });

  it('active y propio → solo Asignar apps (sin Desactivar/Eliminar/rol)', () => {
    renderActions({ ...base, status: 'active' }, true);
    expect(screen.getByText('Asignar apps')).toBeTruthy();
    expect(screen.queryByText('Desactivar')).toBeNull();
    expect(screen.queryByLabelText('Eliminar usuario')).toBeNull();
    expect(screen.queryByLabelText('Cambiar rol')).toBeNull();
  });

  it('inactive → Reactivar y Eliminar', () => {
    renderActions({ ...base, status: 'inactive' });
    expect(screen.getByText('Reactivar')).toBeTruthy();
    expect(screen.getByLabelText('Eliminar usuario')).toBeTruthy();
    expect(screen.queryByText('Desactivar')).toBeNull();
  });

  it('cambiar el selector de rol llama onChangeRole con el rol destino', () => {
    const h = renderActions({ ...base, status: 'active', role: 'reader' }, false);
    fireEvent.change(screen.getByLabelText('Cambiar rol'), { target: { value: 'admin' } });
    expect(h.onChangeRole).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), 'admin');
  });
});
