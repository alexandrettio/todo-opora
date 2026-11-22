from django.contrib import admin
from .models import Area, Item, Capture, PlanEntry, History, CalendarOccurrence


class DomainReadOnlyAdmin(admin.ModelAdmin):
    """Inspect stored data without bypassing the domain commands."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


admin.site.register(Area)
for model in [Item, Capture, PlanEntry, History, CalendarOccurrence]:
    admin.site.register(model, DomainReadOnlyAdmin)
