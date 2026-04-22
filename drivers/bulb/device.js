"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const homey_1 = __importDefault(require("homey"));
const effects_1 = require("../../lib/cync/effects");
const models_1 = require("../../lib/cync/models");
const FACTORY_EFFECT_TITLES = {
    candle: 'Candlelight',
    rainbow: 'Rainbow',
    cyber: 'Cyber',
    fireworks: 'Fireworks',
    volcanic: 'Volcanic',
    aurora: 'Aurora',
    happy_holidays: 'Happy Holidays',
    red_white_blue: 'Red White Blue',
    vegas: 'Vegas',
    party_time: 'Party Time',
};
const CUSTOM_EFFECT_PREFIX = 'custom_';
const customEffectId = (show) => `${CUSTOM_EFFECT_PREFIX}${show.index}`;
const EFFECT_ANIMATIONS = {
    candle: {
        frames: [
            { hue: 0.08, saturation: 0.85, dim: 0.75 },
            { hue: 0.09, saturation: 0.9, dim: 0.95 },
            { hue: 0.07, saturation: 0.8, dim: 0.85 },
            { hue: 0.1, saturation: 0.85, dim: 0.7 },
        ],
        intervalMs: 1500,
    },
    rainbow: {
        // ~12 second full cycle
        frames: [
            { hue: 0.0, saturation: 1 },
            { hue: 0.08, saturation: 1 },
            { hue: 0.17, saturation: 1 },
            { hue: 0.33, saturation: 1 },
            { hue: 0.5, saturation: 1 },
            { hue: 0.67, saturation: 1 },
            { hue: 0.83, saturation: 1 },
            { hue: 0.92, saturation: 1 },
        ],
        intervalMs: 1500,
    },
    cyber: {
        frames: [
            { hue: 0.5, saturation: 1 },
            { hue: 0.83, saturation: 1 },
            { hue: 0.92, saturation: 1 },
            { hue: 0.75, saturation: 1 },
        ],
        intervalMs: 2000,
    },
    fireworks: {
        frames: [
            { hue: 0.0, saturation: 1, dim: 1 },
            { hue: 0.15, saturation: 1, dim: 1 },
            { hue: 0.55, saturation: 1, dim: 1 },
            { hue: 0.8, saturation: 1, dim: 1 },
            { hue: 0.35, saturation: 1, dim: 1 },
            { hue: 0.95, saturation: 1, dim: 1 },
        ],
        intervalMs: 1200,
    },
    volcanic: {
        frames: [
            { hue: 0.0, saturation: 1 },
            { hue: 0.05, saturation: 1 },
            { hue: 0.1, saturation: 1 },
            { hue: 0.03, saturation: 1 },
        ],
        intervalMs: 2500,
    },
    aurora: {
        frames: [
            { hue: 0.33, saturation: 0.8 },
            { hue: 0.45, saturation: 0.8 },
            { hue: 0.55, saturation: 0.8 },
            { hue: 0.7, saturation: 0.7 },
        ],
        intervalMs: 3000,
    },
    happy_holidays: {
        frames: [
            { hue: 0.0, saturation: 1 },
            { hue: 0.33, saturation: 1 },
        ],
        intervalMs: 2500,
    },
    red_white_blue: {
        frames: [
            { hue: 0.0, saturation: 1 },
            { hue: 0.0, saturation: 0 },
            { hue: 0.67, saturation: 1 },
        ],
        intervalMs: 2500,
    },
    vegas: {
        frames: [
            { hue: 0.0, saturation: 1 },
            { hue: 0.17, saturation: 1 },
            { hue: 0.33, saturation: 1 },
            { hue: 0.5, saturation: 1 },
            { hue: 0.67, saturation: 1 },
            { hue: 0.83, saturation: 1 },
        ],
        intervalMs: 800,
    },
    party_time: {
        frames: [
            { hue: 0.1, saturation: 1 },
            { hue: 0.3, saturation: 1 },
            { hue: 0.55, saturation: 1 },
            { hue: 0.8, saturation: 1 },
        ],
        intervalMs: 700,
    },
};
class BulbDevice extends homey_1.default.Device {
    constructor() {
        super(...arguments);
        this.lastHue = 0;
        this.lastSaturation = 0;
        this.effectTimer = null;
        this.effectFrameIndex = 0;
    }
    async onInit() {
        const data = this.getData();
        this.log(`BulbDevice init deviceId=${data.deviceId}`);
        // Backfill measure_power for devices paired before this capability existed.
        if (!this.hasCapability('measure_power')) {
            try {
                await this.addCapability('measure_power');
            }
            catch (err) {
                this.error('addCapability(measure_power) failed:', err);
            }
        }
        this.registerCapabilityListener('onoff', async (value) => {
            this.stopEffectAnimation();
            await this.client().setPower(this.asCyncDevice(), value);
        });
        this.registerCapabilityListener('dim', async (value) => {
            const device = this.asCyncDevice();
            const pct = Math.round(value * 100);
            const effect = this.getCapabilityValue('cync_effect');
            // Custom shows are driven client-side — the next RGB tick will apply
            // the new brightness via channel scaling; sending a brightness frame
            // now would just flicker once.
            if (effect && effect.startsWith(CUSTOM_EFFECT_PREFIX))
                return;
            // A brightness frame cancels any factory effect on the bulb firmware,
            // so re-send the effect right after so it keeps playing — the firmware
            // uses the new brightness as its base level.
            await this.client().setBrightness(device, pct);
            if (effect && effect !== 'none' && (0, effects_1.isEffectName)(effect)) {
                await this.client().setEffect(device, effect);
                return;
            }
            this.stopEffectAnimation();
        });
        this.registerCapabilityListener('light_temperature', async (value) => {
            this.stopEffectAnimation();
            // Homey provides 0..1 where 0=coolest, 1=warmest; Cync protocol uses 0=warm, 100=cool.
            const pct = Math.round((1 - value) * 100);
            await this.client().setColorTemp(this.asCyncDevice(), pct);
            await this.setCapabilityValue('light_mode', 'temperature').catch(() => undefined);
            await this.setCapabilityValue('cync_effect', 'none').catch(() => undefined);
        });
        this.registerMultipleCapabilityListener(['light_hue', 'light_saturation'], async (values) => {
            this.stopEffectAnimation();
            if (typeof values.light_hue === 'number')
                this.lastHue = values.light_hue;
            if (typeof values.light_saturation === 'number')
                this.lastSaturation = values.light_saturation;
            const dim = this.getCapabilityValue('dim') ?? 1;
            const [r, g, b] = hsvToRgb(this.lastHue, this.lastSaturation, dim);
            await this.client().setColorRgb(this.asCyncDevice(), r, g, b);
            await this.setCapabilityValue('light_mode', 'color').catch(() => undefined);
            await this.setCapabilityValue('cync_effect', 'none').catch(() => undefined);
        }, 500);
        this.registerCapabilityListener('light_mode', async (value) => {
            this.stopEffectAnimation();
            const device = this.asCyncDevice();
            if (value === 'temperature') {
                const temp = this.getCapabilityValue('light_temperature') ?? 0.5;
                const pct = Math.round((1 - temp) * 100);
                await this.client().setColorTemp(device, pct);
            }
            else if (value === 'color') {
                const dim = this.getCapabilityValue('dim') ?? 1;
                const [r, g, b] = hsvToRgb(this.lastHue, this.lastSaturation, dim);
                await this.client().setColorRgb(device, r, g, b);
            }
            await this.setCapabilityValue('cync_effect', 'none').catch(() => undefined);
        });
        this.registerCapabilityListener('cync_effect', async (value) => {
            const device = this.asCyncDevice();
            if (value === 'none') {
                await this.client().stopEffect(device);
                this.stopEffectAnimation();
                return;
            }
            if ((0, effects_1.isEffectName)(value)) {
                await this.client().setEffect(device, value);
                this.startEffectAnimation(value);
                return;
            }
            if (value.startsWith(CUSTOM_EFFECT_PREFIX)) {
                const shows = this.getStoreValue('customShows') ?? [];
                const index = Number(value.slice(CUSTOM_EFFECT_PREFIX.length));
                const show = shows.find((s) => s.index === index);
                if (!show)
                    throw new Error(`Custom effect "${value}" not found — re-pair this bulb.`);
                await this.startCustomShow(show);
                return;
            }
            throw new Error(`Unknown effect: ${value}`);
        });
        this.refreshEffectOptions();
        const app = this.homey.app;
        if (!app.hasCredentials()) {
            await this.setUnavailable('Cync account is not signed in. Re-pair this bulb.');
            return;
        }
        this.stateListener = (state) => {
            if (state.meshId !== this.getStoreValue('meshId'))
                return;
            this.applyStateUpdate(state).catch((err) => this.error('state update failed:', err));
        };
        try {
            const client = app.getClient();
            client.on('state', this.stateListener);
            await this.setAvailable();
            // Fire a status query so the UI reflects the bulb's current state
            // rather than Homey defaults (all sliders at zero / white).
            client
                .queryAllDevices(this.asCyncDevice())
                .catch((err) => this.error('initial state query failed:', err));
        }
        catch (err) {
            this.error('Cync client unavailable at onInit:', err);
            await this.setUnavailable('Cync service is reconnecting…');
        }
        this.syncDeviceInfoSettings().catch((err) => this.error('syncDeviceInfoSettings failed:', err));
        this.reportPower().catch((err) => this.error('reportPower failed:', err));
    }
    async onAdded() {
        await this.syncDeviceInfoSettings();
        await this.reportPower();
    }
    async onSettings({ changedKeys, }) {
        this.log(`onSettings fired: changedKeys=${JSON.stringify(changedKeys)}`);
        if (!changedKeys.includes('refresh_info'))
            return;
        try {
            await this.refreshFromCloud();
        }
        catch (err) {
            this.error('refreshFromCloud failed:', err);
            // Homey forbids setSettings during onSettings; defer the toggle reset.
            setTimeout(() => {
                this.setSettings({ refresh_info: false }).catch(() => undefined);
            }, 100);
            throw err instanceof Error ? err : new Error(String(err));
        }
        // Stores were updated in refreshFromCloud; defer label + energy + toggle
        // writes until after onSettings returns (SDK guards against re-entrant
        // setSettings/setEnergy).
        setTimeout(() => {
            this.syncDeviceInfoSettings({ refresh_info: false }).catch((e) => this.error('post-refresh syncDeviceInfoSettings failed:', e));
            this.reportPower().catch((e) => this.error('post-refresh reportPower failed:', e));
        }, 100);
        return 'Device info refreshed — close and reopen this screen to see the new values.';
    }
    async refreshFromCloud() {
        const app = this.homey.app;
        const client = app.getClient();
        const deviceId = this.getData().deviceId;
        this.log(`refreshFromCloud: querying Cync for deviceId=${deviceId}`);
        const bulbs = await client.listDevices();
        const fresh = bulbs.find((b) => b.deviceId === deviceId);
        if (!fresh) {
            this.error(`refreshFromCloud: deviceId=${deviceId} not in cloud response (got ${bulbs.length} bulbs)`);
            throw new Error('Device not found in your Cync account — was it removed?');
        }
        this.log(`refreshFromCloud: firmware=${String(fresh.firmwareVersion)} deviceType=${String(fresh.deviceType)} mac=${String(fresh.mac)} wifiMac=${String(fresh.wifiMac)}`);
        const spec = (0, models_1.lookupModel)(fresh.deviceType);
        await this.setStoreValue('homeHubId', fresh.homeHubId);
        await this.setStoreValue('meshId', fresh.meshId);
        await this.setStoreValue('supportsRgb', fresh.supportsRgb);
        await this.setStoreValue('supportsColorTemp', fresh.supportsColorTemp);
        await this.setStoreValue('customShows', fresh.customShows);
        await this.setStoreValue('firmwareVersion', fresh.firmwareVersion);
        await this.setStoreValue('deviceType', fresh.deviceType);
        await this.setStoreValue('mac', fresh.mac);
        await this.setStoreValue('wifiMac', fresh.wifiMac);
        await this.setStoreValue('modelName', (0, models_1.formatModelName)(spec) || undefined);
        await this.setStoreValue('modelId', spec?.modelId);
        await this.setStoreValue('specsLine', (0, models_1.formatSpecsLine)(spec) || undefined);
        await this.setStoreValue('wattsActive', (0, models_1.estimateWattsActive)(spec));
        await this.setStoreValue('wattsIdle', (0, models_1.estimateWattsIdle)(spec));
        this.refreshEffectOptions();
        // Note: caller is responsible for syncDeviceInfoSettings + syncEnergy —
        // skipped here because onSettings forbids re-entrant setSettings/setEnergy.
    }
    /**
     * Compute instantaneous wattage from current on/dim state and publish to
     * measure_power. Homey SDK does not let us override energy.approximation
     * per-device, but a measure_power capability overrides approximation in the
     * Energy dashboard — so we just calculate it ourselves.
     *
     * Formula: isOn ? wattsActive * dim : wattsIdle.
     * dim slider already represents 0..1 fractional brightness.
     */
    async reportPower() {
        if (!this.hasCapability('measure_power'))
            return;
        const wattsActive = this.getStoreValue('wattsActive');
        const wattsIdle = this.getStoreValue('wattsIdle');
        const isOn = this.getCapabilityValue('onoff') ?? false;
        const dim = this.getCapabilityValue('dim') ?? 1;
        const active = wattsActive ?? 9;
        const idle = wattsIdle ?? 0.5;
        const watts = isOn ? Math.max(0, active * dim) : idle;
        const rounded = Math.round(watts * 10) / 10;
        try {
            await this.setCapabilityValue('measure_power', rounded);
        }
        catch (err) {
            this.error('setCapabilityValue(measure_power) failed:', err);
        }
    }
    async syncDeviceInfoSettings(extra) {
        const get = (key) => this.getStoreValue(key);
        const deviceType = get('deviceType');
        const wattsActive = get('wattsActive');
        const wattsIdle = get('wattsIdle');
        const firmware = get('firmwareVersion');
        const mac = get('mac');
        const formattedMac = mac && mac.length === 12 ? mac.match(/.{2}/g)?.join(':') : mac;
        const modelNameRaw = get('modelName');
        const modelDisplay = modelNameRaw != null && modelNameRaw !== ''
            ? String(modelNameRaw)
            : deviceType != null
                ? `Unknown (device type ${deviceType})`
                : '—';
        try {
            await this.setSettings({
                model_name: modelDisplay,
                model_sku: displayString(get('modelId')),
                firmware_version: displayString(firmware),
                device_type: deviceType == null ? '—' : String(deviceType),
                mac: displayString(formattedMac),
                wifi_mac: displayString(get('wifiMac')),
                power_active: wattsActive == null ? '—' : (0, models_1.formatWatts)(wattsActive),
                power_idle: wattsIdle == null ? '—' : (0, models_1.formatWatts)(wattsIdle),
                specs: displayString(get('specsLine')),
                last_refreshed: firmware ? new Date().toISOString() : '—',
                ...extra,
            });
        }
        catch (err) {
            this.error('setSettings(device info) failed:', err);
        }
    }
    startEffectAnimation(effect) {
        this.stopEffectAnimation();
        const anim = EFFECT_ANIMATIONS[effect];
        this.effectFrameIndex = 0;
        this.setCapabilityValue('light_mode', 'color').catch(() => undefined);
        const tick = () => {
            const frame = anim.frames[this.effectFrameIndex % anim.frames.length];
            this.effectFrameIndex++;
            this.setCapabilityValue('light_hue', frame.hue).catch(() => undefined);
            this.setCapabilityValue('light_saturation', frame.saturation).catch(() => undefined);
            if (frame.dim !== undefined) {
                this.setCapabilityValue('dim', frame.dim).catch(() => undefined);
            }
        };
        tick();
        this.effectTimer = setInterval(tick, anim.intervalMs);
    }
    /** Drive a user-defined light show locally by cycling RGB commands. */
    async startCustomShow(show) {
        this.log(`startCustomShow: ${show.name} (${show.colors.length} colors, speed=${show.speed}ms)`);
        this.stopEffectAnimation();
        if (show.colors.length === 0)
            throw new Error(`Custom effect "${show.name}" has no colors.`);
        const rgbFrames = show.colors.map(hexToRgb);
        // speed is a dwell time in milliseconds per color from the Cync REST API.
        const intervalMs = Math.max(300, Math.min(show.speed, 10000));
        await this.setCapabilityValue('light_mode', 'color').catch(() => undefined);
        this.effectFrameIndex = 0;
        const device = this.asCyncDevice();
        const tick = async () => {
            const [r, g, b] = rgbFrames[this.effectFrameIndex % rgbFrames.length];
            this.effectFrameIndex++;
            // Scale by the current dim capability so the slider dims custom shows.
            const dim = Math.max(0, Math.min(1, this.getCapabilityValue('dim') ?? 1));
            const sr = Math.round(r * dim);
            const sg = Math.round(g * dim);
            const sb = Math.round(b * dim);
            try {
                await this.client().setColorRgb(device, sr, sg, sb);
            }
            catch (err) {
                this.error('custom effect RGB send failed:', err);
            }
            const [h, s] = rgbToHsv(r, g, b);
            this.lastHue = h;
            this.lastSaturation = s;
            this.setCapabilityValue('light_hue', h).catch(() => undefined);
            this.setCapabilityValue('light_saturation', s).catch(() => undefined);
        };
        await tick();
        this.effectTimer = setInterval(() => {
            tick().catch((err) => this.error('custom effect tick failed:', err));
        }, intervalMs);
    }
    refreshEffectOptions() {
        const shows = this.getStoreValue('customShows') ?? [];
        const values = [
            { id: 'none', title: { en: 'None' } },
            ...effects_1.EFFECT_NAMES.map((name) => ({ id: name, title: { en: FACTORY_EFFECT_TITLES[name] } })),
            ...shows.map((show) => ({ id: customEffectId(show), title: { en: show.name } })),
        ];
        this.setCapabilityOptions('cync_effect', { values }).catch((err) => this.error('setCapabilityOptions(cync_effect) failed:', err));
    }
    stopEffectAnimation() {
        if (this.effectTimer) {
            clearInterval(this.effectTimer);
            this.effectTimer = null;
        }
    }
    async onDeleted() {
        this.stopEffectAnimation();
        if (this.stateListener) {
            try {
                const app = this.homey.app;
                app.getClient().off('state', this.stateListener);
            }
            catch {
                // client may already be gone
            }
        }
    }
    client() {
        return this.homey.app.getClient();
    }
    asCyncDevice() {
        const data = this.getData();
        return {
            deviceId: data.deviceId,
            homeHubId: this.getStoreValue('homeHubId'),
            meshId: this.getStoreValue('meshId'),
            name: this.getName(),
            supportsRgb: Boolean(this.getStoreValue('supportsRgb') ?? true),
            supportsColorTemp: Boolean(this.getStoreValue('supportsColorTemp') ?? true),
            customShows: this.getStoreValue('customShows') ?? [],
            supportsDim: true,
        };
    }
    async applyStateUpdate(state) {
        await this.setCapabilityIfChanged('onoff', state.isOn);
        await this.setCapabilityIfChanged('dim', state.brightness / 100);
        if (state.colorMode === 0xfe) {
            // RGB mode
            const [h, s] = rgbToHsv(state.rgb[0], state.rgb[1], state.rgb[2]);
            this.lastHue = h;
            this.lastSaturation = s;
            await this.setCapabilityIfChanged('light_hue', h);
            await this.setCapabilityIfChanged('light_saturation', s);
            await this.setCapabilityIfChanged('light_mode', 'color');
        }
        else if (state.colorMode <= 100) {
            // Color temperature mode; Cync 0=warm, 100=cool → Homey 1=warmest, 0=coolest.
            await this.setCapabilityIfChanged('light_temperature', 1 - state.colorMode / 100);
            await this.setCapabilityIfChanged('light_mode', 'temperature');
        }
        await this.reportPower();
    }
    async setCapabilityIfChanged(capability, value) {
        if (!this.hasCapability(capability))
            return;
        if (this.getCapabilityValue(capability) === value)
            return;
        try {
            await this.setCapabilityValue(capability, value);
        }
        catch (err) {
            this.error(`Failed to set ${capability}:`, err);
        }
    }
}
exports.default = BulbDevice;
module.exports = BulbDevice;
function displayString(v) {
    if (v === null || v === undefined || v === '')
        return '—';
    return String(v);
}
function hexToRgb(hex) {
    const clean = hex.replace(/^#/, '').trim();
    const v = parseInt(clean, 16);
    if (clean.length === 6)
        return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
    return [0, 0, 0];
}
function rgbToHsv(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;
    const v = max;
    const s = max === 0 ? 0 : d / max;
    let h = 0;
    if (d !== 0) {
        switch (max) {
            case rn:
                h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
                break;
            case gn:
                h = ((bn - rn) / d + 2) / 6;
                break;
            case bn:
                h = ((rn - gn) / d + 4) / 6;
                break;
        }
    }
    return [h, s, v];
}
function hsvToRgb(h, s, v) {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    let r = 0;
    let g = 0;
    let b = 0;
    switch (i % 6) {
        case 0:
            r = v;
            g = t;
            b = p;
            break;
        case 1:
            r = q;
            g = v;
            b = p;
            break;
        case 2:
            r = p;
            g = v;
            b = t;
            break;
        case 3:
            r = p;
            g = q;
            b = v;
            break;
        case 4:
            r = t;
            g = p;
            b = v;
            break;
        case 5:
            r = v;
            g = p;
            b = q;
            break;
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
