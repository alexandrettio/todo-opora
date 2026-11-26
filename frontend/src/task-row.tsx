import type { Item, Entry, Board } from "./main";
import {
  Archive,
  CalendarDays,
  CalendarMinus,
  Check,
  ChevronUp,
  Clock3,
  CornerDownRight,
  FolderOpen,
  Lightbulb,
  Pencil,
  Plus,
  RotateCcw,
  Flag,
} from "lucide-react";
import { ActionMenu, IconButton } from "./ui";
import { fmt } from "./workspace-ui";

export type TaskRowContext = {
  area: number | null;
  page: string;
  b: Pick<Board, "today" | "items" | "areas">;
  busy: boolean;
  askState: (item: Item, status: string) => void;
  setDetail: (item: Item) => void;
  setEditor: (options: { item?: Item; parent?: string }) => void;
  setWeekProject: (item: Item) => void;
  setClosure: (item: Item) => void;
  removeEntry: (id: string) => void;
  openSchedule: (item: Item) => void;
  setSchedule: (item: Item) => void;
  setScheduleDate: (date: string) => void;
  setPeriod: (period: string) => void;
  setSection: (section: string) => void;
  selectedDayEntries: Entry[];
  mutate: (path: string, body?: unknown, method?: string) => Promise<unknown>;
};

export const preciseSchedule = (schedule: Item["schedule"]) => {
  const days = schedule.filter((plan) => plan.period === "day");
  return days.length ? days : schedule;
};

