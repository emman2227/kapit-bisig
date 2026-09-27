import Constants from 'expo-constants';

const DEV_HOST_ALLOWLIST = new Set(['localhost', '127.0.0.1', '::1']);

function isPrivateIPv4(hostname: string): boolean {
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;

  const match172 = hostname.match(/^172\.(\d{1,3})\./);
  if (match172) {
    const secondOctet = Number(match172[1]);
    return secondOctet >= 16 && secondOctet <= 31;
  }

  return false;
}

function ensureSecureApiUrl(rawUrl: string, serviceLabel: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${serviceLabel}: Invalid API URL "${rawUrl}"`);
  }

  const isHttp = parsed.protocol === 'http:';
  const isHttps = parsed.protocol === 'https:';

  if (!isHttp && !isHttps) {
    throw new Error(`${serviceLabel}: Unsupported URL protocol "${parsed.protocol}"`);
  }

  if (isHttps) {
    return;
  }

  const host = parsed.hostname;
  const isDevHost = DEV_HOST_ALLOWLIST.has(host) || isPrivateIPv4(host);

  if (__DEV__ && isDevHost) {
    return;
  }

  throw new Error(
    `${serviceLabel}: Insecure HTTP URL is not allowed outside local development.`,
  );
}

export function resolveApiBaseUrl(
  envValue: string | undefined,
  fallbackValue: string,
  serviceLabel: string,
): string {
  const value = (envValue && envValue.trim()) || fallbackValue;
  ensureSecureApiUrl(value, serviceLabel);
  return value.replace(/\/+$/, '');
}

export function resolveOptionalApiBaseUrl(
  envValue: string | undefined,
  fallbackValue: string | null,
  serviceLabel: string,
): string | null {
  const trimmed = envValue?.trim();
  if (trimmed) {
    ensureSecureApiUrl(trimmed, serviceLabel);
    return trimmed.replace(/\/+$/, '');
  }

  if (__DEV__ && fallbackValue) {
    ensureSecureApiUrl(fallbackValue, serviceLabel);
    return fallbackValue.replace(/\/+$/, '');
  }

  return null;
}

function getExpoRuntimeHost(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as any)?.manifest2?.extra?.expoGo?.debuggerHost ||
    (Constants as any)?.manifest?.debuggerHost;

  if (!hostUri || typeof hostUri !== 'string') {
    return null;
  }

  // Expo reports LAN hosts as either `192.168.x.x:port` or as a URL.
  // Extract only the hostname and ignore tunnel/public hosts because they do
  // not expose the locally-running API server on ports 3001/8000.
  let host = '';
  try {
    const normalizedHostUri = /^https?:\/\//i.test(hostUri) ? hostUri : `http://${hostUri}`;
    host = new URL(normalizedHostUri).hostname;
  } catch {
    host = hostUri.split(':')[0];
  }

  if (!host || DEV_HOST_ALLOWLIST.has(host) || !isPrivateIPv4(host)) {
    return null;
  }

  return host;
}

function useExpoLanHostInDevelopment(baseUrl: string): string {
  if (!__DEV__) {
    return baseUrl;
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return baseUrl;
  }

  const configuredHost = parsed.hostname;
  const isLocalDevelopmentHost =
    DEV_HOST_ALLOWLIST.has(configuredHost) || isPrivateIPv4(configuredHost);
  if (!isLocalDevelopmentHost) {
    return baseUrl;
  }

  const runtimeHost = getExpoRuntimeHost();
  if (!runtimeHost || runtimeHost === configuredHost) {
    return baseUrl;
  }

  parsed.hostname = runtimeHost;
  return parsed.toString().replace(/\/+$/, '');
}

export function resolveDevApiFallbackUrl(baseUrl: string): string | null {
  if (!__DEV__) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return null;
  }

  const currentHost = parsed.hostname;
  const isDevHost = DEV_HOST_ALLOWLIST.has(currentHost) || isPrivateIPv4(currentHost);
  if (!isDevHost) {
    return null;
  }

  const runtimeHost = getExpoRuntimeHost();
  if (!runtimeHost || runtimeHost === currentHost) {
    return null;
  }

  parsed.hostname = runtimeHost;
  return parsed.toString().replace(/\/+$/, '');
}
