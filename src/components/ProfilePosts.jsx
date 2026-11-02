import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { timeAgo } from '../lib/time'

const POST_COLUMNS = 'id, user_id, body, image_url, video_url, audio_url, song_url, created_at'

// What each attachment may be. The storage bucket enforces the same limits on the server.
const ATTACHMENTS = {
  image: {
    label: 'Photo',
    accept: 'image/jpeg,image/png,image/webp',
    types: ['image/jpeg', 'image/png', 'image/webp'],
    maxMb: 10,
  },
  video: {
    label: 'Video',
    accept: 'video/mp4,video/webm,video/quicktime',
    types: ['video/mp4', 'video/webm', 'video/quicktime'],
    maxMb: 50,
  },
  audio: {
    label: 'Voice note',
    accept: 'audio/mpeg,audio/mp4,audio/webm,audio/ogg,audio/wav',
    types: ['audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg', 'audio/wav'],
    maxMb: 20,
  },
}
const EMPTY_ATTACHMENTS = { image: null, video: null, audio: null }

// Only allow normal web links (blocks things like javascript: links)
function isHttpUrl(value) {
  return /^https?:\/\//i.test(value || '')
}

// Turns a public file link back into its storage path, so a deleted post can remove its files
function storagePath(url) {
  const marker = '/post-media/'
  const index = url.indexOf(marker)
  return index === -1 ? null : decodeURIComponent(url.slice(index + marker.length))
}

