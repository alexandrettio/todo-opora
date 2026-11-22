from datetime import date, timedelta
import secrets
from django.contrib.auth import authenticate, login, logout, get_user_model
from django.db import transaction
from django.db.models import Max
from django.http import HttpResponse, HttpResponseRedirect
from django.middleware.csrf import get_token
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from django.utils.decorators import method_decorator
from rest_framework import viewsets, serializers
from rest_framework.decorators import (
    action,
    api_view,
    permission_classes,
    throttle_classes,
)
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.exceptions import ValidationError
from .models import *
from .serializers import *
from .domain import *
from . import google, contracts
from drf_spectacular.utils import extend_schema, OpenApiParameter, OpenApiTypes


class LoginThrottle(AnonRateThrottle):
    scope = "login"


@extend_schema(responses=contracts.Session)
@api_view(["GET"])
@permission_classes([AllowAny])
def session(request):
    return Response(
        {
            "authenticated": request.user.is_authenticated,
            "username": (
                request.user.get_username() if request.user.is_authenticated else None
            ),
            "csrf": get_token(request),
            "today": str(planning_day()),
            "week": str(week_start(planning_day())),
        }
    )


@extend_schema(request=contracts.Login, responses=contracts.LoginResult)
@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([LoginThrottle])
@csrf_protect
def sign_in(request):
    user = authenticate(
        request,
        username=request.data.get("username", ""),
        password=request.data.get("password", ""),
    )
    if not user:
        return Response({"detail": "Неверное имя пользователя или пароль."}, status=400)
    login(request, user)
    return Response({"username": user.get_username(), "csrf": get_token(request)})


@extend_schema(request=None, responses=contracts.Ok)
@api_view(["POST"])
def sign_out(request):
    logout(request)
    return Response({"ok": True})


class OwnedViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        return self.queryset.filter(owner=self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def dispatch(self, request, *args, **kwargs):
        # Serialize one user's mutations, including cross-aggregate rules and tree closure.
        with transaction.atomic():
            if (
                request.method not in ["GET", "HEAD", "OPTIONS"]
                and request.user.is_authenticated
            ):
                get_user_model().objects.select_for_update().get(pk=request.user.pk)
            return super().dispatch(request, *args, **kwargs)


class CaptureViewSet(OwnedViewSet):
    queryset = Capture.objects.all()
    serializer_class = CaptureSerializer

    @extend_schema(request=contracts.ResolveCommand, responses=CaptureSerializer)
    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        payload = contracts.ResolveCommand(data=request.data)
        payload.is_valid(raise_exception=True)
        capture = self.get_object()
        state = request.data.get("status", "processed")
        if state not in ["open", "processed", "graveyard"]:
            raise ValidationError("Неизвестное состояние записи.")
        capture.status = state
        capture.save()
        return Response(self.get_serializer(capture).data)


class ItemViewSet(OwnedViewSet):
    queryset = Item.objects.select_related("parent").prefetch_related("areas")
    serializer_class = ItemSerializer

    def perform_create(self, serializer):
        item = serializer.save(owner=self.request.user)
        record(item, "created", kind=item.kind, title=item.title)
        sync_inheritance(item)

    def perform_update(self, serializer):
        old = self.get_object()
        before = dict(self.get_serializer(old).data)
        item = serializer.save()
        record(
            item,
            "updated",
            before=before,
            after=dict(self.get_serializer(item).data),
            fields=list(serializer.validated_data.keys()),
        )

    @extend_schema(request=contracts.StateCommand, responses=ItemSerializer)
    @action(detail=True, methods=["post"])
    def state(self, request, pk=None):
        payload = contracts.StateCommand(data=request.data)
        payload.is_valid(raise_exception=True)
        item = self.get_object()
        change_state(
            item,
            request.data.get("status"),
            str(request.data.get("reason", "")),
            request.data.get("result_comment"),
        )
        return Response(self.get_serializer(item).data)

    @extend_schema(request=contracts.PlanCommand, responses=EntrySerializer)
    @action(detail=True, methods=["post"])
    def plan(self, request, pk=None):
        payload = contracts.PlanCommand(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            day = date.fromisoformat(request.data.get("date", ""))
        except (ValueError, TypeError):
            raise ValidationError("Нужна дата в формате YYYY-MM-DD.")
        section = str(request.data.get("section", ""))[:160]
        entry = assign(self.get_object(), request.data.get("period"), day, section)
        return Response(EntrySerializer(entry).data)

    @extend_schema(responses=HistorySerializer(many=True))
    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        return Response(
            HistorySerializer(self.get_object().history.all(), many=True).data
        )

    @extend_schema(responses=ItemSerializer(many=True))
    @action(detail=True, methods=["get"])
    def closure(self, request, pk=None):
        item = self.get_object()
        pending = [c for c in descendants(item) if c.status == "open"]
        pending.sort(key=lambda i: len(ancestors(i)), reverse=True)
        return Response(self.get_serializer(pending, many=True).data)


class PlanViewSet(OwnedViewSet):
    queryset = PlanEntry.objects.select_related("item")
    serializer_class = EntrySerializer
    http_method_names = ["get", "post", "head", "options"]

    def create(self, request, *args, **kwargs):
        raise ValidationError("Используй операцию планирования дела.")

    @extend_schema(request=contracts.ReleaseCommand, responses=contracts.Ok)
    @action(detail=True, methods=["post"])
    def release(self, request, pk=None):
        payload = contracts.ReleaseCommand(data=request.data)
        payload.is_valid(raise_exception=True)
        release(self.get_object(), str(request.data.get("reason", "")))
        return Response({"ok": True})

    @extend_schema(request=contracts.OrganizeCommand, responses=EntrySerializer)
    @action(detail=True, methods=["post"])
    def organize(self, request, pk=None):
        payload = contracts.OrganizeCommand(data=request.data)
        payload.is_valid(raise_exception=True)
        entry = self.get_object()
        if "section" in request.data:
            entry.section = str(request.data["section"])[:160]
        if "position" in request.data:
            try:
                entry.position = max(0, int(request.data["position"]))
            except (ValueError, TypeError):
                raise ValidationError("Нужен номер позиции.")
        entry.save()
        return Response(self.get_serializer(entry).data)


class EventViewSet(OwnedViewSet):
    queryset = CalendarOccurrence.objects.filter(cancelled=False)
    serializer_class = EventSerializer
    http_method_names = ["get", "post", "head", "options"]

    def create(self, request, *args, **kwargs):
        raise ValidationError("События поступают из Google Календаря.")

    @extend_schema(request=contracts.CheckCommand, responses=EventSerializer)
    @action(detail=True, methods=["post"])
    def check(self, request, pk=None):
        payload = contracts.CheckCommand(data=request.data)
        payload.is_valid(raise_exception=True)
        event = self.get_object()
        if not isinstance(request.data.get("done"), bool):
            raise ValidationError("Нужна отметка выполнения.")
        event.done = request.data["done"]
        event.save(update_fields=["done"])
        return Response(self.get_serializer(event).data)


def selected_date(request):
    try:
        return date.fromisoformat(request.query_params.get("date", str(planning_day())))
    except ValueError:
        raise ValidationError("Неверная дата.")


@extend_schema(
    parameters=[OpenApiParameter("date", OpenApiTypes.DATE)], responses=contracts.Board
)
@api_view(["GET"])
def board(request):
    day = selected_date(request)
    owner = request.user
    context = {"request": request}
    items = list(
        Item.objects.filter(owner=owner)
        .select_related("parent")
        .prefetch_related("areas", "entries", "inherited_planning__source")
    )
    today = planning_day()
    direct = set(
        PlanEntry.objects.filter(
            owner=owner, period="week", date=week_start(today), active=True
        ).values_list("item_id", flat=True)
    )
    context["direct_commitments"] = direct
    context["parents_with_open_children"] = {
        i.parent_id for i in items if i.status == "open" and i.parent_id
    }
    planned_weeks = set(
        PlanEntry.objects.filter(
            owner=owner, period="week", date__gte=week_start(today), active=True
        ).values_list("item_id", flat=True)
    )
    planned_days = set(
        PlanEntry.objects.filter(
            owner=owner, period="day", date__gte=today, active=True
        ).values_list("item_id", flat=True)
    )
    inherited = set(
        InheritedPlanning.objects.filter(
            owner=owner,
            source__active=True,
            source__date__gte=week_start(today),
            ended_at__isnull=True,
        ).values_list("item_id", flat=True)
    )
    inbox = [
        i
        for i in items
        if i.status == "open"
        and i.kind != "idea"
        and (not i.available_from or i.available_from <= today)
        and i.id not in planned_days
        and i.id not in planned_weeks
        and i.id not in inherited
    ]
    inbox.sort(
        key=lambda i: (
            not (i.deadline and i.deadline <= planning_day() + timedelta(days=14)),
            i.deadline or date.max,
            -i.created_at.timestamp(),
        )
    )
    latest_planned_days = dict(
        PlanEntry.objects.filter(
            owner=owner,
            period="day",
            date__gte=week_start(day),
            date__lt=week_start(day) + timedelta(days=7),
        )
        .exclude(outcome__in=["moved", "released"])
        .order_by()
        .values("item_id")
        .annotate(latest_day=Max("date"))
        .values_list("item_id", "latest_day")
    )
    rows = []
    for row in week_rows(owner, day):
        rows.append(
            {
                "item": ItemSerializer(row["item"], context=context).data,
                "scheduled_day": latest_planned_days.get(row["item"].id),
                "direct": row["direct"],
                "inherited": row["inherited"],
                "active": row["active"],
                "entry_id": str(row["entry"].id) if row["entry"] else None,
                "outcome": row["entry"].outcome if row["entry"] else "pending",
                "reason": row["entry"].reason if row["entry"] else "",
            }
        )
    connection = GoogleConnection.objects.filter(owner=owner).first()
    return Response(
        {
            "today": str(planning_day()),
            "week": str(week_start(day)),
            "areas": AreaSerializer(Area.objects.all(), many=True).data,
            "captures": CaptureSerializer(
                Capture.objects.filter(owner=owner), many=True
            ).data,
            "items": ItemSerializer(items, many=True, context=context).data,
            "inbox_ids": [str(i.id) for i in inbox],
            "day_sections": DaySettings.objects.get_or_create(owner=owner)[0].sections,
            "day_entries": EntrySerializer(
                PlanEntry.objects.filter(
                    owner=owner, period="day", date=day
                ).select_related("item"),
                many=True,
                context=context,
            ).data,
            "week_rows": rows,
            "events": EventSerializer(
                CalendarOccurrence.objects.filter(
                    owner=owner,
                    calendar_id__in=connection.selected if connection else [],
                    cancelled=False,
                    start__lt=boundary(week_start(day) + timedelta(days=7)),
                    end__gt=boundary(week_start(day)),
                ),
                many=True,
            ).data,
            "google": {
                "configured": bool(
                    google.settings.GOOGLE_CLIENT_ID
                    and google.settings.TOKEN_ENCRYPTION_KEY
                ),
                "connected": bool(connection),
                "calendars": connection.calendars if connection else [],
                "selected": connection.selected if connection else [],
                "last_sync": connection.last_sync if connection else None,
                "last_error": connection.last_error if connection else "",
            },
        }
    )


@extend_schema(responses=contracts.GoogleStart)
@api_view(["GET"])
def google_start(request):
    try:
        return Response({"url": google.auth_url(request)})
    except google.GoogleError as e:
        return Response({"detail": str(e)}, status=400)


@extend_schema(exclude=True)
@api_view(["GET"])
def google_callback(request):
    state = request.session.pop("google_state", "")
    at = request.session.pop("google_state_at", 0)
    if (
        not state
        or not secrets.compare_digest(state, request.query_params.get("state", ""))
        or timezone.now().timestamp() - at > 600
    ):
        return HttpResponse(
            "Недействительная или просроченная OAuth-сессия. Начни подключение заново.",
            status=400,
        )
    if not request.query_params.get("code"):
        return HttpResponseRedirect("/?google=cancelled")
    try:
        connection = google.exchange(request.user, request.query_params["code"])
        google.sync(connection)
    except (google.GoogleError, google.requests.RequestException):
        return HttpResponseRedirect("/?google=error")
    return HttpResponseRedirect("/?google=connected")


@extend_schema(request=contracts.GoogleSettings, responses=contracts.Ok)
@api_view(["POST"])
def google_settings(request):
    connection = GoogleConnection.objects.filter(owner=request.user).first()
    if not connection:
        raise ValidationError("Сначала подключи Google Календарь.")
    selected = request.data.get("selected", [])
    if not isinstance(selected, list) or any(
        v not in [c["id"] for c in connection.calendars] for v in selected
    ):
        raise ValidationError("Неизвестный календарь.")
    connection.selected = selected
    connection.save(update_fields=["selected"])
    return Response({"ok": True})


@extend_schema(request=None, responses=contracts.Ok)
@api_view(["POST"])
def google_calendars(request):
    connection = GoogleConnection.objects.filter(owner=request.user).first()
    if not connection:
        raise ValidationError("Сначала подключи Google Календарь.")
    try:
        google.refresh_calendars(connection)
    except (google.GoogleError, google.requests.RequestException):
        return Response(
            {"detail": "Не удалось обновить список календарей. Повтори попытку позже."},
            status=502,
        )
    return Response({"ok": True})


@extend_schema(request=None, responses=contracts.Ok)
@api_view(["POST"])
def google_sync(request):
    connection = GoogleConnection.objects.filter(owner=request.user).first()
    if not connection:
        raise ValidationError("Сначала подключи Google Календарь.")
    try:
        google.sync(connection)
    except (google.GoogleError, google.requests.RequestException) as e:
        connection.last_error = (
            "Не удалось обновить расписание. Повтори попытку или переподключи Google."
        )
        connection.save(update_fields=["last_error"])
        return Response({"detail": connection.last_error}, status=502)
    return Response({"ok": True})


@extend_schema(request=None, responses=contracts.Ok)
@api_view(["POST"])
def google_disconnect(request):
    GoogleConnection.objects.filter(owner=request.user).delete()
    CalendarOccurrence.objects.filter(owner=request.user).delete()
    return Response({"ok": True})


@extend_schema(
    parameters=[OpenApiParameter("date", OpenApiTypes.DATE)],
    responses={(200, "text/markdown"): OpenApiTypes.STR},
)
@api_view(["GET"])
def export(request):
    day = selected_date(request)
    rows = week_rows(request.user, day)
    lines = [f"# Неделя {week_start(day).isoformat()}", ""]
    for row in rows:
        i = row["item"]
        lines.append(
            f'- [{"x" if i.status=="done" else " "}] {i.title} ({i.get_kind_display()})'
        )
        if i.result_comment:
            lines.append(f"  - Результат: {i.result_comment}")
        entry = row["entry"]
        if entry and entry.reason:
            lines.append(f"  - Причина пересмотра: {entry.reason}")
    return HttpResponse(
        "\n".join(lines),
        content_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="week-{week_start(day)}.md"'
        },
    )


@extend_schema(request=contracts.DaySections, responses=contracts.DaySections)
@api_view(["GET", "PATCH"])
def day_settings(request):
    settings, _ = DaySettings.objects.get_or_create(owner=request.user)
    if request.method == "PATCH":
        payload = contracts.DaySections(data=request.data)
        payload.is_valid(raise_exception=True)
        settings.sections = payload.validated_data["sections"]
        settings.save(update_fields=["sections"])
    return Response({"sections": settings.sections})
