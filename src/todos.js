const { randomUUID } = require('node:crypto');

function createTodoService(store, createId = randomUUID) {
  return {
    create(input = {}) {
      const title = typeof input.title === 'string' ? input.title.trim() : '';
      const createdBy = typeof input.createdBy === 'string' ? input.createdBy.trim() : '';

      if (!title) {
        throw new Error('Title is required');
      }
      if (!createdBy) {
        throw new Error('Creator is required');
      }

      return store.add({
        id: createId(),
        title,
        status: 'TODO',
        createdBy
      });
    },
    list() {
      return store.list();
    }
  };
}

module.exports = { createTodoService };
