import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, upload, useData, useWrite } from './api';
import { EmergencyList } from './management';
import type { Duty, Gate, Visit, WalkInProfile } from './types';
import { Action, Badge, Button, Card, Field, Fields, Form, Heading, List, StatusTabs, VisitRow, human, values } from './ui';
import { GuestFields, HomeFields, VisitList, lookup } from './visitor';
import { PhoneInput, mobileDigits, phoneSchema } from './phone';

export function Scanner({ scan }: { scan: (token: string) => Promise<React.ReactNode> }) {
  const id = useId().replaceAll(':', '');
  const [message, setMessage] = useState<{ content: React.ReactNode; error: boolean } | null>(null);
  const [camera, setCamera] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const busy = useRef(false);
  const [processing, setProcessing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const scanRef = useRef(scan);
  scanRef.current = scan;
  async function submit(token: string) {
    if (busy.current) return;
    busy.current = true; setProcessing(true);
    try { setMessage({ content: await scanRef.current(token.trim()), error: false }); }
    catch (error) { setMessage({ content: (error as Error).message, error: true }); }
    timer.current = setTimeout(() => { busy.current = false; setProcessing(false); setMessage(null); }, 4000);
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!camera) return;
    let cleanup: (() => Promise<void>) | undefined;
    let disposed = false;
    void (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (disposed) return;
        const reader = new Html5Qrcode(id);
        await reader.start({ facingMode: 'environment' }, { fps: 8, qrbox: { width: 200, height: 200 } },
          token => { if (!disposed) void submit(token); }, () => {});
        cleanup = async () => { await reader.stop(); reader.clear(); };
        if (disposed) await cleanup();
      } catch {
        if (!disposed) { setCamera(false); setCameraError('Camera unavailable. Allow camera access on HTTPS or localhost, or paste a QR token.'); }
      }
    })();
    return () => { disposed = true; if (cleanup) void cleanup().catch(() => {}); };
  }, [camera, id]);
  return <div className="stack">
    <div id={id} className={camera ? 'w-full max-w-md overflow-hidden rounded-xl' : 'hidden'}/>
    <div><Button secondary onClick={() => { setCamera(!camera); setCameraError(''); }}>{camera ? 'Stop camera' : 'Use camera'}</Button></div>
    {cameraError && <p className="error">{cameraError}</p>}
    <form className="stack" onSubmit={event => { const { qrToken } = values(event); if (qrToken) void submit(qrToken); }}>
      <Field label="Paste QR token"><input name="qrToken" required autoComplete="off" placeholder="Paste the token shown with the visitor QR"/></Field>
      <div><Button type="submit" disabled={processing}>Verify token</Button></div>
    </form>
    {message && <div role="status" className={message.error ? 'error' : 'rounded-lg bg-emerald-100 p-4 text-emerald-950'}>{message.content}</div>}
  </div>;
}
function GatePicker({ gates, onChange, value }: { gates: Gate[]; onChange?: (gate: string) => void; value?: string }) {
  return <Field label="Gate"><select required name="gateId" value={value} onChange={onChange ? event => onChange(event.target.value) : undefined}>
    {gates.map(gate => <option key={gate.id} value={gate.id}>{gate.name || 'Gate ' + gate.gateNumber}</option>)}
  </select></Field>;
}
function ScanPage({ gates }: { gates: Gate[] }) {
  const [mode, setMode] = useState('ENTRY');
  const [chosen, setChosen] = useState('');
  const gate = gates.find(gate => gate.id === chosen)?.id ?? gates[0]?.id;
  const write = useWrite();
  return <><Heading title="Scan at gate"/><Card><StatusTabs items={['ENTRY', 'EXIT']} value={mode} set={setMode}/>
    <GatePicker gates={gates} value={gate} onChange={setChosen}/>
    <Scanner scan={async qrToken => {
      const { visit } = await write.mutateAsync({ path: '/scans/' + mode.toLowerCase(), body: { qrToken, gateId: gate } }) as { visit: Visit };
      return <div className="actions">{visit.visitor?.photoUrl && <img className="h-12 w-12 rounded-lg object-cover" src={visit.visitor.photoUrl} alt=""/>}
        <div><strong>{mode === 'ENTRY' ? 'Entry recorded' : 'Exit recorded'}</strong><p>{visit.visitor?.name} · {visit.guestType.name} · {visit.flat.label}</p></div></div>;
    }}/>
  </Card></>;
}
function WalkIn({ base, society, gates }: { base: string; society: string; gates: Gate[] }) {
  const [phone, setPhone] = useState('');
  const [prefix, setPrefix] = useState('');
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<string | undefined>();
  const [visitId, setVisitId] = useState(() => sessionStorage.getItem('walkin:' + society) || '');
  const result = useData<Visit>('/visits/' + visitId, !!visitId);
  const suggestions = useData<WalkInProfile[]>(base + '/walkins/suggestions?phonePrefix=' + encodeURIComponent(prefix), /^\+?\d{4,15}$/.test(prefix));
  const write = useWrite();
  useEffect(() => {
    const timer = setTimeout(() => setPrefix(phone ? '+91' + mobileDigits(phone) : ''), 400);
    return () => clearTimeout(timer);
  }, [phone]);
  const visit = result.data;
  function reset() {
    setVisitId(''); sessionStorage.removeItem('walkin:' + society); setName(''); setPhone(''); setPhoto(undefined);
  }
  return <><Heading title="Walk-in request"/><Card>
    {visitId ? <div className="stack">
      {visit ? <VisitRow visit={visit}/> : <p className={result.isError ? 'error' : 'muted'}>{result.error?.message || 'Loading request…'}</p>}
      {visit?.status === 'APPROVED' && <Form label="Allow entry" submit={event => write.mutateAsync({ path: '/visits/' + visitId + '/allow-entry', body: values(event) })}><GatePicker gates={gates}/></Form>}
      {visit && ['PENDING', 'NO_RESPONSE'].includes(visit.status) && <Action secondary path={'/visits/' + visitId + '/resend'}>Resend request</Action>}
      <Button secondary onClick={reset}>New walk-in</Button>
    </div> : <Form label="Send for approval" submit={async event => {
      const file = new FormData(event.currentTarget).get('photo') as File;
      const fields = values(event);
      if (!fields.wing || !fields.flatNumber) throw new Error('Choose a home.');
      const { flatId } = await lookup(society, fields);
      const { guestTypeId, purpose, vehicleNumber } = fields;
      const result = await write.mutateAsync({ path: base + '/walkins', body: { flatId, guestTypeId, purpose, vehicleNumber, phone: phoneSchema.parse(phone), name, photoUrl: file.size ? await upload(file, 'WALKIN') : photo } });
      setVisitId(result.id); sessionStorage.setItem('walkin:' + society, result.id);
    }}>
      <Field label="Visitor mobile number (+91)"><PhoneInput required value={phone} onChange={event => { setPhone(event.target.value); setPhoto(undefined); }}/></Field>
      {!!suggestions.data?.length && <div className="actions">{suggestions.data.map(item => <Button secondary key={item.id} onClick={() => { setName(item.name); setPhone(item.phone); setPhoto(item.photoUrl ?? undefined); }}>{item.name} · {item.phone}</Button>)}</div>}
      {suggestions.isError && <p className="error">{suggestions.error.message}</p>}
      <Field label="Visitor name"><input required value={name} onChange={event => setName(event.target.value)}/></Field>
      {photo && <img src={photo} alt="Previous visitor photo" className="h-12 w-12 rounded object-cover"/>}
      <Field label="Visitor photo (optional)"><input type="file" name="photo" accept="image/jpeg,image/png,image/webp"/></Field>
      <HomeFields society={society}/><GuestFields/>
    </Form>}
  </Card></>;
}
export function GuardPage({ society, section }: { society: string; section?: string }) {
  const base = '/societies/' + society;
  const current = useData<Duty | null>(base + '/duty/current');
  const gates = useData<Gate[]>(base + '/gates?limit=100');
  const write = useWrite();
  const [selected, setSelected] = useState<string[]>([]);
  if (section === 'history') return <><Heading title="Gate visit history"/><VisitList path={base + '/visits'} title="Visitors and gate records"/></>;
  if (current.isPending) return <p role="status">Loading duty…</p>;
  if (current.isError) return <p className="error">{current.error.message}</p>;
  const duty = current.data;
  const activeGates = duty?.gates.filter(gate => gate.isActive) ?? [];
  if (!duty || !section) return <><Heading title="Gate duty" note="Select the gates you are watching for this duty."/><Card>
    {duty ? <><Badge value="ON_DUTY"/><p>{activeGates.map(gate => gate.name || 'Gate ' + gate.gateNumber).join(', ') || 'No active gates on this duty'}</p>
      <div className="actions">{!!activeGates.length && <Link className="button" to="/guard/scan">Open scanner</Link>}<Action secondary path={base + '/duty/end'}>End duty</Action></div></>
      : <><Badge value="OFF_DUTY"/>{section && <p className="muted">Start duty to open this screen.</p>}
        {gates.error && <p className="error">{gates.error.message}</p>}
        {!gates.isPending && !gates.data?.some(gate => gate.isActive) && <p className="muted">No active gates are available.</p>}
        {gates.data?.filter(gate => gate.isActive).map(gate => <label key={gate.id} className="row justify-start">
          <input type="checkbox" checked={selected.includes(gate.id)} onChange={event => setSelected(event.target.checked ? [...selected, gate.id] : selected.filter(id => id !== gate.id))}/>
          {gate.name || 'Gate ' + gate.gateNumber}</label>)}
        <Button disabled={!selected.length || write.isPending} onClick={() => write.mutate({ path: base + '/duty/start', body: { gateIds: selected } })}>Start duty</Button></>}
  </Card></>;
  if (!activeGates.length) return <Card><p>No active gates are assigned to this duty.</p><Link className="button" to="/guard">Back to duty</Link></Card>;
  if (section === 'scan') return <ScanPage gates={activeGates}/>;
  if (section === 'walkin') return <WalkIn base={base} society={society} gates={activeGates}/>;
  if (section === 'inside') return <><Heading title="Inside now"/><Card><List<Visit> path={base + '/visits/inside'} render={visit =>
    <VisitRow key={visit.id} visit={visit}>{visit.isWalkIn && <Form label="Mark exit" submit={event =>
      write.mutateAsync({ path: '/visits/' + visit.id + '/mark-exit', body: values(event) })}><GatePicker gates={activeGates}/></Form>}</VisitRow>}/></Card></>;
  return <><Heading title="Emergency vehicles"/><div className="stack"><Card title="Record emergency arrival">
    <Form label="Save log entry" submit={event => write.mutateAsync({ path: base + '/emergency-logs', body: values(event) })}>
      <GatePicker gates={activeGates}/><Field label="Vehicle type"><select name="type">{['AMBULANCE', 'FIRE', 'POLICE', 'OTHER'].map(type => <option key={type} value={type}>{human(type)}</option>)}</select></Field>
      <Fields fields={[[ 'vehicleNumber', 'Vehicle number (optional)', 'optional' ], ['note', 'Note (optional)', 'optional']]}/>
    </Form></Card><EmergencyList base={base}/></div></>;
}
