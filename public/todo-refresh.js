(function exposeTodoRefresh(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.todoRefresh = api;
}(typeof globalThis === 'undefined' ? this : globalThis, () => {
  function createTodoLoader(fetchTodos, applyTodos) {
    let inFlight = null;
    let queuedFreshLoad = null;
    let freshRequested = false;

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

      freshRequested = true;
      if (!queuedFreshLoad) {
        queuedFreshLoad = (async () => {
          do {
            const currentRequest = inFlight;
            if (currentRequest) await currentRequest.catch(() => undefined);
            // This request begins after every fresh request received so far. A fresh
            // request received while it is in flight will leave the flag set and
            // cause exactly one more pass through the loop.
            freshRequested = false;
            await startLoad();
          } while (freshRequested);
        })()
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

  function assigneeDraft(todo, activeAssignee) {
    if (activeAssignee?.id === todo.id) {
      return {
        value: activeAssignee.value,
        baseAssignedTo: activeAssignee.baseAssignedTo
      };
    }
    return {
      value: todo.assignedTo || '',
      baseAssignedTo: todo.assignedTo ?? null
    };
  }

  function assigneeValue(todo, activeAssignee) {
    return assigneeDraft(todo, activeAssignee).value;
  }

  function restoreInteractiveFocus(controls, activeControl) {
    if (!activeControl) return;
    const control = Array.from(controls).find(({ dataset }) => (
      dataset.todoId === activeControl.id && dataset.control === activeControl.control
    ));
    if (!control) return;

    control.focus();
    if (activeControl.selectionStart !== undefined && control.setSelectionRange) {
      control.setSelectionRange(activeControl.selectionStart, activeControl.selectionEnd);
    }
  }

  return {
    assigneeDraft,
    assigneeValue,
    createTodoLoader,
    restoreInteractiveFocus,
    startPeriodicRefresh
  };
}));
