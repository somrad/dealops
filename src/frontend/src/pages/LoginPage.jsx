import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaHandshake } from "react-icons/fa";
import { login } from "../api";

const DEMO_ACCOUNTS = [
  { username: "dana", password: "dana123", label: "Dana — Deal Team" },
  { username: "omar", password: "omar123", label: "Omar — Ops Manager" },
  { username: "priya", password: "priya123", label: "Priya — Ops Team" },
  { username: "chen", password: "chen123", label: "Chen — Checker" },
  { username: "som", password: "som123", label: "Som — Ops Team" },
  { username: "kamal", password: "kamal123", label: "Kamal — Checker" },
];

function LoginPage({ onLoggedIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function doLogin(u, p) {
    setError("");
    setLoading(true);
    try {
      const user = await login(u, p);
      onLoggedIn(user);
      navigate("/deals");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    doLogin(username, password);
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <FaHandshake />
          <h1>dealops</h1>
        </div>
        <p className="login-subtitle">Bridging origination and servicing, one deal at a time.</p>

        <form onSubmit={handleSubmit} className="login-form">
          <label>Username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. dana" />
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={loading}>{loading ? "Signing in..." : "Log in"}</button>
        </form>

        <div className="login-demo">
          <span>Or try a demo account</span>
          <div className="demo-accounts">
            {DEMO_ACCOUNTS.map((acct) => (
              <button
                key={acct.username}
                type="button"
                className="btn-secondary"
                onClick={() => doLogin(acct.username, acct.password)}
              >
                {acct.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
