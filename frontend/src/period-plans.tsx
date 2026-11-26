import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  CalendarMinus,
} from "lucide-react";
import { ActionMenu, Disclosure } from "./ui";
import {
  type Api,
  labels,
  shortDate,
  previousPeriod,
  useAction,
  ErrorNotice,
} from "./workspace-ui";

type PlanningItem = {
  id: string;
  title: string;
  kind: string;
  status: string;
  areas: number[];
  parent: string | null;
};
type PlanningEntry = {
  id: string;
  item: string;
  item_detail: PlanningItem;
  active: boolean;
  outcome: string;
  date: string;
};
type Planning = {
  start: string;
  end: string;
  entries: PlanningEntry[];
  suggestions: {
    item: PlanningItem;
    source_date: string;
    source_period: string;
    source_project: string | null;
  }[];
  previous: PlanningEntry[];
};
export function PlanningPanel({
  api,
  period,
  date,
  today,
  items,
  area,
  search,
  onOpen,
}: {
  api: Api;
  period: "week" | "month" | "quarter";
  date: string;
  today: string;
  items: PlanningItem[];
  area: number | null;
  search: string;
  onOpen: (id: string) => void;
}) {
  const query = useQuery<Planning>({
    queryKey: ["planning", period, date],
    queryFn: () => api(`planning/?period=${period}&date=${date}`),
  });
  const { run, busy, error } = useAction(api);
  const [pick, setPick] = useState("");
  const b = query.data;
  const match = (i: PlanningItem) =>
    (!area || i.areas.includes(area)) &&
    i.title.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  const select = (id: string) => run(`items/${id}/plan/`, { period, date });
  const past = b ? b.end <= today : false;
  const available = items.filter(
    (i) =>
      i.status === "open" &&
      i.kind !== "idea" &&
      match(i) &&
      !b?.entries.some((e) => e.item === i.id && e.active),
  );
  return (
    <>
      <ErrorNotice
        error={
          error || (query.isError ? "Не удалось загрузить предложения." : "")
        }
      />
      {b && (
        <>
          {period !== "week" && (
            <div className="content-card v2-planning-card">
              <div className="card-heading">
                <h2>Возможные дела</h2>
                <span>Предложения · без обязательств</span>
              </div>
              {!past && (
                <form
                  className="v2-plan-picker"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (pick)
                      void select(pick)
                        .then(() => setPick(""))
                        .catch(() => {});
                  }}
                >
                  <label className="v2-sr-only" htmlFor="period-item">
                    Дело для плана
                  </label>
                  <select
                    id="period-item"
                    value={pick}
                    onChange={(e) => setPick(e.target.value)}
                    required
                  >
                    <option value="">Выбери задачу или проект</option>
                    {available.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.kind === "project" ? "Проект · " : ""}
                        {i.title}
                      </option>
                    ))}
                  </select>
                  <button className="primary" disabled={busy || !pick}>
                    Добавить
                  </button>
                </form>
              )}
              {b.entries
                .filter((e) => match(e.item_detail))
                .map((e) => (
                  <div
                    className={`task-row ${!e.active ? "archived-entry" : ""}`}
                    key={e.id}
                  >
                    <button
                      className="task-content"
                      onClick={() => onOpen(e.item)}
                    >
                      <span className="task-title">
                        {e.item_detail.kind === "project" && (
                          <FolderOpen size={16} />
                        )}
                        {e.item_detail.title}
                      </span>
                      <span className="task-meta">
                        {e.item_detail.status === "done" && "Выполнено"}
                        {!e.active && "Снято с плана"}
                      </span>
                    </button>
                    {e.active && (
                      <ActionMenu label={`Действия: ${e.item_detail.title}`}>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(`plans/${e.id}/release/`).catch(() => {})
                          }
                        >
                          <CalendarMinus size={16} />
                          {period === "month"
                            ? "Снять с месяца"
                            : "Снять с квартала"}
                        </button>
                      </ActionMenu>
                    )}
                  </div>
                ))}
              {!b.entries.length && (
                <p className="inline-empty">
                  Здесь можно наметить возможные занятия.
                </p>
              )}
            </div>
          )}
          {!!b.suggestions.filter((s) => match(s.item)).length && (
            <Disclosure
              title={
                period === "week" ? "Из планов месяца" : "Из плана квартала"
              }
              count={b.suggestions.filter((s) => match(s.item)).length}
            >
              {b.suggestions
                .filter((s) => match(s.item))
                .map((s) => (
                  <div className="task-row" key={s.item.id}>
                    <button
                      className="task-content"
                      onClick={() => onOpen(s.item.id)}
                    >
                      <span className="task-title">{s.item.title}</span>
                      <span className="task-meta">
                        {labels[s.source_period]} · {shortDate(s.source_date)}
                        {s.source_project && " · шаг проекта"}
                      </span>
                    </button>
                    <button
                      className="secondary small"
                      disabled={busy || past}
                      onClick={() => void select(s.item.id).catch(() => {})}
                    >
                      В {period === "week" ? "неделю" : "месяц"}
                    </button>
                  </div>
                ))}
            </Disclosure>
          )}
          {period !== "week" &&
            !!b.previous.filter((e) => match(e.item_detail)).length && (
              <details className="content-card v2-history">
                <summary>
                  Незавершённое из прошлых периодов · {b.previous.length}
                </summary>
                <p className="muted">
                  Перенос выполняется только по твоему выбору.
                </p>
                {b.previous
                  .filter((e) => match(e.item_detail))
                  .map((e) => (
                    <div className="task-row" key={e.id}>
                      <button
                        className="task-content"
                        onClick={() => onOpen(e.item)}
                      >
                        {e.item_detail.title}
                        <span className="task-meta">
                          {shortDate(e.date)} · {labels[period]}
                        </span>
                      </button>
                      <button
                        className="secondary small"
                        disabled={busy || past}
                        onClick={() =>
                          void run(`plans/${e.id}/transfer/`, {
                            period,
                            date,
                          }).catch(() => {})
                        }
                      >
                        Перенести сюда
                      </button>
                    </div>
                  ))}
              </details>
            )}
        </>
      )}
      {query.isPending && <p>Загружаем предложения…</p>}
    </>
  );
}
export function LargePeriodToolbar({
  period,
  date,
  today,
  setDate,
}: {
  period: "month" | "quarter";
  date: string;
  today: string;
  setDate: (date: string) => void;
}) {
  const d = new Date(date + "T12:00:00Z");
  const title =
    period === "month"
      ? d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
      : `${Math.floor(d.getUTCMonth() / 3) + 1} квартал ${d.getUTCFullYear()}`;
  return (
    <div className="period-toolbar">
      <div className="date-controls">
        <button
          aria-label="Предыдущий период"
          onClick={() => setDate(previousPeriod(date, period, -1))}
        >
          <ChevronLeft size={16} />
        </button>
        <strong>{title}</strong>
        <button
          aria-label="Следующий период"
          onClick={() => setDate(previousPeriod(date, period, 1))}
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <button className="secondary" onClick={() => setDate(today)}>
        Сегодня
      </button>
    </div>
  );
}
