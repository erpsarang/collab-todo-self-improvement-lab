(function exposeTodoRefresh(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.todoRefresh = api;
}(typeof globalThis === 'undefined' ? this : globalThis, () => {
  function createTodoLoader(fetchTodos, applyTodos) {
    let inFlight = null;
    let queuedFreshLoad = null;

    function startLoad() {
      const request = Promise.resolve()
        .then(fetchTodos)
        .then((todos) => {
          applyTodos(todos);
          return todos;
        });

      const trackedRequest = request.finally(() => {
        if (inFlight === trackedRequest) inFlight = null;
      });
      inFlight = trackedRequest;
      return inFlight;
    }

    return function loadTodos({ fresh = false } = {}) {
      if (!inFlight) return startLoad();
      if (!fresh) return inFlight;

      if (!queuedFreshLoad) {
        queuedFreshLoad = inFlight
          .catch(() => undefined)
          .then(startLoad)
          .finally(() => {
            queuedFreshLoad = null;
          });
      }
      return queuedFreshLoad;
    };
  }

  function startPeriodicRefresh(loadTodos, intervalMilliseconds = 5000) {
    return setInterval(() => {
      loadTodos().catch(() => {
        // A transient refresh failure must not replace the currently rendered list.
      });
    }, intervalMilliseconds);
  }

  function assigneeValue(todo, activeAssignee) {
    return activeAssignee?.id === todo.id ? activeAssignee.value : (todo.assignedTo || '');
  }

  function restoreAssigneeFocus(inputs, activeAssignee) {
    if (!activeAssignee) return;
    const input = Array.from(inputs).find(({ dataset }) => dataset.todoId === activeAssignee.id);
    if (!input) return;

    input.focus();
    if (activeAssignee.selectionStart !== undefined) {
      input.setSelectionRange(activeAssignee.selectionStart, activeAssignee.selectionEnd);
    }
  }

  return { assigneeValue, createTodoLoader, restoreAssigneeFocus, startPeriodicRefresh };
}));
