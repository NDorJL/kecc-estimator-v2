import { QueryClient } from '@tanstack/react-query'
import { getToken, clearToken, notifyUnauthorized } from './auth'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 seconds
      retry: 1,
    },
  },
})

const API_BASE = '/.netlify/functions'

export async function apiRequest(
  method: string,
  path: string,
  data?: unknown
): Promise<Response> {
  const url = `${API_BASE}${path}`
  const headers: Record<string, string> = {}
  if (data) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  })
  if (res.status === 401) {
    // Session expired or gate just activated — drop the token and surface login.
    clearToken()
    notifyUnauthorized()
    throw new Error('401: Unauthorized')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status}: ${text}`)
  }
  return res
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiRequest('GET', path)
  return res.json()
}

export async function apiPost<T>(path: string, data: unknown): Promise<T> {
  const res = await apiRequest('POST', path, data)
  return res.json()
}

export async function apiPatch<T>(path: string, data: unknown): Promise<T> {
  const res = await apiRequest('PATCH', path, data)
  return res.json()
}

export async function apiDelete(path: string): Promise<void> {
  await apiRequest('DELETE', path)
}