export function TaskRow({
  context,
  item,
  entry,
  direct = false,
  compact = false,
  hideAreas = false,
  hideParent = false,
  commitmentEntryId,
  contextOnly = false,
}: {
  context: TaskRowContext;
  item: Item;
  entry?: Entry;
  direct?: boolean;
  compact?: boolean;
  hideAreas?: boolean;
  hideParent?: boolean;
  commitmentEntryId?: string | null;
  contextOnly?: boolean;
}) {
  const {
    area,
    page,
    b,
    busy,
    askState,
    setDetail,
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
  } = context;
  const checked =
    !contextOnly && (entry ? entry.checked : item.status === "done");
  const historical = !!entry && (!entry.active || entry.date < b!.today);
  const archived = item.status === "graveyard";
  return (
    <div
      className={`task-row ${checked ? "completed" : ""} ${historical ? "archived-entry" : ""} ${compact ? "compact" : ""}`}
      data-item-id={item.id}
    >
      {archived ? (
        <IconButton
          label={`Восстановить: ${item.title}`}
          disabled={busy}
          onClick={() => askState(item, "open")}
        >
          <RotateCcw size={20} />
        </IconButton>
      ) : item.kind === "idea" ? (
        <Lightbulb className="row-kind-icon" size={20} aria-label="Идея" />
      ) : contextOnly ? (
        <FolderOpen
          className="row-kind-icon"
          size={20}
          aria-label="Проект вне обязательств"
        />
      ) : (
        <button
          className={`checkbox ${checked ? "checked" : ""}`}
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-label={`${checked ? "Открыть повторно" : "Выполнить"}: ${item.title}`}
          title={
            historical ? "Отметка сохранена в истории этого дня" : undefined
          }
          disabled={busy || historical}
          onClick={() => askState(item, checked ? "open" : "done")}
        >
          <span>{checked && <Check size={12} />}</span>
        </button>
      )}
      <button className="task-content" onClick={() => setDetail(item)}>
        <span className="task-title">
          {item.kind === "project" && !contextOnly && (
            <FolderOpen size={16} aria-label="Проект" />
          )}
          {item.title}
        </span>
        <span className="task-meta">
          {item.parent && !hideParent && (
            <span>
              <CornerDownRight size={16} />
              {b?.items.find((i) => i.id === item.parent)?.title}
            </span>
          )}
          {!hideAreas &&
            !area &&
            item.areas.map((id) => {
              const a = b?.areas.find((a) => a.id === id);
              return a ? (
                <span key={id} className="area-label">
                  <i style={{ background: a.color }} />
                  {a.name}
                </span>
              ) : null;
            })}
          {item.deadline && (
            <span
              className={item.deadline < b!.today ? "overdue" : ""}
              title="Срок результата"
            >
              <Flag size={16} />
              Срок: {fmt(item.deadline, { day: "numeric", month: "short" })}
            </span>
          )}
          {!!item.estimated_minutes && (
            <span>
              <Clock3 size={16} />
              {item.estimated_minutes} мин
            </span>
          )}
          {page === "projects" &&
            preciseSchedule(item.schedule)
              .filter((plan) => !(plan.inherited && hideParent))
              .slice(0, 1)
              .map((plan) => (
                <span key={`${plan.period}-${plan.date}`}>
                  <CalendarDays size={16} />
                  {
                    {
                      day: "День",
                      week: "Неделя",
                      month: "Месяц",
                      quarter: "Квартал",
                    }[plan.period]
                  }
                  : {fmt(plan.date, { day: "numeric", month: "short" })}
                </span>
              ))}
          {direct && item.kind === "project" && (
            <span className="inheritance-note">Включает открытые шаги</span>
          )}
          {contextOnly && <span>Проект вне обязательств недели</span>}
          {item.no_next_step && page === "projects" && (
            <span>Нет открытых шагов</span>
          )}
          {entry?.outcome === "moved" && <span>Перенесено из этого дня</span>}
          {entry?.outcome === "released" && <span>Снято с дня</span>}
        </span>
      </button>
      <div className="row-actions">
        {item.kind === "project" && item.status === "open" && (
          <IconButton
            className="project-add-action"
            label={`Добавить шаг: ${item.title}`}
            onClick={() =>
              page === "week"
                ? setWeekProject(item)
                : setEditor({ parent: item.id })
            }
          >
            <Plus size={20} />
          </IconButton>
        )}
        {item.status === "open" && item.kind !== "idea" && !historical && (
          <IconButton
            label={`Запланировать: ${item.title}`}
            onClick={() => openSchedule(item)}
          >
            <CalendarDays size={20} />
          </IconButton>
        )}
        <ActionMenu label={`Действия: ${item.title}`}>
          {item.status === "open" && item.kind !== "idea" && (
            <button onClick={() => openSchedule(item)}>
              <CalendarDays size={16} />
              Выбрать день или период
            </button>
          )}
          <button onClick={() => setEditor({ item })}>
            <Pencil size={16} />
            Редактировать
          </button>
          {item.kind === "project" && item.status === "open" && (
            <button onClick={() => setClosure(item)}>
              <Check size={16} />
              Завершить проект
            </button>
          )}
          {item.status === "done" && (
            <button onClick={() => askState(item, "open")}>
              <RotateCcw size={16} />
              Открыть повторно
            </button>
          )}
          {item.status === "open" && (
            <button onClick={() => askState(item, "graveyard")}>
              <Archive size={16} />
              Отпустить дело
            </button>
          )}
          {commitmentEntryId && item.status === "open" && (
            <button onClick={() => removeEntry(commitmentEntryId)}>
              <CalendarMinus size={16} />
              Снять с недели
            </button>
          )}
          {entry?.active && item.status === "open" && (
            <button onClick={() => removeEntry(entry.id)}>
              <CalendarMinus size={16} />
              Снять с дня
            </button>
          )}
          {entry?.active && !historical && (
            <button
              onClick={() => {
                setSchedule(item);
                setScheduleDate(entry.date);
                setPeriod("day");
                setSection(entry.section);
              }}
            >
              <CalendarDays size={16} />
              Перенести в другой день
            </button>
          )}
          {entry?.active && !historical && (
            <button
              onClick={() => {
                const sorted = selectedDayEntries.filter(
                  (x) => x.section === entry.section,
                );
                const index = sorted.findIndex((x) => x.id === entry.id);
                if (index > 0)
                  void (async () => {
                    for (let k = 0; k < sorted.length; k++)
                      await mutate(`plans/${sorted[k].id}/organize/`, {
                        position:
                          k === index ? index - 1 : k === index - 1 ? index : k,
                      });
                  })().catch(() => {});
              }}
            >
              <ChevronUp size={16} />
              Переместить выше в секции
            </button>
          )}
        </ActionMenu>
      </div>
    </div>
  );
}
