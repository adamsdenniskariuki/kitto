/**
 * M-Pesa configuration, from environment variables.
 *
 *   MPESA_ENV               mock | sandbox | production (unset: M-Pesa is off)
 *   MPESA_CONSUMER_KEY      Daraja app consumer key     (sandbox / production)
 *   MPESA_CONSUMER_SECRET   Daraja app consumer secret  (sandbox / production)
 *   MPESA_SHORTCODE         paybill / till shortcode, e.g. 174379 in the sandbox
 *   MPESA_PASSKEY           Lipa na M-Pesa Online passkey
 *   MPESA_CALLBACK_BASE_URL public https origin Safaricom can reach
 *                           (default NEXT_PUBLIC_SITE_URL, then http://localhost:3000)
 *
 * One set of credentials serves every tenant of a deployment; per-tenant
 * shortcodes are future work (see docs/ARCHITECTURE.md).
 */

export type MpesaMode = 'disabled' | 'mock' | 'sandbox' | 'production';

export type MpesaConfig =
  | { mode: 'disabled' }
  | { mode: 'mock'; callbackBaseUrl: string }
  | {
      mode: 'sandbox' | 'production';
      consumerKey: string;
      consumerSecret: string;
      shortcode: string;
      passkey: string;
      callbackBaseUrl: string;
    };

export class MpesaConfigError extends Error {
  override name = 'MpesaConfigError';
}

type Env = Record<string, string | undefined>;

export function mpesaMode(env: Env = process.env): MpesaMode {
  const v = env.MPESA_ENV?.trim().toLowerCase();
  return v === 'mock' || v === 'sandbox' || v === 'production' ? v : 'disabled';
}

/** Reads and checks the config. Throws MpesaConfigError naming (never showing) missing values. */
export function readMpesaConfig(env: Env = process.env): MpesaConfig {
  const mode = mpesaMode(env);
  if (mode === 'disabled') return { mode };
  const callbackBaseUrl = (
    env.MPESA_CALLBACK_BASE_URL ||
    env.NEXT_PUBLIC_SITE_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+/.test(callbackBaseUrl)) {
    throw new MpesaConfigError('MPESA_CALLBACK_BASE_URL must be an http(s) URL');
  }
  if (mode === 'mock') {
    // Mock settles invoices with no money moving; never allow it on a live Vercel deployment.
    if (env.VERCEL_ENV === 'production') {
      throw new MpesaConfigError('MPESA_ENV=mock is not allowed in production');
    }
    return { mode, callbackBaseUrl };
  }

  const missing = [
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_SHORTCODE',
    'MPESA_PASSKEY',
  ].filter((k) => !env[k]?.trim());
  if (missing.length) throw new MpesaConfigError(`Missing ${missing.join(', ')}`);
  if (!callbackBaseUrl.startsWith('https://')) {
    throw new MpesaConfigError('Daraja only calls back to https URLs; set MPESA_CALLBACK_BASE_URL');
  }
  return {
    mode,
    consumerKey: env.MPESA_CONSUMER_KEY!.trim(),
    consumerSecret: env.MPESA_CONSUMER_SECRET!.trim(),
    shortcode: env.MPESA_SHORTCODE!.trim(),
    passkey: env.MPESA_PASSKEY!.trim(),
    callbackBaseUrl,
  };
}
