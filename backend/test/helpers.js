import app from '../src/app.js';
import { createToken } from '../src/lib/auth.js';
import { createUser } from '../src/lib/users.js';

let phoneCounter = 7000000000;

export function nextPhone() {
  phoneCounter += 1;
  return String(phoneCounter);
}

// Smallest payload that passes the PNG signature check.
export const tinyPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]).toString('base64');

// Builds a JSON request helper for a running server. Tests authenticate with bearer tokens and
// ask for the token in login/sign-up responses (`X-Auth-Mode: token`); cookie sessions are
// covered separately in session.test.js.
export function requester(baseUrl) {
  return async function request(path, { method = 'GET', body, token, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Mode': 'token',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const isJson = response.headers.get('content-type')?.includes('application/json');
    return { status: response.status, headers: response.headers, body: text && isJson ? JSON.parse(text) : text || null };
  };
}

export async function startServer(context) {
  const server = app.listen(0);
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  return requester(`http://127.0.0.1:${server.address().port}`);
}

// Admins can't sign up through the API, so tests create one directly.
export async function createAdmin() {
  const user = await createUser({ role: 'admin', name: 'Test Admin', phone: nextPhone(), password: 'admin-secret-123' }, { allowAdmin: true });
  return { user, token: createToken(user) };
}

// Requests a sign-up code. With the development "console" SMS provider the API returns it as
// `devCode`, which stands in for reading the SMS.
export async function requestSignupCode(request, role, phone) {
  const { status, body } = await request('/api/auth/otp', { method: 'POST', body: { purpose: 'signup', role, phone } });
  if (status !== 200) throw new Error(`OTP request failed: ${status} ${JSON.stringify(body)}`);
  return body.devCode;
}

async function signUp(request, fields) {
  const otpCode = await requestSignupCode(request, fields.role, fields.phone);
  const { body } = await request('/api/auth/register', { method: 'POST', body: { ...fields, otpCode } });
  return body;
}

export async function registerCustomer(request, overrides = {}) {
  return signUp(request, { role: 'customer', name: 'Asha Rider', phone: nextPhone(), password: 'secret123', ...overrides });
}

export async function uploadAllDocuments(request, driver) {
  for (const type of ['license', 'rc', 'insurance']) {
    await request(`/api/driver/documents/${type}`, {
      method: 'PUT',
      token: driver.token,
      body: { fileName: `${type}.png`, mimeType: 'image/png', dataBase64: tinyPng },
    });
  }
}

// Registers a driver and, unless `approve: false`, uploads documents and has an admin approve them.
export async function registerDriver(request, { approve = true, ...overrides } = {}) {
  const body = await signUp(request, {
    role: 'driver',
    name: 'Ravi Driver',
    phone: nextPhone(),
    password: 'secret123',
    vehicleType: 'sedan',
    vehicleModel: 'Honda City',
    vehicleNumber: 'od 02 cd 5678',
    ...overrides,
  });

  if (approve) {
    await uploadAllDocuments(request, body);
    const admin = await createAdmin();
    await request(`/api/admin/users/${body.user.id}`, {
      method: 'PATCH',
      token: admin.token,
      body: { approvalStatus: 'approved' },
    });
  }
  return body;
}

export async function goOnline(request, driver) {
  return request('/api/driver/availability', {
    method: 'PATCH',
    token: driver.token,
    body: { isOnline: true },
  });
}

export const samplePickup = { address: 'Kalinga Stadium, Bhubaneswar', lat: 20.2876, lng: 85.8235 };
export const sampleDropoff = { address: 'Biju Patnaik Airport, Bhubaneswar', lat: 20.2444, lng: 85.8178 };
