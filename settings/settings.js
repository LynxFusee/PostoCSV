const columnsBody = document.getElementById("columns");
const delimiterSelect = document.getElementById("delimiter");
const sortSelect = document.getElementById("sort");
const hostsText = document.getElementById("hosts");
const grantBtn = document.getElementById("grantBtn");
let missingOrigins = [];
// The columns as edited on the page; saved only when "Save" is clicked.
let columns = [];
let dragIndex = null;

const FIELD_LABELS = {
  platform: "Platform",
  postId: "Post ID",
  account: "Account",
  accountId: "Account ID",
  url: "URL",
  content: "Content",
  publishedAt: "Published At (UTC)",
  publishedDate: "Published Date (UTC)",
  capturedAt: "Captured At (UTC)",
  views: "Views",
  likes: "Likes",
  replies: "Replies",
  reposts: "Reposts",
  imageHashes: "Image Hashes",
  videoHashes: "Video Hashes",
  empty: "Empty column"
};

const SORT_LABELS = {
  captured: "Capture order",
  publishedAsc: "Publication date, oldest first",
  publishedDesc: "Publication date, newest first"
};

const DELIMITER_LABELS = { ",": "Comma (,)", ";": "Semicolon (;)", "\t": "Tab", "|": "Pipe (|)" };

function moveColumn(from, to) {
  if (to < 0 || to >= columns.length || to === from) return;
  const [column] = columns.splice(from, 1);
  columns.splice(to, 0, column);
  renderColumns();
}

// Only the handle starts a drag: a draggable row would stop text selection in its inputs.
// Arrow keys on the focused handle move the row too, for keyboard users.
function dragHandle(index, row) {
  const handle = document.createElement("button");
  handle.textContent = "⠿";
  handle.className = "handle";
  handle.draggable = true;
  handle.title = "Drag to reorder";
  handle.setAttribute("aria-label", `Column ${index + 1}: drag, or press up / down arrow, to reorder`);
  handle.addEventListener("dragstart", (event) => {
    dragIndex = index;
    // Firefox starts a drag only once some data is set.
    event.dataTransfer.setData("text/plain", String(index));
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setDragImage(row, 0, 0);
  });
  handle.addEventListener("dragend", () => (dragIndex = null));
  handle.addEventListener("keydown", (event) => {
    const to = { ArrowUp: index - 1, ArrowDown: index + 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    moveColumn(index, to);
    columnsBody.children[Math.max(0, Math.min(to, columns.length - 1))].querySelector(".handle").focus();
  });
  return handle;
}

function makeDropTarget(row, index) {
  row.addEventListener("dragover", (event) => {
    if (dragIndex === null) return;
    event.preventDefault();
    row.classList.add("drop-target");
  });
  row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    if (dragIndex !== null) moveColumn(dragIndex, index);
    dragIndex = null;
  });
}

function renderColumns() {
  columnsBody.replaceChildren();
  columns.forEach((column, index) => {
    const header = document.createElement("input");
    header.value = column.header;
    header.setAttribute("aria-label", `Column ${index + 1} title`);
    header.addEventListener("input", () => (column.header = header.value));

    const field = document.createElement("select");
    field.setAttribute("aria-label", `Column ${index + 1} data`);
    for (const name of CONFIG_FIELDS) field.add(new Option(FIELD_LABELS[name] ?? name, name));
    field.value = column.field;
    field.addEventListener("change", () => {
      // A title still matching the old data's name follows the new choice; a custom one is kept.
      if (column.header === (FIELD_LABELS[column.field] ?? column.field)) {
        column.header = header.value = FIELD_LABELS[field.value] ?? field.value;
      }
      column.field = field.value;
    });

    const remove = document.createElement("button");
    remove.textContent = "✕";
    remove.className = "remove";
    remove.setAttribute("aria-label", `Remove column ${index + 1}`);
    remove.addEventListener("click", () => {
      columns.splice(index, 1);
      renderColumns();
    });
    const actions = document.createElement("td");
    actions.className = "row-actions";
    actions.append(remove);

    const row = document.createElement("tr");
    const handleCell = document.createElement("td");
    handleCell.className = "row-actions";
    handleCell.append(dragHandle(index, row));
    row.append(handleCell);
    makeDropTarget(row, index);
    for (const input of [header, field]) {
      const cell = document.createElement("td");
      cell.append(input);
      row.append(cell);
    }
    row.append(actions);
    columnsBody.append(row);
  });
}

function onAddColumn() {
  columns.push({ field: "content", header: FIELD_LABELS.content });
  renderColumns();
  columnsBody.lastChild.querySelector("select").focus();
}

function showStatus(message, isError = false) {
  const statusEl = document.getElementById("status");
  statusEl.textContent = message;
  statusEl.className = isError ? "error" : "success";
}

async function checkPermissions(config) {
  const origins = hostOrigins(config.mastodonHosts);
  missingOrigins = [];
  for (const origin of origins) {
    if (!(await browser.permissions.contains({ origins: [origin] }))) missingOrigins.push(origin);
  }
  grantBtn.classList.toggle("hidden", missingOrigins.length === 0);
}

async function refresh() {
  const config = await loadConfig();
  columns = config.csv.columns.map((c) => ({ header: c.header ?? c.field, field: c.field }));
  renderColumns();
  delimiterSelect.value = config.csv.delimiter ?? ",";
  sortSelect.value = config.csv.sort ?? "captured";
  hostsText.value = (config.mastodonHosts ?? []).join("\n");
  await checkPermissions(config);
}

async function saveConfig(raw) {
  const config = validateConfig(raw);
  await browser.storage.local.set({ config });
  await refresh();
  showStatus(
    missingOrigins.length > 0
      ? "Config saved. Click \"Grant access to Mastodon hosts\" to enable the new hosts."
      : "Config saved."
  );
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }
}

async function onSave() {
  await saveConfig({
    mastodonHosts: hostsText.value.split(/\s+/).filter(Boolean),
    csv: { delimiter: delimiterSelect.value, sort: sortSelect.value, columns }
  });
}

async function onImport(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  await saveConfig(parseJson(await file.text()));
}

async function onExport() {
  const config = await loadConfig();
  const blob = new Blob([JSON.stringify(config, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "postocsv-config.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function onReset() {
  await browser.storage.local.remove("config");
  await refresh();
  showStatus("Default config restored.");
}

// Not async and not wrapped in guard(): permissions.request must be called directly
// in the click handler, or Firefox refuses it as not coming from a user action.
function onGrant() {
  browser.permissions
    .request({ origins: missingOrigins })
    .then(async (granted) => {
      await refresh();
      showStatus(granted ? "Access granted." : "Access refused.", !granted);
    })
    .catch((e) => showStatus(`Error: ${e.message}`, true));
}

function guard(fn) {
  return (event) => fn(event).catch((e) => showStatus(`Error: ${e.message}`, true));
}

for (const delimiter of CONFIG_DELIMITERS) delimiterSelect.add(new Option(DELIMITER_LABELS[delimiter], delimiter));
for (const sort of CONFIG_SORTS) sortSelect.add(new Option(SORT_LABELS[sort], sort));
document.getElementById("addBtn").addEventListener("click", onAddColumn);
document.getElementById("saveBtn").addEventListener("click", guard(onSave));
document.getElementById("importFile").addEventListener("change", guard(onImport));
document.getElementById("exportBtn").addEventListener("click", guard(onExport));
document.getElementById("resetBtn").addEventListener("click", guard(onReset));
grantBtn.addEventListener("click", onGrant);
refresh().catch((e) => showStatus(`Error: ${e.message}`, true));
