// Sign in / create account dialog (opened through authDialog.open / requireAuth), plus the account dialogs.
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import { authDialog, session, useAuthRequest } from '@/lib/store'
import { go, parseHash } from '@/lib/router'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Logo } from '@/components/brand'

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <small className="text-xs text-muted-foreground">{hint}</small>}
    </div>
  )
}

export function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  )
}

export function AuthDialog() {
  const req = useAuthRequest()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (req) {
      setMode(req.mode)
      setErr('')
      setBusy(false)
    }
  }, [req])
  const login = mode === 'login'

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    if (!form.checkValidity()) {
      form.reportValidity()
      return
    }
    const f = new FormData(form)
    setErr('')
    setBusy(true)
    try {
      if (login) await api.post('/api/auth/login', { identifier: String(f.get('identifier')).trim(), password: f.get('password') })
      else await api.post('/api/auth/signup', { username: String(f.get('username')).trim(), email: String(f.get('email')).trim(), password: f.get('password') })
      await session.refresh()
      toast(login ? `Welcome back, ${session.user?.username}.` : `Welcome to Scent Atlas, ${session.user?.username}.`)
      authDialog.close(true)
    } catch (ex) {
      setErr(errorText(ex))
      setBusy(false)
      const pw = form.elements.namedItem('password') as HTMLInputElement | null
      if (pw) {
        pw.value = ''
        pw.focus()
      }
    }
  }

  return (
    <Dialog open={!!req} onOpenChange={(o) => !o && authDialog.close(false)}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader className="items-center text-center">
          <Logo size={44} />
          <DialogTitle className="mt-2 text-xl tracking-tight">{login ? 'Welcome back' : 'Create your account'}</DialogTitle>
          <DialogDescription>{req?.reason || (login ? 'Sign in to your collection, combos and saved searches.' : 'Rank your collection, share layering combos and vote.')}</DialogDescription>
        </DialogHeader>
        <form key={mode} noValidate onSubmit={submit} className="flex flex-col gap-4">
          {login ? (
            <Field id="au-id" label="Username or email">
              <Input id="au-id" name="identifier" autoComplete="username" required maxLength={254} autoCapitalize="none" spellCheck={false} autoFocus />
            </Field>
          ) : (
            <>
              <Field id="au-user" label="Username" hint="3-32 letters, digits, dot, dash or underscore.">
                <Input id="au-user" name="username" autoComplete="username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_.\-]{2,31}" autoCapitalize="none" spellCheck={false} autoFocus />
              </Field>
              <Field id="au-mail" label="Email" hint="Used to identify your account only. We never send email.">
                <Input id="au-mail" name="email" type="email" autoComplete="email" required maxLength={254} />
              </Field>
            </>
          )}
          <Field id="au-pw" label="Password" hint={login ? undefined : 'At least 8 characters; not a common password.'}>
            <Input id="au-pw" name="password" type="password" autoComplete={login ? 'current-password' : 'new-password'} required minLength={login ? undefined : 8} maxLength={128} />
          </Field>
          <FormError>{err}</FormError>
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? (login ? 'Signing in…' : 'Creating…') : login ? 'Sign in' : 'Create account'}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {login ? 'New here? ' : 'Already have an account? '}
            <button type="button" className="font-medium text-foreground underline underline-offset-4" onClick={() => (setMode(login ? 'signup' : 'login'), setErr(''))}>
              {login ? 'Create an account' : 'Sign in'}
            </button>
          </p>
          <p className="text-center text-xs text-muted-foreground">Browsing and searching never need an account.</p>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function PasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    if (!form.checkValidity()) return form.reportValidity()
    const f = new FormData(form)
    if (f.get('new') !== f.get('new2')) return setErr('The new passwords do not match.')
    setBusy(true)
    setErr('')
    try {
      await api.post('/api/auth/password', { current_password: f.get('cur'), new_password: f.get('new') })
      toast('Password changed.')
      onOpenChange(false)
    } catch (ex) {
      setErr(errorText(ex, 'Could not change the password.'))
    }
    setBusy(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Other devices are signed out when you change your password.</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <Field id="pw-cur" label="Current password">
            <Input id="pw-cur" name="cur" type="password" autoComplete="current-password" required maxLength={128} autoFocus />
          </Field>
          <Field id="pw-new" label="New password" hint="At least 8 characters; not a common password.">
            <Input id="pw-new" name="new" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
          </Field>
          <Field id="pw-new2" label="Repeat new password">
            <Input id="pw-new2" name="new2" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
          </Field>
          <FormError>{err}</FormError>
          <Button type="submit" disabled={busy}>
            Change password
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DeleteAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    if (!form.checkValidity()) return form.reportValidity()
    setBusy(true)
    setErr('')
    try {
      await api.post('/api/auth/delete', { password: new FormData(form).get('password') })
      await session.refresh()
      onOpenChange(false)
      toast('Your account has been deleted.')
      if (['/atlas', '/collection'].includes(parseHash().path)) go('/notes')
    } catch (ex) {
      setErr(errorText(ex, 'Could not delete the account.'))
    }
    setBusy(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Delete account</DialogTitle>
          <DialogDescription>This permanently deletes your account, favorites, collection, ratings, notes, saved searches and history. It cannot be undone.</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <Field id="del-pw" label="Confirm with your password">
            <Input id="del-pw" name="password" type="password" autoComplete="current-password" required maxLength={128} autoFocus />
          </Field>
          <FormError>{err}</FormError>
          <Button type="submit" variant="destructive" disabled={busy}>
            Delete my account
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
