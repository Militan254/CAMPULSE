import { useSearchParams } from 'react-router-dom'
import AccountChat from '../components/AccountChat'
import DirectMessages from './DirectMessages'

export default function MessagesHome({ session }) {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'campus' ? 'campus' : 'chats'

  // Signed-out visitors just see the normal "sign in to view messages" card
  if (!session) return <DirectMessages session={session} />

  return (
    <>
      <div className="segmented-wrap">
        <div aria-label="Messages sections" className="segmented" role="tablist">
          <button aria-selected={tab === 'chats'} className={tab === 'chats' ? 'active' : ''} onClick={() => setParams({ tab: 'chats' }, { replace: true })} role="tab" type="button">Chats</button>
          <button aria-selected={tab === 'campus'} className={tab === 'campus' ? 'active' : ''} onClick={() => setParams({ tab: 'campus' }, { replace: true })} role="tab" type="button">Campus chat</button>
        </div>
      </div>
      {tab === 'chats' ? (
        <DirectMessages session={session} />
      ) : (
        <div className="page">
          <header className="screen-header">
            <p className="eyebrow">Students helping students</p>
            <h1>Campus chat</h1>
          </header>
          <AccountChat session={session} />
        </div>
      )}
    </>
  )
}