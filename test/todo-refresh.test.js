const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assigneeValue,
  createTodoLoader,
  restoreAssigneeFocus,
  startPeriodicRefresh
} = require('../public/todo-refresh');

test('keeps an assignee draft only for the input being edited', () => {
  const todo = { id: '1', assignedTo: '서버 담당자' };

  assert.equal(assigneeValue(todo, { id: '1', value: '입력 중' }), '입력 중');
  assert.equal(assigneeValue(todo, { id: '2', value: '다른 입력' }), '서버 담당자');
});

test('restores focus and the caret after replacing an assignee input', () => {
  const calls = [];
  const replacement = {
    dataset: { todoId: '1' },
    focus: () => calls.push('focus'),
    setSelectionRange: (start, end) => calls.push(['selection', start, end])
  };

  restoreAssigneeFocus([replacement], {
    id: '1', value: '입력 중', selectionStart: 2, selectionEnd: 4
  });

  assert.deepEqual(calls, ['focus', ['selection', 2, 4]]);
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

test('a fresh load waits for an in-flight poll and then fetches server state again', async () => {
  const resolvers = [];
  let requestCount = 0;
  const rendered = [];
  const loadTodos = createTodoLoader(
    () => {
      requestCount += 1;
      return new Promise((resolve) => resolvers.push(resolve));
    },
    (todos) => rendered.push(todos)
  );

  const poll = loadTodos();
  await new Promise(setImmediate);
  const afterMutation = loadTodos({ fresh: true });
  assert.equal(requestCount, 1);

  resolvers[0]([{ id: 'stale' }]);
  await new Promise(setImmediate);
  assert.equal(requestCount, 2);
  resolvers[1]([{ id: 'updated' }]);

  await Promise.all([poll, afterMutation]);
  assert.deepEqual(rendered, [[{ id: 'stale' }], [{ id: 'updated' }]]);
});
