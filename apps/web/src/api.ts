const base = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
let accessToken = '';
let adminToken = sessionStorage.getItem('myvoice_admin_token') ?? '';

export const setAccessToken = (token: string) => {
  accessToken = token;
};
export const setAdminToken = (token: string) => {
  adminToken = token;
  sessionStorage.setItem('myvoice_admin_token', token);
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
    const body = await response.json().catch(() => ({}));
    throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Network error');
  }
  return response.json();
}
