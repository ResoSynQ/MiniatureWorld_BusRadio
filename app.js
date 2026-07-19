/**
 * オレンジゆずるバス・ナイトツアー Ver 5.0 (MapLibre GL版)
 * ============================================================
 * Leaflet から MapLibre GL + ベクタータイル(OpenFreeMap)へ全面移行。
 *  ・文字情報なしの自作ナイトスタイル(道路・建物・水面・緑地のみ)
 *  ・建物はOSM形状から3D押し出し(fill-extrusion)で立体表示
 *  ・カメラに傾き(pitch)を付けた斜め見下ろしの疑似3D
 *  ・追従カメラはイージング補間でふわっと滑らかにスクロール
 *  ・中間ズーム(18.5等)対応
 * データは route-data.js(xlsxから自動生成)にあります。
 * ============================================================
 */

// 🎨 テーマ: 'evening'(夕暮れ) / 'morning'(朝) / 'night'(夜)
// 右上の 🌗 ボタンで「夕方 ⇔ 朝」を切り替えられます
let THEME = ROUTE_CONFIG.theme || 'evening';
const NIGHT = true; // 演出レイヤー(環境光・霧など)は常時有効(テーマごとに色が変わります)
const LOCK  = !!ROUTE_CONFIG.lockZoom;
const ZOOM  = ROUTE_CONFIG.fixedZoom || 18.5;
const PITCH = (ROUTE_CONFIG.pitch !== undefined) ? ROUTE_CONFIG.pitch : 55;
const BEAR  = ROUTE_CONFIG.bearing || 0;

// ============ 📐 距離ユーティリティ（ハバサイン近似） ============
function distM(a, b) {
    const R = 6371000;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180 * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180);
    return R * Math.hypot(dLat, dLng);
}

// ============ 🛣️ ルート構築 ============
const routePoints = ROUTE_POINTS.map(p => ({
    lat: p.lat, lng: p.lng, name: p.name, isStop: p.category === 'busstop'
}));
routePoints.push({ ...routePoints[0], isStop: true }); // ループを閉じる

const cumDist = [0];
for (let i = 1; i < routePoints.length; i++) {
    cumDist.push(cumDist[i - 1] + distM(routePoints[i - 1], routePoints[i]));
}
const totalDist = cumDist[cumDist.length - 1];

function distToLatLng(d) {
    d = Math.min(Math.max(d, 0), totalDist);
    let lo = 0;
    while (lo < cumDist.length - 2 && cumDist[lo + 1] < d) lo++;
    const segLen = cumDist[lo + 1] - cumDist[lo];
    const r = segLen > 0 ? (d - cumDist[lo]) / segLen : 0;
    const p1 = routePoints[lo], p2 = routePoints[lo + 1];
    return { lat: p1.lat + (p2.lat - p1.lat) * r, lng: p1.lng + (p2.lng - p1.lng) * r };
}

// ============ 🌆 自作スタイル（文字なし・道路と建物中心） ============
// 夕暮れ: あかね色の空の光が残る、まちにあかりが灯りはじめる時間
function themePalette(theme) {
    if (theme === 'morning') return {
        // 🌅 朝: やわらかな朝日と、澄んだ空気のパステルカラー
        bg:        '#e6e3d6',
        wood:      '#9ec695', grass: '#b3d8a4', park: '#a4d29e', landuse: '#e0dacc',
        water:     '#a6c8e8', waterway: '#96bce2',
        roadMinor: '#ffffff', roadMid: '#faf3e4',
        roadMajorGlow: '#ffd9a0', roadMajor: '#f3c98a',
        rail:      '#c6bfae',
        bldLow: '#d3d5e2', bldMid: '#b9c2da', bldHigh: '#9db0d2',
        routeGlow: '#ffb35c', routeCore: '#ff6a2a'
    };
    if (theme === 'evening') return {
        bg:        '#4c3a55',
        wood:      '#3a4034', grass: '#485040', park: '#4f5a45', landuse: '#54415e',
        water:     '#6b5f92', waterway: '#75689e',
        roadMinor: '#6b5570', roadMid: '#7d6278',
        roadMajorGlow: '#ffae6e', roadMajor: '#96705f',
        rail:      '#5e4a68',
        bldLow: '#3b2e50', bldMid: '#55406b', bldHigh: '#6f5585',
        routeGlow: '#ff8a4a', routeCore: '#ffc27a'
    };
    return { // night
        bg:        '#141b38',
        wood:      '#132c22', grass: '#183830', park: '#1b4136', landuse: '#182044',
        water:     '#152a52', waterway: '#1d3560',
        roadMinor: '#262e54', roadMid: '#323e70',
        roadMajorGlow: '#6b5c96', roadMajor: '#4a4478',
        rail:      '#2b3157',
        bldLow: '#28305c', bldMid: '#3b477f', bldHigh: '#5061a5',
        routeGlow: '#ff9d5c', routeCore: '#ffc27a'
    };
}
let PAL = themePalette(THEME);

