'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
});

function createStaticHandler() {
  async function handle(request, response, pathname) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return false;
    const relative =
      pathname === '/' || pathname === '/admin'
        ? 'index.html'
        : pathname.replace(/^\/+/, '');
    if (!relative || relative.includes('..') || relative.includes('\\'))
      return false;
    const filePath = path.resolve(PUBLIC_DIR, relative);
    if (
      filePath !== PUBLIC_DIR &&
      !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)
    )
      return false;

    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return false;
    }
    if (!stat.isFile()) return false;

    const content = await fs.promises.readFile(filePath);
    response.writeHead(200, {
      'Content-Type':
        MIME_TYPES[path.extname(filePath).toLowerCase()] ||
        'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control':
        pathname === '/' || pathname === '/admin'
          ? 'no-cache'
          : 'public, max-age=300',
    });
    if (request.method === 'HEAD') return response.end();
    return response.end(content);
  }

  return { handle };
}

module.exports = { createStaticHandler, PUBLIC_DIR };
