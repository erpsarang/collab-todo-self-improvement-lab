const form = document.querySelector('#todo-form');
const list = document.querySelector('#todo-list');
const emptyState = document.querySelector('#empty-state');
const count = document.querySelector('#todo-count');
const errorMessage = document.querySelector('#form-error');

function render(todos) {
  const focusedControl = list.contains(document.activeElement)
    && document.activeElement.matches('[data-todo-id][data-control]')
    ? {
        id: document.activeElement.dataset.todoId,
        control: document.activeElement.dataset.control,
        selectionStart: document.activeElement.selectionStart,
        selectionEnd: document.activeElement.selectionEnd
      }
    : null;
  const activeAssignee = focusedControl?.control === 'assignee'
    ? {
        ...focusedControl,
        value: document.activeElement.value,
        baseAssignedTo: document.activeElement.baseAssignedTo
      }
    : null;

  list.replaceChildren(...todos.map((todo) => {
    const item = document.createElement('li');
    const details = document.createElement('div');
    const title = document.createElement('strong');
    const creator = document.createElement('span');
    const assigneeLabel = document.createElement('label');
    const assignee = document.createElement('input');
    const assignButton = document.createElement('button');
    const status = document.createElement('select');
    title.textContent = todo.title;
    creator.textContent = `만든 사람: ${todo.createdBy}`;
    assigneeLabel.textContent = '담당자';
    assignee.dataset.todoId = todo.id;
    assignee.dataset.control = 'assignee';
    const assigneeDraft = todoRefresh.assigneeDraft(todo, activeAssignee);
    assignee.value = assigneeDraft.value;
    assignee.baseAssignedTo = assigneeDraft.baseAssignedTo;
    assignee.placeholder = '담당자 이름';
    assignee.setAttribute('aria-label', `${todo.title} 담당자`);
    assignButton.type = 'button';
    assignButton.dataset.todoId = todo.id;
    assignButton.dataset.control = 'assign';
    assignButton.textContent = todo.assignedTo ? '담당자 변경' : '담당자 지정';
    assignButton.addEventListener('click', async () => {
      errorMessage.textContent = '';
      assignee.disabled = true;
      assignButton.disabled = true;
      try {
        const response = await fetch(`/api/todos/${encodeURIComponent(todo.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assignedTo: assignee.value,
            expectedAssignedTo: assignee.baseAssignedTo
          })
        });
        const result = await response.json();
        if (!response.ok) {
          const error = new Error(result.error);
          error.isConflict = response.status === 409;
          throw error;
        }
        await loadTodos({ fresh: true });
      } catch (error) {
        errorMessage.textContent = error.message;
        if (error.isConflict) {
          assignee.blur();
          await loadTodos({ fresh: true }).catch(() => undefined);
          return;
        }
        assignee.disabled = false;
        assignButton.disabled = false;
      }
    });
    status.className = 'status';
    status.dataset.todoId = todo.id;
    status.dataset.control = 'status';
    status.setAttribute('aria-label', `${todo.title} 상태`);
    for (const value of ['TODO', 'DOING', 'DONE']) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      option.selected = value === todo.status;
      status.append(option);
    }
    status.addEventListener('change', async () => {
      errorMessage.textContent = '';
      status.disabled = true;
      try {
        const response = await fetch(`/api/todos/${encodeURIComponent(todo.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: status.value,
            expectedStatus: todo.status
          })
        });
        const result = await response.json();
        if (!response.ok) {
          const error = new Error(result.error);
          error.isConflict = response.status === 409;
          throw error;
        }
        await loadTodos({ fresh: true });
      } catch (error) {
        errorMessage.textContent = error.message;
        if (error.isConflict) {
          status.blur();
          await loadTodos({ fresh: true }).catch(() => undefined);
          return;
        }
        status.value = todo.status;
        status.disabled = false;
      }
    });
    assigneeLabel.append(assignee);
    details.append(title, creator, assigneeLabel, assignButton);
    item.append(details, status);
    return item;
  }));
  todoRefresh.restoreInteractiveFocus(
    list.querySelectorAll('[data-todo-id][data-control]'),
    focusedControl
  );
  count.textContent = `${todos.length}개`;
  emptyState.hidden = todos.length > 0;
}

async function fetchTodos() {
  const response = await fetch('/api/todos');
  if (!response.ok) throw new Error('목록을 불러오지 못했습니다.');
  return response.json();
}

const loadTodos = todoRefresh.createTodoLoader(fetchTodos, render);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorMessage.textContent = '';
  const values = new FormData(form);

  try {
    const response = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: values.get('title'), createdBy: values.get('createdBy') })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    form.elements.title.value = '';
    await loadTodos({ fresh: true });
  } catch (error) {
    errorMessage.textContent = error.message;
  }
});

loadTodos().catch((error) => { errorMessage.textContent = error.message; });
todoRefresh.startPeriodicRefresh(loadTodos);