function buildStyle() {
    const roadClasses = {
        minor: ['minor', 'service', 'track', 'path', 'pedestrian', 'minor_construction'],
        mid:   ['tertiary', 'secondary'],
        major: ['primary', 'trunk', 'motorway']
    };
    return {
        version: 8,
        sources: {
            omt: {
                type: 'vector',
                url: 'https://tiles.openfreemap.org/planet',
                attribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors'
            }
        },
        layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': PAL.bg } },
            // 🌲 緑地（幻想的な深い緑）
            { id: 'landcover-wood', type: 'fill', source: 'omt', 'source-layer': 'landcover',
              filter: ['==', ['get', 'class'], 'wood'],
              paint: { 'fill-color': PAL.wood, 'fill-opacity': 0.85 } },
            { id: 'landcover-grass', type: 'fill', source: 'omt', 'source-layer': 'landcover',
              filter: ['==', ['get', 'class'], 'grass'],
              paint: { 'fill-color': PAL.grass, 'fill-opacity': 0.75 } },
            { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park',
              paint: { 'fill-color': PAL.park, 'fill-opacity': 0.8 } },
            { id: 'landuse-res', type: 'fill', source: 'omt', 'source-layer': 'landuse',
              filter: ['==', ['get', 'class'], 'residential'],
              paint: { 'fill-color': PAL.landuse, 'fill-opacity': 0.5 } },
            // 🌊 水面
            { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water',
              paint: { 'fill-color': PAL.water } },
            { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway',
              paint: { 'line-color': PAL.waterway, 'line-width': 1.6 } },
            // 🛣️ 道路（3階級・やわらかい光の帯）
            { id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation',
              filter: ['in', ['get', 'class'], ['literal', roadClasses.minor]],
              layout: { 'line-cap': 'round', 'line-join': 'round' },
              paint: {
                  'line-color': PAL.roadMinor,
                  'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 18.5, 7],
                  'line-blur': 0.6
              } },
            { id: 'road-mid', type: 'line', source: 'omt', 'source-layer': 'transportation',
              filter: ['in', ['get', 'class'], ['literal', roadClasses.mid]],
              layout: { 'line-cap': 'round', 'line-join': 'round' },
              paint: {
                  'line-color': PAL.roadMid,
                  'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.2, 18.5, 12],
                  'line-blur': 0.8
              } },
            { id: 'road-major-glow', type: 'line', source: 'omt', 'source-layer': 'transportation',
              filter: ['in', ['get', 'class'], ['literal', roadClasses.major]],
              layout: { 'line-cap': 'round', 'line-join': 'round' },
              paint: {
                  'line-color': PAL.roadMajorGlow,
                  'line-width': ['interpolate', ['linear'], ['zoom'], 13, 5, 18.5, 26],
                  'line-blur': 12, 'line-opacity': 0.35
              } },
            { id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation',
              filter: ['in', ['get', 'class'], ['literal', roadClasses.major]],
              layout: { 'line-cap': 'round', 'line-join': 'round' },
              paint: {
                  'line-color': PAL.roadMajor,
                  'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2, 18.5, 15],
                  'line-blur': 1
              } },
            { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation',
              filter: ['==', ['get', 'class'], 'rail'],
              paint: { 'line-color': PAL.rail, 'line-width': 1.6, 'line-dasharray': [3, 3] } },
            // 🏙️ 建物: OSM形状からの3D押し出し。高いほど淡く光る
            { id: 'building-3d', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building',
              minzoom: 13.5,
              paint: {
                  'fill-extrusion-color': ['interpolate', ['linear'],
                      ['coalesce', ['get', 'render_height'], 8],
                      0, PAL.bldLow, 25, PAL.bldMid, 70, PAL.bldHigh],
                  'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
                  'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
                  'fill-extrusion-opacity': 0.93,
                  'fill-extrusion-vertical-gradient': true
              } }
        ]
    };
}

