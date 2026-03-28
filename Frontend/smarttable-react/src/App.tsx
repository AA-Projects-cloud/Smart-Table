import { Show, SignInButton, UserButton } from '@clerk/react'

function App() {
  return (
    <div className="App">
      <header>
        <div className="logo-section">
          <h1>SmartTable</h1>
        </div>
        <div className="auth-section">
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="cl-signInButton">Sign In</button>
            </SignInButton>
          </Show>
          <Show when="signed-in">
            <UserButton appearance={{ elements: { userButtonAvatarBox: { width: '40px', height: '40px' } } }} />
          </Show>
        </div>
      </header>

      <main>
        <Show when="signed-in">
          <h2>Welcome to SmartTable!</h2>
          <p>You are signed in and can access the intelligent scheduling system.</p>
          <div className="dashboard-links">
            <button>Timetable</button>
            <button>Rooms</button>
            <button>Subjects</button>
            <button>Analytics</button>
          </div>
        </Show>

        <Show when="signed-out">
          <h2>Welcome to SmartTable</h2>
          <p>Please sign in to access the intelligent scheduling system for educational institutions.</p>
        </Show>
      </main>
    </div>
  )
}

export default App
