"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
module.exports = {
    async signOut({ homey }) {
        await homey.app.signOut();
        return { ok: true };
    },
};
