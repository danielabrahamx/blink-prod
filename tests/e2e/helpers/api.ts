export const API_BASE = 'http://localhost:3001';

export async function apiGet(path: string): Promise<Response> {
  return fetch(`${API_BASE}${path}`);
}

export async function apiPost(path: string, body: object): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
