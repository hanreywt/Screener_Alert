"""Alert formatting + dispatch (console always, Telegram if configured)."""
from __future__ import annotations
import requests

import config
from signals import Signal

_ICON = {"watch": "👀", "break": "💥", "retest": "🎯", "bounce": "🔄"}


def _bar(pct: float, width: int = 10) -> str:
    filled = int(round(pct / 100 * width))
    return "█" * filled + "░" * (width - filled)


def format_signal(s: Signal) -> str:
    icon = _ICON.get(s.kind, "•")
    tags = f" [{', '.join(s.zone.tags)}]" if s.zone.tags else ""
    lines = [
        f"{icon} {s.symbol}  {s.kind.upper()}  @ {s.price}",
        f"   Zone {s.zone.price}  ({s.zone.kind}){tags}",
        f"   Strength {s.zone.strength}/100  {_bar(s.zone.strength)}  "
        f"touches={s.zone.touches}",
    ]
    if s.kind == "break":
        lines.append(f"   Break rating {s.break_rating}/100  "
                     f"{_bar(s.break_rating)}")
    if s.kind == "retest":
        lines += [
            f"   ➜ Entry {s.entry}  Stop {s.stop}  Target {s.target}  "
            f"R:R {s.rr}",
            f"   ℹ {s.winrate_note}",
        ]
    lines.append(f"   {s.detail}")
    return "\n".join(lines)


def send_telegram(text: str) -> None:
    if not (config.TELEGRAM_TOKEN and config.TELEGRAM_CHAT_ID):
        return
    url = f"https://api.telegram.org/bot{config.TELEGRAM_TOKEN}/sendMessage"
    try:
        requests.post(url, json={
            "chat_id": config.TELEGRAM_CHAT_ID,
            "text": text,
            "parse_mode": "HTML",
        }, timeout=10)
    except Exception:  # noqa: BLE001
        pass  # never let alerting crash the engine


# Discord embed accent colors per alert kind (decimal RGB).
_DISCORD_COLOR = {
    "watch":  0x3498DB,  # blue
    "break":  0xE74C3C,  # red
    "retest": 0x2ECC71,  # green
    "bounce": 0xF1C40F,  # yellow
}


def send_discord(s: Signal) -> None:
    if not config.DISCORD_WEBHOOK_URL:
        return
    icon = _ICON.get(s.kind, "•")
    tags = f" [{', '.join(s.zone.tags)}]" if s.zone.tags else ""
    fields = [
        {"name": "Zone", "value": f"{s.zone.price} ({s.zone.kind}){tags}",
         "inline": True},
        {"name": "Strength", "value": f"{s.zone.strength}/100 "
         f"{_bar(s.zone.strength)}", "inline": True},
        {"name": "Touches", "value": str(s.zone.touches), "inline": True},
    ]
    if s.kind == "break":
        fields.append({"name": "Break rating",
                       "value": f"{s.break_rating}/100", "inline": True})
    if s.kind == "retest":
        fields += [
            {"name": "Entry", "value": str(s.entry), "inline": True},
            {"name": "Stop", "value": str(s.stop), "inline": True},
            {"name": "Target", "value": str(s.target), "inline": True},
            {"name": "R:R", "value": str(s.rr), "inline": True},
            {"name": "Note", "value": s.winrate_note, "inline": False},
        ]
    embed = {
        "title": f"{icon} {s.symbol}  {s.kind.upper()}  @ {s.price}",
        "description": s.detail,
        "color": _DISCORD_COLOR.get(s.kind, 0x95A5A6),
        "fields": fields,
    }
    try:
        requests.post(config.DISCORD_WEBHOOK_URL,
                      json={"embeds": [embed]}, timeout=10)
    except Exception:  # noqa: BLE001
        pass  # never let alerting crash the engine


def dispatch(signals: list[Signal]) -> None:
    for s in signals:
        msg = format_signal(s)
        print(msg + "\n")
        # Telegram-friendly compact version
        send_telegram(f"<b>{_ICON.get(s.kind,'')} {s.symbol} "
                      f"{s.kind.upper()}</b>\n{s.detail}\n"
                      f"Zone {s.zone.price} | Strength {s.zone.strength}/100"
                      + (f"\nEntry {s.entry} Stop {s.stop} Target {s.target} "
                         f"RR {s.rr}" if s.kind == 'retest' else ""))
        # Discord embed
        send_discord(s)
