/** Reads and checks environment variables once at startup, so a missing setting fails fast. */
export interface Env {
  NODE_ENV: string;
  PORT: number;
  DATABASE_URL: string;
  DB_POOL_MAX: number;
  CORS_ORIGINS: string[];
  JWT_SECRET: string;
  CUSTOMER_TOKEN_TTL: string;
  CUSTOMER_TOKEN_TTL_REMEMBER: string;
  ADMIN_TOKEN_TTL: string;
  OTP_SECRET: string;
  SERVICE_AREAS: string[];
  SUBSCRIPTIONS_ENABLED: boolean;
  UPLOAD_DIR: string;
  PUBLIC_URL: string;
  SALES_EMAIL: string;
  TRUST_PROXY: number;
}

const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export function validateEnv(raw: Record<string, unknown>): Env {
  const s = (k: string, fallback?: string) => {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing environment variable ${k}. Copy .env.example to .env and fill it in.`);
  };
  const nodeEnv = s('NODE_ENV', 'development');
  const jwtSecret = s('JWT_SECRET');
  if (nodeEnv === 'production' && jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters in production.');
  const port = Number(s('PORT', '3000'));
  return {
    NODE_ENV: nodeEnv,
    PORT: port,
    DATABASE_URL: s('DATABASE_URL'),
    DB_POOL_MAX: Number(s('DB_POOL_MAX', '10')),
    CORS_ORIGINS: list(s('CORS_ORIGINS', 'http://localhost:5173')),
    JWT_SECRET: jwtSecret,
    CUSTOMER_TOKEN_TTL: s('CUSTOMER_TOKEN_TTL', '1d'),
    CUSTOMER_TOKEN_TTL_REMEMBER: s('CUSTOMER_TOKEN_TTL_REMEMBER', '30d'),
    ADMIN_TOKEN_TTL: s('ADMIN_TOKEN_TTL', '12h'),
    OTP_SECRET: s('OTP_SECRET', jwtSecret),
    SERVICE_AREAS: list(s('SERVICE_AREAS', '')).map((a) => a.toLowerCase()),
    SUBSCRIPTIONS_ENABLED: s('SUBSCRIPTIONS_ENABLED', 'false') === 'true',
    UPLOAD_DIR: s('UPLOAD_DIR', 'uploads'),
    // Render sets RENDER_EXTERNAL_URL to the service's public address.
    PUBLIC_URL: s('PUBLIC_URL', s('RENDER_EXTERNAL_URL', `http://localhost:${port}`)),
    SALES_EMAIL: s('SALES_EMAIL', 'sales@hospitalityinnovations.com.ph'),
    // Proxies in front of the app (1 on Render). Needed so rate limits see each visitor's real IP.
    TRUST_PROXY: Number(s('TRUST_PROXY', '0')),
  };
}
