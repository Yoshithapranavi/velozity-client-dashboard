import { useEffect, useMemo, useState } from 'react'
import { Activity, Bell, CalendarDays, Check, ChevronDown, CircleHelp, Clock3, FolderKanban, LayoutDashboard, MoreHorizontal, Plus, Search, Settings, ShieldCheck, SlidersHorizontal, Users, Zap } from 'lucide-react'
import { io } from 'socket.io-client'
import { API_URL, getAccessToken, getActivity, getNotifications, getTasks, login, refresh, updateTaskStatus } from './api'
import './App.css'

type Status = 'In progress' | 'In review' | 'To do' | 'Done' | 'Overdue'
type Priority = 'Critical' | 'High' | 'Medium' | 'Low'
type Task = { id: number; title: string; project: string; status: Status; priority: Priority; due: string }

const tasks: Task[] = [
    { id: 12, title: 'Checkout flow QA + handoff', project: 'Northstar Commerce', status: 'In review', priority: 'Critical', due: 'Today' },
    { id: 18, title: 'Integrate Stripe webhooks', project: 'Northstar Commerce', status: 'In progress', priority: 'High', due: 'Sep 13' },
    { id: 22, title: 'Mobile navigation states', project: 'Fieldwork Mobile', status: 'In progress', priority: 'High', due: 'Sep 15' },
    { id: 9, title: 'Content model migration', project: 'Atlas Rebrand', status: 'To do', priority: 'Medium', due: 'Sep 18' },
    { id: 27, title: 'Empty state illustrations', project: 'Fieldwork Mobile', status: 'Done', priority: 'Low', due: 'Sep 09' },
]
const activities = [
    ['Ravi Kumar', 'RK', 'moved Task #12 from In progress to In review', '2 mins ago', 'blue'],
    ['Amelia Ng', 'AN', 'was assigned to Checkout flow QA + handoff', '18 mins ago', 'yellow'],
    ['Maya Singh', 'MS', 'completed Mobile navigation states', '44 mins ago', 'green'],
    ['Jordan Park', 'JP', 'added a comment on Atlas Rebrand', '1 hr ago', 'pink'],
]

