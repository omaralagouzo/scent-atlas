// Admin sign-in (password, plus a 6-digit authenticator code when two-factor is on) and the "switched off" state.
import { useRef, useState } from 'react'
import { LockKeyhole, PowerOff } from 'lucide-react'
import { errorText } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { admin } from './data'

export function SignIn({ twoFactor, onDone }: { twoFactor: boolean; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const pwRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!password) return pwRef.current?.focus()
    if (twoFactor && code.length !== 6) {
      setErr('Enter the 6-digit code from your authenticator app.')
      return codeRef.current?.focus()
    }
    setBusy(true)
    try {
      await admin.login(password, twoFactor ? code : undefined)
      onDone()
    } catch (ex) {
      setErr(errorText(ex, 'Sign-in failed.'))
      setCode('')
      setBusy(false)
      ;(twoFactor && password ? codeRef : pwRef).current?.focus()
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl border bg-card">
          <LockKeyhole className="size-5" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.02em]">Admin sign-in</h1>
          <p className="text-sm text-muted-foreground">{twoFactor ? 'Password and authenticator code.' : 'Only the site owner can sign in here.'}</p>
        </div>
      </div>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-xl border bg-card p-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="admin-pw">Admin password</Label>
          <Input
            id="admin-pw"
            ref={pwRef}
            type="password"
            autoComplete="current-password"
            autoFocus
            maxLength={1024}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {twoFactor && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="admin-code">Authenticator code</Label>
            <Input
              id="admin-code"
              ref={codeRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="123456"
              className="font-mono tracking-[0.3em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>
        )}
        {err && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {err}
          </p>
        )}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  )
}

export function Disabled() {
  return (
    <div className="w-full max-w-sm text-center">
      <span className="mx-auto mb-4 grid size-12 place-items-center rounded-xl border bg-card text-muted-foreground">
        <PowerOff className="size-5" />
      </span>
      <h1 className="text-xl font-semibold tracking-[-0.02em]">Admin is switched off</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Set the <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">ADMIN_PASSWORD</code> environment variable (at least 16 characters) to turn it on.
      </p>
    </div>
  )
}
