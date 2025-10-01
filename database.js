const CACHE_KEY = 'discogs_release_cache_v1';
const LABELS_KEY = "discogs_labels_v1";
const QUEUE_KEY = 'discogs_label_queue_v1';
const $ = s => document.querySelector(s);

let state = {
    queue: [],
    importedLabels: [],
    isProcessing: false,
};

function setStatus(msg) { $('#statusText').textContent = msg; }
function setProgress(frac) { $('#progressBar').style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`; }
function setOverallProgress(frac) { $('#overallProgressBar').style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`; }
function setProgressCount(current, total) { $('#progressCount').textContent = (current && total) ? `${current} / ${total}` : ''; }

function renderQueue() {
    const queueList = $('#queue-list');
    const processBtn = $('#processQueueBtn');
    const clearBtn = $('#clearQueueBtn');
    if (state.queue.length === 0) {
        queueList.innerHTML = `<div class="small">Queue is empty.</div>`;
        processBtn.disabled = true;
        clearBtn.style.display = 'none';
    } else {
        queueList.innerHTML = state.queue.map(label => `<div class="queue-item">${label.name} (#${label.id})</div>`).join('');
        processBtn.disabled = false;
        clearBtn.style.display = 'inline-block';
    }
}

function renderImportedLabels() {
    const listEl = $('#imported-labels-list');
    if (state.importedLabels.length === 0) {
        listEl.innerHTML = `<div class="small">No labels have been fully imported yet.</div>`;
        return;
    }
    const sorted = [...state.importedLabels].sort((a, b) => a.name.localeCompare(b.name));
    listEl.innerHTML = sorted.map(l => `<div class="label-chip"><span class="slug">${l.name.replace(/\s\(\d+\)/g, '')}</span><span class="id">#${l.id}</span></div>`).join('');
}

async function loadInitialData() {
    const storage = await chrome.storage.local.get([QUEUE_KEY, LABELS_KEY]);
    state.queue = storage[QUEUE_KEY] || [];
    state.importedLabels = storage[LABELS_KEY] || [];
    renderQueue();
    renderImportedLabels();
}

async function addToQueueFromInput() {
    const input = $("#labelIdInput");
    const labelId = input.value.trim();
    if (!/^\d+$/.test(labelId)) return setStatus("Error: Please enter a valid numeric Label ID.");
    if (state.queue.some(l => l.id === labelId) || state.importedLabels.some(l => l.id === labelId)) {
        return setStatus(`Label ID ${labelId} is already in the queue or imported.`);
    }
    setStatus(`Verifying label ID ${labelId}...`);
    try {
        const response = await chrome.runtime.sendMessage({ type: "GET_LABEL_DETAILS", labelId: labelId });
        if (!response.success) throw new Error(response.error);
        const newLabel = { id: labelId, name: response.data.name };
        state.queue.push(newLabel);
        await chrome.storage.local.set({ [QUEUE_KEY]: state.queue });
        setStatus(`Added "${newLabel.name}" to the queue.`);
        input.value = "";
    } catch (e) {
        setStatus(`Error verifying label ID ${labelId}: ${e.message}`);
    }
}

function processQueue() {
    if (state.queue.length === 0) return;
    state.isProcessing = true;
    renderUI();
    setStatus(`Starting to process ${state.queue.length} labels...`);
    setProgress(0); setProgressCount(null, null); setOverallProgress(0);
    chrome.runtime.sendMessage({ type: 'PROCESS_LABEL_QUEUE', queue: state.queue });
    state.queue = [];
    chrome.storage.local.set({ [QUEUE_KEY]: [] });
}

async function clearQueue() {
    state.queue = [];
    await chrome.storage.local.set({ [QUEUE_KEY]: [] });
}

async function findMissingData() {
    setStatus('Scanning local database for incomplete releases...');
    setProgress(0); setProgressCount(null, null); setOverallProgress(0);
    const { [CACHE_KEY]: cache = {} } = await chrome.storage.local.get(CACHE_KEY);
    const incompleteReleases = Object.values(cache)
        .filter(release => !release.tracklist)
        .map(release => ({ id: release.id.toString(), name: `Release #${release.id}` }));

    if (incompleteReleases.length === 0) {
        setStatus('✓ No missing data found.');
        return;
    }
    setStatus(`Found ${incompleteReleases.length} releases with missing details. Starting fetch process...`);
    state.isProcessing = true;
    renderUI();
    chrome.runtime.sendMessage({ type: 'PROCESS_RELEASES_QUEUE', queue: incompleteReleases });
}

function renderUI() {
    $('#addToQueueBtn').disabled = state.isProcessing;
    $('#processQueueBtn').disabled = state.isProcessing || state.queue.length === 0;
    $('#clearQueueBtn').style.display = !state.isProcessing && state.queue.length > 0 ? 'inline-block' : 'none';
    $('#findMissingBtn').disabled = state.isProcessing;
    renderQueue();
    renderImportedLabels();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'BUILD_PROGRESS') {
        const { message, progress, overallProgress } = request.data;
        setStatus(message);
        if (progress) { setProgress(progress.current / progress.total); setProgressCount(progress.current, progress.total); }
        if (overallProgress) { setOverallProgress(overallProgress.current / overallProgress.total); }
    } else if (request.type === 'BUILD_COMPLETE' || request.type === 'BUILD_ERROR') {
        state.isProcessing = false;
        loadInitialData(); // Reload both queues and imported labels
        setStatus(request.data.message);
        setProgress(request.type === 'BUILD_COMPLETE' ? 1 : 0);
    }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (changes[QUEUE_KEY]) { state.queue = changes[QUEUE_KEY].newValue || []; renderUI(); }
    if (changes[LABELS_KEY]) { state.importedLabels = changes[LABELS_KEY].newValue || []; renderUI(); }
});

$('#addToQueueBtn').addEventListener('click', addToQueueFromInput);
$('#processQueueBtn').addEventListener('click', processQueue);
$('#clearQueueBtn').addEventListener('click', clearQueue);
$('#findMissingBtn').addEventListener('click', findMissingData);

loadInitialData();
