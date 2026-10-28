import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

export default function Home() {
  const [updates, setUpdates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function loadUpdates() {
      const { data, error } = await supabase
        .from('updates')
        .select('*')
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) setError(error.message)
      else setUpdates(data)
      setLoading(false)
    }
    loadUpdates()
  }, [])

  if (loading) return <div className="page">Loading...</div>
  if (error) return <div className="page">Error: {error}</div>

  return (
    <div className="page">
      <h1>CampusPulse</h1>
      {updates.map((u) => (
        <div className="card" key={u.id}>
          <span className="tag">{u.category}</span>
          <span className={`tag ${u.source_type}`}>{u.source_type}</span>
          {u.pinned && <span className="tag">📌 pinned</span>}
          <h3>{u.title}</h3>
          <p>{u.body}</p>
          <small>{new Date(u.created_at).toLocaleString()}</small>
        </div>
      ))}
    </div>
  )
}
