"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const homey_1 = __importDefault(require("homey"));
const CyncClient_1 = require("./lib/cync/CyncClient");
const SETTINGS_KEY_EMAIL = 'cync.email';
const SETTINGS_KEY_PASSWORD = 'cync.password';
const SETTINGS_KEY_TOKENS = 'cync.tokens';
class CyncApp extends homey_1.default.App {
    constructor() {
        super(...arguments);
        this.client = null;
        this.pendingCredentials = null;
    }
    async onInit() {
        this.log('GE Cync app starting');
        const email = this.homey.settings.get(SETTINGS_KEY_EMAIL);
        const password = this.homey.settings.get(SETTINGS_KEY_PASSWORD);
        const tokens = this.homey.settings.get(SETTINGS_KEY_TOKENS);
        if (email && password) {
            this.log(`Cync credentials present for ${email} — connecting`);
            try {
                this.client = this.buildClient({ email, password }, tokens);
                await this.client.connect();
            }
            catch (err) {
                this.error('Cync boot connect failed:', err);
            }
        }
        else {
            this.log('Cync credentials not configured — pair a device to sign in');
        }
    }
    /**
     * Stage 1 of pairing: submit creds. Returns { needsOtp }. If true, the
     * caller must follow with submitOtp(); we keep creds in memory in the
     * meantime so the OTP step can complete the login.
     */
    async setCredentials(email, password) {
        this.log(`Cync: setting credentials for ${email}`);
        if (this.client) {
            this.client.disconnect();
            this.client = null;
        }
        this.pendingCredentials = { email, password };
        const client = this.buildClient({ email, password });
        const result = await client.login();
        if (!result.needsOtp) {
            this.persistCredentials(email, password);
            this.client = client;
            client.connect().catch((err) => this.error('Cync connect failed post-login:', err));
            this.pendingCredentials = null;
        }
        return result;
    }
    async submitOtp(code) {
        if (!this.pendingCredentials) {
            throw new Error('No pending credentials — restart pairing.');
        }
        const creds = this.pendingCredentials;
        const client = this.buildClient(creds);
        // Submit OTP directly — do NOT re-call login() which would trigger
        // another OTP email and invalidate the code the user just entered.
        await client.submitOtp(code);
        this.persistCredentials(creds.email, creds.password);
        this.client = client;
        this.pendingCredentials = null;
        client.connect().catch((err) => this.error('Cync connect failed post-OTP:', err));
    }
    getClient() {
        if (!this.client) {
            throw new Error('Cync client not connected. Pair a bulb to sign in.');
        }
        return this.client;
    }
    hasCredentials() {
        return Boolean(this.homey.settings.get(SETTINGS_KEY_EMAIL) &&
            this.homey.settings.get(SETTINGS_KEY_PASSWORD));
    }
    getCurrentEmail() {
        return this.homey.settings.get(SETTINGS_KEY_EMAIL) ?? null;
    }
    async signOut() {
        this.log('Cync: signing out');
        if (this.client) {
            this.client.disconnect();
            this.client = null;
        }
        this.pendingCredentials = null;
        this.homey.settings.unset(SETTINGS_KEY_EMAIL);
        this.homey.settings.unset(SETTINGS_KEY_PASSWORD);
        this.homey.settings.unset(SETTINGS_KEY_TOKENS);
    }
    async listBulbs() {
        return this.getClient().listDevices();
    }
    persistCredentials(email, password) {
        this.homey.settings.set(SETTINGS_KEY_EMAIL, email);
        this.homey.settings.set(SETTINGS_KEY_PASSWORD, password);
    }
    buildClient(credentials, tokens) {
        return new CyncClient_1.CyncClient({
            credentials,
            tokens,
            logger: { log: (...a) => this.log(...a), error: (...a) => this.error(...a) },
            onTokensUpdated: (next) => {
                if (next)
                    this.homey.settings.set(SETTINGS_KEY_TOKENS, next);
                else
                    this.homey.settings.unset(SETTINGS_KEY_TOKENS);
            },
        });
    }
}
exports.default = CyncApp;
module.exports = CyncApp;
