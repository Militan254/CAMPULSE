import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Routes, Route, useNavigate } from 'react-router-dom'
import NavBar from './components/NavBar'
import Account from './screens/Account'
import DirectMessages from './screens/DirectMessages'
import Home from './screens/Home'
import Living from './screens/Living'
import MessagesHome from './screens/MessagesHome'
import NotFound from './screens/NotFound'
import { supabase } from './supabase'

// Loaded only when needed, so normal users never download the admin code
const Admin = lazy(() => import('./screens/Admin'))

export default function App() {
  const [session, setSession] = useState(null)
  // "ready" turns true once we know whether someone is signed in,
  // so pages don't flash the wrong screen while the session loads
  const [ready, setReady] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession)
      if (event === 'SIGNED_OUT') navigate('/account', { replace: true })
    })

    return () => listener.subscription.unsubscribe()
  }, [navigate])

  return (
    <>
      <Routes>
        <Route path="/" element={<Home session={session} />} />
        <Route path="/living" element={<Living />} />
        {/* Old addresses still work and send people to the new Living tab */}
        <Route path="/rentals" element={<Navigate replace to="/living?tab=rentals" />} />
        <Route path="/essentials" element={<Navigate replace to="/living?tab=essentials" />} />
        <Route path="/messages" element={<MessagesHome session={session} />} />
        <Route path="/messages/:conversationId" element={<DirectMessages session={session} />} />
        <Route path="/account" element={<Account session={session} />} />
        <Route path="/account/blocked" element={<DirectMessages session={session} blockedOnly />} />
        <Route
          path="/silvance"
          element={
            <Suspense fallback={<div className="page"><p>Loading...</p></div>}>
              <Admin session={session} ready={ready} />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <NavBar session={session} />
    </>
  )
}