import { NavLink, useLocation } from 'react-router-dom'
import DirectMessagesButton from './DirectMessagesButton'
import NavIcon from './NavIcon'

export default function NavBar({ session }) {
  const { pathname } = useLocation()

  // Inside a single conversation (/messages/<id>) the bar is hidden,
  // so the message box can sit at the bottom of the screen
  if (/^\/messages\/.+/.test(pathname)) return null

  return (
    <nav aria-label="Main" className="navbar">
      <NavLink className="nav-item" end to="/">
        <NavIcon name="updates" />
        <span>Updates</span>
      </NavLink>
      <NavLink className="nav-item" to="/living">
        <NavIcon name="living" />
        <span>Living</span>
      </NavLink>
      <DirectMessagesButton session={session} />
      <NavLink className="nav-item" to="/account">
        <NavIcon name="account" />
        <span>Account</span>
      </NavLink>
    </nav>
  )
}