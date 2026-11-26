import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Inbox,
  CalendarDays,
  CalendarRange,
  FolderOpen,
  Lightbulb,
  Archive,
  Settings,
  Plus,
  Search,
  X,
  Check,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Leaf,
  RefreshCw,
  ExternalLink,
  Download,
  Pencil,
  History,
  RotateCcw,
  ListPlus,
  Menu,
  FilePlus2,
  ArrowRight,
} from "lucide-react";
import "./styles.css";
import { TaskRow, preciseSchedule, type TaskRowContext } from "./task-row";
import { fmt } from "./workspace-ui";
import {
  DatePicker,
  ActionMenu,
  DialogSurface,
  Disclosure,
  IconButton,
} from "./ui";
import {
  HabitDayRows,
  HabitWeek,
  HabitManager,
  type HabitBoard,
} from "./habits";
import {
  ReflectionEditor,
  ReflectionPage,
  ReflectionTemplates,
} from "./reflections";
import { PlanningPanel, LargePeriodToolbar } from "./period-plans";
import {
  groupWeeklyRows,
  omitWeeklyProjects,
  type WeeklyNode,
} from "./weekly-tree";

export type Item = {
  id: string;
  title: string;
  kind: "task" | "project" | "idea";
  status: "open" | "done" | "graveyard";
  parent: string | null;
  capture: string | null;
  areas: number[];
  comment: string;
  result_comment: string;
  deadline: string | null;
  available_from: string | null;
  location: string;
  tags: string[];
  estimated_minutes: number | null;
  created_at: string;
  title_changed_at: string;
  completed_at: string | null;
  has_week_commitment: boolean;
  schedule: {
    period: "day" | "week" | "month" | "quarter";
    date: string;
    inherited: boolean;
  }[];
  stale: boolean;
  no_next_step: boolean;
};

const compareCompletion = (a: Item, b: Item) =>
  Number(a.status === "done") - Number(b.status === "done");

type Capture = { id: string; text: string; status: string; results: string[] };
export type Entry = {
  id: string;
  item: string;
  item_detail: Item;
  active: boolean;
  outcome: string;
  date: string;
  section: string;
  checked: boolean;
  position: number;
};
type WeekRow = {
  contextOnly?: boolean;
  item: Item;
  scheduled_day: string | null;
  direct: boolean;
  inherited: boolean;
  active: boolean;
  entry_id: string | null;
  outcome: string;
  reason: string;
};
type CalEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  done: boolean;
  url: string;
  calendar_id: string;
};
export type Board = {
  today: string;
  week: string;
  areas: { id: number; name: string; color: string }[];
  captures: Capture[];
  items: Item[];
  inbox_ids: string[];
  day_sections: string[];
  day_entries: Entry[];
  week_rows: WeekRow[];
  events: CalEvent[];
  google: {
    configured: boolean;
    connected: boolean;
    calendars: { id: string; name: string }[];
    selected: string[];
    last_sync: string | null;
    last_error: string;
  };
};
let csrf = "";
async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch("/api/" + path, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(method !== "GET" ? { "X-CSRFToken": csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r
    .json()
    .catch(() => ({ detail: "Сервер недоступен. Попробуй ещё раз." }));
  if (!r.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : Object.entries(data)
            .map(
              ([k, v]) =>
                `${({ reason: "Причина", title: "Название дела", section: "Секция", deadline: "Дедлайн", non_field_errors: "Ошибка" } as Record<string, string>)[k] || k}: ${Array.isArray(v) ? v.join(", ") : v}`,
            )
            .join("\n"),
    );
  return data;
}
const addDays = (value: string, n: number) => {
  const d = new Date(value + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const timeFmt = (value: string) =>
  new Date(value).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  });
const eventInDay = (e: CalEvent, day: string) => {
  const start = new Date(
    day + (e.all_day ? "T00:00:00+03:00" : "T05:00:00+03:00"),
  ).getTime();
  return (
    new Date(e.start).getTime() < start + 86400000 &&
    new Date(e.end).getTime() > start
  );
};
const kindLabel = { task: "Задача", project: "Проект", idea: "Идея" };
const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});

function App() {
  const query = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      const d = await api("session/");
      csrf = d.csrf;
      return d;
    },
  });
  if (query.isPending)
    return (
      <div className="loading">
        <Leaf /> Собираем пространство…
      </div>
    );
  if (query.isError && !query.data)
    return (
      <div className="loading">
        Не удалось связаться с сервером.{" "}
        <button onClick={() => query.refetch()}>Повторить</button>
      </div>
    );
  if (!query.data.authenticated)
    return <Login onDone={() => query.refetch()} />;
  return <Workspace session={query.data} />;
}
function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const d = await api("login/", "POST", { username, password });
            csrf = d.csrf;
            onDone();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="brand">
          <span className="brand-icon">
            <Leaf size={20} />
          </span>
          опора<span className="brand-dot">.</span>
        </div>
        <h1>Войти в Опору</h1>
        <label>
          Имя пользователя
          <input
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label>
          Пароль
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Входим…" : "Войти"}
        </button>
      </form>
    </div>
  );
}

type Page =
  | "inbox"
  | "day"
  | "week"
  | "month"
  | "quarter"
  | "habits"
  | "reflections"
  | "projects"
  | "ideas"
  | "graveyard"
  | "settings";