function App() {
    const [user, setUser] = useState<{ name: string; role: string } | null>(null)
    const [loginForm, setLoginForm] = useState({ email: 'admin@velozity.local', password: 'ChangeMe123!' })
    const [loginError, setLoginError] = useState('')
    const [activeNav, setActiveNav] = useState('Overview')
    const [status, setStatus] = useState('All status')
    const [priority, setPriority] = useState('All priority')
    const [notifications, setNotifications] = useState(false)
    const [workspaceOpen, setWorkspaceOpen] = useState(false)
    const [profileOpen, setProfileOpen] = useState(false)
    const [helpOpen, setHelpOpen] = useState(false)
    const [dateFilterOpen, setDateFilterOpen] = useState(false)
    const [notice, setNotice] = useState('')
    const [projectFormOpen, setProjectFormOpen] = useState(false)
    const [taskFormOpen, setTaskFormOpen] = useState(false)
    const [selectedProject, setSelectedProject] = useState('')
    const [taskItems, setTaskItems] = useState(tasks)
    const [feedItems, setFeedItems] = useState(activities)
    const [notificationItems, setNotificationItems] = useState<Array<{ id: string; message: string; readAt: string | null }>>([])
    const [presenceCount, setPresenceCount] = useState(12)
    const filteredTasks = useMemo(() => taskItems.filter((task) => (status === 'All status' || task.status === status) && (priority === 'All priority' || task.priority === priority)), [priority, status, taskItems])
    useEffect(() => { const params = new URLSearchParams(window.location.search); status === 'All status' ? params.delete('status') : params.set('status', status); priority === 'All priority' ? params.delete('priority') : params.set('priority', priority); window.history.replaceState({}, '', `${window.location.pathname}${params.toString() ? `?${params}` : ''}`) }, [priority, status])
    const announce = (message: string) => { const projects = ['Northstar Commerce', 'Fieldwork Mobile', 'Atlas Rebrand']; const selected = projects.find((project) => message === `${project} selected`); if (selected) { setSelectedProject(selected); setActiveNav('Projects') }; if (message.startsWith('Access and roles')) setActiveNav('Access & roles'); if (message.startsWith('Settings is')) setActiveNav('Settings'); setNotice(message); window.setTimeout(() => setNotice(''), 2600) }
    const navigate = (label: string) => { if (label === 'Projects' || label === 'Overview') setSelectedProject(''); setWorkspaceOpen(false); setHelpOpen(false); setProfileOpen(false); setActiveNav(label); announce(`${label} view selected`) }
    const cycleTaskStatus = (taskId: number) => { const current = taskItems.find((task) => task.id === taskId); if (!current) return; const nextStatus: Status = current.status === 'Done' ? 'To do' : 'Done'; setTaskItems((items) => items.map((task) => task.id === taskId ? { ...task, status: nextStatus } : task)); if (user) updateTaskStatus(taskId, nextStatus === 'Done' ? 'DONE' : 'TODO').catch(() => announce('Status saved in preview mode')) }
    useEffect(() => { refresh().then((session) => { if (session) setUser(session) }).catch(() => undefined) }, [])
    useEffect(() => {
        if (!user) return

        const loadData = async () => {
            const [remoteTasks, remoteActivity, remoteNotifications] =
                await Promise.all([
                    getTasks(),
                    getActivity(),
                    getNotifications()
                ])

            setTaskItems(
                remoteTasks.map((task) => ({
                    id: task.id,
                    title: task.title,
                    project: task.project.name,

                    status: ({
                        TODO: 'To do',
                        IN_PROGRESS: 'In progress',
                        IN_REVIEW: 'In review',
                        DONE: 'Done',
                        OVERDUE: 'Overdue'
                    } as Record<string, Status>)[task.status] ?? 'To do',

                    priority:
                        task.priority[0] +
                        task.priority.slice(1).toLowerCase() as Priority,

                    due: new Date(task.dueDate).toLocaleDateString(
                        'en-US',
                        {
                            month: 'short',
                            day: 'numeric'
                        }
                    )
                }))
            )

            setFeedItems(
                remoteActivity.map((item) => [
                    item.actor.name,

                    item.actor.name
                        .split(' ')
                        .map((part) => part[0])
                        .join('')
                        .slice(0, 2),

                    item.message,

                    new Date(item.createdAt).toLocaleString(),

                    'blue'
                ] as [string, string, string, string, string])
            )

            setNotificationItems(remoteNotifications)
        }

        loadData().catch(() => undefined)

        const socket = io(API_URL, {
            auth: {
                token: getAccessToken()
            }
        })

        socket.on('activity:new', () => {
            loadData().catch(() => undefined)
        })

        socket.on('notification:new', () => {
            getNotifications()
                .then(setNotificationItems)
                .catch(() => undefined)
        })

        socket.on('presence:count', (count: number) => {
            setPresenceCount(count)
        })

        return () => {
            socket.disconnect()
        }
    }, [user])
    void feedItems; void notificationItems; void presenceCount
    if (!user) return <LoginScreen form={loginForm} setForm={setLoginForm} error={loginError} onSubmit={async (event) => { event.preventDefault(); try { const session = await login(loginForm.email, loginForm.password); setUser(session); setLoginError('') } catch (error) { setLoginError(error instanceof Error ? error.message : 'Unable to sign in') } }} />

    return <div className="app-shell">
        <aside className="sidebar">
            <div className="brand"><div className="brand-mark">V</div><span>velozity<span className="brand-dot">.</span></span></div>
            <button className="workspace-switcher" onClick={() => setWorkspaceOpen(!workspaceOpen)}><div className="workspace-icon">G</div><div><strong>Global Solutions</strong><small>Agency workspace</small></div><ChevronDown size={15} /></button>{workspaceOpen && <div className="workspace-menu"><strong>Global Solutions</strong><button onClick={() => { setWorkspaceOpen(false); announce('Global Solutions workspace selected') }}>Open workspace</button><button onClick={() => { setWorkspaceOpen(false); navigate('Settings') }}>Workspace settings</button></div>}
            <nav><p className="nav-label">Workspace</p>{[['Overview', LayoutDashboard], ['Projects', FolderKanban], ['Team', Users], ['Activity', Activity]].map(([label, Icon]) => <button className={`nav-item ${activeNav === label ? 'active' : ''}`} key={label as string} onClick={() => navigate(label as string)}><Icon size={17} /><span>{label as string}</span>{label === 'Activity' && <span className="nav-count">8</span>}</button>)}<p className="nav-label section-label">Manage</p><button className="nav-item" onClick={() => announce('Access and roles is available in the API setup')}><ShieldCheck size={17} /><span>Access & roles</span></button><button className="nav-item" onClick={() => announce('Settings is available in the API setup')}><Settings size={17} /><span>Settings</span></button></nav>
            <div className="sidebar-footer"><button className="help" onClick={() => setHelpOpen(!helpOpen)}><CircleHelp size={17} /><span>Help center</span></button>{helpOpen && <div className="help-popover"><strong>Quick help</strong><p>Use the sidebar to switch between Overview, Projects, Team, Activity, Access & roles, and Settings.</p><button onClick={() => { setHelpOpen(false); navigate('Projects') }}>Open projects</button><button onClick={() => { setHelpOpen(false); navigate('Activity') }}>View activity</button><button onClick={() => setHelpOpen(false)}>Close</button></div>}<button className="user-block" onClick={() => setProfileOpen(!profileOpen)}><div className="avatar avatar-purple">SK</div><div><strong>Shreya Kapoor</strong><small>Administrator</small></div><MoreHorizontal size={17} /></button>{profileOpen && <div className="profile-popover"><strong>Shreya Kapoor</strong><span>Administrator</span><button onClick={() => { setProfileOpen(false); navigate('Settings') }}>Profile settings</button><button onClick={() => announce('Signed out in preview mode')}>Sign out</button></div>}</div>
        </aside>
        <main className="main-content">
            <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span>/</span><strong>{activeNav}</strong></div><div className="top-actions"><div className="search"><Search size={16} /><input placeholder="Search anything" onChange={(event) => event.target.value && navigate('Search')} /><kbd>⌘ K</kbd></div><button className="icon-btn notification-btn" onClick={() => setNotifications(!notifications)} aria-label="Notifications"><Bell size={18} /><span>3</span></button><div className="live-status"><i></i> Live <span className="online-number">12</span></div></div>{notifications && <div className="notification-popover"><div className="popover-heading"><strong>Notifications</strong><button onClick={() => { setNotifications(false); announce('Notifications marked as read') }}>Mark all read</button></div><p><b>Amelia Ng</b> was assigned a task in Northstar Commerce.</p><p><b>Task #12</b> is ready for your review.</p><p><b>Maya Singh</b> joined the workspace.</p></div>}</header>
            <div className={`content-wrap ${activeNav !== 'Overview' ? 'secondary-view' : ''}`} onClick={(event) => { const target = event.target as HTMLElement; const button = target.closest('button'); if (button?.textContent?.includes('Add task')) setTaskFormOpen(true); if (button?.textContent?.includes('New project')) setProjectFormOpen(true); if (button?.textContent?.includes('Due date')) setDateFilterOpen(true); const circle = target.closest('.task-check'); if (circle && circle.tagName !== 'BUTTON') { const row = circle.closest('.task-row'); const id = Number(row?.textContent?.match(/#(\d+)/)?.[1]); if (id) cycleTaskStatus(id) } }}>
                <WorkspaceView activeNav={activeNav} selectedProject={selectedProject} taskItems={taskItems} onBack={() => { setSelectedProject(''); setActiveNav('Overview') }} onSelectProject={(project) => { setSelectedProject(project); announce(`${project} selected`) }} onToggleTask={cycleTaskStatus} />
                <div className="page-heading"><div><p className="eyebrow">Thursday, September 11, 2026</p><h1>Good morning, Shreya <span>✦</span></h1><p className="subheading">Here is what is happening across your workspace.</p></div><button className="primary-btn" onClick={() => { setProjectFormOpen(true); setActiveNav('Projects') }}><Plus size={17} /> New project</button></div>
                <section className="metric-grid"><Metric icon={<FolderKanban />} label="Active projects" value="08" detail="2 due this week" accent="blue" /><Metric icon={<Check />} label="Tasks completed" value="64" detail="+18.2% vs last month" accent="green" /><Metric icon={<Clock3 />} label="Needs attention" value="07" detail="3 are overdue" accent="orange" /><Metric icon={<Users />} label="Team online" value="12" detail="of 18 members" accent="purple" live /></section>
                <div className="section-title"><div><h2>Project pulse</h2><p>Quick look at delivery health across active projects.</p></div><button className="text-btn" onClick={() => navigate('Projects')}>View all projects <span>→</span></button></div>
                <section className="project-grid"><ProjectCard name="Northstar Commerce" client="Arc & Anchor" tag="E-commerce" progress={78} tasks="14 / 18" due="Sep 16" color="navy" onOpen={() => announce('Northstar Commerce selected')} /><ProjectCard name="Fieldwork Mobile" client="Fieldwork Labs" tag="Product design" progress={46} tasks="9 / 21" due="Sep 22" color="coral" onOpen={() => announce('Fieldwork Mobile selected')} /><ProjectCard name="Atlas Rebrand" client="Atlas Finance" tag="Brand identity" progress={92} tasks="23 / 25" due="Sep 12" color="olive" onOpen={() => announce('Atlas Rebrand selected')} /></section>
                <div className="dashboard-columns"><section className="panel task-panel"><div className="panel-heading"><div><h2>My tasks</h2><p>Assigned across all projects</p></div><button className="more-btn" onClick={() => announce('Use the filters below to narrow tasks')}><SlidersHorizontal size={16} /> Filters</button></div><div className="filters"><FilterSelect value={status} setValue={setStatus} options={['All status', 'To do', 'In progress', 'In review', 'Done']} /><FilterSelect value={priority} setValue={setPriority} options={['All priority', 'Critical', 'High', 'Medium', 'Low']} /><button className="date-filter" onClick={() => announce('Due-date range is ready for API connection')}><CalendarDays size={15} /> Due date <ChevronDown size={14} /></button></div><div className="task-table"><div className="table-head"><span>Task</span><span>Status</span><span>Priority</span><span>Due date</span></div>{filteredTasks.map((task) => <div className="task-row" key={task.id}><div className="task-name"><span className={`task-check ${task.status === 'Done' ? 'checked' : ''}`}>{task.status === 'Done' && <Check size={12} />}</span><div><strong>{task.title}</strong><small>{task.project} · #{task.id}</small></div></div><span className={`status-pill ${task.status.toLowerCase().replace(' ', '-')}`}>{task.status}</span><span className={`priority ${task.priority.toLowerCase()}`}><i></i>{task.priority}</span><span>{task.due}</span></div>)}</div></section><section className="panel activity-panel"><div className="panel-heading"><div><h2>Live activity</h2><p>Updates from your workspace</p></div><span className="socket-state"><i></i> Connected</span></div><div className="activity-list">{activities.map(([name, initials, text, time, tone]) => <div className="activity-item" key={name + time}><div className={`avatar avatar-${tone}`}>{initials}</div><div><p><strong>{name}</strong> {text}</p><small>{time}</small></div></div>)}</div><button className="activity-footer" onClick={() => navigate('Activity')}>Open activity feed <span>↗</span></button></section></div>
                <footer><span><Zap size={14} /> Built for focused delivery</span><span>Last synced just now</span></footer>
            </div>
        </main>
        {notice && <div className="notice-toast" role="status">{notice}</div>}
        {projectFormOpen && <div className="modal-backdrop" role="presentation" onClick={() => setProjectFormOpen(false)}><form className="project-form" onSubmit={(event) => { event.preventDefault(); setProjectFormOpen(false); announce('Project saved in preview mode') }} onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><h2>New project</h2><p>Start a project in the Global Solutions workspace.</p></div><button type="button" className="modal-close" onClick={() => setProjectFormOpen(false)} aria-label="Close new project">×</button></div><label>Project name<input required placeholder="e.g. Northstar Commerce" /></label><label>Client<input required placeholder="e.g. Arc & Anchor" /></label><label>Project type<select defaultValue="Product delivery"><option>Product delivery</option><option>Brand identity</option><option>Product design</option></select></label><div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => setProjectFormOpen(false)}>Cancel</button><button type="submit" className="primary-btn">Create project</button></div></form></div>}
        {taskFormOpen && <div className="modal-backdrop" role="presentation" onClick={() => setTaskFormOpen(false)}><form className="project-form" onSubmit={(event) => { event.preventDefault(); setTaskFormOpen(false); announce('Task saved in preview mode') }} onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><h2>Add task</h2><p>Add work to {selectedProject}.</p></div><button type="button" className="modal-close" onClick={() => setTaskFormOpen(false)} aria-label="Close add task">×</button></div><label>Task title<input required placeholder="e.g. Prepare handoff notes" /></label><label>Assigned developer<select defaultValue="Ravi Kumar"><option>Ravi Kumar</option><option>Amelia Ng</option><option>Mohit Shah</option><option>Priya Rao</option></select></label><label>Priority<select defaultValue="High"><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select></label><div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => setTaskFormOpen(false)}>Cancel</button><button type="submit" className="primary-btn">Add task</button></div></form></div>}
        {dateFilterOpen && <div className="date-popover"><strong>Filter by due date</strong><label>From<input type="date" /></label><label>To<input type="date" /></label><div className="modal-actions"><button className="secondary-btn" onClick={() => setDateFilterOpen(false)}>Cancel</button><button className="primary-btn" onClick={() => { setDateFilterOpen(false); announce('Due-date filter applied') }}>Apply</button></div></div>}
    </div>
}

function WorkspaceView({ activeNav, selectedProject, taskItems, onBack, onSelectProject, onToggleTask }: { activeNav: string; selectedProject: string; taskItems: Task[]; onBack: () => void; onSelectProject: (project: string) => void; onToggleTask: (taskId: number) => void }) {
    if (activeNav === 'Projects' && selectedProject) return <section className="secondary-view-content workspace-panel"><button className="back-link" onClick={onBack}>← Back to overview</button><div className="detail-hero"><div><p className="eyebrow">Project workspace</p><h1>{selectedProject}</h1><p className="subheading">Delivery plan, task ownership, and recent project activity.</p></div><button className="primary-btn"><Plus size={17} /> Add task</button></div><div className="detail-grid"><div className="panel detail-card"><h2>Project progress</h2><strong className="detail-number">78%</strong><div className="progress-track"><div style={{ width: '78%' }} /></div><p>14 of 18 tasks complete</p></div><div className="panel detail-card"><h2>Project team</h2><div className="member-line"><div className="avatar avatar-blue">RK</div><span>Ravi Kumar</span><small>Developer</small></div><div className="member-line"><div className="avatar avatar-yellow">AN</div><span>Amelia Ng</span><small>Developer</small></div></div></div><div className="panel detail-card"><div className="panel-heading"><div><h2>Project tasks</h2><p>Recent work for this project</p></div><button className="more-btn">Filter tasks</button></div>{taskItems.slice(0, 3).map((task) => <div className="task-row detail-task" key={task.id}><div className="task-name"><button className={`task-check ${task.status === 'Done' ? 'checked' : ''}`} onClick={() => onToggleTask(task.id)} aria-label={`Toggle ${task.title}`}>{task.status === 'Done' && <Check size={12} />}</button><div><strong>{task.title}</strong><small>#{task.id}</small></div></div><span className={`status-pill ${task.status.toLowerCase().replace(' ', '-')}`}>{task.status}</span><span className={`priority ${task.priority.toLowerCase()}`}><i />{task.priority}</span><span>{task.due}</span></div>)}</div></section>
    if (activeNav === 'Projects') return <section className="secondary-view-content workspace-panel"><div className="detail-hero"><div><p className="eyebrow">Workspace</p><h1>Projects</h1><p className="subheading">Choose a project to open its delivery workspace.</p></div><button className="primary-btn"><Plus size={17} /> New project</button></div><div className="project-grid"><ProjectCard name="Northstar Commerce" client="Arc & Anchor" tag="E-commerce" progress={78} tasks="14 / 18" due="Sep 16" color="navy" onOpen={() => onSelectProject('Northstar Commerce')} /><ProjectCard name="Fieldwork Mobile" client="Fieldwork Labs" tag="Product design" progress={46} tasks="9 / 21" due="Sep 22" color="coral" onOpen={() => onSelectProject('Fieldwork Mobile')} /><ProjectCard name="Atlas Rebrand" client="Atlas Finance" tag="Brand identity" progress={92} tasks="23 / 25" due="Sep 12" color="olive" onOpen={() => onSelectProject('Atlas Rebrand')} /></div></section>
    if (activeNav === 'Activity') return <section className="secondary-view-content workspace-panel"><div className="detail-hero"><div><p className="eyebrow">Workspace</p><h1>Activity feed</h1><p className="subheading">Recent changes visible to your role.</p></div><button className="secondary-btn" onClick={onBack}>Back to overview</button></div><div className="panel activity-panel activity-page"><div className="activity-list">{activities.concat([['Priya Rao', 'PR', 'joined the Fieldwork Mobile project', '2 hrs ago', 'purple']]).map(([name, initials, text, time, tone]) => <div className="activity-item" key={name + time}><div className={`avatar avatar-${tone}`}>{initials}</div><div><p><strong>{name}</strong> {text}</p><small>{time}</small></div></div>)}</div></div></section>
    if (activeNav === 'Team') return <section className="secondary-view-content workspace-panel"><div className="detail-hero"><div><p className="eyebrow">Workspace</p><h1>Team directory</h1><p className="subheading">18 people across project delivery, design, and engineering.</p></div><button className="secondary-btn" onClick={onBack}>Back to overview</button></div><div className="panel people-grid">{[['SK', 'Shreya Kapoor', 'Administrator'], ['MS', 'Maya Singh', 'Project Manager'], ['JP', 'Jordan Park', 'Project Manager'], ['RK', 'Ravi Kumar', 'Developer'], ['AN', 'Amelia Ng', 'Developer'], ['MS', 'Mohit Shah', 'Developer'], ['PR', 'Priya Rao', 'Developer']].map(([initials, name, role]) => <div className="person-card" key={name}><div className="avatar avatar-blue">{initials}</div><div><strong>{name}</strong><small>{role}</small></div><span className="online-mark">Online</span></div>)}</div></section>
    if (activeNav === 'Access & roles') return <section className="secondary-view-content workspace-panel"><div className="detail-hero"><div><p className="eyebrow">Manage</p><h1>Access & roles</h1><p className="subheading">Permission boundaries for this workspace.</p></div><button className="secondary-btn" onClick={onBack}>Back to overview</button></div><div className="panel role-list"><RoleRow name="Administrator" description="All clients, projects, users, and activity" count="1 user" color="purple" /><RoleRow name="Project Manager" description="Own projects, assigned tasks, and team activity" count="2 users" color="blue" /><RoleRow name="Developer" description="Assigned tasks and assigned-task activity only" count="4 users" color="green" /></div></section>
    if (activeNav === 'Settings') return <section className="secondary-view-content workspace-panel"><div className="detail-hero"><div><p className="eyebrow">Manage</p><h1>Settings</h1><p className="subheading">Workspace preferences and delivery defaults.</p></div><button className="secondary-btn" onClick={onBack}>Back to overview</button></div><div className="panel settings-list"><label className="setting-row"><span><strong>Workspace name</strong><small>Shown to members in the workspace switcher.</small></span><input defaultValue="Global Solutions" /></label><label className="setting-row"><span><strong>Overdue task scan</strong><small>Scheduled background job runs hourly.</small></span><select defaultValue="Every hour"><option>Every hour</option><option>Every 30 minutes</option></select></label><label className="setting-row"><span><strong>Activity retention</strong><small>Feed reconnect returns the latest 20 database events.</small></span><span className="setting-value">20 events</span></label></div></section>
    const title = activeNav === 'Search' ? 'Search results' : activeNav
    const copy = activeNav === 'Team' ? '18 members across design, engineering, and project delivery.' : activeNav === 'Activity' ? 'A role-filtered timeline of the latest workspace events.' : activeNav === 'Access & roles' ? 'Review workspace permissions and role assignments.' : activeNav === 'Settings' ? 'Workspace preferences and integration settings.' : 'Search across projects, tasks, and people.'
    return <section className="secondary-view-content workspace-panel"><div className="detail-hero"><div><p className="eyebrow">Workspace</p><h1>{title}</h1><p className="subheading">{copy}</p></div><button className="secondary-btn" onClick={onBack}>Back to overview</button></div><div className="panel empty-workspace"><div className="empty-icon">{activeNav === 'Team' ? <Users /> : activeNav === 'Activity' ? <Activity /> : activeNav === 'Settings' ? <Settings /> : <ShieldCheck />}</div><h2>{activeNav === 'Activity' ? 'Activity feed' : activeNav === 'Team' ? 'Team directory' : 'Workspace controls'}</h2><p>The workspace view is ready for the API-backed data and permissions layer.</p><div className="empty-actions"><button className="primary-btn" onClick={() => onBack()}>Return to overview</button></div></div></section>
}

function LoginScreen({ form, setForm, error, onSubmit }: { form: { email: string; password: string }; setForm: (form: { email: string; password: string }) => void; error: string; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) { return <div className="login-shell"><form className="login-card" onSubmit={onSubmit}><div className="brand login-brand"><div className="brand-mark">V</div><span>velozity<span className="brand-dot">.</span></span></div><p className="eyebrow">Global Solutions workspace</p><h1>Welcome back</h1><p className="subheading">Sign in to manage projects, tasks, and team activity.</p><label>Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Password<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>{error && <p className="login-error">{error}</p>}<button className="primary-btn login-button" type="submit">Sign in</button><small className="login-hint">Seed admin: admin@velozity.local / ChangeMe123!</small></form></div> }
function Metric({ icon, label, value, detail, accent, live }: { icon: React.ReactNode; label: string; value: string; detail: string; accent: string; live?: boolean }) { return <div className="metric"><div className={`metric-icon ${accent}`}>{icon}</div><div className="metric-label">{label}{live && <span className="live-dot" />}</div><strong>{value}</strong><small>{detail}</small></div> }
function RoleRow({ name, description, count, color }: { name: string; description: string; count: string; color: string }) {
    const [expanded, setExpanded] = useState(false)
    const permissions = name === 'Administrator' ? ['Manage clients and projects', 'Manage users and roles', 'View global activity'] : name === 'Project Manager' ? ['Create and manage owned projects', 'Assign tasks to developers', 'View owned-project activity'] : ['View assigned tasks only', 'Update assigned task status', 'View assigned-task activity']
    return <div className={`role-row ${expanded ? 'expanded' : ''}`}><div className={`role-icon ${color}`}><ShieldCheck size={17} /></div><div className="role-copy"><strong>{name}</strong><small>{description}</small>{expanded && <div className="permission-list">{permissions.map((permission) => <span key={permission}><Check size={13} />{permission}</span>)}</div>}</div><span>{count}</span><button className="more-btn" onClick={() => setExpanded(!expanded)}>{expanded ? 'Close' : 'Manage'}</button></div>
}
function ProjectCard({ name, client, tag, progress, tasks: taskCount, due, color, onOpen }: { name: string; client: string; tag: string; progress: number; tasks: string; due: string; color: string; onOpen: () => void }) { return <article className={`project-card ${color}`} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && onOpen()}><div className="project-top"><span className="project-tag">{tag}</span><button aria-label={`More options for ${name}`} onClick={(event) => { event.stopPropagation(); onOpen() }}><MoreHorizontal size={18} /></button></div><h3>{name}</h3><p>{client}</p><div className="progress-label"><span>Progress</span><strong>{progress}%</strong></div><div className="progress-track"><div style={{ width: `${progress}%` }} /></div><div className="project-meta"><span>{taskCount} tasks</span><span>Due {due}</span></div></article> }
function FilterSelect({ value, setValue, options }: { value: string; setValue: (value: string) => void; options: string[] }) { return <label className="filter-select"><select value={value} onChange={(event) => setValue(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select><ChevronDown size={14} /></label> }

export default App
