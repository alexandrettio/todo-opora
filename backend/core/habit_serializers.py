from rest_framework import serializers as s
from .models import HabitVersion, HabitPause, HabitLog
from .domain import planning_day


class HabitDefinition(s.ModelSerializer):
    class Meta:
        model = HabitVersion
        fields = ["id", "effective_from", "title", "areas", "section", "archived", "start_date", "mode", "interval", "weekdays", "monthdays", "last_day", "target", "counter_period"]
        read_only_fields = ["id"]

    def validate(self, data):
        merged = {f: getattr(self.instance, f) for f in ["mode", "interval", "weekdays", "monthdays", "last_day", "target", "counter_period"]} if self.instance else {
            "interval": 1, "weekdays": [], "monthdays": [], "last_day": False,
            "target": 1, "counter_period": "day",
        }
        merged.update(data)
        for field, low, high in [("weekdays", 0, 6), ("monthdays", 1, 31)]:
            values = merged[field]
            if not isinstance(values, list) or any(type(v) is not int or not low <= v <= high for v in values) or len(values) != len(set(values)):
                raise s.ValidationError({field: "Нужен список разных допустимых чисел."})
        if not 1 <= merged["interval"] <= 36500:
            raise s.ValidationError({"interval": "Интервал: от 1 до 36500 дней."})
        if not 1 <= merged["target"] <= 1000000:
            raise s.ValidationError({"target": "Ориентир должен быть положительным."})
        if merged["mode"] == "weekdays" and not merged["weekdays"]:
            raise s.ValidationError({"weekdays": "Выбери хотя бы один день."})
        if merged["mode"] == "monthdays" and not (merged["monthdays"] or merged["last_day"]):
            raise s.ValidationError({"monthdays": "Выбери числа или последний день."})
        if merged["mode"] == "after" and (merged["target"] != 1 or merged["counter_period"] != "day"):
            raise s.ValidationError("Повторение после выполнения не совмещается со счётчиком периода.")
        if "title" in data:
            data["title"] = data["title"].strip()
            if not data["title"]:
                raise s.ValidationError({"title": "Нужно название."})
        return data


class PauseSerializer(s.ModelSerializer):
    class Meta:
        model = HabitPause
        fields = ["id", "start", "end", "cancelled"]
        read_only_fields = ["id", "cancelled"]

    def validate(self, data):
        if data["end"] < data["start"]:
            raise s.ValidationError("Окончание паузы раньше начала.")
        return data


class LogCommand(s.Serializer):
    date = s.DateField()
    delta = s.IntegerField(required=False, min_value=-1000000, max_value=1000000)
    count = s.IntegerField(required=False, min_value=0, max_value=1000000)
    state = s.ChoiceField(choices=["recorded", "skipped", "unrecorded"], required=False)
    section = s.CharField(max_length=160, allow_blank=True, allow_null=True, required=False)
    note = s.CharField(allow_blank=True, required=False, max_length=50000)

    def validate(self, data):
        if data["date"] > planning_day() and any(f in data for f in ["count", "delta", "state", "note"]):
            raise s.ValidationError("Будущие факты записывать нельзя; секцию можно настроить заранее.")
        if "delta" in data and "count" in data:
            raise s.ValidationError("Выбери изменение или итоговое количество.")
        if data.get("state") in ["skipped", "unrecorded"] and (data.get("count", 0) or "delta" in data):
            raise s.ValidationError("Пропуск и отсутствие записи не содержат выполнений.")
        return data


class LogSerializer(s.ModelSerializer):
    class Meta:
        model = HabitLog
        fields = ["id", "date", "count", "state", "section", "note", "updated_at"]


class HabitResult(s.Serializer):
    id = s.UUIDField()
    definition = HabitDefinition(allow_null=True)
    versions = HabitDefinition(many=True)
    pauses = PauseSerializer(many=True)
    logs = LogSerializer(many=True)
    cells = s.ListField(child=s.JSONField())


class HabitBoard(s.Serializer):
    date = s.DateField()
    week = s.DateField()
    habits = HabitResult(many=True)
