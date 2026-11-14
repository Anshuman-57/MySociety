import { useState } from 'react';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { useData, useWrite } from './api';
import { fullName, type Flat, type Member, type RecurringPass, type Visit } from './types';
import { Action, Badge, Button, Card, Dialog, Field, Fields, Form, Heading, List, VisitRow, formatDate, human, values } from './ui';
import { GuestFields, VisitList } from './visitor';

type Pass = RecurringPass;
const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const localZone = 'Asia/Kolkata';
function PassForm({ path, pass, done }: { path: string; pass?: Pass; done?: () => void }) {
  const write = useWrite();
  return <Form label={pass ? 'Update pass' : 'Create pass'} submit={async event => {
    const form = new FormData(event.currentTarget);
    const fields = values(event);
    const daysOfWeek = form.getAll('day').map(Number);
    if (!daysOfWeek.length) throw new Error('Select at least one weekday.');
    delete fields.day; delete fields.isActive;
    await write.mutateAsync({ path: path + (pass ? '/' + pass.id : ''), method: pass ? 'PATCH' : 'POST',
      body: { ...fields, daysOfWeek, ...(pass && { isActive: form.has('isActive') }) } });
    done?.();
  }}>
    {!pass && <Fields fields={[[ 'helperPhone', 'Helper’s mobile number (+91)', 'tel' ]]}/>}
    <GuestFields initial={pass?.guestType.id} withPurpose={false}/>
    <fieldset className="stack"><legend className="text-sm font-medium">Days of the week</legend><div className="actions">{days.map((day, index) =>
      <label key={day} className="actions rounded-lg border border-slate-200 p-2 text-sm"><input name="day" value={index} type="checkbox" defaultChecked={pass?.daysOfWeek.includes(index)}/>{day}</label>)}</div></fieldset>
    <Fields fields={[[ 'startTime', 'Start time (IST)', 'time' ], ['endTime', 'End time (IST)', 'time'],
      ['validFrom', 'Start date', 'date'], ['validTo', 'End date (optional)', 'date?' ]]} initial={pass ?? { validFrom: formatInTimeZone(new Date(), localZone, 'yyyy-MM-dd') }}/>
    {pass && <label className="actions"><input name="isActive" type="checkbox" defaultChecked={pass.isActive}/> Active</label>}
  </Form>;
}
function ResidentPasses({ path, canEdit, canCreate }: { path: string; canEdit: boolean; canCreate: boolean }) {
  const [editing, setEditing] = useState<Pass | null>(null);
  return <div className="stack">{canCreate && <Card title="New recurring pass"><PassForm path={path}/></Card>}
    <Card title="Recurring passes"><List<Pass> path={path} render={row => <div className="row" key={row.id}>
      <div><div className="row-title">{fullName(row.helper)}<Badge value={row.isActive ? 'ACTIVE' : 'INACTIVE'}/></div>
        <p className="muted">{row.guestType.name} · {row.daysOfWeek.map(index => days[index]).join(', ')} · {row.startTime}–{row.endTime} IST</p>
        <p className="muted text-sm">{row.validFrom} to {row.validTo ?? 'open-ended'}</p></div>
      {canEdit && <div className="actions"><Button secondary onClick={() => setEditing(row)}>Edit</Button>
        <Action secondary path={path + '/' + row.id} method="DELETE">Delete</Action></div>}
    </div>}/></Card>
    {editing && <Dialog title="Edit recurring pass" close={() => setEditing(null)}><PassForm path={path} pass={editing} done={() => setEditing(null)}/></Dialog>}
  </div>;
}
function ResidentMembers({ path, head, canApprove }: { path: string; head: boolean; canApprove: boolean }) {
  const row = (member: Member) => <div className="row" key={member.id}>
    <div><div className="row-title">{fullName(member.user)}<Badge value={member.role}/></div><p className="muted">{human(member.relation)} · {member.user.phone}</p></div>
    {head && member.role === 'MEMBER' && <div className="actions">{member.status === 'PENDING' ? <>
      {canApprove && <Action path={path + '/' + member.id + '/approve'}>Approve</Action>}<Action secondary path={path + '/' + member.id + '/reject'}>Reject</Action></>
      : <><Action secondary path={path + '/' + member.id} method="PATCH" body={{ canApproveVisitors: !member.canApproveVisitors }}>
        {member.canApproveVisitors ? 'Disable visit approvals' : 'Enable visit approvals'}</Action>
        <Action secondary path={path + '/' + member.id + '/remove'}>Remove</Action></>}</div>}
  </div>;
  return <div className="stack">{head && <Card title="Pending member requests"><List<Member> path={path + '?status=PENDING'} render={row}/></Card>}
    <Card title="Approved members"><List<Member> path={path + '?status=APPROVED'} render={row}/></Card></div>;
}
export function Resident({ flat: contextFlat, member, section }: { flat: Flat; member: Member; section?: string }) {
  const path = '/flats/' + contextFlat.id;
  const { data } = useData<Flat>(path);
  const flat = data ?? contextFlat;
  const [extension, setExtension] = useState<Visit | null>(null);
  const write = useWrite();
  const head = member.role === 'HEAD';
  const adultDate = new Date();
  adultDate.setFullYear(adultDate.getFullYear() - 18);
  const childBlocked = flat.childProtection && member.user.dateOfBirth > formatInTimeZone(adultDate, localZone, 'yyyy-MM-dd');
  const canApprove = (head || member.canApproveVisitors) && !childBlocked;
  if (section === 'settings') return <><Heading title="Home settings"/><Card title={flat.label}>
    <div className="row"><div><strong>Child protection</strong><p className="muted">Require an adult to approve or extend visits.</p></div>
      <Action path={path + '/settings'} method="PATCH" body={{ childProtection: !flat.childProtection }}>{flat.childProtection ? 'Turn off' : 'Turn on'}</Action></div>
    <div className="row"><div><strong>Mute visitor alerts</strong><p className="muted">Requests still appear in the home dashboard.</p></div>
      <Action path={path + '/settings'} method="PATCH" body={{ muteVisitorAlerts: !flat.muteVisitorAlerts }}>{flat.muteVisitorAlerts ? 'Unmute' : 'Mute'}</Action></div>
  </Card></>;
  if (section === 'members') return <><Heading title="Home members"/><ResidentMembers path={path + '/members'} head={head} canApprove={!childBlocked}/></>;
  if (section === 'passes') return <><Heading title="Recurring passes"/><ResidentPasses path={path + '/passes'} canEdit={head} canCreate={head && !childBlocked}/></>;
  const extend = (visit: Visit) => canApprove && ['APPROVED', 'CHECKED_IN'].includes(visit.status) &&
    <Button secondary onClick={() => setExtension(visit)}>Extend time</Button>;
  return <><Heading title={section === 'visits' ? 'Home visit history' : flat.label} note={childBlocked ? 'Child protection is on for this home.' : undefined}/>
    <div className="stack">{!section && <>
      <Card title="Pending approvals"><List<Visit> path={path + '/visits?status=PENDING'} empty="No pending visit requests." render={visit =>
        <VisitRow key={visit.id} visit={visit}>{canApprove && <><Action path={'/visits/' + visit.id + '/approve'}>Approve</Action>
          <Action secondary path={'/visits/' + visit.id + '/reject'}>Reject</Action></>}</VisitRow>}/></Card>
      <Card title="Inside now"><List<Visit> path={path + '/visits?status=CHECKED_IN'} render={visit => <VisitRow key={visit.id} visit={visit}>{extend(visit)}</VisitRow>}/></Card>
    </>}
      <VisitList path={path + '/visits'} title={section ? 'Visits' : 'Recent activity'}>{extend}</VisitList>
    </div>
    {extension && <Dialog title="Extend visit time" close={() => setExtension(null)}><Form label="Save extension" submit={async event => {
      const { time } = values(event);
      await write.mutateAsync({ path: '/visits/' + extension.id + '/extend', body: { newValidUntil: fromZonedTime(time, localZone).toISOString() } });
      setExtension(null);
    }}><p className="muted">Current expiry {formatDate(extension.validUntil)} IST</p><Fields fields={[[ 'time', 'New validity (IST)', 'datetime-local' ]]}/></Form></Dialog>}
  </>;
}
