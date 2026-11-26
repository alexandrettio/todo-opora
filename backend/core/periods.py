"""Calendar boundaries shared as values, without commitment rules."""
from datetime import date, timedelta
from rest_framework.exceptions import ValidationError

PERIODS = ("day", "week", "month", "quarter", "year")


def period_start(period, day):
    if period == "day":
        return day
    if period == "week":
        return day - timedelta(days=(day.weekday() - 5) % 7)
    if period == "month":
        return day.replace(day=1)
    if period == "quarter":
        return date(day.year, ((day.month - 1) // 3) * 3 + 1, 1)
    if period == "year":
        return date(day.year, 1, 1)
    raise ValidationError("Неизвестный период.")


def period_end(period, day):
    start = period_start(period, day)
    if period in ("day", "week"):
        return start + timedelta(days=1 if period == "day" else 7)
    months = {"month": 1, "quarter": 3, "year": 12}[period]
    index = start.year * 12 + start.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)
