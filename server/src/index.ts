
import 'dotenv/config'
import express, { NextFunction, Request, Response } from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import http from 'http'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import cron from 'node-cron'
import { Server } from 'socket.io'
import { PrismaClient, Role, TaskStatus, Priority } from '@prisma/client'
import { z } from 'zod'
import crypto from 'crypto'

const app = express()
const server = http.createServer(app)

const PORT = Number(process.env.PORT ?? 4000)
const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:5173'

const accessSecret = process.env.ACCESS_TOKEN_SECRET
const refreshSecret = process.env.REFRESH_TOKEN_SECRET

if (!accessSecret || !refreshSecret) {
    throw new Error('ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET must be configured')
}

const db = new PrismaClient()

const io = new Server(server, {
    cors: {
        origin: CLIENT_URL,
        credentials: true
    }
})

app.use(cors({
    origin: CLIENT_URL,
    credentials: true
}))

app.use(express.json())
app.use(cookieParser())

type SessionUser = {
    sub: string
    role: Role
    name: string
}

interface AuthedRequest extends Request {
    user?: SessionUser
}

const refreshCookie = 'refreshToken'

const connectedUsers = new Map<string, number>()

function sendError(res: Response, status: number, message: string) {
    return res.status(status).json({
        error: {
            status,
            message
        }
    })
}

function hashToken(token: string) {
    return crypto
        .createHash('sha256')
        .update(token)
        .digest('hex')
}

function accessToken(user: SessionUser) {
    return jwt.sign(user, accessSecret!, {
        expiresIn: '15m'
    })
}

function signRefresh() {
    return jwt.sign(
        {},
        refreshSecret!,
        {
            expiresIn: '7d'
        }
    )
}

function auth(roles?: Role[]) {
    return (
        req: AuthedRequest,
        res: Response,
        next: NextFunction
    ) => {
        const header = req.headers.authorization

        if (!header?.startsWith('Bearer ')) {
            return sendError(res, 401, 'Authentication required')
        }

        const token = header.substring(7)

        try {
            const user = jwt.verify(
                token,
                accessSecret!
            ) as SessionUser

            req.user = user

            if (roles && !roles.includes(user.role)) {
                return sendError(
                    res,
                    403,
                    'Insufficient permissions'
                )
            }

            next()
        } catch {
            return sendError(res, 401, 'Invalid or expired token')
        }
    }
}

function projectScope(user: SessionUser) {
    if (user.role === Role.ADMIN) {
        return {}
    }

    if (user.role === Role.PM) {
        return {
            ownerId: user.sub
        }
    }

    return {
        tasks: {
            some: {
                assigneeId: user.sub
            }
        }
    }
}

async function canManageProject(
    user: SessionUser,
    projectId: string
) {
    if (user.role === Role.ADMIN) {
        return true
    }

    if (user.role !== Role.PM) {
        return false
    }

    const project = await db.project.findFirst({
        where: {
            id: projectId,
            ownerId: user.sub
        },
        select: {
            id: true
        }
    })

    return Boolean(project)
}

/*
|--------------------------------------------------------------------------
| REAL-TIME ACTIVITY
|--------------------------------------------------------------------------
*/

const emitActivity = (
    projectId: string,
    activity: unknown
) => {
    // Users currently viewing this project
    io.to(`project:${projectId}`)
        .emit('activity:new', activity)

    // Admin receives activity from ALL projects
    io.to('admins')
        .emit('activity:new', activity)
}

/*
|--------------------------------------------------------------------------
| HEALTH
|--------------------------------------------------------------------------
*/

app.get('/health', (_req, res) => {
    res.json({
        ok: true,
        service: 'velozity-api'
    })
})

/*
|--------------------------------------------------------------------------
| AUTHENTICATION
|--------------------------------------------------------------------------
*/

