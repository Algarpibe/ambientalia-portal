// Tipos del Panel de Administración (espejo de las respuestas de hub-api).

export type UserStatus = 'pending' | 'active' | 'inactive';
export type UserRole = 'admin' | 'reader';

export interface AdminUser {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
}

export interface PaginatedUsers {
  users: AdminUser[];
  total: number;
  page: number;
  limit: number;
}
