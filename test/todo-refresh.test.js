const test = require('node:test');
const assert = require('node:assert/strict');
const { assigneeValue, createTodoLoader, startPeriodicRefresh } = require('../public/todo-refresh');

test('keeps an assignee draft only for the input being edited', () => {
  const todo = { id: '1', assignedTo: '서버 담당자' };

  assert.equal(assigneeValue(todo, { id: '1', value: '입력 중' }), '입력 중');
  assert.equal(assigneeValue(todo, { id: '2', value: '다른 입력' }), '서버 담당자');
});

test('periodic refresh applies newly created todos and remote status and assignee changes', async (t) => {
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  let refresh;
  global.setInterval = (callback, milliseconds) => {
    assert.equal(milliseconds, 5000);
    refresh = callback;
    return 1;
  };
  global.clearInterval = () => {};
  t.after(() => {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  });

  let serverTodos = [{ id: '1', title: '공유 작업', status: 'TODO' }];
  let rendered = [];
  const loadTodos = createTodoLoader(
    async () => structuredClone(serverTodos),
    (todos) => { rendered = todos; }
  );

  startPeriodicRefresh(loadTodos);
  await loadTodos();
  serverTodos = [
    { id: '1', title: '공유 작업', status: 'DONE', assignedTo: '민수' },
    { id: '2', title: '새 작업', status: 'TODO' }
  ];
  refresh();
  await new Promise(setImmediate);

  assert.deepEqual(rendered, serverTodos);
});

test('a failed refresh keeps the previously applied todos', async () => {
  const current = [{ id: '1', status: 'DOING', assignedTo: '지수' }];
  let rendered = current;
  let shouldFail = false;
  const loadTodos = createTodoLoader(
    async () => {
      if (shouldFail) throw new Error('network unavailable');
      return current;
    },
    (todos) => { rendered = todos; }
  );

  await loadTodos();
  shouldFail = true;
  await assert.rejects(loadTodos(), /network unavailable/);
  assert.strictEqual(rendered, current);
});

test('overlapping refresh calls share one request', async () => {
  let resolveRequest;
  let requestCount = 0;
  const loadTodos = createTodoLoader(
    () => {
      requestCount += 1;
      return new Promise((resolve) => { resolveRequest = resolve; });
    },
    () => {}
  );

  const first = loadTodos();
  const second = loadTodos();
  await new Promise(setImmediate);
  assert.equal(requestCount, 1);
  resolveRequest([]);
  await Promise.all([first, second]);
});
