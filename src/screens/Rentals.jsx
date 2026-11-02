import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

export default function Rentals() {
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [maxPrice, setMaxPrice] = useState('')
  const [areaSearch, setAreaSearch] = useState('')
  const [waterOnly, setWaterOnly] = useState(false)
  const [availability, setAvailability] = useState('all')
  const [sortBy, setSortBy] = useState('newest')

  useEffect(() => {
    async function loadListings() {
      const { data, error } = await supabase
        .from('listings')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) setError(error.message)
      else setListings(data ?? [])
      setLoading(false)
    }

    loadListings()
  }, [])

  const filteredListings = listings.filter((listing) => {
    const matchesPrice = !maxPrice || listing.price <= Number(maxPrice)
    const matchesArea = !areaSearch
      || listing.area?.toLowerCase().includes(areaSearch.toLowerCase())
    const matchesWater = !waterOnly || listing.water_available
    const matchesAvailability = availability === 'all' || (listing.availability || 'full') === availability

    return matchesPrice && matchesArea && matchesWater && matchesAvailability
  })

  const visibleListings = [...filteredListings].sort((first, second) => {
    if (sortBy === 'price-low') return (first.price || 0) - (second.price || 0)
    if (sortBy === 'price-high') return (second.price || 0) - (first.price || 0)
    return new Date(second.created_at) - new Date(first.created_at)
  })

  if (loading) return <div className="page"><p>Loading rentals...</p></div>

  if (error) {
    return (
      <div className="page state-card">
        <h1>Rentals</h1>
        <p>We could not load rental listings.</p>
        <p className="error-text">{error}</p>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="screen-header">
        <p className="eyebrow">Find your next place</p>
        <h1>Rentals</h1>
        <p className="intro">Practical housing options near campus.</p>
      </header>

      <section className="rental-filters" aria-label="Filter rental listings">
        <label>
          Max price (KSh)
          <input
            min="0"
            onChange={(event) => setMaxPrice(event.target.value)}
            placeholder="Any price"
            type="number"
            value={maxPrice}
          />
        </label>
        <label>
          Area
          <input
            onChange={(event) => setAreaSearch(event.target.value)}
            placeholder="Search area"
            type="search"
            value={areaSearch}
          />
        </label>
        <label className="checkbox-label">
          <input
            checked={waterOnly}
            onChange={(event) => setWaterOnly(event.target.checked)}
            type="checkbox"
          />
          Water available
        </label>
          <label>
            Availability
            <select onChange={(event) => setAvailability(event.target.value)} value={availability}>
              <option value="all">All listings</option>
              <option value="available">Available only</option>
              <option value="full">Full only</option>
            </select>
          </label>
          <label>
            Sort by
            <select onChange={(event) => setSortBy(event.target.value)} value={sortBy}>
              <option value="newest">Newest</option>
              <option value="price-low">Price: low to high</option>
              <option value="price-high">Price: high to low</option>
            </select>
          </label>
      </section>

      <p className="results-count">{visibleListings.length} {visibleListings.length === 1 ? 'listing' : 'listings'} found</p>

      {visibleListings.length === 0 ? (
        <div className="state-card">
          <h2>Nothing here yet</h2>
          <p>Try changing your filters.</p>
        </div>
      ) : (
        visibleListings.map((listing) => (
          <article className="card rental-card" key={listing.id}>
            <img
              alt={`${listing.title} placeholder`}
              className="listing-image"
              src={listing.image_url || '/SAV.jpeg'}
            />
            <div className="rental-heading">
              <h2>{listing.title}</h2>
              <strong>KSh {listing.price?.toLocaleString()}</strong>
            </div>
            <p className="rental-meta">{listing.area} · {listing.distance_to_campus}</p>
            <div className="rental-badges">
              <span className={listing.availability === 'available' ? 'rental-badge available' : 'rental-badge full'}>{listing.availability === 'available' ? 'Available' : 'Full'}</span>
              <span className="rental-badge">Water {listing.water_available ? 'yes' : 'no'}</span>
            </div>
            <p><strong>Security:</strong> {listing.security_notes || 'No details provided'}</p>
            {listing.contact && (
              <a className="call-link" href={`tel:${listing.contact}`}>Call {listing.contact}</a>
            )}
            {listing.availability === 'available' && <button className="reserve-button" type="button">Reserve space</button>}
            {listing.availability === 'available' && <button className="reserve-button" type="button">Reserve space</button>}
          </article>
        ))
      )}
    </div>
  )
}
