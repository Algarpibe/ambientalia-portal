// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import UserActionsMenu from './UserActionsMenu';
import type { AdminUser } from './types';

const base: AdminUser = {
  id: 'u1',
  full_name: 'Test',
  email: 't@x.com',
  role: 'reader',
  status: 'active',
  created_at: '2025-01-01T00:00:00.000Z',
};

const noop = () => {};
function renderMenu(user: AdminUser, isSelf = false, withApps = false) {
  render(
    <UserActionsMenu
      user={user}
      isSelf={isSelf}
      onApprove={noop}
      onDeactivate={noop}
      onReactivate={noop}
      onChangeRole={noop}
      onDelete={noop}
      onAssignApps={withApps ? noop : undefined}
    />,
  );
  fireEvent.click(screen.getByLabelText('Acciones'));
}

afterEach(cleanup);

describe('UserActionsMenu', () => {
  it('pending → solo Aprobar', () => {
    renderMenu({ ...base, status: 'pending' });
    expect(screen.getByText('Aprobar')).toBeTruthy();
    expect(screen.queryByText('Desactivar')).toBeNull();
    expect(screen.queryByText('Eliminar')).toBeNull();
  });

  it('active → Desactivar, Cambiar rol y Eliminar (habilitados si no es uno mismo)', () => {
    renderMenu({ ...base, status: 'active', role: 'reader' }, false);
    expect((screen.getByText('Desactivar') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('Hacer admin')).toBeTruthy();
    expect((screen.getByText('Eliminar') as HTMLButtonElement).disabled).toBe(false);
  });

  it('active admin → opción "Cambiar a lector"', () => {
    renderMenu({ ...base, status: 'active', role: 'admin' });
    expect(screen.getByText('Cambiar a lector')).toBeTruthy();
  });

  it('active y es uno mismo → Desactivar y Eliminar deshabilitados (Req 2.7)', () => {
    renderMenu({ ...base, status: 'active' }, true);
    expect((screen.getByText('Desactivar') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Eliminar') as HTMLButtonElement).disabled).toBe(true);
  });

  it('inactive → Reactivar y Eliminar', () => {
    renderMenu({ ...base, status: 'inactive' });
    expect(screen.getByText('Reactivar')).toBeTruthy();
    expect(screen.getByText('Eliminar')).toBeTruthy();
    expect(screen.queryByText('Desactivar')).toBeNull();
  });

  it('muestra "Asignar apps" solo si se provee onAssignApps', () => {
    renderMenu({ ...base, status: 'active' }, false, true);
    expect(screen.getByText('Asignar apps')).toBeTruthy();
  });
});
