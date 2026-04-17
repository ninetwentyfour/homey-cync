# GE Cync for Homey Pro

Unofficial Homey Pro app for controlling GE Cync Wi-Fi "Direct Connect" full-color bulbs. Reverse-engineered; not affiliated with GE or Savant.

## Features

- On/off, dim, color (hue/saturation), color temperature
- Built-in Dynamic Effects: Candle, Rainbow, Cyber, Fireworks, Volcanic, Aurora, Happy Holidays, Red White Blue, Vegas, Party Time
- Flow cards: **Set effect** and **Stop effect**
- Card / dim-slider tint reflects live bulb state
- Client-side animation of effects on the Homey device card (visual only; the bulb runs the real effect)

## Requirements

- Homey Pro (2023 or later)
- A GE Cync account with at least one **Direct Connect** full-color bulb already paired in the Cync phone app
- [Bun](https://bun.sh) + [Homey CLI](https://apps.developer.homey.app/the-basics/getting-started/homey-cli)

## Install & run

```sh
bun install
bunx --bun homey login
bun run build
bunx --bun homey app run      # run in a Docker sandbox on your Homey Pro (dev, hot-reload)
bunx homey app install        # install permanently (must use plain bunx or npx, see below)
```

> ⚠️ **`homey app install` must not run under `bunx --bun`.** The Bun runtime's multipart/FormData handling is incompatible with the Homey Pro devkit upload and you'll get a misleading `✖ Missing File` error. Use plain `bunx homey app install` or `npx homey app install` — both run the CLI under Node.js, which works.

## Pairing

1. In the Homey mobile app: **Add device → GE Cync → Cync Bulb**.
2. Enter your Cync account email + password.
3. Cync emails a 6-digit code. Enter it on the next screen.
4. Select the bulbs you want to add.

> The Cync cloud only allows **one authenticated socket per account**. When Homey connects, the Cync phone app is kicked off; closing / backgrounding the Cync app lets Homey stay online. This is a server-side limit — there is no workaround.

## Architecture

```
lib/cync/
  CyncClient.ts   singleton persistent TLS socket + command API, EventEmitter
  auth.ts         REST login + email-OTP 2FA (axios; Homey's Node has no global fetch)
  frames.ts       binary frame encode/decode (outer + 0x7e-delimited inner)
  effects.ts      factory effect byte table
  types.ts        shared types

app.ts            Homey app; owns the singleton client, persists credentials + tokens
api.ts            /signout endpoint for the settings page
settings/         logged-in email + sign-out UI
drivers/bulb/     driver + device class + pair views
```

The client is deliberately Homey-agnostic — Homey-specific code lives in `app.ts` / `drivers/bulb/`.

## Protocol notes

- **Endpoint:** `cm-sec.gelighting.com:23779` over TLS. The server certificate is long-expired, so the client uses `rejectUnauthorized: false`.
- **REST auth:** `https://api.gelighting.com/v2/user_auth` (HTTP 400 → account needs 2FA). OTP trigger: `/v2/two_factor/email/verifycode`. OTP submit: `/v2/user_auth/two_factor` with a random 16-char lowercase `resource` string.
- `corp_id = 1007d2ad150c4000`.
- **Framing:** outer `info(1) + len(4 BE) + payload`; inner is `0x7e`-delimited with `0x7d5e` as escape and a 1-byte checksum.
- **Message types:** LOGIN=1, PIPE=7, PIPE_SYNC=8, PROBE=10, PING=13, DISCONNECT=14.
- **Pipe commands:** `SET_POWER=0xd0`, `SET_BRIGHTNESS=0xd2`, `SET_COLOR=0xe2`, `COMBO_CONTROL=0xf0`, `QUERY_DEVICE_STATUS_PAGES=0x52`.
- **Effect sub-command:** `e2 11 02 07 01 <b1> <b2>` — the two bytes come from `lib/cync/effects.ts`.
- **Addressing:** the bulb's isolated mesh ID is `rawDeviceId % home.id`. The hub the command must route through is the bulb's own `match.id` (its switchID), not the home.id.
- **Colour mode byte:** `0xfe` = RGB, `0..100` = color-temp percent. Used to drive Homey's `light_mode` capability.
- Keepalive: client sends a `0xd3` ping every 20 s; auto-reconnects with exponential backoff.

## Scripts

| Script | What it does |
|--|--|
| `bun run build` | Compile TS with `tsgo` |
| `bun run build:watch` | Watch-mode build |
| `bun run homey` | `homey app run` (install on your Homey Pro) |
| `bun run lint` | `oxlint --fix` |
| `bun run fmt` / `fmt:check` | `oxfmt` write / check |

## Known limitations

- Single-socket-per-account (see above).
- Effect state cannot be queried back from the bulb; we only reflect what Homey last commanded.
- **Custom lightshows** created in the Cync app are discovered during pairing and stored on the device, but the native trigger byte format is unknown (requires MITM of a separate AWS-IoT endpoint). The `run_custom_effect` flow card is intentionally hidden; to re-enable the experimental RGB-simulation version, restore `.homeycompose/flow/actions/run_custom_effect.json` and uncomment the block in `drivers/bulb/driver.ts`.
- No push updates for effect start/stop initiated from the Cync phone app while Homey is connected (phone is kicked off).

## Pair view gotcha

Homey wraps pair HTML in a parent frame. The HTML files under `drivers/bulb/pair/` **must be fragments** — no `<!doctype>`, `<html>`, `<head>`, or `<body>` wrappers — otherwise `onHomeyReady` never fires and `Homey.emit(...)` silently no-ops.

## Credits

- [Kinachi249/pycync](https://github.com/Kinachi249/pycync) — cleanest reference for auth, 2FA, and binary protocol
- [baudneo/cync-lan](https://github.com/baudneo/cync-lan) — effect byte table + TLS MITM tool
- [iburistu/cync-lan](https://github.com/iburistu/cync-lan) — TS reference for frame format
