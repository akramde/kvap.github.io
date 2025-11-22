// app.js — VK + Namy.ws extractor جاهز

async function fetchWithFallback(url, asText = false, useProxy = true, headers = {}) {
try {
const res = await fetch(url, { headers });
if (!res.ok) throw new Error('HTTP ' + res.status);
return asText ? res.text() : res.json();
} catch (errDirect) {
if (!useProxy) throw errDirect;
try {
const p = '[https://corsproxy.io/](https://corsproxy.io/)?' + new URLSearchParams({ url });
const res2 = await fetch(p, { headers });
if (!res2.ok) throw new Error('Proxy1 HTTP ' + res2.status);
return asText ? res2.text() : res2.json();
} catch (errProxy1) {
const encoded = encodeURIComponent(url);
const p2 = '[https://api.allorigins.win/raw?url=](https://api.allorigins.win/raw?url=)' + encoded;
const res3 = await fetch(p2, { headers });
if (!res3.ok) throw new Error('Proxy2 HTTP ' + res3.status);
return asText ? res3.text() : res3.json();
}
}
}

async function fetchTextWithFallback(url, useProxy = true) {
const headers = { 'User-Agent': 'Mozilla/5.0', 'Referer': '[https://namy.ws/](https://namy.ws/)' };
return fetchWithFallback(url, true, useProxy, headers);
}

function safeEvalObj(str) {
try {
return new Function('return ' + str)();
} catch (e) {
throw new Error('safeEval failed: ' + e.message);
}
}

async function extractFromNamy(imdbId, useProxy = true) {
const url = `https://api.namy.ws/embed/imdb/${imdbId}`;
const html = await fetchTextWithFallback(url, useProxy);

```
const mkMatch = html.match(/<script[^>]*data-name=["']mk["'][^>]*>([\s\S]*?)<\/script>/i);
if (!mkMatch) throw new Error('mk script not found');

const objMatch = mkMatch[1].match(/makePlayer\s*\(\s*([\s\S]*?)\s*\)\s*;?/);
if (!objMatch) throw new Error('makePlayer object not found');

const obj = safeEvalObj(objMatch[1]);

const dash = obj?.source?.dasha || obj?.source?.dash || null;
const hls  = obj?.source?.hls || obj?.source?.hlsUrl || null;
const cc   = obj?.source?.cc || [];

return {
    sourceName: 'Namy.ws',
    vkId: null,
    studio: null,
    hls: hls ? String(hls) : null,
    dash: dash ? String(dash) : null,
    cc
};
```

}

async function extractVKItems(kpId, useProxy = true) {
const playlistUrl = `https://plapi.cdnvideohub.com/api/v1/player/sv/playlist?pub=12&aggr=kp&id=${kpId}`;
const playlistData = await fetchWithFallback(playlistUrl, false, useProxy);
const items = playlistData?.items || playlistData?.data?.items || [];
const combined = [];

```
for (const item of items) {
    const vkId = item?.vkId || item?.id || item?.cvhId;
    const studio = item?.voiceStudio || item?.studio || null;
    if (!vkId) continue;

    try {
        const videoUrl = `https://plapi.cdnvideohub.com/api/v1/player/sv/video/${vkId}`;
        const videoData = await fetchWithFallback(videoUrl, false, useProxy);
        const sources = videoData?.sources || videoData?.data?.sources || {};
        const hls = sources?.hlsUrl || sources?.hls || null;
        const dash = sources?.dashUrl || sources?.dasha || sources?.dash || null;

        combined.push({
            sourceName: 'VK',
            vkId,
            studio,
            hls: hls ? String(hls) : null,
            dash: dash ? String(dash) : null,
            cc: []
        });
    } catch (err) {
        combined.push({
            sourceName: 'VK',
            vkId,
            studio,
            hls: null,
            dash: null,
            cc: [],
            error: 'video fetch failed: ' + err.message
        });
    }
}
return combined;
```

}

async function extractForImdb(imdbId, useProxy = true) {
const allohaUrl = `https://api.alloha.tv/?token=d317441359e505c343c2063edc97e7&imdb=${imdbId}`;
const allohaData = await fetchWithFallback(allohaUrl, false, useProxy);
const kpId = allohaData?.data?.id_kp || allohaData?.id_kp || allohaData?.kinopoisk_id;
if (!kpId) throw new Error('Kinopoisk ID not found');

```
const vkItems = await extractVKItems(kpId, useProxy);

let namyItem;
try {
    namyItem = await extractFromNamy(imdbId, useProxy);
} catch (err) {
    namyItem = { sourceName: 'Namy.ws', vkId: null, studio: null, hls: null, dash: null, cc: [], error: err.message };
}

return [...vkItems, namyItem];
```

}

// Make available globally
window.extractForImdb = extractForImdb;
