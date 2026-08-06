import { useEffect, useMemo, useRef, useState } from "react";
import {
  deleteRotaShift,
  updateEmployeeHours,
  upsertRotaShift,
  type Employee,
  type ScheduledShift,
  type ShiftType,
  type ShiftTypeCode,
} from "./api";
import { fmtDate, initials } from "./utils";

type Props = {
  token: string;
  weekStart: string;
  onWeekStartChange: (v: string) => void;
  employees: Employee[];
  rota: ScheduledShift[];
  shiftTypes: ShiftType[];
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
};

function addDays(ymd: string, n: number) {
  const d = new Date(ymd + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function hourLabel(h: number) {
  return `${String(h).padStart(2, "0")}:00`;
}

function parseHour(t: string) {
  return Number(t.slice(0, 2));
}

function hourCovered(h: number, start: string, end: string) {
  const s = parseHour(start);
  const endH = end.startsWith("23:59") ? 24 : parseHour(end);
  if (s === endH) return true;
  if (s < endH) return h >= s && h < endH;
  // overnight e.g. 21:00 -> 07:00
  return h >= s || h < endH;
}

function rangeFromHours(hours: number[]) {
  const sorted = [...new Set(hours)].sort((a, b) => a - b);
  if (!sorted.length) return null;

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > 1) gaps.push(i);
  }

  // Overnight: exactly one gap between evening hours and morning hours
  if (gaps.length === 1) {
    const gi = gaps[0];
    const morning = sorted.slice(0, gi);
    const evening = sorted.slice(gi);
    if (morning.length && evening.length && morning[morning.length - 1] < 12 && evening[0] >= 12) {
      const startH = evening[0];
      const endH = morning[morning.length - 1] + 1;
      return {
        start: `${hourLabel(startH)}:00`,
        end: endH >= 24 ? "23:59:00" : `${hourLabel(endH)}:00`,
      };
    }
  }

  // Day block: fill any mid-day holes so we keep one contiguous shift
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const endHour = max + 1;
  return {
    start: `${hourLabel(min)}:00`,
    end: endHour >= 24 ? "23:59:00" : `${hourLabel(endHour)}:00`,
  };
}

function hoursInRange(start: string, end: string) {
  const out: number[] = [];
  for (let h = 0; h < 24; h++) {
    if (hourCovered(h, start, end)) out.push(h);
  }
  return out;
}

const TYPE_COLOR: Record<string, string> = {
  regular: "#1f6feb",
  sleep: "#7c3aed",
  waking_night: "#db2777",
};

