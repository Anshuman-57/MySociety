import type { Me } from './types';

export type Context = { id: string; label: string; home: string };

export function setupActions(me: Me, contextId: string): [string, string][] {
  if (contextId === 'admin' && me.user.isPlatformAdmin) return [['/society/register', 'Add society']];
  if (contextId === 'secretary' && me.secretaryOf?.status === 'APPROVED') return [['/home/register', 'Add home']];
  if (contextId === 'visitor' || contexts(me).some(row => row.id === contextId && row.id.startsWith('home:'))) {
    return [['/home/join', 'Join existing home']];
  }
  return [];
}

// Workspace choices come from approved server memberships, never from the login dropdown.
export function contexts(me: Me): Context[] {
  return [
    { id: 'visitor', label: 'Visitor', home: '/pass' },
    ...(me.user.isPlatformAdmin ? [{ id: 'admin', label: 'Platform Admin', home: '/admin/societies' }] : []),
    ...(me.secretaryOf?.status === 'APPROVED'
      ? [{ id: 'secretary', label: 'Secretary · ' + me.secretaryOf.name, home: '/secretary' }] : []),
    ...me.guardIn.filter(row => row.guard.status === 'APPROVED' && row.society.status === 'APPROVED').map(row =>
      ({ id: 'guard:' + row.society.id, label: 'Guard · ' + row.society.name, home: '/guard' })),
    ...me.flats.filter(row => row.member.status === 'APPROVED' && row.flat.status === 'APPROVED' && row.society.status === 'APPROVED').map(row =>
      ({ id: 'home:' + row.flat.id, label: 'Resident · ' + row.society.name + ' ' + row.flat.label, home: '/home/' + row.flat.id }))
  ];
}