app.post('/api/auth/login', async (req, res) => {
    const input = z.object({
        email: z.string().email(),
        password: z.string().min(8)
    }).safeParse(req.body)

    if (!input.success) {
        return sendError(res, 400, 'Invalid credentials')
    }

    const user = await db.user.findUnique({
        where: {
            email: input.data.email.toLowerCase()
        }
    })

    if (
        !user ||
        !(await bcrypt.compare(
            input.data.password,
            user.passwordHash
        ))
    ) {
        return sendError(res, 401, 'Invalid credentials')
    }

    const session: SessionUser = {
        sub: user.id,
        role: user.role,
        name: user.name
    }

    const rawRefresh = signRefresh()

    await db.refreshToken.create({
        data: {
            tokenHash: hashToken(rawRefresh),
            userId: user.id,
            expiresAt: new Date(
                Date.now() + 7 * 24 * 60 * 60 * 1000
            )
        }
    })

    res.cookie(
        refreshCookie,
        rawRefresh,
        {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        }
    )

    res.json({
        accessToken: accessToken(session),
        user: session
    })
})

app.post('/api/auth/refresh', async (req, res) => {
    const raw = req.cookies[refreshCookie]

    if (!raw) {
        return sendError(
            res,
            401,
            'Refresh token required'
        )
    }

    const stored = await db.refreshToken.findUnique({
        where: {
            tokenHash: hashToken(raw)
        },
        include: {
            user: true
        }
    })

    if (
        !stored ||
        stored.expiresAt < new Date()
    ) {
        return sendError(
            res,
            401,
            'Refresh token expired'
        )
    }

    await db.refreshToken.delete({
        where: {
            id: stored.id
        }
    })

    const next = signRefresh()

    await db.refreshToken.create({
        data: {
            tokenHash: hashToken(next),
            userId: stored.userId,
            expiresAt: new Date(
                Date.now() + 7 * 24 * 60 * 60 * 1000
            )
        }
    })

    const session: SessionUser = {
        sub: stored.user.id,
        role: stored.user.role,
        name: stored.user.name
    }

    res.cookie(
        refreshCookie,
        next,
        {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        }
    )

    res.json({
        accessToken: accessToken(session),
        user: session
    })
})

app.post('/api/auth/logout', async (req, res) => {
    const raw = req.cookies[refreshCookie]

    if (raw) {
        await db.refreshToken.deleteMany({
            where: {
                tokenHash: hashToken(raw)
            }
        })
    }

    res.clearCookie(refreshCookie)

    res.status(204).end()
})

/*
|--------------------------------------------------------------------------
| PROJECTS
|--------------------------------------------------------------------------
*/

