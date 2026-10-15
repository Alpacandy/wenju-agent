const crypto = require('crypto');

function createAuthSession(options = {}) {
  const token = options.token || crypto.randomBytes(32).toString('base64url');
  const confirmToken = options.confirmToken || crypto.randomBytes(32).toString('base64url'); // P7-H4：ask 层二次确认令牌
  const allowedOrigins = new Set(options.allowedOrigins || ['http://127.0.0.1:8000', 'http://localhost:8000']);
  function authorize(request) {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      const error = new Error('origin is not allowed');
      error.code = 'ORIGIN_FORBIDDEN';
      throw error;
    }
    const header = request.headers.authorization || '';
    if (header !== `Bearer ${token}`) {
      const error = new Error('missing or invalid bearer token');
      error.code = 'UNAUTHORIZED';
      throw error;
    }
  }
  return { token, confirmToken, allowedOrigins, authorize };
}

module.exports = { createAuthSession };
