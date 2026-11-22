from django.db import migrations

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


def number_areas(apps, schema_editor):
    Area = apps.get_model("core", "Area")
    for order, name in enumerate(NAMES):
        Area.objects.using(schema_editor.connection.alias).filter(order=order).update(
            name=f"{order + 1}. {name}"
        )


def unnumber_areas(apps, schema_editor):
    Area = apps.get_model("core", "Area")
    for order, name in enumerate(NAMES):
        Area.objects.using(schema_editor.connection.alias).filter(
            order=order, name=f"{order + 1}. {name}"
        ).update(name=name)


class Migration(migrations.Migration):
    dependencies = [("core", "0003_daysettings")]
    operations = [migrations.RunPython(number_areas, unnumber_areas)]
