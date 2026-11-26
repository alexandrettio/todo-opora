"""Read model for proposals and selecting smaller planning horizons."""
from rest_framework import serializers as s
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from drf_spectacular.utils import extend_schema, OpenApiParameter, OpenApiTypes
from .models import PlanEntry
from .views import selected_date
from .serializers import EntrySerializer, ItemSerializer
from .periods import period_start, period_end
from .domain import descendants


class PlanningResult(s.Serializer):
    period = s.CharField()
    start = s.DateField()
    end = s.DateField()
    entries = s.ListField(child=s.JSONField())
    suggestions = s.ListField(child=s.JSONField())
    previous = s.ListField(child=s.JSONField())


@extend_schema(parameters=[OpenApiParameter("date", OpenApiTypes.DATE), OpenApiParameter("period", str, enum=["week", "month", "quarter"])], responses=PlanningResult)
@api_view(["GET"])
def planning(request):
    period = request.query_params.get("period", "month")
    if period not in ["week", "month", "quarter"]:
        raise ValidationError("Выбери неделю, месяц или квартал.")
    day = selected_date(request)
    start, end = period_start(period, day), period_end(period, day)
    entries = PlanEntry.objects.filter(owner=request.user, period=period, date=start).select_related("item").prefetch_related("item__areas")
    selected = {e.item_id for e in entries if e.active}
    context = {"request": request}
    suggestions = []
    source_period = {"week": "month", "month": "quarter"}.get(period)
    if source_period:
        sources = PlanEntry.objects.filter(owner=request.user, period=source_period, active=True, date__gte=period_start(source_period, start), date__lt=end, item__status="open").select_related("item")
        seen = set()
        for source in sources:
            for item in [source.item, *(descendants(source.item) if source.item.kind == "project" else [])]:
                if item.status != "open" or item.id in seen or item.id in selected:
                    continue
                seen.add(item.id)
                suggestions.append({"item": ItemSerializer(item, context=context).data, "source_date": str(source.date), "source_period": source_period, "source_project": str(source.item_id) if item.id != source.item_id else None})
    previous = PlanEntry.objects.filter(owner=request.user, period=period, date__lt=start, active=True, item__status="open").exclude(item_id__in=selected).select_related("item").order_by("-date")
    return Response({"period": period, "start": str(start), "end": str(end),
                     "entries": EntrySerializer(entries, many=True, context=context).data,
                     "suggestions": suggestions,
                     "previous": EntrySerializer(previous, many=True, context=context).data})
