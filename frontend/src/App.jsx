import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState } from "react";
import LoginPage from "./pages/LoginPage";
import DealListPage from "./pages/DealListPage";
import DealRoomPage from "./pages/DealRoomPage";
import Navbar from "./components/Navbar";
import { logout as apiLogout } from "./api";

function AppShell({ user, onLogout, children }) {
  return (
    <div className="app-shell">
      <Navbar user={user} onLogout={onLogout} />
      <main className="app-main">{children}</main>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);

  function handleLogout() {
    apiLogout();
    setUser(null);
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/deals" /> : <LoginPage onLoggedIn={setUser} />} />
        <Route
          path="/deals"
          element={
            user ? (
              <AppShell user={user} onLogout={handleLogout}>
                <DealListPage user={user} />
              </AppShell>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
        <Route
          path="/deals/:dealId"
          element={
            user ? (
              <AppShell user={user} onLogout={handleLogout}>
                <DealRoomPage user={user} />
              </AppShell>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
        <Route path="*" element={<Navigate to="/deals" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
