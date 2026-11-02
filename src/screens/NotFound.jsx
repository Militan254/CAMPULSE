import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="page state-card">
      <h1>Page not found</h1>
      <p>The page you are looking for does not exist.</p>
      <Link className="primary-button button-link" to="/">Go home</Link>
    </div>
  )
}