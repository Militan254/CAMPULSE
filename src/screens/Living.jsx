import { useSearchParams } from 'react-router-dom'
import Rentals from './Rentals'
import Essentials from './Essentials'

// To add a third section later (for example "Money"), add one line here
const SECTIONS = [
  { id: 'rentals', label: 'Rentals' },
  { id: 'essentials', label: 'Essentials' },
]

export default function Living() {
  // The chosen section lives in the address (?tab=essentials),
  // so refreshing the page or sharing the link keeps your place
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab = SECTIONS.some((section) => section.id === requested) ? requested : 'rentals'

  return (
    <>
      <div className="segmented-wrap">
        <div aria-label="Living sections" className="segmented" role="tablist">
          {SECTIONS.map((section) => (
            <button
              aria-selected={tab === section.id}
              className={tab === section.id ? 'active' : ''}
              key={section.id}
              onClick={() => setParams({ tab: section.id }, { replace: true })}
              role="tab"
              type="button"
            >
              {section.label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'rentals' ? <Rentals /> : <Essentials />}
    </>
  )
}