export default function ProfilePosts({ session, profileUserId, readOnly = false, className = '' }) {
  const userId = session.user.id
  const targetId = profileUserId || userId

  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [verified, setVerified] = useState(false)
  const [likedPosts, setLikedPosts] = useState([])
  const [likeCounts, setLikeCounts] = useState({})
  const [comments, setComments] = useState({})
  const [authors, setAuthors] = useState({})
  const [commentDrafts, setCommentDrafts] = useState({})

  const [composerOpen, setComposerOpen] = useState(false)
  const [caption, setCaption] = useState('')
  const [attachments, setAttachments] = useState(EMPTY_ATTACHMENTS)
  const [showSong, setShowSong] = useState(false)
  const [songUrl, setSongUrl] = useState('')
  const [posting, setPosting] = useState(false)

  const composerHasContent = Boolean(caption.trim() || songUrl.trim() || Object.values(attachments).some(Boolean))

  useEffect(() => {
    let cancelled = false

    async function loadPosts() {
      const [{ data, error: loadError }, { data: owner }] = await Promise.all([
        supabase.from('posts').select(POST_COLUMNS).eq('user_id', targetId).order('created_at', { ascending: false }),
        supabase.from('profiles').select('id, verified').eq('id', targetId).maybeSingle(),
      ])
      if (cancelled) return
      if (loadError) setError(loadError.message)
      const loaded = data ?? []
      setPosts(loaded)
      setVerified(owner?.verified === true)

      const ids = loaded.map((post) => post.id)
      if (ids.length) {
        const [{ data: likes }, { data: loadedComments }] = await Promise.all([
          supabase.from('post_likes').select('post_id, user_id').in('post_id', ids),
          supabase.from('post_comments').select('id, post_id, user_id, body, created_at').in('post_id', ids).order('created_at', { ascending: true }),
        ])
        if (cancelled) return
        setLikeCounts((likes ?? []).reduce((counts, like) => ({ ...counts, [like.post_id]: (counts[like.post_id] || 0) + 1 }), {}))
        setLikedPosts((likes ?? []).filter((like) => like.user_id === userId).map((like) => like.post_id))
        setComments((loadedComments ?? []).reduce((grouped, comment) => ({ ...grouped, [comment.post_id]: [...(grouped[comment.post_id] || []), comment] }), {}))

        // Look up the names of everyone who commented (and me, for my new comments)
        const authorIds = [...new Set([userId, ...(loadedComments ?? []).map((comment) => comment.user_id)])]
        const { data: people } = await supabase.from('profiles').select('id, display_name, username').in('id', authorIds)
        if (cancelled) return
        setAuthors(Object.fromEntries((people ?? []).map((person) => [person.id, person])))
      }
      setLoading(false)
    }

    loadPosts()
    return () => { cancelled = true }
  }, [targetId, userId])

  // ---------- Composer ----------
  function clearAttachment(kind) {
    const item = attachments[kind]
    if (item?.preview) URL.revokeObjectURL(item.preview)
    setAttachments((current) => ({ ...current, [kind]: null }))
  }

  function pickFile(kind, event) {
    const file = event.target.files?.[0]
    if (!file) return
    const rule = ATTACHMENTS[kind]
    if (!rule.types.includes(file.type)) return setError(`${rule.label}: this file type is not allowed.`)
    if (file.size > rule.maxMb * 1024 * 1024) return setError(`${rule.label} must be smaller than ${rule.maxMb} MB.`)
    setError('')
    clearAttachment(kind)
    const preview = kind === 'audio' ? '' : URL.createObjectURL(file)
    setAttachments((current) => ({ ...current, [kind]: { file, preview } }))
  }

  function resetComposer() {
    Object.values(attachments).forEach((item) => { if (item?.preview) URL.revokeObjectURL(item.preview) })
    setAttachments(EMPTY_ATTACHMENTS)
    setCaption('')
    setShowSong(false)
    setSongUrl('')
  }

  function closeComposer() {
    if (posting) return
    if (composerHasContent && !window.confirm('Discard this post?')) return
    resetComposer()
    setError('')
    setComposerOpen(false)
  }

  async function createPost(event) {
    event.preventDefault()
    const body = caption.trim()
    if (!body) return setError('Write a caption first.')
    if (songUrl.trim() && !isHttpUrl(songUrl.trim())) return setError('The song link must start with https://')

    setPosting(true)
    setError('')
    const uploadedPaths = []
    try {
      // 1. Upload each chosen file into my own folder
      const urls = {}
      for (const [kind, item] of Object.entries(attachments)) {
        if (!item) continue
        const safeName = item.file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-')
        const path = `${userId}/${Date.now()}-${safeName}`
        const { error: uploadError } = await supabase.storage.from('post-media').upload(path, item.file, { contentType: item.file.type })
        if (uploadError) throw uploadError
        uploadedPaths.push(path)
        urls[`${kind}_url`] = supabase.storage.from('post-media').getPublicUrl(path).data.publicUrl
      }

      // 2. Save the post
      const { data, error: postError } = await supabase
        .from('posts')
        .insert({ user_id: userId, body, song_url: songUrl.trim() || null, ...urls })
        .select(POST_COLUMNS)
        .single()
      if (postError) throw postError

      setPosts((current) => [data, ...current])
      resetComposer()
      setComposerOpen(false)
    } catch (caught) {
      // If anything failed, remove files that were already uploaded
      if (uploadedPaths.length) await supabase.storage.from('post-media').remove(uploadedPaths)
      setError(caught.message || 'Could not publish the post.')
    } finally {
      setPosting(false)
    }
  }

  // ---------- Actions on a post ----------
  async function togglePostLike(postId) {
    const liked = likedPosts.includes(postId)
    const result = liked
      ? await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', userId)
      : await supabase.from('post_likes').insert({ post_id: postId, user_id: userId })
    if (result.error) return setError(result.error.message)
    setLikedPosts((current) => (liked ? current.filter((id) => id !== postId) : [...current, postId]))
    setLikeCounts((current) => ({ ...current, [postId]: Math.max(0, (current[postId] || 0) + (liked ? -1 : 1)) }))
  }

  async function addComment(event, postId) {
    event.preventDefault()
    const body = (commentDrafts[postId] || '').trim()
    if (!body) return
    const { data, error: commentError } = await supabase
      .from('post_comments')
      .insert({ post_id: postId, user_id: userId, body })
      .select('id, post_id, user_id, body, created_at')
      .single()
    if (commentError) return setError(commentError.message)
    setComments((current) => ({ ...current, [postId]: [...(current[postId] || []), data] }))
    setCommentDrafts((current) => ({ ...current, [postId]: '' }))
  }

  async function deletePost(post) {
    if (!window.confirm('Delete this post?')) return
    const paths = [post.image_url, post.video_url, post.audio_url].filter(Boolean).map(storagePath).filter(Boolean)
    const { error: deleteError } = await supabase.from('posts').delete().eq('id', post.id)
    if (deleteError) return setError(deleteError.message)
    if (paths.length) await supabase.storage.from('post-media').remove(paths)
    setPosts((current) => current.filter((entry) => entry.id !== post.id))
  }

  async function shareAsUpdate(post) {
    const { error: shareError } = await supabase.from('updates').insert({
      title: 'Update from my profile',
      body: post.body,
      image_url: post.image_url || null,
      category: 'event',
      author_id: userId,
      shared_from_post_id: post.id,
      source_type: 'leader',
      pinned: false,
    })
    if (shareError) setError(shareError.message)
    else setNotice('Shared as an update.')
  }

  async function sharePost(post) {
    const url = `${window.location.origin}/account?user=${post.user_id}`
    if (navigator.share) {
      try { await navigator.share({ title: 'CampusPulse post', text: post.body, url }) } catch { /* the person closed the share sheet */ }
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(url)
      setNotice('Link copied.')
    }
  }

  if (loading) return <p>Loading posts...</p>

  return (
    <div className={className}>
      {!readOnly && (
        <button className="create-post-button" onClick={() => { setNotice(''); setComposerOpen(true) }} type="button">
          + Create a post
        </button>
      )}

      {composerOpen && (
        <div className="composer-backdrop" onClick={closeComposer} role="presentation">
          <form aria-label="Create a post" className="composer-sheet" onClick={(event) => event.stopPropagation()} onSubmit={createPost}>
            <header className="composer-head">
              <button className="text-button" onClick={closeComposer} type="button">Cancel</button>
              <strong>New post</strong>
              <button className="primary-button" disabled={posting || !caption.trim()} type="submit">{posting ? 'Posting...' : 'Post'}</button>
            </header>

            <label className="sr-only" htmlFor="post-caption">Caption</label>
            <textarea autoFocus id="post-caption" maxLength="500" onChange={(event) => setCaption(event.target.value)} placeholder="What's happening on campus?" value={caption} />
            <small className="composer-count">{caption.length}/500</small>

            <div className="attach-row">
              {Object.entries(ATTACHMENTS).map(([kind, rule]) => (
                <label className={attachments[kind] ? 'attach-chip on' : 'attach-chip'} key={kind}>
                  {rule.label}
                  <input accept={rule.accept} hidden key={attachments[kind] ? 'picked' : 'empty'} onChange={(event) => pickFile(kind, event)} type="file" />
                </label>
              ))}
              <button className={showSong ? 'attach-chip on' : 'attach-chip'} onClick={() => setShowSong((value) => !value)} type="button">Song link</button>
            </div>

            {showSong && (
              <input aria-label="Song link" onChange={(event) => setSongUrl(event.target.value)} placeholder="Paste a music link (https://...)" type="url" value={songUrl} />
            )}

            {Object.entries(attachments).map(([kind, item]) => item && (
              <div className="attach-preview" key={kind}>
                {kind === 'image' && <img alt="" src={item.preview} />}
                {kind === 'video' && <video muted src={item.preview} />}
                <span>{ATTACHMENTS[kind].label}: {item.file.name} ({(item.file.size / 1048576).toFixed(1)} MB)</span>
                <button aria-label={`Remove ${ATTACHMENTS[kind].label}`} className="icon-button" onClick={() => clearAttachment(kind)} type="button">✕</button>
              </div>
            ))}

            {error && <p className="error-text">{error}</p>}
          </form>
        </div>
      )}

      {!composerOpen && error && <p className="error-text">{error}</p>}
      {notice && <p className="success-text">{notice}</p>}

      {posts.length === 0 ? (
        <div className="state-card">
          <h2>No posts yet</h2>
          <p>{readOnly ? 'Nothing has been posted here yet.' : 'Tap "Create a post" to share something with campus.'}</p>
        </div>
      ) : posts.map((post) => (
        <article className="card profile-post" key={post.id}>
          <p>{post.body}</p>
          {post.image_url && <img alt="" className="update-image" loading="lazy" src={post.image_url} />}
          {post.video_url && <video className="update-image" controls preload="none" src={post.video_url} />}
          {post.audio_url && <audio className="audio-player" controls preload="none" src={post.audio_url} />}
          {isHttpUrl(post.song_url) && <a className="song-link" href={post.song_url} rel="noreferrer noopener" target="_blank">♪ Open song</a>}

          <div className="post-actions">
            <button className={likedPosts.includes(post.id) ? 'action-button liked' : 'action-button'} onClick={() => togglePostLike(post.id)} type="button">
              {likedPosts.includes(post.id) ? '♥' : '♡'} {likeCounts[post.id] || 0}
            </button>
            <button className="action-button" onClick={() => sharePost(post)} type="button">Share</button>
            {!readOnly && verified && <button className="action-button" onClick={() => shareAsUpdate(post)} type="button">Share as update</button>}
            {!readOnly && <button className="action-button" onClick={() => deletePost(post)} type="button">Delete</button>}
          </div>

          {(comments[post.id] || []).map((comment) => {
            const author = authors[comment.user_id]
            return (
              <p className="comment-preview" key={comment.id}>
                <strong>{author?.username ? `@${author.username}` : author?.display_name || 'Student'}</strong> {comment.body}
              </p>
            )
          })}

          <form className="comment-form" onSubmit={(event) => addComment(event, post.id)}>
            <input
              aria-label="Write a comment"
              maxLength="500"
              onChange={(event) => setCommentDrafts((current) => ({ ...current, [post.id]: event.target.value }))}
              placeholder="Add a comment..."
              value={commentDrafts[post.id] || ''}
            />
            <button className="action-button" type="submit">Post</button>
          </form>

          <time className="post-time" dateTime={post.created_at} title={new Date(post.created_at).toLocaleString()}>
            {timeAgo(post.created_at)}
          </time>
        </article>
      ))}
    </div>
  )
}