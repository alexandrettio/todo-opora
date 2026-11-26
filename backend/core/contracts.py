"""Explicit API contracts for command endpoints and composed read models."""

from rest_framework import serializers as s
from .serializers import (
    ItemSerializer,
    EntrySerializer,
    AreaSerializer,
    CaptureSerializer,
    EventSerializer,
)


class Ok(s.Serializer):
    ok = s.BooleanField()


class Session(s.Serializer):
    authenticated = s.BooleanField()
    username = s.CharField(allow_null=True)
    csrf = s.CharField()
    today = s.DateField()
    week = s.DateField()


class Login(s.Serializer):
    username = s.CharField()
    password = s.CharField(write_only=True)


class LoginResult(s.Serializer):
    username = s.CharField()
    csrf = s.CharField()


class StateCommand(s.Serializer):
    status = s.ChoiceField(choices=["open", "done", "graveyard"])
    reason = s.CharField(required=False, allow_blank=True)
    result_comment = s.CharField(required=False, allow_blank=True)


class PlanCommand(s.Serializer):
    period = s.ChoiceField(choices=["day", "week", "month", "quarter"])
    date = s.DateField()
    section = s.CharField(required=False, allow_blank=True)


class ReleaseCommand(s.Serializer):
    reason = s.CharField(required=False, allow_blank=True)


class OrganizeCommand(s.Serializer):
    section = s.CharField(required=False, allow_blank=True)
    position = s.IntegerField(required=False, min_value=0)


class ResolveCommand(s.Serializer):
    status = s.ChoiceField(choices=["open", "processed", "graveyard"])


class CheckCommand(s.Serializer):
    done = s.BooleanField()


class GoogleSettings(s.Serializer):
    selected = s.ListField(child=s.CharField())


class GoogleStart(s.Serializer):
    url = s.URLField()


class GoogleCalendar(s.Serializer):
    id = s.CharField()
    name = s.CharField()
    primary = s.BooleanField(required=False)


class GoogleStatus(s.Serializer):
    configured = s.BooleanField()
    connected = s.BooleanField()
    calendars = GoogleCalendar(many=True)
    selected = s.ListField(child=s.CharField())
    last_sync = s.DateTimeField(allow_null=True)
    last_error = s.CharField()


class WeekRow(s.Serializer):
    item = ItemSerializer()
    scheduled_day = s.DateField(allow_null=True)
    direct = s.BooleanField()
    inherited = s.BooleanField()
    active = s.BooleanField()
    entry_id = s.UUIDField(allow_null=True)
    outcome = s.CharField()
    reason = s.CharField()


class Board(s.Serializer):
    today = s.DateField()
    week = s.DateField()
    areas = AreaSerializer(many=True)
    captures = CaptureSerializer(many=True)
    items = ItemSerializer(many=True)
    inbox_ids = s.ListField(child=s.UUIDField())
    day_sections = s.ListField(child=s.CharField())
    day_entries = EntrySerializer(many=True)
    week_rows = WeekRow(many=True)
    events = EventSerializer(many=True)
    google = GoogleStatus()


class DaySections(s.Serializer):
    sections = s.ListField(
        child=s.CharField(max_length=160, allow_blank=False),
        max_length=40,
        allow_empty=True,
    )

    def validate_sections(self, values):
        cleaned = [value.strip() for value in values]
        if any(not value for value in cleaned):
            raise s.ValidationError("Название секции не может быть пустым.")
        if len({value.casefold() for value in cleaned}) != len(cleaned):
            raise s.ValidationError("Названия секций не должны повторяться.")
        return cleaned
