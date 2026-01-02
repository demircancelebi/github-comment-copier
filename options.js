const DEFAULT_TEMPLATE = `a reviewer said this about the changes on {filePath} / on lines {lineNumbers}

{priority} - {title}

{body}

how can we address these concerns?`;

const SAMPLE_DATA = {
  filePath: 'apps/azalt/src/server/api/routers/inbox/methods.ts',
  lineNumbers: '+534 to +536',
  priority: 'P1',
  title: 'Use element schedules when gating inbox tasks',
  body: `showEntry is derived only from entryDueDateSpec / entryDueDay, which come from form-level defaults. With the new per-element schedules, a form can legitimately have no defaultSchedules but still have scheduled elements; in that case hasEntrySchedule stays false and needsInputFn drops the task entirely, so collectors never see due items (and reminders won't fire). Even when defaults exist, element-level overrides are ignored for overdue/due logic, which can misclassify tasks. Consider incorporating element schedules into hasEntrySchedule and the overdue/due checks.`,
  author: 'chatgpt-codex-connector',
  prUrl: 'https://github.com/org/repo/pull/123'
};

const templateTextarea = document.getElementById('template');
const saveButton = document.getElementById('save');
const resetButton = document.getElementById('reset');
const statusDiv = document.getElementById('status');
const previewDiv = document.getElementById('preview');

function applyTemplate(template, data) {
  let result = template;

  // Replace placeholders with data, handling missing values gracefully
  for (const [key, value] of Object.entries(data)) {
    const placeholder = `{${key}}`;
    result = result.split(placeholder).join(value || '');
  }

  // Clean up lines that only contain placeholder text that wasn't replaced
  // e.g., if priority is empty, remove "P1 - " pattern
  result = result
    .replace(/^\s*-\s*$/gm, '') // Remove lines that are just " - "
    .replace(/\n{3,}/g, '\n\n') // Collapse multiple newlines
    .trim();

  return result;
}

function updatePreview() {
  const template = templateTextarea.value;
  const preview = applyTemplate(template, SAMPLE_DATA);
  previewDiv.textContent = preview;
}

function showStatus(message, isError = false) {
  statusDiv.textContent = message;
  statusDiv.className = 'status ' + (isError ? 'error' : 'success');

  setTimeout(() => {
    statusDiv.className = 'status';
  }, 3000);
}

async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get(['template']);
    templateTextarea.value = result.template || DEFAULT_TEMPLATE;
    updatePreview();
  } catch (err) {
    console.error('Failed to load settings:', err);
    templateTextarea.value = DEFAULT_TEMPLATE;
    updatePreview();
  }
}

async function saveSettings() {
  try {
    await chrome.storage.sync.set({
      template: templateTextarea.value
    });
    showStatus('Settings saved successfully!');
  } catch (err) {
    console.error('Failed to save settings:', err);
    showStatus('Failed to save settings. Please try again.', true);
  }
}

function resetToDefault() {
  templateTextarea.value = DEFAULT_TEMPLATE;
  updatePreview();
  showStatus('Template reset to default. Click Save to apply.');
}

function insertPlaceholder(placeholder) {
  const start = templateTextarea.selectionStart;
  const end = templateTextarea.selectionEnd;
  const text = templateTextarea.value;

  templateTextarea.value = text.substring(0, start) + placeholder + text.substring(end);
  templateTextarea.selectionStart = templateTextarea.selectionEnd = start + placeholder.length;
  templateTextarea.focus();
  updatePreview();
}

// Event listeners
saveButton.addEventListener('click', saveSettings);
resetButton.addEventListener('click', resetToDefault);
templateTextarea.addEventListener('input', updatePreview);

// Placeholder tag clicks
document.querySelectorAll('.placeholder-tag').forEach(tag => {
  tag.addEventListener('click', () => {
    const placeholder = tag.getAttribute('data-placeholder');
    insertPlaceholder(placeholder);
  });
});

// Load settings on page load
loadSettings();
