import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import LoginPage from "./pages/LoginPage";
import DealListPage from "./pages/DealListPage";
import DealRoomPage from "./pages/DealRoomPage";
import Navbar from "./components/Navbar";
import { logout as apiLogout } from "./api";

const ROLE_LABELS = {
  deal_team: "Deal Team",
  ops_manager: "Ops Manager",
  ops_team_member: "Ops Team",
  checker: "Checker",
};

function AppShell({ user, onLogout, children, hideNavbar }) {
  return (
    <div className="app-shell">
      {!hideNavbar && <Navbar user={user} onLogout={onLogout} />}
      <main className="app-main">{children}</main>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);

  // Always identifies who's logged in and as what role, right in the
  // browser tab — the point being demo clarity: several demo accounts are
  // often open in different tabs at once, and "dealops" / a deal's own
  // title looked identical across all of them. Deliberately NOT overridden
  // per-page (e.g. by the deal name while inside a Deal Room) so this stays
  // the one thing every tab shows at a glance.
  useEffect(() => {
    document.title = user ? `DealOps - ${user.username} - ${ROLE_LABELS[user.role] || user.role}` : "DealOps";
  }, [user]);

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
              <AppShell user={user} onLogout={handleLogout} hideNavbar>
                <DealRoomPage user={user} onLogout={handleLogout} />
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
