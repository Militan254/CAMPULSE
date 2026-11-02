import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'

const categories = ['all', 'strike', 'sports', 'notice', 'event']

export default function Home({ session }) {
  const [updates, setUpdates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [profile, setProfile] = useState(null)
  const [likedUpdates, setLikedUpdates] = useState([])
  const [likeCounts, setLikeCounts] = useState({})
  const [commentingUpdate, setCommentingUpdate] = useState(null)
  const [commentText, setCommentText] = useState('')
  const [comments, setComments] = useState({})
  const [commentCounts, setCommentCounts] = useState({})
  const [searchResults, setSearchResults] = useState([])

  useEffect(() => {
    async function loadUpdates() {
      const { data, error } = await supabase
        .from('updates')
        .select('*')
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) setError(error.message)
      else {
        const loadedUpdates = data ?? []
        setUpdates(loadedUpdates)
        const updateIds = loadedUpdates.map((update) => update.id)
        if (updateIds.length) {
          const [{ data: likes }, { data: loadedComments }] = await Promise.all([
            supabase.from('update_likes').select('update_id, user_id').in('update_id', updateIds),
            supabase.from('update_comments').select('id, update_id, body, created_at').in('update_id', updateIds).order('created_at', { ascending: true }),
          ])
          setLikeCounts((likes ?? []).reduce((counts, like) => ({ ...counts, [like.update_id]: (counts[like.update_id] || 0) + 1 }), {}))
          setLikedUpdates((likes ?? []).filter((like) => like.user_id === session?.user?.id).map((like) => like.update_id))
          setCommentCounts((loadedComments ?? []).reduce((counts, comment) => ({ ...counts, [comment.update_id]: (counts[comment.update_id] || 0) + 1 }), {}))
          setComments((loadedComments ?? []).reduce((grouped, comment) => ({ ...grouped, [comment.update_id]: [...(grouped[comment.update_id] || []), comment] }), {}))
        }
      }
      setLoading(false)
    }
    loadUpdates()
  }, [session])

  useEffect(() => {
    if (!session) return

    supabase
      .from('profiles')
      .select('display_name, avatar_url')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => setProfile(data))
  }, [session])

  async function toggleLike(updateId) {
    const alreadyLiked = likedUpdates.includes(updateId)
    if (!session) return
    const result = alreadyLiked
      ? await supabase.from('update_likes').delete().eq('update_id', updateId).eq('user_id', session.user.id)
      : await supabase.from('update_likes').insert({ update_id: updateId, user_id: session.user.id })
    if (!result.error) {
      setLikedUpdates((current) => alreadyLiked ? current.filter((id) => id !== updateId) : [...current, updateId])
      setLikeCounts((current) => ({ ...current, [updateId]: Math.max(0, (current[updateId] || 0) + (alreadyLiked ? -1 : 1)) }))
    }
  }

  async function addComment(updateId) {
    const text = commentText.trim()
    if (!text || !session) return
    const { data, error: commentError } = await supabase.from('update_comments').insert({ update_id: updateId, user_id: session.user.id, body: text }).select('id, update_id, body, created_at').single()
    if (commentError) return setError(commentError.message)
    setComments((current) => ({ ...current, [updateId]: [...(current[updateId] || []), data] }))
    setCommentCounts((current) => ({ ...current, [updateId]: (current[updateId] || 0) + 1 }))
    setCommentText('')
    setCommentingUpdate(null)
  }

  async function shareUpdate(update) {
    const shareData = { title: update.title, text: update.body, url: window.location.href }
    if (navigator.share) await navigator.share(shareData)
    else await navigator.clipboard?.writeText(`${update.title}: ${update.body}`)
  }

  useEffect(() => {
    const term = searchTerm.trim()
    if (!term) return
    supabase.from('profiles').select('id, display_name, username, avatar_url, created_at, verified').or(`display_name.ilike.%${term}%,username.ilike.%${term}%`).limit(8).then(({ data }) => setSearchResults(data ?? []))
  }, [searchTerm])

  if (loading) return <div className="page">Loading...</div>
  if (error) {
    return (
      <div className="page state-card">
        <h1>CampusPulse</h1>
        <p>We could not load the latest updates.</p>
        <p className="error-text">{error}</p>
      </div>
    )
  }

  const categoryUpdates = selectedCategory === 'all'
    ? updates
    : updates.filter((update) => update.category === selectedCategory)
  const visibleUpdates = categoryUpdates.filter((update) => {
    const searchableText = `${update.title} ${update.body} ${update.category}`.toLowerCase()
    return searchableText.includes(searchTerm.toLowerCase().trim())
  })

  return (
    <div className="page">
      <header className="feed-header">
        <div className="brand-lockup">
          <span className="brand-mark">C</span>
          <div>
            <h1>Campulse</h1>
          </div>
        </div>
        <p className="intro">Stay up to date.</p>
        <label className="header-search">
          <span className="sr-only">Search updates</span>
          <span aria-hidden="true">⌕</span>
          <input onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search" type="search" value={searchTerm} />
        </label>
      </header>
      {searchTerm.trim() && searchResults.length > 0 && <div className="search-results">{searchResults.map((result) => <Link className="search-result" key={result.id} to={`/account?user=${result.id}`}><span>{result.display_name || result.username || 'Student'}</span>{result.verified && <small>Verified</small>}</Link>)}</div>}

      <div className="status-row">
        <Link className="status-avatar-link" to={session ? '/account' : '/account'}>
          {profile?.avatar_url
            ? <img alt="Your profile" className="status-avatar" src={profile.avatar_url} />
            : <span className="status-avatar status-placeholder">{session ? (profile?.display_name || 'S').charAt(0).toUpperCase() : 'S'}</span>}
          <span className="status-plus">+</span>
        </Link>
        <Link className="status-copy" to="/account">
          <strong>{session ? 'Your status' : 'Join Campulse'}</strong>
          <span>{session ? 'Share something with campus' : 'Create your profile'}</span>
        </Link>
      </div>

      <div className="filter-row" aria-label="Filter updates by category">
        {categories.map((category) => (
          <button
            className={selectedCategory === category ? 'filter-button active' : 'filter-button'}
            key={category}
            onClick={() => setSelectedCategory(category)}
            type="button"
          >
            {category === 'all' ? 'All' : category}
          </button>
        ))}
      </div>

      {visibleUpdates.length === 0 ? (
        <div className="state-card">
          <h2>Nothing here yet</h2>
          <p>There are no updates in this category.</p>
        </div>
      ) : (
        visibleUpdates.map((update) => (
          <article className="card update-card" key={update.id}>
            <div className="tag-row">
              <span className="tag category-tag">{update.category}</span>
              {update.pinned && <span className="pinned-marker">Pinned</span>}
            </div>
            <div className="update-title-row">
              <h2>{update.title}</h2>
              <button aria-label="More update options" className="more-button" type="button">...</button>
            </div>
            {update.image_url && <img alt="" className="update-image" src={update.image_url} />}
            {update.video_url && <video className="update-image" controls src={update.video_url} />}
            {update.audio_url && <audio className="audio-player" controls src={update.audio_url} />}
            {update.song_url && <a className="call-link" href={update.song_url} rel="noreferrer" target="_blank">Open song</a>}
            <p>{update.body}</p>
            <time dateTime={update.created_at}>
              {new Date(update.created_at).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </time>
            <div className="update-actions">
              <button aria-label={likedUpdates.includes(update.id) ? 'Unlike update' : 'Like update'} className={likedUpdates.includes(update.id) ? 'action-button liked' : 'action-button'} onClick={() => toggleLike(update.id)} type="button">
                <span aria-hidden="true">{likedUpdates.includes(update.id) ? '♥' : '♡'}</span> Like {likeCounts[update.id] || 0}
              </button>
              <button aria-label="Comment on update" className="action-button" onClick={() => setCommentingUpdate(commentingUpdate === update.id ? null : update.id)} type="button"><span aria-hidden="true">○</span> Comment {commentCounts[update.id] || 0}</button>
              <button aria-label="Share update" className="action-button" onClick={() => shareUpdate(update)} type="button"><span aria-hidden="true">↗</span> Share</button>
            </div>
            {(comments[update.id]?.length > 0) && <div className="comment-list">{comments[update.id].map((comment) => <p className="comment-preview" key={comment.id}>{comment.body}</p>)}</div>}
            {commentingUpdate === update.id && (
              <form className="comment-form" onSubmit={(event) => { event.preventDefault(); addComment(update.id) }}>
                <input aria-label="Write a comment" onChange={(event) => setCommentText(event.target.value)} placeholder="Write a comment" value={commentText} />
                <button type="submit">Post</button>
              </form>
            )}
          </article>
        ))
      )}
    </div>
  )
}
