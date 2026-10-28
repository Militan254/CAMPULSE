import { Routes, Route } from 'react-router-dom'
import NavBar from './components/NavBar'
import Home from './screens/Home'
import Rentals from './screens/Rentals'
import Essentials from './screens/Essentials'

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/rentals" element={<Rentals />} />
        <Route path="/essentials" element={<Essentials />} />
      </Routes>
      <NavBar />
    </>
  )
}
