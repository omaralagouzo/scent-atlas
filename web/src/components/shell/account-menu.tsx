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
import { UserAvatar } from '@/components/avatar'
import { openProfileEditor } from '@/components/profile-editor'
import { DeleteAccountDialog, PasswordDialog } from './auth-dialog'

export { UserAvatar }

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
          <button type="button" className="rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none" aria-label={`Account: ${user.name}`} title={user.email}>
            <UserAvatar name={user.name} seed={user.username} src={user.avatar} top={user.top} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="flex items-center gap-3">
            <UserAvatar name={user.name} seed={user.username} src={user.avatar} top={user.top} size={36} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{user.name}</span>
              <small className="truncate font-normal text-muted-foreground">@{user.username}</small>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => go(`/u/${encodeURIComponent(user.username)}`)}>My profile</DropdownMenuItem>
          <DropdownMenuItem onSelect={openProfileEditor}>Edit name &amp; photo</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => go('/collection')}>My Collection</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => go('/friends')}>Friends</DropdownMenuItem>
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
