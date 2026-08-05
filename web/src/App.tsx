import { useEffect, useState } from "react";
import "./App.css";
import { getMe, login, register, type Employee } from "./api";
import EmployeePortal from "./EmployeePortal";
import ManagerPortal from "./ManagerPortal";

type AuthMode = "login" | "register";

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("token"));
  const [me, setMe] = useState<Employee | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [regRole, setRegRole] = useState<"employee" | "manager">("employee");
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

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await register({ email, password, full_name: fullName, role: regRole });
      const t = await login(email, password);
      localStorage.setItem("token", t);
      setToken(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Register failed");
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
          <p className="auth-lead">Employee and manager portals — clocking, leave, rota, messaging.</p>
        </div>
      </div>
      <div className="auth-panel">
        <div className="auth-tabs">
          <button
            type="button"
            className={authMode === "login" ? "active" : ""}
            onClick={() => {
              setAuthMode("login");
              setError("");
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={authMode === "register" ? "active" : ""}
            onClick={() => {
              setAuthMode("register");
              setError("");
            }}
          >
            Register
          </button>
        </div>
        <h2>{authMode === "login" ? "Welcome back" : "Create your account"}</h2>
        <p className="muted">
          {authMode === "login"
            ? "Managers and employees land in different dashboards by role."
            : "Register as employee or manager. Data is stored in Postgres."}
        </p>
        <form onSubmit={authMode === "login" ? onLogin : onRegister} className="form-grid">
          {authMode === "register" && (
            <>
              <label>
                Full name
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </label>
              <label>
                Role
                <select value={regRole} onChange={(e) => setRegRole(e.target.value as "employee" | "manager")}>
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                </select>
              </label>
            </>
          )}
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
            {loading ? "Please wait…" : authMode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
