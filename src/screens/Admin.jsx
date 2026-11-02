import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
   import NotFound from './NotFound'

const emptyForm = { title: '', body: '', category: 'notice', source_type: 'official', pinned: false, price: '', area: '', distance_to_campus: '', water_available: true, security_notes: '', contact: '', availability: 'full', name: '', type: 'water', price_info: '', image_url: '', video_url: '', audio_url: '', song_url: '' }

   export default function Admin({ session, ready }) {
  const [admin, setAdmin] = useState(false)
  const [section, setSection] = useState('updates')
  const [records, setRecords] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')


  useEffect(() => {
    if (!session) return
    supabase.rpc('is_admin').then(({ data, error: roleError }) => {
      setAdmin(!roleError && data === true)
      setLoading(false)
    })
  }, [session])

  useEffect(() => {
    if (!admin) return
    async function loadCurrentRecords() {
      const table = section === 'updates' ? 'updates' : section === 'rentals' ? 'listings' : 'vendors'
      const { data, error: loadError } = await supabase.from(table).select('*').order('created_at', { ascending: false })
      if (loadError) setError(loadError.message)
      else setRecords(data ?? [])
      setLoading(false)
    }
    loadCurrentRecords()
  }, [admin, section])

  async function loadRecords() {
    setLoading(true)
    const table = section === 'updates' ? 'updates' : section === 'rentals' ? 'listings' : 'vendors'
    const query = supabase.from(table).select('*').order('created_at', { ascending: false })
    const { data, error: loadError } = await query
    if (loadError) setError(loadError.message)
    else setRecords(data ?? [])
    setLoading(false)
  }



  function updateField(event) {
    const { name, value, type, checked } = event.target
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }))
  }

  function startEdit(record) {
    setEditingId(record.id)
    setForm({ ...emptyForm, ...record })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function resetForm() {
    setEditingId(null)
    setForm(emptyForm)
  }

  async function uploadImage(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const bucket = section === 'updates' ? 'update-images' : section === 'rentals' ? 'listing-images' : 'vendor-images'
    const path = `${Date.now()}-${file.name}`
    const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, { upsert: false })
    if (uploadError) return setError(uploadError.message)
    const { data } = supabase.storage.from(bucket).getPublicUrl(path)
    setForm((current) => ({ ...current, image_url: data.publicUrl }))
    setMessage('Picture uploaded. Save the item to attach it.')
  }

  async function saveRecord(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    const table = section === 'updates' ? 'updates' : section === 'rentals' ? 'listings' : 'vendors'
    const payload = section === 'updates'
      ? { title: form.title, body: form.body, category: form.category, source_type: 'official', pinned: form.pinned, image_url: form.image_url || null, video_url: form.video_url || null, audio_url: form.audio_url || null, song_url: form.song_url || null }
      : section === 'rentals'
        ? { title: form.title, price: Number(form.price), area: form.area, distance_to_campus: form.distance_to_campus, water_available: form.water_available, security_notes: form.security_notes, contact: form.contact, availability: form.availability, image_url: form.image_url || null }
        : { name: form.name, type: form.type, area: form.area, price_info: form.price_info, contact: form.contact, image_url: form.image_url || null }

    const result = editingId
      ? await supabase.from(table).update(payload).eq('id', editingId)
      : await supabase.from(table).insert(payload)

    if (result.error) setError(result.error.message)
    else {
      setMessage(`${section.slice(0, -1)} ${editingId ? 'updated' : 'added'}.`)
      resetForm()
      loadRecords()
    }
    setBusy(false)
  }

  async function removeRecord(id) {
    if (!window.confirm('Remove this item?')) return
    const table = section === 'updates' ? 'updates' : section === 'rentals' ? 'listings' : 'vendors'
    const { error: deleteError } = await supabase.from(table).delete().eq('id', id)
    if (deleteError) setError(deleteError.message)
    else loadRecords()
  }

     if (!ready || (session && loading && !admin)) return <div className="page"><p>Loading...</p></div>
   if (!session || !admin) return <NotFound />

  return (
    <div className="page admin-page">
      <header className="screen-header"><p className="eyebrow">Campulse control room</p><h1>Admin</h1><p className="intro">Manage what students see in the app.</p></header>
      <div className="admin-tabs">
        {['updates', 'rentals', 'essentials'].map((item) => <button className={section === item ? 'filter-button active' : 'filter-button'} key={item} onClick={() => { setSection(item); resetForm() }} type="button">{item}</button>)}
      </div>
      <form className="admin-form" onSubmit={saveRecord}>
        <h2>{editingId ? 'Edit' : 'Add'} {section.slice(0, -1)}</h2>
        {section === 'essentials' ? <>
          <label>Name<input name="name" onChange={updateField} required value={form.name} /></label>
          <label>Type<select name="type" onChange={updateField} value={form.type}><option value="water">Water</option><option value="gas">Gas</option><option value="food">Food</option><option value="print">Print</option><option value="shop">Shop</option></select></label>
          <label>Area<input name="area" onChange={updateField} required value={form.area} /></label>
          <label>Price information<input name="price_info" onChange={updateField} value={form.price_info} /></label>
          <label>Contact<input name="contact" onChange={updateField} value={form.contact} /></label>
          <label>Picture<input accept="image/*" onChange={uploadImage} type="file" /></label>
          {form.image_url && <img alt="Vendor preview" className="admin-image-preview" src={form.image_url} />}
        </> : <>
          <label>Title<input name="title" onChange={updateField} required value={form.title} /></label>
          {section === 'updates' ? <>
            <label>Description<textarea name="body" onChange={updateField} required value={form.body} /></label>
            <label>Category<select name="category" onChange={updateField} value={form.category}><option value="strike">Strike</option><option value="sports">Sports</option><option value="notice">Notice</option><option value="event">Event</option></select></label>
            <label className="checkbox-label"><input checked={form.pinned} name="pinned" onChange={updateField} type="checkbox" /> Pin this update</label>
          </> : <>
            <label>Price (KSh)<input min="0" name="price" onChange={updateField} required type="number" value={form.price} /></label>
            <label>Area<input name="area" onChange={updateField} required value={form.area} /></label>
            <label>Distance from main gate<input name="distance_to_campus" onChange={updateField} value={form.distance_to_campus} /></label>
            <label className="checkbox-label"><input checked={form.water_available} name="water_available" onChange={updateField} type="checkbox" /> Water available</label>
            <label>Security notes<input name="security_notes" onChange={updateField} value={form.security_notes} /></label>
            <label>Contact<input name="contact" onChange={updateField} value={form.contact} /></label>
            <label>Status<select name="availability" onChange={updateField} value={form.availability}><option value="full">Full</option><option value="available">Available</option></select></label>
          </>}
          <label>Picture<input accept="image/*" onChange={uploadImage} type="file" /></label>
          {form.image_url && <img alt="Content preview" className="admin-image-preview" src={form.image_url} />}
          {section === 'updates' && <>
            <label>Video URL<input name="video_url" onChange={updateField} type="url" value={form.video_url} /></label>
            <label>Voice note URL<input name="audio_url" onChange={updateField} type="url" value={form.audio_url} /></label>
            <label>Song URL<input name="song_url" onChange={updateField} type="url" value={form.song_url} /></label>
          </>}
        </>}
        <div className="admin-form-actions"><button className="primary-button" disabled={busy} type="submit">{busy ? 'Saving...' : editingId ? 'Save changes' : 'Add item'}</button>{editingId && <button className="secondary-button" onClick={resetForm} type="button">Cancel</button>}</div>
      </form>
      {message && <p className="success-text">{message}</p>}
      {error && <p className="error-text">{error}</p>}
      <section className="admin-list">
        <h2>Current {section}</h2>
        {records.map((record) => <article className="admin-record" key={record.id}><div><strong>{record.title || record.name}</strong><span>{record.area || record.category || record.type}</span></div><div className="admin-record-actions"><button className="secondary-button" onClick={() => startEdit(record)} type="button">Edit</button><button className="danger-button" onClick={() => removeRecord(record.id)} type="button">Remove</button></div></article>)}
      </section>
    </div>
  )
}
