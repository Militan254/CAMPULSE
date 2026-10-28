import { NavLink } from 'react-router-dom'

export default function NavBar() {
  return (
    <nav className="navbar">
      <NavLink to="/">Updates</NavLink>
      <NavLink to="/rentals">Rentals</NavLink>
      <NavLink to="/essentials">Essentials</NavLink>
    </nav>
  )
}
