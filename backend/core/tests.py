from datetime import date, datetime, timedelta
from unittest.mock import patch, Mock
from zoneinfo import ZoneInfo
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework.exceptions import ValidationError
from .models import (
    Item,
    Capture,
    PlanEntry,
    History,
    CalendarOccurrence,
    GoogleConnection,
    InheritedPlanning,
)
from .domain import (
    planning_day,
    week_start,
    assign,
    change_state,
    release,
    in_inbox,
    week_rows,
    sync_inheritance,
)

TZ = ZoneInfo("Europe/Moscow")
NOW = datetime(2026, 11, 19, 12, tzinfo=TZ)


@patch("django.utils.timezone.now", return_value=NOW)
class DomainTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            "owner", password="a-long-test-password"
        )

    def item(self, **kwargs):
        item = Item.objects.create(
            owner=self.user, title="Шаг", title_changed_at=NOW, **kwargs
        )
        sync_inheritance(item)
        return item

    def test_day_and_week_boundary(self, _):
        self.assertEqual(
            planning_day(datetime(2026, 11, 23, 4, 59, tzinfo=TZ)), date(2026, 11, 22)
        )
        self.assertEqual(
            week_start(planning_day(datetime(2026, 11, 23, 5, tzinfo=TZ))),
            date(2026, 11, 21),
        )

    def test_week_runs_from_saturday_through_friday(self, _):
        for offset in range(7):
            self.assertEqual(
                week_start(date(2026, 11, 21) + timedelta(days=offset)),
                date(2026, 11, 21),
            )
        self.assertEqual(week_start(date(2026, 11, 28)), date(2026, 11, 28))

    def test_project_tree_inherits_new_steps(self, _):
        project = self.item(kind="project")
        assign(project, "week", date(2026, 11, 19))
        sub = self.item(kind="project", parent=project)
        task = self.item(parent=sub)
        self.assertFalse(in_inbox(task))
        rows = week_rows(self.user, date(2026, 11, 19))
        self.assertEqual(len(rows), 3)
        self.assertTrue(next(r for r in rows if r["item"].id == task.id)["inherited"])

    def test_project_cannot_be_directly_scheduled_for_day(self, _):
        with self.assertRaises(ValidationError):
            assign(self.item(kind="project"), "day", date(2026, 11, 19))

    def test_task_conversion_keeps_day(self, _):
        task = self.item()
        entry = assign(task, "day", date(2026, 11, 19))
        task.kind = "project"
        task.save()
        self.assertTrue(PlanEntry.objects.get(pk=entry.pk).active)

    def test_started_day_move_keeps_empty_original(self, _):
        task = self.item()
        first = assign(task, "day", date(2026, 11, 19))
        assign(task, "day", date(2026, 11, 20))
        change_state(task, "done")
        first.refresh_from_db()
        self.assertFalse(first.active)
        self.assertEqual(first.outcome, "moved")
        self.assertEqual(task.entries.get(active=True).outcome, "done")

    def test_future_move_is_draft(self, _):
        task = self.item()
        first = assign(task, "day", date(2026, 11, 20))
        assign(task, "day", date(2026, 11, 21))
        self.assertFalse(PlanEntry.objects.filter(pk=first.pk).exists())
        self.assertFalse(task.history.filter(event="day_moved").exists())

    def test_early_completion_and_reopen_keep_future_plan(self, _):
        task = self.item()
        entry = assign(task, "day", date(2026, 11, 20))
        change_state(task, "done")
        entry.refresh_from_db()
        self.assertEqual(entry.outcome, "done")
        change_state(task, "open")
        entry.refresh_from_db()
        self.assertEqual(entry.outcome, "pending")
        self.assertTrue(entry.active)
        self.assertFalse(in_inbox(task))

    def test_yesterday_without_week_returns_to_inbox(self, _):
        task = self.item()
        PlanEntry.objects.create(
            owner=self.user, item=task, period="day", date=date(2026, 11, 18)
        )
        self.assertTrue(in_inbox(task))
        assign(task, "week", date(2026, 11, 19))
        self.assertFalse(in_inbox(task))

    def test_old_week_does_not_automatically_roll_over(self, _):
        task = self.item()
        PlanEntry.objects.create(
            owner=self.user, item=task, period="week", date=date(2026, 11, 9)
        )
        self.assertTrue(in_inbox(task))
        self.assertEqual(task.entries.count(), 1)

    def test_release_started_week_requires_reason(self, _):
        task = self.item()
        entry = assign(task, "week", date(2026, 11, 19))
        with self.assertRaises(ValidationError):
            release(entry)
        release(entry, "Изменилась нагрузка")
        entry.refresh_from_db()
        self.assertFalse(entry.active)
        self.assertEqual(entry.reason, "Изменилась нагрузка")

    def test_future_week_release_needs_no_reason(self, _):
        task = self.item()
        entry = assign(task, "week", date(2026, 11, 24))
        release(entry)
        self.assertFalse(PlanEntry.objects.filter(pk=entry.pk).exists())

    def test_direct_task_burial_requires_reason(self, _):
        task = self.item()
        assign(task, "week", date(2026, 11, 19))
        with self.assertRaises(ValidationError):
            change_state(task, "graveyard")
        change_state(task, "graveyard", "Потеряло смысл")
        self.assertEqual(task.status, "graveyard")

    def test_inherited_task_burial_needs_no_reason(self, _):
        project = self.item(kind="project")
        task = self.item(parent=project)
        assign(project, "week", date(2026, 11, 19))
        change_state(task, "graveyard")
        self.assertTrue(project.entries.get().active)

    def test_project_closure_bottom_up(self, _):
        project = self.item(kind="project")
        sub = self.item(kind="project", parent=project)
        task = self.item(parent=sub)
        with self.assertRaises(ValidationError):
            change_state(project, "done")
        with self.assertRaises(ValidationError):
            change_state(sub, "graveyard")
        change_state(task, "graveyard")
        change_state(sub, "graveyard")
        change_state(project, "done")
        self.assertEqual(project.status, "done")

    def test_project_burial_requires_commitment_reason(self, _):
        project = self.item(kind="project")
        assign(project, "week", date(2026, 11, 19))
        with self.assertRaises(ValidationError):
            change_state(project, "graveyard")

    def test_reopening_does_not_reopen_project(self, _):
        project = self.item(kind="project")
        task = self.item(parent=project)
        change_state(task, "done")
        change_state(project, "done")
        change_state(task, "open")
        project.refresh_from_db()
        self.assertEqual(project.status, "done")
        self.assertEqual(task.parent_id, project.id)

    def test_restore_detaches_from_closed_project(self, _):
        project = self.item(kind="project")
        task = self.item(parent=project)
        change_state(task, "graveyard")
        change_state(project, "done")
        change_state(task, "open")
        self.assertIsNone(task.parent_id)
        self.assertTrue(in_inbox(task))

    def test_not_available_and_ideas_are_hidden(self, _):
        task = self.item(available_from=date(2026, 11, 20))
        self.assertFalse(in_inbox(task))
        self.assertFalse(in_inbox(self.item(kind="idea")))

    def test_no_duplicate_inherited_and_direct_rows(self, _):
        p = self.item(kind="project")
        t = self.item(parent=p)
        assign(p, "week", date(2026, 11, 19))
        assign(t, "week", date(2026, 11, 19))
        rows = week_rows(self.user, date(2026, 11, 19))
        self.assertEqual(len(rows), 2)
        row = next(r for r in rows if r["item"].id == t.id)
        self.assertTrue(row["direct"])
        self.assertTrue(row["inherited"])


class ApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            "owner", password="a-long-test-password"
        )
        self.other = get_user_model().objects.create_user(
            "other", password="other-long-password"
        )
        self.client = APIClient()
        self.client.force_login(self.user)

    def create(self, **kw):
        r = self.client.post("/api/items/", {"title": "Тест", **kw}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        return r.data

    def test_project_areas_are_defaults_for_new_week_tasks(self):
        from .models import Area

        area = Area.objects.create(name="Работа", color="#123456")
        project = self.create(kind="project", areas=[area.pk])
        task = self.create(parent=project["id"], planned_week=str(planning_day()))
        self.assertEqual(task["areas"], [area.pk])
        self.assertTrue(PlanEntry.objects.filter(item_id=task["id"], active=True).exists())
        override = self.create(parent=project["id"], areas=[])
        self.assertEqual(override["areas"], [])

    @patch("django.utils.timezone.now", return_value=NOW)
    def test_week_markdown_export_with_direct_and_inherited_items(self, _):
        project = Item.objects.create(
            owner=self.user, title="Проект", kind="project", title_changed_at=NOW
        )
        step = Item.objects.create(
            owner=self.user, title="Шаг проекта", parent=project, title_changed_at=NOW
        )
        assign(project, "week", date(2026, 11, 26))
        response = self.client.get("/api/export/?date=2026-11-26")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "text/markdown; charset=utf-8")
        self.assertIn("week-2026-11-21.md", response["Content-Disposition"])
        content = response.content.decode()
        self.assertIn("# Неделя 2026-11-21", content)
        self.assertIn("- [ ] Проект (Проект)", content)
        self.assertIn(f"- [ ] {step.title} (Задача)", content)
        self.assertNotIn("Причина пересмотра:", content)

    @patch("django.utils.timezone.now", return_value=NOW)
    def test_week_markdown_export_preserves_result_and_release_reason(self, _):
        task = Item.objects.create(
            owner=self.user, title="Готово", title_changed_at=NOW
        )
        assign(task, "week", date(2026, 11, 19))
        change_state(task, "done", result_comment="Результат сохранён")
        released = Item.objects.create(
            owner=self.user, title="Отложено", title_changed_at=NOW
        )
        release(assign(released, "week", date(2026, 11, 19)), "Изменилась нагрузка")
        response = self.client.get("/api/export/?date=2026-11-19")
        self.assertEqual(response.status_code, 200)
        content = response.content.decode()
        self.assertIn("- [x] Готово (Задача)", content)
        self.assertIn("  - Результат: Результат сохранён", content)
        self.assertIn("  - Причина пересмотра: Изменилась нагрузка", content)

    def test_capture_can_produce_multiple_items(self):
        capture = self.client.post(
            "/api/captures/", {"text": "Подготовка к зиме"}, format="json"
        ).data
        self.create(capture=capture["id"])
        self.create(capture=capture["id"], kind="project")
        c = Capture.objects.get(pk=capture["id"])
        self.assertEqual(c.results.count(), 2)
        self.assertEqual(c.status, "open")
        self.assertEqual(
            self.client.post(
                f"/api/captures/{c.pk}/resolve/", {"status": "processed"}, format="json"
            ).status_code,
            200,
        )

    def test_ownership_isolation(self):
        item = Item.objects.create(
            owner=self.other, title="Чужое", title_changed_at=timezone.now()
        )
        self.assertEqual(self.client.get(f"/api/items/{item.pk}/").status_code, 404)
        self.assertEqual(
            self.client.post(
                f"/api/items/{item.pk}/state/", {"status": "done"}, format="json"
            ).status_code,
            404,
        )
        p = Item.objects.create(
            owner=self.other,
            title="Чужой проект",
            kind="project",
            title_changed_at=timezone.now(),
        )
        self.assertEqual(
            self.client.post(
                "/api/items/", {"title": "Шаг", "parent": str(p.pk)}, format="json"
            ).status_code,
            400,
        )
        self.assertEqual(self.client.get("/api/board/").data["items"], [])

    def test_parent_change_and_detach(self):
        p = self.create(kind="project")
        other = self.create(kind="project")
        task = self.create(parent=p["id"])
        for parent in [other["id"], None, p["id"]]:
            response = self.client.patch(
                f'/api/items/{task["id"]}/', {"parent": parent}, format="json"
            )
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(str(response.data["parent"]) if parent else response.data["parent"], parent)
            self.assertEqual(str(Item.objects.get(pk=task["id"]).parent_id) if parent else None, parent)

    def test_reparenting_updates_inherited_week_for_subtree(self):
        old = self.create(kind="project")
        new = self.create(kind="project")
        project = self.create(kind="project", parent=old["id"])
        task = self.create(parent=project["id"])
        for parent in [old, new]:
            response = self.client.post(
                f'/api/items/{parent["id"]}/plan/',
                {"period": "week", "date": str(planning_day())}, format="json",
            )
            self.assertEqual(response.status_code, 200, response.data)
        response = self.client.patch(
            f'/api/items/{project["id"]}/', {"parent": new["id"]}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        for member in [project, task]:
            active = InheritedPlanning.objects.filter(item_id=member["id"], ended_at__isnull=True)
            self.assertFalse(active.filter(source__item_id=old["id"]).exists())
            self.assertTrue(active.filter(source__item_id=new["id"]).exists())

    def test_parent_cycles_rejected(self):
        root = self.create(kind="project")
        child = self.create(kind="project", parent=root["id"])
        leaf = self.create(kind="project", parent=child["id"])
        for parent in [root["id"], child["id"], leaf["id"]]:
            response = self.client.patch(
                f'/api/items/{root["id"]}/', {"parent": parent}, format="json"
            )
            self.assertEqual(response.status_code, 400, response.data)
            self.assertIn("parent", response.data)
            self.assertIsNone(Item.objects.get(pk=root["id"]).parent_id)

    def test_invalid_conversion_rejected(self):
        project = self.create(kind="project")
        self.assertEqual(
            self.client.patch(
                f'/api/items/{project["id"]}/', {"kind": "idea"}, format="json"
            ).status_code,
            400,
        )

    def test_empty_and_invalid_inputs(self):
        self.assertEqual(
            self.client.post("/api/items/", {"title": "  "}, format="json").status_code,
            400,
        )
        self.assertEqual(
            self.client.post(
                "/api/captures/", {"text": " "}, format="json"
            ).status_code,
            400,
        )
        t = self.create()
        self.assertEqual(
            self.client.patch(
                f'/api/items/{t["id"]}/', {"tags": {"bad": "tag"}}, format="json"
            ).status_code,
            400,
        )

    def test_only_title_resets_stale_age(self):
        i = Item.objects.create(
            owner=self.user,
            title="Старое",
            title_changed_at=timezone.now() - timedelta(days=11),
        )
        r = self.client.patch(
            f"/api/items/{i.pk}/", {"comment": "Комментарий"}, format="json"
        )
        self.assertTrue(r.data["stale"])
        r = self.client.patch(
            f"/api/items/{i.pk}/", {"title": "Понятный шаг"}, format="json"
        )
        self.assertFalse(r.data["stale"])

    def test_event_checkbox_not_inbox(self):
        e = CalendarOccurrence.objects.create(
            owner=self.user,
            calendar_id="primary",
            external_id="e",
            title="Встреча",
            start=timezone.now() - timedelta(days=1),
            end=timezone.now() - timedelta(hours=23),
        )
        r = self.client.post(
            f"/api/events/{e.pk}/check/", {"done": True}, format="json"
        )
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["done"])
        self.assertEqual(self.client.get("/api/board/").data["inbox_ids"], [])

    def test_unauthenticated_access_denied(self):
        self.client.logout()
        self.assertEqual(self.client.get("/api/board/").status_code, 403)

    def test_login_requires_csrf(self):
        client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(
            client.post(
                "/api/login/", {"username": "owner", "password": "a-long-test-password"}
            ).status_code,
            403,
        )
        r = client.get("/api/session/")
        csrf = r.data["csrf"]
        self.assertEqual(
            client.post(
                "/api/login/",
                {"username": "owner", "password": "a-long-test-password"},
                HTTP_X_CSRFTOKEN=csrf,
            ).status_code,
            200,
        )

    def test_no_unowned_plan_creation(self):
        self.assertEqual(
            self.client.post("/api/plans/", {}, format="json").status_code, 400
        )

    def test_bad_date_returns_validation_error(self):
        self.assertEqual(self.client.get("/api/board/?date=invalid").status_code, 400)

    def test_deadline_priority_and_scheduled_exclusion(self):
        ordinary = self.create()
        urgent = self.create(deadline=str(planning_day() + timedelta(days=2)))
        b = self.client.get("/api/board/").data
        self.assertEqual(b["inbox_ids"][0], urgent["id"])
        self.client.post(
            f'/api/items/{urgent["id"]}/plan/',
            {"period": "week", "date": str(planning_day())},
            format="json",
        )
        self.assertNotIn(urgent["id"], self.client.get("/api/board/").data["inbox_ids"])


