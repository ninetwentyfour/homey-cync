import type CyncApp from './app';

interface ApiArgs {
  homey: { app: CyncApp };
}

module.exports = {
  async signOut({ homey }: ApiArgs): Promise<{ ok: true }> {
    await homey.app.signOut();
    return { ok: true };
  },
};
