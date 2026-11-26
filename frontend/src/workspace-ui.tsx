import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DialogSurface } from "./ui";

export type Api = <T = any>(
  path: string,
  method?: string,
  body?: unknown,
) => Promise<T>;
export type Area = { id: number; name: string; color: string };
export const labels: Record<string, string> = {
  day: "День",
  week: "Неделя",
  month: "Месяц",
  quarter: "Квартал",
  year: "Год",
};
export const counterLabels: Record<string, string> = {
  day: "за день",
  week: "за неделю",
  month: "за месяц",
};
export const shortDate = (day: string) =>
  new Date(day + "T12:00:00Z").toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
export const addDays = (day: string, n: number) => {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const previousPeriod = (
  day: string,
  period: string,
  direction: number,
) => {
  const d = new Date(day + "T12:00:00Z");
  if (period === "day" || period === "week")
    return addDays(day, direction * (period === "day" ? 1 : 7));
  d.setUTCDate(1);
  d.setUTCMonth(
    d.getUTCMonth() +
      direction * ({ month: 1, quarter: 3, year: 12 }[period] || 1),
  );
  return d.toISOString().slice(0, 10);
};
export function useAction(api: Api) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(path: string, body?: unknown, method = "POST") {
    setBusy(true);
    setError("");
    try {
      const result = await api(path, method, body);
      await Promise.all(
        [
          "habit-board",
          "board",
          "planning",
          "reflections",
          "reflection-templates",
        ].map((key) => client.invalidateQueries({ queryKey: [key] })),
      );
      window.dispatchEvent(
        new CustomEvent("opora:notice", {
          detail: path.includes("/log/")
            ? "Наблюдение записано"
            : path.includes("reflection-templates")
              ? "Шаблон сохранён"
              : path.includes("reflections")
                ? "Рефлексия сохранена"
                : path.includes("/release/")
                  ? "Предложение снято с плана"
                  : path.includes("/plan/")
                    ? "Дело добавлено в план"
                    : "Изменения сохранены",
        }),
      );
      return result;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error };
}
export function ErrorNotice({ error }: { error?: string }) {
  return error ? (
    <div className="error" role="alert">
      {error}
    </div>
  ) : null;
}
export function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  return (
    <DialogSurface title={title} onClose={close} layer={70}>
      {children}
    </DialogSurface>
  );
}

export const fmt = (
  date: string,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" },
) => new Date(date + "T12:00:00").toLocaleDateString("ru-RU", options);
