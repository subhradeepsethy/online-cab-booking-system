export function notFoundHandler(_request, response) {
  // Generic on purpose: echoing the requested path back adds nothing for real clients.
  response.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Not found.',
    },
  });
}

// Errors from the JSON body parser carry internal parser messages; replace them with plain ones.
const bodyParserErrors = {
  'entity.parse.failed': { statusCode: 400, code: 'INVALID_JSON', message: 'The request body is not valid JSON.' },
  'entity.too.large': { statusCode: 413, code: 'PAYLOAD_TOO_LARGE', message: 'The request is too large.' },
  'encoding.unsupported': { statusCode: 415, code: 'UNSUPPORTED_ENCODING', message: 'Unsupported request encoding.' },
  'charset.unsupported': { statusCode: 415, code: 'UNSUPPORTED_ENCODING', message: 'Unsupported request encoding.' },
};

export function errorHandler(error, _request, response, _next) {
  const known = bodyParserErrors[error?.type];
  if (known) {
    return response.status(known.statusCode).json({ error: { code: known.code, message: known.message } });
  }

  const rawStatus = error?.statusCode ?? error?.status;
  const statusCode = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;
  const isServerError = statusCode >= 500;

  if (isServerError) {
    // Full details go to the server log only, never to the client.
    console.error(error);
  }

  // Only our own HttpErrors (which have a string `code`) are allowed to show their message.
  const isOwnError = typeof error?.code === 'string' && error.name === 'HttpError';
  return response.status(statusCode).json({
    error: {
      code: isServerError ? 'INTERNAL_SERVER_ERROR' : (isOwnError ? error.code : 'REQUEST_ERROR'),
      message: isServerError ? 'An unexpected server error occurred.' : (isOwnError ? error.message : 'The request could not be processed.'),
    },
  });
}
