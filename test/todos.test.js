const test = require('node:test');
const assert = require('node:assert/strict');
const { createTodoStore } = require('../src/store');
const { createTodoService } = require('../src/todos');

function service() {
  return createTodoService(createTodoStore(), () => 'todo-1');
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
