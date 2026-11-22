"""Domain rules shared by API clients. Mutations are serialized per owner in views."""

from datetime import datetime, time, timedelta
from copy import copy
import json
from django.core.serializers.json import DjangoJSONEncoder
from zoneinfo import ZoneInfo
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from .models import Item, PlanEntry, History, InheritedPlanning

TZ = ZoneInfo("Europe/Moscow")


def planning_day(now=None):
    return ((now or timezone.now()).astimezone(TZ) - timedelta(hours=5)).date()


def week_start(day):
    return day - timedelta(days=(day.weekday() - 5) % 7)


def boundary(day):
    return datetime.combine(day, time(5), tzinfo=TZ)


def record(item, event, **data):
    History.objects.create(
        owner=item.owner,
        item=item,
        event=event,
        data=json.loads(json.dumps(data, cls=DjangoJSONEncoder)),
    )


def descendants(item):
    items = list(Item.objects.filter(owner=item.owner))
    found, frontier = [], {item.id}
    while frontier:
        children = [i for i in items if i.parent_id in frontier]
        found.extend(children)
        frontier = {i.id for i in children}
    return found


def ancestors(item):
    result, seen = [], {item.id}
    while item.parent_id:
        item = item.parent
        if item.id in seen:
            raise ValidationError("Цикл в структуре проектов.")
        seen.add(item.id)
        result.append(item)
    return result


def sync_inheritance(item):
    if item.status != "open":
        return
    parent_ids = [p.id for p in ancestors(item)]
    sources = PlanEntry.objects.filter(
        owner=item.owner,
        item_id__in=parent_ids,
        period="week",
        date__gte=week_start(planning_day()),
        active=True,
    )
    for source in sources:
        membership, created = InheritedPlanning.objects.get_or_create(
            owner=item.owner, source=source, item=item
        )
        if not created and membership.ended_at:
            membership.ended_at = None
            membership.save(update_fields=["ended_at"])


def has_current_week(item, day=None):
    day = day or planning_day()
    start = week_start(day)
    return (
        item.entries.filter(period="week", date=start, active=True).exists()
        or item.inherited_planning.filter(
            source__date=start, source__active=True, ended_at__isnull=True
        ).exists()
    )


def direct_commitment(item):
    return PlanEntry.objects.filter(
        item=item, period="week", date=week_start(planning_day()), active=True
    ).first()


def in_inbox(item, day=None):
    day = day or planning_day()
    if item.status != "open" or item.kind == "idea":
        return False
    if item.available_from and item.available_from > day:
        return False
    if has_current_week(item, day):
        return False
    if item.entries.filter(period="day", date__gte=day, active=True).exists():
        return False
    # Future explicit planning is a decision already made.
    return not (
        item.entries.filter(
            period="week", date__gt=week_start(day), active=True
        ).exists()
        or item.inherited_planning.filter(
            source__date__gt=week_start(day), source__active=True, ended_at__isnull=True
        ).exists()
    )


def require_reason(reason):
    if not reason or not reason.strip():
        raise ValidationError(
            {"reason": "Укажи причину пересмотра недельного обязательства."}
        )


def change_state(item, target, reason="", result_comment=None):
    old = item.status
    if target == old:
        return item
    if target not in ["open", "done", "graveyard"]:
        raise ValidationError("Неизвестное состояние.")
    if item.kind == "idea" and target == "done":
        raise ValidationError("Сначала преврати идею в задачу или проект.")
    if target in ["done", "graveyard"] and item.kind == "project":
        if any(c.status == "open" for c in descendants(item)):
            raise ValidationError(
                "Сначала разбери открытые вложенные дела, начиная с самых глубоких."
            )
    if target == "graveyard":
        entry = direct_commitment(item)
        if entry:
            require_reason(reason)
            entry.active, entry.outcome, entry.reason, entry.ended_at = (
                False,
                "released",
                reason.strip(),
                timezone.now(),
            )
            entry.save()
            record(
                item, "commitment_released", reason=reason.strip(), date=str(entry.date)
            )
    if (
        target == "open"
        and old == "graveyard"
        and item.parent
        and item.parent.status != "open"
    ):
        record(item, "detached_on_restore", parent_id=str(item.parent_id))
        InheritedPlanning.objects.filter(
            item_id__in=[item.id] + [c.id for c in descendants(item)],
            ended_at__isnull=True,
        ).update(ended_at=timezone.now())
        item.parent = None
    item.status = target
    item.completed_at = timezone.now() if target == "done" else None
    if result_comment is not None:
        item.result_comment = result_comment
    item.save()
    day = planning_day()
    if target == "done":
        for entry in item.entries.filter(period="day", active=True, date__gte=day):
            entry.outcome = "done"
            entry.save()
    elif target == "open":
        item.entries.filter(period="day", active=True, date__gte=day).update(
            outcome="pending"
        )
    if target == "open":
        sync_inheritance(item)
    record(
        item,
        {
            "done": "completed",
            "graveyard": "buried",
            "open": "reopened" if old == "done" else "restored",
        }[target],
        reason=reason.strip(),
        result_comment=item.result_comment if target == "done" else "",
    )
    return item


