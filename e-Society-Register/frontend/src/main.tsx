import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { accessToken, origin, refreshSession, toast, useList } from './api';
import { Brand, Login, Notifications, Profile, useLogout, useMe, type Notice } from './account';
import { AdminActivity, AdminSocieties, Secretary, SocietyRegistration } from './management';
import { GuardPage } from './guard';
import { Resident } from './resident';
import { JoinPage, MyPass, VisitDetail } from './visitor';
import type { Me } from './types';
import { Badge, Button, Card, Heading, Toasts } from './ui';
import './styles.css';
import { contexts, setupActions, type Context } from './workspaces';

function useRealtime(token: string | null) {
  const cache = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!token) return;
    const socket = io(origin, { auth: { token } });
    const invalidate = (match: RegExp) => void cache.invalidateQueries({ predicate: query => match.test(String(query.queryKey[0])) });
    socket.on('connect', () => { setConnected(true); invalidate(/^\//); socket.emit('rooms:refresh'); });
    socket.on('disconnect', reason => {
      setConnected(false);
      if (reason === 'io server disconnect' && accessToken()) void refreshSession().catch(() => {});
    });
    socket.on('connect_error', error => {
      setConnected(false);
      if (error.message === 'UNAUTHORIZED' && token === accessToken()) void refreshSession().catch(() => {});
    });
    socket.on('notification:new', (notice: Notice) => { toast(notice.title); invalidate(/^\/notifications/); });
    socket.on('visit:created', () => invalidate(/\/visits/));
    socket.on('visit:updated', () => invalidate(/\/visits/));
    socket.on('visit:handled', (row: { respondedBy: { name: string } }) => {
      toast('Visit handled by ' + row.respondedBy.name); invalidate(/\/visits/);
    });
    socket.on('duty:updated', () => invalidate(/\/duty|\/gates/));
    socket.on('membership:updated', () => { invalidate(/^\/me$|\/flats|\/guards/); socket.emit('rooms:refresh'); });
    return () => { socket.disconnect(); setConnected(false); };
  }, [token, cache]);
  return connected;
}
function Home({ me, items, select, actions }: { me: Me; items: Context[]; select: (context: Context) => void; actions: [string, string][] }) {
  const pending = me.flats.filter(row => row.member.role === 'MEMBER' && row.member.status === 'PENDING')
    .map(row => ({ title: row.society.name + ' / ' + row.flat.label, state: 'PENDING' }));
  return <><Heading title={'Welcome, ' + me.user.firstName} note="Open a workspace to manage visits, approvals, or gate duty."/>
    <div className="stack"><Card title="Your workspaces"><div className="grid gap-3 sm:grid-cols-2">
      {items.map(item => <button className="row text-left hover:bg-emerald-50" type="button" key={item.id} onClick={() => select(item)}>
        <strong>{item.label}</strong><span aria-hidden="true">→</span></button>)}</div></Card>
      {!!pending.length && <Card title="Applications">{pending.map((item, index) => <div className="row" key={index}><strong>{item.title}</strong>
        <div className="actions"><Badge value={item.state}/></div></div>)}</Card>}
      {!!actions.length && <Card title="Quick actions"><div className="actions">{actions.map(([path, label]) =>
        <Link key={path} className="button secondary" to={path}>{label}</Link>)}</div></Card>}
    </div>
  </>;
}
function RoleScreen({ render }: { render: (section?: string) => ReactNode }) {
  const { section } = useParams();
  return <>{render(section)}</>;
}
function Shell({ me, connected }: { me: Me; connected: boolean }) {
  const all = contexts(me);
  const [selection, setSelection] = useState(() => localStorage.getItem('context:' + me.user.id));
  const selected = all.find(item => item.id === selection) ?? all[0];
  const navigate = useNavigate();
  const { logout, busy } = useLogout();
  const unread = useList('/notifications?unread=true', 1);
  const admin = selected.id === 'admin';
  const setup = setupActions(me, selected.id);
  const allowedSetup = (path: string) => setup.some(([href]) => href === path);
  const actions: [string, string][] = selected.id === 'visitor' ? [...setup, ['/visit/new', 'Request a visit']] : setup;
  const secretary = selected.id === 'secretary' ? me.secretaryOf : null;
  const worker = me.guardIn.find(row => selected.id === 'guard:' + row.society.id);
  const resident = me.flats.find(row => selected.id === 'home:' + row.flat.id);
  const path = resident ? '/home/' + resident.flat.id : '';
  const secretaryLinks = [['/secretary', 'Overview'], ['/secretary/gates', 'Gates'], ['/secretary/guards', 'Guards'], ['/secretary/homes', 'Homes'],
    ['/secretary/visits', 'Visit activity'], ['/secretary/emergency', 'Emergency log'], ['/secretary/audit', 'Audit history']];
  const nav = admin ? [['/admin/societies', 'Societies'], ['/admin/visits', 'Visitor records'], ['/admin/audit', 'Audit history']] : secretary ?
    (secretary.status === 'APPROVED' ? [...secretaryLinks, ['/society/register', 'Society details']] : [['/society/register', 'Society details']]) :
    worker ? [['/guard', 'Gate duty'], ['/guard/scan', 'Scan at gate'], ['/guard/walkin', 'Walk-ins'], ['/guard/inside', 'Inside now'], ['/guard/history', 'Visit history'], ['/guard/emergency', 'Emergency log']] :
    resident ? [[path, 'Approvals'], [path + '/visits', 'Visit history'], [path + '/members', 'Members'], [path + '/passes', 'Recurring passes'],
      ...(resident.member.role === 'HEAD' ? [[path + '/settings', 'Home settings']] : [])] :
      [['/pass', 'My pass'], ['/visit/new', 'Request a visit']];
  function select(context: Context, target = context.home) {
    localStorage.setItem('context:' + me.user.id, context.id); setSelection(context.id); navigate(target);
  }
  function openNotice(notice: Notice) {
    const { flatId, societyId, visitId } = notice.data;
    const home = all.find(item => item.id === 'home:' + flatId);
    const guard = all.find(item => item.id === 'guard:' + societyId);
    const secretary = all.find(item => item.id === 'secretary' && me.secretaryOf?.id === societyId);
    if (/^SOCIETY_/.test(notice.type)) {
      if (secretary) return select(secretary, '/society/register');
      if (me.secretaryOf?.id === societyId) return select(all[0], '/society/register');
      return navigate('/');
    }
    if (notice.type === 'GUARD_JOIN_REQUEST' && secretary) return select(secretary, '/secretary/guards');
    if (notice.type === 'FLAT_REQUEST' && secretary) return select(secretary, '/secretary/homes');
    if ((notice.type === 'GUARD_APPROVED' || notice.type === 'GUARD_ADDED') && guard) return select(guard);
    if (notice.type === 'MEMBER_JOIN_REQUEST' && home) return select(home, home.home + '/members');
    if (home && /^(MEMBER_|FLAT_|HEAD_TRANSFERRED|VISIT_REQUEST|WALKIN_REQUEST|VISIT_HANDLED|VISIT_OVERSTAY)/.test(notice.type)) return select(home);
    if (visitId && guard && /VISIT_(APPROVED|REJECTED|NO_RESPONSE)/.test(notice.type)) {
      sessionStorage.setItem('walkin:' + societyId, visitId); return select(guard, '/guard/walkin');
    }
    if (visitId) return select(all[0], '/visits/' + visitId);
    navigate('/');
  }
  const fallback = <Navigate to="/" replace/>;
  return <>
    <div className="topbar"><div className="top-inner"><Link to="/" aria-label="MySociety home"><Brand/></Link>
      <div className="actions">
        <span className="text-xs text-slate-600" role="status"><span className={'mr-1 inline-block h-2 w-2 rounded-full ' + (connected ? 'bg-emerald-600' : 'bg-amber-500')}/>{connected ? 'Live' : 'Reconnecting'}</span>
        <select className="!w-auto max-w-[68vw] sm:max-w-xs" aria-label="Workspace" value={selected.id}
          onChange={event => { const item = all.find(row => row.id === event.target.value); if (item) select(item); }}>
          {all.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
        </select>
        <Link className="button secondary" to="/notifications">Notifications{unread.data?.meta?.total ? ' (' + unread.data.meta.total + ')' : ''}</Link>
        <Button secondary disabled={busy} onClick={() => void logout()}>Log out</Button>
      </div>
    </div></div>
    <div className="shell">
      <aside><nav aria-label="Main navigation" className="sidebar">
        {[['/', 'Home'], ...nav, ['/profile', 'Profile & sessions']].map(([href, label]) => <NavLink className="nav-link" key={href} end to={href}>{label}</NavLink>)}
      </nav>{!!setup.length && <nav aria-label="Society and home setup" className="sidebar mt-5 border-t border-slate-200 pt-3">
        <p className="px-3 py-1 text-xs font-semibold text-slate-500">Society &amp; homes</p>
        {setup.map(([href, label]) => <NavLink key={href} className="nav-link" to={href}>{label}</NavLink>)}
      </nav>}</aside>
      <main className="min-w-0"><Routes>
        <Route path="/" element={<Home me={me} items={all} select={select} actions={actions}/>}/>
        <Route path="/profile" element={<Profile me={me}/>}/>
        <Route path="/notifications" element={<Notifications open={openNotice}/>}/>
        <Route path="/society/register" element={admin || secretary || allowedSetup('/society/register') ? <SocietyRegistration me={me} create={admin}/> : fallback}/>
        <Route path="/guard/apply" element={fallback}/>
        <Route path="/home/register" element={allowedSetup('/home/register') ? <JoinPage key="register" kind="register" me={me}/> : fallback}/>
        <Route path="/home/join" element={allowedSetup('/home/join') ? <JoinPage key="join" kind="join" me={me}/> : fallback}/>
        <Route path="/visit/new" element={selected.id === 'visitor' ? <JoinPage key="visit" kind="visit"/> : fallback}/>
        <Route path="/pass" element={selected.id === 'visitor' ? <MyPass/> : fallback}/>
        <Route path="/visits" element={<Navigate to="/pass" replace/>}/>
        <Route path="/visits/:id" element={<VisitDetail/>}/>
        <Route path="/helper" element={<Navigate to="/pass" replace/>}/>
        <Route path="/admin/visits" element={admin ? <AdminActivity/> : fallback}/>
        <Route path="/admin/audit" element={admin ? <AdminActivity key="audit" audit/> : fallback}/>
        <Route path="/admin/societies" element={admin ? <AdminSocieties/> : fallback}/>
        <Route path="/secretary/:section?" element={secretary ? <RoleScreen render={section => <Secretary key={section} property={secretary} section={section}/>}/> : fallback}/>
        <Route path="/guard/:section?" element={worker ? <RoleScreen render={section => <GuardPage key={worker.society.id} society={worker.society.id} section={section}/>}/> : fallback}/>
        <Route path="/home/:id/:section?" element={resident ? <ResidentRoute flat={resident.flat} member={resident.member}/> : fallback}/>
        <Route path="*" element={fallback}/>
      </Routes></main>
    </div>
  </>;
}
function ResidentRoute({ flat, member }: { flat: Me['flats'][number]['flat']; member: Me['flats'][number]['member'] }) {
  const { id, section } = useParams();
  if (id !== flat.id || (section && !['visits', 'members', 'passes', 'settings'].includes(section)) || (section === 'settings' && member.role !== 'HEAD')) return <Navigate to="/" replace/>;
  return <Resident key={id} flat={flat} member={member} section={section}/>;
}
function App() {
  const [token, setToken] = useState(accessToken);
  const cache = useQueryClient();
  useEffect(() => {
    const update = () => { if (!accessToken()) cache.clear(); setToken(accessToken()); };
    window.addEventListener('session', update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener('session', update); window.removeEventListener('storage', update); };
  }, [cache]);
  const profile = useMe(!!token);
  const connected = useRealtime(token);
  return <><Toasts/><Routes>
    <Route path="/login" element={token ? <Navigate to="/" replace/> : <Login key="login"/>}/>
    <Route path="/signup" element={token ? <Navigate to="/" replace/> : <Login key="signup" signup/>}/>
    <Route path="*" element={!token ? <Navigate to="/login" replace/> : profile.data ?
      <Shell key={profile.data.user.id} me={profile.data} connected={connected}/> : <div className="login">
        <Card><Brand/><p>{profile.error?.message || 'Opening your workspace…'}</p>
          {profile.isError && <Button onClick={() => void profile.refetch()}>Retry</Button>}</Card></div>}/>
  </Routes></>;
}
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000 } } });
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><BrowserRouter><App/></BrowserRouter></QueryClientProvider>);
