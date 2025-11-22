// ------------------ UTILITIES ------------------

const startBtn = document.getElementById('startBtn');
const clearBtn = document.getElementById('clearBtn');
const copyBtn = document.getElementById('copyBtn');
const downloadBtn = document.getElementById('downloadBtn');
const resultsEl = document.getElementById('results');
const debugEl = document.getElementById('debug');
const statusEl = document.getElementById('status');
const useProxyCheckbox = document.getElementById('useProxy');

function setStatus(txt) {
  statusEl.innerHTML = '<small class="gray">' + txt + '</small>';
}

function logDebug(obj) {
  debugEl.textContent =
    typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
}

// ----- Fetch with fallback -----

async function fetchWithFallback(url, asText = false) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return asText ? res.text() : res.json();
  } catch (errDirect) {
    if (!useProxyCheckbox.checked) throw errDirect;

    try {
      const p = 'https://corsproxy.io/?' + new URLSearchParams({ url });
      const r = await fetch(p);
      if (!r.ok) throw new Error('proxy1 HTTP ' + r.status);
      return asText ? r.text() : r.json();
    } catch (errProxy1) {
      try {
        const enc = encodeURIComponent(url);
        const r2 = await fetch(
          'https://api.allorigins.win/raw?url=' + enc
        );
        if (!r2.ok) throw new Error('proxy2 HTTP ' + r2.status);
        return asText ? r2.text() : r2.json();
      } catch (errProxy2) {
        throw new Error(
          'Fetch failed: ' +
            errDirect.message +
            ' | ' +
            errProxy1.message +
            ' | ' +
            errProxy2.message
        );
      }
    }
  }
}

async function fetchTextWithFallback(url) {
  return fetchWithFallback(url, true);
}

// ----- Safe JS object → JSON -----

function jsObjectStringToJSON(str) {
  let s = str.trim();

  if (s.startsWith('makePlayer')) {
    const m = s.match(/makePlayer\s*\(\s*([\s\S]*)\)\s*;?\s*$/);
    if (m) s = m[1];
  }

  if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1);

  s = s.replace(
    /([{\s,])([A-Za-z0-9_@\$]+)\s*:/g,
    (m, pre, key) => `${pre}"${key}":`
  );

  s = s.replace(/'([^']*)'/g, (_, inner) =>
    `"${inner.replace(/"/g, '\\"')}"`
  );

  s = s.replace(/,(\s*[}\]])/g, '$1');

  return JSON.parse(s);
}

// ------------------ NAMY extractor ------------------

