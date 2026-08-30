const form = document.querySelector('#todo-form');
const list = document.querySelector('#todo-list');
const emptyState = document.querySelector('#empty-state');
const count = document.querySelector('#todo-count');
const errorMessage = document.querySelector('#form-error');

function render(todos) {
  list.replaceChildren(...todos.map((todo) => {
    const item = document.createElement('li');
    const details = document.createElement('div');
    const title = document.createElement('strong');
    const creator = document.createElement('span');
    const status = document.createElement('span');
    title.textContent = todo.title;
    creator.textContent = `만든 사람: ${todo.createdBy}`;
    status.className = 'status';
    status.textContent = todo.status;
    details.append(title, creator);
    item.append(details, status);
    return item;
  }));
  count.textContent = `${todos.length}개`;
  emptyState.hidden = todos.length > 0;
}

async function loadTodos() {
  const response = await fetch('/api/todos');
  if (!response.ok) throw new Error('목록을 불러오지 못했습니다.');
  render(await response.json());
}

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
    await loadTodos();
  } catch (error) {
    errorMessage.textContent = error.message;
  }
});

loadTodos().catch((error) => { errorMessage.textContent = error.message; });
