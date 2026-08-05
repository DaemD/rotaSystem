const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

async function request<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type ShiftTypeCode = "regular" | "sleep" | "waking_night" | "annual_leave" | "sick";

export type Employee = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  contract_type: string;
  max_weekly_hours: number;
  active?: boolean;
};

export type ShiftType = {
  id: string;
  code: ShiftTypeCode;
  display_name: string;
  default_start: string | null;
  default_end: string | null;
  counts_as_worked_hours: boolean;
};

export type ScheduledShift = {
  id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  shift_type: ShiftType;
  employee_id?: string | null;
  employee_name?: string | null;
};

export type ClockEvent = {
  id: string;
  shift_type: ShiftType;
  clock_in_at: string;
  clock_out_at: string | null;
  lateness_minutes: number;
  scheduled_shift_id: string | null;
  employee_id?: string | null;
  employee_name?: string | null;
  admin_override?: boolean;
  override_reason?: string | null;
};

export type WeeklySummary = {
  week_start: string;
  week_end: string;
  hours_worked: number;
  shifts_completed: number;
  currently_clocked_in: boolean;
  open_clock_event: ClockEvent | null;
  scheduled_this_week: number;
  leave_days_pending: number;
};

export type LeaveRecord = {
  id: string;
  leave_type: "annual_leave" | "sick";
  start_date: string;
  end_date: string;
  status: string;
  note: string | null;
  created_at: string;
  employee_id?: string | null;
  employee_name?: string | null;
};

export type Message = {
  id: string;
  sender_id: string;
  recipient_id: string;
  text: string;
  read: boolean;
  created_at: string;
  from_me: boolean;
};

export type Overview = {
  range_days: number;
  employees_active: number;
  currently_clocked_in: number;
  hours_worked: number;
  shifts_completed: number;
  late_events: number;
  pending_leave: number;
  sick_requests: number;
  annual_leave_requests: number;
};

export type MessageThread = {
  employee_id: string;
  employee_name: string;
  last_text: string;
  last_at: string;
  unread_count: number;
};

export async function register(body: {
  email: string;
  password: string;
  full_name: string;
  role: "employee" | "manager";
}) {
  return request<Employee>("/auth/register", { method: "POST", body: JSON.stringify(body) });
}

export async function login(email: string, password: string) {
  const data = await request<{ access_token: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return data.access_token;
}

export const getMe = (token: string) => request<Employee>("/me", {}, token);
export const getSummary = (token: string) => request<WeeklySummary>("/me/summary", {}, token);
export const getSchedule = (token: string) => request<ScheduledShift[]>("/me/shifts", {}, token);
export const getLeave = (token: string) => request<LeaveRecord[]>("/me/leave", {}, token);
export const getMessages = (token: string) => request<Message[]>("/me/messages", {}, token);
export const getShiftTypes = (token: string) => request<ShiftType[]>("/shift-types", {}, token);

export const clockIn = (token: string, shift_type: ShiftTypeCode) =>
  request<ClockEvent>("/shifts/clock-in", { method: "POST", body: JSON.stringify({ shift_type }) }, token);

export const clockOut = (token: string) =>
  request<ClockEvent>("/shifts/clock-out", { method: "POST", body: "{}" }, token);

export const requestLeave = (
  token: string,
  body: { leave_type: "annual_leave" | "sick"; start_date: string; end_date: string; note?: string },
) => request<LeaveRecord>("/me/leave", { method: "POST", body: JSON.stringify(body) }, token);

export const sendMessage = (token: string, text: string) =>
  request<Message>("/me/messages", { method: "POST", body: JSON.stringify({ text }) }, token);

// Manager
export const getOverview = (token: string, rangeDays = 7) =>
  request<Overview>(`/admin/overview?range_days=${rangeDays}`, {}, token);
export const getLive = (token: string) => request<ClockEvent[]>("/admin/live", {}, token);
export const getEmployees = (token: string) => request<Employee[]>("/admin/employees", {}, token);
export const getAdminLeave = (token: string, status?: string) =>
  request<LeaveRecord[]>(`/admin/leave${status ? `?status=${status}` : ""}`, {}, token);
export const decideLeave = (token: string, id: string, status: "approved" | "rejected") =>
  request<LeaveRecord>(`/admin/leave/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }, token);
export const getRota = (token: string, weekStart?: string) =>
  request<ScheduledShift[]>(`/admin/rota${weekStart ? `?week_start=${weekStart}` : ""}`, {}, token);
export const createRotaShift = (
  token: string,
  body: {
    employee_id: string;
    shift_date: string;
    shift_type: ShiftTypeCode;
    start_time?: string;
    end_time?: string;
  },
) => request<ScheduledShift>("/admin/rota/shifts", { method: "POST", body: JSON.stringify(body) }, token);
export const deleteRotaShift = (token: string, id: string) =>
  request<void>(`/admin/rota/shifts/${id}`, { method: "DELETE" }, token);
export const getMessageThreads = (token: string) =>
  request<MessageThread[]>("/admin/messages/threads", {}, token);
export const getAdminThread = (token: string, employeeId: string) =>
  request<Message[]>(`/admin/messages/${employeeId}`, {}, token);
export const replyToEmployee = (token: string, employeeId: string, text: string) =>
  request<Message>(`/admin/messages/${employeeId}`, { method: "POST", body: JSON.stringify({ text }) }, token);
export const broadcastMessage = (token: string, text: string) =>
  request<{ sent: number }>("/admin/messages/broadcast", { method: "POST", body: JSON.stringify({ text }) }, token);
export const adminClockOut = (token: string, employeeId: string, reason: string) =>
  request<ClockEvent>(
    `/admin/employees/${employeeId}/clock-out`,
    { method: "POST", body: JSON.stringify({ reason }) },
    token,
  );
