const baseUrl = (import.meta.env.VITE_API_BASE_URL?.trim() || '/backend-api').replace(/\/$/, '');

export function apiUrl(path: `/${string}`) { return `${baseUrl}${path}`; }

export class ApiRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

export async function apiRequest<T>(path: `/${string}`, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...options,
      headers: { Accept: 'application/json', ...options.headers }
    });
  } catch {
    throw new ApiRequestError(0, 'Cannot reach the ORION API. Start the FastAPI backend on port 8000.');
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = body && typeof body === 'object' && 'detail' in body ? (body as {detail: unknown}).detail : null;
    const message = typeof detail === 'string' ? detail : `API returned HTTP ${response.status}.`;
    throw new ApiRequestError(response.status, message);
  }
  return response.json() as Promise<T>;
}
