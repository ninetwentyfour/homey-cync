"use strict";
/**
 * Cync cloud client. Single TLS socket to cm-sec.gelighting.com:23779.
 * Emits 'state' (per-device delta), 'connected', 'disconnected', 'error'.
 *
 * Not Homey-aware — inject logger + token persistence callbacks.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CyncClient = void 0;
const node_events_1 = require("node:events");
const node_tls_1 = __importDefault(require("node:tls"));
const auth_1 = require("./auth");
const frames_1 = require("./frames");
const TCP_HOST = 'cm-sec.gelighting.com';
const TCP_PORT = 23779;
const PING_INTERVAL_MS = 20000;
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 60000;
class CyncClient extends node_events_1.EventEmitter {
    constructor(opts) {
        super();
        this.tokens = null;
        this.socket = null;
        this.recvBuffer = Buffer.alloc(0);
        this.loginAck = false;
        this.pingTimer = null;
        this.reconnectDelay = RECONNECT_MIN_MS;
        this.reconnectTimer = null;
        this.shuttingDown = false;
        this.credentials = opts.credentials;
        this.tokens = opts.tokens ?? null;
        this.logger = opts.logger ?? { log: () => { }, error: () => { } };
        this.onTokensUpdated = opts.onTokensUpdated;
        this.auth = new auth_1.CyncAuth({ logger: this.logger });
    }
    // ── Public API ──
    /** Returns { needsOtp: true } when the server requires an OTP. */
    async login() {
        try {
            this.tokens = await this.auth.login(this.credentials.email, this.credentials.password);
            this.onTokensUpdated?.(this.tokens);
            return { needsOtp: false };
        }
        catch (err) {
            if (err instanceof auth_1.CyncAuthError && err.kind === 'needs_otp') {
                return { needsOtp: true };
            }
            throw err;
        }
    }
    async submitOtp(code) {
        this.tokens = await this.auth.submitOtp(this.credentials.email, this.credentials.password, code);
        this.onTokensUpdated?.(this.tokens);
    }
    async ensureAuthenticated() {
        if (this.tokens && this.tokens.expiresAt - Date.now() > 60000)
            return this.tokens;
        if (this.tokens?.refreshToken) {
            try {
                this.tokens = await this.auth.refreshTokens(this.tokens.refreshToken);
                this.onTokensUpdated?.(this.tokens);
                return this.tokens;
            }
            catch (err) {
                this.logger.log('Cync token refresh failed, falling back to password login:', err);
            }
        }
        const result = await this.login();
        if (result.needsOtp) {
            throw new auth_1.CyncAuthError('OTP required; call submitOtp first.', 'needs_otp');
        }
        if (!this.tokens)
            throw new auth_1.CyncAuthError('Login succeeded but no tokens returned.');
        return this.tokens;
    }
    async listDevices() {
        const tokens = await this.ensureAuthenticated();
        const subscribe = (await this.auth.get(`/v2/user/${tokens.userId}/subscribe/devices`, tokens.accessToken));
        const homes = subscribe.filter((d) => d.source === 5);
        const bulbs = [];
        for (const home of homes) {
            const property = (await this.auth.get(`/v2/product/${home.product_id}/device/${home.id}/property`, tokens.accessToken));
            this.logger.log(`home ${home.id}: keys=${Object.keys(property).join(',')} lightShows=${JSON.stringify(property.lightShows ?? null)}`);
            const homeShows = (property.lightShows ?? []).map((s) => ({
                index: s.index,
                name: s.name,
                colors: s.colors ?? [],
                speed: Array.isArray(s.speed) ? (s.speed[0] ?? 50) : 50,
                brightness: Array.isArray(s.brightness) ? (s.brightness[0] ?? 100) : 100,
            }));
            this.logger.log(`home ${home.id}: ${homeShows.length} custom light shows`);
            const meshBulbs = (property.bulbsArray ?? []).filter((b) => 'switchID' in b);
            for (const mesh of meshBulbs) {
                const match = subscribe.find((s) => s.id === mesh.switchID);
                if (!match)
                    continue;
                const rawDeviceId = mesh.deviceID ?? 0;
                const meshId = home.id > 0 ? rawDeviceId % home.id : rawDeviceId;
                bulbs.push({
                    deviceId: match.id,
                    homeHubId: match.id,
                    meshId,
                    name: mesh.displayName || match.name || `Cync ${match.id}`,
                    supportsRgb: mesh.supports_rgb ?? true,
                    supportsColorTemp: mesh.supports_cct ?? true,
                    supportsDim: mesh.supports_brightness ?? true,
                    customShows: homeShows,
                });
            }
        }
        return bulbs;
    }
    async connect() {
        this.shuttingDown = false;
        await this.ensureAuthenticated();
        this.openSocket();
    }
    disconnect() {
        this.shuttingDown = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.stopPing();
        if (this.socket) {
            try {
                this.socket.destroy();
            }
            catch {
                // ignored
            }
            this.socket = null;
        }
        this.loginAck = false;
    }
    async setPower(device, isOn) {
        await this.sendPipe(device.homeHubId, (0, frames_1.buildSetPowerInner)(device.meshId, isOn));
    }
    async setBrightness(device, brightnessPct) {
        await this.sendPipe(device.homeHubId, (0, frames_1.buildSetBrightnessInner)(device.meshId, brightnessPct));
    }
    async setColorTemp(device, tempPct) {
        await this.sendPipe(device.homeHubId, (0, frames_1.buildSetColorTempInner)(device.meshId, tempPct));
    }
    async setColorRgb(device, r, g, b) {
        await this.sendPipe(device.homeHubId, (0, frames_1.buildSetRgbInner)(device.meshId, r, g, b));
    }
    async setEffect(device, effect) {
        await this.sendPipe(device.homeHubId, (0, frames_1.buildSetEffectInner)(device.meshId, effect));
    }
    /** No dedicated "stop effect" packet — sending a solid brightness overrides the effect. */
    async stopEffect(device, brightnessPct = 100) {
        await this.setBrightness(device, brightnessPct);
    }
    async queryAllDevices(device) {
        await this.sendPipe(device.homeHubId, (0, frames_1.buildQueryDeviceStatusInner)());
    }
    // ── Socket lifecycle ──
    openSocket() {
        if (!this.tokens)
            return;
        this.logger.log(`Cync TCP: connecting to ${TCP_HOST}:${TCP_PORT}`);
        this.recvBuffer = Buffer.alloc(0);
        this.loginAck = false;
        this.socket = node_tls_1.default.connect({
            host: TCP_HOST,
            port: TCP_PORT,
            rejectUnauthorized: false, // Cync's cert is expired & CN-mismatched (intentional per pycync).
            servername: TCP_HOST,
        });
        this.socket.setKeepAlive(true, 30000);
        this.socket.once('secureConnect', () => {
            this.logger.log('Cync TCP: TLS established, sending login');
            this.reconnectDelay = RECONNECT_MIN_MS;
            if (this.tokens) {
                this.socket.write((0, frames_1.buildLoginPacket)(this.tokens.authorize, this.tokens.userId));
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
            if (!this.shuttingDown)
                this.scheduleReconnect();
        });
    }
    scheduleReconnect() {
        if (this.reconnectTimer)
            return;
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
    startPing() {
        this.stopPing();
        this.pingTimer = setInterval(() => {
            if (this.socket && !this.socket.destroyed) {
                this.socket.write((0, frames_1.buildPingPacket)());
            }
        }, PING_INTERVAL_MS);
    }
    stopPing() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }
    onData(chunk) {
        this.logger.log(`RX ${chunk.length}B: ${chunk.toString('hex')}`);
        this.recvBuffer = Buffer.concat([this.recvBuffer, chunk]);
        while (true) {
            const frame = (0, frames_1.tryParseOuterFrame)(this.recvBuffer);
            if (!frame)
                return;
            this.recvBuffer = this.recvBuffer.subarray(frame.consumed);
            try {
                this.dispatchFrame(frame.messageType, frame.isResponse, frame.payload);
            }
            catch (err) {
                this.logger.error('Cync frame dispatch failed:', err);
            }
        }
    }
    dispatchFrame(messageType, _isResponse, payload) {
        switch (messageType) {
            case frames_1.MessageType.LOGIN:
                this.loginAck = true;
                this.startPing();
                this.emit('connected');
                break;
            case frames_1.MessageType.DISCONNECT:
                this.logger.log('Cync TCP: server sent DISCONNECT');
                this.loginAck = false;
                if (this.socket)
                    this.socket.destroy();
                break;
            case frames_1.MessageType.PIPE:
            case frames_1.MessageType.PIPE_SYNC: {
                const devices = (0, frames_1.parsePipeStatusPages)(payload);
                if (!devices)
                    return;
                for (const d of devices) {
                    const state = {
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
            case frames_1.MessageType.PING:
                // nothing to do
                break;
            default:
                // unhandled (handshake, probe, sync) — safe to ignore for now
                break;
        }
    }
    async sendPipe(hubDeviceId, inner) {
        if (!this.socket || this.socket.destroyed) {
            this.logger.error('sendPipe: socket not open');
            throw new Error('Cync client is not connected');
        }
        const deadline = Date.now() + 3000;
        while (!this.loginAck) {
            if (Date.now() > deadline)
                throw new Error('Cync login not acknowledged within 3s');
            await new Promise((r) => setTimeout(r, 50));
        }
        const packet = (0, frames_1.buildPipePacket)(hubDeviceId, inner);
        this.logger.log(`TX hub=${hubDeviceId} bytes=${packet.toString('hex')}`);
        this.socket.write(packet);
    }
}
exports.CyncClient = CyncClient;