// ============ 🗺️ マップ初期化 ============
function applyBodyTheme() {
    document.body.classList.remove('evening', 'morning', 'night-theme');
    document.body.classList.add('night');            // 演出レイヤーの共通クラス
    document.body.classList.add(THEME === 'night' ? 'night-theme' : THEME);
    if (ROUTE_CONFIG.dreamyDof) document.body.classList.add('dof');
}
applyBodyTheme();

const map = new maplibregl.Map({
    container: 'map',
    style: buildStyle(),
    center: [routePoints[0].lng, routePoints[0].lat],
    zoom: ZOOM,
    pitch: PITCH,
    bearing: BEAR,
    minZoom: LOCK ? ZOOM : 1,
    maxZoom: LOCK ? ZOOM : 20,
    maxPitch: 60,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    attributionControl: { compact: true }
});
if (LOCK) {
    map.scrollZoom.disable();
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
    map.touchZoomRotate.disable();
} else {
    map.touchZoomRotate.disableRotation();
}

// ============ 🚏 バス停マーカー（DOM要素） ============
function busStopSvgHtml() {
    const morning = THEME === 'morning';
    const sign  = morning ? '#e2574d' : '#ffd98a';
    const glyph = morning ? '#ffffff' : '#8a5a1e';
    const pole  = morning ? '#8a8a8a' : '#caa15e';
    return `
    <svg width="26" height="36" viewBox="0 0 26 36" xmlns="http://www.w3.org/2000/svg">
        <rect x="12" y="16" width="2.4" height="19" rx="1" fill="${pole}"/>
        <ellipse cx="13" cy="34.5" rx="4.5" ry="1.5" fill="rgba(0,0,0,0.35)"/>
        <circle cx="13" cy="10" r="9.4" fill="${sign}" stroke="#ffffff" stroke-width="2.2"/>
        <rect x="7.6" y="6.8" width="10.8" height="6.4" rx="1.6" fill="${glyph}"/>
        <rect x="8.8" y="8" width="3.4" height="2.6" rx="0.6" fill="${sign}"/>
        <rect x="13.6" y="8" width="3.4" height="2.6" rx="0.6" fill="${sign}"/>
        <circle cx="10.2" cy="13.6" r="1.25" fill="${sign}"/>
        <circle cx="15.8" cy="13.6" r="1.25" fill="${sign}"/>
    </svg>`;
}
const stopEls = [];
routePoints.slice(0, -1).forEach(p => {
    if (!p.isStop) return;
    const name = p.name || 'バス停';
    const div = document.createElement('div');
    div.className = 'busstop-marker';
    div.innerHTML = busStopSvgHtml();
    stopEls.push(div);
    new maplibregl.Marker({ element: div, anchor: 'bottom' })
        .setLngLat([p.lng, p.lat])
        .setPopup(new maplibregl.Popup({ offset: 30, closeButton: false })
            .setHTML(`<b>🚏 ${name}</b><br><span style="opacity:0.75;font-size:0.85em;">オレンジゆずるバス 赤ルートの停留所です。</span>`))
        .addTo(map);
});

// ============ 💡 街路灯（ルート沿いに暖色のあかり） ============
if (NIGHT) {
    const lampGap = ROUTE_CONFIG.lampIntervalM || 130;
    for (let d = lampGap / 2; d < totalDist; d += lampGap) {
        const ll = distToLatLng(d);
        const el = document.createElement('div');
        el.className = 'lamp-marker';
        el.style.width = '46px'; el.style.height = '46px';
        el.innerHTML = `<div class="lamp-glow" style="animation-delay:${(Math.random() * 3).toFixed(2)}s"></div>`;
        new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([ll.lng, ll.lat]).addTo(map);
    }
}

// ============ 🛣️ ルートライン・イベント点線（GPU描画・本物のにじみ付き） ============
const routeCoords = routePoints.map(p => [p.lng, p.lat]);
let savedEventLineData = { type: 'FeatureCollection', features: [] };

