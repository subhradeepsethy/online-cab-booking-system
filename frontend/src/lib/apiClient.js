// Absolute (http://host:5000/api in development) or relative (/api when the API serves the site).
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000/api').replace(/\/$/, '');

export const apiOrigin = new URL(apiBaseUrl, window.location.href).origin;

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// Sessions live in HttpOnly cookies (one per role) that page scripts can't read. Each request
// says which role's session it means with X-Session-Role; the custom header also blocks CSRF.
function requestInit({ role, body, headers, ...options }) {
  return {
    ...options,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...(role ? { 'X-Session-Role': role } : {}),
      ...headers,
    },
  };
}

export async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, requestInit(options));
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0, 'NETWORK_ERROR');
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(
      payload.error?.message ?? 'The request failed.',
      response.status,
      payload.error?.code ?? 'REQUEST_FAILED',
    );
  }

  return payload;
}

// Downloads a protected file (e.g. a driver document) as a Blob for display.
export async function fetchFileBlob(path, role) {
  const response = await fetch(`${apiBaseUrl}${path}`, { credentials: 'include', headers: { 'X-Session-Role': role } });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(payload.error?.message ?? 'Could not load the file.', response.status, payload.error?.code ?? 'REQUEST_FAILED');
  }
  return response.blob();
}

export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

export { apiBaseUrl };