@override_settings(TOKEN_ENCRYPTION_KEY="oP8Y08UZN-N5mSv49co97uw96s8yQpHGlQArZEcCRug=")
class CalendarSyncTests(TestCase):
    def test_sync_preserves_calendar_selection_changed_during_sync(self):
        from .google import sync

        user = get_user_model().objects.create_user("calendar-owner")
        connection = GoogleConnection.objects.create(
            owner=user, tokens="unused", selected=["birthdays"]
        )

        def fetch(*args, **kwargs):
            GoogleConnection.objects.filter(pk=connection.pk).update(selected=[])
            return []

        with patch("core.google.pages", side_effect=fetch):
            sync(connection)
        connection.refresh_from_db()
        self.assertEqual(connection.selected, [])

    def test_resync_keeps_local_checkbox(self):
        from .google import encode, sync

        user = get_user_model().objects.create_user("owner")
        c = GoogleConnection.objects.create(
            owner=user,
            tokens=encode(
                {"access_token": "not-a-real-token", "expires_at": 9999999999}
            ),
            selected=["primary"],
        )
        event = {
            "id": "instance-1",
            "summary": "Встреча",
            "start": {"dateTime": timezone.now().isoformat()},
            "end": {"dateTime": (timezone.now() + timedelta(hours=1)).isoformat()},
        }
        with patch("core.google.pages", return_value=[event]):
            sync(c)
            e = CalendarOccurrence.objects.get()
            e.done = True
            e.save()
            sync(c)
        self.assertTrue(CalendarOccurrence.objects.get().done)
        with patch("core.google.pages", return_value=[]):
            sync(c)
        self.assertTrue(CalendarOccurrence.objects.get().cancelled)


