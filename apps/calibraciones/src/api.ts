/** HTTP client of the Calibraciones API (hub-api, `/api/calibraciones/*`). */
import { authHeaders } from '@suite/auth-client';
import type { EngineConfig, Limits } from './engine';
import { errorFromResponse } from './lib/apiError';
import type {
  CalRole,
  DownstreamImpact,
  Equipment,
  EquipmentDetail,
  EquipmentInput,
  EquipmentWithValidity,
  ExpirationItem,
  LimitSet,
  LimitsResponse,
  Me,
  ReproducibilityReport,
  RoleUser,
  VerificationDetail,
  VerificationDraftInput,
  VerificationListItem,
} from './types';

const API_BASE = `${(import.meta.env.VITE_HUB_API_URL as string | undefined) ?? ''}/api/calibraciones`;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...authHeaders() },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw errorFromResponse(res.status, await res.json().catch(() => null));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const q = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return s ? `?${s}` : '';
};
const id = (v: string) => encodeURIComponent(v);

export const api = {
  me: () => request<Me>('GET', '/roles/me'),
  listRoles: () => request<RoleUser[]>('GET', '/roles'),
  setRole: (userId: string, role: CalRole) => request<{ userId: string; role: CalRole }>('PUT', `/roles/${id(userId)}`, { role }),

  listEquipment: () => request<EquipmentWithValidity[]>('GET', '/equipment'),
  getEquipment: (eqId: string) => request<EquipmentDetail>('GET', `/equipment/${id(eqId)}`),
  createEquipment: (e: EquipmentInput) => request<Equipment>('POST', '/equipment', e),
  updateEquipment: (eqId: string, e: EquipmentInput) => request<Equipment>('PATCH', `/equipment/${id(eqId)}`, e),
  expirations: () => request<ExpirationItem[]>('GET', '/expirations'),
  downstreamImpact: (eqId: string) => request<DownstreamImpact>('GET', `/downstream-impact/${id(eqId)}`),

  listVerifications: (f: { equipmentId?: string; status?: string } = {}) =>
    request<VerificationListItem[]>('GET', `/verifications${q(f)}`),
  getVerification: (vId: string) => request<VerificationDetail>('GET', `/verifications/${id(vId)}`),
  createVerification: (p: VerificationDraftInput) => request<VerificationDetail>('POST', '/verifications', p),
  updateVerification: (vId: string, p: VerificationDraftInput) =>
    request<VerificationDetail>('PUT', `/verifications/${id(vId)}`, p),
  deleteVerification: (vId: string) => request<void>('DELETE', `/verifications/${id(vId)}`),
  calculate: (vId: string) => request<VerificationDetail>('POST', `/verifications/${id(vId)}/calculate`),
  approve: (vId: string) => request<VerificationDetail>('POST', `/verifications/${id(vId)}/approve`),
  reject: (vId: string, reason: string) => request<VerificationDetail>('POST', `/verifications/${id(vId)}/reject`, { reason }),
  newVersion: (vId: string, reason: string) =>
    request<VerificationDetail>('POST', `/verifications/${id(vId)}/new-version`, { reason }),
  recalculateCheck: (vId: string) => request<ReproducibilityReport>('POST', `/verifications/${id(vId)}/recalculate-check`),

  getLimits: () => request<LimitsResponse>('GET', '/limits'),
  putLimits: (version: string, limits: Limits, reason: string) => request<LimitSet>('PUT', '/limits', { version, limits, reason }),
  getConfig: () => request<EngineConfig>('GET', '/config'),
  putConfig: (config: EngineConfig, reason: string) => request<EngineConfig>('PUT', '/config', { config, reason }),
};
