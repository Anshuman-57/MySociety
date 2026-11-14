import { errorMessage } from './errors';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const origin = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const base = origin + '/api/v1';
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: { respondedBy?: { name: string } }) {
    super(errorMessage(code, message, details?.respondedBy?.name));
  }
}
export type Tokens = { accessToken: string; refreshToken: string };
export function saveTokens(tokens: Tokens | null) {
  for (const key of ['accessToken', 'refreshToken'] as const) {
    if (tokens) localStorage.setItem(key, tokens[key]);
    else localStorage.removeItem(key);
  }
  window.dispatchEvent(new Event('session'));
}
export const accessToken = () => localStorage.getItem('accessToken');
export const refreshToken = () => localStorage.getItem('refreshToken');
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Envelope<T> = { data: T; meta?: { page: number; limit: number; total: number } };
async function fetchApi<T>(path: string, method: Method, body: unknown, token?: string | null): Promise<Envelope<T>> {
  const isFile = body instanceof FormData;
  const headers = new Headers({ 'X-Device-Name': navigator.userAgent.slice(0, 180) });
  if (token) headers.set('Authorization', 'Bearer ' + token);
  if (body !== undefined && !isFile) headers.set('Content-Type', 'application/json');
  const response = await fetch(base + path, { method, headers, body: isFile ? body : body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new ApiError(response.status, result.error.code, result.error.message, result.error.details);
  return result;
}
let rotating: Promise<Tokens> | undefined;
export async function refreshSession() {
  if (!rotating) {
    const previous = refreshToken();
    rotating = fetchApi<Tokens>('/auth/refresh', 'POST', { refreshToken: previous }).then(({ data }) => {
      if (refreshToken() === previous) saveTokens(data);
      return data;
    }).catch(error => { if (refreshToken() === previous) saveTokens(null); throw error; }).finally(() => { rotating = undefined; });
  }
  return rotating;
}
async function request<T>(path: string, method: Method = 'GET', body?: unknown, publicRoute = false) {
  const token = publicRoute ? null : accessToken();
  try { return await fetchApi<T>(path, method, body, token); }
  catch (error) {
    if (publicRoute || !(error instanceof ApiError) || error.status !== 401 || !refreshToken()) throw error;
    const fresh = token !== accessToken() ? accessToken() : (await refreshSession()).accessToken;
    return fetchApi<T>(path, method, body, fresh);
  }
}
export async function api<T = any>(path: string, method: Method = 'GET', body?: unknown, publicRoute = false) {
  return (await request<T>(path, method, body, publicRoute)).data;
}
export function useData<T = any>(path: string, enabled = true) {
  return useQuery({ queryKey: [path], queryFn: () => api<T>(path), enabled });
}
export function useList<T = any>(path: string, page: number, enabled = true) {
  return useQuery({ queryKey: [path, page], queryFn: () => request<T[]>(path + (path.includes('?') ? '&' : '?') + 'page=' + page), enabled });
}
export function toast(message: string, error = false) {
  window.dispatchEvent(new CustomEvent('toast', { detail: { message, error } }));
}
export function useWrite() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ path, method = 'POST', body }: { path: string; method?: Method; body?: unknown }) => api(path, method, body),
    onSuccess: () => { toast('Saved'); void cache.invalidateQueries(); },
    onError: error => toast(error.message, true)
  });
}
export async function upload(file: File, purpose: 'PROFILE' | 'SOCIETY_DOC' | 'WALKIN') {
  const data = new FormData();
  data.set('file', file);
  return (await api<{ url: string }>('/uploads?purpose=' + purpose, 'POST', data)).url;
}