function addRouteLayers() {
    try {
    if (!map.getSource('route'))
    map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: routeCoords } } });
    map.addLayer({ id: 'route-glow', type: 'line', source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': PAL.routeGlow, 'line-width': 16, 'line-blur': 10, 'line-opacity': 0.45 } });
    map.addLayer({ id: 'route-core', type: 'line', source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': PAL.routeCore, 'line-width': 3.5, 'line-opacity': 0.95 } });

    // イベント点線（発動時にデータを差し込む・テーマ切替時も内容を引き継ぐ）
    if (!map.getSource('event-line'))
    map.addSource('event-line', { type: 'geojson', data: savedEventLineData });
    map.addLayer({ id: 'event-line-glow', type: 'line', source: 'event-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#6ff2ae', 'line-width': 12, 'line-blur': 9, 'line-opacity': 0.4 } });
    map.addLayer({ id: 'event-line-core', type: 'line', source: 'event-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#8bffc4', 'line-width': 3, 'line-dasharray': [1.6, 2.2], 'line-opacity': 0.95 } });
    } catch (err) { console.warn('ルートレイヤー追加をスキップ:', err); }
}
// 🛡️ ルート線の消失対策:
//  スタイルの再読込等でレイヤーが消えても、存在チェックして自動復元します
function ensureRouteLayers() {
    if (!map.isStyleLoaded()) return;
    if (!map.getSource('route') || !map.getLayer('route-core')) {
        // 個別レイヤーが欠けている場合も作り直す
        ['route-glow', 'route-core', 'event-line-glow', 'event-line-core'].forEach(id => {
            if (map.getLayer(id)) map.removeLayer(id);
        });
        ['route', 'event-line'].forEach(id => {
            if (map.getSource(id)) map.removeSource(id);
        });
        addRouteLayers();
    }
}
map.on('load', addRouteLayers);
map.on('styledata', () => { setTimeout(ensureRouteLayers, 50); });

// ============ 🌗 テーマ切替（夕方 ⇔ 朝） ============
const themeBtn = document.getElementById('theme-btn');
function setTheme(t) {
    THEME = t;
    PAL = themePalette(t);
    applyBodyTheme();
    themeBtn.innerText = (t === 'morning') ? '🌅' : '🌇';
    stopEls.forEach(el => { el.innerHTML = busStopSvgHtml(); });
    map.setStyle(buildStyle());
    // レイヤーの復元は styledata → ensureRouteLayers が自動で行います
}
themeBtn.addEventListener('click', () => {
    const next = (THEME === 'morning') ? 'evening' : 'morning';
    setTheme(next);
    showToast(next === 'morning'
        ? '🌅 朝のまちに切り替えました。すがすがしい運行をお楽しみください。'
        : '🌇 夕暮れのまちに切り替えました。あかりの灯る時間です。', 3000);
});
themeBtn.innerText = (THEME === 'morning') ? '🌅' : '🌇';

// ============ ⏱️ 運行スケジュール構築 ============
const LOOP_SEC = ROUTE_CONFIG.loopMinutes * 60;
const DWELL = Math.max(0, ROUTE_CONFIG.dwellSeconds || 0);

const timeline = [];
(function buildTimeline() {
    const stopPtIdx = routePoints.map((p, idx) => p.isStop ? idx : -1).filter(idx => idx >= 0);
    const dwellCount = stopPtIdx.length - 1;
    const moveSec = Math.max(1, LOOP_SEC - dwellCount * DWELL);
    let t = 0;
    for (let k = 0; k < stopPtIdx.length - 1; k++) {
        const a = stopPtIdx[k], b = stopPtIdx[k + 1];
        if (DWELL > 0) {
            timeline.push({ tStart: t, tEnd: t + DWELL, type: 'dwell', dStart: cumDist[a], dEnd: cumDist[a], ptIndex: a });
            t += DWELL;
        }
        const segSec = moveSec * (cumDist[b] - cumDist[a]) / totalDist;
        timeline.push({ tStart: t, tEnd: t + segSec, type: 'move', dStart: cumDist[a], dEnd: cumDist[b], ptIndex: b });
        t += segSec;
    }
    timeline[timeline.length - 1].tEnd = LOOP_SEC;
})();

