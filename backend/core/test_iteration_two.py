"""Acceptance scenarios for the agreed second iteration."""
from datetime import date, datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient
from .models import (Habit, HabitVersion, HabitLog, HabitLogRevision, HabitPause,
                     Reflection, ReflectionTemplate, Item, PlanEntry, Area)
from .habits import habit_cell
from .domain import assign, release, planning_day, week_rows
from .periods import period_start, period_end

TODAY = date(2026, 11, 26)
NOW = datetime(2026, 11, 26, 12, tzinfo=ZoneInfo("Europe/Moscow"))


@patch("django.utils.timezone.now", return_value=NOW)
class IterationTwoTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user("iteration-owner")
        cls.other = get_user_model().objects.create_user("iteration-other")
        cls.area = Area.objects.create(name="Здоровье")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def definition(self, **kwargs):
        return {"title": "Вода", "effective_from": "2026-11-01", "start_date": "2026-11-01",
                "mode": "weekdays", "weekdays": list(range(7)), "target": 3,
                "counter_period": "day", "areas": [self.area.pk], **kwargs}

    def habit(self, **kwargs):
        response = self.client.post("/api/habits/", self.definition(**kwargs), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return Habit.objects.get(pk=response.data["id"])

    def log(self, habit, day=TODAY, **kwargs):
        return self.client.post(f"/api/habits/{habit.pk}/log/", {"date": str(day), **kwargs}, format="json")

    def cell(self, habit, day=TODAY):
        return habit_cell(list(habit.versions.prefetch_related("areas")), list(habit.pauses.all()), {l.date: l for l in habit.logs.all()}, day)

    def item(self, **kwargs):
        return Item.objects.create(owner=self.owner, title="Занятие", title_changed_at=NOW, **kwargs)

    def test_counter_has_no_target_cap(self, _):
        habit = self.habit()
        for _ in range(4):
            self.assertEqual(self.log(habit, delta=1).status_code, 200)
        cell = self.cell(habit)
        self.assertEqual((cell["total"], cell["target"], cell["reached"], cell["expected"]), (4, 3, True, True))
        self.assertEqual(HabitLogRevision.objects.count(), 4)

    def test_week_counter_resets_on_saturday_and_is_as_of_date(self, _):
        habit = self.habit(counter_period="week")
        self.log(habit, date(2026, 11, 20), count=9)
        self.log(habit, date(2026, 11, 21), count=1)
        self.log(habit, date(2026, 11, 25), count=2)
        self.assertEqual(self.cell(habit, date(2026, 11, 21))["total"], 1)
        self.assertEqual(self.cell(habit)["total"], 3)
        self.assertEqual(self.cell(habit, date(2026, 11, 28))["total"], 0)

    def test_month_counter_resets_without_losing_history(self, _):
        habit = self.habit(counter_period="month", effective_from="2026-10-01", start_date="2026-10-01")
        self.log(habit, date(2026, 10, 31), count=4)
        self.log(habit, date(2026, 11, 1), count=1)
        self.assertEqual(self.cell(habit, date(2026, 10, 31))["total"], 4)
        self.assertEqual(self.cell(habit, date(2026, 11, 1))["total"], 1)

    def test_calendar_misses_do_not_carry(self, _):
        habit = self.habit(weekdays=[0])
        self.assertTrue(self.cell(habit, date(2026, 11, 23))["expected"])
        self.assertFalse(self.cell(habit, date(2026, 11, 24))["expected"])

    def test_interval_is_anchored_to_first_date(self, _):
        habit = self.habit(mode="interval", interval=3, start_date="2026-11-02")
        self.log(habit, date(2026, 11, 3), count=1)
        self.assertTrue(self.cell(habit, date(2026, 11, 5))["expected"])
        self.assertFalse(self.cell(habit, date(2026, 11, 6))["expected"])

    def test_after_mode_carries_until_actual_completion(self, _):
        habit = self.habit(mode="after", interval=3, target=1, start_date="2026-11-20")
        self.assertTrue(self.cell(habit, date(2026, 11, 21))["expected"])
        self.log(habit, date(2026, 11, 22), count=1)
        self.assertTrue(self.cell(habit, date(2026, 11, 22))["expected"])
        self.assertFalse(self.cell(habit, date(2026, 11, 24))["expected"])
        self.assertTrue(self.cell(habit, date(2026, 11, 25))["expected"])
        self.assertTrue(self.cell(habit, date(2026, 11, 26))["expected"])

    def test_after_skip_and_zero_do_not_advance_schedule(self, _):
        habit = self.habit(mode="after", interval=3, target=1, start_date="2026-11-20")
        self.log(habit, date(2026, 11, 21), state="skipped")
        self.log(habit, date(2026, 11, 22), count=0)
        self.assertTrue(self.cell(habit, date(2026, 11, 23))["expected"])

    def test_after_cannot_have_quantity_or_week_period(self, _):
        for fields in [{"target": 3}, {"target": 1, "counter_period": "week"}]:
            r = self.client.post("/api/habits/", self.definition(mode="after", **fields), format="json")
            self.assertEqual(r.status_code, 400)
        self.assertEqual(Habit.objects.count(), 0)

    def test_31_and_last_day_are_different_in_february(self, _):
        a = self.habit(mode="monthdays", monthdays=[31])
        b = self.habit(mode="monthdays", monthdays=[], last_day=True)
        for day in [date(2027, 2, 28), date(2028, 2, 29)]:
            self.assertFalse(self.cell(a, day)["expected"])
            self.assertTrue(self.cell(b, day)["expected"])

    def test_missing_zero_skip_and_clear_are_distinct(self, _):
        habit = self.habit()
        self.assertEqual(self.cell(habit)["state"], "unrecorded")
        self.log(habit, count=0)
        self.assertEqual(self.cell(habit)["state"], "recorded")
        self.log(habit, state="skipped")
        self.assertEqual(self.cell(habit)["state"], "skipped")
        self.log(habit, state="unrecorded")
        self.assertEqual(self.cell(habit)["state"], "unrecorded")
        self.assertEqual(HabitLogRevision.objects.count(), 3)

    def test_off_schedule_facts_and_backdated_corrections(self, _):
        habit = self.habit(weekdays=[0], counter_period="week")
        self.log(habit, date(2026, 11, 24), count=4)
        c = self.cell(habit, date(2026, 11, 24))
        self.assertFalse(c["expected"])
        self.assertEqual(c["total"], 4)
        self.log(habit, date(2026, 11, 24), count=2)
        self.assertEqual(self.cell(habit)["total"], 2)

    def test_invalid_log_does_not_create_record(self, _):
        habit = self.habit()
        self.assertEqual(self.log(habit, delta=-1).status_code, 400)
        self.assertEqual(habit.logs.count(), 0)
        self.assertEqual(self.log(habit, state="skipped", count=1).status_code, 400)

    def test_future_facts_rejected_but_section_can_be_prepared(self, _):
        habit = self.habit()
        future = TODAY + timedelta(days=1)
        self.assertEqual(self.log(habit, future, count=1).status_code, 400)
        self.assertEqual(self.log(habit, future, section="Утро").status_code, 200)
        cell = self.cell(habit, future)
        self.assertEqual((cell["state"], cell["section"]), ("unrecorded", "Утро"))

    def test_dated_definition_keeps_past_expectations(self, _):
        habit = self.habit(weekdays=[0], section="Утро")
        payload = self.definition(effective_from="2026-11-25", title="Новая вода", weekdays=[3], section="Вечер", target=5)
        r = self.client.post(f"/api/habits/{habit.pk}/revise/", payload, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        old = self.cell(habit, date(2026, 11, 23))
        self.assertEqual((old["title"], old["target"], old["section"], old["expected"]), ("Вода", 3, "Утро", True))
        self.assertEqual(self.cell(habit)["title"], "Новая вода")

    def test_pause_archive_and_section_override_preserve_facts(self, _):
        habit = self.habit(section="Утро")
        self.log(habit, count=2, section="Вечер")
        r = self.client.post(f"/api/habits/{habit.pk}/pause/", {"start": "2026-11-25", "end": "2026-11-27"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertFalse(self.cell(habit)["expected"])
        self.assertEqual(self.cell(habit)["section"], "Вечер")
        self.assertEqual(self.cell(habit)["total"], 2)
        self.assertEqual(self.client.post(f"/api/habits/{habit.pk}/pauses/{r.data['id']}/cancel/").status_code, 200)
        self.assertTrue(self.cell(habit)["expected"])
        self.client.post(f"/api/habits/{habit.pk}/revise/", self.definition(effective_from="2026-11-27", archived=True), format="json")
        self.assertFalse(self.cell(habit, date(2026, 11, 27))["expected"])
        self.assertTrue(self.cell(habit)["expected"])

    def test_habit_ownership_for_all_mutations(self, _):
        habit = self.habit()
        pause = HabitPause.objects.create(owner=self.owner, habit=habit, start=TODAY, end=TODAY)
        self.client.force_authenticate(self.other)
        for path, data in [("log", {"date": str(TODAY), "count": 1}), ("revise", self.definition()), ("pause", {"start": str(TODAY), "end": str(TODAY)}), (f"pauses/{pause.pk}/cancel", {})]:
            self.assertEqual(self.client.post(f"/api/habits/{habit.pk}/{path}/", data, format="json").status_code, 404)
        self.assertEqual(self.client.get("/api/habit-board/").data["habits"], [])

    def test_bad_schedule_and_pause_are_rejected(self, _):
        for fields in [{"weekdays": []}, {"weekdays": [True]}, {"mode": "interval", "interval": 0}, {"mode": "monthdays", "monthdays": [32]}]:
            self.assertEqual(self.client.post("/api/habits/", self.definition(**fields), format="json").status_code, 400)
        habit = self.habit()
        r = self.client.post(f"/api/habits/{habit.pk}/pause/", {"start": "2026-11-27", "end": "2026-11-26"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_habit_board_has_separate_daily_counts_and_period_totals(self, _):
        habit = self.habit(counter_period="week")
        self.log(habit, date(2026, 11, 24), count=2)
        self.log(habit, count=1)
        r = self.client.get("/api/habit-board/?date=2026-11-26")
        self.assertEqual(r.status_code, 200)
        cells = r.data["habits"][0]["cells"]
        self.assertEqual(len(cells), 7)
        day = next(c for c in cells if c["date"] == "2026-11-26")
        self.assertEqual((day["count"], day["total"], day["areas"]), (1, 3, [self.area.pk]))
        self.assertEqual(PlanEntry.objects.count(), 0)

    def test_reflection_is_explicit_idempotent_and_copies_template(self, _):
        self.client.post("/api/reflection-templates/", {"period": "week", "body": "## Что поддержало?"}, format="json")
        self.assertEqual(self.client.get("/api/reflections/?period=week&date=2026-11-26").data, [])
        self.assertEqual(Reflection.objects.count(), 0)
        payload = {"period": "week", "date": "2026-11-26"}
        first = self.client.post("/api/reflections/", payload, format="json")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.data["date"], "2026-11-21")
        self.client.post("/api/reflection-templates/", {"period": "week", "body": "Новый шаблон"}, format="json")
        again = self.client.post("/api/reflections/", payload, format="json")
        self.assertEqual(again.data["id"], first.data["id"])
        self.assertEqual(again.data["body"], "## Что поддержало?")
        self.assertEqual(again.data["template_snapshot"], "## Что поддержало?")

    def test_reflection_can_edit_past_and_future_with_conflict_protection(self, _):
        for day in ["2026-01-01", "2027-01-01"]:
            r = self.client.post("/api/reflections/", {"period": "day", "date": day}, format="json")
            url = f"/api/reflections/{r.data['id']}/"
            r = self.client.patch(url, {"body": "Мой текст", "revision": 1}, format="json")
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.data["revision"], 2)
            self.assertEqual(self.client.patch(url, {"body": "Чужая старая правка", "revision": 1}, format="json").status_code, 400)
            self.assertEqual(self.client.get(url).data["body"], "Мой текст")

    def test_reflection_ownership_and_all_periods(self, _):
        for period, expected in [("day", "2026-11-26"), ("week", "2026-11-21"), ("month", "2026-11-01"), ("quarter", "2026-10-01"), ("year", "2026-01-01")]:
            r = self.client.post("/api/reflections/", {"period": period, "date": "2026-11-26"}, format="json")
            self.assertEqual(r.data["date"], expected)
        entry = Reflection.objects.first()
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get("/api/reflections/").data, [])
        self.assertEqual(self.client.patch(f"/api/reflections/{entry.pk}/", {"body": "x", "revision": 1}, format="json").status_code, 404)
        self.assertEqual(self.client.get("/api/reflection-templates/").data, [])

    def test_month_and_quarter_are_proposals_and_release_without_reason(self, _):
        project = self.item(kind="project")
        self.item(parent=project)
        for period, day, expected in [("month", TODAY, date(2026, 11, 1)), ("quarter", TODAY, date(2026, 10, 1))]:
            entry = assign(project, period, day)
            self.assertEqual(entry.date, expected)
            self.assertEqual(entry.inherited_members.count(), 0)
            release(entry)
            entry.refresh_from_db()
            self.assertFalse(entry.active)
        self.assertEqual(week_rows(self.owner, TODAY), [])

    def test_week_straddling_months_gets_both_sources_and_project_steps(self, _):
        a, b = self.item(kind="project"), self.item()
        child = self.item(parent=a)
        assign(a, "month", TODAY)
        assign(b, "month", date(2026, 12, 1))
        r = self.client.get("/api/planning/?period=week&date=2026-11-30")
        self.assertEqual(r.status_code, 200)
        self.assertEqual({s["item"]["id"] for s in r.data["suggestions"]}, {str(a.pk), str(b.pk), str(child.pk)})
        assign(child, "week", date(2026, 11, 30))
        self.assertEqual({row["item"].pk for row in week_rows(self.owner, date(2026, 11, 30))}, {child.pk})

    def test_month_gets_quarter_suggestions(self, _):
        item = self.item()
        assign(item, "quarter", TODAY)
        r = self.client.get("/api/planning/?period=month&date=2026-12-15")
        self.assertEqual(r.data["suggestions"][0]["item"]["id"], str(item.pk))
        self.assertEqual(r.data["entries"], [])

    def test_transfer_is_explicit_and_preserves_original_history(self, _):
        item = self.item()
        entry = assign(item, "month", TODAY)
        r = self.client.get("/api/planning/?period=month&date=2026-12-15")
        self.assertEqual(len(r.data["previous"]), 1)
        self.assertEqual(PlanEntry.objects.count(), 1)
        r = self.client.post(f"/api/plans/{entry.pk}/transfer/", {"period": "month", "date": "2026-12-15"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["date"], "2026-12-01")
        entry.refresh_from_db()
        self.assertEqual((entry.active, entry.outcome), (False, "moved"))
        self.assertEqual(PlanEntry.objects.count(), 2)

    def test_planning_is_owned_and_completed_not_suggested(self, _):
        item = self.item(status="done")
        PlanEntry.objects.create(owner=self.owner, item=item, period="month", date=date(2026, 11, 1))
        self.assertEqual(self.client.get("/api/planning/?period=week").data["suggestions"], [])
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get("/api/planning/?period=month").data["entries"], [])

    def test_bad_period_and_past_planning_rejected(self, _):
        item = self.item()
        for period, day in [("month", "2026-10-15"), ("quarter", "2026-08-15")]:
            r = self.client.post(f"/api/items/{item.pk}/plan/", {"period": period, "date": day}, format="json")
            self.assertEqual(r.status_code, 400)
        self.assertEqual(self.client.get("/api/planning/?period=year").status_code, 400)
        self.assertEqual(self.client.get("/api/habit-board/?date=broken").status_code, 400)

    def test_calendar_boundaries_cross_year_and_five_am(self, _):
        self.assertEqual(period_start("quarter", date(2026, 12, 31)), date(2026, 10, 1))
        self.assertEqual(period_end("quarter", date(2026, 12, 31)), date(2027, 1, 1))
        self.assertEqual(period_end("month", date(2028, 2, 15)), date(2028, 3, 1))
        before = datetime(2027, 1, 1, 4, 59, tzinfo=ZoneInfo("Europe/Moscow"))
        self.assertEqual(period_start("year", planning_day(before)), date(2026, 1, 1))

    def test_new_endpoints_require_authentication(self, _):
        self.client.force_authenticate(None)
        for url in ["/api/habits/", "/api/habit-board/", "/api/reflections/", "/api/reflection-templates/", "/api/planning/"]:
            self.assertIn(self.client.get(url).status_code, [401, 403])

    def test_create_directly_in_large_plan_is_atomic(self, _):
        for period in ["month", "quarter"]:
            result = self.client.post("/api/items/", {"title": "Новый проект", "kind": "project", f"planned_{period}": str(TODAY)}, format="json")
            self.assertEqual(result.status_code, 201, result.data)
            self.assertTrue(PlanEntry.objects.filter(item_id=result.data["id"], period=period, date=period_start(period, TODAY)).exists())
        count = Item.objects.count()
        result = self.client.post("/api/items/", {"title": "Не создавать", "planned_month": "2026-10-01"}, format="json")
        self.assertEqual(result.status_code, 400)
        self.assertEqual(Item.objects.count(), count)

    def test_no_mixed_initial_plans_or_week_transfer(self, _):
        result = self.client.post("/api/items/", {"title": "Шаг", "planned_month": str(TODAY), "planned_week": str(TODAY)}, format="json")
        self.assertEqual(result.status_code, 400)
        item = self.item()
        week = assign(item, "week", TODAY)
        result = self.client.post(f"/api/plans/{week.pk}/transfer/", {"period": "week", "date": "2026-12-01"}, format="json")
        self.assertEqual(result.status_code, 400)
        week.refresh_from_db()
        self.assertTrue(week.active)

    def test_new_reflection_preserves_explicit_text(self, _):
        ReflectionTemplate.objects.create(owner=self.owner, period="month", body="## Вопрос")
        result = self.client.post("/api/reflections/", {"period": "month", "date": str(TODAY), "body": "Мой готовый текст"}, format="json")
        self.assertEqual(result.status_code, 201)
        self.assertEqual(result.data["body"], "Мой готовый текст")
        self.assertEqual(result.data["template_snapshot"], "## Вопрос")
