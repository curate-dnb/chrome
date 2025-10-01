const CACHE_KEY = 'discogs_release_cache_v1';
const LABELS_KEY = "discogs_labels_v1";
const QUEUE_KEY = 'discogs_label_queue_v1';
const TODOIST_CACHE_KEY = 'todoist_ids_cache_v1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchDiscogsAPI(endpoint) { /* Unchanged */ }
async function getLabelDetails(labelId) { /* Unchanged */ }
async function getAllLabelReleases(labelId) { /* Unchanged */ }
async function getReleaseDetails(releaseId) { /* Unchanged */ }
// Unchanged helper functions
async function fetchDiscogsAPI(endpoint){const{discogsToken:e}=await chrome.storage.local.get("discogsToken");if(!e)throw new Error("Discogs Personal Access Token is not set.");const t=`https://api.discogs.com${endpoint}`,s=await fetch(t,{headers:{Authorization:`Discogs token=${e}`,"User-Agent":"CurateWatchlistExtension/1.0"}});if(!s.ok){if(429===s.status)throw new Error("429");throw console.error("Discogs API Error:",s.status,await s.text()),new Error(`API request failed: ${s.status}.`)}return s.json()}async function getLabelDetails(e){return await fetchDiscogsAPI(`/labels/${e}`)}async function getAllLabelReleases(e){let t=1,s=[];for(;;){await sleep(1100);const l=await fetchDiscogsAPI(`/labels/${e}/releases?page=${t}&per_page=100&sort=year&sort_order=desc`);if(s.push(...l.releases||[]),l.pagination&&l.pagination.page<l.pagination.pages)t++;else break}return s.map(e=>e.id)}async function getReleaseDetails(e){const t=await chrome.storage.local.get(CACHE_KEY),s=t[CACHE_KEY]||{};if(s[e])return{...s[e],fromCache:!0};await sleep(1100);const l=await fetchDiscogsAPI(`/releases/${e}`),a={...s,[e]:l};return await chrome.storage.local.set({[CACHE_KEY]:a}),{...l,fromCache:!1}}

// --- NEW TODOIST LOGIC ---

// Helper to make authenticated Todoist API calls
async function fetchTodoistAPI(endpoint) {
    const { todoistToken } = await chrome.storage.local.get('todoistToken');
    if (!todoistToken) throw new Error('Todoist API Token is not set.');

    const response = await fetch(`https://api.todoist.com/rest/v2/${endpoint}`, {
        headers: { 'Authorization': `Bearer ${todoistToken}` }
    });
    if (!response.ok) throw new Error('Todoist API request failed.');
    return response.json();
}

// Fetches and caches the necessary Project and Section IDs from Todoist
async function getTodoistIds() {
    const storage = await chrome.storage.local.get(TODOIST_CACHE_KEY);
    const cache = storage[TODOIST_CACHE_KEY];
    // Use cached IDs if they exist and are less than an hour old
    if (cache && (Date.now() - cache.timestamp < 3600000)) {
        return cache;
    }

    // Fetch all projects and sections
    const [projects, sections] = await Promise.all([
        fetchTodoistAPI('projects'),
        fetchTodoistAPI('sections')
    ]);

    const targetProject = projects.find(p => p.name === "02 | curate");
    if (!targetProject) throw new Error("Could not find Todoist project named '02 | curate'.");

    const targetSection = sections.find(s => s.name === "listen" && s.project_id === targetProject.id);
    if (!targetSection) throw new Error(`Could not find section named 'listen' in project '02 | curate'.`);

    const newCache = {
        projectId: targetProject.id,
        sectionId: targetSection.id,
        timestamp: Date.now()
    };
    await chrome.storage.local.set({ [TODOIST_CACHE_KEY]: newCache });
    return newCache;
}

// Creates the task using the correct Project and Section IDs
async function createTodoistTask(release) {
    const { todoistToken } = await chrome.storage.local.get('todoistToken');
    if (!todoistToken) throw new Error('Todoist API Token is not set.');

    const { projectId, sectionId } = await getTodoistIds();

    const artistName = (release.artists || []).map(a => a.name.replace(/\s\(\d+\)/g, '')).join(', ');
    const taskContent = `${release.title} - ${artistName} @p-curate @spotify`.toLowerCase();

    const response = await fetch('https://api.todoist.com/rest/v2/tasks', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${todoistToken}`,
            'X-Request-Id': crypto.randomUUID() // Recommended by Todoist API
        },
        body: JSON.stringify({
            content: taskContent.toLowerCase(),
            project_id: projectId,
            section_id: sectionId
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("Todoist API Error:", errorText);
        throw new Error('Failed to create Todoist task.');
    }
    return response.json();
}


// --- MAIN MESSAGE LISTENER ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'CREATE_TODOIST_TASK') {
        (async () => {
            try {
                await createTodoistTask(request.release);

                const { [CACHE_KEY]: cache = {} } = await chrome.storage.local.get(CACHE_KEY);
                if (cache[request.release.id]) {
                    cache[request.release.id].status = 'to listen';
                    await chrome.storage.local.set({ [CACHE_KEY]: cache });
                }
                sendResponse({ success: true });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    // ... (other handlers are unchanged)
    else if (request.type === 'PROCESS_LABEL_QUEUE') {
        const tabId = sender.tab.id;
        (async () => {
            const queue = request.queue;
            const { [LABELS_KEY]: completedLabels = [] } = await chrome.storage.local.get(LABELS_KEY);
            for (let i = 0; i < queue.length; i++) {
                const label = queue[i];
                try {
                    chrome.tabs.sendMessage(tabId, { type: 'BUILD_PROGRESS', data: { message: `Processing label ${i + 1} of ${queue.length}: ${label.name}`, overallProgress: { current: i, total: queue.length } } });
                    const allReleaseIds = await getAllLabelReleases(label.id);
                    for (let j = 0; j < allReleaseIds.length; j++) {
                        const releaseId = allReleaseIds[j];
                        try {
                            await getReleaseDetails(releaseId);
                            const currentOverall = i + ((j + 1) / allReleaseIds.length);
                            chrome.tabs.sendMessage(tabId, { type: 'BUILD_PROGRESS', data: { message: `[${label.name}] Fetching details for release...`, progress: { current: j + 1, total: allReleaseIds.length }, overallProgress: { current: currentOverall, total: queue.length } } });
                        } catch (e) {
                            if (e.message.includes("429")) {
                                chrome.tabs.sendMessage(tabId, { type: 'BUILD_PAUSED' });
                                await sleep(60000); j--; continue;
                            } else { console.error(`Failed on release ${releaseId}:`, e); }
                        }
                    }
                    if (!completedLabels.some(l => l.id === label.id)) { completedLabels.push(label); }
                } catch (error) { chrome.tabs.sendMessage(tabId, { type: 'BUILD_ERROR', data: { message: `Failed on label ${label.name}: ${error.message}` }}); }
            }
            await chrome.storage.local.set({ [LABELS_KEY]: completedLabels });
            chrome.tabs.sendMessage(tabId, { type: 'BUILD_COMPLETE', data: { message: `Finished processing all ${queue.length} labels in the queue.` }});
        })();
        return true;
    }
    else if (request.type === 'GET_LABEL_DETAILS') {
        getLabelDetails(request.labelId).then(data => sendResponse({ success: true, data })).catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
});