// ============ 🧸 ぬいぐるみバス（DOMマーカー） ============
const busW = ROUTE_CONFIG.busIconWidth;
function plushBusSvg(w) {
    const h = Math.round(w * 0.82);
    return `
    <svg class="bus-body" width="${w}" height="${h}" viewBox="0 0 120 98" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="pbBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffc978"/><stop offset="0.55" stop-color="#f9a648"/><stop offset="1" stop-color="#ef8f2e"/>
        </linearGradient>
        <linearGradient id="pbGlass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#dff3ff"/><stop offset="1" stop-color="#9cc8ef"/>
        </linearGradient>
        <radialGradient id="pbLight" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#fff6d8"/><stop offset="0.55" stop-color="#ffd977"/><stop offset="1" stop-color="#ffb844" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <ellipse cx="60" cy="92" rx="40" ry="6" fill="rgba(5,8,25,0.45)"/>
      <rect x="8" y="14" width="104" height="66" rx="30" fill="url(#pbBody)" stroke="#c9711d" stroke-width="3"/>
      <rect x="13.5" y="19.5" width="93" height="55" rx="25" fill="none" stroke="#ffe3b0" stroke-width="1.6" stroke-dasharray="4 5" opacity="0.85"/>
      <rect x="14" y="56" width="92" height="22" rx="11" fill="#ffe9c2" stroke="#e0a75c" stroke-width="2"/>
      <circle cx="38" cy="40" r="11" fill="url(#pbGlass)" stroke="#b8873f" stroke-width="2.5"/>
      <circle cx="66" cy="40" r="11" fill="url(#pbGlass)" stroke="#b8873f" stroke-width="2.5"/>
      <circle cx="94" cy="40" r="10" fill="url(#pbGlass)" stroke="#b8873f" stroke-width="2.5"/>
      <circle cx="34.5" cy="36.5" r="3.4" fill="#ffffff" opacity="0.9"/>
      <circle cx="62.5" cy="36.5" r="3.4" fill="#ffffff" opacity="0.9"/>
      <circle cx="90.8" cy="36.8" r="3" fill="#ffffff" opacity="0.9"/>
      <circle cx="107" cy="63" r="12" fill="url(#pbLight)"/>
      <circle cx="106" cy="63" r="4.6" fill="#fff3c9" stroke="#e0a23c" stroke-width="1.6"/>
      <circle cx="34" cy="80" r="11.5" fill="#4a4038" stroke="#2e2822" stroke-width="2.5"/>
      <circle cx="34" cy="80" r="5" fill="#8d7d6e"/>
      <circle cx="86" cy="80" r="11.5" fill="#4a4038" stroke="#2e2822" stroke-width="2.5"/>
      <circle cx="86" cy="80" r="5" fill="#8d7d6e"/>
      <circle cx="18" cy="52" r="4" fill="#ff9d7a" opacity="0.65"/>
    </svg>`;
}
const busEl = document.createElement('div');
busEl.className = 'bus-marker';
busEl.innerHTML = plushBusSvg(busW);
const busMarker = new maplibregl.Marker({ element: busEl, anchor: 'center' })
    .setLngLat([routePoints[0].lng, routePoints[0].lat])
    .addTo(map);

// ============ 🎵 音声・字幕 ============
const bgm = document.getElementById('bgm-audio');
bgm.src = ROUTE_CONFIG.bgmFile;
const voice = document.getElementById('voice-audio');
voice.src = ROUTE_CONFIG.voiceFile;
let bgmEnabled = true;

function startAudio() {
    if (!bgmEnabled) return;
    voice.currentTime = 0;
    voice.play().catch(() => {});
    bgm.currentTime = 0;
    bgm.play().catch(() => {});
}
function stopAudio() {
    bgm.pause(); bgm.currentTime = 0;
    voice.pause(); voice.currentTime = 0;
    if (typeof narrAudio !== 'undefined') { narrAudio.pause(); narrAudio.currentTime = 0; }
}

document.getElementById('bgm-btn').addEventListener('click', (e) => {
    bgmEnabled = !bgmEnabled;
    e.currentTarget.innerText = bgmEnabled ? '🔊' : '🔇';
    if (!bgmEnabled) { bgm.pause(); voice.pause(); }
    else if (running) { bgm.play().catch(() => {}); }
});

