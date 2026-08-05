import { useEffect, useState } from "react";
import "./App.css";
import { getMe, login, type Employee } from "./api";
import EmployeePortal from "./EmployeePortal";
import ManagerPortal from "./ManagerPortal";

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("token"));
  const [me, setMe] = useState<Employee | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(Boolean(token));

  useEffect(() => {
    if (!token) {
      setMe(null);
      setBooting(false);
      return;
    }
    setBooting(true);
    getMe(token)
      .then(setMe)
      .catch((e) => {
        setError(String(e.message || e));
        localStorage.removeItem("token");
        setToken(null);
        setMe(null);
      })
      .finally(() => setBooting(false));
  }, [token]);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const t = await login(email, password);
      localStorage.setItem("token", t);
      setToken(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem("token");
    setToken(null);
    setMe(null);
  }

  if (booting) {
    return (
      <div className="auth-page center-only">
        <p className="muted">Loading workspace…</p>
      </div>
    );
  }

  if (token && me) {
    if (me.role === "manager" || me.role === "admin") {
      return <ManagerPortal token={token} me={me} onLogout={logout} />;
    }
    return <EmployeePortal token={token} me={me} onLogout={logout} />;
  }

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <div className="brand-mark">SC</div>
        <div>
          <p className="brand-kicker">Supreme Childcare</p>
          <h1>Time &amp; Attendance</h1>
          <p className="auth-lead">Sign in with your work account. Managers create employee logins.</p>
        </div>
      </div>
      <div className="auth-panel">
        <h2>Sign in</h2>
        <p className="muted">Employees use credentials issued by a manager.</p>
        <form onSubmit={onLogin} className="form-grid">
          <label>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
          </label>
          <label>
            Password
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              minLength={6}
            />
          </label>
          {error && <div className="alert error">{error}</div>}
          <button type="submit" className="btn primary block" disabled={loading}>
            {loading ? "Please wait…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
