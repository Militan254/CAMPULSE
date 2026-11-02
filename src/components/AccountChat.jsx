import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'
import { timeAgo } from '../lib/time'

const MUTE_KEY = 'cp-campus-chat-muted'

function readChatMuted() {
  try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false }
}

function saveChatMuted(value) {
  try { localStorage.setItem(MUTE_KEY, value ? '1' : '0') } catch { /* storage unavailable */ }
}

// Look up names and pictures for a list of user ids and return them as { id: profile }
async function fetchProfiles(ids) {
  const unique = [...new Set(ids)]
  if (!unique.length) return {}
  const { data } = await supabase.from('profiles').select('id, display_name, username, avatar_url').in('id', unique)
  return Object.fromEntries((data ?? []).map((person) => [person.id, person]))
}

export default function AccountChat({ session }) {
  const userId = session.user.id
  const [messages, setMessages] = useState([])
  const [people, setPeople] = useState({})
  const [mutedIds, setMutedIds] = useState([])
  const [chatMuted, setChatMuted] = useState(readChatMuted)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [menuFor, setMenuFor] = useState(null)
  const [restrictedUntil, setRestrictedUntil] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const bottomRef = useRef(null)

  // Load the chat and listen for new messages (skipped while the chat is muted)
  useEffect(() => {
    if (chatMuted) return undefined
    let cancelled = false
    let channel

    async function start() {
      const [{ data: rows, error: loadError }, { data: muteRows }, { data: restriction }] = await Promise.all([
        supabase.from('messages').select('id, user_id, body, created_at').order('created_at', { ascending: false }).limit(100),
        supabase.from('chat_mutes').select('muted_user_id').eq('user_id', userId),
        supabase.from('chat_restrictions').select('restricted_until').eq('user_id', userId).maybeSingle(),
      ])
      if (cancelled) return
      if (loadError) setError(loadError.message)

      const list = (rows ?? []).reverse()
      setMessages(list)
      setMutedIds((muteRows ?? []).map((row) => row.muted_user_id))
      const until = restriction?.restricted_until ? new Date(restriction.restricted_until) : null
      setRestrictedUntil(until && until.getTime() > Date.now() ? until : null)

      const found = await fetchProfiles([userId, ...list.map((message) => message.user_id)])
      if (cancelled) return
      setPeople(found)
      setLoading(false)

      channel = supabase
        .channel('campus-chat-feed')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
          const row = payload.new
          setMessages((current) => (current.some((message) => message.id === row.id) ? current : [...current, row]))
          if (row.user_id !== userId) {
            const person = await fetchProfiles([row.user_id])
            setPeople((current) => ({ ...current, ...person }))
          }
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload) => {
          setMessages((current) => current.filter((message) => message.id !== payload.old.id))
        })
        .subscribe()
    }

    start()
    return () => {
      cancelled = true
      if (channel) supabase.removeChannel(channel)
    }
  }, [chatMuted, userId])

  // Count down while restricted, and lift the restriction when time is up
  useEffect(() => {
    if (!restrictedUntil) return undefined
    const timer = setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= restrictedUntil.getTime()) setRestrictedUntil(null)
    }, 1000)
    return () => clearInterval(timer)
  }, [restrictedUntil])

  const visibleMessages = messages.filter((message) => !mutedIds.includes(message.user_id))
  const hiddenCount = messages.length - visibleMessages.length

  // Scroll to the newest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [visibleMessages.length])

  function toggleChatMute() {
    const next = !chatMuted
    saveChatMuted(next)
    if (!next) setLoading(true)
    setChatMuted(next)
  }

  async function muteUser(person) {
    setMenuFor(null)
    const { error: muteError } = await supabase.from('chat_mutes').insert({ user_id: userId, muted_user_id: person })
    if (muteError) return setError(muteError.message)
    setMutedIds((current) => [...current, person])
    setNotice('Muted. You will not see their messages.')
  }

  async function unmuteUser(person) {
    const { error: unmuteError } = await supabase.from('chat_mutes').delete().eq('user_id', userId).eq('muted_user_id', person)
    if (unmuteError) return setError(unmuteError.message)
    setMutedIds((current) => current.filter((id) => id !== person))
  }

  async function reportMessage(message) {
    setMenuFor(null)
    const { error: reportError } = await supabase.from('campus_message_reports').insert({
      reporter_id: userId,
      reported_user_id: message.user_id,
      message_id: message.id,
      snapshot: message.body,
    })
    if (reportError) setError(reportError.message)
    else setNotice('Report sent to moderators.')
  }

  async function deleteMessage(message) {
    setMenuFor(null)
    if (!window.confirm('Delete this message?')) return
    const { error: deleteError } = await supabase.from('messages').delete().eq('id', message.id)
    if (deleteError) setError(deleteError.message)
    else setMessages((current) => current.filter((entry) => entry.id !== message.id))
  }

  async function sendMessage(event) {
    event.preventDefault()
    const text = body.trim()
    if (!text || sending || restrictedUntil) return

    setSending(true)
    setError('')
    setNotice('')
    const { data, error: sendError } = await supabase.from('messages').insert({ user_id: userId, body: text }).select('id').maybeSingle()

    if (sendError) {
      // The database tells us when a restriction ends: CHAT_RESTRICTED:<time>
      const match = sendError.message.match(/CHAT_RESTRICTED:(\S+)/)
      if (match) {
        setRestrictedUntil(new Date(match[1]))
        setNow(Date.now())
      } else {
        setError(sendError.message)
      }
    } else if (!data) {
      // The database skipped the message because of the spam rules: check why
      const { data: restriction } = await supabase.from('chat_restrictions').select('restricted_until').eq('user_id', userId).maybeSingle()
      const until = restriction?.restricted_until ? new Date(restriction.restricted_until) : null
      if (until && until.getTime() > Date.now()) {
        setRestrictedUntil(until)
        setNow(Date.now())
        setBody('')
      } else {
        setError('Your message was not sent. Please try again.')
      }
    } else {
      setBody('')
      setMessages((current) => (current.some((message) => message.id === data.id)
        ? current
        : [...current, { id: data.id, user_id: userId, body: text, created_at: new Date().toISOString() }]))
    }
    setSending(false)
  }

  const secondsLeft = restrictedUntil ? Math.max(0, Math.ceil((restrictedUntil.getTime() - now) / 1000)) : 0
  const countdown = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`

  if (chatMuted) {
    return (
      <div className="state-card">
        <h2>Campus chat is muted</h2>
        <p>You will not see new messages until you unmute it.</p>
        <button className="primary-button" onClick={toggleChatMute} type="button">Unmute chat</button>
      </div>
    )
  }

  if (loading) return <p>Loading chat...</p>

  return (
    <div>
      <div className="chat-tools">
        {mutedIds.length > 0 ? (
          <details className="muted-people">
            <summary>{mutedIds.length} muted {mutedIds.length === 1 ? 'person' : 'people'}</summary>
            <div className="muted-people-list">
              {mutedIds.map((id) => (
                <div key={id}>
                  <span>{people[id]?.username ? `@${people[id].username}` : people[id]?.display_name || 'Student'}</span>
                  <button className="action-button" onClick={() => unmuteUser(id)} type="button">Unmute</button>
                </div>
              ))}
            </div>
          </details>
        ) : <span />}
        <button className="secondary-button" onClick={toggleChatMute} type="button">Mute chat</button>
      </div>

      {error && <p className="error-text">{error}</p>}
      {notice && <p className="success-text">{notice}</p>}
      {hiddenCount > 0 && <p className="muted-note">{hiddenCount} {hiddenCount === 1 ? 'message' : 'messages'} hidden from people you muted.</p>}

      <section aria-label="Campus chat messages" className="campus-feed">
        {visibleMessages.length === 0 ? (
          <div className="state-card"><h2>Nothing here yet</h2><p>Start the campus conversation.</p></div>
        ) : visibleMessages.map((message) => {
          const author = people[message.user_id]
          const mine = message.user_id === userId
          return (
            <article className="campus-msg" key={message.id}>
              <Link className="campus-avatar-link" to={`/account?user=${message.user_id}`}>
                {author?.avatar_url
                  ? <img alt="" className="person-avatar" src={author.avatar_url} />
                  : <span className="person-avatar avatar-placeholder">{(author?.display_name || 'S').charAt(0).toUpperCase()}</span>}
              </Link>
              <div className="campus-msg-body">
                <header className="campus-msg-head">
                  <Link className="campus-name" to={`/account?user=${message.user_id}`}>{author?.display_name || 'Student'}</Link>
                  {author?.username && <span className="campus-handle">@{author.username}</span>}
                  <time dateTime={message.created_at} title={new Date(message.created_at).toLocaleString()}>· {timeAgo(message.created_at)}</time>
                  <button aria-label="Message options" className="msg-more" onClick={() => setMenuFor(menuFor === message.id ? null : message.id)} type="button">⋯</button>
                </header>
                <p>{message.body}</p>
                {menuFor === message.id && (
                  <div className="msg-menu-list">
                    {mine
                      ? <button onClick={() => deleteMessage(message)} type="button">Delete message</button>
                      : (
                        <>
                          <button onClick={() => muteUser(message.user_id)} type="button">Mute {author?.username ? `@${author.username}` : 'this person'}</button>
                          <button onClick={() => reportMessage(message)} type="button">Report message</button>
                        </>
                      )}
                  </div>
                )}
              </div>
            </article>
          )
        })}
        <div ref={bottomRef} />
      </section>

      {restrictedUntil && (
        <div className="chat-restricted" role="alert">
          You cannot send messages for <strong>{countdown}</strong>. You sent too many messages or repeated yourself, which looks like spam or advertising. This keeps the chat useful for everyone.
        </div>
      )}

      <form className="chat-form" onSubmit={sendMessage}>
        <label className="sr-only" htmlFor="campus-chat-message">Message</label>
        <input
          disabled={Boolean(restrictedUntil)}
          id="campus-chat-message"
          maxLength="500"
          onChange={(event) => setBody(event.target.value)}
          placeholder={restrictedUntil ? 'Sending is paused' : 'Message the campus...'}
          value={body}
        />
        <button className="primary-button" disabled={sending || !body.trim() || Boolean(restrictedUntil)} type="submit">Send</button>
      </form>
    </div>
  )
}