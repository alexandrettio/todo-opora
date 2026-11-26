import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Check, Pencil, RefreshCw, Pause, History } from "lucide-react";
import { ActionMenu, IconButton } from "./ui";
import {
  type Api,
  type Area,
  counterLabels,
  shortDate,
  addDays,
  useAction,
  ErrorNotice,
  Dialog,
} from "./workspace-ui";

type Definition = {
  id?: string;
  effective_from: string;
  title: string;
  areas: number[];
  section: string;
  archived: boolean;
  start_date: string;
  mode: "weekdays" | "interval" | "monthdays" | "after";
  interval: number;
  weekdays: number[];
  monthdays: number[];
  last_day: boolean;
  target: number;
  counter_period: "day" | "week" | "month";
};
export type Cell = {
  date: string;
  expected: boolean;
  paused: boolean;
  due_date: string | null;
  count: number;
  state: string;
  total: number;
  target: number;
  reached: boolean;
  counter_period: string;
  section: string;
  note: string;
  title: string;
  areas: number[];
};
export type Habit = {
  id: string;
  definition: Definition | null;
  versions: Definition[];
  pauses: { id: string; start: string; end: string; cancelled: boolean }[];
  logs: {
    date: string;
    count: number;
    state: string;
    section: string | null;
    note: string;
  }[];
  cells: Cell[];
};
export type HabitBoard = { date: string; week: string; habits: Habit[] };
export function HabitLogEditor({
  habit,
  date,
  today,
  sections,
  api,
  close,
}: {
  habit: Habit;
  date: string;
  today: string;
  sections: string[];
  api: Api;
  close: () => void;
}) {
  const [day, setDay] = useState(date);
  const existing = habit.logs.find((l) => l.date === day);
  const [count, setCount] = useState(existing?.count || 0),
    [state, setState] = useState(existing?.state || "unrecorded"),
    [section, setSection] = useState(existing?.section ?? "__default__"),
    [note, setNote] = useState(existing?.note || "");
  const { run, busy, error } = useAction(api);
  const changeDay = (value: string) => {
    setDay(value);
    const log = habit.logs.find((l) => l.date === value);
    setCount(log?.count || 0);
    setState(log?.state || "unrecorded");
    setSection(log?.section ?? "__default__");
    setNote(log?.note || "");
  };
  return (
    <Dialog title={habit.definition?.title || "Запись привычки"} close={close}>
      <form
        className="v2-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await run(`habits/${habit.id}/log/`, {
              date: day,
              section: section === "__default__" ? null : section,
              ...(day <= today
                ? { count: state === "recorded" ? count : 0, state, note }
                : {}),
            });
            close();
          } catch {}
        }}
      >
        <p className="muted">
          Можно записать факт вне расписания, исправить прошлое или превысить
          ориентир.
        </p>
        <label>
          Дата
          <input
            type="date"
            required
            value={day}
            min={habit.versions[0]?.effective_from}
            onChange={(e) => changeDay(e.target.value)}
          />
        </label>
        {day > today && (
          <p className="muted">
            Для будущего дня можно выбрать секцию. Факты доступны после его
            начала.
          </p>
        )}
        {day <= today && (
          <>
            <label>
              Наблюдение
              <select value={state} onChange={(e) => setState(e.target.value)}>
                <option value="recorded">Количество, включая явный ноль</option>
                <option value="skipped">Осознанно пропущено</option>
                <option value="unrecorded">Нет записи</option>
              </select>
            </label>
            {state === "recorded" && (
              <label>
                Количество за этот день
                <input
                  type="number"
                  required
                  min="0"
                  max="1000000"
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
              </label>
            )}
          </>
        )}
        <label>
          Секция на этот день
          <select value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="__default__">По настройке привычки</option>
            <option value="">Без привязки ко времени</option>
            {[
              ...new Set([
                ...sections,
                ...(section && section !== "__default__" ? [section] : []),
              ]),
            ].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {day <= today && (
          <label>
            Заметка
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
          </label>
        )}
        <ErrorNotice error={error} />
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={close}>
            Отмена
          </button>
          <button className="primary" disabled={busy}>
            Сохранить
          </button>
        </div>
      </form>
      <details className="v2-history">
        <summary>История наблюдений</summary>
        {habit.logs
          .filter((l) => l.state !== "unrecorded")
          .slice()
          .reverse()
          .map((l) => (
            <button
              className="pool-item"
              key={l.date}
              onClick={() => changeDay(l.date)}
            >
              {shortDate(l.date)} ·{" "}
              {l.state === "skipped" ? "пропущено" : l.count}
              {l.note && ` · ${l.note}`}
            </button>
          ))}
      </details>
    </Dialog>
  );
}
export function HabitDayRows({
  habits,
  date,
  today,
  section,
  sections,
  area,
  search,
  api,
}: {
  habits: Habit[];
  date: string;
  today: string;
  section: string;
  sections: string[];
  area: number | null;
  search: string;
  api: Api;
}) {
  const [editing, setEditing] = useState<Habit | null>(null);
  const { run, busy, error } = useAction(api);
  return (
    <>
      <ErrorNotice error={error} />
      {habits.map((h) => {
        const cell = h.cells.find((c) => c.date === date);
        if (
          !cell ||
          !(cell.expected || cell.state !== "unrecorded") ||
          (cell.section || "Без привязки ко времени") !== section ||
          (area && !cell.areas.includes(area)) ||
          !cell.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())
        )
          return null;
        return (
          <div
            key={h.id}
            className={`task-row habit-row ${cell.reached ? "habit-reached" : ""}`}
          >
            <RefreshCw
              className="row-kind-icon"
              size={20}
              aria-label="Привычка"
            />
            <button className="task-content" onClick={() => setEditing(h)}>
              <span className="task-title">{cell.title}</span>
              {(cell.state === "skipped" || cell.paused || !cell.expected) && (
                <span className="task-meta">
                  {cell.state === "skipped"
                    ? "Пропущено"
                    : cell.paused
                      ? "Пауза"
                      : "Вне расписания"}
                </span>
              )}
            </button>
            <span
              className="habit-count"
              aria-label={`${cell.total} из ${cell.target} ${counterLabels[cell.counter_period]}${cell.reached ? ", ориентир достигнут" : ""}`}
              title={counterLabels[cell.counter_period]}
            >
              {cell.reached && <Check size={16} />}
              {cell.total}/{cell.target}
              <span className="counter-period">
                {counterLabels[cell.counter_period]}
              </span>
            </span>
            <IconButton
              label={`Ещё одно выполнение: ${cell.title}`}
              disabled={busy || date > today}
              onClick={() =>
                void run(`habits/${h.id}/log/`, { date, delta: 1 }).catch(
                  () => {},
                )
              }
            >
              <Plus size={20} />
            </IconButton>
          </div>
        );
      })}
      {editing && (
        <HabitLogEditor
          habit={editing}
          date={date}
          today={today}
          sections={sections}
          api={api}
          close={() => setEditing(null)}
        />
      )}
    </>
  );
}
export function HabitWeek({
  habits,
  week,
  today,
  areas,
  sections,
  area,
  search,
  api,
}: {
  habits: Habit[];
  week: string;
  today: string;
  areas: Area[];
  sections: string[];
  area: number | null;
  search: string;
  api: Api;
}) {
  const [editing, setEditing] = useState<{ habit: Habit; date: string } | null>(
    null,
  );
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const groups = [...areas, { id: 0, name: "Без сферы", color: "#aaa" }].filter(
    (a) => !area || a.id === area,
  );
  return (
    <div className="content-card v2-habit-week">
      <div className="card-heading">
        <h2>Наблюдения за привычками</h2>
        <span>Факты по дням · без обязательств</span>
      </div>
      {groups.map((a) => {
        const rows = habits.filter((h) =>
          h.cells.some(
            (c) =>
              days.includes(c.date) &&
              (c.expected || c.state !== "unrecorded") &&
              (a.id ? c.areas.includes(a.id) : !c.areas.length) &&
              c.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
          ),
        );
        if (!rows.length) return null;
        return (
          <section key={a.id}>
            <h3>{a.name}</h3>
            <div className="v2-table-wrap">
              <table className="v2-habit-table">
                <thead>
                  <tr>
                    <th>Привычка</th>
                    {days.map((d) => (
                      <th key={d}>{shortDate(d)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((h) => (
                    <tr key={h.id}>
                      <th>
                        {h.cells.find((c) => days.includes(c.date))?.title ||
                          h.definition?.title}
                      </th>
                      {days.map((d) => {
                        const c = h.cells.find((c) => c.date === d);
                        const visible =
                          c &&
                          (a.id ? c.areas.includes(a.id) : !c.areas.length);
                        const text = !visible
                          ? "—"
                          : c.state === "skipped"
                            ? "Пропуск"
                            : c.state === "recorded"
                              ? `${c.count}`
                              : c.expected
                                ? "·"
                                : "—";
                        return (
                          <td key={d}>
                            <button
                              title={
                                visible
                                  ? `${c.title}: ${text}; ${c.total}/${c.target} ${counterLabels[c.counter_period]}${c.paused ? "; пауза" : ""}`
                                  : "Нет наблюдения"
                              }
                              className={
                                visible && c.reached ? "habit-reached" : ""
                              }
                              disabled={!c || d > today}
                              onClick={() => setEditing({ habit: h, date: d })}
                            >
                              {text}
                              {visible && c.state === "recorded" && (
                                <small>
                                  {c.total}/{c.target}{" "}
                                  {counterLabels[c.counter_period]}
                                </small>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {!habits.some((h) =>
        h.cells.some((c) => c.expected || c.state !== "unrecorded"),
      ) && <p className="inline-empty">В эту неделю пока нет наблюдений.</p>}
      <p className="muted v2-table-legend">
        · ожидается, записи нет · 0 — явно записан ноль · — вне расписания.
        Нажми ячейку, чтобы записать или исправить факт.
      </p>
      {editing && (
        <HabitLogEditor
          habit={editing.habit}
          date={editing.date}
          today={today}
          sections={sections}
          api={api}
          close={() => setEditing(null)}
        />
      )}
    </div>
  );
}
function HabitEditor({
  habit,
  today,
  areas,
  sections,
  api,
  close,
}: {
  habit?: Habit;
  today: string;
  areas: Area[];
  sections: string[];
  api: Api;
  close: () => void;
}) {
  const initial =
    habit?.definition || habit?.versions[habit.versions.length - 1];
  const [form, setForm] = useState<Definition>(
    initial
      ? { ...initial, effective_from: today }
      : {
          effective_from: today,
          title: "",
          areas: [],
          section: "",
          archived: false,
          start_date: today,
          mode: "weekdays",
          interval: 1,
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          monthdays: [],
          last_day: false,
          target: 1,
          counter_period: "day",
        },
  );
  const { run, busy, error } = useAction(api);
  function set<K extends keyof Definition>(key: K, value: Definition[K]) {
    setForm((old) => ({ ...old, [key]: value }));
  }
  return (
    <Dialog
      title={habit ? "Настроить привычку" : "Новая привычка"}
      close={close}
    >
      <form
        className="v2-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const { id: _id, ...payload } = form;
            await run(
              habit ? `habits/${habit.id}/revise/` : "habits/",
              habit
                ? payload
                : { ...payload, effective_from: payload.start_date },
            );
            close();
          } catch {}
        }}
      >
        <label>
          Название
          <input
            required
            maxLength={500}
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </label>
        <div className="v2-form-grid">
          {habit && (
            <label>
              Изменения действуют с
              <input
                type="date"
                required
                value={form.effective_from}
                onChange={(e) => set("effective_from", e.target.value)}
              />
            </label>
          )}
          <label>
            Первая ожидаемая дата
            <input
              type="date"
              required
              value={form.start_date}
              onChange={(e) => set("start_date", e.target.value)}
            />
          </label>
        </div>
        <p className="muted">
          Прежние даты сохраняют своё расписание. Изменение с даты существующей
          версии заменяет её.
        </p>
        <label>
          Повторение
          <select
            value={form.mode}
            onChange={(e) =>
              setForm((old) => ({
                ...old,
                mode: e.target.value as Definition["mode"],
                ...(e.target.value === "after"
                  ? { target: 1, counter_period: "day" as const }
                  : {}),
              }))
            }
          >
            <option value="weekdays">Выбранные дни недели</option>
            <option value="interval">Каждые N дней от первой даты</option>
            <option value="monthdays">Числа месяца</option>
            <option value="after">Через N дней после выполнения</option>
          </select>
        </label>
        {form.mode === "weekdays" && (
          <fieldset>
            <legend>Дни появления</legend>
            <div className="v2-checks">
              {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((name, i) => (
                <label key={i}>
                  <input
                    type="checkbox"
                    checked={form.weekdays.includes(i)}
                    onChange={(e) =>
                      set(
                        "weekdays",
                        e.target.checked
                          ? [...form.weekdays, i]
                          : form.weekdays.filter((v) => v !== i),
                      )
                    }
                  />
                  {name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {["interval", "after"].includes(form.mode) && (
          <label>
            Интервал в днях
            <input
              type="number"
              required
              min="1"
              max="36500"
              value={form.interval}
              onChange={(e) => set("interval", Number(e.target.value))}
            />
          </label>
        )}
        {form.mode === "monthdays" && (
          <fieldset>
            <legend>Числа месяца</legend>
            <div className="v2-checks v2-monthdays">
              {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                <label key={n}>
                  <input
                    type="checkbox"
                    checked={form.monthdays.includes(n)}
                    onChange={(e) =>
                      set(
                        "monthdays",
                        e.target.checked
                          ? [...form.monthdays, n]
                          : form.monthdays.filter((v) => v !== n),
                      )
                    }
                  />
                  {n}
                </label>
              ))}
            </div>
            <label className="v2-inline-check">
              <input
                type="checkbox"
                checked={form.last_day}
                onChange={(e) => set("last_day", e.target.checked)}
              />
              Последний день месяца
            </label>
            <small>31-е не появляется в коротком месяце.</small>
          </fieldset>
        )}
        {form.mode !== "after" ? (
          <div className="v2-form-grid">
            <label>
              Ориентир
              <input
                type="number"
                required
                min="1"
                max="1000000"
                value={form.target}
                onChange={(e) => set("target", Number(e.target.value))}
              />
            </label>
            <label>
              Период счётчика
              <select
                value={form.counter_period}
                onChange={(e) =>
                  set(
                    "counter_period",
                    e.target.value as Definition["counter_period"],
                  )
                }
              >
                <option value="day">За день</option>
                <option value="week">За неделю · с субботы</option>
                <option value="month">За месяц</option>
              </select>
            </label>
          </div>
        ) : (
          <p className="muted">
            Один факт завершает ожидание. Следующее появление — через{" "}
            {form.interval} дн. Пока факта нет, строка остаётся в следующих
            днях.
          </p>
        )}
        <label>
          Стандартная секция
          <select
            value={form.section}
            onChange={(e) => set("section", e.target.value)}
          >
            <option value="">Без привязки ко времени</option>
            {[
              ...new Set([
                ...sections,
                ...(form.section ? [form.section] : []),
              ]),
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Сферы</legend>
          <div className="v2-checks">
            {areas.map((a) => (
              <label key={a.id}>
                <input
                  type="checkbox"
                  checked={form.areas.includes(a.id)}
                  onChange={(e) =>
                    set(
                      "areas",
                      e.target.checked
                        ? [...form.areas, a.id]
                        : form.areas.filter((v) => v !== a.id),
                    )
                  }
                />
                {a.name}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="v2-inline-check">
          <input
            type="checkbox"
            checked={form.archived}
            onChange={(e) => set("archived", e.target.checked)}
          />
          В архиве с даты изменения
        </label>
        <ErrorNotice error={error} />
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={close}>
            Отмена
          </button>
          <button className="primary" disabled={busy}>
            Сохранить
          </button>
        </div>
      </form>
      {habit && (
        <details className="v2-history">
          <summary>История настроек</summary>
          {habit.versions
            .slice()
            .reverse()
            .map((v) => (
              <button
                className="pool-item"
                key={v.id}
                type="button"
                onClick={() => setForm({ ...v })}
              >
                С {shortDate(v.effective_from)} {v.effective_from.slice(0, 4)} ·{" "}
                {v.title} ·{" "}
                {v.mode === "after"
                  ? `через ${v.interval} дн. после выполнения`
                  : `${v.target} ${counterLabels[v.counter_period]}`}
                {v.archived && " · архив"}
              </button>
            ))}
        </details>
      )}
    </Dialog>
  );
}
function PauseEditor({
  habit,
  today,
  api,
  close,
}: {
  habit: Habit;
  today: string;
  api: Api;
  close: () => void;
}) {
  const [start, setStart] = useState(today),
    [end, setEnd] = useState(today);
  const { run, busy, error } = useAction(api);
  return (
    <Dialog title="Паузы привычки" close={close}>
      <p>{habit.definition?.title}</p>
      <form
        className="v2-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await run(`habits/${habit.id}/pause/`, { start, end });
            close();
          } catch {}
        }}
      >
        <div className="v2-form-grid">
          <label>
            С
            <input
              type="date"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            По, включительно
            <input
              type="date"
              required
              min={start}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <ErrorNotice error={error} />
        <button className="primary" disabled={busy}>
          Добавить паузу
        </button>
      </form>
      {habit.pauses
        .filter((p) => !p.cancelled)
        .map((p) => (
          <div className="v2-pause" key={p.id}>
            {shortDate(p.start)} — {shortDate(p.end)}
            <button
              disabled={busy}
              onClick={() =>
                void run(`habits/${habit.id}/pauses/${p.id}/cancel/`)
                  .then(close)
                  .catch(() => {})
              }
            >
              Отменить паузу
            </button>
          </div>
        ))}
    </Dialog>
  );
}
export function HabitManager({
  today,
  areas,
  sections,
  api,
}: {
  today: string;
  areas: Area[];
  sections: string[];
  api: Api;
}) {
  const query = useQuery<HabitBoard>({
    queryKey: ["habit-board", today],
    queryFn: () => api("habit-board/?date=" + today),
  });
  const habits = query.data?.habits || [];
  const [editor, setEditor] = useState<Habit | "new" | null>(null),
    [pause, setPause] = useState<Habit | null>(null),
    [log, setLog] = useState<Habit | null>(null),
    [archive, setArchive] = useState(false);
  const rows = habits.filter((h) => archive || !h.definition?.archived);
  return (
    <>
      <ErrorNotice
        error={query.isError ? "Не удалось загрузить привычки." : ""}
      />
      {query.isPending && <p>Загружаем привычки…</p>}
      <div className="period-toolbar habit-toolbar">
        <button className="primary" onClick={() => setEditor("new")}>
          <Plus size={16} />
          Новая привычка
        </button>
        <label className="v2-inline-check">
          <input
            type="checkbox"
            checked={archive}
            onChange={(e) => setArchive(e.target.checked)}
          />
          Показывать архив
        </label>
      </div>
      <div className="content-card">
        {rows.map((h) => {
          const d = h.definition || h.versions[h.versions.length - 1];
          return (
            <div className="task-row v2-manager-row" key={h.id}>
              <RefreshCw className="row-kind-icon" size={20} />
              <button className="task-content" onClick={() => setLog(h)}>
                <span className="task-title">{d?.title}</span>
                <span className="task-meta">
                  {d?.mode === "after"
                    ? `Через ${d.interval} дн. после выполнения`
                    : `${d?.target} ${counterLabels[d?.counter_period || "day"]}`}
                  {d?.archived && " · в архиве"}
                  {!h.definition && " · начнётся позднее"}
                </span>
              </button>
              <div className="v2-row-buttons">
                <IconButton
                  label={`Настроить: ${d?.title}`}
                  onClick={() => setEditor(h)}
                >
                  <Pencil size={20} />
                </IconButton>
                <ActionMenu label={`Действия: ${d?.title}`}>
                  <button onClick={() => setLog(h)}>
                    <History size={16} />
                    Записи и история
                  </button>
                  <button onClick={() => setPause(h)}>
                    <Pause size={16} />
                    Настроить паузу
                  </button>
                </ActionMenu>
              </div>
            </div>
          );
        })}
        {!rows.length && (
          <p className="inline-empty">
            Нет привычек. Добавь первую, чтобы начать наблюдения.
          </p>
        )}
      </div>
      {editor && (
        <HabitEditor
          habit={editor === "new" ? undefined : editor}
          today={today}
          areas={areas}
          sections={sections}
          api={api}
          close={() => setEditor(null)}
        />
      )}{" "}
      {pause && (
        <PauseEditor
          habit={pause}
          today={today}
          api={api}
          close={() => setPause(null)}
        />
      )}{" "}
      {log && (
        <HabitLogEditor
          habit={log}
          date={today}
          today={today}
          sections={sections}
          api={api}
          close={() => setLog(null)}
        />
      )}
    </>
  );
}
