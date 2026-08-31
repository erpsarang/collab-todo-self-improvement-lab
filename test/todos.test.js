const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createServer } = require('../src/server');
const { createTodoStore } = require('../src/store');
const { createTodoService } = require('../src/todos');

function service() {
  return createTodoService(createTodoStore(), () => 'todo-1');
}

function request(server, path, options = {}) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const clientRequest = http.request({ host: '127.0.0.1', port, path, method: options.method || 'GET', headers: options.headers }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve({ statusCode: response.statusCode, body }));
    });
    clientRequest.on('error', reject);
    if (options.body) clientRequest.write(options.body);
    clientRequest.end();
  });
}

function patchStatus(server, id, status) {
  return request(server, `/api/todos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
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

test('changes a TODO to-do to DOING', () => {
  const todos = service();
  todos.create({ title: '진행하기', createdBy: 'Kim' });

  assert.equal(todos.updateStatus('todo-1', { status: 'DOING' }).status, 'DOING');
});

test('changes a to-do status to DONE', () => {
  const todos = service();
  todos.create({ title: '완료하기', createdBy: 'Kim' });

  assert.equal(todos.updateStatus('todo-1', { status: 'DONE' }).status, 'DONE');
});

test('rejects a status that is not allowed with 400', async (t) => {
  const todos = service();
  todos.create({ title: '상태 확인', createdBy: 'Kim' });
  const server = createServer(todos);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const response = await patchStatus(server, 'todo-1', 'CANCELLED');
  assert.equal(response.statusCode, 400);
  assert.match(JSON.parse(response.body).error, /Status must be/);
  assert.equal(todos.list()[0].status, 'TODO');
});

test('returns 404 when changing a missing to-do', async (t) => {
  const server = createServer(service());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const response = await patchStatus(server, 'missing', 'DOING');
  assert.equal(response.statusCode, 404);
  assert.deepEqual(JSON.parse(response.body), { error: 'To-do not found' });
});

test('lists the changed status after a PATCH request', async (t) => {
  const todos = service();
  todos.create({ title: '공유 상태', createdBy: 'Lee' });
  const server = createServer(todos);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const changed = await patchStatus(server, 'todo-1', 'DONE');
  assert.equal(changed.statusCode, 200);
  assert.equal(JSON.parse(changed.body).status, 'DONE');

  const listed = await request(server, '/api/todos');
  assert.equal(JSON.parse(listed.body)[0].status, 'DONE');
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
