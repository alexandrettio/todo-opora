from rest_framework import serializers as s
from .models import ReflectionTemplate, Reflection
from .periods import period_start


class TemplateSerializer(s.ModelSerializer):
    class Meta:
        model = ReflectionTemplate
        fields = ["id", "period", "body"]
        read_only_fields = ["id"]
        validators = []


class ReflectionSerializer(s.ModelSerializer):
    class Meta:
        model = Reflection
        fields = ["id", "period", "date", "body", "template_snapshot", "revision", "updated_at"]
        read_only_fields = ["id", "template_snapshot", "updated_at"]
        validators = []

    def validate(self, data):
        if self.instance:
            if any(f in data and data[f] != getattr(self.instance, f) for f in ["period", "date"]):
                raise s.ValidationError("Период записи менять нельзя.")
            if data.get("revision") != self.instance.revision:
                raise s.ValidationError("Запись уже изменена. Сохрани свой текст и обнови запись перед повторным сохранением.")
        else:
            if "period" not in data or "date" not in data:
                raise s.ValidationError("Нужны период и дата.")
            data["date"] = period_start(data["period"], data["date"])
        return data
