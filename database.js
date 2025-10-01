const CACHE_KEY = 'discogs_release_cache_v1';
const LABELS_KEY = "discogs_labels_v1";
const QUEUE_KEY = 'discogs_label_queue_v1';
const $ = s => document.querySelector(s);

let state = {
    queue: [],
    importedLabels: [],
    isProcessing: false,
};

let selectedCsvFile = null;

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

function setImportStatus(message, isError = false) {
    const el = $('#importStatus');
    if (!el) return;
    el.textContent = message || '';
    if (isError) {
        el.classList.add('error');
    } else {
        el.classList.remove('error');
    }
}

function csvTextToRows(text) {
    const rows = [];
    let currentRow = [];
    let currentValue = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inQuotes) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    currentValue += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                currentValue += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            currentRow.push(currentValue);
            currentValue = '';
        } else if (char === '\r') {
            continue;
        } else if (char === '\n') {
            currentRow.push(currentValue);
            rows.push(currentRow);
            currentRow = [];
            currentValue = '';
        } else {
            currentValue += char;
        }
    }

    currentRow.push(currentValue);
    rows.push(currentRow);

    return rows.filter(row => row.some(cell => (cell || '').trim() !== ''));
}

function parseCellValue(rawValue) {
    if (rawValue === undefined || rawValue === null) return undefined;
    const trimmed = String(rawValue).trim();
    if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') return undefined;
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            return JSON.parse(trimmed);
        } catch (error) {
            console.warn('Failed to parse JSON cell value', trimmed, error);
        }
    }
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
        const num = Number(trimmed);
        if (!Number.isNaN(num)) return num;
    }
    return trimmed;
}

function splitListString(value) {
    return value.split(/\s*(?:\|\||\||;|,|\n|\r)\s*/).map(part => part.trim()).filter(Boolean);
}

function ensureNamedObjects(value, key) {
    if (value === undefined || value === null || value === '') return [];
    if (Array.isArray(value)) {
        return value.map(item => {
            if (typeof item === 'string') {
                const name = item.trim();
                return name ? { [key]: name } : null;
            }
            if (item && typeof item === 'object') {
                const copy = { ...item };
                if (!copy[key]) {
                    const fallback = copy.name || copy.title || copy.label;
                    if (fallback) copy[key] = fallback;
                }
                return copy[key] ? copy : null;
            }
            return null;
        }).filter(Boolean);
    }
    if (typeof value === 'object') {
        const copy = { ...value };
        if (!copy[key]) {
            const fallback = copy.name || copy.title || copy.label;
            if (fallback) copy[key] = fallback;
        }
        return copy[key] ? [copy] : [];
    }
    if (typeof value === 'string') {
        return splitListString(value).map(name => ({ [key]: name }));
    }
    return [];
}

function normalizeTrackItem(item) {
    if (!item) return null;
    if (typeof item === 'string') {
        const trimmed = item.trim();
        if (!trimmed) return null;
        const parts = trimmed.split(/\s*::\s*/);
        if (parts.length === 2) {
            const [title, duration] = parts;
            return title ? { title: title.trim(), duration: duration.trim() } : null;
        }
        const dashMatch = trimmed.match(/^(.*)\s+-\s+(\d{1,2}:\d{2}(?::\d{2})?)$/);
        if (dashMatch) {
            const [, titlePart, durationPart] = dashMatch;
            const cleanTitle = titlePart.trim();
            if (cleanTitle) {
                return { title: cleanTitle, duration: durationPart.trim() };
            }
        }
        const parenMatch = trimmed.match(/^(.*?)(?:\s*\(([^)]+)\))?$/);
        if (parenMatch) {
            const title = (parenMatch[1] || '').trim();
            const duration = (parenMatch[2] || '').trim();
            if (!title) return null;
            const track = { title };
            if (duration) track.duration = duration;
            return track;
        }
        return { title: trimmed };
    }
    if (typeof item === 'object') {
        const copy = { ...item };
        if (!copy.title) {
            if (copy.name) {
                copy.title = copy.name;
                delete copy.name;
            } else if (copy.track) {
                copy.title = copy.track;
            }
        }
        if (!copy.duration && copy.length) {
            copy.duration = copy.length;
        }
        return copy.title ? copy : null;
    }
    return null;
}

