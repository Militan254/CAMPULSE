import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabase'

const PAGE_SIZE = 50

function getOtherParticipant(conversation, userId) {
  return conversation?.conversation_participants?.find((participant) => participant.user_id !== userId)
}

function formatDay(value) {
  return new Date(value).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

export default function DirectMessages({ session, blockedOnly = false }) {
  const { conversationId } = useParams()
  const navigate = useNavigate()
  const [query] = useSearchParams()
  const sessionId = session?.user?.id
  const [newMessageOpen, setNewMessageOpen] = useState(false)
  const [conversations, setConversations] = useState([])
  const [messages, setMessages] = useState([])
  const [profiles, setProfiles] = useState({})
  const [search, setSearch] = useState('')
  const [newSearch, setNewSearch] = useState('')
  const [matches, setMatches] = useState([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [threadAvailable, setThreadAvailable] = useState(null)
  const [sending, setSending] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
  const [unreadByConversation, setUnreadByConversation] = useState({})
  const bottomRef = useRef(null)
  const online = typeof navigator === 'undefined' || navigator.onLine

  async function loadInbox() {
    const { data: memberships, error: membershipError } = await supabase.from('conversation_participants')
      .select('conversation_id, last_read_at, deleted_at').eq('user_id', session.user.id).is('deleted_at', null)
    if (membershipError) {
      setError(membershipError.message)
      setLoading(false)
      return
    }
    const ids = (memberships ?? []).map((item) => item.conversation_id)
    if (!ids.length) {
      setConversations([])
      setLoading(false)
      return
    }
    const [{ data, error: inboxError }, { data: participantRows }] = await Promise.all([
      supabase.from('conversations').select('id, created_at, last_message_at').in('id', ids).order('last_message_at', { ascending: false, nullsFirst: false }),
      supabase.from('conversation_participants').select('conversation_id, user_id, last_read_at').in('conversation_id', ids),
    ])
    if (inboxError) setError(inboxError.message)
    else {
      const users = [...new Set((participantRows ?? []).map((row) => row.user_id))]
      const { data: profileRows } = users.length
        ? await supabase.from('profiles').select('id, display_name, username, avatar_url').in('id', users)
        : { data: [] }
      const byId = Object.fromEntries((profileRows ?? []).map((profile) => [profile.id, profile]))
      const unread = {}
      const enriched = await Promise.all((data ?? []).map(async (conversation) => {
        const participants = (participantRows ?? []).filter((row) => row.conversation_id === conversation.id)
        const membership = participants.find((row) => row.user_id === session.user.id)
        let unreadQuery = supabase.from('direct_messages').select('id', { count: 'exact', head: true })
          .eq('conversation_id', conversation.id).neq('sender_id', session.user.id)
        if (membership?.last_read_at) unreadQuery = unreadQuery.gt('created_at', membership.last_read_at)
        const [{ data: latestRows }, { count }] = await Promise.all([
          supabase.from('direct_messages').select('id, conversation_id, sender_id, body, created_at').eq('conversation_id', conversation.id).order('created_at', { ascending: false }).limit(1),
          unreadQuery,
        ])
        unread[conversation.id] = count ?? 0
        return {
          ...conversation,
          conversation_participants: participants.map((row) => ({ ...row, profile: byId[row.user_id] })),
          latestMessage: latestRows?.[0],
        }
      }))
      setConversations(enriched)
      setUnreadByConversation(unread)
    }
    setLoading(false)
  }

  async function loadPage(older = false) {
    if (!conversationId) return
    if (!older) setLoading(true)
    let query = supabase.from('direct_messages').select('id, conversation_id, sender_id, body, created_at, seen_at')
      .eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(PAGE_SIZE)
    if (older && messages.length) query = query.lt('created_at', messages[0].created_at)
    const { data, error: pageError } = await query
    if (pageError) setError(pageError.message)
    else {
      const page = (data ?? []).reverse()
      setHasOlder(page.length === PAGE_SIZE)
      setMessages((current) => older ? [...page, ...current] : page)
      if (!older) requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }))
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!sessionId) return undefined
    if (blockedOnly) {
      loadBlocked()
      return undefined
    }
        // Loading the inbox when the screen opens is a normal use of an effect:
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadInbox()
    const channel = supabase.channel(`inbox-list-${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_messages' }, loadInbox)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, sessionId, blockedOnly])

  useEffect(() => {
    const userId = query.get('new')
    if (!sessionId || !userId || userId === sessionId) return
    async function openConversation() {
      const { data, error: startError } = await supabase.rpc('get_or_create_conversation', { other_user_id: userId })
      if (startError) setError(startError.message)
      else navigate(`/messages/${data}`, { replace: true })
    }
    openConversation()
  }, [query, sessionId, navigate])

  useEffect(() => {
    if (!conversationId || !sessionId) return undefined
    let active = true
    let channel
    async function initializeThread() {
      setThreadAvailable(null)
      const { data: membership, error: membershipError } = await supabase.from('conversation_participants')
        .select('deleted_at').eq('conversation_id', conversationId).eq('user_id', sessionId).maybeSingle()
      if (!active) return
      if (membershipError || !membership || membership.deleted_at) {
        setThreadAvailable(false)
        setLoading(false)
        return
      }
      setThreadAvailable(true)
      setMessages([])
      await loadPage()
      if (!active) return
      channel = supabase.channel(`dm-thread-${conversationId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
          setMessages((current) => current.some((message) => message.id === payload.new.id) ? current : [...current, payload.new])
          requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }))
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_participants', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
          if (payload.new.user_id !== sessionId) loadPage()
        })
        .subscribe()
    }
    initializeThread()
    return () => {
      active = false
      if (channel) supabase.removeChannel(channel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, sessionId])

  useEffect(() => {
    if (!sessionId) return undefined
    const term = newSearch.trim()
    if (!term) return
    const timer = setTimeout(async () => {
      const { data } = await supabase.from('profiles').select('id, display_name, username, avatar_url')
        .or(`display_name.ilike.%${term}%,username.ilike.%${term}%`).neq('id', sessionId).limit(10)
      setMatches(data ?? [])
    }, 250)
    return () => clearTimeout(timer)
  }, [newSearch, sessionId])

  async function startConversation(otherUserId) {
    setError('')
    const { data, error: startError } = await supabase.rpc('get_or_create_conversation', { other_user_id: otherUserId })
    if (startError) setError(startError.message)
    else navigate(`/messages/${data}`)
  }

  async function sendMessage(event) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || body.length > 1000 || sending || !online) return
    setSending(true)
    setError('')
    const { error: sendError } = await supabase.from('direct_messages').insert({ conversation_id: conversationId, sender_id: session.user.id, body })
    if (sendError) setError(sendError.message)
    else setDraft('')
    setSending(false)
  }

  async function markRead() {
    await supabase.from('conversation_participants').update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId).eq('user_id', session.user.id)
  }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (sessionId && conversationId && messages.length) markRead() }, [conversationId, messages.length, sessionId])

  async function deleteOwnMessage(message) {
    if (!window.confirm('Delete this message?')) return
    const { error: deleteError } = await supabase.from('direct_messages').delete().eq('id', message.id)
    if (deleteError) setError(deleteError.message)
    else setMessages((current) => current.filter((entry) => entry.id !== message.id))
  }

  async function blockParticipant(otherId) {
    if (!window.confirm('Block this person? They will not be able to message you.')) return
    const { error: blockError } = await supabase.from('blocks').insert({ blocker_id: session.user.id, blocked_id: otherId })
    if (blockError) setError(blockError.message)
    else navigate('/account/blocked')
  }

  async function reportMessage(message) {
    const { error: reportError } = await supabase.from('message_reports').insert({ reporter_id: session.user.id, reported_user_id: message.sender_id, message_id: message.id, snapshot: message.body })
    if (reportError) setError(reportError.message)
    else setError('Report sent to moderators.')
  }

  async function hideConversation() {
    if (!window.confirm('Delete this conversation for you?')) return
    const { error: hideError } = await supabase.rpc('hide_conversation_for_me', { target_conversation: conversationId })
    if (hideError) setError(hideError.message)
    else navigate('/messages')
  }

  async function loadBlocked() {
    const { data, error: blockedError } = await supabase.from('blocks')
      .select('blocked_id')
      .eq('blocker_id', session.user.id)
    if (blockedError) setError(blockedError.message)
    else {
      const ids = (data ?? []).map((row) => row.blocked_id)
      const { data: people } = ids.length ? await supabase.from('profiles').select('id, display_name, username, avatar_url').in('id', ids) : { data: [] }
      setProfiles(Object.fromEntries((people ?? []).map((person) => [person.id, person])))
    }
  }

  async function unblock(userId) {
    const { error: unblockError } = await supabase.from('blocks').delete().eq('blocker_id', session.user.id).eq('blocked_id', userId)
    if (unblockError) setError(unblockError.message)
    else loadBlocked()
  }

  if (!session) return <div className="page state-card"><h2>Sign in to view messages</h2><p>Private conversations are only available to signed-in students.</p><Link className="primary-button button-link" to="/account">Sign in</Link></div>
  if (!online) return <div className="page state-card"><h2>You're offline</h2><p>Private messages need an internet connection.</p></div>

  if (blockedOnly) return <div className="page inbox-page"><header className="people-list-header"><button className="icon-button" onClick={() => navigate('/messages')} type="button" aria-label="Back to messages">←</button><h1>Blocked accounts</h1></header>{error && <p className="error-text">{error}</p>}{Object.keys(profiles).length === 0 ? <p>No blocked accounts.</p> : Object.entries(profiles).map(([id, person]) => <div className="person-row" key={id}><span>{person?.display_name || person?.username || 'Student'}</span><button className="secondary-button" onClick={() => unblock(id)} type="button">Unblock</button></div>)}</div>

  if (conversationId && threadAvailable === false) return <div className="page state-card"><h2>Conversation unavailable</h2><p>This conversation is not in your active inbox.</p><Link className="text-button" to="/messages">Back to messages</Link></div>

  if (conversationId) {
    const conversation = conversations.find((entry) => entry.id === conversationId)
    const peerParticipant = getOtherParticipant(conversation, session.user.id)
    const peer = peerParticipant?.profile
        const lastFromPeer = [...messages].reverse().find((entry) => entry.sender_id !== session.user.id)
    return (
      <div className="page direct-message-page">
        <header className="dm-header">
          <button className="icon-button" onClick={() => navigate('/messages')} type="button" aria-label="Back to inbox">←</button>
          <Link to={peer ? `/account?user=${peer.id}` : '/account'}>{peer?.avatar_url ? <img className="person-avatar" src={peer.avatar_url} alt="" /> : <span className="person-avatar avatar-placeholder">{(peer?.display_name || 'S').charAt(0)}</span>}</Link>
          <Link className="dm-peer-name" to={peer ? `/account?user=${peer.id}` : '/account'}>{peer?.display_name || peer?.username || 'Conversation'}</Link>
                    <details className="dm-menu">
            <summary aria-label="Conversation menu">•••</summary>
            <div className="dm-menu-list">
              <button onClick={() => peer && blockParticipant(peer.id)} type="button">Block</button>
              <button disabled={!lastFromPeer} onClick={() => lastFromPeer && reportMessage(lastFromPeer)} type="button">Report latest message</button>
              <button onClick={hideConversation} type="button">Delete conversation for me</button>
            </div>
          </details>
        </header>
        <div className="dm-scroll">
          {hasOlder && <button className="text-button" onClick={() => loadPage(true)} type="button">Load older</button>}
          {loading ? <p>Loading messages...</p> : messages.map((message, index) => {
            const previous = messages[index - 1]
            const showDay = !previous || new Date(previous.created_at).toDateString() !== new Date(message.created_at).toDateString()
            const mine = message.sender_id === session.user.id
            const lastMine = mine && !messages.slice(index + 1).some((entry) => entry.sender_id === session.user.id)
            return <div key={message.id}>{showDay && <p className="day-separator">{formatDay(message.created_at)}</p>}<article className={mine ? 'dm-bubble mine' : 'dm-bubble'}><p>{message.body}</p><time>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{mine && <button onClick={() => deleteOwnMessage(message)} type="button">Delete</button>}</article>{lastMine && message.seen_at && <small className="dm-seen">Seen</small>}</div>
          })}
          <div ref={bottomRef} />
        </div>
        <form className="chat-form" onSubmit={sendMessage}><textarea maxLength="1000" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form.requestSubmit() } }} placeholder="Message..." value={draft} /><button className="primary-button" disabled={sending || !draft.trim()} type="submit">Send</button></form>
        {error && <p className="error-text">{error}</p>}
      </div>
    )
  }

  const filteredConversations = conversations.filter((conversation) => {
    const peer = getOtherParticipant(conversation, session.user.id)?.profile
    return `${peer?.display_name || ''} ${peer?.username || ''}`.toLowerCase().includes(search.toLowerCase())
  })

  return (
    <div className="page inbox-page">
      <header className="screen-header"><p className="eyebrow">Private messages</p><h1>Chats inbox</h1></header>
      <div className="inbox-actions"><input aria-label="Search conversations" onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" value={search} /><button className="primary-button" onClick={() => setNewMessageOpen(true)} type="button">New message</button></div>
      {newMessageOpen && <section className="new-message-search"><input autoFocus onChange={(event) => setNewSearch(event.target.value)} placeholder="Find a student" value={newSearch} />{matches.map((person) => <button className="person-row" key={person.id} onClick={() => startConversation(person.id)} type="button"><span>{person.display_name || person.username || 'Student'}</span></button>)}</section>}
      {error && <p className="error-text">{error}</p>}
      {loading ? <p>Loading inbox...</p> : filteredConversations.map((conversation) => {
        const peer = getOtherParticipant(conversation, session.user.id)?.profile
                const unreadCount = unreadByConversation[conversation.id] || 0
        return (
          <button className={unreadCount > 0 ? 'conversation-row unread' : 'conversation-row'} key={conversation.id} onClick={() => navigate(`/messages/${conversation.id}`)} type="button">
            {peer?.avatar_url
              ? <img alt="" className="person-avatar" src={peer.avatar_url} />
              : <span className="person-avatar avatar-placeholder">{(peer?.display_name || 'S').charAt(0).toUpperCase()}</span>}
            <span className="conversation-copy">
              <strong>{peer?.display_name || peer?.username || 'Student'}</strong>
              <small>{conversation.latestMessage?.body || 'No messages yet'}</small>
            </span>
            <time>{conversation.last_message_at ? new Date(conversation.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</time>
            {unreadCount > 0 && <span className="unread-badge">{unreadCount}</span>}
          </button>
        )
      })}
    </div>
  )
}
