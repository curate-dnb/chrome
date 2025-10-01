const CACHE_KEY = 'discogs_release_cache_v1';
const DOB = new Date(1997, 2, 11);
const PAGE_SIZE = 100;

/***** STATE *****/
let state = {
  items: [],
  currentPage: 1,
  filterQuery: '',
  sortState: { key: 'date', direction: 'desc' }
};

/***** DOM UTIL & HELPERS *****/
const $ = s => document.querySelector(s);
const esc = s => (s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;","&gt;":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

function formatDate(dateString) {
    if (!dateString || dateString === '—') return '—';
    const parts = dateString.split('-');
    if (parts.length === 1 && /^\d{4}$/.test(parts[0])) return parts[0];
    try {
        const year = parts[0].slice(-2);
        const month = parts[1] || '01';
        const day = parts[2] || '01';
        return `${day} | ${month} | ${year}`;
    } catch (e) {
        return dateString;
    }
}

/***** SAFE TICKERS *****/
function tickClockSafe(){try{const d=new Date(),H=$("#clockH"),M=$("#clockM"),S=$("#clockS");if(H)H.textContent=String(d.getHours()).padStart(2,"0");if(M)M.textContent=String(d.getMinutes()).padStart(2,"0");if(S)S.textContent=String(d.getSeconds()).padStart(2,"0")}catch{}}
function tickAgeSafe(){try{const years=(Date.now()-DOB)/(365.2425*24*3600*1000),A=$("#ageDec");if(A)A.textContent=years.toFixed(8)}catch{}}

async function loadFromDatabase() {
  const storage = await chrome.storage.local.get(CACHE_KEY);
  const cache = storage[CACHE_KEY] || {};
  state.items = Object.values(cache);
  renderResults();
}

/***** RENDER LOGIC *****/
function renderResults(){
    let processedItems = [...state.items];
    if (state.filterQuery) {
        const query = state.filterQuery.toLowerCase();
        processedItems = processedItems.filter(it => ((it.title||'').toLowerCase().includes(query) || (it.artists||[]).map(a=>a.name).join(' ').toLowerCase().includes(query) || ((it.labels||[])[0]?.name||'').toLowerCase().includes(query)));
    }

    const { key, direction } = state.sortState;
    processedItems.sort((a,b)=>{let t,s;const e=e=>(e||"").toString().toLowerCase();switch(key){case"date":const i=e=>Date.parse((e.released||`${e.year}-01-01`).replace(/-\d{2}-00$/,"-01-01").replace(/-\d{2}-00$/,"-01"));t=i(a),s=i(b);break;case"status":t=a.status||"z",s=b.status||"z";break;case"artist":t=(a.artists||[]).map(e=>e.name).join(" ").toLowerCase(),s=(b.artists||[]).map(e=>e.name).join(" ").toLowerCase();break;case"tracks":t=(a.tracklist||[]).length,s=(b.tracklist||[]).length;break;case"label":t=e((a.labels||[])[0]?.name),s=e((b.labels||[])[0]?.name);break;case"catno":t=e((a.labels||[])[0]?.catno),s=e((b.labels||[])[0]?.catno);break;default:t=e(a[key]),s=e(b[key])}return t<s?"asc"===direction?-1:1:t>s?"asc"===direction?1:-1:0});

    const totalItems = processedItems.length;
    const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
    state.currentPage = Math.max(1, Math.min(state.currentPage, totalPages));
    const start = (state.currentPage - 1) * PAGE_SIZE;
    const pageItems = processedItems.slice(start, start + PAGE_SIZE);

    const getSortIndicator = (colKey) => key === colKey ? (direction === 'asc' ? ' ▲' : ' ▼') : '';
    const rowsHTML = pageItems.map(it => {
        const artistChips = (it.artists || []).map(artist => `<span class="artist-chip">${esc(artist.name.replace(/\s\(\d+\)/g, ''))}</span>`).join('');
        const labelInfo = (it.labels || [])[0] || {};
        const cleanLabel = labelInfo.name ? labelInfo.name.replace(/\s\(\d+\)/g, '') : 'N/A';
        const catNo = labelInfo.catno || '—';
        const trackCount = (it.tracklist || []).length;
        let type = "Release";
        const format = ((it.formats || [])[0]?.descriptions?.join(' ') || "").toLowerCase();
        if (format.includes('album')) type = "LP"; else if (format.includes('ep')) type = "EP"; else if (format.includes('single')) type = "Single";
        const typeClass = `type-${type.toLowerCase()}`;

        let statusCell = '';
        if (it.status === 'to listen') {
          statusCell = `<button class="btn todoist-btn status-added" disabled title="Task already created">/</button>`;
        } else {
          statusCell = `<button class="btn todoist-btn" data-release-id="${it.id}" title="Add to Todoist">•</button>`;
        }
        let releaseUrl = (it.uri || '').trim();
        if (releaseUrl && !releaseUrl.startsWith('http')) { releaseUrl = `https://www.discogs.com${releaseUrl}`; }
        const artworkUrl = it.thumb || 'icon32.png';
        const formattedDate = formatDate(it.released || it.year);

        return `<tr><td class="artwork"><img src="${esc(artworkUrl)}" width="50" height="50" style="border-radius: 4px; display: block; border: 1px solid #262c34;" loading="lazy"></td><td class="date">${esc(formattedDate)}</td><td class="title"><a href="${esc(releaseUrl)}" target="_blank" rel="noopener">${esc(it.title)}</a></td><td class="artists">${artistChips||'<span class="artist-chip">Various Artists</span>'}</td><td class="status" style="text-align:center;">${statusCell}</td><td class="tracks" style="text-align:center;">${trackCount>0?trackCount:"—"}</td><td class="type"><span class="type-badge ${typeClass}">${esc(type)}</span></td><td class="catno">${esc(catNo)}</td><td class="label">${esc(cleanLabel)}</td></tr>`;
    }).join("");

    $("#results").innerHTML = `
      <table class="table">
        <thead><tr>
          <th style="width:70px;">Art</th>
          <th data-sort-key="date" style="width:150px; cursor:pointer;">Date${getSortIndicator('date')}</th>
          <th data-sort-key="title" style="cursor:pointer;">Title${getSortIndicator('title')}</th>
          <th data-sort-key="artist" style="min-width:200px; cursor:pointer;">Artist${getSortIndicator('artist')}</th>
          <th data-sort-key="status" style="width:80px; text-align:center; cursor:pointer;">Status${getSortIndicator('status')}</th>
          <th data-sort-key="tracks" style="width:70px; text-align:center; cursor:pointer;"># Tracks${getSortIndicator('tracks')}</th>
          <th data-sort-key="type" style="width:90px; cursor:pointer;">Type${getSortIndicator('type')}</th>
          <th data-sort-key="catno" style="width:120px; cursor:pointer;">Cat. #${getSortIndicator('catno')}</th>
          <th data-sort-key="label" style="width:140px; cursor:pointer;">Label${getSortIndicator('label')}</th>
        </tr></thead>
        <tbody>${rowsHTML || `<tr><td colspan="9" class="small">No matching releases found.</td></tr>`}</tbody>
      </table>`;

    const pager = $('.pager');
    if (totalPages > 1) {
        pager.style.display = 'flex';
        $('#pageInfo').textContent = `Page ${state.currentPage} of ${totalPages} (${totalItems} releases)`;
        $('#prevPage').disabled = state.currentPage === 1;
        $('#nextPage').disabled = state.currentPage >= totalPages;
    } else {
        pager.style.display = 'none';
        $('#pageInfo').textContent = `${totalItems} releases found.`;
    }
}

/***** BOOT & EVENT LISTENERS *****/
function boot(){
  tickClockSafe(); tickAgeSafe(); setInterval(tickClockSafe, 1000); setInterval(tickAgeSafe, 100);
  loadFromDatabase();

  $("#refreshBtn")?.addEventListener("click", loadFromDatabase);
  $("#manageDbBtn")?.addEventListener("click", () => chrome.tabs.create({ url: 'database.html' }));
  $("#filterInput")?.addEventListener('input', (e) => { state.filterQuery = e.target.value; state.currentPage = 1; renderResults(); });

  const resultsTable = $("#results");
  let loadingAnimationInterval = null;

  resultsTable.addEventListener('click', async (e) => {
    const header = e.target.closest('th[data-sort-key]');
    if (header) {
        const { sortKey } = header.dataset;
        if (state.sortState.key === sortKey) { state.sortState.direction = state.sortState.direction === 'asc' ? 'desc' : 'asc'; }
        else { state.sortState.key = sortKey; state.sortState.direction = ['date', 'tracks', 'year'].includes(sortKey) ? 'desc' : 'asc'; }
        state.currentPage = 1; renderResults(); return;
    }

    const todoistBtn = e.target.closest('.todoist-btn:not(.status-added)');
    if (todoistBtn) {
        clearInterval(loadingAnimationInterval);
        let dots = 1;
        todoistBtn.textContent = '.';
        loadingAnimationInterval = setInterval(() => {
            dots = (dots % 3) + 1;
            todoistBtn.textContent = '.'.repeat(dots);
        }, 300);

        todoistBtn.disabled = true;
        const releaseId = todoistBtn.dataset.releaseId;
        const release = state.items.find(item => item.id == releaseId);
        if (release) {
            const response = await chrome.runtime.sendMessage({ type: 'CREATE_TODOIST_TASK', release: release });
            clearInterval(loadingAnimationInterval);
            if (response.success) {
                const itemInState = state.items.find(item => item.id == releaseId);
                if (itemInState) itemInState.status = 'to listen';
                renderResults();
            } else {
                alert(`Error: ${response.error}`);
                todoistBtn.disabled = false;
                renderResults();
            }
        }
    }
  });

  resultsTable.addEventListener('mousedown', (e) => {
    const todoistBtn = e.target.closest('.todoist-btn:not(.status-added)');
    if (todoistBtn) { todoistBtn.textContent = '!'; }
  });
  resultsTable.addEventListener('mouseup', (e) => {
    const todoistBtn = e.target.closest('.todoist-btn:not(.status-added)');
    if (todoistBtn) { todoistBtn.textContent = '•'; }
  });
   resultsTable.addEventListener('mouseout', (e) => {
    const todoistBtn = e.target.closest('.todoist-btn:not(.status-added)');
    if (todoistBtn && (todoistBtn.textContent === '!' || todoistBtn.textContent.includes('.'))) { todoistBtn.textContent = '•'; }
  });

  $('#prevPage')?.addEventListener('click', () => { if (state.currentPage > 1) { state.currentPage--; renderResults(); }});
  $('#nextPage')?.addEventListener('click', () => {
      const filteredItems = state.items.filter(item => { if (!state.filterQuery) return true; const query = state.filterQuery.toLowerCase(); return (item.title||'').toLowerCase().includes(query) || ((item.artists||[]).map(a=>a.name).join(' ').toLowerCase()).includes(query); });
      const totalPages = Math.ceil(filteredItems.length / PAGE_SIZE);
      if (state.currentPage < totalPages) { state.currentPage++; renderResults(); }
  });
}
boot();
