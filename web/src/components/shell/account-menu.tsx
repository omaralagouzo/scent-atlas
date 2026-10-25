import { useState } from 'react'
import { LogOut, Moon, Sun, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { authDialog, session, useSession } from '@/lib/store'
import { go, parseHash } from '@/lib/router'
import { useTheme } from '@/lib/theme'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DeleteAccountDialog, PasswordDialog } from './auth-dialog'

/** Avatar initial on a colour derived from the username (stable, muted). */
export function UserAvatar({ name, size = 32 }: { name: string; size?: number }) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white select-none"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `oklch(0.66 0.09 ${h})` }}
      aria-hidden="true"
    >
      {name[0]?.toUpperCase()}
    </span>
  )
}

async function signOut() {
  try {
    await api.post('/api/auth/logout', {})
  } catch {
    /* ignore */
  }
  await session.refresh()
  toast('Signed out.')
  if (['/atlas', '/collection'].includes(parseHash().path)) go('/notes')
}

export function AccountMenu() {
  const { user } = useSession()
  const { theme, toggle } = useTheme()
  const [pw, setPw] = useState(false)
  const [del, setDel] = useState(false)
  if (!user)
    return (
      <Button size="sm" onClick={() => authDialog.open({ mode: 'login' })}>
        <UserRound />
        Sign in
      </Button>
    )
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none" aria-label={`Account: ${user.username}`} title={user.email}>
            <UserAvatar name={user.username} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="flex flex-col">
            <span>{user.username}</span>
            <small className="font-normal text-muted-foreground">{user.email}</small>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => go(`/u/${encodeURIComponent(user.username)}`)}>My profile</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => go('/collection')}>My Collection</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => go('/friends')}>Friends</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => go('/atlas')}>My Atlas</DropdownMenuItem>
          <DropdownMenuItem onSelect={toggle} className="sm:hidden">
            {theme === 'dark' ? <Sun /> : <Moon />}
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setPw(true)}>Change password</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDel(true)} className="text-destructive focus:text-destructive">
            Delete account…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={signOut}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PasswordDialog open={pw} onOpenChange={setPw} />
      <DeleteAccountDialog open={del} onOpenChange={setDel} />
    </>
  )
}
