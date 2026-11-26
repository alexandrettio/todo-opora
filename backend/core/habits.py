"""Habit observations: effective definitions, schedules, and independent facts."""
import calendar
from datetime import timedelta
from .periods import period_start, period_end


def version_on(versions, day):
    return next((v for v in reversed(versions) if v.effective_from <= day), None)


def habit_cell(versions, pauses, logs, day):
    version = version_on(versions, day)
    log = logs.get(day)
    if version is None:
        return None
    enabled = day >= version.start_date and not version.archived
    paused = any(not p.cancelled and p.start <= day <= p.end for p in pauses)
    expected = False
    due = None
    if enabled and not paused:
        if version.mode == "weekdays":
            expected = day.weekday() in version.weekdays
        elif version.mode == "interval":
            expected = (day - version.start_date).days % version.interval == 0
        elif version.mode == "monthdays":
            expected = day.day in version.monthdays or (
                version.last_day and day.day == calendar.monthrange(day.year, day.month)[1]
            )
        elif version.mode == "after":
            # Only earlier dates advance the schedule: today's completion stays visible.
            completions = [d for d, l in logs.items() if d < day and l.state == "recorded" and l.count > 0 and d >= version.start_date]
            due = max(completions) + timedelta(days=version.interval) if completions else version.start_date
            expected = day >= due
    start, end = period_start(version.counter_period, day), period_end(version.counter_period, day)
    total = sum(l.count for d, l in logs.items() if start <= d < end and d <= day and l.state == "recorded")
    if version.mode == "after":
        total = log.count if log and log.state == "recorded" else 0
    return {
        "date": str(day), "expected": expected, "paused": paused,
        "due_date": str(due) if due else None,
        "count": log.count if log and log.state == "recorded" else 0,
        "state": log.state if log else "unrecorded", "total": total,
        "target": version.target, "reached": total >= version.target,
        "counter_period": version.counter_period,
        "section": log.section if log and log.section is not None else version.section,
        "note": log.note if log else "", "title": version.title,
        "areas": [a.pk for a in version.areas.all()],
    }
