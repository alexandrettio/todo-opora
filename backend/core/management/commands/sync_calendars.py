from django.core.management.base import BaseCommand
from core.models import GoogleConnection
from core.google import sync


class Command(BaseCommand):
    help = "Synchronize Google calendars; run every hour."

    def handle(self, *args, **options):
        for connection in GoogleConnection.objects.all():
            try:
                sync(connection)
            except Exception:
                connection.last_error = "Не удалось синхронизировать календарь."
                connection.save(update_fields=["last_error"])
                self.stderr.write(f"Sync failed for connection {connection.id}")
