const base = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
let accessToken = '';
let adminToken = sessionStorage.getItem('myvoice_admin_token') ?? '';

export type ApiErrorBody = {
  message?: string | string[];
  captchaRequired?: boolean;
  captchaConfigured?: boolean;
  captchaSiteKey?: string;
  blocked?: boolean;
  retryAfterSeconds?: number;
  [key: string]: unknown;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const setAccessToken = (token: string) => {
  accessToken = token;
};
export const setAdminToken = (token: string) => {
  adminToken = token;
  sessionStorage.setItem('myvoice_admin_token', token);
};
export const clearAdminToken = () => {
  adminToken = '';
  sessionStorage.removeItem('myvoice_admin_token');
};
export const hasAdminToken = () => Boolean(adminToken);

export async function api<T>(path: string, options: RequestInit = {}, admin = false): Promise<T> {
  const token = admin ? adminToken : accessToken;
  const response = await fetch(`${base}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    const message = Array.isArray(body.message)
      ? body.message.join(', ')
      : (body.message ?? 'Network error');
    throw new ApiError(message, response.status, body);
  }
  return response.json();
}
