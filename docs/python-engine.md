# Python Engine (local CLI alerter)

Lives in the repo root. Headless realtime S/R alerter. Runs on your machine.

## Files

| File | Role |
|---|---|
| `config.py` | All parameters + `.env` auto-loader (`_load_dotenv`) |
| `data.py` | Binance realtime klines + price + ATR (mirror failover) |
| `volume_profile.py` | POC / Value Area / HVN / LVN |
| `zones.py` | pivot clustering + strength scoring (`Zone` dataclass) |
| `signals.py` | break rating + break-and-retest play (`Signal` dataclass) |
| `alerts.py` | dispatch: console (always) + Telegram + Discord |
| `engine.py` | realtime loop / `--scan` one-shot |
| `run_alerts.sh` | unattended launcher (keeps Mac awake, detaches) |
| `.env.example` | template for local secrets |
| `requirements.txt` | requests, pandas, numpy |

## Running

```bash
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt

./.venv/bin/python engine.py --scan   # one-shot zone map, then exit
./.venv/bin/python engine.py          # realtime loop, alerts every POLL_SECONDS
```

### Unattended (leave the laptop running)

```bash
cp .env.example .env    # fill in DISCORD_WEBHOOK_URL etc.
./run_alerts.sh         # start detached, keeps Mac awake (caffeinate)
./run_alerts.sh status  # check + tail log
./run_alerts.sh log     # follow live
./run_alerts.sh stop    # stop
```

`run_alerts.sh` uses `caffeinate -i` (blocks idle sleep) + `nohup` (survives
closing the terminal), logging to `alerts.log`.

> ⚠️ `caffeinate` prevents *idle* sleep only — closing a MacBook lid still
> sleeps it. For true 24/7 use the cloud web app (see [deployment.md](deployment.md)).

## Loop internals (`engine.py`)

- `_BROKEN` — per-symbol flipped-zone memory across polls (for retest detection).
- `_SEEN` — in-memory de-dupe, 900s TTL, so identical alerts don't refire.
- `analyze()` — fetch → profile → zones → returns `(price, atr, profile, zones, trig)`.
- `run_loop()` — every `POLL_SECONDS`: analyze each symbol, evaluate, dedupe, dispatch.

## Alerts dispatch (`alerts.py`)

`dispatch(signals)` for each signal:
1. Prints a formatted block to console (always).
2. `send_telegram()` — HTML message if `TELEGRAM_TOKEN` + `TELEGRAM_CHAT_ID` set.
3. `send_discord()` — color-coded embed if `DISCORD_WEBHOOK_URL` set
   (blue watch / red break / green retest). Never raises — alerting must not
   crash the engine.

## Config knobs

All in `config.py`. See [configuration.md](configuration.md) for the full table
(symbols, timeframes, weights, break/retest thresholds, poll cadence, secrets).

> The Python engine has **no round-number level alerts** — that feature lives
> only in the web app. Add it here if you want parity.
