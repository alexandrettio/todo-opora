import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Api, labels, useAction, ErrorNotice } from "./workspace-ui";

type Reflection = {
  id: string;
  period: string;
  date: string;
  body: string;
  template_snapshot: string;
  revision: number;
  updated_at: string;
};
export function ReflectionEditor({
  api,
  date,
  period,
  compact = false,
}: {
  api: Api;
  date: string;
  period: string;
  compact?: boolean;
}) {
  const query = useQuery<Reflection[]>({
    queryKey: ["reflections", period, date],
    queryFn: () => api(`reflections/?period=${period}&date=${date}`),
  });
  const [draft, setDraft] = useState<{
      id: string;
      body: string;
      revision: number;
    } | null>(null),
    [saved, setSaved] = useState(false);
  const { run, busy, error } = useAction(api);
  const entry = query.data?.[0];
  useEffect(() => {
    if (!entry) return;
    try {
      const raw = sessionStorage.getItem(`opora-reflection-draft-${entry.id}`);
      if (raw) {
        const stored = JSON.parse(raw);
        if (
          typeof stored.body === "string" &&
          Number.isInteger(stored.revision)
        )
          setDraft({
            id: entry.id,
            body: stored.body,
            revision: stored.revision,
          });
      }
    } catch {
      /* Storage may be disabled; the editor still works. */
    }
  }, [entry?.id]);
  const text =
    draft?.id === entry?.id && draft ? draft.body : entry?.body || "";
  const dirty =
    !!entry && !!draft && draft.id === entry.id && draft.body !== entry.body;
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  return (
    <details
      className="content-card v2-reflection disclosure"
      open={!compact || undefined}
    >
      <summary>
        <span>
          Рефлексия{!compact ? ` · ${labels[period].toLocaleLowerCase()}` : ""}
        </span>
        {dirty && <span className="draft-indicator">Черновик</span>}
      </summary>
      <div className="reflection-body">
        <div className="card-heading"></div>
        <ErrorNotice
          error={
            error || (query.isError ? "Не удалось загрузить рефлексию." : "")
          }
        />
        {query.isPending ? (
          <p>Загружаем запись…</p>
        ) : !entry ? (
          <>
            <p className="muted">
              Начни с шаблона из настроек или свободной записи.
            </p>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run("reflections/", { period, date }).catch(() => {})
              }
            >
              Начать рефлексию
            </button>
          </>
        ) : (
          <>
            <label className="v2-sr-only" htmlFor={`reflection-${period}`}>
              Текст рефлексии в Markdown
            </label>
            <textarea
              id={`reflection-${period}`}
              className="v2-markdown"
              value={text}
              rows={12}
              onChange={(e) => {
                setSaved(false);
                const next = {
                  id: entry.id,
                  body: e.target.value,
                  revision:
                    draft?.id === entry.id ? draft.revision : entry.revision,
                };
                setDraft(next);
                try {
                  sessionStorage.setItem(
                    `opora-reflection-draft-${entry.id}`,
                    JSON.stringify(next),
                  );
                } catch {}
              }}
            />
            <div className="v2-save-row">
              <span className="muted">
                {dirty
                  ? "Есть несохранённые изменения · черновик в этой вкладке"
                  : saved
                    ? "Сохранено"
                    : `Сохранено ${new Date(entry.updated_at).toLocaleString("ru-RU")}`}
              </span>
              <button
                className="primary"
                disabled={busy || !dirty}
                onClick={() =>
                  void run(
                    `reflections/${entry.id}/`,
                    { body: text, revision: draft?.revision ?? entry.revision },
                    "PATCH",
                  )
                    .then((result: Reflection) => {
                      setDraft({
                        id: result.id,
                        body: result.body,
                        revision: result.revision,
                      });
                      try {
                        sessionStorage.removeItem(
                          `opora-reflection-draft-${result.id}`,
                        );
                      } catch {}
                      setSaved(true);
                    })
                    .catch(() => {})
                }
              >
                Сохранить
              </button>
            </div>
            {error && (
              <p className="muted">
                Твой текст остаётся в поле. Скопируй его перед обновлением
                страницы.
              </p>
            )}
          </>
        )}
      </div>
    </details>
  );
}
export function ReflectionPage({ api, today }: { api: Api; today: string }) {
  const [period, setPeriod] = useState("day"),
    [date, setDate] = useState(today);
  return (
    <>
      <div className="period-toolbar">
        <label>
          Период
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {Object.entries(labels).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Дата внутри периода
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value || today)}
          />
        </label>
      </div>
      <ReflectionEditor
        key={`${period}-${date}`}
        api={api}
        date={date}
        period={period}
      />
    </>
  );
}
export function ReflectionTemplates({ api }: { api: Api }) {
  const query = useQuery<{ id: string; period: string; body: string }[]>({
    queryKey: ["reflection-templates"],
    queryFn: () => api("reflection-templates/"),
  });
  const [period, setPeriod] = useState("day"),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [saved, setSaved] = useState(false);
  const { run, busy, error } = useAction(api);
  const template = query.data?.find((t) => t.period === period);
  return (
    <div className="content-card settings-card v2-reflection">
      <h2>Шаблоны рефлексии</h2>
      <p className="muted">
        Markdown-вопросы для новых записей. Уже созданные документы сохранят
        свой текст.
      </p>
      <label>
        Период
        <select
          value={period}
          onChange={(e) => {
            setPeriod(e.target.value);
            setSaved(false);
          }}
        >
          {Object.entries(labels).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Шаблон
        <textarea
          className="v2-markdown"
          rows={9}
          disabled={query.isPending || query.isError}
          value={drafts[period] ?? template?.body ?? ""}
          onChange={(e) => {
            setSaved(false);
            setDrafts((old) => ({ ...old, [period]: e.target.value }));
          }}
        />
      </label>
      <ErrorNotice
        error={error || (query.isError ? "Не удалось загрузить шаблоны." : "")}
      />
      <div className="v2-save-row">
        <span>{saved ? "Шаблон сохранён" : ""}</span>
        <button
          className="primary"
          disabled={busy || !query.data}
          onClick={() =>
            void run("reflection-templates/", {
              period,
              body: drafts[period] ?? template?.body ?? "",
            })
              .then(() => setSaved(true))
              .catch(() => {})
          }
        >
          Сохранить шаблон
        </button>
      </div>
    </div>
  );
}