def assign(item, period, day, section=""):
    if item.status != "open" or item.kind == "idea":
        raise ValidationError("Планировать можно открытые задачи и проекты.")
    if period not in ["day", "week"]:
        raise ValidationError("Допустимы день и неделя.")
    today = planning_day()
    if day < (today if period == "day" else week_start(today)):
        raise ValidationError("Нельзя добавлять обязательства в прошедший период.")
    if period == "week":
        day = week_start(day)
    if item.available_from and day < item.available_from and period == "day":
        raise ValidationError("Эта задача ещё не актуальна.")
    existing = item.entries.filter(period=period, date=day, active=True).first()
    if existing:
        existing.section = section
        existing.save()
        return existing
    if period == "day":
        if item.kind == "project":
            raise ValidationError(
                "Проект нельзя напрямую добавить в план дня. Выбери конкретный шаг."
            )
        for prev in item.entries.filter(period="day", active=True):
            if prev.date > today:
                prev.delete()  # Future plan is a draft.
            else:
                prev.active, prev.outcome, prev.ended_at = (
                    False,
                    "moved",
                    timezone.now(),
                )
                prev.save()
                record(item, "day_moved", source=str(prev.date), destination=str(day))
    entry = PlanEntry.objects.create(
        owner=item.owner, item=item, period=period, date=day, section=section
    )
    if period == "week" and item.kind == "project":
        for child in descendants(item):
            if child.status == "open":
                InheritedPlanning.objects.get_or_create(
                    owner=item.owner, source=entry, item=child
                )
    record(item, "planned", period=period, date=str(day))
    return entry


def release(entry, reason=""):
    today = planning_day()
    started = entry.date <= (today if entry.period == "day" else week_start(today))
    if entry.period == "week" and started and entry.item.status == "open":
        require_reason(reason)
    if not started:
        entry.delete()
        return
    entry.active, entry.outcome, entry.reason, entry.ended_at = (
        False,
        "released",
        reason.strip(),
        timezone.now(),
    )
    entry.save()
    record(
        entry.item,
        "plan_released",
        period=entry.period,
        date=str(entry.date),
        reason=reason.strip(),
    )


def week_rows(owner, day):
    start = week_start(day)
    end = boundary(start + timedelta(days=7))
    entries = list(
        PlanEntry.objects.filter(owner=owner, period="week", date=start)
        .select_related("item")
        .prefetch_related("item__areas")
    )
    rows = {}
    for entry in entries:
        active = entry.active or bool(entry.ended_at and entry.ended_at >= end)
        row = rows.setdefault(
            entry.item_id,
            {
                "item": entry.item,
                "direct": False,
                "inherited": False,
                "entry": entry,
                "active": False,
            },
        )
        row.update(direct=active, entry=entry, active=row["active"] or active)
    memberships = (
        InheritedPlanning.objects.filter(
            owner=owner, source__in=entries, created_at__lt=end
        )
        .select_related("item", "source")
        .prefetch_related("item__areas")
    )
    for member in memberships:
        source_active = member.source.active or bool(
            member.source.ended_at and member.source.ended_at >= end
        )
        member_active = not member.ended_at or member.ended_at >= end
        row = rows.setdefault(
            member.item_id,
            {
                "item": member.item,
                "direct": False,
                "inherited": False,
                "entry": None,
                "active": False,
            },
        )
        row.update(
            inherited=True,
            active=row["active"] or bool(source_active and member_active),
        )
    if start < week_start(planning_day()):
        transitions = History.objects.filter(
            owner=owner,
            item_id__in=rows,
            created_at__lt=end,
            event__in=["completed", "buried", "restored", "reopened"],
        ).order_by("created_at")
        states = {}
        for event in transitions:
            states[event.item_id] = {
                "completed": "done",
                "buried": "graveyard",
                "restored": "open",
                "reopened": "open",
            }[event.event]
        for row in rows.values():
            snapshot = copy(row["item"])
            snapshot.status = states.get(snapshot.id, "open")
            row["item"] = snapshot
    return list(rows.values())
