import { useEffect, useId, useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatInTimeZone } from 'date-fns-tz';
import { useList, useWrite, toast } from './api';
import type { Visit } from './types';
import { PhoneInput, phoneSchema } from './phone';

export const formatDate = (value?: string | null) => value ? formatInTimeZone(value, 'Asia/Kolkata', 'dd MMM yyyy, hh:mm a') : '—';
export const human = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
export function Heading({ title, note, children }: { title: string; note?: string; children?: ReactNode }) {
  return <header className="page-title"><div><h1>{title}</h1>{note && <p>{note}</p>}</div>{children}</header>;
}
export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return <section className="card">{title && <h2>{title}</h2>}{children}</section>;
}
export function Badge({ value, label }: { value: string; label?: string }) {
  return <span className={'badge badge-' + value.toLowerCase()}>{label ?? human(value)}</span>;
}
export function Button({ secondary, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { secondary?: boolean }) {
  return <button type="button" className={'button ' + (secondary ? 'secondary ' : '') + className} {...props}/>;
}
export function Action({ path, children, body, method, secondary = false }: { path: string; children: ReactNode; body?: unknown; method?: 'POST' | 'PATCH' | 'DELETE'; secondary?: boolean }) {
  const write = useWrite();
  return <Button secondary={secondary} disabled={write.isPending} onClick={() => write.mutate({ path, body, method })}>{children}</Button>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}
export function Fields({ fields, initial = {} }: { fields: [string, string, string?][]; initial?: Record<string, any> }) {
  return <div className="field-grid">{fields.map(([name, label, kind]) => <Field key={name} label={label}>
    {kind?.replace('?', '') === 'tel' ? <PhoneInput name={name} required={!kind.endsWith('?')} defaultValue={initial[name] ?? ''}/>
      : <input name={name} type={kind === 'optional' || !kind ? 'text' : kind.replace('?', '')}
        required={kind !== 'optional' && !kind?.endsWith('?')} defaultValue={initial[name] ?? ''} />}
  </Field>)}</div>;
}
export function values(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return Object.fromEntries([...new FormData(event.currentTarget)].filter(([, value]) => typeof value === 'string' && value.trim() !== '')
    .map(([name, value]) => [name, /phone$/i.test(name) ? phoneSchema.parse(value) : value])) as Record<string, string>;
}
export function Form({ submit, label, children, className = '' }: { submit: (event: FormEvent<HTMLFormElement>) => Promise<unknown>; label: string; children: ReactNode; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <form className={'stack ' + className} onSubmit={async event => {
    event.preventDefault();
    setBusy(true); setError('');
    try { await submit(event); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }}>{children}{error && <p className="error" role="alert">{error}</p>}<div><Button type="submit" disabled={busy}>{busy ? 'Saving…' : label}</Button></div></form>;
}
export function StatusTabs({ items, value, set }: { items: readonly string[]; value: string; set: (value: string) => void }) {
  return <div className="tabs" aria-label="Filter by status">{items.map(item =>
    <button key={item} type="button" aria-pressed={item === value} onClick={() => set(item)}>{human(item || 'All')}</button>)}</div>;
}
export function List<T>({ path, render, empty = 'Nothing to show yet.' }: { path: string; render: (row: T) => ReactNode; empty?: string }) {
  const [selection, setSelection] = useState({ path, page: 1 });
  const page = selection.path === path ? selection.page : 1;
  const result = useList<T>(path, page);
  if (result.isPending) return <p className="muted" role="status">Loading…</p>;
  if (result.isError) return <div className="error" role="alert">{result.error.message} <Button secondary onClick={() => void result.refetch()}>Retry</Button></div>;
  const meta = result.data.meta;
  return <div className="stack">{result.data.data.length ? result.data.data.map(render) : <p className="empty">{empty}</p>}
    {meta && (meta.total > meta.limit || page > 1) && <div className="actions">
      <Button secondary disabled={page === 1} onClick={() => setSelection({ path, page: page - 1 })}>Previous</Button>
      <span className="muted">Page {page}</span>
      <Button secondary disabled={page * meta.limit >= meta.total} onClick={() => setSelection({ path, page: page + 1 })}>Next</Button>
    </div>}</div>;
}
export function VisitRow({ visit, detail, children }: { visit: Visit; detail?: boolean; children?: ReactNode }) {
  return <article className="row"><div><div className="row-title">
    {detail ? <Link to={'/visits/' + visit.id}>{visit.visitor?.name ?? visit.guestType.name}</Link> : visit.visitor?.name ?? visit.guestType.name}
    <Badge value={visit.isOverstayed ? 'OVERSTAYED' : visit.status}/></div>
    <p className="muted">{visit.flat.label} · {visit.guestType.name} · {visit.purpose}</p>
    <p className="muted text-sm">{formatDate(visit.createdAt)}{visit.visitor?.phone && ' · ' + visit.visitor.phone}</p>
    {visit.vehicleNumber && <p className="muted text-sm">Vehicle: {visit.vehicleNumber}</p>}
    {(visit.entryAt || visit.exitAt) && <p className="muted text-xs">Entry: {formatDate(visit.entryAt)} · Exit: {formatDate(visit.exitAt)}</p>}
    {visit.respondedBy && <p className="muted text-sm">Handled by {visit.respondedBy.name}</p>}
  </div>{children && <div className="actions">{children}</div>}</article>;
}
export function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const id = useId();
  useEffect(() => {
    const dialog = document.getElementById(id) as HTMLDialogElement;
    if (!dialog.open) dialog.showModal();
    return () => dialog.close();
  }, [id]);
  return <dialog id={id} onCancel={close} aria-labelledby={id + '-title'}>
    <div className="flex items-start justify-between gap-4"><h2 id={id + '-title'}>{title}</h2><Button secondary onClick={close}>Close</Button></div>{children}
  </dialog>;
}
export function Toasts() {
  const [item, setItem] = useState<{ message: string; error: boolean } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const show = (event: Event) => {
      clearTimeout(timer);
      setItem((event as CustomEvent).detail);
      timer = setTimeout(() => setItem(null), 4200);
    };
    window.addEventListener('toast', show);
    return () => { clearTimeout(timer); window.removeEventListener('toast', show); };
  }, []);
  return item ? <div role="status" className={'toast ' + (item.error ? 'toast-error' : '')}>{item.message}<button type="button" onClick={() => setItem(null)} aria-label="Dismiss">×</button></div> : null;
}
export function report(error: unknown) { toast((error as Error).message, true); }