const subtitleEl = document.getElementById('subtitle');
const subtitleText = document.getElementById('subtitle-text');
let subtitleTimer = null;
let subtitleOwner = null; // 'narration' | 'event' | null
// 塊をまるごと表示（音声とのずれを防ぐため文字送りは行いません）
function showSubtitle(text, holdMs, owner) {
    if (!text) return;
    clearTimeout(subtitleTimer);
    subtitleOwner = owner || 'event';
    subtitleText.textContent = text; // 改行はCSS(pre-line)でそのまま表示
    subtitleEl.classList.add('show');
    if (holdMs) {
        subtitleTimer = setTimeout(() => { if (subtitleOwner !== 'narration') hideSubtitle(); }, holdMs);
    }
}
function hideSubtitle() {
    clearTimeout(subtitleTimer);
    subtitleOwner = null;
    subtitleEl.classList.remove('show');
}
// ナレーション台本(narration.js)があればそちらを優先し、無ければ voiceText を表示
const HAS_NARRATION = (typeof NARRATION !== 'undefined') && NARRATION.length > 0;
if (!HAS_NARRATION) {
    voice.addEventListener('play', () => showSubtitle(ROUTE_CONFIG.voiceText || '', null, 'narration'));
    voice.addEventListener('ended', () => { subtitleTimer = setTimeout(hideSubtitle, 1800); });
}

// 📻 位置トリガー方式: バスが各塊の座標に接触すると表示が切り替わります
// 塊は台本の順番どおりに1つずつ発動し、次の塊まで表示が続きます。
// 最後の塊は narrationHoldSec 秒後に自動で消えます（周回ごとに最初から）。
let narrLap = -1, narrPtr = 0, narrLastShowElapsed = -1;
const narrAudio = new Audio(); // 区間ごとの音声(週次シナリオのaudio_file)
function updateNarration(lap, pos, elapsedNow) {
    if (!HAS_NARRATION) return;
    if (lap !== narrLap) { narrLap = lap; narrPtr = 0; narrLastShowElapsed = -1; }

    // イベントメッセージ表示中は発動を待機（イベント終了後に表示されます）
    if (subtitleOwner === 'event') return;

    if (narrPtr < NARRATION.length) {
        const n = NARRATION[narrPtr];
        if (n.lat != null && distM(pos, n) <= (ROUTE_CONFIG.narrationRadius || 45)) {
            showSubtitle(n.text, null, 'narration');
            // 🎵 区間音声: audio_file が指定されていれば再生(週フォルダから取得)
            if (n.audio && window.WEEK_ID && bgmEnabled) {
                narrAudio.src = `scenario/audio/${window.WEEK_ID}/${n.audio}`;
                narrAudio.play().catch(() => {});
            }
            narrLastShowElapsed = elapsedNow;
            narrPtr++;
        }
    } else if (subtitleOwner === 'narration' && narrLastShowElapsed >= 0
               && elapsedNow - narrLastShowElapsed > (ROUTE_CONFIG.narrationHoldSec || 45)) {
        hideSubtitle(); // 最後の塊を一定時間表示したら閉じる
    }
}

// ============ 💬 トースト ============
let toastTimer = null;
function showToast(msg, ms = 4500) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ============ 🌟 イベント演出 ============
EVENT_POINTS.forEach(ev => { ev._trigger = { lat: ev.trigger.lat, lng: ev.trigger.lng }; });
let firedEvents = new Set();
let eventTempMarkers = [];
let eventClearTimer = null;

function fireEvent(ev, lap) {
    const key = `${lap}-${ev.trigger.lat}-${ev.trigger.lng}`;
    if (firedEvents.has(key)) return;
    firedEvents.add(key);

    const showMs = ((ev.eventPoint && ev.eventPoint.showSeconds) || 40) * 1000;
    const evMsg = ev.message || '🌟 この付近におすすめのスポットがございます。点線のルートをご覧ください。';
    showToast(evMsg);
    showSubtitle(evMsg, 6000, 'event');

    // 点線（GPU描画・にじみ付き）
    const dashPath = ev.routPoints.map(p => [p[1], p[0]]);
    if (ev.eventPoint) dashPath.push([ev.eventPoint.lng, ev.eventPoint.lat]);
    if (dashPath.length >= 2) {
        savedEventLineData = { type: 'Feature', geometry: { type: 'LineString', coordinates: dashPath } };
        if (map.getSource('event-line')) map.getSource('event-line').setData(savedEventLineData);
    }

    // luminescence + 目的地アイコン
    if (ev.eventPoint && ev.eventPoint.action === 'luminescence') {
        const lumEl = document.createElement('div');
        lumEl.className = 'lum-marker';
        lumEl.style.width = '110px'; lumEl.style.height = '110px';
        lumEl.innerHTML = `<div class="lum-ring"></div><div class="lum-ring delay1"></div><div class="lum-ring delay2"></div><div class="lum-glow"></div>`;
        eventTempMarkers.push(new maplibregl.Marker({ element: lumEl, anchor: 'center' })
            .setLngLat([ev.eventPoint.lng, ev.eventPoint.lat]).addTo(map));

        if (ev.eventPoint.icon) {
            const iw = ROUTE_CONFIG.eventIconWidth || 42;
            const poiEl = document.createElement('div');
            poiEl.className = 'poi-marker';
            poiEl.innerHTML = `<img src="${ev.eventPoint.icon}" alt="spot" style="width:${iw}px; height:auto; display:block; filter: drop-shadow(0 0 8px rgba(140,255,200,0.6)) drop-shadow(0 3px 4px rgba(5,8,25,0.6));">`;
            eventTempMarkers.push(new maplibregl.Marker({ element: poiEl, anchor: 'bottom' })
                .setLngLat([ev.eventPoint.lng, ev.eventPoint.lat]).addTo(map));
        }
    }

    clearTimeout(eventClearTimer);
    eventClearTimer = setTimeout(clearEventFx, showMs);
}
function clearEventFx() {
    eventTempMarkers.forEach(m => m.remove());
    eventTempMarkers = [];
    savedEventLineData = { type: 'FeatureCollection', features: [] };
    if (map.getSource('event-line')) map.getSource('event-line').setData(savedEventLineData);
}

