/**
 * Cync cloud client. Single TLS socket to cm-sec.gelighting.com:23779.
 * Emits 'state' (per-device delta), 'connected', 'disconnected', 'error'.
 *
 * Not Homey-aware — inject logger + token persistence callbacks.
 */

import { EventEmitter } from 'node:events';
import tls from 'node:tls';

import { CyncAuth, CyncAuthError } from './auth';
import {
  MessageType,
  buildLoginPacket,
  buildPingPacket,
  buildPipePacket,
  buildQueryDeviceStatusInner,
  buildSetBrightnessInner,
  buildSetColorTempInner,
  buildSetEffectInner,
  buildSetPowerInner,
  buildSetRgbInner,
  parsePipeStatusPages,
  tryParseOuterFrame,
} from './frames';
import type {
  CyncDevice,
  DeviceState,
  EffectName,
  Logger,
  StoredCredentials,
  StoredTokens,
} from './types';

const TCP_HOST = 'cm-sec.gelighting.com';
const TCP_PORT = 23779;
const PING_INTERVAL_MS = 20_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;

export interface CyncClientOptions {
  credentials: StoredCredentials;
  tokens?: StoredTokens;
  logger?: Logger;
  onTokensUpdated?: (tokens: StoredTokens | null) => void;
}

export class CyncClient extends EventEmitter {
  private readonly auth: CyncAuth;
  private readonly logger: Logger;
  private readonly onTokensUpdated?: (tokens: StoredTokens | null) => void;

  private credentials: StoredCredentials;
  private tokens: StoredTokens | null = null;

  private socket: tls.TLSSocket | null = null;
  private recvBuffer: Buffer = Buffer.alloc(0);
  private loginAck = false;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  constructor(opts: CyncClientOptions) {
    super();
    this.credentials = opts.credentials;
    this.tokens = opts.tokens ?? null;
    this.logger = opts.logger ?? { log: () => {}, error: () => {} };
    this.onTokensUpdated = opts.onTokensUpdated;
    this.auth = new CyncAuth({ logger: this.logger });
  }

  // ── Public API ──

  /** Returns { needsOtp: true } when the server requires an OTP. */
  async login(): Promise<{ needsOtp: boolean }> {
    try {
      this.tokens = await this.auth.login(this.credentials.email, this.credentials.password);
      this.onTokensUpdated?.(this.tokens);
      return { needsOtp: false };
    } catch (err) {
      if (err instanceof CyncAuthError && err.kind === 'needs_otp') {
        return { needsOtp: true };
      }
      throw err;
    }
  }

  async submitOtp(code: string): Promise<void> {
    this.tokens = await this.auth.submitOtp(this.credentials.email, this.credentials.password, code);
    this.onTokensUpdated?.(this.tokens);
  }

  async ensureAuthenticated(): Promise<StoredTokens> {
    if (this.tokens && this.tokens.expiresAt - Date.now() > 60_000) return this.tokens;
    if (this.tokens?.refreshToken) {
      try {
        this.tokens = await this.auth.refreshTokens(this.tokens.refreshToken);
        this.onTokensUpdated?.(this.tokens);
        return this.tokens;
      } catch (err) {
        this.logger.log('Cync token refresh failed, falling back to password login:', err);
      }
    }
    const result = await this.login();
    if (result.needsOtp) {
      throw new CyncAuthError('OTP required; call submitOtp first.', 'needs_otp');
    }
    if (!this.tokens) throw new CyncAuthError('Login succeeded but no tokens returned.');
    return this.tokens;
  }

  async listDevices(): Promise<CyncDevice[]> {
    const tokens = await this.ensureAuthenticated();
    const subscribe = (await this.auth.get(
      `/v2/user/${tokens.userId}/subscribe/devices`,
      tokens.accessToken,
    )) as SubscribeEntry[];

    const homes = subscribe.filter((d) => d.source === 5);
    const bulbs: CyncDevice[] = [];
    for (const home of homes) {
      const property = (await this.auth.get(
        `/v2/product/${home.product_id}/device/${home.id}/property`,
        tokens.accessToken,
      )) as HomeProperty;
      const meshBulbs = (property.bulbsArray ?? []).filter((b) => 'switchID' in b);
      for (const mesh of meshBulbs) {
        const match = subscribe.find((s) => s.id === mesh.switchID);
        if (!match) continue;
        // Per pycync: isolated_mesh_id = deviceID % home_id. The raw deviceID
        // is a 64-bit globally-unique value; the 2-byte mesh ID the bulbs use
        // locally is derived by modulo with the home id.
        const rawDeviceId = Number(mesh.deviceID ?? 0);
        const meshId = home.id > 0 ? rawDeviceId % home.id : rawDeviceId;
        bulbs.push({
          deviceId: match.id,
          // Route commands through the bulb's own switchID — for Wi-Fi bulbs
          // this is the same as deviceId, and for BLE-only bulbs pycync uses
          // the same value (the mesh-gateway logic is server-side).
          homeHubId: match.id,
          meshId,
          name: mesh.displayName || match.name || `Cync ${match.id}`,
          supportsRgb: Boolean(mesh.supports_rgb ?? true),
          supportsColorTemp: Boolean(mesh.supports_cct ?? true),
          supportsDim: Boolean(mesh.supports_brightness ?? true),
        });
      }
    }
    return bulbs;
  }

  async connect(): Promise<void> {
    this.shuttingDown = false;
    await this.ensureAuthenticated();
    this.openSocket();
  }

