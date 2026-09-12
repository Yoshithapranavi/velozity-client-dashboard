export type Role = 'ADMIN' | 'PM' | 'DEVELOPER'
export type SessionUser = { sub: string; role: Role; name: string }
export type ApiTask = { id: number; title: string; project: { name: string }; status: string; priority: string; dueDate: string }
export type ApiNotification = { id: string; message: string; readAt: string | null; createdAt: string }

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:4000'
let accessToken = ''
export const getAccessToken = () => accessToken
export const setAccessToken = (token: string) => { accessToken = token }

async function request<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
    const headers = new Headers(options.headers)
    headers.set('Content-Type', 'application/json')
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
    const response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' })
    if (response.status === 401 && retry && path !== '/api/auth/refresh') { const refreshed = await refresh(); if (refreshed) return request<T>(path, options, false) }
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error?.message ?? 'Request failed')
    return response.status === 204 ? (undefined as T) : response.json()
}
export async function login(email: string, password: string) { const result = await request<{ accessToken: string; user: SessionUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, false); setAccessToken(result.accessToken); return result.user }
export async function refresh() { try { const result = await request<{ accessToken: string; user: SessionUser }>('/api/auth/refresh', { method: 'POST' }, false); setAccessToken(result.accessToken); return result.user } catch { return null } }
export const logout = () => request<void>('/api/auth/logout', { method: 'POST' }, false)
export const getTasks = (status?: string, priority?: string) => request<ApiTask[]>(`/api/tasks?${status ? `status=${status}&` : ''}${priority ? `priority=${priority}` : ''}`)
export const getActivity = () => request<Array<{ actor: { name: string }; message: string; createdAt: string }>>('/api/activity')
export const getNotifications = () => request<ApiNotification[]>('/api/notifications')
export const getDashboard = () => request<{ role: Role; projects: number; tasksByStatus: Array<{ status: string; _count: { _all: number } }>; overdue: number; priorityBreakdown: Array<{ priority: string; _count: { _all: number } }> }>('/api/dashboard')
export const markAllNotificationsRead = () => request<{ updated: number }>('/api/notifications/read-all', { method: 'PATCH' })
export const createProject = (name: string, clientId: string) => request('/api/projects', { method: 'POST', body: JSON.stringify({ name, clientId }) })
export const createTask = (projectId: string, task: { title: string; assigneeId: string; priority: string; dueDate: string }) => request(`/api/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify(task) })
export const updateTaskStatus = (taskId: number, status: string) => request(`/api/tasks/${taskId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
export { API_URL }