async function extractFromNamy(imdbId) {
  const url = `https://api.namy.ws/embed/imdb/${imdbId}`;
  setStatus('جلب namy.ws...');

  const html = await fetchTextWithFallback(url);

  const mkMatch = html.match(
    /<script[^>]*data-name=["']mk["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!mkMatch) throw new Error('mk script not found');

  const objMatch = mkMatch[1].match(
    /makePlayer\s*\(\s*([\s\S]*?)\s*\)\s*;?/
  );
  if (!objMatch) throw new Error('makePlayer object missing');

  const obj = jsObjectStringToJSON(objMatch[1]);

  return {
    sourceName: 'Namy.ws',
    studio: null,
    vkId: null,
    hls: obj?.source?.hls || null,
    dash: obj?.source?.dasha || obj?.source?.dash || null,
    cc: obj?.source?.cc || []
  };
}

// ------------------ MAIN extractor ------------------

async function extractForImdb(imdbId) {
  setStatus('بدأ ...');
  resultsEl.innerHTML = '';
  logDebug('starting...');

  // 1) get kpid from alloha
  setStatus('جلب Kinopoisk ID ...');
  const alloha = await fetchWithFallback(
    `https://api.alloha.tv/?token=d317441359e505c343c2063edc97e7&imdb=${imdbId}`
  );

  logDebug({ alloha });

  const kpId =
    alloha?.data?.id_kp || alloha?.id_kp || alloha?.kinopoisk_id;
  if (!kpId) throw new Error('Kinopoisk ID not found');

  // 2) playlist
  setStatus('جلب playlist ...');
  const playlist = await fetchWithFallback(
    `https://plapi.cdnvideohub.com/api/v1/player/sv/playlist?pub=12&aggr=kp&id=${kpId}`
  );

  logDebug({ playlist });

  const items =
    playlist?.items || playlist?.data?.items || playlist?.items || [];

  const combined = [];

  // 3) for each VK item
  setStatus('جلب بيانات الفيديو ...');

  for (const item of items) {
    const vkId = item?.vkId || item?.id || item?.cvhId;
    const studio = item?.voiceStudio || item?.studio || null;

    if (!vkId) continue;

    try {
      const video = await fetchWithFallback(
        `https://plapi.cdnvideohub.com/api/v1/player/sv/video/${vkId}`
      );

      logDebug({ video });

      const src = video?.sources || video?.data?.sources || {};

      combined.push({
        sourceName: 'VK',
        vkId,
        studio,
        hls: src.hlsUrl || src.hls || null,
        dash: src.dashUrl || src.dasha || src.dash || null,
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
        error: err.message
      });
    }
  }

  // 4) NAMY.WS
  try {
    combined.push(await extractFromNamy(imdbId));
  } catch (err) {
    combined.push({
      sourceName: 'Namy.ws',
      hls: null,
      dash: null,
      cc: [],
      error: err.message
    });
  }

  setStatus('تم الانتهاء');
  renderResults(combined);
  window.lastCombinedResult = combined;
}

// ------------------ RENDER ------------------

function renderResults(arr) {
  resultsEl.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'card';
  header.innerHTML = `<strong>Results (${arr.length})</strong>`;
  resultsEl.appendChild(header);

  arr.forEach(item => {
    const div = document.createElement('div');
    div.className = 'source';

    const t = document.createElement('div');
    t.className = 'title';
    t.textContent =
      'Source: ' +
      item.sourceName +
      (item.studio ? ' — Studio: ' + item.studio : '');
    div.appendChild(t);

    if (item.vkId) {
      div.innerHTML += `<small class="gray">vkId:</small> ${item.vkId}<br>`;
    }

    div.innerHTML +=
      `<small class="gray">HLS:</small> ` +
      (item.hls
        ? `<a class="link" target="_blank" href="${item.hls}">${item.hls}</a>`
        : '<em>Not found</em>') +
      '<br>';

    div.innerHTML +=
      `<small class="gray">DASH:</small> ` +
      (item.dash
        ? `<a class="link" target="_blank" href="${item.dash}">${item.dash}</a>`
        : '<em>Not found</em>');

    if (item.cc?.length) {
      div.innerHTML += `<div><small class="gray">Subtitles (CC):</small></div>`;
      const ul = document.createElement('ul');
      item.cc.forEach(c => {
        const li = document.createElement('li');
        li.innerHTML = `${c.name}: <a class="link" href="${c.url}" target="_blank">${c.url}</a>`;
        ul.appendChild(li);
      });
      div.appendChild(ul);
    }

    if (item.error) {
      div.innerHTML += `<br><small style="color:red">Error: ${item.error}</small>`;
    }

    resultsEl.appendChild(div);
  });
}

// ------------------ BUTTONS ------------------

startBtn.onclick = () => {
  const imdb = document.getElementById('imdb').value.trim();
  if (!imdb) return alert('Please enter IMDb ID');
  extractForImdb(imdb);
};

clearBtn.onclick = () => {
  document.getElementById('imdb').value = '';
  resultsEl.innerHTML = '';
  debugEl.textContent = '';
  setStatus('Cleared');
  window.lastCombinedResult = null;
};

copyBtn.onclick = () => {
  if (!window.lastCombinedResult) return alert('لا توجد نتائج');
  navigator.clipboard.writeText(
    JSON.stringify(window.lastCombinedResult, null, 2)
  );
  alert('Copied!');
};

downloadBtn.onclick = () => {
  if (!window.lastCombinedResult) return alert('لا توجد نتائج');
  const a = document.createElement('a');
  a.href =
    'data:text/json;charset=utf-8,' +
    encodeURIComponent(JSON.stringify(window.lastCombinedResult, null, 2));
  a.download = 'sources.json';
  a.click();
};
