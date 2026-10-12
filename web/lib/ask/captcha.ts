import 'server-only';
import { captchaConfig, type CaptchaConfig } from '../downloads/captcha';

export const ASK_CAPTCHA_ACTION = 'ask_ai';

/** Validate a fresh, single-use token for every paid turn. Never issue a reusable grant. */
export async function verifyAskCaptcha(
  token: unknown,
  headers: Headers,
  config: CaptchaConfig | null = captchaConfig(),
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  if (!config) return 'AI verification is temporarily unavailable. You can still search the records.';
  const origin = headers.get('origin');
  const localOrigin = origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (origin !== config.origin && !(config.testMode && localOrigin)) {
    return 'Please complete verification on this site.';
  }
  if (typeof token !== 'string' || !token.trim() || token.length > 2048) {
    return 'Complete the human verification check first.';
  }
  try {
    const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ secret: config.secretKey, response: token }),
    });
    if (!response.ok) throw new Error('Siteverify unavailable');
    const result = await response.json() as { success?: boolean; hostname?: string; action?: string };
    if (result.success !== true || (!config.testMode && (
      result.hostname !== new URL(config.origin).hostname || result.action !== ASK_CAPTCHA_ACTION
    ))) return 'Verification failed or expired. Please complete a new check.';
    return null;
  } catch {
    return 'Verification is temporarily unavailable. Please try again.';
  }
}