// ============ 🎥 滑らか追従カメラ（イージング補間） ============
let followMode = true;
let cam = { lat: routePoints[0].lat, lng: routePoints[0].lng }; // カメラの現在注視点
const followBtn = document.getElementById('follow-btn');
function setFollow(on) {
    followMode = on;
    followBtn.classList.toggle('active', on);
    followBtn.innerText = on ? '🎥' : '🔓';
    if (on) { const c = map.getCenter(); cam = { lat: c.lat, lng: c.lng }; }
}
followBtn.addEventListener('click', () => {
    setFollow(!followMode);
    showToast(followMode ? '🎥 カメラがバスを追従します。' : '🔓 カメラの追従を解除しました。自由に地図を動かせます。', 2500);
});
map.on('dragstart', () => {
    if (followMode) {
        setFollow(false);
        if (running) showToast('🔓 追従を解除しました。右上の🎥ボタンで再開できます。', 2500);
    }
});

// ============ ▶️ 走行アニメーション ============
let running = false;
let elapsed = 0;
let lastFrame = null;
let lastLng = routePoints[0].lng;

const startBtn = document.getElementById('start-btn');
const speedSelect = document.getElementById('speed-select');
const statusPanel = document.getElementById('status-panel');
const statusMain = document.getElementById('status-main');
const statusSub = document.getElementById('status-sub');

