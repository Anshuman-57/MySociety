import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { api, toast, useData, useList, useWrite } from './api';
import { visitStatuses, type Guest, type Visit, type Me } from './types';
import { Action, Badge, Button, Card, Field, Fields, Form, Heading, List, VisitRow, formatDate, human, values } from './ui';

export type SocietyOption = { id: string; name: string; city: string; state?: string; address?: string; pincode?: string };
export function SocietyPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<SocietyOption>();
  useEffect(() => {
    const timer = setTimeout(() => { setTerm(search.trim()); setPage(1); }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const societies = useList<SocietyOption>('/societies/search?q=' + encodeURIComponent(term) + '&limit=20', page);
  const searching = search.trim() !== term || societies.isFetching;
  const chosen = selection?.id === value ? selection : undefined;
  const meta = societies.data?.meta;
  const options = [...new Map([...(chosen ? [chosen] : []), ...(societies.data?.data ?? [])].map(row => [row.id, row])).values()];
  return <div className="stack">
    <Field label="Find an active society"><input type="search" value={search} maxLength={100} autoComplete="off"
      placeholder="Society name, city, area or PIN code" onChange={event => setSearch(event.target.value)}/></Field>
    <Field label="Society"><select required value={value} onChange={event => {
      const row = options.find(item => item.id === event.target.value);
      setSelection(row); onChange(row?.id ?? '');
    }}>
      <option value="">{searching ? 'Loading societies...' : 'Select a society'}</option>
      {options.map(row => <option key={row.id} value={row.id}>{row.name} - {[row.city, row.pincode].filter(Boolean).join(', ')}</option>)}
    </select></Field>
    {societies.isError && <div className="error" role="alert">{societies.error.message} <Button secondary onClick={() => void societies.refetch()}>Try again</Button></div>}
    {!searching && !societies.isError && !societies.data?.data.length && <p className="muted text-sm" role="status">No active societies found. Try a different name, city or PIN code.</p>}
    {chosen?.address && <p className="muted text-sm">{chosen.address}</p>}
    {meta && (meta.total > meta.limit || page > 1) && <div className="actions">
      <Button secondary disabled={page <= 1 || searching} onClick={() => setPage(page - 1)}>Previous</Button>
      <span className="muted text-sm">Page {page} of {Math.max(1, Math.ceil(meta.total / meta.limit))}</span>
      <Button secondary disabled={page * meta.limit >= meta.total || searching} onClick={() => setPage(page + 1)}>Next</Button>
    </div>}
    <p className="muted text-xs">Only active societies are listed. If yours is missing, contact the Platform Admin.</p>
  </div>;
}
type HomeOption = { id: string; label: string; wing: string; flatNumber: string };
function HomePicker({ society }: { society: string }) {
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [chosen, setChosen] = useState<HomeOption>();
  useEffect(() => {
    const timer = setTimeout(() => { setTerm(search.trim()); setPage(1); }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const homes = useList<HomeOption>('/societies/' + society + '/homes?limit=100&q=' + encodeURIComponent(term), page, !!society);
  const options = [...new Map([...(chosen ? [chosen] : []), ...(homes.data?.data ?? [])].map(row => [row.id, row])).values()];
  const meta = homes.data?.meta;
  const loading = !!society && (homes.isFetching || search.trim() !== term);
  return <div className="stack">
    {society && <Field label="Filter homes (optional)"><input type="search" value={search} maxLength={60} placeholder="Wing or flat number" onChange={event => setSearch(event.target.value)}/></Field>}
    <Field label="Home"><select required disabled={!society || homes.isPending || homes.isError} value={chosen?.id ?? ''}
      onChange={event => setChosen(options.find(row => row.id === event.target.value))}>
      <option value="">{!society ? 'Select a society first' : loading ? 'Loading homes...' : 'Select a home'}</option>
      {options.map(row => <option value={row.id} key={row.id}>{row.label}</option>)}
    </select></Field>
    <input type="hidden" name="wing" value={chosen?.wing ?? ''}/><input type="hidden" name="flatNumber" value={chosen?.flatNumber ?? ''}/>
    {homes.isError && <div className="error" role="alert">{homes.error.message} <Button secondary onClick={() => void homes.refetch()}>Try again</Button></div>}
    {society && !loading && !homes.isError && !homes.data?.data.length && <p className="muted text-sm" role="status">No active homes found. Try another flat number or ask the Secretary to add the home.</p>}
    {meta && (meta.total > meta.limit || page > 1) && <div className="actions">
      <Button secondary disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous homes</Button>
      <span className="muted text-sm">Page {page} of {Math.max(1, Math.ceil(meta.total / meta.limit))}</span>
      <Button secondary disabled={page * meta.limit >= meta.total || loading} onClick={() => setPage(page + 1)}>Next homes</Button>
    </div>}
  </div>;
}
export function HomeFields({ society }: { society?: string }) {
  return society !== undefined ? <HomePicker key={society} society={society}/> : <Fields fields={[[ 'wing', 'Wing' ], ['flatNumber', 'Flat number']]}/>;
}
export async function lookup(societyId: string, fields: Record<string, string>) {
  return api<{ flatId: string; label: string }>(`/societies/${societyId}/flats/lookup`, 'POST', { wing: fields.wing, flatNumber: fields.flatNumber });
}
export function GuestFields({ initial = '', withPurpose = true }: { initial?: string; withPurpose?: boolean }) {
  const { data, error } = useData<Guest[]>('/guest-types');
  const [selected, setSelected] = useState(initial);
  return <>{error && <p className="error">{error.message}</p>}<Field label="Guest type">
    <select name="guestTypeId" required value={selected} onChange={event => setSelected(event.target.value)}>
      <option value="">Choose guest type</option>{data?.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
    </select></Field>{withPurpose && <>
      <Field label="Purpose"><input name="purpose" required maxLength={500}/></Field>
      <Field label={data?.find(item => item.id === selected)?.requiresVehicleNumber ? 'Vehicle number' : 'Vehicle number (optional)'}>
        <input name="vehicleNumber" required={data?.find(item => item.id === selected)?.requiresVehicleNumber} maxLength={30}/>
      </Field>
    </>}</>;
}
export function JoinPage({ kind, me }: { kind: 'visit' | 'register' | 'join'; me?: Me }) {
  const preferred = kind === 'register' && me?.secretaryOf?.status === 'APPROVED' ? me.secretaryOf : undefined;
  const [society, setSociety] = useState(() => preferred?.id ?? '');
  const [completed, setCompleted] = useState('');
  const write = useWrite();
  const navigate = useNavigate();
  const titles = { visit: 'Request a visit', register: 'Add home', join: 'Join a home' };
  if (completed) return <><Heading title={kind === 'register' ? 'Home added' : 'Request submitted'}/><Card title={completed}><p role="status">{kind === 'register' ? 'The home and owner are active. The owner can sign in with their mobile number and OTP.' : 'Your request is waiting for approval from the home owner.'}</p><div className="actions"><Link className="button" to={kind === 'register' ? '/secretary/homes' : '/'}>{kind === 'register' ? 'View homes' : 'View my applications'}</Link>{kind === 'register' && <Button secondary onClick={() => setCompleted('')}>Add another home</Button>}</div></Card></>;
  return <><Heading title={titles[kind]} note={kind === 'register' ? 'Enter a home and its owner mobile number. Both become active immediately.' : kind === 'join' ? 'If your home is already registered, join it here instead of adding it again.' : undefined}/><Card><Form label={kind === 'visit' ? 'Send visit request' : kind === 'register' ? 'Add home' : 'Submit application'} submit={async event => {
    const fields = values(event);
    if ((kind === 'join' || kind === 'visit') && (!fields.wing || !fields.flatNumber)) throw new Error('Choose a home.');
    if (!society) throw new Error('Choose a society.');
    const prefix = '/societies/' + society;
    if (kind === 'register') await write.mutateAsync({ path: prefix + '/flats', body: { ...fields, floorNumber: fields.floorNumber ? Number(fields.floorNumber) : undefined } });
    else {
      const { flatId } = await lookup(society, fields);
      if (kind === 'join') await write.mutateAsync({ path: '/flats/' + flatId + '/members/join', body: { relation: fields.relation } });
      else {
        const { guestTypeId, purpose, vehicleNumber } = fields;
        await write.mutateAsync({ path: '/visits', body: { flatId, guestTypeId, purpose, vehicleNumber } });
        return navigate('/pass');
      }
    }
    if (kind === 'register' || kind === 'join') return setCompleted((kind === 'register' ? 'Home ' : 'Join home ') + fields.wing.toUpperCase() + '-' + fields.flatNumber.toUpperCase());
    navigate('/');
  }}>
    {kind === 'register' && preferred ? <Field label="Society"><select required value={society} onChange={event => setSociety(event.target.value)}><option value={preferred.id}>{preferred.name} - {preferred.city}</option></select></Field> : <SocietyPicker value={society} onChange={setSociety}/>}
    <HomeFields society={kind === 'register' ? undefined : society}/>
    {kind === 'register' && <><Fields fields={[[ 'floorNumber', 'Floor (optional)', 'number?' ], ['ownerPhone', 'Owner mobile number (+91)', 'tel' ]]}/><p className="muted text-sm">No prior account is needed. The owner verifies their mobile number by OTP to open the Resident workspace.</p></>}
    {kind === 'join' && <Field label="Relationship to home owner"><select name="relation" required>{['SPOUSE', 'SON', 'DAUGHTER', 'PARENT', 'SIBLING', 'TENANT', 'OTHER'].map(item => <option key={item} value={item}>{item[0] + item.slice(1).toLowerCase()}</option>)}</select></Field>}
    {kind === 'visit' && <GuestFields/>}
    {kind === 'join' && <p className="muted text-sm">Home not listed? Ask your society Secretary to add it and assign its owner.</p>}
  </Form></Card></>;
}
export function VisitList({ path, title, children, initialStatus = '', detail = false }: { path: string; title: string; children?: (visit: Visit) => React.ReactNode; initialStatus?: string; detail?: boolean }) {
  const [status, setStatus] = useState(initialStatus);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [dates, setDates] = useState({ from: '', to: '' });
  const [draftDates, setDraftDates] = useState(dates);
  const [showDates, setShowDates] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);
  const params = new URLSearchParams(Object.entries({ q: query, status, ...dates }).filter(([, value]) => !!value));
  const queryPath = path + (path.includes('?') ? '&' : '?') + params;
  const hasDates = !!(dates.from || dates.to);
  const hasFilters = !!(search || status || hasDates);
  function reset() {
    const empty = { from: '', to: '' };
    setSearch(''); setQuery(''); setStatus(''); setDates(empty); setDraftDates(empty); setShowDates(false); setError('');
  }
  return <Card title={title}>
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[180px] flex-1"><Field label="Search"><input type="search" maxLength={100} value={search}
        placeholder="Visitor, home, phone..." onChange={event => setSearch(event.target.value)}/></Field></div>
      <div className="w-full sm:w-40"><Field label="Status"><select value={status} onChange={event => setStatus(event.target.value)}>
        <option value="">All statuses</option>{visitStatuses.map(item => <option key={item} value={item}>{human(item)}</option>)}
      </select></Field></div>
      <Button secondary aria-expanded={showDates} onClick={() => { setDraftDates(dates); setError(''); setShowDates(!showDates); }}>{hasDates ? 'Dates (active)' : 'Date range'}</Button>
      {hasFilters && <Button secondary onClick={reset}>Clear</Button>}
    </div>
    {showDates && <form className="stack rounded-lg border border-slate-200 bg-slate-50 p-3" onSubmit={event => {
      event.preventDefault();
      if (draftDates.from && draftDates.to && draftDates.from > draftDates.to) { setError('Start date must be on or before end date.'); return; }
      setDates(draftDates); setShowDates(false); setError('');
    }}>
      <div className="field-grid"><Field label="Requested from (IST)"><input type="date" value={draftDates.from} max={draftDates.to || undefined} onChange={event => setDraftDates({ ...draftDates, from: event.target.value })}/></Field>
        <Field label="Requested through (IST)"><input type="date" value={draftDates.to} min={draftDates.from || undefined} onChange={event => setDraftDates({ ...draftDates, to: event.target.value })}/></Field></div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions"><Button type="submit">Apply dates</Button>{hasDates && <Button secondary onClick={() => {
        const empty = { from: '', to: '' }; setDates(empty); setDraftDates(empty); setShowDates(false); setError('');
      }}>Clear dates</Button>}</div>
    </form>}
    {hasDates && <p className="muted text-xs">Requested {dates.from || 'any time'} to {dates.to || 'present'} (IST)</p>}
    <List<Visit> path={queryPath} empty="No visits match these filters." render={visit => <VisitRow key={visit.id} visit={visit} detail={detail}>{children?.(visit)}</VisitRow>}/>
  </Card>;
}
export function MyPass() {
  return <><Heading title="My pass" note="After approval, show this QR code to the Guard at entry and again at exit.">
    <Link className="button" to="/visit/new">Request a visit</Link></Heading>
    <List<Visit> path="/visits/current" empty="No active pass yet. Request a visit and wait for the resident to approve it." render={visit =>
      <div className="stack" key={visit.id}>
        {visit.qrToken ? <VisitQr visit={visit}/> : <Card title="Waiting for approval"><div className="actions"><strong>{visit.society?.name} / {visit.flat.label}</strong><Badge value={visit.status}/></div>
          <p className="muted">{visit.guestType.name} / {visit.purpose}</p><p>Your QR pass will appear here automatically when the resident approves your request.</p></Card>}
        <div className="actions"><Link className="button secondary" to={'/visits/' + visit.id}>Request details</Link>
          {['PENDING', 'APPROVED'].includes(visit.status) && <Action secondary path={'/visits/' + visit.id + '/cancel'}>Cancel request</Action>}</div>
      </div>}/>
  </>;
}
export function VisitQr({ visit }: { visit: Visit }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!visit.qrToken) return null;
  const seconds = Math.max(0, Math.floor((Date.parse(visit.validUntil ?? '') - now) / 1000));
  const startsAt = Date.parse(visit.validFrom ?? '');
  const notStarted = startsAt > now;
  if (!seconds && visit.status === 'APPROVED') return <Card title="Pass expired"><p>The entry window has ended. Request a new visit if you still need to enter.</p></Card>;
  return <Card title="Show this pass to the Guard"><div className="flex flex-wrap items-center gap-5">
    <QRCodeSVG value={visit.qrToken} size={256} level="M" marginSize={3} className="max-w-full"/>
    <div className="stack"><Badge value={visit.status}/>{visit.society?.name && <strong>{visit.society.name}</strong>}<p>{visit.guestType.name} · {visit.flat.label}</p>
      <p className="muted">{visit.status === 'CHECKED_IN' ? 'You are checked in. Show this same QR to the Guard when leaving.' : notStarted ? 'Entry opens at ' + formatDate(visit.validFrom) + ' IST' : `Entry valid for ${Math.floor(seconds / 60)} min ${seconds % 60} sec`}</p>
      <p className="muted">Valid until {formatDate(visit.validUntil)} IST</p>
      <Button secondary onClick={() => {
        if (visit.qrToken) void navigator.clipboard.writeText(visit.qrToken).then(() => toast('Token copied')).catch(() => toast('Select the token below to copy it', true));
      }}>Copy QR token</Button>
      <details><summary className="text-sm">Show token</summary><p className="max-w-xs break-all text-xs">{visit.qrToken}</p></details>
    </div></div></Card>;
}
export function VisitDetail({ id: suppliedId, canCancel = true }: { id?: string; canCancel?: boolean }) {
  const { id } = useParams();
  const path = '/visits/' + (suppliedId ?? id);
  const result = useData<Visit>(path);
  const visit = result.data;
  if (result.isPending) return <p role="status">Loading visit…</p>;
  if (!visit) return <p className="error">{result.error?.message}</p>;
  return <div className="stack"><Heading title={visit.status === 'PENDING' ? 'Waiting for response' : visit.flat.label} note={visit.purpose}><Badge value={visit.status}/></Heading>
    <VisitQr visit={visit}/><Card title="Request details">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt>Requested</dt><dd>{formatDate(visit.createdAt)} IST</dd>
        {visit.respondedAt && <><dt>Response</dt><dd>{formatDate(visit.respondedAt)} IST</dd></>}
        {visit.validFrom && <><dt>Valid from</dt><dd>{formatDate(visit.validFrom)} IST</dd></>}
        {visit.entryAt && <><dt>Entry</dt><dd>{formatDate(visit.entryAt)} IST</dd></>}
        {visit.exitAt && <><dt>Exit</dt><dd>{formatDate(visit.exitAt)} IST</dd></>}
      </dl>
      {canCancel && !visit.isWalkIn && ['PENDING', 'APPROVED'].includes(visit.status) && <Action path={path + '/cancel'} secondary>Cancel request</Action>}
    </Card></div>;
}
