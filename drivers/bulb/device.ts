import Homey from 'homey';

import type CyncApp from '../../app';
import { CyncClient } from '../../lib/cync/CyncClient';
import { isEffectName } from '../../lib/cync/effects';
import type { CyncDevice, DeviceState } from '../../lib/cync/types';

export default class BulbDevice extends Homey.Device {
  private stateListener?: (state: DeviceState) => void;
  private lastHue = 0;
  private lastSaturation = 0;

  override async onInit(): Promise<void> {
    const data = this.getData() as { deviceId: number };
    this.log(`BulbDevice init deviceId=${data.deviceId}`);

    this.registerCapabilityListener('onoff', async (value: boolean) => {
      await this.client().setPower(this.asCyncDevice(), value);
    });

    this.registerCapabilityListener('dim', async (value: number) => {
      await this.client().setBrightness(this.asCyncDevice(), Math.round(value * 100));
    });

    this.registerCapabilityListener('light_temperature', async (value: number) => {
      // Homey provides 0..1 where 0=coolest, 1=warmest; Cync protocol uses 0=warm, 100=cool.
      const pct = Math.round((1 - value) * 100);
      await this.client().setColorTemp(this.asCyncDevice(), pct);
      await this.setCapabilityValue('light_mode', 'temperature').catch(() => undefined);
    });

    this.registerMultipleCapabilityListener(
      ['light_hue', 'light_saturation'],
      async (values: { light_hue?: number; light_saturation?: number }) => {
        if (typeof values.light_hue === 'number') this.lastHue = values.light_hue;
        if (typeof values.light_saturation === 'number') this.lastSaturation = values.light_saturation;
        const dim = (this.getCapabilityValue('dim') as number | null) ?? 1;
        const [r, g, b] = hsvToRgb(this.lastHue, this.lastSaturation, dim);
        await this.client().setColorRgb(this.asCyncDevice(), r, g, b);
        await this.setCapabilityValue('light_mode', 'color').catch(() => undefined);
      },
      500,
    );

    this.registerCapabilityListener('cync_effect', async (value: string) => {
      const device = this.asCyncDevice();
      if (value === 'none') {
        await this.client().stopEffect(device);
        return;
      }
      if (!isEffectName(value)) throw new Error(`Unknown effect: ${value}`);
      await this.client().setEffect(device, value);
    });

    const app = this.homey.app as CyncApp;
    if (!app.hasCredentials()) {
      await this.setUnavailable('Cync account is not signed in. Re-pair this bulb.');
      return;
    }

    this.stateListener = (state: DeviceState) => {
      if (state.meshId !== this.getStoreValue('meshId')) return;
      this.applyStateUpdate(state).catch((err) => this.error('state update failed:', err));
    };

    try {
      const client = app.getClient();
      client.on('state', this.stateListener);
      await this.setAvailable();
      // Fire a status query so the UI reflects the bulb's current state
      // rather than Homey defaults (all sliders at zero / white).
      client.queryAllDevices(this.asCyncDevice()).catch((err) =>
        this.error('initial state query failed:', err),
      );
    } catch (err) {
      this.error('Cync client unavailable at onInit:', err);
      await this.setUnavailable('Cync service is reconnecting…');
    }
  }

  override async onDeleted(): Promise<void> {
    if (this.stateListener) {
      try {
        const app = this.homey.app as CyncApp;
        app.getClient().off('state', this.stateListener);
      } catch {
        // client may already be gone
      }
    }
  }

  private client(): CyncClient {
    return (this.homey.app as CyncApp).getClient();
  }

  private asCyncDevice(): CyncDevice {
    const data = this.getData() as { deviceId: number };
    return {
      deviceId: data.deviceId,
      homeHubId: this.getStoreValue('homeHubId') as number,
      meshId: this.getStoreValue('meshId') as number,
      name: this.getName(),
      supportsRgb: Boolean(this.getStoreValue('supportsRgb') ?? true),
      supportsColorTemp: Boolean(this.getStoreValue('supportsColorTemp') ?? true),
      supportsDim: true,
    };
  }

  private async applyStateUpdate(state: DeviceState): Promise<void> {
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
    } else if (state.colorMode <= 100) {
      // Color temperature mode; Cync 0=warm, 100=cool → Homey 1=warmest, 0=coolest.
      await this.setCapabilityIfChanged('light_temperature', 1 - state.colorMode / 100);
      await this.setCapabilityIfChanged('light_mode', 'temperature');
    }
  }

  private async setCapabilityIfChanged(capability: string, value: unknown): Promise<void> {
    if (!this.hasCapability(capability)) return;
    if (this.getCapabilityValue(capability) === value) return;
    try {
      await this.setCapabilityValue(capability, value);
    } catch (err) {
      this.error(`Failed to set ${capability}:`, err);
    }
  }
}

module.exports = BulbDevice;

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
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
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break;
      case gn: h = ((bn - rn) / d + 2) / 6; break;
      case bn: h = ((rn - gn) / d + 4) / 6; break;
    }
  }
  return [h, s, v];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