export default function RotaBoard({
  token,
  weekStart,
  onWeekStartChange,
  employees,
  rota,
  shiftTypes,
  onChanged,
  onError,
}: Props) {
  const clockable = useMemo(
    () => shiftTypes.filter((t) => t.code !== "annual_leave" && t.code !== "sick"),
    [shiftTypes],
  );
  const [employeeId, setEmployeeId] = useState(employees[0]?.id || "");
  const [shiftType, setShiftType] = useState<ShiftTypeCode>("regular");
  const [gridStart, setGridStart] = useState(0);
  const [gridEnd, setGridEnd] = useState(24);
  const [busy, setBusy] = useState(false);
  const dragRef = useRef<{ day: string; hours: number[] } | null>(null);
  const finishingRef = useRef(false);
  const [draft, setDraft] = useState<{ day: string; hours: number[] } | null>(null);
  // Keep latest finish handler for the window mouseup listener
  const finishDragRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!employees.length) {
      setEmployeeId("");
      return;
    }
    if (!employeeId || !employees.some((e) => e.id === employeeId)) {
      setEmployeeId(employees[0].id);
    }
  }, [employees, employeeId]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const hours = useMemo(() => {
    const list: number[] = [];
    const end = Math.max(gridStart + 1, gridEnd);
    for (let h = gridStart; h < end; h++) list.push(h);
    return list;
  }, [gridStart, gridEnd]);

  const selected = employees.find((e) => e.id === employeeId) || null;
  const selectedType = clockable.find((t) => t.code === shiftType);

  const workStart = (selected?.work_start || "09:00").slice(0, 5);
  const workEnd = (selected?.work_end || "17:00").slice(0, 5);

  async function saveHours(start: string, end: string) {
    if (!selected || !start || !end) return;
    try {
      await updateEmployeeHours(token, selected.id, { work_start: start, work_end: end });
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save working hours");
    }
  }

  async function applyDayHours(day: string, hourList: number[], type = shiftType) {
    if (!employeeId || !hourList.length) return;
    const range = rangeFromHours(hourList);
    if (!range) return;
    setBusy(true);
    try {
      await upsertRotaShift(token, {
        employee_id: employeeId,
        shift_date: day,
        shift_type: type,
        start_time: range.start,
        end_time: range.end,
      });
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save shift");
    } finally {
      setBusy(false);
    }
  }

  async function clearDay(day: string) {
    if (!employeeId) return;
    const existing = rota.find((r) => r.employee_id === employeeId && r.shift_date === day);
    if (!existing) return;
    setBusy(true);
    try {
      await deleteRotaShift(token, existing.id);
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not clear day");
    } finally {
      setBusy(false);
    }
  }

  async function fillDay(day: string) {
    if (!employeeId) return;
    let start = workStart;
    let end = workEnd;
    if (shiftType !== "regular" && selectedType?.default_start && selectedType?.default_end) {
      start = selectedType.default_start.slice(0, 5);
      end = selectedType.default_end.slice(0, 5);
    }
    if (!start || !end) {
      onError("Set working hours (or pick Sleep / Waking Night) before filling a day");
      return;
    }

    const hs = hoursInRange(`${start}:00`, `${end}:00`);
    if (!hs.length) {
      onError("Fill range produced no hours — check work from / work to");
      return;
    }

    // Expand grid so overnight fills are visible
    const minH = Math.min(...hs);
    const maxH = Math.max(...hs);
    if (minH < gridStart) setGridStart(minH);
    if (maxH + 1 > gridEnd) setGridEnd(Math.min(24, maxH + 1));

    const existing = rota.find((r) => r.employee_id === employeeId && r.shift_date === day);
    setBusy(true);
    try {
      // Fill always replaces whatever is on that day for this employee
      if (existing && existing.shift_type.code !== shiftType) {
        await deleteRotaShift(token, existing.id);
      }
      const range = rangeFromHours(hs);
      if (!range) return;
      await upsertRotaShift(token, {
        employee_id: employeeId,
        shift_date: day,
        shift_type: shiftType,
        start_time: range.start,
        end_time: range.end,
      });
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not fill day");
    } finally {
      setBusy(false);
    }
  }

  function cellPeople(day: string, hour: number) {
    return rota.filter(
      (r) => r.shift_date === day && hourCovered(hour, r.start_time, r.end_time),
    );
  }

  function selectedExisting(day: string) {
    return rota.find((r) => r.employee_id === employeeId && r.shift_date === day) || null;
  }

  function isSelectedCovered(day: string, hour: number) {
    if (draft && draft.day === day && draft.hours.includes(hour)) return true;
    const existing = selectedExisting(day);
    if (!existing) return false;
    return hourCovered(hour, existing.start_time, existing.end_time);
  }

  function cellColor(day: string) {
    if (draft && draft.day === day) return TYPE_COLOR[shiftType] || "#1f6feb";
    const existing = selectedExisting(day);
    if (existing) return TYPE_COLOR[existing.shift_type.code] || "#1f6feb";
    return TYPE_COLOR[shiftType] || "#1f6feb";
  }

  function onPointerDown(day: string, hour: number) {
    if (!employeeId || busy) return;
    dragRef.current = { day, hours: [hour] };
    setDraft({ day, hours: [hour] });
  }

  function onPointerEnter(day: string, hour: number) {
    if (!dragRef.current || dragRef.current.day !== day) return;
    const start = dragRef.current.hours[0];
    const lo = Math.min(start, hour);
    const hi = Math.max(start, hour);
    const hoursSel: number[] = [];
    for (let h = lo; h <= hi; h++) hoursSel.push(h);
    dragRef.current = { day, hours: hoursSel };
    setDraft({ day, hours: hoursSel });
  }

  async function finishDrag() {
    if (!dragRef.current || finishingRef.current || busy) return;
    const { day, hours: hs } = dragRef.current;
    dragRef.current = null;
    setDraft(null);
    finishingRef.current = true;

    try {
      const existing = selectedExisting(day);

      // Single click on an already-filled hour clears the whole day
      if (hs.length === 1 && existing && hourCovered(hs[0], existing.start_time, existing.end_time)) {
        await clearDay(day);
        return;
      }

      if (existing && existing.shift_type.code !== shiftType) {
        onError(
          `${selected?.full_name || "Employee"} already has ${existing.shift_type.display_name} on ${fmtDate(day)}. Use Clear first, or Fill day to replace.`,
        );
        return;
      }

      // Merge with existing same-type hours so dragging can extend a block
      let merged = [...hs];
      if (existing) {
        merged = [...new Set([...hoursInRange(existing.start_time, existing.end_time), ...hs])];
      }
      await applyDayHours(day, merged);
    } finally {
      finishingRef.current = false;
    }
  }

  finishDragRef.current = () => {
    void finishDrag();
  };

  useEffect(() => {
    function onUp() {
      finishDragRef.current();
    }
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  return (
    <section className="stack">
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Weekly timetable</h2>
            <p className="muted">
              Select a person, paint hour boxes, or fill a whole day. One shift type per person per day.
            </p>
          </div>
          <label className="field inline">
            Week start (Mon)
            <input type="date" value={weekStart} onChange={(e) => onWeekStartChange(e.target.value)} />
          </label>
        </div>

        <div className="rota-toolbar">
          <label className="field">
            Employee
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Shift type
            <select value={shiftType} onChange={(e) => setShiftType(e.target.value as ShiftTypeCode)}>
              {clockable.map((t) => (
                <option key={t.id} value={t.code}>
                  {t.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Work from
            <input
              type="time"
              value={workStart}
              onChange={(e) => saveHours(e.target.value, workEnd)}
              disabled={!selected || busy}
            />
          </label>
          <label className="field">
            Work to
            <input
              type="time"
              value={workEnd}
              onChange={(e) => saveHours(workStart, e.target.value)}
              disabled={!selected || busy}
            />
          </label>
          <label className="field">
            Grid start
            <select
              value={gridStart}
              onChange={(e) => {
                const v = Number(e.target.value);
                setGridStart(v);
                if (v >= gridEnd) setGridEnd(Math.min(24, v + 1));
              }}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Grid end
            <select
              value={gridEnd}
              onChange={(e) => {
                const v = Number(e.target.value);
                setGridEnd(v);
                if (v <= gridStart) setGridStart(Math.max(0, v - 1));
              }}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h + 1} value={h + 1}>
                  {hourLabel(h + 1 === 24 ? 0 : h + 1)}
                  {h + 1 === 24 ? " (midnight)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!employees.length ? (
          <div className="empty-state">
            <h3>No employees</h3>
            <p>Create staff accounts first.</p>
          </div>
        ) : (
          <div className="rota-board-wrap">
            <table className="rota-board">
              <thead>
                <tr>
                  <th className="sticky-col">Time</th>
                  {days.map((day) => (
                    <th key={day}>
                      <div className="day-head">
                        <span>{fmtDate(day)}</span>
                        <div className="day-actions">
                          <button
                            type="button"
                            className="btn sm-btn primary"
                            disabled={busy || !employeeId}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => void fillDay(day)}
                          >
                            Fill day
                          </button>
                          <button
                            type="button"
                            className="btn sm-btn danger"
                            disabled={busy || !employeeId || !selectedExisting(day)}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => void clearDay(day)}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hours.map((hour) => (
                  <tr key={hour}>
                    <th className="sticky-col">{hourLabel(hour)}</th>
                    {days.map((day) => {
                      const people = cellPeople(day, hour);
                      const mine = isSelectedCovered(day, hour);
                      const color = cellColor(day);
                      return (
                        <td
                          key={`${day}-${hour}`}
                          className={`rota-cell ${mine ? "mine" : ""} ${people.length ? "has-people" : ""}`}
                          style={mine ? { background: color + "33", boxShadow: `inset 0 0 0 2px ${color}` } : undefined}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            onPointerDown(day, hour);
                          }}
                          onMouseEnter={() => onPointerEnter(day, hour)}
                        >
                          <div className="cell-people">
                            {people.slice(0, 3).map((p) => (
                              <span
                                key={p.id}
                                className={`chip ${p.employee_id === employeeId ? "active" : ""}`}
                                title={`${p.employee_name} · ${p.shift_type.display_name}`}
                                style={{
                                  background: (TYPE_COLOR[p.shift_type.code] || "#64748b") + "22",
                                  color: TYPE_COLOR[p.shift_type.code] || "#334155",
                                }}
                              >
                                {initials(p.employee_name || "?")}
                              </span>
                            ))}
                            {people.length > 3 && <span className="chip more">+{people.length - 3}</span>}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="rota-legend">
          {clockable.map((t) => (
            <span key={t.id} className="legend-item">
              <i style={{ background: TYPE_COLOR[t.code] || "#64748b" }} />
              {t.display_name}
            </span>
          ))}
          <span className="muted">
            Tip: drag to paint / extend. Click a filled hour to clear that day. Fill day replaces the shift.
          </span>
        </div>
      </div>
    </section>
  );
}