  disconnect(): void {
    this.shuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {
        // ignored
      }
      this.socket = null;
    }
    this.loginAck = false;
  }

  async setPower(device: CyncDevice, isOn: boolean): Promise<void> {
    await this.sendPipe(device.homeHubId, buildSetPowerInner(device.meshId, isOn));
  }

  async setBrightness(device: CyncDevice, brightnessPct: number): Promise<void> {
    await this.sendPipe(device.homeHubId, buildSetBrightnessInner(device.meshId, brightnessPct));
  }

  async setColorTemp(device: CyncDevice, tempPct: number): Promise<void> {
    await this.sendPipe(device.homeHubId, buildSetColorTempInner(device.meshId, tempPct));
  }

  async setColorRgb(device: CyncDevice, r: number, g: number, b: number): Promise<void> {
    await this.sendPipe(device.homeHubId, buildSetRgbInner(device.meshId, r, g, b));
  }

  async setEffect(device: CyncDevice, effect: EffectName): Promise<void> {
    await this.sendPipe(device.homeHubId, buildSetEffectInner(device.meshId, effect));
  }

  /** No dedicated "stop effect" packet — sending a solid brightness overrides the effect. */
  async stopEffect(device: CyncDevice, brightnessPct = 100): Promise<void> {
    await this.setBrightness(device, brightnessPct);
  }

  async queryAllDevices(device: CyncDevice): Promise<void> {
    await this.sendPipe(device.homeHubId, buildQueryDeviceStatusInner());
  }

  // ── Socket lifecycle ──

  private openSocket(): void {
    if (!this.tokens) return;
    this.logger.log(`Cync TCP: connecting to ${TCP_HOST}:${TCP_PORT}`);

    this.recvBuffer = Buffer.alloc(0);
    this.loginAck = false;

    this.socket = tls.connect({
      host: TCP_HOST,
      port: TCP_PORT,
      rejectUnauthorized: false, // Cync's cert is expired & CN-mismatched (intentional per pycync).
      servername: TCP_HOST,
    });

    this.socket.setKeepAlive(true, 30_000);

    this.socket.once('secureConnect', () => {
      this.logger.log('Cync TCP: TLS established, sending login');
      this.reconnectDelay = RECONNECT_MIN_MS;
      if (this.tokens) {
        this.socket!.write(buildLoginPacket(this.tokens.authorize, this.tokens.userId));
      }
    });

    this.socket.on('data', (chunk) => this.onData(chunk));
    this.socket.on('error', (err) => {
      this.logger.error('Cync TCP error:', err);
      this.emit('error', err);
    });
    this.socket.on('close', () => {
      this.logger.log('Cync TCP: socket closed');
      this.loginAck = false;
      this.stopPing();
      this.emit('disconnected');
      if (!this.shuttingDown) this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.logger.log(`Cync TCP: reconnecting in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureAuthenticated()
        .then(() => this.openSocket())
        .catch((err) => {
          this.logger.error('Cync reconnect auth failed:', err);
          this.scheduleReconnect();
        });
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.socket && !this.socket.destroyed) {
        this.socket.write(buildPingPacket());
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private onData(chunk: Buffer): void {
    this.logger.log(`RX ${chunk.length}B: ${chunk.toString('hex')}`);
    this.recvBuffer = Buffer.concat([this.recvBuffer, chunk]);
    while (true) {
      const frame = tryParseOuterFrame(this.recvBuffer);
      if (!frame) return;
      this.recvBuffer = this.recvBuffer.subarray(frame.consumed);
      try {
        this.dispatchFrame(frame.messageType, frame.isResponse, frame.payload);
      } catch (err) {
        this.logger.error('Cync frame dispatch failed:', err);
      }
    }
  }

  private dispatchFrame(messageType: number, _isResponse: boolean, payload: Buffer): void {
    switch (messageType) {
      case MessageType.LOGIN:
        this.loginAck = true;
        this.startPing();
        this.emit('connected');
        break;
      case MessageType.DISCONNECT:
        this.logger.log('Cync TCP: server sent DISCONNECT');
        this.loginAck = false;
        if (this.socket) this.socket.destroy();
        break;
      case MessageType.PIPE:
      case MessageType.PIPE_SYNC: {
        const devices = parsePipeStatusPages(payload);
        if (!devices) return;
        for (const d of devices) {
          const state: DeviceState = {
            deviceId: 0, // hub id unknown from status-page frame alone
            meshId: d.meshId,
            isOn: d.isOn,
            brightness: d.brightness,
            colorMode: d.colorMode,
            colorTempPct: d.colorMode <= 100 ? d.colorMode : 0,
            rgb: d.rgb,
            isOnline: d.isOnline,
          };
          this.emit('state', state);
        }
        break;
      }
      case MessageType.PING:
        // nothing to do
        break;
      default:
        // unhandled (handshake, probe, sync) — safe to ignore for now
        break;
    }
  }

  private async sendPipe(hubDeviceId: number, inner: Buffer): Promise<void> {
    if (!this.socket || this.socket.destroyed) {
      this.logger.error('sendPipe: socket not open');
      throw new Error('Cync client is not connected');
    }
    const deadline = Date.now() + 3000;
    while (!this.loginAck) {
      if (Date.now() > deadline) throw new Error('Cync login not acknowledged within 3s');
      await new Promise((r) => setTimeout(r, 50));
    }
    const packet = buildPipePacket(hubDeviceId, inner);
    this.logger.log(`TX hub=${hubDeviceId} bytes=${packet.toString('hex')}`);
    this.socket.write(packet);
  }
}

interface SubscribeEntry {
  id: number;
  name?: string;
  product_id?: string;
  source: number;
}

interface HomeProperty {
  bulbsArray?: MeshDevice[];
}

interface MeshDevice {
  switchID: number;
  deviceID?: number;
  displayName?: string;
  supports_rgb?: boolean;
  supports_cct?: boolean;
  supports_brightness?: boolean;
}