function parseTracklist(rawValue) {
    const parsed = parseCellValue(rawValue);
    if (parsed === undefined || parsed === null) return [];
    if (Array.isArray(parsed)) {
        return parsed.map(normalizeTrackItem).filter(Boolean);
    }
    if (typeof parsed === 'object') {
        const normalized = normalizeTrackItem(parsed);
        return normalized ? [normalized] : [];
    }
    if (typeof parsed === 'string') {
        const segments = parsed.split(/\s*(?:\|\||;|\n|\r)\s*/).filter(Boolean);
        const parts = segments.length ? segments : [parsed];
        return parts.map(normalizeTrackItem).filter(Boolean);
    }
    return [];
}

function parseSimpleList(rawValue) {
    const parsed = parseCellValue(rawValue);
    if (parsed === undefined || parsed === null) return [];
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === 'string') return splitListString(parsed);
    return [parsed];
}

function parseArtists(rawValue) {
    const parsed = parseCellValue(rawValue);
    return ensureNamedObjects(parsed, 'name');
}

function parseLabels(rawValue, fallbackCatno) {
    const parsed = parseCellValue(rawValue);
    const labels = ensureNamedObjects(parsed, 'name').map(label => {
        const copy = { ...label };
        if (!copy.catno && copy.catalog_number) {
            copy.catno = copy.catalog_number;
        }
        return copy;
    });
    if (labels.length && fallbackCatno && !labels[0].catno) {
        labels[0].catno = fallbackCatno;
    }
    return labels;
}

function toCamelCase(key) {
    return key
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+(.)/g, (_, chr) => (chr ? chr.toUpperCase() : ''));
}

function normalizeReleaseRecord(record) {
    if (!record) return null;
    const keyMap = {};
    Object.keys(record).forEach(key => {
        keyMap[key.toLowerCase()] = key;
    });

    const consumed = new Set();
    const release = {};

    function consume(key) {
        if (key) consumed.add(key);
    }

    function readValue(names, targetKey, parser) {
        const options = Array.isArray(names) ? names : [names];
        for (const option of options) {
            const actualKey = keyMap[option];
            if (!actualKey) continue;
            const value = parser ? parser(record[actualKey]) : parseCellValue(record[actualKey]);
            consume(actualKey);
            if (value !== undefined && value !== null && value !== '') {
                release[targetKey] = value;
                return true;
            }
        }
        return false;
    }

    if (!readValue(['id', 'release_id', 'discogs_id'], 'id', raw => {
        const value = parseCellValue(raw);
        if (value === undefined || value === null || value === '') return undefined;
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        const numeric = Number(String(value).trim());
        if (!Number.isNaN(numeric)) return numeric;
        return String(value).trim();
    })) {
        return null;
    }

    readValue('title', 'title');
    readValue(['released', 'release_date'], 'released');
    readValue('year', 'year');
    readValue('status', 'status');
    readValue(['uri', 'url'], 'uri');
    readValue('resource_url', 'resource_url');
    readValue(['thumb', 'thumbnail', 'cover_image', 'image'], 'thumb');
    readValue(['country'], 'country');
    readValue(['notes', 'comment'], 'notes');
    readValue('formats', 'formats');
    if (!release.formats) {
        readValue('format', 'format');
    }
    readValue(['catno', 'catalog_number', 'catalogue_number'], 'catno');

    const artistsKey = keyMap.artists || keyMap.artist || keyMap['artist_name'] || keyMap['artists_name'];
    if (artistsKey) {
        release.artists = parseArtists(record[artistsKey]);
        consume(artistsKey);
    }

    const labelsKey = keyMap.labels || keyMap.label || keyMap['label_name'];
    if (labelsKey) {
        release.labels = parseLabels(record[labelsKey], release.catno);
        consume(labelsKey);
    }

    const tracklistKey = keyMap.tracklist || keyMap.tracks || keyMap['track_titles'] || keyMap['track_names'];
    if (tracklistKey) {
        release.tracklist = parseTracklist(record[tracklistKey]);
        consume(tracklistKey);
    }

    const genresKey = keyMap.genres || keyMap.genre || keyMap['genre_list'];
    if (genresKey) {
        release.genres = parseSimpleList(record[genresKey]);
        consume(genresKey);
    }

    const stylesKey = keyMap.styles || keyMap.style || keyMap['style_list'];
    if (stylesKey) {
        release.styles = parseSimpleList(record[stylesKey]);
        consume(stylesKey);
    }

    Object.entries(record).forEach(([key, value]) => {
        if (consumed.has(key)) return;
        const camelKey = toCamelCase(key);
        if (!camelKey || camelKey === 'id') return;
        if (release[camelKey] !== undefined) return;
        const parsed = parseCellValue(value);
        if (parsed === undefined || parsed === null || parsed === '') return;
        release[camelKey] = parsed;
    });

    if (!Array.isArray(release.artists)) release.artists = [];
    if (!Array.isArray(release.labels)) release.labels = [];
    if (!Array.isArray(release.tracklist)) release.tracklist = [];

    if (release.formats) {
        if (Array.isArray(release.formats)) {
            release.formats = release.formats.map(format => {
                if (typeof format === 'string') {
                    const name = format.trim();
                    if (!name) return null;
                    return { name, descriptions: [name] };
                }
                if (format && typeof format === 'object') {
                    const copy = { ...format };
                    if (!copy.descriptions && copy.name) {
                        copy.descriptions = [copy.name];
                    }
                    return copy;
                }
                return null;
            }).filter(Boolean);
        } else if (typeof release.formats === 'string') {
            const formatsList = splitListString(release.formats);
            release.formats = formatsList.map(name => ({ name, descriptions: [name] }));
        } else {
            release.formats = [];
        }
    } else {
        release.formats = [];
    }

    if (!release.formats.length && release.format) {
        const singleFormats = Array.isArray(release.format) ? release.format : splitListString(String(release.format));
        release.formats = singleFormats.map(name => ({ name, descriptions: [name] }));
    }

    if (release.year !== undefined && release.year !== null) {
        const yearNumber = Number(release.year);
        if (!Number.isNaN(yearNumber)) release.year = yearNumber;
    }

    if (typeof release.released === 'number') {
        release.released = String(release.released);
    }

    if (!release.status) {
        release.status = 'imported';
    }

    return release;
}

