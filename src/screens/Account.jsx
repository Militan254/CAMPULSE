import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabase'
import ProfilePosts from '../components/ProfilePosts'

export default function Account({ session }) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const viewedUserId = searchParams.get('user')
  const requestedList = searchParams.get('list')
  const [mode, setMode] = useState('sign-in')
  const [resetMode, setResetMode] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [profile, setProfile] = useState(null)
  const [editing, setEditing] = useState(false)
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [stats, setStats] = useState({ followers: 0, following: 0, likes: 0 })
  const [following, setFollowing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [people, setPeople] = useState([])

  useEffect(() => {
    if (!session) return

    async function loadProfile() {
      const targetUserId = viewedUserId || session.user.id
      const [{ data: profileData, error: profileError }, { count: followers }, { count: following }, { count: postCount }] = await Promise.all([
        supabase.from('profiles').select('id, display_name, username, bio, avatar_url, created_at, verified').eq('id', targetUserId).maybeSingle(),
        supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', targetUserId),
        supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', targetUserId),
        supabase.from('posts').select('*', { count: 'exact', head: true }).eq('user_id', targetUserId),
      ])

      if (profileError) setError(profileError.message)
      else {
        setProfile(profileData ?? { id: session.user.id, display_name: 'Student', bio: '', avatar_url: '' })
        setBio(profileData?.bio ?? '')
        setAvatarUrl(profileData?.avatar_url ?? '')
      }
      setStats({ followers: followers ?? 0, following: following ?? 0, posts: postCount ?? 0, likes: 0 })
      if (viewedUserId && viewedUserId !== session.user.id) {
        const { data: follow } = await supabase.from('follows').select('*').eq('follower_id', session.user.id).eq('following_id', viewedUserId).maybeSingle()
        setFollowing(Boolean(follow))
      }
    }

    loadProfile()
  }, [session, viewedUserId])

  useEffect(() => {
    if (!session || !requestedList || !['followers', 'following'].includes(requestedList)) return
    async function loadPeople() {
      const targetUserId = viewedUserId || session.user.id
      const foreignKey = requestedList === 'followers' ? 'follower_id' : 'following_id'
      const relationKey = requestedList === 'followers' ? 'following_id' : 'follower_id'
      const { data: relations, error: listError } = await supabase.from('follows').select(`${foreignKey}, ${relationKey}`).eq(relationKey, targetUserId)
      if (listError) return setError(listError.message)
      const userIds = (relations ?? []).map((relation) => relation[foreignKey])
      if (!userIds.length) return setPeople([])
      const { data: profiles, error: profilesError } = await supabase.from('profiles').select('id, display_name, username, avatar_url').in('id', userIds)
      if (profilesError) setError(profilesError.message)
      else {
        const byId = new Map((profiles ?? []).map((person) => [person.id, person]))
        setPeople(userIds.map((id) => byId.get(id)).filter(Boolean))
      }
    }
    loadPeople()
  }, [session, requestedList, viewedUserId])

  async function toggleFollow() {
    if (!viewedUserId) return
    const result = following
      ? await supabase.from('follows').delete().eq('follower_id', session.user.id).eq('following_id', viewedUserId)
      : await supabase.from('follows').insert({ follower_id: session.user.id, following_id: viewedUserId })
    if (!result.error) {
      setFollowing(!following)
      setStats((current) => ({ ...current, followers: current.followers + (following ? -1 : 1) }))
    }
  }

  function openDirectMessage() {
    navigate(`/messages?new=${viewedUserId}`)
  }

  async function shareProfile() {
    const url = window.location.href
    if (navigator.share) await navigator.share({ title: `${profile?.display_name || 'CampusPulse'} profile`, url })
    else if (navigator.clipboard) await navigator.clipboard.writeText(url)
    else setMessage(url)
  }

  async function confirmSignOut() {
    if (window.confirm('Sign out of CampusPulse?')) await supabase.auth.signOut()
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    const result = resetMode
      ? await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/account` })
      : mode === 'sign-in'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName || 'Student' } } })

    if (result.error) setError(result.error.message)
    else if (resetMode) setMessage('Password reset instructions sent. Check your email.')
    else if (mode === 'sign-up' && !result.data.session) setMessage('Account created. Check your email to confirm it, then sign in.')
    else setMessage('You are signed in.')
    setBusy(false)
  }

  async function saveProfile(event) {
    event.preventDefault()
    const { data, error: saveError } = await supabase
      .from('profiles')
      .update({ bio: bio.trim(), avatar_url: avatarUrl.trim() })
      .eq('id', session.user.id)
      .select('id, display_name, username, bio, avatar_url, created_at, verified')
      .single()

    if (saveError) setError(saveError.message)
    else {
      setProfile(data)
      setEditing(false)
      setMessage('Profile updated.')
    }
  }

  async function uploadAvatar(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const path = `${session.user.id}/${Date.now()}-${file.name}`
    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    if (uploadError) return setError(uploadError.message)
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    setAvatarUrl(data.publicUrl)
  }

  if (!session) {
    return (
      <div className="page">
        <header className="screen-header"><p className="eyebrow">Join the campus conversation</p><h1>{resetMode ? 'Reset password' : mode === 'sign-in' ? 'Sign in' : 'Create account'}</h1><p className="intro">{resetMode ? 'Enter your email to receive reset instructions.' : 'Sign in to access your campus profile.'}</p></header>
        <form className="auth-form" onSubmit={handleSubmit}>
          {!resetMode && mode === 'sign-up' && <label>Display name<input onChange={(event) => setDisplayName(event.target.value)} required type="text" value={displayName} /></label>}
          <label>Email<input autoComplete="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>
          {!resetMode && <label>Password<input autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} minLength="6" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>}
          <button className="primary-button" disabled={busy} type="submit">{busy ? 'Please wait...' : resetMode ? 'Send reset email' : mode === 'sign-in' ? 'Sign in' : 'Create account'}</button>
        </form>
        {message && <p className="success-text">{message}</p>}
        {error && <p className="error-text">{error}</p>}
        {!resetMode && <button className="text-button" onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')} type="button">{mode === 'sign-in' ? 'Need an account? Create one' : 'Already have an account? Sign in'}</button>}
        <button className="text-button" onClick={() => setResetMode(!resetMode)} type="button">{resetMode ? 'Back to sign in' : 'Forgot password?'}</button>
      </div>
    )
  }

  if (!profile) return <div className="page"><p>Loading profile...</p></div>

  if (requestedList) {
    const listTitle = requestedList === 'followers' ? 'Followers' : 'Following'
    return (
      <div className="page">
        <header className="people-list-header"><button className="icon-button" onClick={() => navigate(viewedUserId ? `/account?user=${viewedUserId}` : '/account')} type="button" aria-label="Back">←</button><h1>{listTitle}</h1></header>
        {people.length === 0 ? <div className="state-card"><h2>No {listTitle.toLowerCase()} yet</h2></div> : people.map((person) => (
          <Link className="person-row" key={person.id} to={`/account?user=${person.id}`}>
            {person.avatar_url ? <img alt="" className="person-avatar" src={person.avatar_url} /> : <span className="person-avatar avatar-placeholder">{(person.display_name || 'S').charAt(0)}</span>}
            <span><strong>{person.display_name || person.username || 'Student'}</strong><small>@{person.username || 'student'}</small></span>
          </Link>
        ))}
      </div>
    )
  }

  return (
    <div className="page account-page">
            <header className="account-topbar">
        {viewedUserId ? <Link className="back-link" to="/account">← My profile</Link> : <span />}
        {!viewedUserId && <button aria-label="Open account menu" className="icon-button" onClick={() => setMenuOpen(true)} type="button">☰</button>}
      </header>
            {menuOpen && (
        <div className="menu-backdrop" onClick={() => setMenuOpen(false)} role="presentation">
          <section aria-label="Account menu" className="account-menu" onClick={(event) => event.stopPropagation()}>
            <span className="sheet-handle" />
            <button onClick={() => { setMenuOpen(false); setEditing(true) }} type="button">Edit profile</button>
            <button onClick={() => { setMenuOpen(false); navigate('/account/blocked') }} type="button">Blocked accounts</button>
            <button onClick={() => { setMenuOpen(false); setMessage('Switch account is coming soon.') }} type="button">Switch account</button>
            <button onClick={() => { setMenuOpen(false); setMessage('Add account is coming soon.') }} type="button">Add account</button>
            <hr />
            <button className="signout-menu" onClick={() => { setMenuOpen(false); confirmSignOut() }} type="button">Sign out</button>
          </section>
        </div>
      )}
      <header className="profile-header">
        <div className="profile-topline">
          {avatarUrl ? <img alt="Your profile" className="avatar" src={avatarUrl} /> : <div className="avatar avatar-placeholder">{(profile.display_name || 'S').charAt(0).toUpperCase()}</div>}
          <div className="profile-stats">
            <div className="stat-display"><strong>{stats.posts}</strong><span>Posts</span></div>
            <Link className="stat-display" to={`/account${viewedUserId ? `?user=${viewedUserId}&` : '?'}list=followers`}><strong>{stats.followers}</strong><span>Followers</span></Link>
            <Link className="stat-display" to={`/account${viewedUserId ? `?user=${viewedUserId}&` : '?'}list=following`}><strong>{stats.following}</strong><span>Following</span></Link>
          </div>
        </div>
        <h1>{profile.display_name || 'Student'}</h1>
        <p className="profile-bio">{profile.bio || 'Add a short bio about yourself.'}</p>
        {viewedUserId && viewedUserId !== session.user.id
          ? <div className="profile-actions"><button className="primary-button" onClick={toggleFollow} type="button">{following ? 'Following' : 'Follow'}</button><button className="secondary-button" onClick={openDirectMessage} type="button">Message</button></div>
          : <div className="profile-actions"><button className="secondary-button" onClick={() => setEditing(true)} type="button">Edit profile</button><button className="secondary-button" onClick={shareProfile} type="button">Share profile</button></div>}
      </header>

      {editing && (
        <form className="profile-edit" onSubmit={saveProfile}>
          <label>Bio<textarea maxLength="160" onChange={(event) => setBio(event.target.value)} value={bio} /></label>
          <label>Profile picture<input accept="image/*" onChange={uploadAvatar} type="file" /></label>
          <label>Or paste image URL<input onChange={(event) => setAvatarUrl(event.target.value)} type="url" value={avatarUrl} /></label>
          <button className="primary-button" type="submit">Save profile</button>
        </form>
      )}
      {message && <p className="success-text">{message}</p>}
      {error && <p className="error-text">{error}</p>}

            <div className="profile-tabs" role="tablist">
        <button aria-selected="true" className="profile-tab active" role="tab" type="button">Posts</button>
      </div>
        <ProfilePosts
        key={viewedUserId || 'me'}
        className="profile-post-grid"
        profileUserId={viewedUserId || undefined}
        readOnly={Boolean(viewedUserId)}
        session={session}
      />
    </div>
  )
}