function fmt(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function tick(now) {
    if (!running) return;
    let dtReal = 0;
    if (lastFrame !== null) {
        dtReal = (now - lastFrame) / 1000;
        elapsed += dtReal * Number(speedSelect.value);
    }
    lastFrame = now;

    const lap = Math.floor(elapsed / LOOP_SEC);
    const tInLoop = elapsed % LOOP_SEC;

    let entry = timeline[0];
    for (const e of timeline) { if (tInLoop >= e.tStart && tInLoop < e.tEnd) { entry = e; break; } }

    let dist;
    if (entry.type === 'dwell') {
        dist = entry.dStart;
    } else {
        const r = (tInLoop - entry.tStart) / (entry.tEnd - entry.tStart);
        dist = entry.dStart + (entry.dEnd - entry.dStart) * r;
    }

    const pos = distToLatLng(dist);
    busMarker.setLngLat([pos.lng, pos.lat]);

    // 🎥 カメラをバスへ「少しずつ寄せる」補間で、ふわっと滑らかに追従
    if (followMode && dtReal > 0) {
        const k = 1 - Math.exp(-dtReal * (ROUTE_CONFIG.cameraEase || 2.8));
        cam.lat += (pos.lat - cam.lat) * k;
        cam.lng += (pos.lng - cam.lng) * k;
        map.jumpTo({ center: [cam.lng, cam.lat], zoom: LOCK ? ZOOM : map.getZoom(), pitch: PITCH, bearing: BEAR });
    }

    // 📻 ナレーション字幕の更新（バスの現在位置で判定）
    updateNarration(lap, pos, elapsed);

    // 🎯 トリガー接触判定
    EVENT_POINTS.forEach(ev => {
        if (distM(pos, ev._trigger) <= (ROUTE_CONFIG.triggerRadius || 30)) {
            fireEvent(ev, lap);
        }
    });

    // 進行方向でバスの向きを反転（画像は右向き前提）
    if (pos.lng < lastLng - 0.00001) busEl.classList.add('face-left');
    else if (pos.lng > lastLng + 0.00001) busEl.classList.remove('face-left');
    lastLng = pos.lng;

    // 🛡️ ルート線が消えていないか定期チェック
    if ((now | 0) % 2000 < 20) ensureRouteLayers();

    const ptName = routePoints[entry.ptIndex]?.name || '次の停留所';
    statusMain.innerText = `運行中 ${fmt(tInLoop)} / ${fmt(LOOP_SEC)}`;
    statusSub.innerText = entry.type === 'dwell'
        ? `${lap + 1}周目 ・ ${ptName}に停車しております`
        : `${lap + 1}周目 ・ 次は ${ptName} です`;

    requestAnimationFrame(tick);
}

startBtn.addEventListener('click', () => {
    running = !running;
    if (running) {
        lastFrame = null;
        startBtn.innerText = '⏹ 運行ストップ';
        startBtn.classList.add('running');
        statusPanel.classList.add('running');
        setFollow(true);
        const p = busMarker.getLngLat();
        cam = { lat: p.lat, lng: p.lng };
        map.jumpTo({ center: [p.lng, p.lat], zoom: LOCK ? ZOOM : map.getZoom(), pitch: PITCH, bearing: BEAR });
        startAudio();
        requestAnimationFrame(tick);
    } else {
        startBtn.innerText = '▶ 運行スタート';
        startBtn.classList.remove('running');
        statusPanel.classList.remove('running');
        statusMain.innerText = '一時停止中';
        statusSub.innerText = 'スタートを押すと続きから運行します';
        stopAudio();
        hideSubtitle();
    }
});

// ============ ✉️ 投稿モード ============
let postMode = false;
const postBtn = document.getElementById('post-btn');
postBtn.addEventListener('click', () => {
    postMode = !postMode;
    postBtn.classList.toggle('active', postMode);
    showToast(postMode
        ? '✉️ 投稿モードをオンにしました。地図をタップすると座標が表示されます。'
        : '投稿モードをオフにしました。', 3000);
});

map.on('click', (e) => {
    if (!postMode) return;
    const coordText = `${e.lngLat.lat}, ${e.lngLat.lng}`;
    const mailHref = `mailto:${ROUTE_CONFIG.postEmail}`
        + `?subject=${encodeURIComponent(ROUTE_CONFIG.postSubject)}`
        + `&body=${encodeURIComponent(`地点座標: ${coordText}\n\n（メモ・地点の説明などをご記入ください）\n`)}`;
    new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
        .setLngLat(e.lngLat)
        .setHTML(`
            <div style="text-align:center; min-width:210px;">
                <b>📍 この地点の座標</b><br>
                <code style="font-size:0.85em; word-break:break-all;">${coordText}</code><br><br>
                <button onclick="navigator.clipboard?.writeText('${coordText}').then(()=>alert('座標をコピーしました。'))"
                        style="font-family:inherit; padding:7px 12px; background:#ffffff; color:#6b4423; border:2px solid #e8b86d; border-radius:10px; cursor:pointer; font-weight:bold; margin-right:6px;">
                    📋 コピー
                </button>
                <a href="${mailHref}"
                   style="display:inline-block; padding:7px 12px; background:#f0a850; color:#5c3410; border-radius:10px; text-decoration:none; font-weight:bold;">
                    ✉️ メールで投稿
                </a>
            </div>
        `)
        .addTo(map);
});

// 🗺️ バスの位置へ戻るボタン
document.getElementById('fit-btn').addEventListener('click', () => {
    const p = busMarker.getLngLat();
    map.easeTo({ center: [p.lng, p.lat], zoom: LOCK ? ZOOM : map.getZoom(), pitch: PITCH, bearing: BEAR, duration: 900 });
    setTimeout(() => setFollow(true), 950);
    showToast('🗺️ バスの位置に表示を戻しました。', 2000);
});

// 起動メッセージ
const stopCount = routePoints.slice(0, -1).filter(p => p.isStop).length;
showToast(`🚌 ${window.WEEK_ID ? window.WEEK_ID + '週の放送データ' : '内蔵データ'}を読み込みました。停留所 ${stopCount} か所・全長 約${(totalDist / 1000).toFixed(1)}km です。`, 5000);