function parseCsv(text) {
    const rows = csvTextToRows(text);
    if (!rows.length) return [];
    const headerRow = rows.shift().map(cell => cell.replace(/^\ufeff/, '').trim());
    const releases = [];

    rows.forEach(row => {
        if (!row || row.every(cell => !cell || !cell.trim())) return;
        const record = {};
        headerRow.forEach((header, index) => {
            record[header] = row[index] !== undefined ? row[index] : '';
        });
        const normalized = normalizeReleaseRecord(record);
        if (normalized) releases.push(normalized);
    });

    return releases;
}

function handleCsvSelection(event) {
    const files = event && event.target && event.target.files ? Array.from(event.target.files) : [];
    selectedCsvFile = files.length ? files[0] : null;
    if (selectedCsvFile) {
        const size = selectedCsvFile.size ? ` (${selectedCsvFile.size.toLocaleString()} bytes)` : '';
        setImportStatus(`Selected ${selectedCsvFile.name}${size}.`);
    } else {
        setImportStatus('No file selected.');
    }
}

async function importCsvData() {
    if (!selectedCsvFile) {
        setImportStatus('Please choose a CSV file to import.', true);
        return;
    }

    try {
        setImportStatus(`Reading ${selectedCsvFile.name}...`);
        const text = await selectedCsvFile.text();
        const releases = parseCsv(text);
        if (!releases.length) {
            setImportStatus('No releases were found in the selected CSV file.', true);
            return;
        }

        const storage = await chrome.storage.local.get(CACHE_KEY);
        const existingCache = storage[CACHE_KEY] || {};
        const mergedCache = { ...existingCache };
        let added = 0;
        let updated = 0;

        releases.forEach(release => {
            const idKey = String(release.id);
            const normalizedRelease = {
                ...release,
                id: Number.isFinite(Number(idKey)) ? Number(idKey) : idKey
            };
            if (mergedCache[idKey]) {
                const previous = mergedCache[idKey];
                const status = release.status || previous.status;
                mergedCache[idKey] = { ...previous, ...normalizedRelease, status };
                updated++;
            } else {
                mergedCache[idKey] = normalizedRelease;
                added++;
            }
        });

        await chrome.storage.local.set({ [CACHE_KEY]: mergedCache });
        setImportStatus(`Imported ${releases.length} releases (${added} new, ${updated} updated).`);
        await loadInitialData();
        selectedCsvFile = null;
        if (csvInputEl) {
            csvInputEl.value = '';
        }
    } catch (error) {
        console.error('Failed to import CSV file', error);
        setImportStatus(`Error importing CSV: ${error.message}`, true);
    }
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

const csvInputEl = $('#csvFileInput');
const importCsvBtnEl = $('#importCsvBtn');
if (csvInputEl) csvInputEl.addEventListener('change', handleCsvSelection);
if (importCsvBtnEl) importCsvBtnEl.addEventListener('click', importCsvData);

$('#addToQueueBtn').addEventListener('click', addToQueueFromInput);
$('#processQueueBtn').addEventListener('click', processQueue);
$('#clearQueueBtn').addEventListener('click', clearQueue);
$('#findMissingBtn').addEventListener('click', findMissingData);

loadInitialData();
