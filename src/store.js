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
    }
  };
}

module.exports = { createTodoStore };
