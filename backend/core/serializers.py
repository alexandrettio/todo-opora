from django.utils import timezone
from django.db import transaction
from rest_framework import serializers
from .models import Area, Capture, Item, PlanEntry, History, CalendarOccurrence
from .domain import planning_day, has_current_week


class AreaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Area
        fields = ["id", "name", "color", "order"]


class CaptureSerializer(serializers.ModelSerializer):
    results = serializers.PrimaryKeyRelatedField(many=True, read_only=True)

    class Meta:
        model = Capture
        fields = ["id", "text", "source", "status", "created_at", "results"]
        read_only_fields = ["source", "created_at", "results", "status"]

    def validate_text(self, value):
        if not value.strip():
            raise serializers.ValidationError("Запиши мысль.")
        return value.strip()


class ItemSerializer(serializers.ModelSerializer):
    resolve_capture = serializers.BooleanField(write_only=True, required=False)
    planned_week = serializers.DateField(write_only=True, required=False)
    planned_day = serializers.DateField(write_only=True, required=False)
    planned_month = serializers.DateField(write_only=True, required=False)
    planned_quarter = serializers.DateField(write_only=True, required=False)
    planned_section = serializers.CharField(
        write_only=True, required=False, allow_blank=True, max_length=160
    )
    has_week_commitment = serializers.SerializerMethodField()
    schedule = serializers.SerializerMethodField()
    stale = serializers.SerializerMethodField()
    no_next_step = serializers.SerializerMethodField()

    class Meta:
        model = Item
        fields = [
            "id",
            "resolve_capture",
            "planned_day",
            "planned_week",
            "planned_month",
            "planned_quarter",
            "planned_section",
            "title",
            "kind",
            "status",
            "parent",
            "capture",
            "areas",
            "comment",
            "result_comment",
            "deadline",
            "available_from",
            "location",
            "tags",
            "estimated_minutes",
            "created_at",
            "updated_at",
            "title_changed_at",
            "completed_at",
            "has_week_commitment",
            "schedule",
            "stale",
            "no_next_step",
        ]
        read_only_fields = [
            "status",
            "created_at",
            "updated_at",
            "title_changed_at",
            "completed_at",
        ]

    def get_has_week_commitment(self, obj) -> bool:
        if "direct_commitments" in self.context:
            return obj.id in self.context["direct_commitments"]
        from .domain import direct_commitment

        return direct_commitment(obj) is not None

    def get_schedule(self, obj) -> list[dict]:
        entries = [
            {"period": entry.period, "date": str(entry.date), "inherited": False}
            for entry in obj.entries.all() if entry.active
        ]
        direct = {(entry["period"], entry["date"]) for entry in entries}
        for planning in obj.inherited_planning.all():
            source = planning.source
            key = (source.period, str(source.date))
            if planning.ended_at is None and source.active and key not in direct:
                entries.append({"period": key[0], "date": key[1], "inherited": True})
                direct.add(key)
        return sorted(entries, key=lambda entry: (entry["date"], entry["period"]))

    def get_stale(self, obj) -> bool:
        return (
            obj.status == "open" and (timezone.now() - obj.title_changed_at).days >= 10
        )

    def get_no_next_step(self, obj) -> bool:
        if obj.kind != "project" or obj.status != "open":
            return False
        if "parents_with_open_children" in self.context:
            return obj.id not in self.context["parents_with_open_children"]
        return not obj.children.filter(status="open").exists()

    def validate_title(self, value):
        if not value.strip():
            raise serializers.ValidationError("Нужно название.")
        return value.strip()

    def validate_tags(self, value):
        if not isinstance(value, list) or any(
            not isinstance(v, str) or len(v) > 100 for v in value
        ):
            raise serializers.ValidationError(
                "Теги должны быть списком строк до 100 символов."
            )
        return list(dict.fromkeys(v.strip() for v in value if v.strip()))

    def validate(self, data):
        owner = self.context["request"].user
        parent = data.get("parent", self.instance.parent if self.instance else None)
        capture = data.get("capture")
        if parent and (
            parent.owner_id != owner.id
            or parent.kind != "project"
            or parent.status != "open"
        ):
            raise serializers.ValidationError({"parent": "Нужен твой открытый проект."})
        if self.instance and "parent" in data:
            seen = {self.instance.pk}
            ancestor = parent
            while ancestor:
                if ancestor.pk in seen:
                    raise serializers.ValidationError(
                        {"parent": "Нельзя выбрать само дело или его потомка: возникнет цикл."}
                    )
                seen.add(ancestor.pk)
                ancestor = ancestor.parent
        if "resolve_capture" in data and (self.instance or not capture):
            raise serializers.ValidationError(
                {"resolve_capture": "Этот выбор доступен при создании дела из мысли."}
            )
        if capture and capture.owner_id != owner.id:
            raise serializers.ValidationError({"capture": "Недоступная запись."})
        if self.instance and "kind" in data and data["kind"] != self.instance.kind:
            old, new = self.instance.kind, data["kind"]
            if (old, new) not in [
                ("idea", "task"),
                ("idea", "project"),
                ("task", "project"),
            ]:
                raise serializers.ValidationError(
                    {"kind": "Это преобразование не поддерживается."}
                )
        selected_plans = [field for field in ["planned_day", "planned_week", "planned_month", "planned_quarter"] if field in data]
        if len(selected_plans) > 1:
            raise serializers.ValidationError("При создании выбери один период планирования.")
        if any(field in data for field in ["planned_month", "planned_quarter"]):
            if self.instance:
                raise serializers.ValidationError("Для существующего дела используй планирование.")
            if data.get("kind", "task") == "idea":
                raise serializers.ValidationError("В план можно выбрать задачу или проект.")
        if "planned_week" in data:
            if self.instance:
                raise serializers.ValidationError(
                    {"planned_week": "Для существующего дела используй планирование."}
                )
            if "planned_day" in data:
                raise serializers.ValidationError(
                    {"planned_week": "Выбери день или неделю."}
                )
        if "planned_section" in data and "planned_day" not in data:
            raise serializers.ValidationError(
                {"planned_section": "Для секции нужен выбранный день."}
            )
        if "planned_day" in data:
            if self.instance:
                raise serializers.ValidationError(
                    {"planned_day": "Для существующего дела используй планирование."}
                )
            if data.get("kind", "task") != "task":
                raise serializers.ValidationError(
                    {"planned_day": "В день можно напрямую добавить только задачу."}
                )
            if data["planned_day"] < planning_day():
                raise serializers.ValidationError(
                    {"planned_day": "Выбери текущий или будущий день."}
                )
            if (
                data.get("available_from")
                and data["planned_day"] < data["available_from"]
            ):
                raise serializers.ValidationError(
                    {"planned_day": "В этот день задача ещё не актуальна."}
                )
        return data

    @transaction.atomic
    def create(self, data):
        resolve_capture = data.pop("resolve_capture", False)
        month = data.pop("planned_month", None)
        quarter = data.pop("planned_quarter", None)
        week = data.pop("planned_week", None)
        day = data.pop("planned_day", None)
        section = data.pop("planned_section", "")
        if data.get("parent") and "areas" not in data:
            data["areas"] = list(data["parent"].areas.all())
        item = super().create({**data, "title_changed_at": timezone.now()})
        if day is not None:
            from .domain import assign

            assign(item, "day", day, section)
        if week is not None:
            from .domain import assign

            assign(item, "week", week)
        for period, selected_date in [("month", month), ("quarter", quarter)]:
            if selected_date is not None:
                from .domain import assign
                assign(item, period, selected_date)
        if resolve_capture:
            item.capture.status = "processed"
            item.capture.save(update_fields=["status"])
        return item

    def update(self, instance, data):
        if "title" in data and data["title"] != instance.title:
            data["title_changed_at"] = timezone.now()
        return super().update(instance, data)


class EntrySerializer(serializers.ModelSerializer):
    item_detail = ItemSerializer(source="item", read_only=True)
    checked = serializers.SerializerMethodField()

    class Meta:
        model = PlanEntry
        fields = [
            "id",
            "item",
            "item_detail",
            "period",
            "date",
            "active",
            "outcome",
            "section",
            "position",
            "reason",
            "created_at",
            "checked",
        ]

    def get_checked(self, obj) -> bool:
        if obj.period == "day":
            return obj.outcome == "done"
        return obj.item.status == "done"


class HistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = History
        fields = ["id", "event", "data", "created_at"]


class EventSerializer(serializers.ModelSerializer):
    class Meta:
        model = CalendarOccurrence
        fields = [
            "id",
            "title",
            "start",
            "end",
            "all_day",
            "done",
            "url",
            "calendar_id",
        ]
