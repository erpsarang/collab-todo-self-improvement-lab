const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createServer } = require('../src/server');
const { createTodoStore } = require('../src/store');
const { createTodoService } = require('../src/todos');

function service() {
  return createTodoService(createTodoStore(), () => 'todo-1');
}

function request(server, path) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve({ statusCode: response.statusCode, body }));
    }).on('error', reject);
  });
}

test('creates a valid to-do', () => {
  const todo = service().create({ title: '요구사항 정리', createdBy: '상열' });
  assert.deepEqual(todo, { id: 'todo-1', title: '요구사항 정리', status: 'TODO', createdBy: '상열' });
});

test('new to-do starts with TODO status', () => {
  assert.equal(service().create({ title: 'Test', createdBy: 'Kim' }).status, 'TODO');
});

test('rejects a to-do without a title', () => {
  assert.throws(() => service().create({ createdBy: 'Kim' }), /Title is required/);
});

test('lists a created to-do', () => {
  const todos = service();
  const created = todos.create({ title: '함께 확인하기', createdBy: 'Lee' });
  assert.deepEqual(todos.list(), [created]);
});

test('returns 400 for a malformed request target without stopping the server', async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const malformedResponse = await request(server, '//[');
  assert.equal(malformedResponse.statusCode, 400);
  assert.deepEqual(JSON.parse(malformedResponse.body), { error: 'Invalid request target' });

  const healthyResponse = await request(server, '/api/todos');
  assert.equal(healthyResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(healthyResponse.body), []);
});