function Workspace({ session }: { session: any }) {
  const client = useQueryClient();
  const [page, setPage] = useState<Page>("day"),
    [date, setDate] = useState(session.today),
    [search, setSearch] = useState(""),
    [area, setArea] = useState<number | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const contexts = useRef<
    Partial<
      Record<Page, { search: string; area: number | null; scroll: number }>
    >
  >({});
  const [moreOpen, setMoreOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [picker, setPicker] = useState<"day" | "week" | null>(null);
  const [undo, setUndo] = useState<(() => Promise<void>) | null>(null);
  function navigate(next: Page) {
    contexts.current[page] = { search, area, scroll: window.scrollY };
    setSearch(contexts.current[next]?.search || "");
    setArea(contexts.current[next]?.area || null);
    setPage(next);
    setFiltersOpen(false);
    setMoreOpen(false);
  }
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      window.scrollTo({ top: contexts.current[page]?.scroll || 0 }),
    );
    return () => cancelAnimationFrame(frame);
  }, [page]);
  const [editor, setEditor] = useState<{
      item?: Item;
      parent?: string;
      capture?: string;
      kind?: Item["kind"];
      plannedDay?: string;
      plannedWeek?: string;
      proposal?: { period: "month" | "quarter"; date: string };
      areas?: number[];
      plannedSection?: string;
    } | null>(null),
    [detail, setDetail] = useState<Item | null>(null),
    [quick, setQuick] = useState(""),
    [notice, setNotice] = useState("");
  const [decision, setDecision] = useState<{
      item?: Item;
      entry?: string;
      status?: string;
      title: string;
      reason: boolean;
    } | null>(null),
    [reason, setReason] = useState(""),
    [result, setResult] = useState("");
  const [schedule, setSchedule] = useState<Item | null>(null),
    [scheduleDate, setScheduleDate] = useState(date),
    [period, setPeriod] = useState("day"),
    [section, setSection] = useState("");
  const [weekProject, setWeekProject] = useState<Item | null>(null);
  const [closure, setClosure] = useState<Item | null>(null);
  const query = useQuery<Board>({
    queryKey: ["board", date],
    queryFn: () => api("board/?date=" + date),
    refetchInterval: 60000,
  });
  const habitsQuery = useQuery<HabitBoard>({
    queryKey: ["habit-board", date],
    queryFn: () => api("habit-board/?date=" + date),
    refetchInterval: 60000,
  });
  const habits = habitsQuery.data?.habits || [];
  const b = query.data;
  async function mutate(path: string, body?: unknown, method = "POST") {
    setError("");
    setBusy(true);
    try {
      const r = await api(path, method, body);
      await client.invalidateQueries({ queryKey: ["board"] });
      await client.invalidateQueries({ queryKey: ["history"] });
      await client.invalidateQueries({ queryKey: ["planning"] });
      return r;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  const noticeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);
  function notify(text: string, onUndo?: () => Promise<void>) {
    setUndo(onUndo ? () => onUndo : null);
    setNotice(text);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => {
      setNotice("");
      setUndo(null);
    }, 7000);
  }
  useEffect(() => {
    const handler = (e: Event) => notify((e as CustomEvent<string>).detail);
    window.addEventListener("opora:notice", handler);
    return () => window.removeEventListener("opora:notice", handler);
  }, []);
  async function signOut() {
    try {
      await api("logout/", "POST");
      client.removeQueries({
        predicate: (query) => query.queryKey[0] !== "session",
      });
      client.setQueryData(["session"], { ...session, authenticated: false });
    } catch (error) {
      setError((error as Error).message);
    }
  }
  function openSchedule(item: Item) {
    setSchedule(item);
    setScheduleDate(date);
    setPeriod(item.kind === "project" ? "week" : "day");
    setSection("");
  }
  function explicitWeek(item: Item) {
    return item.has_week_commitment;
  }
  function askState(item: Item, status: string) {
    if (
      item.kind !== "project" &&
      (status !== "graveyard" || !explicitWeek(item))
    ) {
      void mutate(`items/${item.id}/state/`, { status })
        .then(() =>
          notify(
            status === "done"
              ? "Дело выполнено"
              : status === "open"
                ? "Дело восстановлено"
                : "Дело отпущено",
            async () => {
              await mutate(`items/${item.id}/state/`, { status: item.status });
            },
          ),
        )
        .catch(() => {});
      return;
    }
    setReason("");
    setResult(item.result_comment || "");
    if (item.kind === "project" && status !== "open") {
      const open = b?.items.some(
        (i) => i.parent === item.id && i.status === "open",
      );
      if (open) {
        setClosure(item);
        return;
      }
    }
    setDecision({
      item,
      status,
      title:
        status === "done"
          ? "Завершить дело"
          : status === "graveyard"
            ? "Отпустить дело"
            : item.status === "graveyard"
              ? "Восстановить проект"
              : "Открыть проект повторно",
      reason: status === "graveyard" && !!explicitWeek(item),
    });
  }
  function removeEntry(id: string) {
    setReason("");
    setDecision({
      entry: id,
      title: page === "week" ? "Снять с недели" : "Снять с дня",
      reason: page === "week" && !!b && b.week <= b.today,
    });
  }
  function match(item: Item) {
    const needle = search.toLowerCase();
    return (
      (!area || item.areas.includes(area)) &&
      (!search ||
        [item.title, item.comment, item.location, ...item.tags]
          .join(" ")
          .toLowerCase()
          .includes(needle))
    );
  }
  const nav: [Page, string, React.ReactNode][] = [
    ["inbox", "Входящие", <Inbox size={20} />],
    ["day", "День", <CalendarDays size={20} />],
    ["week", "Неделя", <CalendarRange size={20} />],
    ["month", "Месяц", <CalendarRange size={20} />],
    ["quarter", "Квартал", <CalendarRange size={20} />],
    ["habits", "Привычки", <RefreshCw size={20} />],
    ["reflections", "Рефлексия", <Pencil size={20} />],
    ["projects", "Проекты", <FolderOpen size={20} />],
    ["ideas", "Идеи", <Lightbulb size={20} />],
    ["graveyard", "Отпущенные дела", <Archive size={20} />],
  ];
  const titles: Record<Page, string> = {
    inbox: "Входящие",
    day: "День",
    week: "Неделя",
    month: "Месяц",
    quarter: "Квартал",
    habits: "Привычки",
    reflections: "Рефлексия",
    projects: "Проекты",
    ideas: "Идеи",
    graveyard: "Отпущенные дела",
    settings: "Настройки",
  };
  function createForPage() {
    setEditor({
      plannedDay: page === "day" ? date : undefined,
      plannedWeek: page === "week" ? b?.week : undefined,
      proposal:
        page === "month" || page === "quarter"
          ? { period: page, date }
          : undefined,
      kind:
        page === "projects" ? "project" : page === "ideas" ? "idea" : "task",
    });
  }
  function EventList({
    events,
    chronological = false,
  }: {
    events: CalEvent[];
    chronological?: boolean;
  }) {
    return (
      <div className="events">
        {[...events]
          .sort((a, b) =>
            chronological
              ? Number(b.all_day) - Number(a.all_day) ||
                Date.parse(a.start) - Date.parse(b.start)
              : Number(a.done) - Number(b.done),
          )
          .map((e) => (
            <div
              className={`event-row ${e.done ? "completed" : ""}`}
              key={e.id}
            >
              <span className="event-time">
                {e.all_day ? "Весь день" : timeFmt(e.start)}
                {!e.all_day && <small>{timeFmt(e.end)}</small>}
              </span>
              <span className="event-line" />
              <button
                className={`checkbox ${e.done ? "checked" : ""}`}
                role="checkbox"
                aria-checked={e.done}
                aria-label={
                  (e.done
                    ? "Снять локальную отметку встречи: "
                    : "Отметить встречу локально: ") + e.title
                }
                disabled={busy}
                onClick={() =>
                  void mutate(`events/${e.id}/check/`, { done: !e.done }).catch(
                    () => {},
                  )
                }
              >
                <span>{e.done && <Check size={16} />}</span>
              </button>
              <span className="task-title">{e.title}</span>
              {e.url && (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Открыть событие Google"
                >
                  <ExternalLink size={16} />
                </a>
              )}
            </div>
          ))}
      </div>
    );
  }
  function Empty({ title, text }: { title: string; text: string }) {
    return (
      <div className="empty">
        <h3>{title}</h3>
        <p>{text}</p>
        {(search || area) && (
          <button
            className="text-button"
            onClick={() => {
              setSearch("");
              setArea(null);
            }}
          >
            Сбросить фильтры
          </button>
        )}
      </div>
    );
  }
  const captureOpen = b?.captures.filter((c) => c.status === "open") || [];
  const captureVisible = captureOpen.filter(
    (c) =>
      !search ||
      c.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const inboxVisible = (b?.inbox_ids || [])
    .map((id) => b!.items.find((i) => i.id === id)!)
    .filter(match)
    .sort(compareCompletion);
  const selectedDayEntries =
    b?.day_entries
      .filter((e) => match(e.item_detail))
      .sort((a, b) => Number(a.checked) - Number(b.checked)) || [];
  const dayDone = selectedDayEntries.filter((e) => e.checked).length;
  const dayWeekPool = (b?.week_rows || []).filter(
    (r) =>
      r.active &&
      r.item.status === "open" &&
      r.item.kind === "task" &&
      !r.item.schedule.some(
        (entry) => entry.period === "day" && entry.date >= b!.today,
      ) &&
      !b!.day_entries.some((e) => e.item === r.item.id && e.active) &&
      match(r.item),
  );
  const weekActive =
    b?.week_rows
      .filter((r) => r.active && match(r.item))
      .sort((a, b) => compareCompletion(a.item, b.item)) || [];
  const weekDone = weekActive.filter((r) => r.item.status === "done").length;
  const weekDayTasks = (b?.items || [])
    .filter(
      (item) =>
        item.kind === "task" &&
        item.status !== "graveyard" &&
        match(item) &&
        !weekActive.some((row) => row.item.id === item.id) &&
        item.schedule.some(
          (entry) =>
            entry.period === "day" &&
            entry.date >= b!.week &&
            entry.date < addDays(b!.week, 7),
        ),
    )
    .sort(compareCompletion);

  const weekSections = [
    ...(b?.areas || []).map((a) => ({
      id: String(a.id),
      name: a.name,
      color: a.color,
      rows: weekActive.filter((r) => r.item.areas.includes(a.id)),
      events: [] as CalEvent[],
    })),
    {
      id: "unassigned",
      name: "Без сферы",
      events: [] as CalEvent[],
      color: "#95a395",
      rows: weekActive.filter((r) => r.item.areas.length === 0),
    },
  ].sort(
    (a, b) => a.name.localeCompare(b.name, "ru") || a.id.localeCompare(b.id),
  );
  function branchMatches(item: Item, visited = new Set<string>()): boolean {
    if (visited.has(item.id)) return false;
    visited.add(item.id);
    return (
      match(item) ||
      !!b?.items.some(
        (child) =>
          child.parent === item.id &&
          child.status !== "graveyard" &&
          branchMatches(child, visited),
      )
    );
  }
  function belongsToArea(item: Item, sectionId: string) {
    return sectionId === "unassigned"
      ? item.areas.length === 0
      : item.areas.includes(Number(sectionId));
  }
  function renderAreaHeading(
    section: (typeof weekSections)[number],
    kind: "project" | "idea",
    count: number,
  ) {
    const label = kind === "project" ? "Добавить проект" : "Добавить идею";
    return (
      <div className="card-heading week-area-heading">
        <h3>
          <i style={{ background: section.color }} />
          {section.name}
          <span>{count}</span>
        </h3>
        <button
          className="week-area-add"
          title={`${label}: ${section.name}`}
          aria-label={`${label}: ${section.name}`}
          disabled={busy}
          onClick={() =>
            setEditor({
              kind,
              areas: section.id === "unassigned" ? [] : [Number(section.id)],
            })
          }
        >
          <Plus size={16} />
        </button>
      </div>
    );
  }
  function renderWeeklyNode(
    { row: r, children }: WeeklyNode<WeekRow>,
    parentId: string | null = null,
  ): React.ReactNode {
    return (
      <div className="week-project-group" key={r.item.id}>
        <TaskRow
          context={rowContext}
          item={r.item}
          direct={r.direct}
          hideAreas
          hideParent={r.item.parent === parentId}
          compact
          contextOnly={r.contextOnly}
          commitmentEntryId={r.direct ? r.entry_id : null}
        />
        {children.length > 0 && (
          <div className="week-project-children">
            {children.map((child) => renderWeeklyNode(child, r.item.id))}
          </div>
        )}
      </div>
    );
  }
  const usedSections = new Set([
    ...selectedDayEntries.map((e) => e.section || "Без привязки ко времени"),
    ...habits.flatMap((h) =>
      h.cells
        .filter(
          (c) => c.date === date && (c.expected || c.state !== "unrecorded"),
        )
        .map((c) => c.section || "Без привязки ко времени"),
    ),
  ]);
  const sections = [
    ...(b?.day_sections || []).filter((name) => usedSections.has(name)),
    ...[...usedSections].filter((name) => !b?.day_sections.includes(name)),
  ];
  const rowContext: TaskRowContext = {
    area,
    page,
    b: b || { today: session.today, items: [], areas: [] },
    busy,
    askState,
    setDetail: (item) => {
      if (closure) setClosure(null);
      setDetail(item);
    },
    setEditor,
    setWeekProject,
    setClosure,
    removeEntry,
    openSchedule,
    setSchedule,
    setScheduleDate,
    setPeriod,
    setSection,
    selectedDayEntries,
    mutate,
  };
  return (
    <div className="shell" data-page={page}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <Leaf size={20} />
          </span>
          опора<span className="brand-dot">.</span>
        </div>
        <nav>
          {nav.map(([key, label, icon]) => (
            <button
              key={key}
              aria-label={label}
              className={page === key ? "active" : ""}
              aria-current={page === key ? "page" : undefined}
              onClick={() => navigate(key)}
            >
              {icon}
              <span>{label}</span>
              {key === "inbox" && b && (
                <b>{captureOpen.length + b.inbox_ids.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`settings-link ${page === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings size={16} />
            Настройки
          </button>
          <button className="profile" onClick={() => void signOut()}>
            <span className="avatar">
              {session.username.slice(0, 1).toUpperCase()}
            </span>
            <span>
              {session.username}
              <small>Личное пространство</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main>
        <div className="main-content">
          <div className="page-heading">
            <h1 tabIndex={-1}>{titles[page]}</h1>
            <div className="page-actions">
              {!["settings", "habits", "reflections"].includes(page) && (
                <IconButton
                  className="filter-toggle"
                  label="Поиск и фильтры"
                  aria-expanded={filtersOpen || !!search || !!area}
                  aria-controls="workspace-filters"
                  onClick={() => setFiltersOpen(!filtersOpen)}
                >
                  <Search size={20} />
                </IconButton>
              )}
              {page !== "inbox" && (
                <IconButton
                  label="Записать мысль"
                  onClick={() => {
                    navigate("inbox");
                    requestAnimationFrame(() =>
                      document.getElementById("capture-input")?.focus(),
                    );
                  }}
                >
                  <Inbox size={20} />
                </IconButton>
              )}
              {page === "inbox" && (
                <IconButton
                  label="Создать дело без входящей мысли"
                  onClick={createForPage}
                >
                  <FilePlus2 size={20} />
                </IconButton>
              )}
              {page === "day" || page === "week" ? (
                <button className="primary" onClick={() => setPicker(page)}>
                  <ListPlus size={20} />
                  {page === "day" ? "Добавить в день" : "Выбрать дела"}
                </button>
              ) : (
                ["projects", "ideas", "month", "quarter"].includes(page) && (
                  <button className="primary" onClick={createForPage}>
                    <Plus size={20} />
                    {page === "projects"
                      ? "Новый проект"
                      : page === "ideas"
                        ? "Сохранить идею"
                        : "Новое дело"}
                  </button>
                )
              )}
            </div>
          </div>
          {notice && (
            <div className="notice" role="status">
              <Check size={16} />
              <span>{notice}</span>
              {undo && (
                <button
                  className="text-button"
                  onClick={() => {
                    void undo()
                      .then(() => {
                        setNotice("");
                        setUndo(null);
                      })
                      .catch(() => {});
                  }}
                >
                  <RotateCcw size={16} />
                  Отменить
                </button>
              )}
              <IconButton
                label="Закрыть уведомление"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </IconButton>
            </div>
          )}
          {error && !editor && !picker && !weekProject && (
            <div
              className={`error ${editor || decision || schedule || closure ? "floating-error" : ""}`}
              role="alert"
            >
              {error}
              <button
                aria-label="Закрыть сообщение"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {query.isError && b && (
            <div className="error" role="status">
              Нет связи с сервером. Показаны последние загруженные дела.{" "}
              <button onClick={() => query.refetch()}>Повторить</button>
            </div>
          )}
          {query.isPending ? (
            <div className="loading">Загружаем дела…</div>
          ) : query.isError && !b ? (
            <div className="error">
              Не удалось загрузить дела.{" "}
              <button onClick={() => query.refetch()}>Повторить</button>
            </div>
          ) : (
            b && (
              <>
                <div
                  className={`workspace-controls ${filtersOpen || search || area ? "filters-open" : ""}`}
                >
                  {(page === "day" || page === "week") && (
                    <div className="period-toolbar">
                      <div className="date-controls">
                        <button
                          aria-label="Предыдущий период"
                          onClick={() =>
                            setDate(addDays(date, page === "day" ? -1 : -7))
                          }
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <strong>
                          {page === "day"
                            ? fmt(date, {
                                weekday: "short",
                                day: "numeric",
                                month: "short",
                              })
                            : `${fmt(b.week, { day: "numeric", month: "short" })} — ${fmt(addDays(b.week, 6), { day: "numeric", month: "short" })}`}
                        </strong>
                        <button
                          aria-label="Следующий период"
                          onClick={() =>
                            setDate(addDays(date, page === "day" ? 1 : 7))
                          }
                        >
                          <ChevronRight size={16} />
                        </button>
                        <button
                          className="today-button"
                          onClick={() => setDate(b.today)}
                        >
                          {page === "week" ? "Текущая неделя" : "Сегодня"}
                        </button>
                        <DatePicker
                          date={date}
                          today={b.today}
                          onChange={setDate}
                        />
                      </div>
                      <span className="period-hint">
                        {page === "day"
                          ? "День с 05:00"
                          : "Суббота — пятница · обязательства"}
                      </span>
                    </div>
                  )}
                  {(page === "month" || page === "quarter") && (
                    <LargePeriodToolbar
                      period={page}
                      date={date}
                      today={b.today}
                      setDate={setDate}
                    />
                  )}
                  {!["settings", "habits", "reflections"].includes(page) && (
                    <div className="filterbar" id="workspace-filters">
                      <label className="search">
                        <Search size={16} />
                        <input
                          aria-label="Поиск по делам"
                          placeholder="Найти дело, тег или место"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                      {page !== "day" && (
                        <select
                          aria-label="Сфера жизни"
                          value={area || ""}
                          onChange={(e) =>
                            setArea(
                              e.target.value ? Number(e.target.value) : null,
                            )
                          }
                        >
                          <option value="">Все сферы жизни</option>
                          {b.areas.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
                {page === "inbox" && (
                  <>
                    <form
                      className="quick-capture"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!quick.trim()) return;
                        try {
                          await mutate("captures/", { text: quick });
                          setQuick("");
                          notify("Мысль сохранена");
                        } catch {}
                      }}
                    >
                      <Plus size={20} />
                      <label className="v2-sr-only" htmlFor="capture-input">
                        Новая мысль
                      </label>
                      <input
                        id="capture-input"
                        placeholder="Что сейчас в голове? Просто запиши…"
                        value={quick}
                        onChange={(e) => setQuick(e.target.value)}
                      />
                      <button
                        className="primary"
                        disabled={busy || !quick.trim()}
                      >
                        <ArrowRight size={20} />
                        <span className="v2-sr-only">Записать мысль</span>
                      </button>
                    </form>
                    <div className="content-card">
                      <div className="card-heading">
                        <h2>
                          Неразобранные мысли{" "}
                          <span>{captureVisible.length}</span>
                        </h2>
                      </div>
                      {captureVisible.map((c) => (
                        <div key={c.id} className="capture-row">
                          <div className="capture-mark" />
                          <div>
                            <p>{c.text}</p>
                            {c.results.length > 0 && (
                              <small>Создано дел: {c.results.length}</small>
                            )}
                          </div>
                          <div className="capture-actions">
                            <IconButton
                              label={`Создать дело из мысли: ${c.text}`}
                              onClick={() => setEditor({ capture: c.id })}
                            >
                              <FilePlus2 size={20} />
                            </IconButton>
                            <ActionMenu label={`Действия с мыслью: ${c.text}`}>
                              <button
                                onClick={() =>
                                  setEditor({ capture: c.id, kind: "idea" })
                                }
                              >
                                <Lightbulb size={16} />
                                Сохранить как идею
                              </button>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void mutate(`captures/${c.id}/resolve/`, {
                                    status: "processed",
                                  }).catch(() => {})
                                }
                              >
                                <Check size={16} />
                                Завершить разбор
                              </button>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void mutate(`captures/${c.id}/resolve/`, {
                                    status: "graveyard",
                                  })
                                    .then(() =>
                                      notify("Мысль отпущена", async () => {
                                        await mutate(
                                          `captures/${c.id}/resolve/`,
                                          { status: "open" },
                                        );
                                      }),
                                    )
                                    .catch(() => {})
                                }
                              >
                                <Archive size={16} />
                                Отпустить мысль
                              </button>
                            </ActionMenu>
                          </div>
                        </div>
                      ))}
                      {!captureVisible.length && (
                        <Empty
                          title={
                            search
                              ? "Ничего не найдено"
                              : "Нет неразобранных мыслей"
                          }
                          text={
                            search
                              ? "Измени поиск или сбрось фильтры."
                              : "Запиши новую мысль в поле выше."
                          }
                        />
                      )}
                    </div>
                    <div className="content-card">
                      <div className="card-heading">
                        <h2>
                          Дела без плана <span>{inboxVisible.length}</span>
                        </h2>
                      </div>
                      {inboxVisible.map((i) => (
                        <TaskRow context={rowContext} key={i.id} item={i} />
                      ))}
                      {!inboxVisible.length && (
                        <div className="inline-empty">
                          {search || area
                            ? "Ничего не найдено"
                            : "Нет дел без плана"}
                        </div>
                      )}
                    </div>
                  </>
                )}
                {["day", "week", "habits"].includes(page) &&
                  habitsQuery.isError && (
                    <div className="error" role="alert">
                      Не удалось загрузить привычки.{" "}
                      <button onClick={() => habitsQuery.refetch()}>
                        Повторить
                      </button>
                    </div>
                  )}
                {(page === "month" || page === "quarter") && (
                  <>
                    <PlanningPanel
                      api={api}
                      period={page}
                      date={date}
                      today={b.today}
                      items={b.items}
                      area={area}
                      search={search}
                      onOpen={(id) =>
                        setDetail(b.items.find((i) => i.id === id) || null)
                      }
                    />
                    <ReflectionEditor
                      key={`${page}-${date}`}
                      api={api}
                      period={page}
                      date={date}
                      compact
                    />
                  </>
                )}
                {page === "habits" && (
                  <HabitManager
                    today={b.today}
                    areas={b.areas}
                    sections={b.day_sections}
                    api={api}
                  />
                )}
                {page === "reflections" && (
                  <ReflectionPage api={api} today={b.today} />
                )}
                {page === "day" && (
                  <div
                    className={`day-layout ${!dayWeekPool.length && !b.events.some((e) => eventInDay(e, date)) ? "single-column" : ""}`}
                  >
                    <div className="day-main">
                      <div
                        className="content-card task-list"
                        aria-label="План дня"
                      >
                        <div className="card-heading">
                          <h2>
                            Дела <span>{selectedDayEntries.length}</span>
                          </h2>
                          {!!selectedDayEntries.length && (
                            <span>
                              {dayDone}/{selectedDayEntries.length} выполнено
                            </span>
                          )}
                        </div>
                        {sections.map((sectionName) => (
                          <section key={sectionName} className="day-section">
                            {(sectionName !== "Без привязки ко времени" ||
                              sections.length > 1) && (
                              <div className="day-section-heading">
                                <h3>{sectionName}</h3>
                                <IconButton
                                  label={`Добавить задачу в секцию ${sectionName}`}
                                  onClick={() =>
                                    setEditor({
                                      kind: "task",
                                      plannedDay: date,
                                      plannedSection:
                                        sectionName ===
                                        "Без привязки ко времени"
                                          ? ""
                                          : sectionName,
                                    })
                                  }
                                >
                                  <Plus size={20} />
                                </IconButton>
                              </div>
                            )}
                            {selectedDayEntries
                              .filter(
                                (e) =>
                                  (e.section || "Без привязки ко времени") ===
                                  sectionName,
                              )
                              .map((e) => (
                                <TaskRow
                                  context={rowContext}
                                  key={e.id}
                                  item={e.item_detail}
                                  entry={e}
                                  compact
                                  hideAreas
                                />
                              ))}
                            <HabitDayRows
                              habits={habits}
                              date={date}
                              today={b.today}
                              section={sectionName}
                              sections={b.day_sections}
                              area={area}
                              search={search}
                              api={api}
                            />
                          </section>
                        ))}
                        {!selectedDayEntries.length &&
                          !habits.some((h) =>
                            h.cells.some(
                              (c) =>
                                c.date === date &&
                                (c.expected || c.state !== "unrecorded") &&
                                c.title
                                  .toLocaleLowerCase()
                                  .includes(search.toLocaleLowerCase()),
                            ),
                          ) && (
                            <div className="empty">
                              <h3>
                                {search
                                  ? "Ничего не найдено"
                                  : "Нет задач на этот день"}
                              </h3>
                              <button
                                className="text-button"
                                onClick={() =>
                                  search ? setSearch("") : setPicker("day")
                                }
                              >
                                {search
                                  ? "Сбросить поиск"
                                  : "Добавить дело в день"}
                              </button>
                            </div>
                          )}
                      </div>
                      <ReflectionEditor
                        key={`day-${date}`}
                        api={api}
                        period="day"
                        date={date}
                        compact
                      />
                    </div>
                    {(dayWeekPool.length > 0 ||
                      b.events.some((e) => eventInDay(e, date))) && (
                      <aside className="day-aside">
                        {!!dayWeekPool.length && (
                          <div className="content-card week-pool">
                            <div className="card-heading">
                              <h2>
                                Из недели <span>{dayWeekPool.length}</span>
                              </h2>
                            </div>
                            {[
                              ...new Set(dayWeekPool.map((r) => r.item.parent)),
                            ].map((parentId) => (
                              <section
                                key={parentId || "standalone"}
                                className="pool-group"
                              >
                                {parentId && (
                                  <h3>
                                    {
                                      b.items.find((i) => i.id === parentId)
                                        ?.title
                                    }
                                  </h3>
                                )}
                                {dayWeekPool
                                  .filter((r) => r.item.parent === parentId)
                                  .map((r) => (
                                    <button
                                      key={r.item.id}
                                      className="pool-item"
                                      title={`Добавить в выбранный день: ${r.item.title}`}
                                      disabled={busy}
                                      onClick={() =>
                                        void mutate(
                                          `items/${r.item.id}/plan/`,
                                          { period: "day", date },
                                        )
                                          .then(() =>
                                            notify("Дело добавлено в день"),
                                          )
                                          .catch(() => {})
                                      }
                                    >
                                      <Plus size={20} />
                                      <span>{r.item.title}</span>
                                    </button>
                                  ))}
                              </section>
                            ))}
                          </div>
                        )}
                        {b.events.some((e) => eventInDay(e, date)) && (
                          <div className="content-card">
                            <div className="card-heading">
                              <h2>Встречи</h2>
                              <IconButton
                                label="Обновить календарь"
                                disabled={busy}
                                onClick={() =>
                                  void mutate("google/sync/").catch(() => {})
                                }
                              >
                                <RefreshCw size={20} />
                              </IconButton>
                            </div>
                            <p className="context-note">
                              Отметки сохраняются только в Опоре
                            </p>
                            <EventList
                              events={b.events.filter((e) =>
                                eventInDay(e, date),
                              )}
                              chronological
                            />
                          </div>
                        )}
                      </aside>
                    )}
                  </div>
                )}
                {page === "week" && (
                  <>
                    <div className="content-card">
                      <div className="card-heading">
                        <h2>
                          Обязательства{" "}
                          <span>
                            {weekActive.filter((r) => r.direct).length}
                          </span>
                        </h2>
                        <span className="list-progress">
                          {weekDone}/{weekActive.length} выполнено
                        </span>
                        <a
                          className="icon-button"
                          aria-label="Скачать неделю в Markdown"
                          title="Скачать неделю в Markdown"
                          href={"/api/export/?date=" + date}
                        >
                          <Download size={16} />
                        </a>
                      </div>
                      {weekSections
                        .filter(
                          (section) =>
                            section.rows.length > 0 &&
                            (!area || section.id === String(area)),
                        )
                        .map((section) => {
                          const contextRows = b.items
                            .filter((item) => item.kind === "project")
                            .map(
                              (item): WeekRow =>
                                b.week_rows.find(
                                  (row) =>
                                    row.item.id === item.id && row.active,
                                ) || {
                                  item,
                                  contextOnly: true,
                                  scheduled_day: null,
                                  direct: false,
                                  inherited: false,
                                  active: false,
                                  entry_id: null,
                                  outcome: "",
                                  reason: "",
                                },
                            );
                          const days = Array.from({ length: 7 }, (_, i) =>
                            addDays(b.week, i),
                          );
                          const dayTrees = new Map(
                            days.map((day) => [
                              day,
                              groupWeeklyRows(
                                section.rows.filter(
                                  (row) => row.scheduled_day === day,
                                ),
                                contextRows,
                              ),
                            ]),
                          );
                          const datedProjectIds = new Set<string>();
                          function collectProjects(
                            nodes: WeeklyNode<WeekRow>[],
                          ) {
                            for (const node of nodes) {
                              if (node.row.item.kind === "project")
                                datedProjectIds.add(node.row.item.id);
                              collectProjects(node.children);
                            }
                          }
                          for (const nodes of dayTrees.values())
                            collectProjects(nodes);
                          const undatedTree = omitWeeklyProjects(
                            groupWeeklyRows(
                              section.rows.filter((row) => !row.scheduled_day),
                              contextRows,
                            ),
                            datedProjectIds,
                          );
                          return (
                            <section
                              className="week-area-section"
                              key={section.id}
                            >
                              <div className="card-heading week-area-heading">
                                <h3>
                                  <i style={{ background: section.color }} />
                                  {section.name}
                                  <span>{section.rows.length}</span>
                                </h3>
                                <button
                                  className="week-area-add"
                                  title={`Добавить дело: ${section.name}`}
                                  aria-label={`Добавить дело: ${section.name}`}
                                  disabled={busy}
                                  onClick={() =>
                                    setEditor({
                                      kind: "task",
                                      plannedWeek: b.week,
                                      areas:
                                        section.id === "unassigned"
                                          ? []
                                          : [Number(section.id)],
                                    })
                                  }
                                >
                                  <Plus size={16} />
                                </button>
                              </div>
                              {Array.from({ length: 7 }, (_, i) =>
                                addDays(b.week, i),
                              ).map((day) => {
                                const rows = section.rows.filter(
                                  (row) => row.scheduled_day === day,
                                );
                                const events = section.events.filter((event) =>
                                  eventInDay(event, day),
                                );
                                return rows.length > 0 || events.length > 0 ? (
                                  <div
                                    className="calendar-day week-area-events"
                                    key={day}
                                  >
                                    <h3>
                                      {fmt(day, {
                                        weekday: "short",
                                        day: "numeric",
                                        month: "short",
                                      })}
                                    </h3>
                                    {dayTrees
                                      .get(day)!
                                      .map((node) => renderWeeklyNode(node))}
                                    <EventList events={events} chronological />
                                  </div>
                                ) : null;
                              })}
                              {undatedTree.map((node) =>
                                renderWeeklyNode(node),
                              )}
                              {!section.rows.length &&
                                !section.events.length && (
                                  <p className="week-area-empty">
                                    В этой сфере пока нет дел и событий на
                                    неделю
                                  </p>
                                )}
                            </section>
                          );
                        })}
                      {!weekActive.length && (
                        <div className="empty">
                          <h3>
                            {search || area
                              ? "Ничего не найдено"
                              : "Нет обязательств на эту неделю"}
                          </h3>
                          <button
                            className="text-button"
                            onClick={() =>
                              search || area
                                ? (setSearch(""), setArea(null))
                                : setPicker("week")
                            }
                          >
                            {search || area
                              ? "Сбросить фильтры"
                              : "Выбрать дела недели"}
                          </button>
                        </div>
                      )}
                      {b.week_rows
                        .filter((r) => !r.active)
                        .map((r) => (
                          <div className="released-row" key={r.item.id}>
                            <span>{r.item.title}</span>
                            <small>
                              Снято с плана{r.reason ? ": " + r.reason : ""}
                            </small>
                          </div>
                        ))}
                    </div>

                    {!!weekDayTasks.length && (
                      <Disclosure
                        title="Дела по дням без обязательств"
                        count={weekDayTasks.length}
                      >
                        {Array.from({ length: 7 }, (_, i) =>
                          addDays(b.week, i),
                        ).map((day) => {
                          const tasks = weekDayTasks.filter((item) =>
                            item.schedule.some(
                              (entry) =>
                                entry.period === "day" && entry.date === day,
                            ),
                          );
                          return tasks.length ? (
                            <section className="calendar-day" key={day}>
                              <h3>
                                {fmt(day, {
                                  weekday: "short",
                                  day: "numeric",
                                  month: "short",
                                })}
                              </h3>
                              {tasks.map((item) => (
                                <TaskRow
                                  context={rowContext}
                                  key={item.id}
                                  item={item}
                                  compact
                                />
                              ))}
                            </section>
                          ) : null;
                        })}
                      </Disclosure>
                    )}
                    <PlanningPanel
                      api={api}
                      period="week"
                      date={date}
                      today={b.today}
                      items={b.items}
                      area={area}
                      search={search}
                      onOpen={(id) =>
                        setDetail(b.items.find((i) => i.id === id) || null)
                      }
                    />
                    <Disclosure
                      title="Привычки"
                      count={
                        habits.filter((h) =>
                          h.cells.some(
                            (c) => c.expected || c.state !== "unrecorded",
                          ),
                        ).length
                      }
                    >
                      <HabitWeek
                        habits={habits}
                        week={b.week}
                        today={b.today}
                        areas={b.areas}
                        sections={b.day_sections}
                        area={area}
                        search={search}
                        api={api}
                      />
                    </Disclosure>
                    {!!b.events.length && (
                      <Disclosure
                        title="Календарь недели"
                        count={b.events.length}
                      >
                        <p className="context-note">
                          Отметки сохраняются только в Опоре
                        </p>
                        {Array.from({ length: 7 }, (_, i) =>
                          addDays(b.week, i),
                        ).map((day) => {
                          const events = b.events.filter((e) =>
                            eventInDay(e, day),
                          );
                          return events.length ? (
                            <section className="calendar-day" key={day}>
                              <h3>
                                {fmt(day, {
                                  weekday: "short",
                                  day: "numeric",
                                  month: "short",
                                })}
                              </h3>
                              <EventList events={events} chronological />
                            </section>
                          ) : null;
                        })}
                      </Disclosure>
                    )}
                    <ReflectionEditor
                      key={`week-${b.week}`}
                      api={api}
                      period="week"
                      date={date}
                      compact
                    />
                  </>
                )}
                {page === "projects" && (
                  <div className="content-card">
                    {weekSections.map((section) => {
                      const projects = b.items.filter(
                        (i) =>
                          i.parent === null &&
                          i.kind === "project" &&
                          i.status !== "graveyard" &&
                          belongsToArea(i, section.id) &&
                          branchMatches(i),
                      );
                      function tree(
                        parent: string | null,
                        depth: number,
                      ): React.ReactNode {
                        return b!.items
                          .filter(
                            (i) =>
                              i.parent === parent &&
                              i.status !== "graveyard" &&
                              (parent !== null ||
                                (i.kind === "project" &&
                                  belongsToArea(i, section.id))),
                          )
                          .filter((i) => branchMatches(i))
                          .sort(compareCompletion)
                          .map((i) => (
                            <div
                              key={i.id}
                              className="tree-node"
                              data-depth={depth}
                            >
                              <TaskRow
                                context={rowContext}
                                item={i}
                                hideAreas
                                hideParent
                              />
                              {i.kind === "project" && (
                                <>
                                  <div className="project-children">
                                    {tree(i.id, depth + 1)}
                                  </div>
                                </>
                              )}
                            </div>
                          ));
                      }
                      if (
                        !projects.length ||
                        (area && section.id !== String(area))
                      )
                        return null;
                      return (
                        <section className="week-area-section" key={section.id}>
                          {renderAreaHeading(
                            section,
                            "project",
                            projects.length,
                          )}
                          {tree(null, 0)}
                          {!projects.length && (
                            <p className="week-area-empty">
                              В этой сфере пока нет проектов
                            </p>
                          )}
                        </section>
                      );
                    })}
                    {!b.items.some(
                      (i) =>
                        i.parent === null &&
                        i.kind === "project" &&
                        i.status !== "graveyard" &&
                        branchMatches(i),
                    ) && (
                      <div className="empty">
                        <h3>
                          {search || area
                            ? "Ничего не найдено"
                            : "Нет проектов"}
                        </h3>
                        <button
                          className="text-button"
                          onClick={() =>
                            search || area
                              ? (setSearch(""), setArea(null))
                              : setEditor({ kind: "project" })
                          }
                        >
                          {search || area
                            ? "Сбросить фильтры"
                            : "Создать проект"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {page === "ideas" && (
                  <div className="content-card">
                    {weekSections.map((section) => {
                      const ideas = b.items.filter(
                        (i) =>
                          i.kind === "idea" &&
                          i.status === "open" &&
                          match(i) &&
                          belongsToArea(i, section.id),
                      );
                      if (
                        !ideas.length ||
                        (area && section.id !== String(area))
                      )
                        return null;
                      return (
                        <section className="week-area-section" key={section.id}>
                          {renderAreaHeading(section, "idea", ideas.length)}
                          {ideas.map((i) => (
                            <TaskRow
                              context={rowContext}
                              key={i.id}
                              item={i}
                              hideAreas
                            />
                          ))}
                          {!ideas.length && (
                            <p className="week-area-empty">
                              В этой сфере пока нет идей
                            </p>
                          )}
                        </section>
                      );
                    })}
                    {!b.items.some(
                      (i) =>
                        i.kind === "idea" && i.status === "open" && match(i),
                    ) && (
                      <div className="empty">
                        <h3>
                          {search || area
                            ? "Ничего не найдено"
                            : "Нет сохранённых идей"}
                        </h3>
                        <button
                          className="text-button"
                          onClick={() =>
                            search || area
                              ? (setSearch(""), setArea(null))
                              : setEditor({ kind: "idea" })
                          }
                        >
                          {search || area
                            ? "Сбросить фильтры"
                            : "Сохранить идею"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {page === "graveyard" && (
                  <div className="content-card">
                    {b.items
                      .filter((i) => i.status === "graveyard" && match(i))
                      .map((i) => (
                        <TaskRow context={rowContext} key={i.id} item={i} />
                      ))}
                    {b.captures
                      .filter(
                        (c) =>
                          c.status === "graveyard" &&
                          (!search ||
                            c.text
                              .toLocaleLowerCase()
                              .includes(search.toLocaleLowerCase())),
                      )
                      .map((c) => (
                        <div className="capture-row" key={c.id}>
                          <p>{c.text}</p>
                          <button
                            className="text-button"
                            onClick={() =>
                              void mutate(`captures/${c.id}/resolve/`, {
                                status: "open",
                              }).catch(() => {})
                            }
                          >
                            Вернуть во входящие
                          </button>
                        </div>
                      ))}
                    {!b.items.some(
                      (i) => i.status === "graveyard" && match(i),
                    ) &&
                      !b.captures.some(
                        (c) =>
                          c.status === "graveyard" &&
                          (!search ||
                            c.text
                              .toLocaleLowerCase()
                              .includes(search.toLocaleLowerCase())),
                      ) && (
                        <Empty
                          title="Нет отпущенных дел"
                          text="Здесь появятся дела, которые можно восстановить."
                        />
                      )}
                  </div>
                )}
                {page === "settings" && (
                  <>
                    <div className="content-card settings-card">
                      <div className="card-heading">
                        <h2>Google Календарь</h2>
                        <span>
                          {b.google.connected ? "Подключён" : "Не подключён"}
                        </span>
                      </div>
                      <p>
                        Встречи появятся в планах дня и недели. Галочки
                        сохраняются в тудушнике; Google Календарь остаётся без
                        изменений.
                      </p>
                      {!b.google.configured && (
                        <div className="info">
                          Подключение календаря ещё не настроено. Обратись к
                          администратору пространства.
                        </div>
                      )}
                      <div className="button-row">
                        <button
                          className="primary"
                          disabled={busy || !b.google.configured}
                          onClick={async () => {
                            try {
                              const d = await api("google/start/");
                              window.location.assign(d.url);
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          {b.google.connected
                            ? "Переподключить"
                            : "Подключить Google"}
                        </button>
                        {b.google.connected && (
                          <>
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                void mutate("google/sync/")
                                  .then(() => notify("Расписание обновлено"))
                                  .catch(() => {})
                              }
                            >
                              <RefreshCw size={16} />
                              Обновить
                            </button>
                            <button
                              className="text-button"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Отключить Google и удалить импортированные встречи вместе с локальными отметками?",
                                  )
                                )
                                  void mutate("google/disconnect/").catch(
                                    () => {},
                                  );
                              }}
                            >
                              Отключить
                            </button>
                          </>
                        )}
                      </div>
                      {b.google.last_sync && (
                        <small className="muted">
                          Обновлено:{" "}
                          {new Date(b.google.last_sync).toLocaleString("ru-RU")}
                        </small>
                      )}
                      {b.google.last_error && (
                        <div className="error">{b.google.last_error}</div>
                      )}
                      {b.google.connected && (
                        <div className="calendar-options">
                          <div className="schedule-heading">
                            <button
                              className="calendar-refresh"
                              disabled={busy}
                              title="Обновить список календарей"
                              aria-label="Обновить список календарей"
                              onClick={() =>
                                void mutate("google/calendars/")
                                  .then(() =>
                                    notify("Список календарей обновлён"),
                                  )
                                  .catch(() => {})
                              }
                            >
                              <RefreshCw size={16} />
                            </button>
                            <h3>Календари с занятым временем</h3>
                          </div>
                          <p>
                            Выбери встречи и поездки. Календари «без детей» пока
                            подключать не нужно.
                          </p>
                          {b.google.calendars.map((c) => (
                            <label key={c.id}>
                              <input
                                type="checkbox"
                                checked={b.google.selected.includes(c.id)}
                                disabled={busy}
                                onChange={(e) =>
                                  void mutate("google/settings/", {
                                    selected: e.target.checked
                                      ? [...b.google.selected, c.id]
                                      : b.google.selected.filter(
                                          (id) => id !== c.id,
                                        ),
                                  }).catch(() => {})
                                }
                              />
                              {c.name}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                    <ReflectionTemplates api={api} />
                    <DaySectionsSettings
                      sections={b.day_sections}
                      busy={busy}
                      onSave={async (sections) => {
                        await mutate(
                          "settings/day-sections/",
                          { sections },
                          "PATCH",
                        );
                        notify("Стандартные секции сохранены");
                      }}
                    />
                    <div className="content-card settings-card">
                      <h2>Ритм планирования</h2>
                      <dl>
                        <dt>Начало дня</dt>
                        <dd>05:00</dd>
                        <dt>Начало недели</dt>
                        <dd>Суббота</dd>
                        <dt>Завершение недели</dt>
                        <dd>Пятница вечером — подведение итогов</dd>
                        <dt>Часовой пояс</dt>
                        <dd>Москва · Europe/Moscow</dd>
                        <dt>Напоминание о дедлайне</dt>
                        <dd>За 14 дней во входящих</dd>
                        <dt>Пересмотр названия</dt>
                        <dd>Через 10 дней без изменений</dd>
                      </dl>
                    </div>
                  </>
                )}
              </>
            )
          )}
        </div>
      </main>
      <nav className="mobile-nav" aria-label="Основные разделы">
        {(
          [
            ["day", "День", <CalendarDays size={20} />],
            ["week", "Неделя", <CalendarRange size={20} />],
            ["inbox", "Входящие", <Inbox size={20} />],
          ] as [Page, string, React.ReactNode][]
        ).map(([key, label, icon]) => (
          <button
            key={key}
            className={page === key ? "active" : ""}
            aria-current={page === key ? "page" : undefined}
            onClick={() => navigate(key)}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
        <button
          aria-expanded={moreOpen}
          className={!["day", "week", "inbox"].includes(page) ? "active" : ""}
          onClick={() => setMoreOpen(true)}
        >
          <Menu size={20} />
          <span>Ещё</span>
        </button>
      </nav>
      {moreOpen && (
        <Modal title="Разделы" onClose={() => setMoreOpen(false)}>
          <div className="more-navigation">
            {nav
              .filter(([key]) => !["day", "week", "inbox"].includes(key))
              .map(([key, label, icon]) => (
                <button key={key} onClick={() => navigate(key)}>
                  {icon}
                  {label}
                </button>
              ))}
            <button onClick={() => navigate("settings")}>
              <Settings size={20} />
              Настройки
            </button>
            <button onClick={() => void signOut()}>
              <LogOut size={20} />
              Выйти
            </button>
          </div>
        </Modal>
      )}
      {picker && b && (
        <PlanPicker
          period={picker}
          date={picker === "day" ? date : b.week}
          board={b}
          onClose={() => setPicker(null)}
          onCreate={() => {
            const target = picker;
            setPicker(null);
            setEditor({
              kind: "task",
              plannedDay: target === "day" ? date : undefined,
              plannedWeek: target === "week" ? b.week : undefined,
            });
          }}
          onSelect={async (ids) => {
            for (const id of ids)
              await mutate(`items/${id}/plan/`, {
                period: picker,
                date: picker === "day" ? date : b.week,
              });
            setPicker(null);
            notify(
              picker === "day"
                ? "Дела добавлены в день"
                : "Обязательства недели выбраны",
            );
          }}
        />
      )}
      {weekProject && b && (
        <WeekProjectPicker
          project={weekProject}
          board={b}
          onClose={() => setWeekProject(null)}
          onPlan={async (id) => {
            await mutate(`items/${id}/plan/`, { period: "week", date: b.week });
          }}
          onCreate={async (title) => {
            await mutate("items/", {
              title,
              kind: "task",
              parent: weekProject.id,
              areas: weekProject.areas,
              planned_week: b.week,
            });
            notify("Новое дело добавлено в план недели");
          }}
        />
      )}
      {editor && b && (
        <ItemEditor
          initial={editor}
          board={b}
          busy={busy}
          onClose={() => {
            setEditor(null);
            setError("");
          }}
          onSave={async (values) => {
            if (!editor.item && editor.proposal)
              values = {
                ...values,
                [`planned_${editor.proposal.period}`]: editor.proposal.date,
              };
            await mutate(
              editor.item ? `items/${editor.item.id}/` : "items/",
              values,
              editor.item ? "PATCH" : "POST",
            );
            setEditor(null);
            notify(
              editor.capture
                ? values.resolve_capture
                  ? "Дело создано, мысль отмечена разобранной."
                  : "Дело создано. Мысль оставлена для дальнейшего разбора."
                : "Сохранено",
            );
          }}
        />
      )}
      {detail && b && (
        <Detail
          item={b.items.find((i) => i.id === detail.id) || detail}
          board={b}
          onSelect={setDetail}
          onClose={() => setDetail(null)}
          onEdit={(i) => {
            setEditor({ item: i });
            setDetail(null);
          }}
          onState={(item, status) => {
            setDetail(null);
            askState(item, status);
          }}
          onPlan={(item) => {
            setDetail(null);
            openSchedule(item);
          }}
          onChangeSection={(entry) => {
            setDetail(null);
            setSchedule(entry.item_detail);
            setScheduleDate(entry.date);
            setPeriod("day");
            setSection(entry.section);
          }}
          onAdd={(i) => {
            setEditor({ parent: i.id });
            setDetail(null);
          }}
        />
      )}
      {schedule && (
        <Modal
          layer={45}
          title="Выбрать время для дела"
          onClose={() => setSchedule(null)}
        >
          <p className="modal-subtitle">{schedule.title}</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await mutate(`items/${schedule.id}/plan/`, {
                  period,
                  date: scheduleDate,
                  section,
                });
                setSchedule(null);
                notify("Дело добавлено в план");
              } catch {}
            }}
          >
            <label>
              Период
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              >
                {schedule.kind !== "project" && (
                  <option value="day">День</option>
                )}
                <option value="week">Неделя · обязательство</option>
                <option value="month">Месяц · предложение</option>
                <option value="quarter">Квартал · предложение</option>
              </select>
            </label>
            <p className="info">
              {period === "week"
                ? "Неделя начинается в субботу в 05:00. Проект включает все открытые дочерние дела."
                : period === "day"
                  ? "День начинается в 05:00. Назначение на день не создаёт недельного обязательства."
                  : "Предложение без обязательства завершить к концу периода."}
            </p>
            <label>
              {period === "day"
                ? "Дата"
                : period === "week"
                  ? "Любой день недели с субботы по пятницу"
                  : "Любая дата внутри периода"}
              <input
                type="date"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                required
              />
            </label>
            {period === "day" && (
              <label>
                Секция дня
                <select
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                >
                  <option value="">Без привязки ко времени</option>
                  {[
                    ...new Set([
                      ...(b?.day_sections || []),
                      ...(section ? [section] : []),
                    ]),
                  ].map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setSchedule(null)}
              >
                Отмена
              </button>
              <button className="primary" disabled={busy}>
                Добавить в план
              </button>
            </div>
          </form>
        </Modal>
      )}
      {decision && (
        <Modal
          layer={50}
          title={decision.title}
          onClose={() => setDecision(null)}
        >
          <p className="modal-subtitle">{decision.item?.title}</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                if (decision.entry)
                  await mutate(`plans/${decision.entry}/release/`, { reason });
                else
                  await mutate(`items/${decision.item!.id}/state/`, {
                    status: decision.status,
                    reason,
                    ...(decision.status === "done"
                      ? { result_comment: result }
                      : {}),
                  });
                setDecision(null);
                notify(
                  decision.entry
                    ? decision.title.replace("Снять", "Снято")
                    : decision.status === "done"
                      ? "Проект завершён"
                      : decision.status === "graveyard"
                        ? "Дело отпущено"
                        : "Дело восстановлено",
                );
              } catch {}
            }}
          >
            {decision.entry && (
              <p className="info">
                {decision.reason
                  ? "Снятие с недели сохранит дело. Укажи причину изменения обязательства."
                  : "Снятие с плана сохранит дело и его историю."}
              </p>
            )}
            {decision.reason && (
              <label>
                Почему меняешь недельное обязательство?
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  placeholder="Что изменилось?"
                />
              </label>
            )}
            {decision.status === "done" && (
              <label>
                Комментарий к результату{" "}
                <span className="muted">· необязательно</span>
                <textarea
                  value={result}
                  onChange={(e) => setResult(e.target.value)}
                  placeholder="Что получилось? Что хочется отметить?"
                />
              </label>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setDecision(null)}
              >
                Отмена
              </button>
              <button className="primary" disabled={busy}>
                {decision.entry
                  ? decision.title
                  : decision.status === "done"
                    ? "Завершить проект"
                    : decision.status === "graveyard"
                      ? "Отпустить дело"
                      : "Восстановить дело"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {closure && b && (
        <Modal
          title="Разобрать проект перед закрытием"
          onClose={() => setClosure(null)}
          wide
        >
          <p className="modal-subtitle">{closure.title}</p>
          <p>
            Сначала прими решение по вложенным делам, затем закрой сам проект.
          </p>
          {b.items
            .filter((i) => {
              let p = i.parent;
              const seen = new Set();
              while (p && !seen.has(p)) {
                if (p === closure.id) return i.status === "open";
                seen.add(p);
                p = b.items.find((x) => x.id === p)?.parent || null;
              }
              return false;
            })
            .sort((a, z) => {
              const depth = (i: Item) => {
                let n = 0,
                  p = i.parent;
                while (p && n < 100) {
                  n++;
                  p = b.items.find((x) => x.id === p)?.parent || null;
                }
                return n;
              };
              return depth(z) - depth(a);
            })
            .map((i) => (
              <TaskRow
                context={rowContext}
                key={i.id}
                item={i}
                hideParent={i.parent === closure.id}
              />
            ))}
          {!b.items.some(
            (i) => i.parent === closure.id && i.status === "open",
          ) && (
            <div className="button-row">
              <button
                className="primary"
                onClick={() => {
                  const i = closure;
                  setClosure(null);
                  askState(i, "done");
                }}
              >
                Завершить проект
              </button>
              <button
                className="secondary"
                onClick={() => {
                  const i = closure;
                  setClosure(null);
                  askState(i, "graveyard");
                }}
              >
                Отпустить проект
              </button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function DaySectionsSettings({
  sections,
  busy,
  onSave,
}: {
  sections: string[];
  busy: boolean;
  onSave: (sections: string[]) => Promise<void>;
}) {
  const [text, setText] = useState(sections.join("\n"));
  return (
    <div className="content-card settings-card">
      <h2>Стандартные секции дня</h2>
      <p>
        Эти секции можно выбрать при планировании на конкретную дату. Пустые
        секции в дневном плане не показываются. Одна строка — одна секция;
        порядок строк задаёт порядок в плане.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onSave(
              text
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            );
          } catch {}
        }}
      >
        <label>
          Список секций
          <textarea
            rows={7}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <p className="muted">
          Удаление секции из списка не удаляет задачи: прежние секции с задачами
          останутся в их планах.
        </p>
        <div className="button-row">
          <button className="primary" disabled={busy}>
            Сохранить секции
          </button>
        </div>
      </form>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
  wide = false,
  layer = 30,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  layer?: number;
  className?: string;
}) {
  return (
    <DialogSurface
      title={title}
      onClose={onClose}
      wide={wide}
      layer={layer}
      className={className}
    >
      {children}
    </DialogSurface>
  );
}

function WeekProjectPicker({
  project,
  board,
  onClose,
  onPlan,
  onCreate,
}: {
  project: Item;
  board: Board;
  onClose: () => void;
  onPlan: (id: string) => Promise<void>;
  onCreate: (title: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const candidates = board.items.filter(
    (i) => i.parent === project.id && i.kind === "task" && i.status === "open",
  );
  const planned = new Set(
    board.week_rows.filter((r) => r.active && r.direct).map((r) => r.item.id),
  );
  async function save(action: () => Promise<void>) {
    setSaving(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title="Добавить дела в неделю"
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <p className="modal-subtitle">
        {project.title} · {fmt(board.week)} – {fmt(addDays(board.week, 6))}
      </p>
      <label>
        Существующие дела
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Найти дело проекта"
        />
      </label>
      <div className="week-project-picker-list">
        {candidates
          .filter((i) =>
            i.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
          )
          .map((i) => (
            <label className="week-project-choice" key={i.id}>
              <input
                type="checkbox"
                disabled={saving || planned.has(i.id)}
                checked={planned.has(i.id) || selected.includes(i.id)}
                onChange={(e) =>
                  setSelected((ids) =>
                    e.target.checked
                      ? [...ids, i.id]
                      : ids.filter((id) => id !== i.id),
                  )
                }
              />
              <span>
                {i.title}
                {planned.has(i.id) && (
                  <small className="muted"> · Уже в плане</small>
                )}
              </span>
            </label>
          ))}
        {candidates.length === 0 && (
          <p className="muted">
            У проекта пока нет открытых задач. Создай первое дело ниже.
          </p>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim())
            void save(async () => {
              await onCreate(title.trim());
              setTitle("");
            });
        }}
      >
        <label>
          Новое дело
          <input
            autoFocus
            required
            maxLength={500}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Что сделать по проекту?"
          />
        </label>
        <button className="primary" disabled={saving || !title.trim()}>
          Создать и добавить в неделю
        </button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="button-row">
        <button
          className="primary"
          disabled={saving || selected.length === 0}
          onClick={() =>
            void save(async () => {
              for (const id of selected) {
                await onPlan(id);
                setSelected((ids) => ids.filter((value) => value !== id));
              }
            })
          }
        >
          Добавить выбранные ({selected.length})
        </button>
        <button disabled={saving} onClick={onClose}>
          Готово
        </button>
      </div>
    </Modal>
  );
}

function ItemEditor({
  initial,
  board,
  busy,
  onClose,
  onSave,
}: {
  initial: {
    item?: Item;
    parent?: string;
    capture?: string;
    kind?: Item["kind"];
    plannedDay?: string;
    plannedWeek?: string;
    proposal?: { period: "month" | "quarter"; date: string };
    areas?: number[];
    plannedSection?: string;
  };
  board: Board;
  busy: boolean;
  onClose: () => void;
  onSave: (values: any) => Promise<void>;
}) {
  const item = initial.item;
  const [title, setTitle] = useState(
      item?.title ??
        board.captures.find((capture) => capture.id === initial.capture)
          ?.text ??
        "",
    ),
    [plannedSection, setPlannedSection] = useState(
      initial.plannedSection || "",
    ),
    [kind, setKind] = useState(item?.kind || initial.kind || "task"),
    [parent, setParent] = useState(item?.parent || initial.parent || ""),
    [areas, setAreas] = useState<number[]>(
      item?.areas ??
        board.items.find((i) => i.id === initial.parent)?.areas ??
        initial.areas ??
        [],
    ),
    [comment, setComment] = useState(item?.comment || ""),
    [deadline, setDeadline] = useState(item?.deadline || ""),
    [available, setAvailable] = useState(item?.available_from || ""),
    [location, setLocation] = useState(item?.location || ""),
    [tags, setTags] = useState(item?.tags.join(", ") || ""),
    [minutes, setMinutes] = useState(item?.estimated_minutes?.toString() || ""),
    [resultComment, setResultComment] = useState(item?.result_comment || ""),
    [localError, setLocalError] = useState("");
  const forbiddenParents = new Set<string>();
  if (item) {
    forbiddenParents.add(item.id);
    let frontier = [item.id];
    while (frontier.length) {
      frontier = board.items
        .filter(
          (candidate) =>
            candidate.parent &&
            frontier.includes(candidate.parent) &&
            !forbiddenParents.has(candidate.id),
        )
        .map((candidate) => candidate.id);
      frontier.forEach((id) => forbiddenParents.add(id));
    }
  }
  const [resolveCapture, setResolveCapture] = useState(true);
  const [capturePlan, setCapturePlan] = useState("none");
  const [captureDate, setCaptureDate] = useState(board.today);
  const planPeriod =
    kind === "idea"
      ? "none"
      : kind === "project" && capturePlan === "day"
        ? "week"
        : capturePlan;
  const plannedDay = initial.capture
    ? planPeriod === "day"
      ? captureDate
      : undefined
    : initial.plannedDay;
  const plannedWeek = initial.capture
    ? planPeriod === "week"
      ? captureDate
      : undefined
    : initial.plannedWeek;
  return (
    <Modal
      layer={45}
      className="item-editor"
      title={
        item
          ? "Изменить дело"
          : initial.capture
            ? "Разобрать мысль: создать дело"
            : "Новое дело"
      }
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onSave({
              title,
              kind,
              ...(!item && plannedDay && kind === "task"
                ? {
                    planned_day: plannedDay,
                    planned_section: plannedSection,
                  }
                : {}),
              ...(!item && plannedWeek && kind !== "idea"
                ? { planned_week: plannedWeek }
                : {}),
              ...(!item || parent !== (item.parent || "")
                ? { parent: parent || null }
                : {}),
              ...(!item ? { capture: initial.capture || null } : {}),
              ...(!item && initial.capture
                ? { resolve_capture: resolveCapture }
                : {}),
              areas,
              comment,
              deadline: deadline || null,
              available_from: available || null,
              location,
              tags: tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
              estimated_minutes: minutes ? Number(minutes) : null,
              ...(item?.status === "done"
                ? { result_comment: resultComment }
                : {}),
            });
          } catch (e) {
            setLocalError((e as Error).message);
          }
        }}
      >
        <div className="item-editor-fields">
          {initial.proposal && (
            <p className="muted">
              Новое дело добавится в{" "}
              {initial.proposal.period === "month" ? "месячный" : "квартальный"}{" "}
              план как предложение.
            </p>
          )}
          <label>
            Название дела
            <input
              autoFocus
              required
              maxLength={500}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Что нужно сделать или получить?"
            />
          </label>
          {plannedDay && !item && kind === "task" && (
            <label>
              Секция дня
              <select
                value={plannedSection}
                onChange={(e) => setPlannedSection(e.target.value)}
              >
                <option value="">Без привязки ко времени</option>
                {[
                  ...new Set([
                    ...board.day_sections,
                    ...(plannedSection ? [plannedSection] : []),
                  ]),
                ].map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {initial.capture && (
            <div className="info">
              {board.captures.find((c) => c.id === initial.capture)?.text}
            </div>
          )}
          {initial.capture && !item && kind !== "idea" && (
            <div className="form-grid">
              <label>
                Сразу добавить в план
                <select
                  value={planPeriod}
                  onChange={(e) => setCapturePlan(e.target.value)}
                >
                  <option value="none">Без плана</option>
                  {kind === "task" && <option value="day">На день</option>}
                  <option value="week">На неделю · Сб–Пт</option>
                </select>
              </label>
              {planPeriod !== "none" && (
                <label>
                  {planPeriod === "day"
                    ? "Дата"
                    : "Любой день выбранной недели"}
                  <input
                    type="date"
                    required
                    min={planPeriod === "day" ? board.today : undefined}
                    value={captureDate}
                    onChange={(e) => setCaptureDate(e.target.value)}
                  />
                </label>
              )}
            </div>
          )}
          <details className="editor-additional">
            <summary>Свойства дела</summary>
            <div className="form-grid">
              <label>
                Тип
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as Item["kind"])}
                >
                  {(!item || item.kind === "idea") && (
                    <option value="idea">Идея</option>
                  )}
                  {(!item || item.kind !== "project") && (
                    <option value="task">Задача</option>
                  )}
                  <option value="project">Проект</option>
                </select>
              </label>
              <label>
                Внутри проекта
                <select
                  value={parent}
                  onChange={(e) => {
                    setParent(e.target.value);
                    if (!item)
                      setAreas(
                        board.items.find((i) => i.id === e.target.value)
                          ?.areas || [],
                      );
                  }}
                >
                  <option value="">Самостоятельное дело</option>
                  {board.items
                    .filter(
                      (i) =>
                        i.kind === "project" &&
                        i.status === "open" &&
                        !forbiddenParents.has(i.id),
                    )
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.title}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <fieldset className="area-fieldset">
              <legend>Сферы жизни · можно несколько</legend>
              <div className="area-chips">
                {board.areas.map((a) => (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={areas.includes(a.id)}
                    key={a.id}
                    className={areas.includes(a.id) ? "selected" : ""}
                    onClick={() =>
                      setAreas(
                        areas.includes(a.id)
                          ? areas.filter((id) => id !== a.id)
                          : [...areas, a.id],
                      )
                    }
                  >
                    <i style={{ background: a.color }} />
                    {a.name}
                    {areas.includes(a.id) && <Check size={16} />}
                  </button>
                ))}
              </div>
            </fieldset>
            <label>
              Комментарий
              <textarea
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Зачем это нужно? Что важно помнить?"
              />
            </label>

            <div className="form-grid">
              <label>
                Дедлайн
                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                />
              </label>
              <label>
                Актуально начиная с
                <input
                  type="date"
                  value={available}
                  onChange={(e) => setAvailable(e.target.value)}
                />
              </label>
              <label>
                Место
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Москва, дом…"
                />
              </label>
              <label>
                Плановая длительность, мин
                <input
                  type="number"
                  min="0"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                />
              </label>
            </div>
            <label>
              Теги через запятую
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="Маша, покупки, письма"
              />
            </label>
            {initial.capture && !item && (
              <label>
                После создания дела
                <select
                  value={resolveCapture ? "processed" : "open"}
                  onChange={(e) =>
                    setResolveCapture(e.target.value === "processed")
                  }
                >
                  <option value="processed">
                    Закрыть и отметить мысль разобранной
                  </option>
                  <option value="open">
                    Закрыть, оставив мысль неразобранной
                  </option>
                </select>
              </label>
            )}
          </details>
          {item?.status === "done" && (
            <label>
              Комментарий к результату
              <textarea
                value={resultComment}
                onChange={(e) => setResultComment(e.target.value)}
                rows={3}
              />
            </label>
          )}
          {localError && (
            <div role="alert" className="error">
              {localError}
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Отмена
          </button>
          <button className="primary" disabled={busy}>
            {item
              ? "Сохранить изменения"
              : plannedDay && kind === "task"
                ? "Создать и добавить в день"
                : plannedWeek && kind !== "idea"
                  ? "Создать и добавить в неделю"
                  : "Создать дело"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
const eventNames: Record<string, string> = {
  created: "Создано",
  updated: "Изменено",
  planned: "Включено в план",
  day_moved: "Перенесено",
  completed: "Выполнено",
  reopened: "Открыто повторно",
  buried: "Отпущено",
  restored: "Восстановлено",
  plan_released: "Снято с плана",
  commitment_released: "Снято обязательство",
  detached_on_restore: "Отсоединено от закрытого проекта",
};
function HistoryChanges({
  data,
  board,
}: {
  data: Record<string, unknown>;
  board: Board;
}) {
  if (!data.before || !data.after) return null;
  const before = data.before as Record<string, unknown>,
    after = data.after as Record<string, unknown>;
  const labels: Record<string, string> = {
    title: "Название",
    kind: "Тип",
    comment: "Комментарий",
    result_comment: "Комментарий к результату",
    deadline: "Дедлайн",
    available_from: "Актуально с",
    location: "Место",
    tags: "Теги",
    estimated_minutes: "Плановые минуты",
    areas: "Сферы",
  };
  function show(key: string, value: unknown): string {
    if (value === null || value === undefined || value === "")
      return "не указано";
    if (key === "kind")
      return kindLabel[value as Item["kind"]] || String(value);
    if (key === "areas" && Array.isArray(value))
      return (
        value
          .map((id) => board.areas.find((a) => a.id === id)?.name || id)
          .join(", ") || "не выбраны"
      );
    if (Array.isArray(value)) return value.join(", ") || "не указаны";
    return String(value);
  }
  return (
    <>
      {Object.entries(labels)
        .filter(
          ([key]) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
        )
        .map(([key, label]) => (
          <small key={key}>
            {label}: «{show(key, before[key])}» → «{show(key, after[key])}»
          </small>
        ))}
    </>
  );
}

function ProjectContents({
  project,
  board,
  onSelect,
  onPlan,
}: {
  project: Item;
  board: Board;
  onSelect: (item: Item) => void;
  onPlan: (item: Item) => void;
}) {
  const children = new Map<string, Item[]>();
  for (const item of board.items) {
    if (!item.parent) continue;
    const siblings = children.get(item.parent) || [];
    siblings.push(item);
    children.set(item.parent, siblings);
  }
  const visited = new Set<string>([project.id]);
  function renderChildren(parent: string): React.ReactNode {
    const items = [...(children.get(parent) || [])]
      .sort(
        (a, b) =>
          ({ open: 0, done: 1, graveyard: 2 })[a.status] -
          { open: 0, done: 1, graveyard: 2 }[b.status],
      )
      .filter((item) => !visited.has(item.id));
    if (!items.length) return null;
    return (
      <ul className="project-detail-list">
        {items.map((child) => {
          visited.add(child.id);
          return (
            <li key={child.id}>
              <div className={`project-detail-row status-${child.status}`}>
                <div className="project-detail-content">
                  <button
                    className="detail-step"
                    onClick={() => onSelect(child)}
                  >
                    <span>
                      {child.kind === "project" && <FolderOpen size={16} />}{" "}
                      {child.title}
                    </span>
                    <ChevronRight size={16} />
                  </button>
                  <div className="project-detail-meta">
                    {child.status !== "open" && (
                      <span
                        className={`project-detail-status status-${child.status}`}
                      >
                        {child.status === "done" ? "Выполнено" : "Отпущено"}
                      </span>
                    )}
                    {preciseSchedule(child.schedule)
                      .filter((plan) => !plan.inherited)
                      .map((plan) => (
                        <span key={`${plan.period}-${plan.date}`}>
                          <CalendarDays size={16} />
                          {plan.period === "week"
                            ? `Неделя: ${fmt(plan.date)} – ${fmt(addDays(plan.date, 6))}`
                            : fmt(plan.date, {
                                day: "numeric",
                                month: "long",
                                year: "numeric",
                              })}
                          {plan.inherited && " · через проект"}
                        </span>
                      ))}
                    {child.deadline && (
                      <span>Дедлайн: {fmt(child.deadline)}</span>
                    )}
                  </div>
                </div>
                {child.status === "open" && child.kind !== "idea" && (
                  <button
                    className="secondary project-detail-plan"
                    onClick={() => onPlan(child)}
                    aria-label={`Запланировать: ${child.title}`}
                    title="Запланировать"
                  >
                    <CalendarDays size={16} />
                  </button>
                )}
              </div>
              {renderChildren(child.id)}
            </li>
          );
        })}
      </ul>
    );
  }
  return children.has(project.id) ? (
    renderChildren(project.id)
  ) : (
    <p className="muted">В проекте пока нет дел. Добавь первый шаг.</p>
  );
}

function Detail({
  item,
  board,
  onClose,
  onEdit,
  onState,
  onPlan,
  onChangeSection,
  onAdd,
  onSelect,
}: {
  item: Item;
  board: Board;
  onClose: () => void;
  onEdit: (i: Item) => void;
  onState: (i: Item, s: string) => void;
  onPlan: (i: Item) => void;
  onChangeSection: (entry: Entry) => void;
  onAdd: (i: Item) => void;
  onSelect: (i: Item) => void;
}) {
  const history = useQuery<
    {
      id: string;
      event: string;
      data: Record<string, unknown>;
      created_at: string;
    }[]
  >({
    queryKey: ["history", item.id],
    queryFn: () => api(`items/${item.id}/history/`),
  });
  const parent = board.items.find((candidate) => candidate.id === item.parent);
  const hasChildren = board.items.some(
    (candidate) => candidate.parent === item.id,
  );
  const dayEntry = board.day_entries.find(
    (entry) => entry.item === item.id && entry.active,
  );
  return (
    <Modal layer={40} title={kindLabel[item.kind]} onClose={onClose} wide>
      <h2 className="detail-title">{item.title}</h2>
      <div className="button-row">
        <IconButton label="Редактировать дело" onClick={() => onEdit(item)}>
          <Pencil size={20} />
        </IconButton>
        {item.status === "open" && item.kind !== "idea" && (
          <IconButton
            label="Выбрать день или период"
            onClick={() => onPlan(item)}
          >
            <CalendarDays size={20} />
          </IconButton>
        )}
        {dayEntry && (
          <IconButton
            label="Изменить секцию дня"
            onClick={() => onChangeSection(dayEntry)}
          >
            <ListPlus size={20} />
          </IconButton>
        )}
        {item.kind === "project" && item.status === "open" && (
          <button className="primary" onClick={() => onAdd(item)}>
            <Plus size={20} />
            Добавить шаг
          </button>
        )}
        {!(item.kind === "idea" && item.status === "open") && (
          <button
            className={
              item.kind === "project" && item.status === "open"
                ? "secondary"
                : "primary"
            }
            onClick={() =>
              onState(item, item.status === "open" ? "done" : "open")
            }
          >
            {item.status === "graveyard"
              ? "Восстановить дело"
              : item.status === "done"
                ? "Открыть повторно"
                : item.kind === "project"
                  ? "Завершить проект"
                  : "Выполнить задачу"}
          </button>
        )}
      </div>
      {item.kind === "idea" && (
        <div className="info">
          Чтобы реализовать идею, измени её тип на задачу или проект.
        </div>
      )}
      {item.stale && (
        <p className="info">
          Название дела не менялось более 10 дней. Можно проверить его
          актуальность.
        </p>
      )}
      <dl className="detail-fields">
        <dt>Состояние</dt>
        <dd>
          {item.status === "open"
            ? "Открыто"
            : item.status === "done"
              ? "Выполнено"
              : "Отпущено"}
        </dd>
        {!!item.schedule.length && (
          <>
            <dt>Планирование</dt>
            <dd className="detail-schedule">
              {item.schedule.map((plan) => (
                <span key={`${plan.period}-${plan.date}`}>
                  {
                    {
                      day: "День выполнения",
                      week: "Обязательство недели",
                      month: "Предложение месяца",
                      quarter: "Предложение квартала",
                    }[plan.period]
                  }
                  : {fmt(plan.date)}
                  {plan.inherited && " · через проект"}
                </span>
              ))}
            </dd>
          </>
        )}
        {parent && (
          <>
            <dt>Проект</dt>
            <dd>
              <button
                className="detail-parent-link"
                onClick={() => onSelect(parent)}
              >
                <ChevronLeft size={16} />
                <span>{parent.title}</span>
              </button>
            </dd>
          </>
        )}
        <dt>Сферы</dt>
        <dd>
          {item.areas
            .map((id) => board.areas.find((a) => a.id === id)?.name)
            .join(", ") || "Не выбраны"}
        </dd>
        {item.deadline && (
          <>
            <dt>Дедлайн</dt>
            <dd>{fmt(item.deadline)}</dd>
          </>
        )}
        {item.available_from && (
          <>
            <dt>Актуально с</dt>
            <dd>{fmt(item.available_from)}</dd>
          </>
        )}
        {item.location && (
          <>
            <dt>Место</dt>
            <dd>{item.location}</dd>
          </>
        )}
        {item.tags.length > 0 && (
          <>
            <dt>Теги</dt>
            <dd>{item.tags.join(", ")}</dd>
          </>
        )}
        {item.estimated_minutes !== null && (
          <>
            <dt>Плановое время</dt>
            <dd>{item.estimated_minutes} мин</dd>
          </>
        )}
      </dl>
      {item.comment && (
        <div className="detail-text">
          <h3>Комментарий</h3>
          <p>{item.comment}</p>
        </div>
      )}
      {item.result_comment && (
        <div className="detail-text">
          <h3>Результат</h3>
          <p>{item.result_comment}</p>
        </div>
      )}
      {(item.kind === "project" || hasChildren) && (
        <section className="detail-steps">
          <h3>{item.kind === "project" ? "Дела проекта" : "Дочерние дела"}</h3>
          <ProjectContents
            project={item}
            board={board}
            onSelect={onSelect}
            onPlan={onPlan}
          />
          {item.kind === "project" && (
            <button className="add-child" onClick={() => onAdd(item)}>
              <Plus size={16} /> Следующий шаг
            </button>
          )}
        </section>
      )}
      <details className="history">
        <summary>
          <History size={16} />
          История
        </summary>
        {history.data?.map((e) => (
          <div className="history-row" key={e.id}>
            <time>
              {new Date(e.created_at).toLocaleString("ru-RU", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
            <div>
              {eventNames[e.event] || e.event}
              <HistoryChanges data={e.data} board={board} />
              {!!e.data.date && <small>{String(e.data.date)}</small>}
              {!!e.data.reason && <small>{String(e.data.reason)}</small>}
              {!!e.data.result_comment && (
                <small>{String(e.data.result_comment)}</small>
              )}
              {!!e.data.source && (
                <small>
                  {String(e.data.source)} → {String(e.data.destination)}
                </small>
              )}
            </div>
          </div>
        ))}
      </details>
    </Modal>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);

function PlanPicker({
  period,
  date,
  board,
  onClose,
  onSelect,
  onCreate,
}: {
  period: "day" | "week";
  date: string;
  board: Board;
  onClose: () => void;
  onSelect: (ids: string[]) => Promise<void>;
  onCreate: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const chosen = new Set(
    period === "day"
      ? board.day_entries.filter((e) => e.active).map((e) => e.item)
      : board.week_rows.filter((r) => r.active).map((r) => r.item.id),
  );
  const items = board.items.filter(
    (i) =>
      i.status === "open" &&
      (period === "week" ? i.kind !== "idea" : i.kind === "task") &&
      !chosen.has(i.id) &&
      i.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <Modal
      title={
        period === "day"
          ? "Добавить дела в день"
          : "Выбрать обязательства недели"
      }
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <p className="modal-subtitle">
        {fmt(date, { day: "numeric", month: "long" })}
        {period === "week" && ` — ${fmt(addDays(date, 6))}`}
      </p>
      {period === "week" && (
        <p className="info">
          Выбранный проект включает все открытые дочерние дела. Снятие
          начавшегося обязательства потребует причины.
        </p>
      )}
      <label>
        Поиск дел
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Название задачи или проекта"
        />
      </label>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (saving || !selected.length) return;
          setSaving(true);
          setError("");
          try {
            await onSelect(selected);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="picker-list">
          {items.map((item) => (
            <label className="picker-option" key={item.id}>
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                disabled={saving}
                onChange={(e) =>
                  setSelected((old) =>
                    e.target.checked
                      ? [...old, item.id]
                      : old.filter((id) => id !== item.id),
                  )
                }
              />
              {item.kind === "project" && <FolderOpen size={16} />}
              <span>{item.title}</span>
            </label>
          ))}
          {!items.length && (
            <p className="inline-empty">
              {search ? "Ничего не найдено" : "Нет открытых дел для выбора"}
            </p>
          )}
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button
            className="secondary"
            type="button"
            disabled={saving}
            onClick={onCreate}
          >
            <Plus size={20} />
            Создать дело
          </button>
          <button className="primary" disabled={saving || !selected.length}>
            {saving
              ? "Добавляем…"
              : `Добавить${selected.length ? ` · ${selected.length}` : ""}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
