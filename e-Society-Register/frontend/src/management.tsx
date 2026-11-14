import { useState } from 'react';
import { Link } from 'react-router-dom';
import { upload, useData, useList, useWrite } from './api';
import { fullName, type Flat, type Gate, type Me, type Society, type User } from './types';
import { Action, Badge, Button, Card, Dialog, Field, Fields, Form, Heading, List, StatusTabs, formatDate, human, values } from './ui';
import { SocietyPicker, VisitList } from './visitor';

type Document = { id: string; documentType: string; fileUrl: string };
type Property = { society: Society; documents: Document[] };
const societyFields: [string, string, string?][] = [
  ['name', 'Society name'], ['address', 'Street address'], ['city', 'City'], ['state', 'State']
];
function Documents({ documents }: { documents: Document[] }) {
  return <div className="stack">{documents.length ? documents.map(doc => <a className="text-sm underline" key={doc.id} href={doc.fileUrl} target="_blank" rel="noreferrer">{doc.documentType} ↗</a>) :
    <p className="muted">No documents uploaded.</p>}</div>;
}
export function SocietyRegistration({ me, create = false }: { me: Me; create?: boolean }) {
  const property = create ? null : me.secretaryOf;
  const write = useWrite();
  const [submitted, setSubmitted] = useState(false);
  const docs = useData<Property>('/societies/' + property?.id, !!property);
  return <><Heading title={property?.name ?? 'Add a society'} note={create ? 'Enter the Secretary mobile number. The society and Secretary become active immediately.' : 'Your society details and documents.'}>{property && <Badge value={property.status} label={property.status === 'APPROVED' ? 'Active' : 'Inactive'}/>}</Heading><div className="stack">
    {submitted && !property && <Card title="Society added"><p role="status">The society is active. The Secretary can sign in using their mobile number and OTP.</p><div className="actions"><Link className="button" to="/admin/societies">View societies</Link><Button secondary onClick={() => setSubmitted(false)}>Add another society</Button></div></Card>}
    {property?.status === 'APPROVED' && <Card title="Your society is ready"><p>Add homes and assign their owners in the Secretary workspace.</p><div className="actions"><Link className="button" to="/home/register">Add home</Link><Link className="button secondary" to="/">Open my workspaces</Link></div></Card>}
    {property?.rejectionReason && <p className="error">{property.rejectionReason}</p>}
    {(create && !submitted) && <Card title={property ? 'Edit application' : 'Society details'}>
      <Form label="Add society & Secretary" submit={async event => {
        const fields = values(event);
        const { latitude, longitude, ...address } = fields;
        await write.mutateAsync({ path: '/societies' + (property ? '/' + property.id : ''), method: property ? 'PATCH' : 'POST',
          body: { ...address, latitude: latitude ? Number(latitude) : undefined, longitude: longitude ? Number(longitude) : undefined } });
        setSubmitted(true);
      }}><Fields fields={societyFields} initial={property ?? {}}/>
        {create && <Fields fields={[[ 'secretaryPhone', 'Secretary mobile number (+91)', 'tel' ]]}/>}
        <Field label="PIN code"><input name="pincode" defaultValue={property?.pincode ?? ''} inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} placeholder="380015" required onChange={event => { event.currentTarget.value = event.currentTarget.value.replace(/[^0-9]/g, '').slice(0, 6); }}/></Field>
        <details><summary className="cursor-pointer text-sm">More details (optional)</summary><div className="mt-3">
          <Fields fields={[[ 'country', 'Country' ]]} initial={property ?? { country: 'India' }}/>
          <div className="field-grid mt-3"><Field label="Latitude (optional)"><input name="latitude" type="number" step="any" min={-90} max={90} defaultValue={property?.latitude ?? ''}/></Field>
            <Field label="Longitude (optional)"><input name="longitude" type="number" step="any" min={-180} max={180} defaultValue={property?.longitude ?? ''}/></Field></div>
        </div></details>
        <p className="muted text-sm">No account registration is needed beforehand. The Secretary verifies this mobile number by OTP when signing in.</p>
      </Form>
    </Card>}
    {property && <Card title="Society documents"><details><summary className="cursor-pointer text-sm">View or upload documents</summary><div className="stack mt-3">
      {docs.data && <Documents documents={docs.data.documents}/>}
      {docs.isError && <p className="error">{docs.error.message}</p>}
      <Form label="Upload documents" submit={async event => {
        const files = [...(event.currentTarget.elements.namedItem('files') as HTMLInputElement).files ?? []];
        const { documentType } = values(event);
        for (const file of files) {
          const fileUrl = await upload(file, 'SOCIETY_DOC');
          await write.mutateAsync({ path: '/societies/' + property.id + '/documents', body: { documentType, fileUrl } });
        }
      }}>
        <Fields fields={[[ 'documentType', 'Document type' ]]}/>
        <Field label="Files"><input name="files" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required multiple/></Field>
      </Form></div></details>
    </Card>}
  </div></>;
}
export function AdminSocieties() {
  const [status, setStatus] = useState('APPROVED');
  const [selected, setSelected] = useState<(Society & { secretary: User; documents: Document[] }) | null>(null);
  const write = useWrite();
  return <><Heading title="Societies" note="Add societies and assign Secretaries directly by mobile number."><Link className="button" to="/society/register">Add society &amp; Secretary</Link></Heading>
    <Card><Field label="Status"><select value={status} onChange={event => setStatus(event.target.value)}><option value="APPROVED">Active</option><option value="SUSPENDED">Inactive</option><option value="">All societies</option></select></Field>
      <List<Society & { secretary: User; documents: Document[] }> path={'/admin/societies' + (status ? '?status=' + status : '')}
        render={row => <div className="row" key={row.id}><div><div className="row-title">{row.name}<Badge value={row.status} label={row.status === 'APPROVED' ? 'Active' : 'Inactive'}/></div>
          <p className="muted">{row.city}, {row.state}</p><p className="muted text-sm">Secretary: {row.secretary.phone}</p></div><Button secondary onClick={() => setSelected(row)}>Manage</Button></div>}/>
    </Card>
    {selected && <Dialog title={selected.name} close={() => setSelected(null)}><div className="stack mt-4">
      <p>{selected.address}, {selected.city}, {selected.state} {selected.pincode}</p>
      <p>Secretary: {fullName(selected.secretary)} / {selected.secretary.phone}</p>
      <Form label="Assign Secretary" submit={async event => {
        await write.mutateAsync({ path: '/admin/societies/' + selected.id + '/secretary', method: 'PATCH', body: values(event) }); setSelected(null);
      }}><Fields fields={[[ 'phone', 'Secretary mobile number (+91)', 'tel' ]]}/><p className="muted text-sm">Assigning a new Secretary replaces the current Secretary.</p></Form>
      <Documents documents={selected.documents}/>
      <Button secondary disabled={write.isPending} onClick={() => void write.mutateAsync({ path: '/admin/societies/' + selected.id + (selected.status === 'APPROVED' ? '/suspend' : '/activate') }).then(() => setSelected(null)).catch(() => {})}>
        {selected.status === 'APPROVED' ? 'Deactivate society' : 'Activate society'}</Button>
    </div></Dialog>}
  </>;
}
export function EmergencyList({ base }: { base: string }) {
  return <Card title="Emergency log"><List<{ id: string; type: string; gate: Gate; guard: { name: string }; vehicleNumber: string | null; note: string | null; createdAt: string }>
    path={base + '/emergency-logs'} render={row => <div className="row" key={row.id}><div><strong>{human(row.type)} · {row.gate.name || 'Gate ' + row.gate.gateNumber}</strong>
      <p className="muted">{row.guard.name} · {formatDate(row.createdAt)} IST</p>{row.vehicleNumber && <p>{row.vehicleNumber}</p>}{row.note && <p>{row.note}</p>}</div></div>}/></Card>;
}
export function AdminActivity({ audit = false }: { audit?: boolean }) {
  const [society, setSociety] = useState('');
  const path = '/admin/' + (audit ? 'audit' : 'visits') + (society ? '?societyId=' + society : '');
  return <><Heading title={audit ? 'Platform audit history' : 'Platform visitor records'} note="Review all societies or choose one active society below."/>
    <div className="stack"><Card title="Society filter (optional)"><SocietyPicker value={society} onChange={setSociety}/>
      <Button secondary onClick={() => setSociety('')}>All societies</Button></Card>
      {audit ? <Card title="Audit records"><List<{ id: string; action: string; actor: { name: string }; entityType: string; entityId: string; createdAt: string; metadata: Record<string, unknown> }>
        path={path} render={row => <div className="row" key={row.id}><div><strong>{human(row.action)}</strong><p className="muted">{row.actor.name} · {formatDate(row.createdAt)} IST</p>
          <details className="text-sm"><summary>Details</summary><p>{human(row.entityType)} · {row.entityId}</p><pre className="whitespace-pre-wrap">{JSON.stringify(row.metadata, null, 2)}</pre></details></div></div>}/></Card>
        : <VisitList path={path} title="Visit history"/>}
    </div></>;
}
function SecretaryOverview({ base, name }: { base: string; name: string }) {
  const guards = useList(base + '/guards?status=APPROVED', 1);
  const flats = useList(base + '/flats?status=APPROVED', 1);
  const visits = useList(base + '/visits/inside', 1);
  return <><Heading title={name} note="Homes, Guards and gate activity at a glance."/><div className="stack">
    <div className="grid gap-3 sm:grid-cols-3">{[
      ['Active guards', guards.data?.meta?.total, '/secretary/guards'],
      ['Homes', flats.data?.meta?.total, '/secretary/homes'],
      ['Visitors inside', visits.data?.meta?.total, '/secretary/visits']
    ].map(([title, count, href]) => <Link className="card block" key={title} to={String(href)}><p className="muted">{title}</p><p className="text-3xl font-semibold">{count ?? '—'}</p></Link>)}</div>
    <Card title="On duty by gate"><List<{ gate: Gate; guards: { id: string; name: string }[] }> path={base + '/duty/on-duty'} render={row =>
      <div key={row.gate.id} className="row"><strong>{row.gate.name || 'Gate ' + row.gate.gateNumber}</strong><span className="muted">{row.guards.map(guard => guard.name).join(', ') || 'No guard on duty'}</span></div>}/></Card>
  </div></>;
}
export function Secretary({ property, section }: { property: Society; section?: string }) {
  const base = '/societies/' + property.id;
  const [status, setStatus] = useState('APPROVED');
  const [flat, setFlat] = useState<Flat | null>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const write = useWrite();
  if (property.status !== 'APPROVED') return <><Heading title={property.name}><Badge value={property.status} label="Inactive"/></Heading><Card>
    <p>{property.rejectionReason || 'This society is inactive. Contact the Platform Admin.'}</p><Link to="/society/register" className="button">View society</Link></Card></>;
  if (section === 'visits') return <><Heading title="Society activity"/><VisitList path={base + '/visits'} title="Visit history"/></>;
  if (section === 'emergency') return <><Heading title="Emergency vehicles"/><EmergencyList base={base}/></>;
  if (section === 'audit') return <><Heading title="Audit history"/><Card>
    <List<{ id: string; action: string; actor: { name: string }; entityType: string; entityId: string; metadata: Record<string, unknown>; createdAt: string }>
      path={base + '/audit'} render={row => <div className="row" key={row.id}><div><strong>{human(row.action)}</strong>
        <p className="muted">{row.actor.name} · {formatDate(row.createdAt)} IST</p>
        <details className="text-sm"><summary>Details</summary><p>{human(row.entityType)} · {row.entityId}</p><pre className="whitespace-pre-wrap">{JSON.stringify(row.metadata, null, 2)}</pre></details>
      </div></div>}/></Card></>;
  if (section === 'gates') return <><Heading title="Gates"/><div className="stack"><Card title="Add a gate">
    <Form label="Add gate" submit={event => write.mutateAsync({ path: base + '/gates', body: values(event) })}><Fields fields={[[ 'gateNumber', 'Gate number' ], ['name', 'Name (optional)', 'optional']]}/></Form></Card>
    <Card title="Registered gates"><List<Gate> path={base + '/gates'} render={row => <div className="row" key={row.id}><div className="row-title">
      Gate {row.gateNumber}{row.name && ' · ' + row.name}<Badge value={row.isActive ? 'ACTIVE' : 'INACTIVE'}/></div>
      <div className="actions"><Button secondary onClick={() => setGate(row)}>Rename</Button><Action secondary path={base + '/gates/' + row.id} method="PATCH" body={{ isActive: !row.isActive }}>{row.isActive ? 'Deactivate' : 'Activate'}</Action></div></div>}/></Card></div>
    {gate && <Dialog title={'Rename gate ' + gate.gateNumber} close={() => setGate(null)}><Form label="Save name" submit={async event => {
      await write.mutateAsync({ path: base + '/gates/' + gate.id, method: 'PATCH', body: values(event) }); setGate(null);
    }}><Fields fields={[[ 'name', 'Gate name' ]]} initial={gate}/></Form></Dialog>}
  </>;
  if (section === 'guards') return <><Heading title="Guards" note="Add a Guard by mobile number. Access is active immediately."/><div className="stack">
    <Card title="Add Guard"><Form label="Add Guard" submit={event => write.mutateAsync({ path: base + '/guards', body: values(event) })}>
      <Fields fields={[[ 'phone', 'Guard mobile number (+91)', 'tel' ]]}/><p className="muted text-sm">The Guard signs in with OTP. No separate approval or prior account is required.</p>
    </Form></Card>
    <Card title="Active Guards"><List<{ id: string; user: User; status: string }> path={base + '/guards?status=APPROVED'} render={row => <div className="row" key={row.id}>
      <div><strong>{fullName(row.user)}</strong><p className="muted">{row.user.phone}</p></div>
      <Action secondary path={base + '/guards/' + row.id + '/remove'}>Remove</Action>
    </div>}/></Card></div></>;
  if (section === 'homes') return <><Heading title="Homes" note="Homes and their owners are active as soon as you add them."><Link className="button" to="/home/register">Add home</Link></Heading>
    <Card><Field label="Status"><select value={status} onChange={event => setStatus(event.target.value)}><option value="APPROVED">Active</option><option value="SUSPENDED">Inactive</option><option value="">All homes</option></select></Field>
      <List<{ flat: Flat; head: User | null }> path={base + '/flats' + (status ? '?status=' + status : '')} render={({ flat, head }) => <div className="row" key={flat.id}>
        <div><div className="row-title">{flat.label}<Badge value={flat.status} label={flat.status === 'APPROVED' ? 'Active' : 'Inactive'}/></div>{head && <p className="muted">Owner: {fullName(head)}</p>}</div>
        <div className="actions">{flat.status === 'APPROVED' && <Button secondary onClick={() => setFlat(flat)}>Change owner</Button>}<Action secondary path={'/flats/' + flat.id + (flat.status === 'APPROVED' ? '/suspend' : '/activate')}>{flat.status === 'APPROVED' ? 'Deactivate' : 'Activate'}</Action></div>
      </div>}/>
    </Card>{flat && <Dialog title={'Change owner / ' + flat.label} close={() => setFlat(null)}><Form label="Assign owner" submit={async event => {
      await write.mutateAsync({ path: '/flats/' + flat.id + '/transfer-head', body: values(event) }); setFlat(null);
    }}><Fields fields={[[ 'newHeadPhone', 'New owner mobile number (+91)', 'tel' ]]}/><p className="muted text-sm">The new owner signs in with OTP. Existing members will need the new owner's approval.</p></Form></Dialog>}</>;
  return <SecretaryOverview base={base} name={property.name}/>;
}
