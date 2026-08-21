'use strict';

const MAX_ERROR_MESSAGE_LENGTH = 240;

function parseCookies(header = '') {
  return header.split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator <= 0) return cookies;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function sendJson(response, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
}

function sendText(response, statusCode, body, headers = {}) {
  const text = String(body);
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...headers,
  });
  response.end(text);
}

function sendError(response, statusCode, code, message) {
  sendJson(response, statusCode, {
    error: {
      code,
      message: String(message || 'Request failed').slice(
        0,
        MAX_ERROR_MESSAGE_LENGTH
      ),
    },
  });
}

function readJsonBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    request.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        fail(
          Object.assign(new Error('Request body too large'), {
            code: 'BODY_TOO_LARGE',
          })
        );
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      if (size === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(
          Object.assign(new Error('Request body must be valid JSON'), {
            code: 'INVALID_JSON',
          })
        );
      }
    });
    request.on('error', fail);
  });
}

function clientAddress(request) {
  return request.socket?.remoteAddress || 'unknown';
}

function setSessionCookie(response, token, maxAgeSeconds) {
  response.setHeader(
    'Set-Cookie',
    `eg_session=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax`
  );
}

function clearSessionCookie(response) {
  response.setHeader(
    'Set-Cookie',
    'eg_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'
  );
}

function setSecurityHeaders(response, isApi = false) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:"
  );
  if (isApi) response.setHeader('Cache-Control', 'no-store');
}

module.exports = {
  clearSessionCookie,
  clientAddress,
  parseCookies,
  readJsonBody,
  sendError,
  sendJson,
  sendText,
  setSecurityHeaders,
  setSessionCookie,
};
