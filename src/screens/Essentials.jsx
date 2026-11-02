import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

const vendorTypes = ['water', 'gas', 'food', 'print', 'shop']

export default function Essentials() {
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedType, setSelectedType] = useState('water')
  const [searchTerm, setSearchTerm] = useState('')
  const [areaSearch, setAreaSearch] = useState('')

  useEffect(() => {
    async function loadVendors() {
      const { data, error } = await supabase
        .from('vendors')
        .select('*')
        .order('name', { ascending: true })

      if (error) setError(error.message)
      else setVendors(data ?? [])
      setLoading(false)
    }

    loadVendors()
  }, [])

  const visibleVendors = vendors.filter((vendor) => {
    const searchableText = `${vendor.name} ${vendor.area} ${vendor.price_info}`.toLowerCase()
    const matchesType = selectedType === 'all' || vendor.type === selectedType
    const matchesSearch = searchableText.includes(searchTerm.toLowerCase().trim())
    const matchesArea = !areaSearch || vendor.area?.toLowerCase().includes(areaSearch.toLowerCase())
    return matchesType && matchesSearch && matchesArea
  })

  if (loading) return <div className="page"><p>Loading essentials...</p></div>

  if (error) {
    return (
      <div className="page state-card">
        <h1>Essentials</h1>
        <p>We could not load nearby vendors.</p>
        <p className="error-text">{error}</p>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="screen-header">
        <p className="eyebrow">Useful places nearby</p>
        <h1>Essentials</h1>
        <p className="intro">Find everyday services around campus.</p>
      </header>

      <div className="essentials-filters">
        <label>Search services<input onChange={(event) => setSearchTerm(event.target.value)} placeholder="Food, printing, water..." type="search" value={searchTerm} /></label>
        <label>Area<input onChange={(event) => setAreaSearch(event.target.value)} placeholder="Search area" type="search" value={areaSearch} /></label>
      </div>

      <div className="vendor-tabs" aria-label="Filter vendors by type">
        <button className={selectedType === 'all' ? 'filter-button active' : 'filter-button'} onClick={() => setSelectedType('all')} type="button">All</button>
        {vendorTypes.map((type) => (
          <button
            className={selectedType === type ? 'filter-button active' : 'filter-button'}
            key={type}
            onClick={() => setSelectedType(type)}
            type="button"
          >
            {type}
          </button>
        ))}
      </div>

      {visibleVendors.length === 0 ? (
        <div className="state-card">
          <h2>Nothing here yet</h2>
          <p>There are no {selectedType} vendors listed yet.</p>
        </div>
      ) : (
        visibleVendors.map((vendor) => (
          <article className="card vendor-card" key={vendor.id}>
            <img alt={`${vendor.name} placeholder`} className="listing-image" src={vendor.image_url || '/SAV.jpeg'} />
            <div className="vendor-heading">
              <h2>{vendor.name}</h2>
              <span className="tag category-tag">{vendor.type}</span>
            </div>
            <p className="vendor-area">{vendor.area}</p>
            <p><strong>Price:</strong> {vendor.price_info || 'No price details provided'}</p>
            {vendor.contact && (
              <a className="call-link" href={`tel:${vendor.contact}`}>Call {vendor.contact}</a>
            )}
            <button className="order-button" type="button">Place order (coming soon)</button>
          </article>
        ))
      )}
    </div>
  )
}
