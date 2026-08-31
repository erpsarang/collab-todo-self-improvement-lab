const { randomUUID } = require('node:crypto');
const allowedStatuses = new Set(['TODO', 'DOING', 'DONE']);

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
    },
    updateStatus(id, input = {}) {
      if (!allowedStatuses.has(input.status)) {
        throw new Error('Status must be TODO, DOING, or DONE');
      }

      return store.updateStatus(id, input.status);
    }
  };
}

module.exports = { createTodoService };
