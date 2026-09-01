(function exposeTodoRefresh(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.todoRefresh = api;
}(typeof globalThis === 'undefined' ? this : globalThis, () => {
  function createTodoLoader(fetchTodos, applyTodos) {
    let inFlight = null;

    return function loadTodos() {
      if (inFlight) return inFlight;

      inFlight = Promise.resolve()
        .then(fetchTodos)
        .then((todos) => {
          applyTodos(todos);
          return todos;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
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

  return { assigneeValue, createTodoLoader, startPeriodicRefresh };
}));
