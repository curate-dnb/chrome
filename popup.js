// Only allow adding when user is on a Beatport label *releases* page
const SLUGS_KEY = "bp_watchlist_slugs_single_v2";

/* storage */
async function getSlugs(){
  const o = await chrome.storage.local.get(SLUGS_KEY);
  return Array.isArray(o[SLUGS_KEY]) ? o[SLUGS_KEY] : [];
}
async function setSlugs(slugs){ await chrome.storage.local.set({ [SLUGS_KEY]: slugs }); }

/* strict: /label/<slug>/releases[/(id)]?[?page=X] */
function extractReleasesSlug(url){
  try{
    const u = new URL(url);
    if (!/^(?:www\.)?beatport\.com$/i.test(u.hostname)) return null;
    const path = u.pathname.replace(/\/+$/,"");
    const m = path.match(/^\/label\/([^\/?#]+)\/releases(?:\/\d+)?$/i);
    return m ? m[1].toLowerCase() : null;
  }catch{ return null; }
}

async function getActiveUrl(){
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  if (tab?.url) return tab.url;
  try{
    const [{result}] = await chrome.scripting.executeScript({target:{tabId:tab.id}, func:()=>location.href});
    return result || "";
  }catch{ return ""; }
}

function setStatus(msg){ document.getElementById("status").textContent = msg; }

async function addSlug(slug){
  const slugs = await getSlugs();
  if (!slugs.includes(slug)){
    slugs.push(slug); slugs.sort((a,b)=>a.localeCompare(b));
    await setSlugs(slugs);
    setStatus(`Added “${slug}” from /releases page. Open a new tab and press Refresh.`);
  }else{
    setStatus(`“${slug}” is already in your watchlist.`);
  }
}

/* events */
document.getElementById("addBtn").addEventListener("click", async ()=>{
  setStatus("Detecting label on /releases…");
  const slug = extractReleasesSlug(await getActiveUrl());
  if (!slug) return setStatus("You must be on a label’s /releases page.");
  addSlug(slug);
});

document.getElementById("addManualBtn").addEventListener("click", async ()=>{
  const input = document.getElementById("manualSlug");
  const slug = (input.value||"").trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(slug)) return setStatus("Invalid slug format.");
  // Manual add is allowed, but message reminds to use /releases when possible
  await addSlug(slug);
  input.value = "";
});

/* boot hint */
(async ()=>{
  try{
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    const slug = extractReleasesSlug(tab?.url||"");
    setStatus(slug ? `Detected (on /releases): ${slug}` : "Go to a label’s /releases page, then click Add.");
  }catch{}
})();
