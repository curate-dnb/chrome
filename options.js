document.addEventListener('DOMContentLoaded', () => {
  const discogsTokenInput = document.getElementById('token');
  const todoistTokenInput = document.getElementById('todoistToken');
  const saveButton = document.getElementById('save');
  const statusEl = document.getElementById('status');

  // Load saved credentials to show they exist (but don't display the actual values)
  chrome.storage.local.get(['discogsToken', 'todoistToken'], (result) => {
    if (result.discogsToken) {
      discogsTokenInput.placeholder = "Saved (••••••••••••••••)";
    }
    if (result.todoistToken) {
      todoistTokenInput.placeholder = "Saved (••••••••••••••••)";
    }
  });

  saveButton.addEventListener('click', () => {
    const discogsToken = discogsTokenInput.value.trim();
    const todoistToken = todoistTokenInput.value.trim();

    let settingsToSave = {};
    // Only update the values if the user actually entered something new
    if (discogsToken) settingsToSave.discogsToken = discogsToken;
    if (todoistToken) settingsToSave.todoistToken = todoistToken;

    if (Object.keys(settingsToSave).length > 0) {
      chrome.storage.local.set(settingsToSave, () => {
        statusEl.textContent = '✓ Saved!';
        if (discogsToken) {
            discogsTokenInput.value = '';
            discogsTokenInput.placeholder = "Saved (••••••••••••••••)";
        }
        if (todoistToken) {
            todoistTokenInput.value = '';
            todoistTokenInput.placeholder = "Saved (••••••••••••••••)";
        }
        setTimeout(() => statusEl.textContent = '', 2500);
      });
    } else {
        statusEl.textContent = 'No new tokens entered.';
        setTimeout(() => statusEl.textContent = '', 2500);
    }
  });
});
