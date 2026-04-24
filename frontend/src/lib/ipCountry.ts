/**
 * Best-effort IP → ISO-3166 country lookup used by the /live demo to
 * detect VPN / cross-border traffic. Failures are intentionally silent:
 * if the endpoint is blocked or slow, we fall back to distance-only
 * rating and never show an error to the user.
 */

const IPAPI_ENDPOINT = 'https://ipapi.co/json/';
const DEFAULT_TIMEOUT_MS = 4_000;

export async function fetchIpCountry(
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string | null> {
  const controller = new AbortController();
  const chain = (): void => controller.abort();
  signal?.addEventListener('abort', chain);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(IPAPI_ENDPOINT, { signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { country_code?: unknown };
    if (typeof body.country_code !== 'string') return null;
    return body.country_code.toUpperCase();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', chain);
  }
}
