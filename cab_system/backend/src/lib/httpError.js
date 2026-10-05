export class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const badRequest = (code, message) => new HttpError(400, code, message);
export const notFound = (code, message) => new HttpError(404, code, message);
export const conflict = (code, message) => new HttpError(409, code, message);
