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
    updateAssignedTo(id, assignedTo) {
      const todo = todos.find((item) => item.id === id);
      if (!todo) return null;

      todo.assignedTo = assignedTo;
      return todo;
    }
  };
}

module.exports = { createTodoStore };
