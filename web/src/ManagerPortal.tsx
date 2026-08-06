import { useEffect, useState } from "react";
import {
  adminClockOut,
  broadcastMessage,
  createEmployee,
  decideLeave,
  getAdminLeave,
  getAdminThread,
  getEmployees,
  getLive,
  getMessageThreads,
  getOverview,
  getRota,
  getShiftTypes,
  replyToEmployee,
  type ClockEvent,
  type Employee,
  type LeaveRecord,
  type Message,
  type MessageThread,
  type Overview,
  type ScheduledShift,
  type ShiftType,
} from "./api";
import RotaBoard from "./RotaBoard";
import { fmtDate, fmtHoursMinutes, fmtTime, initials, mondayISO, statusClass } from "./utils";

type Tab = "overview" | "live" | "employees" | "leave" | "rota" | "messages";

const NAV: { id: Tab; label: string; desc: string }[] = [
  { id: "overview", label: "Overview", desc: "Team totals and trends" },
  { id: "live", label: "Live", desc: "Who is clocked in now" },
  { id: "employees", label: "Employees", desc: "Active staff directory" },
  { id: "leave", label: "Leave", desc: "Approve or reject requests" },
  { id: "rota", label: "Rota", desc: "Build and publish weekly shifts" },
  { id: "messages", label: "Messages", desc: "Inbox and broadcast" },
];

type Props = {
  token: string;
  me: Employee;
  onLogout: () => void;
};

