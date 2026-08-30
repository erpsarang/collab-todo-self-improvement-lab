function createTodoStore() {
  const todos = [];

  return {
    add(todo) {
      todos.push(todo);
      return todo;
    },
    list() {
      return [...todos];
    }
  };
}

module.exports = { createTodoStore };