app.get(
    '/api/projects',
    auth(),
    async (req: AuthedRequest, res) => {
        const projects = await db.project.findMany({
            where: projectScope(req.user!),
            include: {
                client: true,
                _count: {
                    select: {
                        tasks: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        })

        res.json(projects)
    }
)

app.post(
    '/api/projects',
    auth([Role.ADMIN, Role.PM]),
    async (req: AuthedRequest, res) => {
        const input = z.object({
            name: z.string().min(2).max(100),
            clientId: z.string().min(1)
        }).safeParse(req.body)

        if (!input.success) {
            return sendError(
                res,
                400,
                'Invalid project data'
            )
        }

        const project = await db.project.create({
            data: {
                ...input.data,
                ownerId: req.user!.sub
            }
        })

        res.status(201).json(project)
    }
)

/*
|--------------------------------------------------------------------------
| CLIENTS
|--------------------------------------------------------------------------
*/

app.get(
    '/api/clients',
    auth([Role.ADMIN]),
    async (_req, res) => {
        const clients = await db.client.findMany({
            include: {
                _count: {
                    select: {
                        projects: true
                    }
                }
            },
            orderBy: {
                name: 'asc'
            }
        })

        res.json(clients)
    }
)

app.post(
    '/api/clients',
    auth([Role.ADMIN]),
    async (req, res) => {
        const input = z.object({
            name: z.string().min(2).max(100)
        }).safeParse(req.body)

        if (!input.success) {
            return sendError(
                res,
                400,
                'Invalid client data'
            )
        }

        const client = await db.client.create({
            data: input.data
        })

        res.status(201).json(client)
    }
)

/*
|--------------------------------------------------------------------------
| USERS
|--------------------------------------------------------------------------
*/

app.get(
    '/api/users',
    auth([Role.ADMIN]),
    async (_req, res) => {
        const users = await db.user.findMany({
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                createdAt: true
            },
            orderBy: {
                name: 'asc'
            }
        })

        res.json(users)
    }
)

app.patch(
    '/api/users/:id/role',
    auth([Role.ADMIN]),
    async (req, res) => {
        const input = z.object({
            role: z.nativeEnum(Role)
        }).safeParse(req.body)

        if (!input.success) {
            return sendError(res, 400, 'Invalid role')
        }

        const result = await db.user.updateMany({
            where: {
                id: String(req.params.id)
            },
            data: {
                role: input.data.role
            }
        })

        if (!result.count) {
            return sendError(
                res,
                404,
                'User not found'
            )
        }

        res.json({
            updated: true
        })
    }
)

/*
|--------------------------------------------------------------------------
| DASHBOARD
|--------------------------------------------------------------------------
*/

app.get(
    '/api/dashboard',
    auth(),
    async (req: AuthedRequest, res) => {
        const user = req.user!

        const taskWhere =
            user.role === Role.DEVELOPER
                ? {
                    assigneeId: user.sub
                }
                : user.role === Role.PM
                    ? {
                        project: {
                            ownerId: user.sub
                        }
                    }
                    : {}

        const [
            projects,
            tasksByStatus,
            overdue,
            priorityBreakdown
        ] = await Promise.all([
            db.project.count({
                where: projectScope(user)
            }),

            db.task.groupBy({
                by: ['status'],
                where: taskWhere,
                _count: {
                    _all: true
                }
            }),

            db.task.count({
                where: {
                    ...taskWhere,
                    status: TaskStatus.OVERDUE
                }
            }),

            db.task.groupBy({
                by: ['priority'],
                where: taskWhere,
                _count: {
                    _all: true
                }
            })
        ])

        res.json({
            role: user.role,
            projects,
            tasksByStatus,
            overdue,
            priorityBreakdown
        })
    }
)

/*
|--------------------------------------------------------------------------
| TASKS
|--------------------------------------------------------------------------
*/

app.get(
    '/api/tasks',
    auth(),
    async (req: AuthedRequest, res) => {
        const input = z.object({
            status: z.nativeEnum(TaskStatus).optional(),
            priority: z.nativeEnum(Priority).optional(),
            dueFrom: z.coerce.date().optional(),
            dueTo: z.coerce.date().optional()
        }).safeParse(req.query)

        if (!input.success) {
            return sendError(
                res,
                400,
                'Invalid task filters'
            )
        }

        const user = req.user!

        const where = {
            ...(user.role === Role.DEVELOPER
                ? {
                    assigneeId: user.sub
                }
                : user.role === Role.PM
                    ? {
                        project: {
                            ownerId: user.sub
                        }
                    }
                    : {}),

            ...(input.data.status
                ? {
                    status: input.data.status
                }
                : {}),

            ...(input.data.priority
                ? {
                    priority: input.data.priority
                }
                : {}),

            ...(input.data.dueFrom || input.data.dueTo
                ? {
                    dueDate: {
                        ...(input.data.dueFrom
                            ? {
                                gte: input.data.dueFrom
                            }
                            : {}),
                        ...(input.data.dueTo
                            ? {
                                lte: input.data.dueTo
                            }
                            : {})
                    }
                }
                : {})
        }

        const tasks = await db.task.findMany({
            where,
            include: {
                project: true,
                assignee: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            },
            orderBy: [
                {
                    priority: 'desc'
                },
                {
                    dueDate: 'asc'
                }
            ]
        })

        res.json(tasks)
    }
)

app.post(
    '/api/projects/:projectId/tasks',
    auth([Role.ADMIN, Role.PM]),
    async (req: AuthedRequest, res) => {
        const projectId = String(req.params.projectId)

        if (
            !(await canManageProject(
                req.user!,
                projectId
            ))
        ) {
            return sendError(
                res,
                403,
                'You cannot manage this project'
            )
        }

        const input = z.object({
            title: z.string().min(2),
            description: z.string().optional(),
            assigneeId: z.string().min(1),
            priority: z.nativeEnum(Priority),
            dueDate: z.coerce.date()
        }).safeParse(req.body)

        if (!input.success) {
            return sendError(
                res,
                400,
                'Invalid task data'
            )
        }

        const task = await db.task.create({
            data: {
                ...input.data,
                projectId
            }
        })

        await db.notification.create({
            data: {
                userId: input.data.assigneeId,
                message: `You were assigned ${task.title}`
            }
        })

        io.to(`user:${input.data.assigneeId}`)
            .emit('notification:new')

        res.status(201).json(task)
    }
)

app.patch(
    '/api/tasks/:taskId/status',
    auth(),
    async (req: AuthedRequest, res) => {
        const input = z.object({
            status: z.nativeEnum(TaskStatus)
        }).safeParse(req.body)

        if (!input.success) {
            return sendError(
                res,
                400,
                'Invalid status'
            )
        }

        const task = await db.task.findUnique({
            where: {
                id: Number(req.params.taskId)
            },
            include: {
                project: true
            }
        })

        if (!task) {
            return sendError(
                res,
                404,
                'Task not found'
            )
        }

        const user = req.user!

        const allowed =
            user.role === Role.ADMIN ||
            (
                user.role === Role.PM &&
                task.project.ownerId === user.sub
            ) ||
            (
                user.role === Role.DEVELOPER &&
                task.assigneeId === user.sub
            )

        if (!allowed) {
            return sendError(
                res,
                403,
                'You cannot update this task'
            )
        }

        const result = await db.$transaction(
            async (tx) => {
                const updated = await tx.task.update({
                    where: {
                        id: task.id
                    },
                    data: {
                        status: input.data.status
                    }
                })

                const activity = await tx.activity.create({
                    data: {
                        projectId: task.projectId,
                        taskId: task.id,
                        actorId: user.sub,
                        fromStatus: task.status,
                        toStatus: input.data.status,
                        message:
                            `${user.name} moved Task #${task.id} ` +
                            `from ${task.status} to ${input.data.status}`
                    },
                    include: {
                        actor: {
                            select: {
                                name: true
                            }
                        }
                    }
                })

                if (
                    input.data.status === TaskStatus.IN_REVIEW &&
                    task.assigneeId !== task.project.ownerId
                ) {
                    await tx.notification.create({
                        data: {
                            userId: task.project.ownerId,
                            message:
                                `Task #${task.id} is ready for review`
                        }
                    })
                }

                return {
                    updated,
                    activity
                }
            }
        )

        emitActivity(
            task.projectId,
            result.activity
        )

        io.to(`user:${task.project.ownerId}`)
            .emit('notification:new')

        res.json(result.updated)
    }
)

/*
|--------------------------------------------------------------------------
| ACTIVITY
|--------------------------------------------------------------------------
*/

app.get(
    '/api/activity',
    auth(),
    async (req: AuthedRequest, res) => {
        const user = req.user!

        const where =
            user.role === Role.ADMIN
                ? {}
                : user.role === Role.PM
                    ? {
                        project: {
                            ownerId: user.sub
                        }
                    }
                    : {
                        task: {
                            assigneeId: user.sub
                        }
                    }

        const activity = await db.activity.findMany({
            where,
            include: {
                actor: {
                    select: {
                        name: true
                    }
                },
                task: true
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: 20
        })

        res.json(activity)
    }
)

/*
|--------------------------------------------------------------------------
| NOTIFICATIONS
|--------------------------------------------------------------------------
*/

app.get(
    '/api/notifications',
    auth(),
    async (req: AuthedRequest, res) => {
        const notifications =
            await db.notification.findMany({
                where: {
                    userId: req.user!.sub
                },
                orderBy: {
                    createdAt: 'desc'
                },
                take: 30
            })

        res.json(notifications)
    }
)

app.patch(
    '/api/notifications/:id/read',
    auth(),
    async (req: AuthedRequest, res) => {
        const notificationId =
            String(req.params.id)

        const result =
            await db.notification.updateMany({
                where: {
                    id: notificationId,
                    userId: req.user!.sub
                },
                data: {
                    readAt: new Date()
                }
            })

        res.json({
            updated: result.count === 1
        })
    }
)

app.patch(
    '/api/notifications/read-all',
    auth(),
    async (req: AuthedRequest, res) => {
        const result =
            await db.notification.updateMany({
                where: {
                    userId: req.user!.sub,
                    readAt: null
                },
                data: {
                    readAt: new Date()
                }
            })

        res.json({
            updated: result.count
        })
    }
)

/*
|--------------------------------------------------------------------------
| SOCKET.IO
|--------------------------------------------------------------------------
*/

io.use((socket, next) => {
    try {
        const token =
            socket.handshake.auth?.token ?? ''

        const user = jwt.verify(
            token,
            accessSecret!
        ) as SessionUser

        socket.data.user = user

        next()
    } catch {
        next(new Error('Unauthorized'))
    }
})

io.on('connection', (socket) => {
    const user =
        socket.data.user as SessionUser

    /*
    | User-specific room
    */
    socket.join(`user:${user.sub}`)

    /*
    | Admin receives activity
    | from every project
    */
    if (user.role === Role.ADMIN) {
        socket.join('admins')
    }

    /*
    | Presence tracking
    */
    connectedUsers.set(
        user.sub,
        (connectedUsers.get(user.sub) ?? 0) + 1
    )

    io.emit(
        'presence:count',
        connectedUsers.size
    )

    /*
    | Secure project room joining
    */
    socket.on(
        'project:join',
        async (projectId: string) => {
            try {
                const project =
                    await db.project.findFirst({
                        where: {
                            id: projectId,

                            ...(user.role === Role.ADMIN
                                ? {}

                                : user.role === Role.PM
                                    ? {
                                        ownerId: user.sub
                                    }

                                    : {
                                        tasks: {
                                            some: {
                                                assigneeId: user.sub
                                            }
                                        }
                                    })
                        },

                        select: {
                            id: true
                        }
                    })

                /*
                | Only join if backend authorization
                | confirms access
                */
                if (project) {
                    socket.join(
                        `project:${projectId}`
                    )
                }
            } catch {
                // Do not expose database errors
                // through the WebSocket connection
            }
        }
    )

    socket.on('disconnect', () => {
        const count =
            (connectedUsers.get(user.sub) ?? 1) - 1

        if (count > 0) {
            connectedUsers.set(
                user.sub,
                count
            )
        } else {
            connectedUsers.delete(user.sub)
        }

        io.emit(
            'presence:count',
            connectedUsers.size
        )
    })
})

/*
|--------------------------------------------------------------------------
| BACKGROUND JOB
|--------------------------------------------------------------------------
|
| Runs every hour and automatically
| marks overdue tasks.
|
*/

cron.schedule(
    '0 * * * *',
    async () => {
        try {
            await db.task.updateMany({
                where: {
                    dueDate: {
                        lt: new Date()
                    },

                    status: {
                        notIn: [
                            TaskStatus.DONE,
                            TaskStatus.OVERDUE
                        ]
                    }
                },

                data: {
                    status: TaskStatus.OVERDUE
                }
            })
        } catch (error) {
            console.error(
                'Overdue task scheduler failed'
            )
        }
    }
)

/*
|--------------------------------------------------------------------------
| 404 HANDLER
|--------------------------------------------------------------------------
*/

app.use((_req, res) => {
    sendError(
        res,
        404,
        'Route not found'
    )
})

/*
|--------------------------------------------------------------------------
| GLOBAL ERROR HANDLER
|--------------------------------------------------------------------------
*/

app.use(
    (
        error: unknown,
        _req: Request,
        res: Response,
        _next: NextFunction
    ) => {
        console.error(error)

        if (res.headersSent) {
            return
        }

        sendError(
            res,
            500,
            'Internal server error'
        )
    }
)

/*
|--------------------------------------------------------------------------
| START SERVER
|--------------------------------------------------------------------------
*/

server.listen(PORT, () => {
    console.log(
        `Velozity API listening on port ${PORT}`
    )
})