export default function ManagerPortal({ token, me, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");
  const [rangeDays, setRangeDays] = useState(7);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [live, setLive] = useState<ClockEvent[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leave, setLeave] = useState<LeaveRecord[]>([]);
  const [leaveFilter, setLeaveFilter] = useState<"all" | "pending">("pending");
  const [rota, setRota] = useState<ScheduledShift[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [weekStart, setWeekStart] = useState(mondayISO());
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [activeEmpId, setActiveEmpId] = useState<string>("");
  const [thread, setThread] = useState<Message[]>([]);
  const [msgText, setMsgText] = useState("");
  const [broadcast, setBroadcast] = useState("");
  const [overrideReason, setOverrideReason] = useState<Record<string, string>>({});
  const [empForm, setEmpForm] = useState({
    full_name: "",
    email: "",
    password: "",
    contract_type: "full_time",
    max_weekly_hours: 40,
  });
  const [creatingEmp, setCreatingEmp] = useState(false);

  const activeNav = NAV.find((n) => n.id === tab)!;

  function showError(message: string) {
    setError(message);
  }

  function clearError() {
    setError("");
  }

  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(clearError, 8000);
    return () => window.clearTimeout(t);
  }, [error]);

  useEffect(() => {
    clearError();
  }, [tab]);

  async function refresh() {
    const [ov, lv, emps, leaveRows, rotaRows, types, th] = await Promise.all([
      getOverview(token, rangeDays),
      getLive(token),
      getEmployees(token),
      getAdminLeave(token, leaveFilter === "pending" ? "pending" : undefined),
      getRota(token, weekStart),
      getShiftTypes(token),
      getMessageThreads(token),
    ]);
    setOverview(ov);
    setLive(lv);
    setEmployees(emps);
    setLeave(leaveRows);
    setRota(rotaRows);
    setShiftTypes(types);
    setThreads(th);
  }

  useEffect(() => {
    refresh().catch((e) => showError(String(e.message || e)));
  }, [token, rangeDays, leaveFilter, weekStart]);

  useEffect(() => {
    if (!activeEmpId) {
      setThread([]);
      return;
    }
    getAdminThread(token, activeEmpId)
      .then(setThread)
      .catch((e) => showError(String(e.message || e)));
  }, [token, activeEmpId]);

  async function onDecide(id: string, status: "approved" | "rejected") {
    clearError();
    try {
      await decideLeave(token, id, status);
      await refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Leave update failed");
    }
  }

  async function onOverride(employeeId: string) {
    const reason = (overrideReason[employeeId] || "").trim();
    if (!reason) {
      showError("Enter a reason before forcing clock-out");
      return;
    }
    clearError();
    try {
      await adminClockOut(token, employeeId, reason);
      setOverrideReason((r) => ({ ...r, [employeeId]: "" }));
      await refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Override failed");
    }
  }

  async function onReply(e: React.FormEvent) {
    e.preventDefault();
    if (!activeEmpId || !msgText.trim()) return;
    try {
      await replyToEmployee(token, activeEmpId, msgText.trim());
      setMsgText("");
      const [msgs, th] = await Promise.all([getAdminThread(token, activeEmpId), getMessageThreads(token)]);
      setThread(msgs);
      setThreads(th);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Send failed");
    }
  }

  async function onCreateEmployee(e: React.FormEvent) {
    e.preventDefault();
    clearError();
    setCreatingEmp(true);
    try {
      await createEmployee(token, {
        full_name: empForm.full_name.trim(),
        email: empForm.email.trim(),
        password: empForm.password,
        contract_type: empForm.contract_type,
        max_weekly_hours: Number(empForm.max_weekly_hours),
      });
      setEmpForm({
        full_name: "",
        email: "",
        password: "",
        contract_type: "full_time",
        max_weekly_hours: 40,
      });
      await refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Could not create employee");
    } finally {
      setCreatingEmp(false);
    }
  }

  async function onBroadcast(e: React.FormEvent) {
    e.preventDefault();
    if (!broadcast.trim()) return;
    try {
      await broadcastMessage(token, broadcast.trim());
      setBroadcast("");
      await refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Broadcast failed");
    }
  }

  return (
    <div className="crm">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark sm">SC</div>
          <div>
            <strong>Supreme</strong>
            <span>Manager CRM</span>
          </div>
        </div>
        <nav className="side-nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? "nav-item active" : "nav-item"}
              onClick={() => setTab(item.id)}
            >
              <span className="nav-label">{item.label}</span>
              {item.id === "messages" && threads.some((t) => t.unread_count > 0) && <span className="nav-dot" />}
              {item.id === "leave" && overview && overview.pending_leave > 0 && (
                <span className="nav-count">{overview.pending_leave}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-user">
          <div className="avatar">{initials(me.full_name)}</div>
          <div className="sidebar-user-meta">
            <strong>{me.full_name}</strong>
            <span>{me.role}</span>
          </div>
          <button type="button" className="btn ghost sm" onClick={onLogout}>
            Log out
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <p className="kicker">Manager workspace</p>
            <h1>{activeNav.label}</h1>
            <p className="muted">{activeNav.desc}</p>
          </div>
          <span className={`status-chip ${live.length ? "on" : ""}`}>
            <span className="status-dot" />
            {live.length} clocked in
          </span>
        </header>

        {error && (
          <div className="alert error page-alert" role="alert">
            <span>{error}</span>
            <button type="button" className="alert-close" onClick={clearError} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}

        <div className="content">
          {tab === "overview" && overview && (
            <section className="stack">
              <div className="toolbar">
                <label className="field inline">
                  Range
                  <select value={rangeDays} onChange={(e) => setRangeDays(Number(e.target.value))}>
                    <option value={7}>Last 7 days</option>
                    <option value={14}>Last 14 days</option>
                    <option value={30}>Last 30 days</option>
                  </select>
                </label>
              </div>
              <div className="kpi-row kpi-4">
                <article className="kpi">
                  <span className="kpi-label">Active staff</span>
                  <strong className="kpi-value">{overview.employees_active}</strong>
                </article>
                <article className="kpi">
                  <span className="kpi-label">Clocked in now</span>
                  <strong className="kpi-value">{overview.currently_clocked_in}</strong>
                </article>
                <article className="kpi">
                  <span className="kpi-label">Hours worked</span>
                  <strong className="kpi-value">{fmtHoursMinutes(overview.hours_worked)}</strong>
                  <span className="kpi-meta">{overview.range_days} day window</span>
                </article>
                <article className="kpi">
                  <span className="kpi-label">Late events</span>
                  <strong className="kpi-value">{overview.late_events}</strong>
                </article>
              </div>
              <div className="kpi-row">
                <article className="kpi">
                  <span className="kpi-label">Shifts completed</span>
                  <strong className="kpi-value">{overview.shifts_completed}</strong>
                </article>
                <article className="kpi">
                  <span className="kpi-label">Pending leave</span>
                  <strong className="kpi-value">{overview.pending_leave}</strong>
                </article>
                <article className="kpi">
                  <span className="kpi-label">Sick / AL requests</span>
                  <strong className="kpi-value">
                    {overview.sick_requests} / {overview.annual_leave_requests}
                  </strong>
                </article>
              </div>
            </section>
          )}

          {tab === "live" && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Live attendance</h2>
                  <p className="muted">Force clock-out requires a reason (admin override).</p>
                </div>
                <button type="button" className="btn" onClick={() => refresh()}>
                  Refresh
                </button>
              </div>
              {live.length === 0 ? (
                <div className="empty-state">
                  <h3>Nobody clocked in</h3>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Shift</th>
                        <th>Since</th>
                        <th>Late</th>
                        <th>Override</th>
                      </tr>
                    </thead>
                    <tbody>
                      {live.map((ev) => (
                        <tr key={ev.id}>
                          <td>{ev.employee_name}</td>
                          <td>{ev.shift_type.display_name}</td>
                          <td>{fmtTime(ev.clock_in_at)}</td>
                          <td>{ev.lateness_minutes > 0 ? `${ev.lateness_minutes}m` : "—"}</td>
                          <td>
                            <div className="inline-actions">
                              <input
                                placeholder="Reason"
                                value={overrideReason[ev.employee_id || ""] || ""}
                                onChange={(e) =>
                                  setOverrideReason((r) => ({
                                    ...r,
                                    [ev.employee_id || ""]: e.target.value,
                                  }))
                                }
                              />
                              <button
                                type="button"
                                className="btn danger sm-btn"
                                onClick={() => ev.employee_id && onOverride(ev.employee_id)}
                              >
                                Clock out
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {tab === "employees" && (
            <section className="stack">
              <form className="panel" onSubmit={onCreateEmployee}>
                <div className="panel-head">
                  <div>
                    <h2>Add employee</h2>
                    <p className="muted">Only managers can create staff accounts.</p>
                  </div>
                </div>
                <div className="form-grid three">
                  <label className="field">
                    Full name
                    <input
                      required
                      value={empForm.full_name}
                      onChange={(e) => setEmpForm((f) => ({ ...f, full_name: e.target.value }))}
                    />
                  </label>
                  <label className="field">
                    Email
                    <input
                      type="email"
                      required
                      value={empForm.email}
                      onChange={(e) => setEmpForm((f) => ({ ...f, email: e.target.value }))}
                    />
                  </label>
                  <label className="field">
                    Temp password
                    <input
                      type="text"
                      required
                      minLength={6}
                      value={empForm.password}
                      onChange={(e) => setEmpForm((f) => ({ ...f, password: e.target.value }))}
                    />
                  </label>
                  <label className="field">
                    Contract
                    <select
                      value={empForm.contract_type}
                      onChange={(e) => setEmpForm((f) => ({ ...f, contract_type: e.target.value }))}
                    >
                      <option value="full_time">Full time</option>
                      <option value="part_time">Part time</option>
                    </select>
                  </label>
                  <label className="field">
                    Max weekly hours
                    <input
                      type="number"
                      min={1}
                      max={80}
                      required
                      value={empForm.max_weekly_hours}
                      onChange={(e) =>
                        setEmpForm((f) => ({ ...f, max_weekly_hours: Number(e.target.value) }))
                      }
                    />
                  </label>
                </div>
                <button type="submit" className="btn primary" disabled={creatingEmp}>
                  {creatingEmp ? "Creating…" : "Create employee"}
                </button>
              </form>

              <div className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Employees</h2>
                    <p className="muted">{employees.length} active staff</p>
                  </div>
                </div>
                {employees.length === 0 ? (
                  <div className="empty-state">
                    <h3>No employees yet</h3>
                    <p>Create staff accounts above, then share their login details.</p>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Contract</th>
                          <th>Max hours</th>
                        </tr>
                      </thead>
                      <tbody>
                        {employees.map((e) => (
                          <tr key={e.id}>
                            <td>{e.full_name}</td>
                            <td>{e.email}</td>
                            <td className="cap">{e.contract_type.replace("_", " ")}</td>
                            <td>{e.max_weekly_hours}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          )}

          {tab === "leave" && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Leave requests</h2>
                  <p className="muted">Approve or reject pending requests.</p>
                </div>
                <div className="seg">
                  <button
                    type="button"
                    className={leaveFilter === "pending" ? "active" : ""}
                    onClick={() => setLeaveFilter("pending")}
                  >
                    Pending
                  </button>
                  <button
                    type="button"
                    className={leaveFilter === "all" ? "active" : ""}
                    onClick={() => setLeaveFilter("all")}
                  >
                    All
                  </button>
                </div>
              </div>
              {leave.length === 0 ? (
                <div className="empty-state">
                  <h3>No leave requests</h3>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Type</th>
                        <th>From</th>
                        <th>To</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leave.map((l) => (
                        <tr key={l.id}>
                          <td>{l.employee_name}</td>
                          <td className="cap">{l.leave_type.replace("_", " ")}</td>
                          <td>{fmtDate(l.start_date)}</td>
                          <td>{fmtDate(l.end_date)}</td>
                          <td>
                            <span className={statusClass(l.status)}>{l.status}</span>
                          </td>
                          <td>
                            {l.status === "pending" ? (
                              <div className="inline-actions">
                                <button type="button" className="btn primary sm-btn" onClick={() => onDecide(l.id, "approved")}>
                                  Approve
                                </button>
                                <button type="button" className="btn danger sm-btn" onClick={() => onDecide(l.id, "rejected")}>
                                  Reject
                                </button>
                              </div>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {tab === "rota" && (
            <RotaBoard
              token={token}
              weekStart={weekStart}
              onWeekStartChange={setWeekStart}
              employees={employees}
              rota={rota}
              shiftTypes={shiftTypes}
              onChanged={refresh}
              onError={showError}
            />
          )}

          {tab === "messages" && (
            <section className="stack">
              <form className="panel" onSubmit={onBroadcast}>
                <div className="panel-head">
                  <div>
                    <h2>Broadcast</h2>
                    <p className="muted">Send one message to all employees.</p>
                  </div>
                </div>
                <div className="compose">
                  <input
                    value={broadcast}
                    onChange={(e) => setBroadcast(e.target.value)}
                    placeholder="Broadcast message…"
                  />
                  <button type="submit" className="btn primary" disabled={!broadcast.trim()}>
                    Send all
                  </button>
                </div>
              </form>

              <div className="inbox-grid">
                <div className="panel inbox-list">
                  <div className="panel-head">
                    <div>
                      <h2>Inbox</h2>
                      <p className="muted">Select a staff member</p>
                    </div>
                  </div>
                  <label className="field" style={{ marginBottom: 12 }}>
                    Open chat
                    <select
                      value={activeEmpId}
                      onChange={(e) => setActiveEmpId(e.target.value)}
                    >
                      <option value="">Choose employee…</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.full_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {threads.length === 0 ? (
                    <p className="muted">No conversations yet.</p>
                  ) : (
                    <div className="thread-list">
                      {threads.map((t) => (
                        <button
                          key={t.employee_id}
                          type="button"
                          className={activeEmpId === t.employee_id ? "thread-item active" : "thread-item"}
                          onClick={() => setActiveEmpId(t.employee_id)}
                        >
                          <strong>{t.employee_name}</strong>
                          <span>{t.last_text}</span>
                          {t.unread_count > 0 && <em>{t.unread_count}</em>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="panel messages-panel">
                  <div className="panel-head">
                    <div>
                      <h2>{activeEmpId ? employees.find((e) => e.id === activeEmpId)?.full_name || "Chat" : "Chat"}</h2>
                      <p className="muted">Reply to this employee</p>
                    </div>
                  </div>
                  <div className="thread">
                    {!activeEmpId ? (
                      <div className="empty-state">
                        <h3>Select an employee</h3>
                      </div>
                    ) : thread.length === 0 ? (
                      <div className="empty-state">
                        <h3>No messages yet</h3>
                        <p>Send the first message below.</p>
                      </div>
                    ) : (
                      thread.map((m) => (
                        <div key={m.id} className={`bubble ${m.from_me ? "me" : "them"}`}>
                          <div className="bubble-meta">
                            <strong>{m.from_me ? "Manager" : "Employee"}</strong>
                            <span>{fmtTime(m.created_at)}</span>
                          </div>
                          <p>{m.text}</p>
                        </div>
                      ))
                    )}
                  </div>
                  <form className="compose" onSubmit={onReply}>
                    <input
                      value={msgText}
                      onChange={(e) => setMsgText(e.target.value)}
                      placeholder="Write a reply…"
                      disabled={!activeEmpId}
                    />
                    <button type="submit" className="btn primary" disabled={!activeEmpId || !msgText.trim()}>
                      Send
                    </button>
                  </form>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>

      <nav className="mobile-nav manager">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? "active" : ""}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
