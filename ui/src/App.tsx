import Feed from './Feed'

export default function App() {
  return (
    <div className="app">
      <div className="pane left">
        <div className="pane-title">messages</div>
        <Feed />
      </div>
      <div className="pane right">
        <div className="pane-title">search</div>
        {/* search arrives in a later phase; the pane stays empty */}
      </div>
    </div>
  )
}
