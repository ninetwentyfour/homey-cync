"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const homey_1 = __importDefault(require("homey"));
const auth_1 = require("../../lib/cync/auth");
const effects_1 = require("../../lib/cync/effects");
class BulbDriver extends homey_1.default.Driver {
    async onInit() {
        this.log('BulbDriver init');
        this.homey.flow
            .getActionCard('set_effect')
            .registerRunListener(async (args) => {
            if (!(0, effects_1.isEffectName)(args.effect)) {
                throw new Error(`Unknown effect: ${args.effect}`);
            }
            await args.device.triggerCapabilityListener('cync_effect', args.effect);
        });
        this.homey.flow
            .getActionCard('stop_effect')
            .registerRunListener(async (args) => {
            await args.device.triggerCapabilityListener('cync_effect', 'none');
        });
        // --- HIDDEN: run_custom_effect ---
        // Disabled until we solve the "custom-effect won't stop" spam.
        // To re-enable, restore .homeycompose/flow/actions/run_custom_effect.json
        // (title: Run custom effect, args: device + autocomplete effect) and
        // uncomment the block below.
        //
        // const customEffect = this.homey.flow.getActionCard('run_custom_effect');
        // customEffect.registerArgumentAutocompleteListener(
        //   'effect',
        //   async (query: string, args: { device: BulbDevice }) => {
        //     const shows = (args.device.getStoreValue('customShows') as CustomLightShow[]) ?? [];
        //     const q = query.trim().toLowerCase();
        //     const filtered = q ? shows.filter((s) => s.name.toLowerCase().includes(q)) : shows;
        //     return filtered.map((s) => ({
        //       name: s.name,
        //       description: `${s.colors.length} color${s.colors.length === 1 ? '' : 's'}`,
        //       index: s.index,
        //     }));
        //   },
        // );
        // customEffect.registerRunListener(
        //   async (args: { device: BulbDevice; effect: { index: number; name: string } }) => {
        //     const shows = (args.device.getStoreValue('customShows') as CustomLightShow[]) ?? [];
        //     const show = shows.find((s) => s.index === args.effect.index);
        //     if (!show) throw new Error(`Custom effect "${args.effect.name}" not found — re-pair this bulb to refresh.`);
        //     await args.device.startCustomShow(show);
        //   },
        // );
    }
    async onPair(session) {
        this.log('onPair: session started');
        const app = this.homey.app;
        session.setHandler('showView', async (view) => {
            this.log(`onPair: showView -> ${view}`);
            if (view === 'login' && app.hasCredentials()) {
                this.log('onPair: credentials exist, skipping to list_devices');
                await session.showView('list_devices');
            }
        });
        // Register login handler BEFORE any other handlers
        session.setHandler('login', async (data) => {
            console.log('=== LOGIN HANDLER FIRED ===', JSON.stringify(data));
            try {
                const creds = data;
                const result = await app.setCredentials(creds.username, creds.password);
                console.log('=== LOGIN RESULT ===', JSON.stringify(result));
                if (result.needsOtp) {
                    return true;
                }
                await session.showView('list_devices');
                return true;
            }
            catch (err) {
                console.log('=== LOGIN ERROR ===', String(err));
                throw this.friendlyError(err);
            }
        });
        session.setHandler('otp', async (code) => {
            console.log('=== OTP HANDLER FIRED ===', code);
            try {
                await app.submitOtp(String(code));
                console.log('=== OTP SUCCESS ===');
                return true;
            }
            catch (err) {
                console.log('=== OTP ERROR ===', String(err));
                throw this.friendlyError(err);
            }
        });
        session.setHandler('list_devices', async () => {
            const bulbs = await app.listBulbs();
            if (bulbs.length === 0) {
                throw new Error('No bulbs were found on this Cync account.');
            }
            return bulbs.map((b) => this.toPairDevice(b));
        });
    }
    toPairDevice(bulb) {
        return {
            name: bulb.name,
            data: { deviceId: bulb.deviceId },
            store: {
                homeHubId: bulb.homeHubId,
                meshId: bulb.meshId,
                supportsRgb: bulb.supportsRgb,
                supportsColorTemp: bulb.supportsColorTemp,
                customShows: bulb.customShows,
            },
        };
    }
    friendlyError(err) {
        if (err instanceof auth_1.CyncAuthError) {
            switch (err.kind) {
                case 'needs_otp':
                    return new Error('Cync sent a verification code — enter it on the next screen.');
                case 'invalid_otp':
                    return new Error('The verification code is incorrect or expired.');
                case 'invalid_credentials':
                    return new Error('Cync login failed. Check your email and password.');
                default:
                    return new Error(err.message);
            }
        }
        return err instanceof Error ? err : new Error(String(err));
    }
}
exports.default = BulbDriver;
module.exports = BulbDriver;
