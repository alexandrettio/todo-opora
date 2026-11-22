import React, { useState } from "react";
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
  CalendarMinus,
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
  ChevronUp,
  Clock3,
  MoreHorizontal,
  LogOut,
  Leaf,
  RefreshCw,
  ExternalLink,
  Download,
  Pencil,
  History,
  CornerDownRight,
} from "lucide-react";
import "./styles.css";
import { eventsForArea } from "./calendar-areas";
import { groupWeeklyRows, omitWeeklyProjects, type WeeklyNode } from "./weekly-tree";

type Item = {
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
  schedule: { period: "day" | "week"; date: string; inherited: boolean }[];
  stale: boolean;
  no_next_step: boolean;
};
const preciseSchedule = (schedule: Item["schedule"]) => {
  const days = schedule.filter((plan) => plan.period === "day");
  return days.length ? days : schedule;
};

const compareCompletion = (a: Item, b: Item) =>
  Number(a.status === "done") - Number(b.status === "done");

type Capture = { id: string; text: string; status: string; results: string[] };
type Entry = {
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
type Board = {
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
                `${k === "reason" ? "Причина" : k}: ${Array.isArray(v) ? v.join(", ") : v}`,
            )
            .join("\n"),
    );
  return data;
}
const fmt = (
  date: string,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" },
) => new Date(date + "T12:00:00").toLocaleDateString("ru-RU", options);
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
  if (query.isError)
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
            <Leaf size={23} />
          </span>
          опора<span className="brand-dot">.</span>
        </div>
        <h1>
          Место для твоих дел.
          <br />И место для жизни.
        </h1>
        <p>Войди в своё пространство планирования.</p>
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
      <div className="login-art">
        <Leaf size={150} strokeWidth={0.6} />
        <blockquote>
          Достаточно одного
          <br />
          следующего шага.
        </blockquote>
      </div>
    </div>
  );
}

type Page =
  "inbox" | "day" | "week" | "projects" | "ideas" | "graveyard" | "settings";
