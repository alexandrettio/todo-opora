from datetime import timedelta
from django.db import migrations


def saturday_weeks(apps, schema_editor):
    Entry = apps.get_model("core", "PlanEntry")
    entries = Entry.objects.using(schema_editor.connection.alias).filter(period="week")
    for entry in entries.order_by("date", "pk").iterator():
        start = entry.date - timedelta(days=(entry.date.weekday() - 5) % 7)
        if start != entry.date:
            entries.filter(pk=entry.pk).update(date=start)


def monday_weeks(apps, schema_editor):
    Entry = apps.get_model("core", "PlanEntry")
    entries = Entry.objects.using(schema_editor.connection.alias).filter(period="week")
    for entry in entries.order_by("-date", "pk").iterator():
        if entry.date.weekday() == 5:
            entries.filter(pk=entry.pk).update(date=entry.date + timedelta(days=2))


class Migration(migrations.Migration):
    dependencies = [("core", "0004_number_life_areas")]
    operations = [migrations.RunPython(saturday_weeks, monday_weeks)]
