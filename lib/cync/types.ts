export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  authorize: string;
  userId: number;
  expiresAt: number;
}

export interface StoredCredentials {
  email: string;
  password: string;
}

export interface CyncDevice {
  /** Stable numeric id used on the wire and returned by the REST API. */
  deviceId: number;
  /** Wi-Fi bridge deviceId that commands for this bulb should be routed through. */
  homeHubId: number;
  /** Local mesh id within the home (0..n). */
  meshId: number;
  name: string;
  supportsRgb: boolean;
  supportsColorTemp: boolean;
  supportsDim: boolean;
  /** User-created light shows from the Cync app; shared across the home. */
  customShows: CustomLightShow[];
  /** Firmware version from the REST property endpoint (e.g. "1.0.315"). */
  firmwareVersion?: string;
  /** 1-byte Cync device type id — see lib/cync/models.ts for lookup. */
  deviceType?: number;
  /** Bulb radio MAC (12 hex chars, unformatted). */
  mac?: string;
  /** Wi-Fi MAC, only present on Wi-Fi-capable bulbs (colon-separated). */
  wifiMac?: string;
}

export interface CustomLightShow {
  /** Show index (1-byte) — how Cync identifies it internally. */
  index: number;
  name: string;
  /** Hex color strings e.g. "FF2C2F". */
  colors: string[];
  /** Raw speed value from Cync (0..100-ish); larger = faster. */
  speed: number;
  /** 0..100 brightness. */
  brightness: number;
}

export interface DeviceState {
  deviceId: number;
  meshId: number;
  isOn: boolean;
  brightness: number; // 0..100
  /** Raw color-mode byte: 0..100 = color-temp %, 0xfe = RGB, 0xff = unknown. */
  colorMode: number;
  colorTempPct: number; // 0..100 (0=warm, 100=cool); valid when colorMode <= 100
  rgb: [number, number, number];
  isOnline: boolean;
}

export type EffectName =
  | 'candle'
  | 'rainbow'
  | 'cyber'
  | 'fireworks'
  | 'volcanic'
  | 'aurora'
  | 'happy_holidays'
  | 'red_white_blue'
  | 'vegas'
  | 'party_time';

export interface Logger {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}
