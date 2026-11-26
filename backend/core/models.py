import uuid
from django.conf import settings
from django.db import models


class Owned(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True


class Area(models.Model):
    name = models.CharField(max_length=160)
    color = models.CharField(max_length=20, default="#61786a")
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return self.name


class Capture(Owned):
    text = models.TextField()
    source = models.CharField(max_length=30, default="web")
    status = models.CharField(
        max_length=16,
        default="open",
        choices=[
            ("open", "Не разобрана"),
            ("processed", "Разобрана"),
            ("graveyard", "Кладбище"),
        ],
    )

    class Meta:
        ordering = ["-created_at"]


class Item(Owned):
    title = models.CharField(max_length=500)
    kind = models.CharField(
        max_length=12,
        choices=[("task", "Задача"), ("project", "Проект"), ("idea", "Идея")],
        default="task",
    )
    status = models.CharField(
        max_length=12,
        choices=[("open", "Открыто"), ("done", "Выполнено"), ("graveyard", "Кладбище")],
        default="open",
    )
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="children"
    )
    capture = models.ForeignKey(
        Capture,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="results",
    )
    areas = models.ManyToManyField(Area, blank=True)
    comment = models.TextField(blank=True)
    result_comment = models.TextField(blank=True)
    deadline = models.DateField(null=True, blank=True)
    available_from = models.DateField(null=True, blank=True)
    location = models.CharField(max_length=200, blank=True)
    tags = models.JSONField(default=list, blank=True)
    estimated_minutes = models.PositiveIntegerField(null=True, blank=True)
    title_changed_at = models.DateTimeField()
    completed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]


class PlanEntry(Owned):
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="entries")
    period = models.CharField(
        max_length=8, choices=[("day", "День"), ("week", "Неделя"), ("month", "Месяц"), ("quarter", "Квартал")]
    )
    date = models.DateField()
    active = models.BooleanField(default=True)
    outcome = models.CharField(max_length=16, default="pending")
    section = models.CharField(max_length=160, blank=True)
    position = models.PositiveIntegerField(default=0)
    reason = models.TextField(blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["item", "period", "date"],
                condition=models.Q(active=True),
                name="unique_active_period_entry",
            ),
            models.UniqueConstraint(
                fields=["item"],
                condition=models.Q(active=True, period="day"),
                name="one_active_day",
            ),
        ]
        ordering = ["position", "created_at"]


class History(Owned):
    item = models.ForeignKey(
        Item, null=True, on_delete=models.CASCADE, related_name="history"
    )
    event = models.CharField(max_length=80)
    data = models.JSONField(default=dict)

    class Meta:
        ordering = ["-created_at"]


class GoogleConnection(Owned):
    tokens = models.TextField()
    calendars = models.JSONField(default=list)
    selected = models.JSONField(default=list)
    last_sync = models.DateTimeField(null=True)
    last_error = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["owner"], name="one_google_connection")
        ]


class CalendarOccurrence(Owned):
    calendar_id = models.CharField(max_length=500)
    external_id = models.CharField(max_length=500)
    title = models.CharField(max_length=500)
    start = models.DateTimeField()
    end = models.DateTimeField()
    all_day = models.BooleanField(default=False)
    cancelled = models.BooleanField(default=False)
    done = models.BooleanField(default=False)
    url = models.URLField(max_length=2000, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "calendar_id", "external_id"],
                name="unique_calendar_occurrence",
            )
        ]
        ordering = ["start"]


class InheritedPlanning(Owned):
    source = models.ForeignKey(
        PlanEntry, on_delete=models.CASCADE, related_name="inherited_members"
    )
    item = models.ForeignKey(
        Item, on_delete=models.CASCADE, related_name="inherited_planning"
    )
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["source", "item"], name="unique_inherited_source_item"
            )
        ]


def default_day_sections():
    return [
        "Календарные встречи",
        "До сада",
        "Без детей",
        "После сада",
        "В Москве",
        "В Ватутинках",
    ]


class DaySettings(Owned):
    sections = models.JSONField(default=default_day_sections)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["owner"], name="one_day_settings_per_owner")
        ]


class Habit(Owned):
    """Stable identity; effective definitions live in HabitVersion."""


class HabitVersion(Owned):
    habit = models.ForeignKey(Habit, on_delete=models.CASCADE, related_name="versions")
    effective_from = models.DateField()
    title = models.CharField(max_length=500)
    areas = models.ManyToManyField(Area, blank=True)
    section = models.CharField(max_length=160, blank=True)
    archived = models.BooleanField(default=False)
    start_date = models.DateField()
    mode = models.CharField(max_length=16, choices=[
        ("weekdays", "Дни недели"), ("interval", "Каждые N дней"),
        ("monthdays", "Числа месяца"), ("after", "После выполнения"),
    ])
    interval = models.PositiveIntegerField(default=1)
    weekdays = models.JSONField(default=list)
    monthdays = models.JSONField(default=list)
    last_day = models.BooleanField(default=False)
    target = models.PositiveIntegerField(default=1)
    counter_period = models.CharField(max_length=8, choices=[
        ("day", "День"), ("week", "Неделя"), ("month", "Месяц"),
    ], default="day")

    class Meta:
        ordering = ["effective_from", "created_at"]
        constraints = [models.UniqueConstraint(fields=["habit", "effective_from"], name="habit_version_date")]


class HabitPause(Owned):
    habit = models.ForeignKey(Habit, on_delete=models.CASCADE, related_name="pauses")
    start = models.DateField()
    end = models.DateField()
    cancelled = models.BooleanField(default=False)


class HabitLog(Owned):
    habit = models.ForeignKey(Habit, on_delete=models.CASCADE, related_name="logs")
    date = models.DateField()
    count = models.PositiveIntegerField(default=0)
    state = models.CharField(max_length=16, choices=[
        ("recorded", "Записано"), ("skipped", "Пропущено"), ("unrecorded", "Нет записи"),
    ], default="recorded")
    section = models.CharField(max_length=160, null=True, blank=True)
    note = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["habit", "date"], name="habit_log_date")]
        ordering = ["date"]


class HabitLogRevision(Owned):
    log = models.ForeignKey(HabitLog, on_delete=models.CASCADE, related_name="revisions")
    before = models.JSONField(default=dict)
    after = models.JSONField(default=dict)


class ReflectionTemplate(Owned):
    period = models.CharField(max_length=8, choices=[(p, p) for p in ["day", "week", "month", "quarter", "year"]])
    body = models.TextField(blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner", "period"], name="reflection_template_period")]


class Reflection(Owned):
    period = models.CharField(max_length=8, choices=ReflectionTemplate._meta.get_field("period").choices)
    date = models.DateField()
    template_snapshot = models.TextField(blank=True)
    body = models.TextField(blank=True)
    revision = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner", "period", "date"], name="reflection_period_date")]
