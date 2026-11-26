"""Editable period journals and independent template settings."""
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from .models import Reflection, ReflectionTemplate
from .views import OwnedViewSet, selected_date
from .reflection_serializers import ReflectionSerializer, TemplateSerializer
from .periods import period_start


class ReflectionViewSet(OwnedViewSet):
    queryset = Reflection.objects.all().order_by("-date")
    serializer_class = ReflectionSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        period = self.request.query_params.get("period")
        if period:
            qs = qs.filter(period=period)
        day = self.request.query_params.get("date")
        if day and period:
            qs = qs.filter(date=period_start(period, selected_date(self.request)))
        return qs

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        existing = Reflection.objects.filter(owner=request.user, period=data["period"], date=data["date"]).first()
        if existing:
            return Response(self.get_serializer(existing).data)
        template = ReflectionTemplate.objects.filter(owner=request.user, period=data["period"]).first()
        body = template.body if template else ""
        reflection = Reflection.objects.create(owner=request.user, period=data["period"], date=data["date"], template_snapshot=body, body=data.get("body", body))
        return Response(self.get_serializer(reflection).data, status=201)

    def perform_update(self, serializer):
        serializer.save(revision=serializer.instance.revision + 1)


class TemplateViewSet(OwnedViewSet):
    queryset = ReflectionTemplate.objects.all()
    serializer_class = TemplateSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        template, _ = ReflectionTemplate.objects.update_or_create(owner=request.user, period=serializer.validated_data["period"], defaults={"body": serializer.validated_data.get("body", "")})
        return Response(self.get_serializer(template).data)

    def perform_update(self, serializer):
        if "period" in serializer.validated_data and serializer.validated_data["period"] != serializer.instance.period:
            raise ValidationError("Тип шаблона менять нельзя.")
        serializer.save()
