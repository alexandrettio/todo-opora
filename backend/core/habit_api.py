"""Habit commands and the daily/weekly observation read model."""
from datetime import timedelta
from rest_framework.decorators import action, api_view
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from drf_spectacular.utils import extend_schema, OpenApiParameter, OpenApiTypes
from .models import Habit, HabitPause, HabitLog, HabitLogRevision
from .views import OwnedViewSet, selected_date
from .habit_serializers import HabitDefinition, HabitResult, HabitBoard, PauseSerializer, LogCommand, LogSerializer
from .habits import version_on, habit_cell
from .periods import period_start


def habit_result(habit, day):
    versions = list(habit.versions.all())
    start = period_start("week", day)
    days = sorted({day, *[start + timedelta(days=i) for i in range(7)]})
    logs = {l.date: l for l in habit.logs.all()}
    pauses = list(habit.pauses.all())
    definition = version_on(versions, day)
    return {"id": habit.pk, "definition": HabitDefinition(definition).data if definition else None,
            "versions": HabitDefinition(versions, many=True).data,
            "pauses": PauseSerializer(pauses, many=True).data,
            "logs": LogSerializer(list(logs.values()), many=True).data,
            "cells": [cell for d in days if (cell := habit_cell(versions, pauses, logs, d)) is not None]}


class HabitViewSet(OwnedViewSet):
    queryset = Habit.objects.prefetch_related("versions__areas", "pauses", "logs")
    serializer_class = HabitResult
    http_method_names = ["get", "post", "head", "options"]

    @extend_schema(responses=HabitResult(many=True))
    def list(self, request):
        day = selected_date(request)
        return Response([habit_result(h, day) for h in self.get_queryset()])

    @extend_schema(responses=HabitResult)
    def retrieve(self, request, pk=None):
        return Response(habit_result(self.get_object(), selected_date(request)))

    @extend_schema(request=HabitDefinition, responses=HabitResult)
    def create(self, request):
        serializer = HabitDefinition(data=request.data)
        serializer.is_valid(raise_exception=True)
        habit = Habit.objects.create(owner=request.user)
        serializer.save(owner=request.user, habit=habit)
        return Response(habit_result(habit, selected_date(request)), status=201)

    @extend_schema(request=HabitDefinition, responses=HabitResult)
    @action(detail=True, methods=["post"])
    def revise(self, request, pk=None):
        habit = self.get_object()
        serializer = HabitDefinition(data=request.data)
        serializer.is_valid(raise_exception=True)
        day = serializer.validated_data["effective_from"]
        existing = habit.versions.filter(effective_from=day).first()
        # A replacement at the same date is an explicit correction. Other dates survive.
        if existing:
            serializer = HabitDefinition(existing, data=request.data)
            serializer.is_valid(raise_exception=True)
        serializer.save(owner=request.user, habit=habit)
        return Response(habit_result(Habit.objects.get(pk=habit.pk), selected_date(request)))

    @extend_schema(request=PauseSerializer, responses=PauseSerializer)
    @action(detail=True, methods=["post"])
    def pause(self, request, pk=None):
        habit = self.get_object()
        serializer = PauseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(owner=request.user, habit=habit)
        return Response(serializer.data, status=201)

    @extend_schema(request=None, responses=PauseSerializer, parameters=[OpenApiParameter("pause_id", OpenApiTypes.UUID, location=OpenApiParameter.PATH)])
    @action(detail=True, methods=["post"], url_path="pauses/(?P<pause_id>[^/.]+)/cancel")
    def cancel_pause(self, request, pk=None, pause_id=None):
        from django.shortcuts import get_object_or_404
        pause = get_object_or_404(HabitPause, habit=self.get_object(), pk=pause_id, owner=request.user)
        pause.cancelled = True
        pause.save(update_fields=["cancelled"])
        return Response(PauseSerializer(pause).data)

    @extend_schema(request=LogCommand, responses=LogSerializer)
    @action(detail=True, methods=["post"])
    def log(self, request, pk=None):
        habit = self.get_object()
        serializer = LogCommand(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if not habit.versions.filter(effective_from__lte=data["date"]).exists():
            raise ValidationError("В эту дату привычка ещё не существовала.")
        log = HabitLog.objects.filter(owner=request.user, habit=habit, date=data["date"]).first() or HabitLog(owner=request.user, habit=habit, date=data["date"], state="unrecorded")
        before = dict(LogSerializer(log).data)
        if "delta" in data:
            log.count = (log.count if log.state == "recorded" else 0) + data["delta"]
            if not 0 <= log.count <= 1000000:
                raise ValidationError("Количество должно быть от 0 до 1000000.")
            log.state = "recorded"
        if "count" in data:
            log.count, log.state = data["count"], "recorded"
        if "state" in data:
            log.state = data["state"]
            if log.state != "recorded":
                log.count = 0
        for field in ["section", "note"]:
            if field in data:
                setattr(log, field, data[field])
        log.save()
        after = dict(LogSerializer(log).data)
        HabitLogRevision.objects.create(owner=request.user, log=log, before=before, after=after)
        return Response(after)


@extend_schema(parameters=[OpenApiParameter("date", OpenApiTypes.DATE)], responses=HabitBoard)
@api_view(["GET"])
def habit_board(request):
    day = selected_date(request)
    habits = Habit.objects.filter(owner=request.user).prefetch_related("versions__areas", "pauses", "logs")
    return Response({"date": str(day), "week": str(period_start("week", day)),
                     "habits": [habit_result(h, day) for h in habits]})
