// Security: whether two-factor sign-in is on, and a guided setup that makes the authenticator key in this browser.
// The key never goes to the server: the owner adds it to an authenticator app and to the ADMIN_TOTP_SECRET variable.
import { useState } from 'react'
import { Check, Copy, KeyRound, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHead, Panel } from './parts'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32, no padding. */
function base32(bytes: Uint8Array) {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

function unbase32(s: string) {
  const clean = s.replace(/[\s=]/g, '').toUpperCase()
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const c of clean) {
    const i = B32.indexOf(c)
    if (i < 0) continue
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

const newSecret = () => base32(crypto.getRandomValues(new Uint8Array(20)))

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits), computed locally so the owner can check their app before deploying. */
async function totp(secret: string, step: number) {
  const key = await crypto.subtle.importKey('raw', unbase32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const msg = new ArrayBuffer(8)
  const view = new DataView(msg)
  view.setUint32(0, Math.floor(step / 2 ** 32))
  view.setUint32(4, step >>> 0)
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))
  const off = mac[mac.length - 1] & 15
  const n = (((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3]) % 1_000_000
  return String(n).padStart(6, '0')
}

// WebCrypto exists only in secure contexts (https, localhost)
const canCheck = typeof crypto !== 'undefined' && !!crypto.subtle

const otpauth = (secret: string) => `otpauth://totp/Scent%20Atlas:admin?secret=${secret}&issuer=Scent%20Atlas`

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          window.setTimeout(() => setDone(false), 1500)
        } catch {
          toast.error('Copy failed. Select the text and copy it yourself.')
        }
      }}
    >
      {done ? <Check /> : <Copy />}
      {done ? 'Copied' : label}
    </Button>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full border font-mono text-xs font-semibold">{n}</span>
      <div className="min-w-0 flex-1 pb-1">
        <p className="text-sm font-medium">{title}</p>
        <div className="mt-1.5 text-sm text-muted-foreground">{children}</div>
      </div>
    </li>
  )
}

function Setup({ onCancel }: { onCancel: () => void }) {
  const [secret, setSecret] = useState(newSecret)
  const [code, setCode] = useState('')
  const [check, setCheck] = useState<'ok' | 'bad' | null>(null)
  const groups = secret.match(/.{1,4}/g) || []

  const verify = async (c: string) => {
    if (c.length !== 6) return setCheck(null)
    const now = Math.floor(Date.now() / 1000 / 30)
    const codes = await Promise.all([now - 1, now, now + 1].map((s) => totp(secret, s)))
    setCheck(codes.includes(c) ? 'ok' : 'bad')
  }

  return (
    <div className="px-4 pb-5 sm:px-5">
      <ol className="flex flex-col gap-5">
        <Step n={1} title="Add this key to your authenticator app">
          <p>In Google Authenticator, 1Password or Authy choose “Enter a setup key” (or “Add manually”), name it Scent Atlas admin, and type or paste:</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="rounded-lg border bg-muted/50 px-3 py-2 font-mono text-[15px] tracking-[0.08em] text-foreground select-all" aria-label="Setup key">
              {groups.join(' ')}
            </code>
            <CopyButton text={secret} label="Copy key" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSecret(newSecret())
                setCode('')
                setCheck(null)
              }}
            >
              <RefreshCw />
              New key
            </Button>
          </div>
          <p className="mt-3 text-xs">Time-based, 6 digits, every 30 seconds. Apps that accept a link can use:</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <code className="min-w-0 rounded-md bg-muted/50 px-2 py-1 font-mono text-[11px] break-all text-foreground select-all">{otpauth(secret)}</code>
            <CopyButton text={otpauth(secret)} label="Copy link" />
          </div>
        </Step>
        {canCheck && <Step n={2} title="Check a code (optional)">
          <p>Type the code your app shows. This check runs in this browser only.</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Label htmlFor="check-code" className="sr-only">
              Code from your app
            </Label>
            <Input
              id="check-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              className="w-32 font-mono tracking-[0.3em]"
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 6)
                setCode(v)
                void verify(v)
              }}
            />
            {check === 'ok' && (
              <span className="flex items-center gap-1.5 text-sm text-success">
                <Check className="size-4" /> The code matches.
              </span>
            )}
            {check === 'bad' && (
              <span className="flex items-center gap-1.5 text-sm text-destructive">
                <ShieldAlert className="size-4" /> That code doesn't match this key.
              </span>
            )}
          </div>
        </Step>}
        <Step n={canCheck ? 3 : 2} title="Set it on the server">
          <p>
            In Render, open the service's <span className="text-foreground">Environment</span> settings and add <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">ADMIN_TOTP_SECRET</code> with the key above as its value. Saving redeploys the
            site; from then on signing in here asks for a code.
          </p>
          <div className="mt-2">
            <CopyButton text={`ADMIN_TOTP_SECRET=${secret}`} label="Copy as variable" />
          </div>
        </Step>
      </ol>
      <p className="mt-5 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        The key was made in this browser and is never sent to Scent Atlas. Leaving this page forgets it, so add it to your app and to Render first.
      </p>
      <Button variant="ghost" size="sm" className="mt-3 text-muted-foreground" onClick={onCancel}>
        Close setup
      </Button>
    </div>
  )
}

export function Security({ twoFactor }: { twoFactor: boolean }) {
  const [setup, setSetup] = useState(false)
  return (
    <>
      <PageHead title="Security" lede="How the admin sign-in is protected." />
      <div className="flex max-w-3xl flex-col gap-4">
        <Panel
          title="Two-factor sign-in"
          hint="A 6-digit code from an authenticator app, asked for after the password."
          action={
            <span
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                twoFactor ? 'bg-success/10 text-success' : 'bg-warning/12 text-foreground [&>svg]:text-warning',
              )}
            >
              {twoFactor ? <ShieldCheck className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
              {twoFactor ? 'On' : 'Off'}
            </span>
          }
        >
          {twoFactor ? (
            <div className="px-4 pb-5 text-sm text-muted-foreground sm:px-5">
              <p>
                Two-factor is on: signing in needs the admin password and a code from your authenticator app. To use a new device or key, set up a new key below and replace{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">ADMIN_TOTP_SECRET</code> on Render. Removing the variable turns two-factor off.
              </p>
              {!setup && (
                <Button variant="outline" className="mt-4" onClick={() => setSetup(true)}>
                  <KeyRound />
                  Make a new key
                </Button>
              )}
            </div>
          ) : (
            !setup && (
              <div className="px-4 pb-5 text-sm text-muted-foreground sm:px-5">
                <p>Two-factor is off: the password alone opens this dashboard. Turn it on so a leaked password isn't enough.</p>
                <Button className="mt-4" onClick={() => setSetup(true)}>
                  <ShieldCheck />
                  Set up two-factor
                </Button>
              </div>
            )
          )}
          {setup && <Setup onCancel={() => setSetup(false)} />}
        </Panel>
        <Panel title="Admin password" hint="Set with the ADMIN_PASSWORD environment variable (at least 16 characters).">
          <p className="px-4 pb-5 text-sm text-muted-foreground sm:px-5">To change it, update the variable on Render.</p>
        </Panel>
      </div>
    </>
  )
}
