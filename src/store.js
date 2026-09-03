function createTodoStore() {
  const todos = [];

  return {
    add(todo) {
      todos.push(todo);
      return todo;
    },
    list() {
      return [...todos];
    },
    updateStatus(id, status) {
      const todo = todos.find((item) => item.id === id);
      if (!todo) return null;

      todo.status = status;
      return todo;
    },
    updateAssignedTo(id, assignedTo, expectedAssignedTo) {
      const todo = todos.find((item) => item.id === id);
      if (!todo) return null;

      if (arguments.length >= 3 && (todo.assignedTo ?? null) !== expectedAssignedTo) {
        throw new AssigneeConflictError(todo);
      }

      todo.assignedTo = assignedTo;
      return todo;
    }
  };
}

class AssigneeConflictError extends Error {
  constructor(todo) {
    super('Assignee changed since it was loaded');
    this.name = 'AssigneeConflictError';
    this.statusCode = 409;
    this.currentTodo = todo;
  }
}

module.exports = { AssigneeConflictError, createTodoStore };
