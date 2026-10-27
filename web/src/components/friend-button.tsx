// Add friend / Requested / Accept + Decline / Friends, for one person.
import { useState } from 'react'
import { Check, ChevronDown, UserMinus, UserPlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { errorText } from '@/lib/api'
import { addFriend, removeFriend, type Relation } from '@/lib/social'
import { requireAuth, useSession } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

export function FriendButton({ username, relation, onChange, size = 'sm', quiet = false }: { username: string; relation: Relation; onChange: (r: Relation) => void; size?: 'sm' | 'default'; /** outline "Add friend" (for grids of many people) */ quiet?: boolean }) {
  const { user } = useSession()
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<Relation>, done?: (r: Relation) => string) => {
    if (!user && !(await requireAuth('Sign in to add friends.'))) return
    setBusy(true)
    try {
      const r = await fn()
      onChange(r)
      const msg = done?.(r)
      if (msg) toast(msg)
    } catch (e) {
      toast(errorText(e, 'Could not update the friendship.'))
    }
    setBusy(false)
  }
  if (relation === 'self') return null
  if (relation === 'friends')
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size={size} variant="outline" disabled={busy}>
            <Check />
            Friends
            <ChevronDown className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => run(() => removeFriend(username), () => `You and @${username} are no longer friends.`)}>
            <UserMinus />
            Remove friend
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  if (relation === 'incoming')
    return (
      <span className="inline-flex gap-1.5">
        <Button size={size} disabled={busy} onClick={() => run(() => addFriend(username), () => `You and @${username} are now friends.`)}>
          <Check />
          Accept
        </Button>
        <Button size={size} variant="outline" disabled={busy} onClick={() => run(() => removeFriend(username))} aria-label={`Decline @${username}`}>
          <X />
          Decline
        </Button>
      </span>
    )
  if (relation === 'outgoing')
    return (
      <Button size={size} variant="outline" disabled={busy} onClick={() => run(() => removeFriend(username), () => 'Request cancelled.')} title="Click to cancel the request">
        Requested
      </Button>
    )
  return (
    <Button size={size} variant={quiet ? 'outline' : 'default'} disabled={busy} onClick={() => run(() => addFriend(username), (r) => (r === 'friends' ? `You and @${username} are now friends.` : `Friend request sent to @${username}.`))}>
      <UserPlus />
      Add friend
    </Button>
  )
}
