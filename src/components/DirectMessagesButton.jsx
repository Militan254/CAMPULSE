import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { supabase } from '../supabase'
import NavIcon from './NavIcon'

export default function DirectMessagesButton({ session }) {
  const [unread, setUnread] = useState(0)
  const userId = session?.user?.id

  useEffect(() => {
    // Signed out: nothing to count, so don't start anything
    if (!userId) return undefined

    let cancelled = false

    async function refreshUnread() {
      // 1. Which conversations am I in (and not hidden)?
      const { data: memberships } = await supabase
        .from('conversation_participants')
        .select('conversation_id, last_read_at')
        .eq('user_id', userId)
        .is('deleted_at', null)

      if (cancelled) return
      if (!memberships?.length) {
        setUnread(0)
        return
      }

      // 2. In each one, count messages from the other person that arrived after I last read
      const counts = await Promise.all(
        memberships.map(async (membership) => {
          let query = supabase
            .from('direct_messages')
            .select('id', { count: 'exact', head: true })
            .eq('conversation_id', membership.conversation_id)
            .neq('sender_id', userId)

          if (membership.last_read_at) query = query.gt('created_at', membership.last_read_at)

          const { count } = await query
          return count || 0
        })
      )

      // 3. Add them up
      if (!cancelled) setUnread(counts.reduce((sum, count) => sum + count, 0))
    }

    refreshUnread()

    // Recount whenever a new message arrives
    const channel = supabase
      .channel(`unread-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, refreshUnread)
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [userId])

  // Signed out always shows 0, without needing to reset the state
  const count = userId ? unread : 0

  return (
    <NavLink
      aria-label={count ? `Messages, ${count} unread` : 'Messages'}
      className="nav-item"
      to="/messages"
    >
      <NavIcon name="messages" />
      <span>Messages</span>
      {count > 0 && <span className="unread-badge">{count > 99 ? '99+' : count}</span>}
    </NavLink>
  )
}