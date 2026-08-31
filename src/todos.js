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
    },
    update(id, input = {}) {
      const fields = Object.keys(input);
      if (fields.length !== 1 || !['status', 'assignedTo'].includes(fields[0])) {
        throw new Error('Exactly one of status or assignedTo is required');
      }

      if (fields[0] === 'status') {
        return this.updateStatus(id, input);
      }

      if (typeof input.assignedTo !== 'string' || !input.assignedTo.trim()) {
        throw new Error('Assignee must be a non-empty string');
      }

      return store.updateAssignedTo(id, input.assignedTo.trim());
    }
  };
}

module.exports = { createTodoService };
