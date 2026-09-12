export type Role = 'ADMIN' | 'PM' | 'DEVELOPER'

export type SessionUser = {
    sub: string
    role: Role
    name: string
}

export type ApiProject = {
    id: string
    name: string
    createdAt: string
    client: {
        id?: string
        name: string
    }
    _count: {
        tasks: number
    }
}

export type ApiTask = {
    id: number
    title: string
    description?: string | null
    project: {
        id?: string
        name: string
    }
    assignee?: {
        id: string
        name: string
    }
    status: string
    priority: string
    dueDate: string
}

export type ApiActivity = {
    id?: string
    actor: {
        name: string
    }
    message: string
    createdAt: string
    task?: {
        id: number
        title: string
    } | null
}

export type ApiNotification = {
    id: string
    message: string
    readAt: string | null
    createdAt: string
}

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:4000'

let accessToken = ''

export const getAccessToken = () => accessToken

export const setAccessToken = (token: string) => {
    accessToken = token
}

async function request<T>(
    path: string,
    options: RequestInit = {},
    retry = true
): Promise<T> {
    const headers = new Headers(options.headers)

    headers.set('Content-Type', 'application/json')

    if (accessToken) {
        headers.set('Authorization', `Bearer ${accessToken}`)
    }

    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers,
        credentials: 'include'
    })

    if (
        response.status === 401 &&
        retry &&
        path !== '/api/auth/refresh'
    ) {
        const refreshed = await refresh()

        if (refreshed) {
            return request<T>(path, options, false)
        }
    }

    if (!response.ok) {
        throw new Error(
            (await response.json().catch(() => null))?.error?.message ??
            'Request failed'
        )
    }

    return response.status === 204
        ? (undefined as T)
        : response.json()
}

/* ================= AUTH ================= */

export async function login(email: string, password: string) {
    const result = await request<{
        accessToken: string
        user: SessionUser
    }>(
        '/api/auth/login',
        {
            method: 'POST',
            body: JSON.stringify({ email, password })
        },
        false
    )

    setAccessToken(result.accessToken)

    return result.user
}

export async function refresh() {
    try {
        const result = await request<{
            accessToken: string
            user: SessionUser
        }>(
            '/api/auth/refresh',
            { method: 'POST' },
            false
        )

        setAccessToken(result.accessToken)

        return result.user
    } catch {
        return null
    }
}

export const logout = () =>
    request<void>(
        '/api/auth/logout',
        { method: 'POST' },
        false
    )

/* ================= PROJECTS ================= */

export const getProjects = () =>
    request<ApiProject[]>('/api/projects')

export const createProject = (
    name: string,
    clientId: string
) =>
    request('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name, clientId })
    })

/* ================= TASKS ================= */

export const getTasks = (
    status?: string,
    priority?: string,
    dueFrom?: string,
    dueTo?: string
) => {
    const params = new URLSearchParams()

    if (status && status !== 'All') {
        params.set('status', status)
    }

    if (priority && priority !== 'All') {
        params.set('priority', priority)
    }

    if (dueFrom) {
        params.set('dueFrom', dueFrom)
    }

    if (dueTo) {
        params.set('dueTo', dueTo)
    }

    const query = params.toString()

    return request<ApiTask[]>(
        `/api/tasks${query ? `?${query}` : ''}`
    )
}


export const createTask = (
    projectId: string,
    task: {
        title: string
        assigneeId: string
        priority: string
        dueDate: string
    }
) =>
    request(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify(task)
    })

export const updateTaskStatus = (
    taskId: number,
    status: string
) =>
    request(`/api/tasks/${taskId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
    })

/* ================= ACTIVITY ================= */

export const getActivity = () =>
    request<ApiActivity[]>('/api/activity')

/* ================= NOTIFICATIONS ================= */

export const getNotifications = () =>
    request<ApiNotification[]>('/api/notifications')

export const markNotificationRead = (id: string) =>
    request<{ updated: boolean }>(
        `/api/notifications/${id}/read`,
        { method: 'PATCH' }
    )

export const markAllNotificationsRead = () =>
    request<{ updated: number }>(
        '/api/notifications/read-all',
        { method: 'PATCH' }
    )

/* ================= DASHBOARD ================= */

export const getDashboard = () =>
    request<{
        role: Role
        projects: number
        tasksByStatus: Array<{
            status: string
            _count: {
                _all: number
            }
        }>
        overdue: number
        priorityBreakdown: Array<{
            priority: string
            _count: {
                _all: number
            }
        }>
    }>('/api/dashboard')

export { API_URL }