function Workspace({ session }: { session: any }) {
  const client = useQueryClient();
  const [page, setPage] = useState<Page>("day"),
    [date, setDate] = useState(session.today),
    [search, setSearch] = useState(""),
    [area, setArea] = useState<number | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{
      item?: Item;
      parent?: string;
      capture?: string;
      kind?: Item["kind"];
      plannedDay?: string;
      plannedWeek?: string;
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
  const b = query.data;
  async function mutate(path: string, body?: unknown, method = "POST") {
    setError("");
    setBusy(true);
    try {
      const r = await api(path, method, body);
      await client.invalidateQueries({ queryKey: ["board"] });
      await client.invalidateQueries({ queryKey: ["history"] });
      return r;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  function notify(text: string) {
    setNotice(text);
    window.setTimeout(() => setNotice(""), 3500);
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
            ? "Не буду делать"
            : "Вернуть в работу",
      reason: status === "graveyard" && !!explicitWeek(item),
    });
  }
  function removeEntry(id: string) {
    setReason("");
    setDecision({
      entry: id,
      title: "Убрать из плана",
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
    ["inbox", "Входящие", <Inbox size={19} />],
    ["day", "Мой день", <CalendarDays size={19} />],
    ["week", "Моя неделя", <CalendarRange size={19} />],
    ["projects", "Проекты", <FolderOpen size={19} />],
    ["ideas", "Идеи", <Lightbulb size={19} />],
    ["graveyard", "Кладбище", <Archive size={19} />],
  ];
  const titles = {
    inbox: "Освободи голову",
    day: "Мой день",
    week: "Моя неделя",
    projects: "Большое — по шагам",
    ideas: "Пусть пока побудет идеей",
    graveyard: "То, что можно отпустить",
    settings: "Настройки",
  };
  const subtitles = {
    inbox: "Сначала записать. Решить можно позже.",
    day: "План — опора. День может сложиться по-своему.",
    week: "С субботы до вечера пятницы. Выбери главное и оставь место для жизни.",
    projects: "Результаты, к которым ты движешься.",
    ideas: "Возможности без обязательств.",
    graveyard: "Решение не делать — тоже решение.",
    settings: "Твоё пространство и календарь.",
  };
  function ItemRow({
    item,
    entry,
    inherited = false,
    direct = false,
    compact = false,
    hideAreas = false,
    hideParent = false,
    scheduledDay,
    commitmentEntryId,
    contextOnly = false,
  }: {
    item: Item;
    entry?: Entry;
    inherited?: boolean;
    direct?: boolean;
    compact?: boolean;
    hideAreas?: boolean;
    hideParent?: boolean;
    scheduledDay?: string | null;
    commitmentEntryId?: string | null;
    contextOnly?: boolean;
  }) {
    const [menu, setMenu] = useState(false);
    const checked = !contextOnly && (entry ? entry.checked : item.status === "done");
    const historical =
      !!entry &&
      (!entry.active || entry.outcome === "moved" || entry.date < b!.today);
    return (
      <div
        className={`task-row ${scheduledDay ? "scheduled-task" : ""} ${checked ? "completed" : ""} ${!entry?.active && entry ? "archived-entry" : ""} ${compact ? "compact" : ""}`}
      >
        {item.kind === "idea" ? (
          <Lightbulb className="idea-icon" size={20} />
        ) : (
          <button
            className={`checkbox ${checked ? "checked" : ""}`}
            aria-label={contextOnly ? "Проект не является обязательством недели" : checked ? "Открыть повторно" : "Отметить выполненным"}
            title={contextOnly ? "Проект показан для группировки дел и не входит в обязательства недели" : undefined}
            disabled={busy || historical || contextOnly}
            onClick={() => askState(item, checked ? "open" : "done")}
          >
            {checked && <Check size={13} />}
          </button>
        )}
        <button className="task-content" onClick={() => setDetail(item)}>
          <span className="task-title">
            {page === "week" && item.kind === "project" && (
              <FolderOpen className="week-project-icon" size={15} aria-label="Проект" />
            )}
            {item.title}
          </span>
          <span className="task-meta">
            {scheduledDay && page !== "week" && (
              <span className="scheduled-task-date">
                <CalendarDays size={12} />
                {fmt(scheduledDay, { weekday: "short", day: "numeric", month: "short" })}
              </span>
            )}
            {page === "projects" && preciseSchedule(item.schedule).map((plan) => (
              <span key={`${plan.period}-${plan.date}`}>
                {plan.period === "day" ? <CalendarDays size={12} /> : <CalendarRange size={12} />}
                {plan.period === "day"
                  ? `День: ${fmt(plan.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}`
                  : `Неделя: ${fmt(plan.date)} — ${fmt(addDays(plan.date, 6), { day: "numeric", month: "short", year: "numeric" })}`}
                {plan.inherited && " · через проект"}
              </span>
            ))}
            {item.kind === "project" && !["week", "projects"].includes(page) && (
              <span>
                <FolderOpen size={12} />
                Проект
              </span>
            )}
            {item.parent && !hideParent && (
              <span>
                <CornerDownRight size={12} />
                {b?.items.find((i) => i.id === item.parent)?.title}
              </span>
            )}
            {!hideAreas && item.areas.map((id) => {
              const a = b?.areas.find((a) => a.id === id);
              return a ? (
                <span key={id} className="area-label">
                  <i style={{ background: a.color }} />
                  {a.name}
                </span>
              ) : null;
            })}
            {item.estimated_minutes && (
              <span>
                <Clock3 size={12} />
                {item.estimated_minutes} мин
              </span>
            )}
            {item.deadline && (
              <span className={item.deadline < b!.today ? "overdue" : ""}>
                до {fmt(item.deadline, { day: "numeric", month: "short" })}
              </span>
            )}
            {item.location && <span>{item.location}</span>}
            {item.stale && <span className="stale">Пора пересмотреть</span>}
            {item.no_next_step && (
              <span className="stale">Нет следующих шагов</span>
            )}
            {inherited && page !== "week" && <span>В плане через проект</span>}
            {direct && page !== "week" && <span>Обязательство</span>}
            {entry?.outcome === "moved" && <span>Перенесено</span>}
            {entry?.outcome === "released" && <span>Убрано из плана</span>}
          </span>
        </button>
        <div className="row-actions">
          {commitmentEntryId && item.status === "open" && (
            <button
              title="Снять обязательство"
              aria-label="Снять обязательство"
              disabled={busy}
              onClick={() => removeEntry(commitmentEntryId)}
            >
              <CalendarMinus size={17} />
            </button>
          )}
          {entry?.active && page === "day" && (
            <button
              title="Выше"
              aria-label="Переместить выше"
              onClick={() => {
                const sorted = selectedDayEntries.filter(
                  (x) => x.section === entry.section,
                );
                const index = sorted.findIndex((x) => x.id === entry.id);
                if (index > 0) {
                  void (async () => {
                    for (let k = 0; k < sorted.length; k++) {
                      const position =
                        k === index ? index - 1 : k === index - 1 ? index : k;
                      await mutate(`plans/${sorted[k].id}/organize/`, {
                        position,
                      });
                    }
                  })().catch(() => {});
                }
              }}
            >
              <ChevronUp size={12} />
            </button>
          )}
          {item.status === "open" && item.kind !== "idea" && (
            <button
              title="Запланировать"
              aria-label="Запланировать"
              onClick={() => openSchedule(item)}
            >
              <CalendarDays size={17} />
            </button>
          )}
          <div className="menu-wrap">
            <button
              aria-label="Действия с делом"
              onClick={() => setMenu(!menu)}
            >
              <MoreHorizontal size={20} />
            </button>
            {menu && (
              <>
                <div className="menu-dismiss" onClick={() => setMenu(false)} />
                <div className="dropdown">
                  <button
                    onClick={() => {
                      setEditor({ item });
                      setMenu(false);
                    }}
                  >
                    <Pencil size={14} />
                    Изменить
                  </button>
                  {item.kind === "project" && (
                    <button
                      onClick={() => {
                        setEditor({ parent: item.id });
                        setMenu(false);
                      }}
                    >
                      <Plus size={14} />
                      Добавить шаг
                    </button>
                  )}
                  {item.kind === "project" && item.status === "open" && (
                    <button
                      onClick={() => {
                        setClosure(item);
                        setMenu(false);
                      }}
                    >
                      Обзор перед закрытием
                    </button>
                  )}
                  {item.status !== "open" && (
                    <button
                      onClick={() => {
                        askState(item, "open");
                        setMenu(false);
                      }}
                    >
                      Вернуть в работу
                    </button>
                  )}
                  {item.status === "open" && (
                    <button
                      onClick={() => {
                        askState(item, "graveyard");
                        setMenu(false);
                      }}
                    >
                      Не буду делать
                    </button>
                  )}
                  {entry?.active && item.status === "open" && (
                    <button
                      onClick={() => {
                        removeEntry(entry.id);
                        setMenu(false);
                      }}
                    >
                      Убрать из плана
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
  function EventList({ events, chronological = false }: { events: CalEvent[]; chronological?: boolean }) {
    return (
      <div className="events">
        {[...events].sort((a, b) => chronological
          ? Number(b.all_day) - Number(a.all_day) || Date.parse(a.start) - Date.parse(b.start)
          : Number(a.done) - Number(b.done)).map((e) => (
          <div className={`event-row ${e.done ? "completed" : ""}`} key={e.id}>
            <span className="event-time">
              {e.all_day ? "Весь день" : timeFmt(e.start)}
              {!e.all_day && <small>{timeFmt(e.end)}</small>}
            </span>
            <span className="event-line" />
            <button
              className={`checkbox ${e.done ? "checked" : ""}`}
              aria-label={"Отметить встречу " + e.title}
              disabled={busy}
              onClick={() =>
                void mutate(`events/${e.id}/check/`, { done: !e.done }).catch(
                  () => {},
                )
              }
            >
              {e.done && <Check size={13} />}
            </button>
            <span className="task-title">{e.title}</span>
            {e.url && (
              <a
                href={e.url}
                target="_blank"
                rel="noreferrer"
                aria-label="Открыть событие Google"
              >
                <ExternalLink size={15} />
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
        <Leaf size={34} strokeWidth={1.1} />
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
    );
  }
  const captureOpen = b?.captures.filter((c) => c.status === "open") || [];
  const selectedDayEntries =
    b?.day_entries.filter((e) => match(e.item_detail))
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
    b?.week_rows.filter((r) => r.active && match(r.item))
      .sort((a, b) => compareCompletion(a.item, b.item)) || [];
  const weekDone = weekActive.filter((r) => r.item.status === "done").length;
  const weekDayTasks = (b?.items || []).filter((item) =>
    item.kind === "task" && item.status !== "graveyard" && match(item) &&
    !weekActive.some((row) => row.item.id === item.id) &&
    item.schedule.some((entry) => entry.period === "day" &&
      entry.date >= b!.week && entry.date < addDays(b!.week, 7)),
  ).sort(compareCompletion);

  const weekSections = [
    ...(b?.areas || []).map((a) => ({
      id: String(a.id),
      name: a.name,
      color: a.color,
      rows: weekActive.filter((r) => r.item.areas.includes(a.id)),
      events: eventsForArea(a.name, b?.google.calendars || [], b?.events || []),
    })),
    {
      id: "unassigned",
      name: "Без сферы",
      events: [] as CalEvent[],
      color: "#95a395",
      rows: weekActive.filter((r) => r.item.areas.length === 0),
    },
  ].sort((a, b) => a.name.localeCompare(b.name, "ru") || a.id.localeCompare(b.id));
  function belongsToArea(item: Item, sectionId: string) {
    return sectionId === "unassigned" ? item.areas.length === 0 : item.areas.includes(Number(sectionId));
  }
  function renderAreaHeading(section: typeof weekSections[number], kind: "project" | "idea", count: number) {
    const label = kind === "project" ? "Добавить проект" : "Добавить идею";
    return (
      <div className="card-heading week-area-heading">
        <h3><i style={{ background: section.color }} />{section.name}<span>{count}</span></h3>
        <button className="week-area-add" title={`${label}: ${section.name}`} aria-label={`${label}: ${section.name}`}
          disabled={busy} onClick={() => setEditor({ kind, areas: section.id === "unassigned" ? [] : [Number(section.id)] })}>
          <Plus size={16} />
        </button>
      </div>
    );
  }
  function renderWeeklyNode({ row: r, children }: WeeklyNode<WeekRow>, parentId: string | null = null): React.ReactNode {
    return (
      <div className="week-project-group" key={r.item.id}>
        <ItemRow
          item={r.item}
          inherited={r.inherited}
          direct={r.direct}
          hideAreas
          hideParent={r.item.parent === parentId}
          compact
          contextOnly={r.contextOnly}
          scheduledDay={r.scheduled_day}
          commitmentEntryId={r.direct ? r.entry_id : null}
        />
        {children.length > 0 && (
          <div className="week-project-children">
            {children.map((child) => renderWeeklyNode(child, r.item.id))}
          </div>
        )}
        {r.item.kind === "project" && r.item.status === "open" && (
          <button className="week-project-add" onClick={() => setWeekProject(r.item)}>
            <Plus size={15} /> Добавить дела
          </button>
        )}
      </div>
    );
  }
  const usedSections = new Set(
    [
      ...selectedDayEntries.map((e) => e.section || "Без привязки ко времени"),
      "Без привязки ко времени",
    ],
  );
  const sections = [
    ...(b?.day_sections || []).filter((name) => usedSections.has(name)),
    ...[...usedSections].filter((name) => !b?.day_sections.includes(name)),
  ];
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <Leaf size={22} />
          </span>
          опора<span className="brand-dot">.</span>
        </div>
        <div className="workspace-label">МОЁ ПРОСТРАНСТВО</div>
        <nav>
          {nav.map(([key, label, icon]) => (
            <button
              key={key}
              aria-label={label}
              className={page === key ? "active" : ""}
              onClick={() => {
                setPage(key);
                setArea(null);
                setSearch("");
              }}
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
          <div className="gentle-note">
            <Leaf size={22} />
            <p>
              Не всё нужно делать.
              <br />
              Не всё нужно сегодня.
            </p>
          </div>
          <button
            className={`settings-link ${page === "settings" ? "active" : ""}`}
            onClick={() => setPage("settings")}
          >
            <Settings size={18} />
            Настройки
          </button>
          <button
            className="profile"
            onClick={() =>
              void api("logout/", "POST").then(() => client.invalidateQueries())
            }
          >
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
        <header className="topbar">
          <span>
            Моё пространство <span className="separator">/</span>{" "}
            {nav.find((n) => n[0] === page)?.[1] || "Настройки"}
          </span>
          <div className="topbar-right">
            <span className="today-label">
              {fmt(b?.today || date, {
                day: "numeric",
                month: "long",
                weekday: "short",
              })}
            </span>
            <button
              aria-label="Настройки"
              className="top-settings"
              onClick={() => setPage("settings")}
            >
              <Settings size={17} />
            </button>
            <button
              className="primary small"
              onClick={() => {
                setPage("inbox");
                document.getElementById("capture-input")?.focus();
              }}
            >
              <Plus size={16} />
              Записать мысль
            </button>
          </div>
        </header>
        <div className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "day"
                  ? "ОДИН ДЕНЬ ЗА РАЗ"
                  : page === "week"
                    ? "ВЫБРАТЬ ГЛАВНОЕ"
                    : "ПРОСТРАНСТВО ДЛЯ ЯСНОСТИ"}
              </div>
              <h1>{titles[page]}</h1>
              <p>{subtitles[page]}</p>
            </div>
            {page !== "settings" && (
              <button
                className="secondary"
                onClick={() =>
                  setEditor({
                    plannedDay: page === "day" ? date : undefined,
                    plannedWeek: page === "week" ? b?.week : undefined,
                    kind:
                      page === "projects"
                        ? "project"
                        : page === "ideas"
                          ? "idea"
                          : "task",
                  })
                }
              >
                <Plus size={17} />
                {page === "projects"
                  ? "Новый проект"
                  : page === "ideas"
                    ? "Новая идея"
                    : "Новое дело"}
              </button>
            )}
          </div>
          {notice && (
            <div className="notice" role="status">
              <Check size={17} />
              {notice}
            </div>
          )}
          {error && (
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
          {query.isPending ? (
            <div className="loading">Загружаем дела…</div>
          ) : query.isError ? (
            <div className="error">
              Не удалось загрузить дела.{" "}
              <button onClick={() => query.refetch()}>Повторить</button>
            </div>
          ) : (
            b && (
              <>
                {(page === "day" || page === "week") && (
                  <div className="period-toolbar">
                    <div className="date-controls">
                      <button
                        aria-label="Предыдущий период"
                        onClick={() =>
                          setDate(addDays(date, page === "day" ? -1 : -7))
                        }
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <strong>
                        {page === "day"
                          ? fmt(date, {
                              weekday: "long",
                              day: "numeric",
                              month: "long",
                            })
                          : `Сб, ${fmt(b.week)} — Пт, ${fmt(addDays(b.week, 6))}, вечер`}
                      </strong>
                      <button
                        aria-label="Следующий период"
                        onClick={() =>
                          setDate(addDays(date, page === "day" ? 1 : 7))
                        }
                      >
                        <ChevronRight size={18} />
                      </button>
                      <button
                        className="today-button"
                        onClick={() => setDate(b.today)}
                      >
                        {page === "week" ? "Текущая неделя" : "Сегодня"}
                      </button>
                      <input
                        aria-label="Выбрать дату"
                        type="date"
                        value={date}
                        onChange={(e) =>
                          e.target.value && setDate(e.target.value)
                        }
                      />
                    </div>
                    <span className="period-hint">
                      {page === "day"
                        ? "Гибкий план дня"
                        : "Обязательства недели"}
                    </span>
                  </div>
                )}
                {page !== "settings" && (
                  <div className="filterbar">
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
                      <Plus size={21} />
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
                        Сохранить
                      </button>
                    </form>
                    <div className="content-card">
                      <div className="card-heading">
                        <h2>
                          Неразобранные мысли <span>{captureOpen.length}</span>
                        </h2>
                        <span>Разбирай в своём темпе</span>
                      </div>
                      {captureOpen
                        .filter(
                          (c) =>
                            !search ||
                            c.text.toLowerCase().includes(search.toLowerCase()),
                        )
                        .map((c) => (
                          <div key={c.id} className="capture-row">
                            <div className="capture-mark" />
                            <div>
                              <p>{c.text}</p>
                              {c.results.length > 0 && (
                                <small>Создано дел: {c.results.length}</small>
                              )}
                              <div className="capture-actions">
                                <button
                                  onClick={() => setEditor({ capture: c.id })}
                                >
                                  Создать дело
                                </button>
                                <button
                                  onClick={() =>
                                    setEditor({ capture: c.id, kind: "idea" })
                                  }
                                >
                                  В идеи
                                </button>
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void mutate(`captures/${c.id}/resolve/`, {
                                      status: "processed",
                                    }).catch(() => {})
                                  }
                                >
                                  Разобрано
                                </button>
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void mutate(`captures/${c.id}/resolve/`, {
                                      status: "graveyard",
                                    }).catch(() => {})
                                  }
                                >
                                  Не буду делать
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      {!captureOpen.length && (
                        <Empty
                          title="Можно выдохнуть"
                          text="Новые мысли сохраняй здесь. Решения — когда будет время."
                        />
                      )}
                    </div>
                    <div className="content-card">
                      <div className="card-heading">
                        <h2>
                          Дела без плана <span>{b.inbox_ids.length}</span>
                        </h2>
                        <span>Выбери подходящий период</span>
                      </div>
                      {b.inbox_ids
                        .map((id) => b.items.find((i) => i.id === id)!)
                        .filter(match)
                        .sort(compareCompletion)
                        .map((i) => (
                          <ItemRow key={i.id} item={i} />
                        ))}
                      {!b.inbox_ids.length && (
                        <div className="inline-empty">
                          Все актуальные дела распределены.
                        </div>
                      )}
                    </div>
                  </>
                )}
                {page === "day" && (
                  <div className="day-layout">
                    <div>
                      {!sections.includes("Календарные встречи") && (
                        <div className="content-card">
                          <div className="card-heading">
                            <div className="schedule-heading">
                              {b.google.connected && (
                                <button
                                  className="calendar-refresh"
                                  disabled={busy}
                                  title="Обновить календарь"
                                  aria-label="Обновить календарь"
                                  onClick={() =>
                                    void mutate("google/sync/")
                                      .then(() =>
                                        notify("Расписание обновлено"),
                                      )
                                      .catch(() => {})
                                  }
                                >
                                  <RefreshCw size={15} />
                                </button>
                              )}
                              <h2>Расписание</h2>
                            </div>
                            <span className="source-label">
                              Google Календарь
                            </span>
                          </div>
                          <EventList
                            events={b.events.filter((e) => eventInDay(e, date))}
                          />
                          {!b.events.some((e) => eventInDay(e, date)) && (
                            <div className="inline-empty">
                              {b.google.connected
                                ? "В календаре нет встреч на этот день."
                                : "Подключи календарь в настройках, чтобы видеть встречи."}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="content-card">
                        <div className="card-heading">
                          <h2>
                            Дела на день{" "}
                            <span>{selectedDayEntries.length}</span>
                          </h2>
                          <span>{dayDone} выполнено</span>
                        </div>
                        {sections.map((s) => (
                          <section key={s} className="day-section">
                            <div className="day-section-heading">
                              <h3>{s}</h3>
                              <button
                                className="text-button"
                                aria-label={`Добавить задачу в секцию ${s}`}
                                onClick={() =>
                                  setEditor({
                                    kind: "task",
                                    plannedDay: date,
                                    plannedSection:
                                      s === "Без привязки ко времени" ? "" : s,
                                  })
                                }
                              >
                                <Plus size={14} />
                                Добавить задачу
                              </button>
                            </div>
                            {s === "Календарные встречи" && (
                              <EventList
                                events={b.events.filter((e) =>
                                  eventInDay(e, date),
                                )}
                              />
                            )}
                            {selectedDayEntries
                              .filter(
                                (e) =>
                                  (e.section || "Без привязки ко времени") ===
                                  s,
                              )
                              .map((e) => (
                                <div key={e.id}>
                                  <ItemRow item={e.item_detail} entry={e} hideAreas compact />
                                </div>
                              ))}
                          </section>
                        ))}
                        {!selectedDayEntries.length && (
                          <Empty
                            title="Начни с одного шага"
                            text="Выбери дело из недели или входящих и добавь его на сегодня."
                          />
                        )}
                      </div>
                    </div>
                    <aside className="day-aside">
                      <div className="progress-card">
                        <span className="eyebrow">В ТВОЁМ ТЕМПЕ</span>
                        <h3>
                          {dayDone} <span>из {selectedDayEntries.length}</span>
                        </h3>
                        <p>дел выполнено</p>
                        <div className="progress-track">
                          <i
                            style={{
                              width: `${selectedDayEntries.length ? (dayDone / selectedDayEntries.length) * 100 : 0}%`,
                            }}
                          />
                        </div>
                        <small>
                          Достаточно делать то, что сейчас посильно.
                        </small>
                      </div>
                      <div className="content-card week-pool">
                        <div className="card-heading">
                          <h2>Из плана недели</h2>
                        </div>
                        <p className="aside-description">
                          Открытые шаги без выбранного дня
                        </p>
                        {dayWeekPool.map((r) => (
                            <button
                              key={r.item.id}
                              className="pool-item"
                              onClick={() => openSchedule(r.item)}
                            >
                              <Plus size={15} />
                              <span>{r.item.title}</span>
                            </button>
                          ))}
                        {!dayWeekPool.length && (
                          <div className="inline-empty">
                            Нет дел без выбранного дня.
                          </div>
                        )}
                      </div>
                      <button
                        className="text-button"
                        onClick={() => setPage("inbox")}
                      >
                        <Inbox size={16} />
                        Открыть входящие
                      </button>
                    </aside>
                  </div>
                )}
                {page === "week" && (
                  <>
                    <div className="week-summary">
                      <div>
                        <span className="eyebrow">ОБЯЗАТЕЛЬСТВА</span>
                        <strong>
                          {weekActive.filter((r) => r.direct).length}
                        </strong>
                        <span>выбрано напрямую</span>
                      </div>
                      <div>
                        <span className="eyebrow">ДВИЖЕНИЕ</span>
                        <strong>
                          {weekDone}
                          <small> / {weekActive.length}</small>
                        </strong>
                        <span>дел завершено</span>
                      </div>
                      <div className="summary-note">
                        <Leaf size={28} />
                        <p>
                          Суббота — начало недели.
                          <br />
                          Вечер пятницы — подвести итоги.
                        </p>
                      </div>
                    </div>
                    <div className="content-card">
                      <div className="card-heading">
                        <h2>План недели</h2>
                        <a
                          className="text-button"
                          href={"/api/export/?date=" + date}
                        >
                          <Download size={15} />
                          Markdown
                        </a>
                      </div>
                      {weekSections.map((section) => {
                        const contextRows = b.items.filter((item) => item.kind === "project").map((item): WeekRow => ({
                          item, contextOnly: true, scheduled_day: null, direct: false,
                          inherited: false, active: false, entry_id: null, outcome: "", reason: "",
                        }));
                        const days = Array.from({ length: 7 }, (_, i) => addDays(b.week, i));
                        const dayTrees = new Map(days.map((day) => [day, groupWeeklyRows(
                          section.rows.filter((row) => row.scheduled_day === day), contextRows,
                        )]));
                        const datedProjectIds = new Set<string>();
                        function collectProjects(nodes: WeeklyNode<WeekRow>[]) {
                          for (const node of nodes) {
                            if (node.row.item.kind === "project") datedProjectIds.add(node.row.item.id);
                            collectProjects(node.children);
                          }
                        }
                        for (const nodes of dayTrees.values()) collectProjects(nodes);
                        const undatedTree = omitWeeklyProjects(groupWeeklyRows(
                          section.rows.filter((row) => !row.scheduled_day), contextRows,
                        ), datedProjectIds);
                        return (
                        <section className="week-area-section" key={section.id}>
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
                              onClick={() => setEditor({
                                kind: "task",
                                plannedWeek: b.week,
                                areas: section.id === "unassigned" ? [] : [Number(section.id)],
                              })}
                            >
                              <Plus size={16} />
                            </button>
                          </div>
                          {Array.from({ length: 7 }, (_, i) => addDays(b.week, i)).map((day) => {
                            const rows = section.rows.filter((row) => row.scheduled_day === day);
                            const events = section.events.filter((event) => eventInDay(event, day));
                            return rows.length > 0 || events.length > 0 ? (
                              <div className="calendar-day week-area-events" key={day}>
                                <h3>{fmt(day, {
                                  weekday: "short",
                                  day: "numeric",
                                  month: "short",
                                })}</h3>
                                {dayTrees.get(day)!.map((node) => renderWeeklyNode(node))}
                                <EventList events={events} chronological />
                              </div>
                            ) : null;
                          })}
                          {undatedTree.map((node) => renderWeeklyNode(node))}
                          {!section.rows.length && !section.events.length && (
                            <p className="week-area-empty">В этой сфере пока нет дел и событий на неделю</p>
                          )}
                        </section>
                        );
                      })}
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
                    <div className="content-card">
                      <div className="card-heading">
                        <h2>Дела по дням без обязательств</h2>
                        <span>{weekDayTasks.length}</span>
                      </div>
                      <p className="aside-description">
                        Назначены на дни этой недели и не входят в её обязательства.
                      </p>
                      {Array.from({ length: 7 }, (_, i) => addDays(b.week, i)).map((day) => {
                        const tasks = weekDayTasks.filter((item) => item.schedule.some(
                          (entry) => entry.period === "day" && entry.date === day,
                        ));
                        return tasks.length > 0 ? (
                          <div className="calendar-day" key={day}>
                            <h3>{fmt(day, { weekday: "short", day: "numeric", month: "short" })}</h3>
                            {weekSections.map((section) => {
                              const areaTasks = tasks.filter((item) => belongsToArea(item, section.id));
                              return areaTasks.length > 0 ? (
                                <section className="week-area-section" key={section.id}>
                                  <div className="card-heading week-area-heading">
                                    <h3><i style={{ background: section.color }} />{section.name}<span>{areaTasks.length}</span></h3>
                                  </div>
                                  {areaTasks.map((item) => <ItemRow key={item.id} item={item} compact hideAreas scheduledDay={day} />)}
                                </section>
                              ) : null;
                            })}
                          </div>
                        ) : null;
                      })}
                      {!weekDayTasks.length && (
                        <p className="week-area-empty">На дни этой недели нет дел вне обязательств.</p>
                      )}
                    </div>
                    <div className="content-card">
                      <div className="card-heading">
                        <div className="schedule-heading">
                              {b.google.connected && (
                                <button
                                  className="calendar-refresh"
                                  disabled={busy}
                                  title="Обновить календарь"
                                  aria-label="Обновить календарь"
                                  onClick={() =>
                                    void mutate("google/sync/")
                                      .then(() =>
                                        notify("Расписание обновлено"),
                                      )
                                      .catch(() => {})
                                  }
                                >
                                  <RefreshCw size={15} />
                                </button>
                              )}
                              <h2>Календарь недели</h2>
                            </div>
                      </div>
                      {Array.from({ length: 7 }, (_, i) =>
                        addDays(b.week, i),
                      ).map((d) => (
                        <div className="calendar-day" key={d}>
                          <h3>
                            {fmt(d, {
                              weekday: "short",
                              day: "numeric",
                              month: "short",
                            })}
                            {d === b.week && (
                              <small className="week-edge">Начало недели</small>
                            )}
                            {d === addDays(b.week, 6) && (
                              <small className="week-edge">
                                Вечером — итоги недели
                              </small>
                            )}
                          </h3>
                          <EventList
                            events={b.events.filter((e) => eventInDay(e, d))}
                            chronological
                          />
                          {!b.events.some((e) => eventInDay(e, d)) && (
                            <span className="muted">Нет встреч</span>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="content-card">
                      <div className="card-heading">
                        <h2>Итог прошлой недели</h2>
                        <button
                          className="text-button"
                          onClick={() => setDate(addDays(b.week, -7))}
                        >
                          Посмотреть прошлую неделю
                        </button>
                      </div>
                    </div>
                  </>
                )}
                {page === "projects" && (
                  <div className="content-card">
                    <div className="card-heading">
                      <h2>Проекты и шаги</h2>
                      <span>
                        {
                          b.items.filter(
                            (i) => i.kind === "project" && i.status === "open",
                          ).length
                        }{" "}
                        открытых проектов
                      </span>
                    </div>
                    {weekSections.map((section) => {
                      const projects = b.items.filter((i) =>
                        i.parent === null && i.kind === "project" && i.status !== "graveyard" &&
                        belongsToArea(i, section.id) && (match(i) || b.items.some((c) => c.parent === i.id && match(c))),
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
                              (parent !== null || (i.kind === "project" && belongsToArea(i, section.id))),
                          )
                          .filter(
                            (i) =>
                              match(i) ||
                              b!.items.some(
                                (c) => c.parent === i.id && match(c),
                              ),
                          )
                          .sort(compareCompletion)
                          .map((i) => (
                            <div
                              key={i.id}
                              className="tree-node"
                              data-depth={depth}
                            >
                              <ItemRow item={i} hideAreas hideParent />
                              {i.kind === "project" && (
                                <>
                                  <div className="project-children">{tree(i.id, depth + 1)}</div>
                                  <button
                                    className="add-child"
                                    onClick={() => setEditor({ parent: i.id })}
                                  >
                                    <Plus size={14} />
                                    Следующий шаг
                                  </button>
                                </>
                              )}
                            </div>
                          ));
                      }
                      return (
                        <section className="week-area-section" key={section.id}>
                          {renderAreaHeading(section, "project", projects.length)}
                          {tree(null, 0)}
                          {!projects.length && <p className="week-area-empty">В этой сфере пока нет проектов</p>}
                        </section>
                      );
                    })}
                  </div>
                )}
                {page === "ideas" && (
                  <div className="content-card">
                    <div className="card-heading">
                      <h2>Идеи без обязательств</h2>
                      <span>Можно просто хранить</span>
                    </div>
                    {weekSections.map((section) => {
                      const ideas = b.items.filter((i) =>
                        i.kind === "idea" && i.status === "open" && match(i) && belongsToArea(i, section.id),
                      );
                      return (
                        <section className="week-area-section" key={section.id}>
                          {renderAreaHeading(section, "idea", ideas.length)}
                          {ideas.map((i) => <ItemRow key={i.id} item={i} hideAreas />)}
                          {!ideas.length && <p className="week-area-empty">В этой сфере пока нет идей</p>}
                        </section>
                      );
                    })}
                  </div>
                )}
                {page === "graveyard" && (
                  <div className="content-card">
                    <div className="card-heading">
                      <h2>Отпущенные дела</h2>
                      <span>Решение можно изменить</span>
                    </div>
                    {b.items
                      .filter((i) => i.status === "graveyard" && match(i))
                      .map((i) => (
                        <ItemRow key={i.id} item={i} />
                      ))}
                    {b.captures
                      .filter((c) => c.status === "graveyard")
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
                    {!b.items.some((i) => i.status === "graveyard") &&
                      !b.captures.some((c) => c.status === "graveyard") && (
                        <Empty
                          title="Здесь пока пусто"
                          text="Отказ от ненужного освобождает место для важного."
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
                          Для подключения сначала укажи настройки Google OAuth
                          на сервере. Порядок описан в README проекта.
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
                              <RefreshCw size={15} />
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
                                  .then(() => notify("Список календарей обновлён"))
                                  .catch(() => {})
                              }
                            >
                              <RefreshCw size={15} />
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
          <footer>опора · место для важного</footer>
        </div>
      </main>
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
              title, kind: "task", parent: weekProject.id,
              areas: weekProject.areas, planned_week: b.week,
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
          onClose={() => setEditor(null)}
          onSave={async (values) => {
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
          onState={askState}
          onPlan={openSchedule}
          onChangeSection={(entry) => {
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
                <option value="week">
                  Неделя · Сб–Пт — завершить к вечеру пятницы
                </option>
              </select>
            </label>
            <label>
              {period === "day"
                ? "Дата"
                : "Любой день недели с субботы по пятницу"}
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
                notify("Решение сохранено");
              } catch {}
            }}
          >
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
                Подтвердить
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
              <ItemRow key={i.id} item={i} hideParent={i.parent === closure.id} />
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
                Не буду делать
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
  React.useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="modal-backdrop" style={{ zIndex: layer }} onClick={onClose}>
      <section
        className={`modal ${wide ? "wide" : ""} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button aria-label="Закрыть" onClick={onClose}>
            <X size={21} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function WeekProjectPicker({ project, board, onClose, onPlan, onCreate }: {
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
  const candidates = board.items.filter((i) =>
    i.parent === project.id && i.kind === "task" && i.status === "open",
  );
  const planned = new Set(board.week_rows.filter((r) => r.active && r.direct).map((r) => r.item.id));
  async function save(action: () => Promise<void>) {
    setSaving(true);
    setError("");
    try { await action(); } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }
  return (
    <Modal title="Добавить дела в неделю" onClose={() => { if (!saving) onClose(); }}>
      <p className="modal-subtitle">{project.title} · {fmt(board.week)} – {fmt(addDays(board.week, 6))}</p>
      <label>Существующие дела
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Найти дело проекта" />
      </label>
      <div className="week-project-picker-list">
        {candidates.filter((i) => i.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((i) => (
          <label className="week-project-choice" key={i.id}>
            <input type="checkbox" disabled={saving || planned.has(i.id)} checked={planned.has(i.id) || selected.includes(i.id)} onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, i.id] : ids.filter((id) => id !== i.id))} />
            <span>{i.title}{planned.has(i.id) && <small className="muted"> · Уже в плане</small>}</span>
          </label>
        ))}
        {candidates.length === 0 && <p className="muted">У проекта пока нет открытых задач. Создай первое дело ниже.</p>}
      </div>
      <form onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) void save(async () => { await onCreate(title.trim()); setTitle(""); });
      }}>
        <label>Новое дело
          <input autoFocus required maxLength={500} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Что сделать по проекту?" />
        </label>
        <button className="primary" disabled={saving || !title.trim()}>Создать и добавить в неделю</button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="button-row">
        <button className="primary" disabled={saving || selected.length === 0} onClick={() => void save(async () => {
          for (const id of selected) {
            await onPlan(id);
            setSelected((ids) => ids.filter((value) => value !== id));
          }
        })}>Добавить выбранные ({selected.length})</button>
        <button disabled={saving} onClick={onClose}>Готово</button>
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
      item?.areas ?? board.items.find((i) => i.id === initial.parent)?.areas ?? initial.areas ?? [],
    ),
    [comment, setComment] = useState(item?.comment || ""),
    [deadline, setDeadline] = useState(item?.deadline || ""),
    [available, setAvailable] = useState(item?.available_from || ""),
    [location, setLocation] = useState(item?.location || ""),
    [tags, setTags] = useState(item?.tags.join(", ") || ""),
    [minutes, setMinutes] = useState(item?.estimated_minutes?.toString() || ""),
    [localError, setLocalError] = useState("");
  const forbiddenParents = new Set<string>();
  if (item) {
    forbiddenParents.add(item.id);
    let frontier = [item.id];
    while (frontier.length) {
      frontier = board.items
        .filter((candidate) => candidate.parent && frontier.includes(candidate.parent) && !forbiddenParents.has(candidate.id))
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
            });
          } catch (e) {
            setLocalError((e as Error).message);
          }
        }}
      >
        <div className="item-editor-fields">
          <label>
            Название
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
                  if (!item) setAreas(board.items.find((i) => i.id === e.target.value)?.areas || []);
                }}
              >
                <option value="">Самостоятельное дело</option>
                {board.items
                  .filter((i) => i.kind === "project" && i.status === "open" && !forbiddenParents.has(i.id))
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.title}
                    </option>
                  ))}
              </select>
            </label>
          </div>
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
          <label>
            Сферы жизни <span className="muted">· можно несколько</span>
          </label>
          <div className="area-chips">
            {board.areas.map((a) => (
              <button
                type="button"
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
                {areas.includes(a.id) && <Check size={12} />}
              </button>
            ))}
          </div>
          <label>
            Комментарий
            <textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Зачем это нужно? Что важно помнить?"
            />
          </label>
          <details className="editor-additional">
            <summary>Дополнительно</summary>
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
  buried: "На кладбище",
  restored: "Восстановлено",
  plan_released: "Убрано из плана",
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

function ProjectContents({ project, board, onSelect, onPlan }: {
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
    const items = [...(children.get(parent) || [])].sort((a, b) =>
      ({ open: 0, done: 1, graveyard: 2 }[a.status]) -
      ({ open: 0, done: 1, graveyard: 2 }[b.status]),
    ).filter((item) => !visited.has(item.id));
    if (!items.length) return null;
    return <ul className="project-detail-list">{items.map((child) => {
      visited.add(child.id);
      return <li key={child.id}>
        <div className={`project-detail-row status-${child.status}`}>
          <div className="project-detail-content">
            <button className="detail-step" onClick={() => onSelect(child)}>
              <span>{child.kind === "project" && <FolderOpen size={14} />} {child.title}</span>
              <ChevronRight size={16} />
            </button>
            <div className="project-detail-meta">
              <span className={`project-detail-status status-${child.status}`}>
                {child.status === "open" ? "Открыто" : child.status === "done" ? "Выполнено" : "На кладбище"}
              </span>
              {child.schedule.length === 0 && <span>Не запланировано</span>}
              {preciseSchedule(child.schedule).map((plan) => <span key={`${plan.period}-${plan.date}`}>
                <CalendarDays size={13} />
                {plan.period === "week"
                  ? `Неделя: ${fmt(plan.date)} – ${fmt(addDays(plan.date, 6))}`
                  : fmt(plan.date, { day: "numeric", month: "long", year: "numeric" })}
                {plan.inherited && " · через проект"}
              </span>)}
              {child.deadline && <span>Дедлайн: {fmt(child.deadline)}</span>}
            </div>
          </div>
          {child.status === "open" && child.kind !== "idea" && <button
            className="secondary project-detail-plan"
            onClick={() => onPlan(child)}
            aria-label={`Запланировать: ${child.title}`}
            title="Запланировать"
          ><CalendarDays size={14} /></button>}
        </div>
        {renderChildren(child.id)}
      </li>;
    })}</ul>;
  }
  return children.has(project.id)
    ? renderChildren(project.id)
    : <p className="muted">В проекте пока нет дел. Добавь первый шаг.</p>;
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
  const hasChildren = board.items.some((candidate) => candidate.parent === item.id);
  const dayEntry = board.day_entries.find(
    (entry) => entry.item === item.id && entry.active,
  );
  return (
    <Modal layer={40} title={kindLabel[item.kind]} onClose={onClose} wide>
      <h2 className="detail-title">{item.title}</h2>
      <div className="button-row">
        <button className="secondary" onClick={() => onEdit(item)}>
          <Pencil size={15} />
          Изменить
        </button>
        {item.status === "open" && item.kind !== "idea" && (
          <button className="primary" onClick={() => onPlan(item)}>
            Запланировать
          </button>
        )}
        {dayEntry && (
          <button
            className="secondary"
            onClick={() => onChangeSection(dayEntry)}
          >
            Изменить секцию
          </button>
        )}
        <button
          disabled={item.kind === "idea" && item.status === "open"}
          className="text-button"
          onClick={() =>
            onState(item, item.status === "open" ? "done" : "open")
          }
        >
          {item.status === "open" ? "Завершить" : "Открыть повторно"}
        </button>
      </div>
      {item.kind === "idea" && (
        <div className="info">
          Чтобы реализовать идею, измени её тип на задачу или проект.
        </div>
      )}
      <dl className="detail-fields">
        <dt>Состояние</dt>
        <dd>
          {item.status === "open"
            ? "Открыто"
            : item.status === "done"
              ? "Выполнено"
              : "На кладбище"}
        </dd>
        {parent && (
          <>
            <dt>Родитель</dt>
            <dd>
              <button className="detail-parent-link" onClick={() => onSelect(parent)}>
                <ChevronLeft size={15} />
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
          <ProjectContents project={item} board={board} onSelect={onSelect} onPlan={onPlan} />
          {item.kind === "project" && <button className="add-child" onClick={() => onAdd(item)}>
            <Plus size={14} /> Следующий шаг
          </button>}
        </section>
      )}
      <div className="history">
        <h3>
          <History size={16} />
          История
        </h3>
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
      </div>
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
