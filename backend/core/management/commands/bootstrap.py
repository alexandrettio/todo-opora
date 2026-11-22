import os
from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth import get_user_model
from core.models import Area

NAMES = [
    "Деньги и финансы",
    "Партнёр и семья",
    "Друзья и окружение",
    "Внутренний мир и духовность",
    "Яркость жизни и хобби",
    "Бизнес и карьера",
    "Саморазвитие",
    "Здоровье, спорт, красота",
    "Бытовуха",
]
COLORS = [
    "#bc8b48",
    "#b77882",
    "#828dc0",
    "#8d79b0",
    "#d18a54",
    "#5f8d9d",
    "#6d9686",
    "#97a65e",
    "#9d8875",
]


class Command(BaseCommand):
    help = "Seed areas and optionally create the initial owner from environment."

    def handle(self, *args, **kwargs):
        for n, (name, color) in enumerate(zip(NAMES, COLORS)):
            Area.objects.get_or_create(
                order=n, defaults={"name": f"{n + 1}. {name}", "color": color}
            )
        username, password = os.getenv("INITIAL_USERNAME"), os.getenv(
            "INITIAL_PASSWORD"
        )
        if (
            username
            and password
            and not get_user_model().objects.filter(username=username).exists()
        ):
            from django.contrib.auth.password_validation import validate_password

            user = get_user_model()(username=username, is_staff=True, is_superuser=True)
            validate_password(password, user)
            user.set_password(password)
            user.save()
            self.stdout.write("Initial owner created.")
        self.stdout.write("Areas ready.")
