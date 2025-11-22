// app.js — Modular VK + Namy.ws extractor with robust Namy.ws parsing

export async function fetchWithFallback(url, asText = false, useProxy = true, headers = {}) {
    try {
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return asText ? res.text() : res.json();
    } catch (errDirect) {
        if (!useProxy) throw errDirect;
        // corsproxy.io
        try {
            const p = 'https://corsproxy.io/?' + new URLSearchParams({ url });
            const res2 = await fetch(p, { headers });
            if (!res2.ok) throw new Error('Proxy1 HTTP ' + res2.status);
            return asText ? res2.text() : res2.json();
        } catch (errProxy1) {
            const encoded = encodeURIComponent(url);
            const p2 = 'https://api.allorigins.win/raw?url=' + encoded;
            const res3 = await fetch(p2, { headers });
            if (!res3.ok) throw new Error('Proxy2 HTTP ' + res3.status);
            return asText ? res3.text() : res3.json();
        }
    }
}

export async function fetchTextWithFallback(url, useProxy = true) {
    const headers = { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://namy.ws/' };
    return fetchWithFallback(url, true, useProxy, headers);
}

// Extract Namy.ws sources (robust parsing)
export async function extractFromNamy(imdbId, useProxy = true) {
    const url = `https://api.namy.ws/embed/imdb/${imdbId}`;
    const html = await fetchTextWithFallback(url, useProxy);

    const mkMatch = html.match(/<script[^>]*data-name=["']mk["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!mkMatch) throw new Error('mk script not found');

    const objMatch = mkMatch[1].match(/makePlayer\s*\(\s*([\s\S]*?)\s*\)\s*;?/);
    if (!objMatch) throw new Error('makePlayer object not found');

    let obj;
    try {
        // تنظيف نص JS قبل تحويله لكائن
        let str = objMatch[1]
            .replace(/\r?\n|\r/g, '') // إزالة أسطر جديدة
            .replace(/,(\s*[}\]])/g, '$1') // إزالة الفواصل الأخيرة
            .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":'); // اقتباس المفاتيح
        obj = new Function('return ' + str)();
    } catch (e) {
        throw new Error('Failed to parse makePlayer object: ' + e.message);
    }

    const dash = obj?.source?.dasha || obj?.source?.dash || null;
    const hls  = obj?.source?.hls || obj?.source?.hlsUrl || null;
    const cc   = obj?.source?.cc || [];

    return {
        sourceName: 'Namy.ws',
        vkId: null,
        studio: null,
        hls,
        dash,
        cc
    };
}

// Extract VK items
export async function extractVKItems(kpId, useProxy = true) {
    const playlistUrl = `https://plapi.cdnvideohub.com/api/v1/player/sv/playlist?pub=12&aggr=kp&id=${kpId}`;
    const playlistData = await fetchWithFallback(playlistUrl, false, useProxy);
    const items = playlistData?.items || playlistData?.data?.items || [];
    const combined = [];

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
                hls,
                dash,
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
}

// Main extractor
export async function extractForImdb(imdbId, useProxy = true) {
    const allohaUrl = `https://api.alloha.tv/?token=d317441359e505c343c2063edc97e7&imdb=${imdbId}`;
    const allohaData = await fetchWithFallback(allohaUrl, false, useProxy);
    const kpId = allohaData?.data?.id_kp || allohaData?.id_kp || allohaData?.kinopoisk_id;
    if (!kpId) throw new Error('Kinopoisk ID not found');

    const vkItems = await extractVKItems(kpId, useProxy);

    let namyItem;
    try {
        namyItem = await extractFromNamy(imdbId, useProxy);
    } catch (err) {
        namyItem = { sourceName: 'Namy.ws', vkId: null, studio: null, hls: null, dash: null, cc: [], error: err.message };
    }

    return [...vkItems, namyItem];
}
