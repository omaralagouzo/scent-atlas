// The side sheet for one account: their recent activity and the account actions
// (reset password, sign out everywhere, edit username / email, delete).
import { useEffect, useState } from 'react'
import { KeyRound, LogOut, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { errorText } from '@/lib/api'
import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { admin, ago, dateOnly, deviceName, fullTime, num, when, type Account, type ActivityPage, type Hit } from './data'
import { Muted } from './parts'

type Action = 'password' | 'revoke' | 'edit' | 'delete' | null

export function PersonSheet({ user, onClose, onChanged, onDeleted }: { user: Account | null; onClose: () => void; onChanged: () => void; onDeleted: () => void }) {
  // keep the last user around while the sheet animates closed
  const [shown, setShown] = useState<Account | null>(user)
  if (user && user !== shown) setShown(user)
  const u = user || shown
  return (
    <Sheet open={!!user} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[480px]">
        {u && <PersonBody key={u.id} u={u} onChanged={onChanged} onDeleted={onDeleted} />}
      </SheetContent>
    </Sheet>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border px-2.5 py-2">
      <span className="font-mono text-lg font-semibold">{num(value)}</span>
      <span className="truncate text-[11px] text-muted-foreground">{label}</span>
    </div>
  )
}

function PersonBody({ u, onChanged, onDeleted }: { u: Account; onChanged: () => void; onDeleted: () => void }) {
  const [action, setAction] = useState<Action>(null)
  const toggle = (a: Action) => setAction((cur) => (cur === a ? null : a))
  return (
    <>
      <SheetHeader className="gap-3 border-b p-5 pr-12">
        <div className="flex items-center gap-3">
          <UserAvatar name={u.name || u.username} seed={u.username} src={u.avatar} size={52} />
          <div className="min-w-0">
            <SheetTitle className="truncate text-lg tracking-[-0.02em]">{u.name || u.username}</SheetTitle>
            <SheetDescription className="flex flex-col">
              <span className="truncate">@{u.username}</span>
              <span className="break-all">{u.email}</span>
            </SheetDescription>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Joined</dt>
          <dd title={fullTime(u.created_at)}>{dateOnly(u.created_at)}</dd>
          <dt className="text-muted-foreground">Last signed in</dt>
          <dd title={u.last_login_at ? fullTime(u.last_login_at) : undefined}>{ago(u.last_login_at)}</dd>
          <dt className="text-muted-foreground">Last seen</dt>
          <dd title={u.last_seen_at ? fullTime(u.last_seen_at) : undefined}>{ago(u.last_seen_at)}</dd>
        </dl>
        <div className="grid grid-cols-5 gap-2 max-[420px]:grid-cols-3">
          <Stat label="30d views" value={u.views_30d} />
          <Stat label="Bottles" value={u.owned} />
          <Stat label="Friends" value={u.friends} />
          <Stat label="Reviews" value={u.reviews} />
          <Stat label="Sessions" value={u.sessions} />
        </div>
      </SheetHeader>

      <section className="border-b p-5" aria-label="Account actions">
        <h3 className="mb-3 text-sm font-semibold">Account</h3>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={action === 'password' ? 'secondary' : 'outline'} aria-expanded={action === 'password'} onClick={() => toggle('password')}>
            <KeyRound />
            Reset password
          </Button>
          <Button size="sm" variant={action === 'revoke' ? 'secondary' : 'outline'} aria-expanded={action === 'revoke'} onClick={() => toggle('revoke')} disabled={!u.sessions}>
            <LogOut />
            Sign out everywhere
          </Button>
          <Button size="sm" variant={action === 'edit' ? 'secondary' : 'outline'} aria-expanded={action === 'edit'} onClick={() => toggle('edit')}>
            <Pencil />
            Edit
          </Button>
          <Button size="sm" variant={action === 'delete' ? 'secondary' : 'outline'} aria-expanded={action === 'delete'} onClick={() => toggle('delete')} className="text-destructive hover:text-destructive">
            <Trash2 />
            Delete
          </Button>
        </div>
        {action === 'password' && <ResetPassword u={u} done={() => (setAction(null), onChanged())} />}
        {action === 'revoke' && <Revoke u={u} done={() => (setAction(null), onChanged())} />}
        {action === 'edit' && <Edit u={u} done={() => (setAction(null), onChanged())} />}
        {action === 'delete' && <Delete u={u} done={onDeleted} />}
      </section>

      <RecentActivity userId={u.id} />
    </>
  )
}

/** A small inline form with an error line and a submit button. */
export function ActionForm({ title, children, submit, label, danger, run }: { title: React.ReactNode; children?: React.ReactNode; submit?: boolean; label: string; danger?: boolean; run: () => Promise<void> }) {
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      noValidate
      className={cn('mt-3 flex flex-col gap-3 rounded-lg border p-4', danger ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/40')}
      onSubmit={async (e) => {
        e.preventDefault()
        setErr('')
        setBusy(true)
        try {
          await run()
        } catch (ex) {
          setErr(ex instanceof Error && !('status' in ex) ? ex.message : errorText(ex, 'That did not work.'))
          setBusy(false)
        }
      }}
    >
      <p className="text-sm">{title}</p>
      {children}
      {err && (
        <p role="alert" className="text-sm text-destructive">
          {err}
        </p>
      )}
      <div>
        <Button type="submit" size="sm" variant={danger ? 'destructive' : 'default'} disabled={busy || submit === false}>
          {busy ? 'Working…' : label}
        </Button>
      </div>
    </form>
  )
}

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function ResetPassword({ u, done }: { u: Account; done: () => void }) {
  const [pw, setPw] = useState('')
  return (
    <ActionForm
      title="Choose a new password and tell them. All of their sessions are signed out."
      label="Set password"
      submit={pw.length > 0}
      run={async () => {
        if (pw.length < 8) throw new Error('Use at least 8 characters.')
        await admin.post(`/users/${u.id}/password`, { new_password: pw })
        toast.success(`Password reset for @${u.username}.`)
        done()
      }}
    >
      <Field id="new-pw" label="New password" hint="At least 8 characters; not a common password.">
        <Input id="new-pw" type="password" autoComplete="new-password" autoFocus minLength={8} maxLength={128} value={pw} onChange={(e) => setPw(e.target.value)} />
      </Field>
    </ActionForm>
  )
}

function Revoke({ u, done }: { u: Account; done: () => void }) {
  return (
    <ActionForm
      title={`Sign @${u.username} out of all ${u.sessions} active session${u.sessions === 1 ? '' : 's'}? Their password stays the same.`}
      label="Sign out everywhere"
      run={async () => {
        const r = await admin.post<{ revoked: number }>(`/users/${u.id}/revoke-sessions`)
        toast.success(`Signed out @${u.username} (${r.revoked} session${r.revoked === 1 ? '' : 's'}).`)
        done()
      }}
    />
  )
}

function Edit({ u, done }: { u: Account; done: () => void }) {
  const [username, setUsername] = useState(u.username)
  const [email, setEmail] = useState(u.email)
  const body: { username?: string; email?: string } = {}
  if (username.trim() !== u.username) body.username = username.trim()
  if (email.trim() !== u.email) body.email = email.trim()
  const changed = Object.keys(body).length > 0
  return (
    <ActionForm
      title="Change their username or email."
      label="Save"
      submit={changed && !!username.trim() && !!email.trim()}
      run={async () => {
        await admin.patch(`/users/${u.id}`, body)
        toast.success('Saved.')
        done()
      }}
    >
      <Field id="edit-username" label="Username">
        <Input id="edit-username" autoCapitalize="none" autoComplete="off" spellCheck={false} maxLength={32} value={username} onChange={(e) => setUsername(e.target.value)} />
      </Field>
      <Field id="edit-email" label="Email">
        <Input id="edit-email" type="email" autoComplete="off" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
    </ActionForm>
  )
}

function Delete({ u, done }: { u: Account; done: () => void }) {
  const [confirm, setConfirm] = useState('')
  const match = confirm.trim().toLowerCase() === u.username.toLowerCase()
  return (
    <ActionForm
      title="This permanently deletes the account with its collection, ratings, reviews, notes, friends and history. It cannot be undone."
      label="Delete account"
      danger
      submit={match}
      run={async () => {
        if (!match) throw new Error('The username does not match.')
        await admin.del(`/users/${u.id}`)
        toast.success(`Deleted @${u.username}.`)
        done()
      }}
    >
      <Field id="delete-confirm" label={`Type ${u.username} to confirm`}>
        <Input id="delete-confirm" autoCapitalize="none" autoComplete="off" spellCheck={false} placeholder={u.username} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
    </ActionForm>
  )
}

function RecentActivity({ userId }: { userId: number }) {
  const [items, setItems] = useState<Hit[] | null>(null)
  const [next, setNext] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async (before?: number) => {
    setBusy(true)
    try {
      const r = await admin.get<ActivityPage>('/activity', { limit: 50, user_id: userId, before })
      setItems((cur) => (before && cur ? [...cur, ...r.items] : r.items))
      setNext(r.next_before)
      setErr('')
    } catch (e) {
      setErr(errorText(e, "Couldn't load their activity."))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])
  return (
    <section className="p-5" aria-label="Recent activity">
      <h3 className="mb-2 text-sm font-semibold">Recent activity</h3>
      {err && !items && <Muted>{err}</Muted>}
      {!items && !err && <Muted>Loading…</Muted>}
      {items?.length === 0 && <Muted>No page views recorded yet.</Muted>}
      {items && items.length > 0 && (
        <ol className="divide-y">
          {items.map((h) => (
            <li key={h.id} className="flex items-baseline gap-3 py-2 text-sm">
              <time className="w-[136px] shrink-0 font-mono whitespace-nowrap text-xs text-muted-foreground tabular-nums" dateTime={new Date(h.ts * 1000).toISOString()} title={fullTime(h.ts)}>
                {when(h.ts)}
              </time>
              <span className="min-w-0 flex-1 truncate" title={h.path}>
                {h.label || h.path}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{deviceName(h.device)}</span>
            </li>
          ))}
        </ol>
      )}
      {next && (
        <Button variant="ghost" size="sm" className="mt-2 w-full text-muted-foreground" disabled={busy} onClick={() => void load(next)}>
          {busy ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </section>
  )
}
