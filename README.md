# GE Cync for Homey Pro

Homey Pro app for controlling GE Cync Wi-Fi "Direct Connect" bulbs.

## Features

- On/off, dim, color (hue/sat), color temperature
- Dynamic effects (Candlelight, Rainbow, Disco, Sunrise, …)
- Flow cards for effects

## Setup

```
bun install
bunx --bun homey login
bun run build
bunx --bun homey app run
```

Pair a bulb via the Homey mobile app → "Add device" → GE Cync → Cync Bulb. Enter your Cync email + password. Cync will send a 6-digit code to your email; enter it on the next screen. Select bulbs to add.

## Architecture

- `lib/cync/` — Homey-agnostic cloud client.
  - `CyncClient.ts` — single persistent TLS socket + command API.
  - `frames.ts` — binary frame encode/decode.
  - `auth.ts` — REST login + email-OTP 2FA.
  - `effects.ts` — factory effect byte table.
- `app.ts` — singleton `CyncClient`; handles credential persistence.
- `drivers/bulb/` — driver + device class.

## Protocol notes

- Endpoint: `cm-sec.gelighting.com:23779` (TLS; server cert is expired, `rejectUnauthorized: false`).
- Single authenticated socket per account — opening the Cync phone app will disconnect Homey and vice versa.
- Effect IDs lifted from [baudneo/cync-lan](https://github.com/baudneo/cync-lan).
- Auth + framing based on [Kinachi249/pycync](https://github.com/Kinachi249/pycync).

## Credits

Reverse engineering by the pycync and cync-lan communities. This is not an official GE/Savant product.
