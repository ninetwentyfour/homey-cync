/**
 * Cync REST authentication: email/password + email-OTP 2FA.
 * Ported from pycync/auth.py. Endpoints verified against pycync 0.5.0.
 */

import axios from 'axios';

import type { Logger, StoredTokens } from './types';

const CORP_ID = '1007d2ad150c4000';
const BASE_URL = 'https://api.gelighting.com';

export class CyncAuthError extends Error {
  constructor(
    message: string,
    public readonly kind: 'needs_otp' | 'invalid_otp' | 'invalid_credentials' | 'network' = 'network',
  ) {
    super(message);
    this.name = 'CyncAuthError';
  }
}

interface AuthResponse {
  access_token: string;
  refresh_token: string;
  authorize: string;
  user_id: number;
  expire_in: number;
}

interface CyncAuthOptions {
  logger?: Logger;
}

export class CyncAuth {
  private readonly logger: Logger;

  constructor(opts: CyncAuthOptions = {}) {
    this.logger = opts.logger ?? { log: () => {}, error: () => {} };
  }

  async login(email: string, password: string): Promise<StoredTokens> {
    this.logger.log('Cync auth: attempting login');
    const res = await this.post('/v2/user_auth', { corp_id: CORP_ID, email, password });
    this.logger.log(`Cync auth response: HTTP ${res.status}`);

    if (res.status === 400) {
      this.logger.log('2FA required — requesting OTP email');
      const otpRes = await this.post('/v2/two_factor/email/verifycode', {
        corp_id: CORP_ID,
        email,
        local_lang: 'en-us',
      });
      this.logger.log(`OTP trigger response: HTTP ${otpRes.status}`);
      if (otpRes.status !== 200) {
        this.logger.error('OTP trigger failed:', otpRes.data);
        throw new CyncAuthError(`Failed to send verification code (HTTP ${otpRes.status})`, 'network');
      }
      this.logger.log('OTP email triggered successfully');
      throw new CyncAuthError(
        'Two-factor verification required. Check your email for a code.',
        'needs_otp',
      );
    }
    if (res.status !== 200) {
      this.logger.error('Login failed:', res.status, res.data);
      throw new CyncAuthError(`Login failed (HTTP ${res.status})`, 'invalid_credentials');
    }
    this.logger.log('Login succeeded without 2FA');
    return this.toStoredTokens(res.data as AuthResponse);
  }

  async submitOtp(email: string, password: string, code: string): Promise<StoredTokens> {
    this.logger.log('Cync auth: submitting OTP');
    const resource = Array.from({ length: 16 }, () =>
      String.fromCharCode(97 + Math.floor(Math.random() * 26)),
    ).join('');
    const res = await this.post('/v2/user_auth/two_factor', {
      corp_id: CORP_ID,
      email,
      password,
      two_factor: code,
      resource,
    });
    this.logger.log(`OTP submit response: HTTP ${res.status}`);
    if (res.status === 400) {
      throw new CyncAuthError('Invalid verification code.', 'invalid_otp');
    }
    if (res.status !== 200) {
      throw new CyncAuthError(`OTP verification failed (HTTP ${res.status})`, 'invalid_credentials');
    }
    return this.toStoredTokens(res.data as AuthResponse);
  }

  async refreshTokens(refreshToken: string): Promise<StoredTokens> {
    const res = await this.post('/v2/user/token/refresh', { refresh_token: refreshToken });
    if (res.status !== 200) {
      throw new CyncAuthError(`Token refresh failed (HTTP ${res.status})`, 'invalid_credentials');
    }
    return this.toStoredTokens(res.data as AuthResponse);
  }

  private toStoredTokens(raw: AuthResponse): StoredTokens {
    return {
      accessToken: raw.access_token,
      refreshToken: raw.refresh_token,
      authorize: raw.authorize,
      userId: raw.user_id,
      expiresAt: Date.now() + raw.expire_in * 1000,
    };
  }

  private async post(path: string, body: Record<string, unknown>): Promise<{ status: number; data: unknown }> {
    try {
      const res = await axios.post(`${BASE_URL}${path}`, body, {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true,
      });
      return { status: res.status, data: res.data };
    } catch (err) {
      this.logger.error(`Cync REST ${path} failed:`, err);
      throw new CyncAuthError(`Network error calling ${path}`, 'network');
    }
  }

  async get(path: string, accessToken: string): Promise<unknown> {
    const res = await axios.get(`${BASE_URL}${path}`, {
      headers: { 'Access-Token': accessToken },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new CyncAuthError(`GET ${path} failed (HTTP ${res.status})`, 'network');
    }
    return res.data;
  }
}
