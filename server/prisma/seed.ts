import { PrismaClient, Role, Priority, TaskStatus } from '@prisma/client'
import bcrypt from 'bcryptjs'
const db = new PrismaClient()
const passwordHash = await bcrypt.hash('ChangeMe123!', 12)
const users = await Promise.all([
    ['admin@velozity.local', 'Shreya Kapoor', Role.ADMIN], ['maya@velozity.local', 'Maya Singh', Role.PM], ['jordan@velozity.local', 'Jordan Park', Role.PM],
    ['ravi@velozity.local', 'Ravi Kumar', Role.DEVELOPER], ['amelia@velozity.local', 'Amelia Ng', Role.DEVELOPER], ['mohit@velozity.local', 'Mohit Shah', Role.DEVELOPER], ['priya@velozity.local', 'Priya Rao', Role.DEVELOPER],
].map(([email, name, role]) => db.user.create({ data: { email, name, role: role as Role, passwordHash } })))
const clients = await Promise.all(['Arc & Anchor', 'Fieldwork Labs', 'Atlas Finance'].map(name => db.client.create({ data: { name } })))
for (const [index, name] of ['Northstar Commerce', 'Fieldwork Mobile', 'Atlas Rebrand'].entries()) {
    const project = await db.project.create({ data: { name, ownerId: users[index % 3 + 1].id, clientId: clients[index].id } })
    for (let taskIndex = 0; taskIndex < 5; taskIndex++) await db.task.create({ data: { title: `${name} task ${taskIndex + 1}`, projectId: project.id, assigneeId: users[3 + taskIndex % 4].id, priority: [Priority.CRITICAL, Priority.HIGH, Priority.MEDIUM, Priority.LOW][taskIndex % 4], status: taskIndex === 0 && index < 2 ? TaskStatus.OVERDUE : [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW, TaskStatus.DONE][taskIndex % 4], dueDate: new Date(Date.now() + (taskIndex - (index < 2 ? 1 : 4)) * 86400000) } })
    await db.activity.create({ data: { projectId: project.id, actorId: users[1].id, message: `Seed activity for ${name}` } })
}
console.log('Seeded 1 admin, 2 PMs, 4 developers, 3 projects, and 15 tasks.')
await db.$disconnect()