class HistoricalWeekTests(TestCase):
    def test_later_completion_does_not_complete_previous_week(self):
        user = get_user_model().objects.create_user("history-owner")
        monday = datetime(2026, 11, 9, 12, tzinfo=TZ)
        with patch("django.utils.timezone.now", return_value=monday):
            p = Item.objects.create(
                owner=user, title="Проект", kind="project", title_changed_at=monday
            )
            assign(p, "week", date(2026, 11, 9))
            child = Item.objects.create(
                owner=user, title="Шаг", parent=p, title_changed_at=monday
            )
            sync_inheritance(child)
        with patch("django.utils.timezone.now", return_value=NOW):
            change_state(child, "done")
            rows = week_rows(user, date(2026, 11, 9))
            self.assertEqual(
                next(r["item"].status for r in rows if r["item"].id == child.id), "open"
            )
            late = Item.objects.create(
                owner=user, title="Новый шаг", parent=p, title_changed_at=NOW
            )
            sync_inheritance(late)
            self.assertNotIn(
                late.id, [r["item"].id for r in week_rows(user, date(2026, 11, 9))]
            )


class HistoryPayloadTests(TestCase):
    def test_child_edit_stores_complete_before_after(self):
        user = get_user_model().objects.create_user("editor")
        client = APIClient()
        client.force_login(user)
        project = Item.objects.create(
            owner=user,
            title="Результат",
            kind="project",
            title_changed_at=timezone.now(),
        )
        child = Item.objects.create(
            owner=user, title="Шаг", parent=project, title_changed_at=timezone.now()
        )
        response = client.patch(
            f"/api/items/{child.id}/", {"comment": "Новая мотивация"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        event = child.history.get(event="updated")
        self.assertEqual(event.data["before"]["comment"], "")
        self.assertEqual(event.data["after"]["comment"], "Новая мотивация")
        self.assertEqual(event.data["after"]["parent"], str(project.id))


@patch("django.utils.timezone.now", return_value=NOW)
class InheritedHistoryTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("inherited-owner")

    def make(self, **kwargs):
        i = Item.objects.create(
            owner=self.user, title="Дело", title_changed_at=NOW, **kwargs
        )
        sync_inheritance(i)
        return i

    def test_completed_steps_before_commitment_are_not_added(self, _):
        p = self.make(kind="project")
        t = self.make(parent=p)
        change_state(t, "done")
        assign(p, "week", planning_day())
        self.assertNotIn(
            t.id, [r["item"].id for r in week_rows(self.user, planning_day())]
        )
        change_state(t, "open")
        self.assertFalse(in_inbox(t))

    def test_release_preserves_inherited_history(self, _):
        p = self.make(kind="project")
        t = self.make(parent=p)
        entry = assign(p, "week", planning_day())
        release(entry, "Другой приоритет")
        rows = week_rows(self.user, planning_day())
        self.assertEqual(len(rows), 2)
        self.assertFalse(next(r for r in rows if r["item"].id == t.id)["active"])
        self.assertTrue(in_inbox(t))

    def test_detachment_does_not_erase_inherited_history(self, _):
        p = self.make(kind="project")
        t = self.make(parent=p)
        assign(p, "week", planning_day())
        change_state(t, "graveyard")
        change_state(p, "done")
        change_state(t, "open")
        self.assertTrue(in_inbox(t))
        rows = week_rows(self.user, planning_day())
        self.assertIn(t.id, [r["item"].id for r in rows])


class CreateInDayTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("day-owner")
        self.client = APIClient()
        self.client.force_login(self.user)

    def test_new_task_is_created_in_selected_day_and_not_in_inbox(self):
        day = planning_day() + timedelta(days=2)
        response = self.client.post(
            "/api/items/",
            {"title": "Забрать посылку", "planned_day": str(day)},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        entry = PlanEntry.objects.get(item_id=response.data["id"])
        self.assertEqual(entry.date, day)
        self.assertEqual(entry.period, "day")
        board = self.client.get(f"/api/board/?date={day}").data
        self.assertEqual(str(board["day_entries"][0]["item"]), response.data["id"])
        self.assertNotIn(response.data["id"], board["inbox_ids"])

    def test_invalid_initial_plan_does_not_leave_an_orphan_task(self):
        for payload in [
            {"planned_day": str(planning_day() - timedelta(days=1))},
            {"kind": "project", "planned_day": str(planning_day())},
            {
                "available_from": str(planning_day() + timedelta(days=2)),
                "planned_day": str(planning_day()),
            },
        ]:
            response = self.client.post(
                "/api/items/",
                {"title": "Не должно создаться", **payload},
                format="json",
            )
            self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(Item.objects.filter(owner=self.user).exists())


class CreateInWeekTests(CreateInDayTests):
    def test_create_in_current_and_future_week(self):
        for week in [week_start(planning_day()), week_start(planning_day()) + timedelta(days=14)]:
            for kind in ["task", "project"]:
                response = self.client.post("/api/items/", {
                    "title": "Дело на неделю", "kind": kind, "planned_week": str(week)
                }, format="json")
                self.assertEqual(response.status_code, 201, response.data)
                entry = PlanEntry.objects.get(item_id=response.data["id"])
                self.assertEqual((entry.period, entry.date), ("week", week))
                board = self.client.get(f"/api/board/?date={week}").data
                self.assertIn(response.data["id"], [str(row["item"]["id"]) for row in board["week_rows"] if row["active"]])
                self.assertNotIn(response.data["id"], board["inbox_ids"])

    def test_capture_can_create_directly_in_day_or_week(self):
        capture = Capture.objects.create(owner=self.user, text="Разобрать мысль")
        for period in ["day", "week"]:
            day = planning_day() + timedelta(days=8)
            response = self.client.post("/api/items/", {
                "title": "Сразу в план", "capture": str(capture.id),
                f"planned_{period}": str(day),
                **({"planned_section": "До сада"} if period == "day" else {}),
            }, format="json")
            self.assertEqual(response.status_code, 201, response.data)
            item = Item.objects.get(pk=response.data["id"])
            self.assertEqual(item.capture_id, capture.id)
            entry = PlanEntry.objects.get(item=item)
            self.assertEqual(entry.period, period)
            self.assertEqual(entry.date, day if period == "day" else week_start(day))
            if period == "day":
                self.assertEqual(entry.section, "До сада")
            self.assertFalse(in_inbox(item))
        self.assertEqual(capture.results.count(), 2)

    def test_capture_resolution_is_optional_and_atomic(self):
        for resolve in [True, False]:
            capture = Capture.objects.create(owner=self.user, text="Мысль")
            payload = {"title": "Дело", "capture": str(capture.id), "resolve_capture": resolve}
            response = self.client.post("/api/items/", {
                **payload, "planned_week": str(week_start(planning_day()) - timedelta(days=7))
            }, format="json")
            self.assertEqual(response.status_code, 400, response.data)
            capture.refresh_from_db()
            self.assertEqual(capture.status, "open")
            self.assertEqual(capture.results.count(), 0)
            response = self.client.post("/api/items/", payload, format="json")
            self.assertEqual(response.status_code, 201, response.data)
            capture.refresh_from_db()
            self.assertEqual(capture.status, "processed" if resolve else "open")
            self.assertEqual(capture.results.count(), 1)

    def test_invalid_week_rolls_back_creation(self):
        for payload in [
            {"planned_week": str(week_start(planning_day()) - timedelta(days=7))},
            {"planned_week": str(planning_day()), "kind": "idea"},
            {"planned_week": str(planning_day()), "planned_day": str(planning_day())},
        ]:
            response = self.client.post("/api/items/", {"title": "Ошибка", **payload}, format="json")
            self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(Item.objects.filter(owner=self.user).exists())


class DaySectionSettingsTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("sections-owner")
        self.other = get_user_model().objects.create_user("sections-other")
        self.client = APIClient()
        self.client.force_login(self.user)

    def test_default_sections_available_on_any_day(self):
        expected = [
            "Календарные встречи",
            "До сада",
            "Без детей",
            "После сада",
            "В Москве",
            "В Ватутинках",
        ]
        self.assertEqual(self.client.get("/api/board/").data["day_sections"], expected)
        future = planning_day() + timedelta(days=5)
        self.assertEqual(
            self.client.get(f"/api/board/?date={future}").data["day_sections"], expected
        )

    def test_settings_keep_order_and_are_user_specific(self):
        response = self.client.patch(
            "/api/settings/day-sections/",
            {"sections": [" Вечером ", "Утром"]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            self.client.get("/api/board/").data["day_sections"], ["Вечером", "Утром"]
        )
        self.client.force_login(self.other)
        self.assertIn(
            "До сада", self.client.get("/api/settings/day-sections/").data["sections"]
        )

    def test_invalid_names_and_duplicates_rejected(self):
        for sections in [["До сада", "до сада"], [" "], ["x" * 161], ["x"] * 41]:
            response = self.client.patch(
                "/api/settings/day-sections/", {"sections": sections}, format="json"
            )
            self.assertEqual(response.status_code, 400, response.data)

    def test_create_in_section_and_removing_default_does_not_remove_assignment(self):
        day = planning_day()
        response = self.client.post(
            "/api/items/",
            {
                "title": "Забрать посылку",
                "planned_day": str(day),
                "planned_section": "В Москве",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(
            PlanEntry.objects.get(item_id=response.data["id"]).section, "В Москве"
        )
        self.client.patch(
            "/api/settings/day-sections/", {"sections": []}, format="json"
        )
        board = self.client.get("/api/board/").data
        self.assertEqual(board["day_sections"], [])
        self.assertEqual(board["day_entries"][0]["section"], "В Москве")

    def test_section_without_day_rejected(self):
        response = self.client.post(
            "/api/items/",
            {"title": "Задача", "planned_section": "До сада"},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(Item.objects.filter(owner=self.user).exists())


class WeeklyScheduledDayTests(TestCase):
    def test_latest_day_ignores_removed_entries_and_other_weeks(self):
        user = get_user_model().objects.create_user("weekly-dates")
        item = Item.objects.create(owner=user, title="Запланированное дело", title_changed_at=NOW)
        unscheduled = Item.objects.create(owner=user, title="Без даты", title_changed_at=NOW)
        for task in [item, unscheduled]:
            PlanEntry.objects.create(owner=user, item=task, period="week", date=date(2026, 11, 14))
        for day, outcome in [(16, "done"), (18, "pending"), (19, "moved"), (20, "released"), (23, "pending")]:
            PlanEntry.objects.create(owner=user, item=item, period="day", date=date(2026, 11, day), active=False, outcome=outcome)
        client = APIClient()
        client.force_authenticate(user)
        response = client.get("/api/board/?date=2026-11-19")
        self.assertEqual(response.status_code, 200)
        rows = {row["item"]["id"]: row for row in response.data["week_rows"]}
        self.assertEqual(str(rows[str(item.id)]["scheduled_day"]), "2026-11-18")
        self.assertIsNone(rows[str(unscheduled.id)]["scheduled_day"])
