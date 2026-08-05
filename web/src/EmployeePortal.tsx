import { useEffect, useMemo, useState } from "react";
import {
  clockIn,
  clockOut,
  getLeave,
  getMessages,
  getSchedule,
  getShiftTypes,
  getSummary,
  requestLeave,
  sendMessage,
  type ClockEvent,
  type Employee,
  type LeaveRecord,
  type Message,
  type ScheduledShift,
  type ShiftType,
  type ShiftTypeCode,
  type WeeklySummary,
} from "./api";
import { fmtDate, fmtTime, initials, statusClass } from "./utils";

type Tab = "home" | "schedule" | "leave" | "messages";

const NAV: { id: Tab; label: string; desc: string }[] = [
  { id: "home", label: "Attendance", desc: "Clock in and weekly summary" },
  { id: "schedule", label: "My schedule", desc: "Shifts for this week" },
  { id: "leave", label: "Leave", desc: "Request and track leave" },
  { id: "messages", label: "Messages", desc: "Chat with your manager" },
];

type Props = {
  token: string;
  me: Employee;
  onLogout: () => void;
};

export default function EmployeePortal({ token, me, onLogout }: Props) {
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("home");
  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [schedule, setSchedule] = useState<ScheduledShift[]>([]);
  const [leave, setLeave] = useState<LeaveRecord[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [shiftType, setShiftType] = useState<ShiftTypeCode | "">("");
  const [msgText, setMsgText] = useState("");
  const [leaveForm, setLeaveForm] = useState({
    leave_type: "annual_leave" as "annual_leave" | "sick",
    start_date: "",
    end_date: "",
    note: "",
  });

  const clockedIn = summary?.currently_clocked_in ?? false;
  const clockableTypes = useMemo(
    () => shiftTypes.filter((t) => t.code !== "annual_leave" && t.code !== "sick"),
    [shiftTypes],
  );
  const activeNav = NAV.find((n) => n.id === tab)!;

  async function refresh() {
    const [s, sch, lv, msgs, types] = await Promise.all([
      getSummary(token),
      getSchedule(token),
      getLeave(token),
      getMessages(token).catch(() => [] as Message[]),
      getShiftTypes(token),
    ]);
    setSummary(s);
    setSchedule(sch);
    setLeave(lv);
    setMessages(msgs);
    setShiftTypes(types);
    setShiftType((prev) => {
      if (prev && types.some((t) => t.code === prev)) return prev;
      return types.find((t) => t.code !== "annual_leave" && t.code !== "sick")?.code ?? "";
    });
  }

  useEffect(() => {
    refresh().catch((e) => setError(String(e.message || e)));
  }, [token]);

  async function onClock() {
    if (!shiftType) return;
    setError("");
    try {
      if (clockedIn) await clockOut(token);
      else await clockIn(token, shiftType);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clock action failed");
    }
  }

  async function onLeave(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await requestLeave(token, leaveForm);
      setLeaveForm({ leave_type: "annual_leave", start_date: "", end_date: "", note: "" });
      await refresh();
      setTab("leave");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Leave request failed");
    }
  }

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (!msgText.trim()) return;
    try {
      await sendMessage(token, msgText.trim());
      setMsgText("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    }
  }

  const openEv: ClockEvent | null | undefined = summary?.open_clock_event;
  const weekLabel = summary ? `${fmtDate(summary.week_start)} – ${fmtDate(summary.week_end)}` : "";

  return (
    <div className="crm">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark sm">SC</div>
          <div>
            <strong>Supreme</strong>
            <span>Employee portal</span>
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
            <p className="kicker">Employee workspace</p>
            <h1>{activeNav.label}</h1>
            <p className="muted">{activeNav.desc}</p>
          </div>
          <span className={`status-chip ${clockedIn ? "on" : ""}`}>
            <span className="status-dot" />
            {clockedIn ? "Currently clocked in" : "Not clocked in"}
          </span>
        </header>

        {error && <div className="alert error page-alert">{error}</div>}

        <div className="content">
          {tab === "home" && summary && (
            <section className="stack">
              <div className="kpi-row">
                <article className="kpi">
                  <span className="kpi-label">Hours this week</span>
                  <strong className="kpi-value">{summary.hours_worked}</strong>
                  <span className="kpi-meta">{weekLabel}</span>
                </article>
                <article className="kpi">
                  <span className="kpi-label">Shifts completed</span>
                  <strong className="kpi-value">{summary.shifts_completed}</strong>
                  <span className="kpi-meta">{summary.scheduled_this_week} scheduled</span>
                </article>
                <article className="kpi">
                  <span className="kpi-label">Leave pending</span>
                  <strong className="kpi-value">{summary.leave_days_pending}</strong>
                  <span className="kpi-meta">Awaiting manager</span>
                </article>
              </div>

              <div className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Attendance control</h2>
                    <p className="muted">Clock against your published shift types.</p>
                  </div>
                  <span className={`badge ${clockedIn ? "ok" : "neutral"}`}>
                    {clockedIn ? "Active shift" : "Idle"}
                  </span>
                </div>
                <div className="attendance-grid">
                  <div>
                    <p className="field-label">Current status</p>
                    <p className="attendance-time">{clockedIn ? fmtTime(openEv?.clock_in_at ?? null) : "—"}</p>
                    {clockedIn && openEv ? (
                      <p className="muted">
                        {openEv.shift_type.display_name}
                        {openEv.lateness_minutes > 0 ? ` · ${openEv.lateness_minutes} min late` : " · on time"}
                      </p>
                    ) : (
                      <p className="muted">Select a shift type, then clock in.</p>
                    )}
                  </div>
                  <div className="attendance-actions">
                    {!clockedIn && (
                      <label className="field">
                        Shift type
                        <select
                          value={shiftType}
                          onChange={(e) => setShiftType(e.target.value as ShiftTypeCode)}
                          disabled={clockableTypes.length === 0}
                        >
                          {clockableTypes.length === 0 ? (
                            <option value="">No shift types</option>
                          ) : (
                            clockableTypes.map((o) => (
                              <option key={o.id} value={o.code}>
                                {o.display_name}
                              </option>
                            ))
                          )}
                        </select>
                      </label>
                    )}
                    <button
                      className={`btn block ${clockedIn ? "danger" : "primary"}`}
                      onClick={onClock}
                      type="button"
                      disabled={!clockedIn && !shiftType}
                    >
                      {clockedIn ? "Clock out" : "Clock in"}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {tab === "schedule" && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Weekly schedule</h2>
                  <p className="muted">{weekLabel || "This week"} · your shifts only</p>
                </div>
              </div>
              {schedule.length === 0 ? (
                <div className="empty-state">
                  <h3>No shifts this week</h3>
                  <p>When a manager publishes the rota, your shifts will appear here.</p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Start</th>
                        <th>End</th>
                        <th>Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schedule.map((s) => (
                        <tr key={s.id}>
                          <td>{fmtDate(s.shift_date)}</td>
                          <td>{s.start_time.slice(0, 5)}</td>
                          <td>{s.end_time.slice(0, 5)}</td>
                          <td>
                            <span className="badge neutral">{s.shift_type.display_name}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {tab === "leave" && (
            <section className="split">
              <form className="panel" onSubmit={onLeave}>
                <div className="panel-head">
                  <div>
                    <h2>New leave request</h2>
                    <p className="muted">Submit annual leave or sick leave.</p>
                  </div>
                </div>
                <div className="form-grid">
                  <label className="field">
                    Type
                    <select
                      value={leaveForm.leave_type}
                      onChange={(e) =>
                        setLeaveForm((f) => ({
                          ...f,
                          leave_type: e.target.value as "annual_leave" | "sick",
                        }))
                      }
                    >
                      <option value="annual_leave">Annual leave</option>
                      <option value="sick">Sick</option>
                    </select>
                  </label>
                  <div className="field-row">
                    <label className="field">
                      From
                      <input
                        type="date"
                        required
                        value={leaveForm.start_date}
                        onChange={(e) => setLeaveForm((f) => ({ ...f, start_date: e.target.value }))}
                      />
                    </label>
                    <label className="field">
                      To
                      <input
                        type="date"
                        required
                        value={leaveForm.end_date}
                        onChange={(e) => setLeaveForm((f) => ({ ...f, end_date: e.target.value }))}
                      />
                    </label>
                  </div>
                  <label className="field">
                    Note
                    <input
                      value={leaveForm.note}
                      onChange={(e) => setLeaveForm((f) => ({ ...f, note: e.target.value }))}
                      placeholder="Optional"
                    />
                  </label>
                  <button type="submit" className="btn primary">
                    Submit request
                  </button>
                </div>
              </form>
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Request history</h2>
                    <p className="muted">From the database</p>
                  </div>
                </div>
                {leave.length === 0 ? (
                  <div className="empty-state">
                    <h3>No requests yet</h3>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>From</th>
                          <th>To</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leave.map((l) => (
                          <tr key={l.id}>
                            <td className="cap">{l.leave_type.replace("_", " ")}</td>
                            <td>{fmtDate(l.start_date)}</td>
                            <td>{fmtDate(l.end_date)}</td>
                            <td>
                              <span className={statusClass(l.status)}>{l.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          )}

          {tab === "messages" && (
            <section className="panel messages-panel">
              <div className="panel-head">
                <div>
                  <h2>Manager conversation</h2>
                  <p className="muted">Direct messages with your site manager.</p>
                </div>
              </div>
              <div className="thread">
                {messages.length === 0 ? (
                  <div className="empty-state">
                    <h3>No messages</h3>
                  </div>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={`bubble ${m.from_me ? "me" : "them"}`}>
                      <div className="bubble-meta">
                        <strong>{m.from_me ? "You" : "Manager"}</strong>
                        <span>{fmtTime(m.created_at)}</span>
                      </div>
                      <p>{m.text}</p>
                    </div>
                  ))
                )}
              </div>
              <form className="compose" onSubmit={onSend}>
                <input
                  value={msgText}
                  onChange={(e) => setMsgText(e.target.value)}
                  placeholder="Write a message…"
                />
                <button type="submit" className="btn primary" disabled={!msgText.trim()}>
                  Send
                </button>
              </form>
            </section>
          )}
        </div>
      </div>

      <nav className="mobile-nav">
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
