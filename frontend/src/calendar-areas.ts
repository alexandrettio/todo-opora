const normalizeName = (name: string) =>
  name.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("ru-RU");

export function eventsForArea<T extends { calendar_id: string; start: string }>(
  areaName: string,
  calendars: { id: string; name: string }[],
  events: T[],
): T[] {
  const calendarIds = new Set(
    calendars.filter((calendar) => normalizeName(calendar.name) === normalizeName(areaName))
      .map((calendar) => calendar.id),
  );
  return events.filter((event) => calendarIds.has(event.calendar_id))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}
