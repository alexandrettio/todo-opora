import json, secrets
from datetime import timedelta, datetime, time
from urllib.parse import urlencode
import requests
from cryptography.fernet import Fernet
from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from .models import GoogleConnection, CalendarOccurrence
from .domain import planning_day, boundary, TZ


class GoogleError(Exception):
    pass


def cipher():
    if not settings.TOKEN_ENCRYPTION_KEY:
        raise GoogleError("Задай TOKEN_ENCRYPTION_KEY на сервере.")
    return Fernet(settings.TOKEN_ENCRYPTION_KEY.encode())


def encode(data):
    return cipher().encrypt(json.dumps(data).encode()).decode()


def decode(data):
    return json.loads(cipher().decrypt(data.encode()))


def auth_url(request):
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise GoogleError(
            "На сервере ещё не настроен Google OAuth. Инструкция есть в README."
        )
    cipher()
    state = secrets.token_urlsafe(32)
    request.session["google_state"] = state
    request.session["google_state_at"] = timezone.now().timestamp()
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(
        {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "redirect_uri": settings.GOOGLE_REDIRECT_URI,
            "response_type": "code",
            "scope": "https://www.googleapis.com/auth/calendar.readonly",
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
        }
    )


def checked(response):
    if not response.ok:
        raise GoogleError(
            f"Google вернул ошибку {response.status_code}. Переподключи календарь или повтори позже."
        )
    return response.json()


def exchange(owner, code):
    data = checked(
        requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
            timeout=20,
        )
    )
    data["expires_at"] = timezone.now().timestamp() + data.get("expires_in", 3600)
    conn, created = GoogleConnection.objects.get_or_create(
        owner=owner, defaults={"tokens": encode(data)}
    )
    if not data.get("refresh_token"):
        old = decode(conn.tokens)
        data["refresh_token"] = old.get("refresh_token")
    conn.tokens = encode(data)
    conn.save(update_fields=["tokens"])
    refresh_calendars(conn, initialize=created)
    return conn


def token(conn):
    data = decode(conn.tokens)
    if data.get("expires_at", 0) < timezone.now().timestamp() + 60:
        fresh = checked(
            requests.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "refresh_token": data.get("refresh_token"),
                    "grant_type": "refresh_token",
                },
                timeout=20,
            )
        )
        data.update(fresh)
        data["expires_at"] = timezone.now().timestamp() + data.get("expires_in", 3600)
        conn.tokens = encode(data)
        conn.save(update_fields=["tokens"])
    return data["access_token"]


def pages(url, conn, params=None):
    params = dict(params or {})
    headers = {"Authorization": f"Bearer {token(conn)}"}
    result = []
    while True:
        data = checked(requests.get(url, headers=headers, params=params, timeout=25))
        result.extend(data.get("items", []))
        if not data.get("nextPageToken"):
            return result
        params["pageToken"] = data["nextPageToken"]


def refresh_calendars(conn, initialize=False):
    calendars = pages(
        "https://www.googleapis.com/calendar/v3/users/me/calendarList", conn
    )
    conn.calendars = [
        {
            "id": c["id"],
            "name": c.get("summary", "Календарь"),
            "primary": c.get("primary", False),
        }
        for c in calendars
    ]
    if initialize:
        conn.selected = [c["id"] for c in conn.calendars if c["primary"]]
    conn.save(update_fields=["calendars", "selected"] if initialize else ["calendars"])


def sync(conn):
    from urllib.parse import quote

    start = boundary(planning_day() - timedelta(days=35))
    end = boundary(planning_day() + timedelta(days=100))
    for calendar_id in conn.selected:
        events = pages(
            f'https://www.googleapis.com/calendar/v3/calendars/{quote(calendar_id,safe="")}/events',
            conn,
            {
                "timeMin": start.isoformat(),
                "timeMax": end.isoformat(),
                "singleEvents": "true",
                "showDeleted": "true",
                "maxResults": 2500,
            },
        )
        seen = []
        for e in events:
            seen.append(e["id"])
            if e.get("status") == "cancelled":
                CalendarOccurrence.objects.filter(
                    owner=conn.owner, calendar_id=calendar_id, external_id=e["id"]
                ).update(cancelled=True)
                continue
            all_day = "date" in e.get("start", {})

            def parse(v):
                return (
                    datetime.combine(
                        datetime.fromisoformat(v["date"]).date(), time.min, tzinfo=TZ
                    )
                    if "date" in v
                    else datetime.fromisoformat(v["dateTime"].replace("Z", "+00:00"))
                )

            CalendarOccurrence.objects.update_or_create(
                owner=conn.owner,
                calendar_id=calendar_id,
                external_id=e["id"],
                defaults={
                    "title": e.get("summary", "Без названия"),
                    "start": parse(e["start"]),
                    "end": parse(e["end"]),
                    "all_day": all_day,
                    "cancelled": False,
                    "url": e.get("htmlLink", ""),
                },
            )
        CalendarOccurrence.objects.filter(
            owner=conn.owner, calendar_id=calendar_id, start__gte=start, start__lt=end
        ).exclude(external_id__in=seen).update(cancelled=True)
    conn.last_sync = timezone.now()
    conn.last_error = ""
    conn.save(update_fields=["last_sync", "last_error"])
