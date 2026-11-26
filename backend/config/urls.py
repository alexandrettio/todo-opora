from django.contrib import admin
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from core import views, habit_api, reflection_api, planning_api

router = DefaultRouter()
router.register("captures", views.CaptureViewSet)
router.register("items", views.ItemViewSet)
router.register("plans", views.PlanViewSet)
router.register("events", views.EventViewSet)
router.register("habits", habit_api.HabitViewSet)
router.register("reflections", reflection_api.ReflectionViewSet)
router.register("reflection-templates", reflection_api.TemplateViewSet)
urlpatterns = [
    path("api/habit-board/", habit_api.habit_board),
    path("api/planning/", planning_api.planning),
    path("admin/", admin.site.urls),
    path("api/session/", views.session),
    path("api/login/", views.sign_in),
    path("api/logout/", views.sign_out),
    path("api/board/", views.board),
    path("api/settings/day-sections/", views.day_settings),
    path("api/export/", views.export),
    path("api/google/start/", views.google_start),
    path("api/google/callback/", views.google_callback),
    path("api/google/settings/", views.google_settings),
    path("api/google/sync/", views.google_sync),
    path("api/google/calendars/", views.google_calendars),
    path("api/google/disconnect/", views.google_disconnect),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
    path("api/", include(router.urls)),
]
