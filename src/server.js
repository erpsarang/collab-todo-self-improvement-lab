const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createTodoStore } = require('./store');
const { createTodoService } = require('./todos');

const publicDirectory = path.join(__dirname, '..', 'public');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) request.destroy();
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    request.on('error', reject);
  });
}

function serveStatic(pathname, response) {
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.resolve(publicDirectory, relativePath);

  if (!filePath.startsWith(`${publicDirectory}${path.sep}`)) {
    response.writeHead(404).end();
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream' });
    response.end(contents);
  });
}

function createServer(service = createTodoService(createTodoStore())) {
  return http.createServer(async (request, response) => {
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      sendJson(response, 400, { error: 'Invalid request target' });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/todos') {
      sendJson(response, 200, service.list());
      return;
    }

    if (request.method === 'POST' && pathname === '/api/todos') {
      try {
        const todo = service.create(await readJson(request));
        sendJson(response, 201, todo);
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }
      return;
    }

    const todoMatch = pathname.match(/^\/api\/todos\/([^/]+)$/);
    if (request.method === 'PATCH' && todoMatch) {
      try {
        const todo = service.update(decodeURIComponent(todoMatch[1]), await readJson(request));
        if (!todo) {
          sendJson(response, 404, { error: 'To-do not found' });
          return;
        }
        sendJson(response, 200, todo);
      } catch (error) {
        if (error.statusCode === 409) {
          sendJson(response, 409, { error: error.message, currentTodo: error.currentTodo });
          return;
        }
        sendJson(response, 400, { error: error.message });
      }
      return;
    }

    if (request.method === 'GET') {
      serveStatic(pathname, response);
      return;
    }

    sendJson(response, 404, { error: 'Not found' });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => {
    console.log(`Collaborative To-do app listening on http://localhost:${port}`);
  });
}

module.exports = { createServer };
