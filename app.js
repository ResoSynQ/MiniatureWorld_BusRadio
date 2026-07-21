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
    if (theme === 'day') return {
        // ☀️ 昼: 澄んだ日中の光。ニュートラルで明るい街並み
        bg:        '#eef0ea',
        wood:      '#8fbf85', grass: '#a8d693', park: '#98cf8e', landuse: '#e8e4da',
        water:     '#8fbfe8', waterway: '#7fb2e0',
        roadMinor: '#ffffff', roadMid: '#fdfaf2',
        roadMajorGlow: '#ffe9b0', roadMajor: '#f7d9a0',
        rail:      '#c9c4b8',
        bldLow: '#e0e3ea', bldMid: '#c7cede', bldHigh: '#aebadb',
        routeGlow: '#ff8a3c', routeCore: '#e8551e'
    };
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
              } },
            // Invisible query layer for mask editing. Keep this separate from
            // building-3d so mask recalculation never has to reveal hidden
            // buildings just to read their original geometry.
            { id: 'building-mask-query', type: 'fill', source: 'omt', 'source-layer': 'building',
              minzoom: 13.5,
              paint: { 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': 0.01 } }
        ]
    };
}

// ============ 🗺️ マップ初期化 ============
function applyBodyTheme() {
    document.body.classList.remove('evening', 'morning', 'day', 'night-theme');
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
    const morning = THEME === 'morning' || THEME === 'day';
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

    // 🏗 マスク再構築レイヤー: 結合ブロックを丸ごと非表示にした後、
    // クリックした1軒「以外」をここで同じ見た目に建て直す(=1軒だけ消える)
    if (!map.getSource('mask-rebuild'))
    map.addSource('mask-rebuild', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'mask-rebuild-3d', type: 'fill-extrusion', source: 'mask-rebuild',
        paint: {
            'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'h'],
                0, PAL.bldLow, 25, PAL.bldMid, 70, PAL.bldHigh],
            'fill-extrusion-height': ['get', 'h'],
            'fill-extrusion-base': ['get', 'b'],
            'fill-extrusion-opacity': 0.93,
            'fill-extrusion-vertical-gradient': true
        } });

    // 🟦 マスク領域の可視化(半透明の塗り+枠線。エディター時のみ表示)
    if (!map.getSource('mask-regions'))
    map.addSource('mask-regions', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'mask-regions-fill', type: 'fill', source: 'mask-regions',
        layout: { visibility: 'none' },
        paint: { 'fill-color': '#3aa0ff', 'fill-opacity': 0.28 } });
    map.addLayer({ id: 'mask-regions-line', type: 'line', source: 'mask-regions',
        layout: { visibility: 'none' },
        paint: { 'line-color': '#3aa0ff', 'line-width': 2.5 } });
    // 作成中の点・線のプレビュー
    if (!map.getSource('mask-draft'))
    map.addSource('mask-draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'mask-draft-fill', type: 'fill', source: 'mask-draft',
        layout: { visibility: 'none' }, paint: { 'fill-color': '#ff5a5a', 'fill-opacity': 0.22 } });
    map.addLayer({ id: 'mask-draft-line', type: 'line', source: 'mask-draft',
        layout: { visibility: 'none' }, paint: { 'line-color': '#ff5a5a', 'line-width': 2, 'line-dasharray': [2, 2] } });
    map.addLayer({ id: 'mask-draft-pt', type: 'circle', source: 'mask-draft',
        layout: { visibility: 'none' }, paint: { 'circle-radius': 5, 'circle-color': '#ff5a5a', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
        filter: ['==', '$type', 'Point'] });
    lastMaskBuildSignature = null;

    // イベント点線（発動時にデータを差し込む・テーマ切替時も内容を引き継ぐ）
    if (!map.getSource('event-line'))
    map.addSource('event-line', { type: 'geojson', data: savedEventLineData });
    map.addLayer({ id: 'event-line-glow', type: 'line', source: 'event-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#6ff2ae', 'line-width': 12, 'line-blur': 9, 'line-opacity': 0.4 } });
    map.addLayer({ id: 'event-line-core', type: 'line', source: 'event-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#8bffc4', 'line-width': 3, 'line-dasharray': [1.6, 2.2], 'line-opacity': 0.95 } });
    addDecorationLayers();
    } catch (err) { console.warn('ルートレイヤー追加をスキップ:', err); }
}
// 🛡️ ルート線の消失対策:
//  スタイルの再読込等でレイヤーが消えても、存在チェックして自動復元します
function ensureRouteLayers() {
    if (!map.isStyleLoaded()) return;
    if (!map.getSource('route') || !map.getLayer('route-core') || !map.getSource('decorations') || !map.getLayer('decorations-symbol')) {
        // 個別レイヤーが欠けている場合も作り直す
        ['route-glow', 'route-core', 'event-line-glow', 'event-line-core', 'mask-rebuild-3d', 'mask-regions-line', 'decorations-symbol'].forEach(id => {
            if (map.getLayer(id)) map.removeLayer(id);
        });
        ['route', 'event-line', 'mask-rebuild', 'mask-regions', 'decorations'].forEach(id => {
            if (map.getSource(id)) map.removeSource(id);
        });
        addRouteLayers();
    }
}
let suppressMaskStyleRefresh = false;
map.on('load', () => { addRouteLayers(); applyBuildingMasks(); renderPlacements(); renderDecorations(); });
map.on('styledata', () => { setTimeout(() => { ensureRouteLayers(); if (!suppressMaskStyleRefresh) applyBuildingMasks(); }, 50); });

// 🏠 建物マスク(矩形領域方式):
// エディターで囲った矩形領域を「マスク領域マップ」(MASK_REGIONS)として保持し、
// 領域内に中心を持つ建物だけを消す。建物IDやタイルの結合状態に一切依存しない。
window.MASK_REGIONS = window.MASK_REGIONS || [];
// 点がポリゴン内か(レイキャスティング)
function pointInPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
}
function ringInRegions(ring) {
    let x = 0, y = 0;
    for (const p of ring) { x += p[0]; y += p[1]; }
    x /= ring.length; y /= ring.length;
    return (window.MASK_REGIONS || []).some(r => r.points && r.points.length >= 3 && pointInPolygon(x, y, r.points));
}
function polygonsFromFeature(f) {
    const g = f && f.geometry;
    if (!g) return [];
    if (g.type === 'Polygon') return [g.coordinates];
    if (g.type === 'MultiPolygon') return g.coordinates;
    return [];
}
function featureMaskId(f) {
    const p = (f && f.properties) || {};
    return f.id ?? p.id ?? p.osm_id ?? p.osm_id2 ?? p['@id'] ?? null;
}
function isLngLatRing(ring) {
    if (!ring || !ring.length) return false;
    const p = ring[0];
    return Array.isArray(p) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
}
let lastMaskBuildSignature = null;
function maskBuildSignature(regions) {
    const b = map.getBounds();
    const regionKey = regions
        .map(r => (r.points || []).map(p => p[0].toFixed(6) + ',' + p[1].toFixed(6)).join(';'))
        .join('|');
    return [
        regionKey,
        map.getZoom().toFixed(2),
        b.getWest().toFixed(5), b.getSouth().toFixed(5),
        b.getEast().toFixed(5), b.getNorth().toFixed(5)
    ].join('|');
}
function applyBuildingMasks() {
    if (!map.getLayer('building-3d')) return;
    try {
        rebuildMaskedBuildingsNow();
        updateRegionOutlines();
    } catch (err) { console.warn('建物マスク適用に失敗:', err); }
}
// エディター用: マスク領域の枠線表示
function updateRegionOutlines() {
    if (!map.getSource('mask-regions')) return;
    map.getSource('mask-regions').setData({
        type: 'FeatureCollection',
        features: (window.MASK_REGIONS || []).filter(r => r.points && r.points.length >= 3).map(r => ({
            type: 'Feature', properties: {},
            geometry: { type: 'Polygon', coordinates: [[...r.points, r.points[0]]] }
        }))
    });
}
window.updateRegionOutlines = updateRegionOutlines;

// 🏗 建て直し(実行時計算方式):
// 非表示にした結合フィーチャを地図タイルからその場で取得し、
// 「消すと指定された輪郭」以外の全棟を同じ見た目で再描画する。
// JSONには消した1軒の輪郭しか保存しないため、巨大結合(数千棟)でもデータは肥大しない。
function ringCentroidKey(ring) {
    let x = 0, y = 0;
    for (const p of ring) { x += p[0]; y += p[1]; }
    return (x / ring.length).toFixed(5) + ',' + (y / ring.length).toFixed(5);
}
let rebuilding = false;
function rebuildMaskedBuildingsNow() {
    if (!map.getSource('mask-rebuild')) return;
    if (rebuilding) return;      // 再入防止(同期的に完結するので確実に効く)
    rebuilding = true;
    clearTimeout(rebuildTimer); // 保留中の再実行もキャンセル
    try { _rebuildMaskedBuildingsInner(); }
    catch (err) { console.warn('建て直し失敗:', err); }
    rebuilding = false;
}
function _rebuildMaskedBuildingsInner() {
    const regions = window.MASK_REGIONS || [];
    if (!regions.length) {
        lastMaskBuildSignature = null;
        try { map.setFilter('building-3d', null); } catch (e) {}
        map.getSource('mask-rebuild').setData({ type: 'FeatureCollection', features: [] });
        return;
    }
    const sig = maskBuildSignature(regions);
    if (sig === lastMaskBuildSignature) return;
    // 画面内のタイルから建物を取得し、
    // 「マスク領域に触れるフィーチャ」→ 非表示IDに登録 + 領域外の棟だけ建て直す
    let feats = [];
    try {
        const c = map.getCanvas();
        const queryLayer = map.getLayer('building-mask-query') ? 'building-mask-query' : 'building-3d';
        feats = map.queryRenderedFeatures([[0, 0], [c.clientWidth || c.width, c.clientHeight || c.height]], { layers: [queryLayer] });
        if (!feats.length && queryLayer !== 'building-3d') {
            feats = map.queryRenderedFeatures([[0, 0], [c.clientWidth || c.width, c.clientHeight || c.height]], { layers: ['building-3d'] });
        }
    } catch (err) {
        console.warn('building query failed:', err);
        return;
    }
    if (!feats.length) return; // タイル未ロード時は現状維持(空で塗り替えない)
    const hideIds = [];
    const hideIdSet = new Set();
    const seen = new Set();
    const out = [];
    feats.forEach(f => {
        const polys = polygonsFromFeature(f);
        // このフィーチャの中に領域内の棟があるか
        const touches = polys.some(poly => poly[0] && poly[0].length >= 4 && isLngLatRing(poly[0]) && ringInRegions(poly[0]));
        if (!touches) return;
        const id = featureMaskId(f);
        if (id != null && !hideIdSet.has(id)) { hideIdSet.add(id); hideIds.push(id); }
        const h = Number(f.properties && (f.properties.render_height ?? f.properties.height)) || 8;
        const b = Number(f.properties && (f.properties.render_min_height ?? f.properties.min_height)) || 0;
        polys.forEach(poly => {
            const ring = poly[0];
            if (!ring || ring.length < 4) return;
            if (!isLngLatRing(ring)) return;
            if (ringInRegions(ring)) return;      // 領域内の棟は建て直さない=消える
            const key = ringCentroidKey(ring);
            if (seen.has(key)) return;            // タイル重複除去
            seen.add(key);
            out.push({ type: 'Feature', properties: { h, b }, geometry: { type: 'Polygon', coordinates: poly } });
        });
    });
    suppressMaskStyleRefresh = true;
    try { map.setFilter('building-3d', hideIds.length ? ['!', ['in', ['id'], ['literal', hideIds]]] : null); } catch (e) { console.warn('building mask filter failed:', e); }
    setTimeout(() => { suppressMaskStyleRefresh = false; }, 120);
    map.getSource('mask-rebuild').setData({ type: 'FeatureCollection', features: out });
    lastMaskBuildSignature = sig;
    console.log('mask debug:', { regions: regions.length, queriedBuildings: feats.length, hiddenFeatureIds: hideIds.length, rebuiltRings: out.length });
    console.log('🏗[診断] マスク領域:', regions.length, '/ 非表示フィーチャ:', hideIds.length, '/ 建て直し棟数:', out.length);
}
window.rebuildMaskedBuildings = () => rebuildMaskedBuildingsNow();

// 建て直しの起動: moveend(画面移動後)のみ。sourcedataは再帰の温床なので使わない。
let rebuildTimer = null;
function scheduleRebuild() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => rebuildMaskedBuildingsNow(), 200);
}
map.on('moveend', () => { if ((window.MASK_REGIONS || []).length) scheduleRebuild(); });
// マスク追加・削除時にエディターから明示的に呼ぶための即時版
window.forceRebuildMasks = () => rebuildMaskedBuildingsNow();
window.applyBuildingMasks = applyBuildingMasks;

// 🌿 疑似3D植栽・街具スプライト。
// MapLibreのsymbol layerへ同じ画像を使い回して描くため、大量配置してもDOMマーカーより軽い。
const DECORATION_LIBRARY = [
    { id: 'tree-round', label: '🌳 樹木A', icon: 'deco-tree-round', scale: 1.00 },
    { id: 'tree-tall', label: '🌳 樹木B', icon: 'deco-tree-tall', scale: 1.02 },
    { id: 'sakura', label: '🌸 桜', icon: 'deco-sakura', scale: 1.04 },
    { id: 'pine', label: '🌲 針葉樹', icon: 'deco-pine', scale: 1.06 },
    { id: 'hedge', label: '🌿 植込み', icon: 'deco-hedge', scale: 0.78 },
    { id: 'flowerbed', label: '🌼 花壇', icon: 'deco-flowerbed', scale: 0.76 },
    { id: 'grass', label: '🌾 草地', icon: 'deco-grass', scale: 0.72 },
    { id: 'rock', label: '🪨 岩', icon: 'deco-rock', scale: 0.72 },
    { id: 'playground', label: '🛝 遊具', icon: 'deco-playground', scale: 0.92 },
    { id: 'parasol', label: '☂️ パラソル', icon: 'deco-parasol', scale: 0.90 },
    { id: 'bench', label: '🪑 ベンチ', icon: 'deco-bench', scale: 0.78 }
];
const DECORATION_BY_ID = Object.fromEntries(DECORATION_LIBRARY.map(d => [d.id, d]));
window.DECORATION_LIBRARY = DECORATION_LIBRARY;
window.DECORATIONS = window.DECORATIONS || [];

function drawDecorationImage(kind) {
    const c = document.createElement('canvas');
    c.width = 96; c.height = 128;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    function ellipse(x, y, rx, ry, fill, stroke, sw = 2) {
        g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        if (fill) { g.fillStyle = fill; g.fill(); }
        if (stroke) { g.strokeStyle = stroke; g.lineWidth = sw; g.stroke(); }
    }
    function poly(points, fill, stroke, sw = 2) {
        g.beginPath(); points.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]));
        g.closePath();
        if (fill) { g.fillStyle = fill; g.fill(); }
        if (stroke) { g.strokeStyle = stroke; g.lineWidth = sw; g.stroke(); }
    }
    function shadow(w = 42, y = 116) { ellipse(48, y, w, 9, 'rgba(24,30,34,0.28)'); }
    function trunk(x = 48, y = 71, h = 37) {
        g.fillStyle = '#8b5a32'; g.fillRect(x - 5, y, 10, h);
        g.fillStyle = 'rgba(255,220,160,0.35)'; g.fillRect(x - 3, y + 2, 3, h - 4);
    }
    function canopy(x, y, r, color, hi = '#bfe9a7') {
        ellipse(x + 6, y + 6, r * 0.95, r * 0.78, 'rgba(13,43,24,0.16)');
        ellipse(x, y, r, r * 0.78, color, 'rgba(255,255,255,0.34)', 2);
        ellipse(x - r * 0.25, y - r * 0.22, r * 0.36, r * 0.22, hi);
    }
    shadow();
    if (kind === 'tree-round') {
        trunk(); canopy(48, 48, 28, '#56a95d');
    } else if (kind === 'tree-tall') {
        trunk(48, 58, 48); canopy(48, 32, 21, '#77b861'); canopy(37, 54, 19, '#5ea955'); canopy(59, 56, 20, '#4f984f');
    } else if (kind === 'sakura') {
        trunk(48, 68, 39); canopy(48, 47, 28, '#f5a7bd', '#ffd2df'); canopy(35, 58, 16, '#f3bfd0', '#ffe3ea'); canopy(61, 58, 17, '#ed91ad', '#ffd2df');
    } else if (kind === 'pine') {
        trunk(48, 76, 32); poly([[48, 14], [22, 58], [74, 58]], '#3f7f55', 'rgba(255,255,255,0.28)');
        poly([[48, 31], [18, 82], [78, 82]], '#326d4e', 'rgba(255,255,255,0.24)');
        poly([[48, 51], [16, 106], [80, 106]], '#285d45', 'rgba(255,255,255,0.2)');
    } else if (kind === 'hedge') {
        shadow(36); ellipse(34, 94, 18, 15, '#4f9d55'); ellipse(50, 90, 21, 18, '#66b86a'); ellipse(65, 96, 17, 14, '#438e4b');
    } else if (kind === 'flowerbed') {
        shadow(38); ellipse(48, 100, 37, 16, '#8ad072', '#e7ffd4', 2);
        ['#ffd455', '#ff7ca8', '#8ee7ff', '#ffffff', '#ff9b58'].forEach((col, i) => ellipse(24 + i * 12, 92 + (i % 2) * 6, 4, 4, col));
    } else if (kind === 'grass') {
        shadow(34); ellipse(48, 105, 35, 11, '#6fb85d');
        g.strokeStyle = '#e1f5a6'; g.lineWidth = 3;
        for (let i = 0; i < 9; i++) { const x = 23 + i * 6; g.beginPath(); g.moveTo(x, 106); g.lineTo(x + 3, 88 + (i % 3) * 5); g.stroke(); }
    } else if (kind === 'rock') {
        shadow(34); poly([[22, 105], [34, 82], [57, 78], [76, 95], [68, 112], [38, 115]], '#9aa2a4', '#d8dde0', 2);
        poly([[34, 86], [55, 82], [45, 101]], 'rgba(255,255,255,0.25)');
    } else if (kind === 'playground') {
        shadow(36); g.strokeStyle = '#69b8ff'; g.lineWidth = 7; g.beginPath(); g.moveTo(26, 106); g.lineTo(45, 62); g.lineTo(66, 106); g.stroke();
        g.strokeStyle = '#ffba57'; g.lineWidth = 8; g.beginPath(); g.moveTo(44, 64); g.quadraticCurveTo(58, 82, 72, 98); g.stroke();
        ellipse(45, 59, 10, 8, '#ff6d8a');
    } else if (kind === 'parasol') {
        shadow(30); g.strokeStyle = '#8b5a32'; g.lineWidth = 5; g.beginPath(); g.moveTo(48, 44); g.lineTo(48, 111); g.stroke();
        poly([[48, 20], [18, 62], [78, 62]], '#ff7f73', '#ffd0c8', 2);
        g.strokeStyle = '#fff4d6'; g.lineWidth = 2; [32, 48, 64].forEach(x => { g.beginPath(); g.moveTo(48, 20); g.lineTo(x, 62); g.stroke(); });
    } else if (kind === 'bench') {
        shadow(34); g.fillStyle = '#86532c'; g.fillRect(24, 83, 50, 9); g.fillRect(27, 98, 48, 8);
        g.fillStyle = '#d79b58'; g.fillRect(24, 79, 50, 7); g.fillRect(27, 94, 48, 7);
        g.strokeStyle = '#56351f'; g.lineWidth = 4; [[31, 105], [68, 105]].forEach(p => { g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0], 116); g.stroke(); });
    }
    return g.getImageData(0, 0, c.width, c.height);
}

function ensureDecorationImages() {
    if (!map || !map.isStyleLoaded()) return;
    DECORATION_LIBRARY.forEach(item => {
        try {
            if (!map.hasImage(item.icon)) map.addImage(item.icon, drawDecorationImage(item.id), { pixelRatio: 2 });
        } catch (err) { console.warn('装飾スプライト登録に失敗:', item.id, err); }
    });
}

function addDecorationLayers() {
    ensureDecorationImages();
    if (!map.getSource('decorations')) {
        map.addSource('decorations', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer('decorations-symbol')) {
        map.addLayer({
            id: 'decorations-symbol',
            type: 'symbol',
            source: 'decorations',
            layout: {
                'icon-image': ['get', 'icon'],
                'icon-size': ['coalesce', ['to-number', ['get', 'scale']], 1],
                'icon-anchor': 'bottom',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-pitch-alignment': 'viewport',
                'icon-rotation-alignment': 'viewport',
                'symbol-sort-key': ['coalesce', ['to-number', ['get', 'sortKey']], 0]
            },
            paint: { 'icon-opacity': 0.98 }
        });
    }
    renderDecorations();
}

function renderDecorations() {
    const src = map.getSource && map.getSource('decorations');
    if (!src) return;
    const features = (window.DECORATIONS || []).filter(d => d && d.lat != null && d.lng != null).map((d, i) => {
        const item = DECORATION_BY_ID[d.asset] || DECORATION_LIBRARY[0];
        const scale = Math.max(0.35, Math.min(2.2, Number(d.scale || item.scale || 1)));
        return {
            type: 'Feature',
            properties: { icon: item.icon, scale, asset: item.id, sortKey: 100000 - Number(d.lat) * 1000 + i * 0.001 },
            geometry: { type: 'Point', coordinates: [Number(d.lng), Number(d.lat)] }
        };
    });
    src.setData({ type: 'FeatureCollection', features });
}
window.renderDecorations = renderDecorations;

// 🖼 配置スプライト(差し替え建物・キャラ)の描画
let placementMarkers = [];
function renderPlacements() {
    placementMarkers.forEach(m => m.remove());
    placementMarkers = [];
    // イベントの対象建物(マスク済み)のスプライトも常時表示する
    (window.EVENT_POINTS || []).forEach(ev => {
        if (!ev.eventPoint) return;
        const src = ev._iconPreviewUrl || ev.eventPoint.icon;
        if (!src) return;
        const el = document.createElement('div');
        el.className = 'placement-sprite';
        el.innerHTML = `<img src="${src}" style="width:64px; height:auto; display:block; filter: drop-shadow(0 0 8px rgba(255,200,110,0.5)) drop-shadow(0 4px 5px rgba(5,8,25,0.55));">`;
        placementMarkers.push(new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([ev.eventPoint.lng, ev.eventPoint.lat]).addTo(map));
    });
    (window.PLACEMENTS || []).forEach(p => {
        if (!p.asset || p.lat == null) return;
        const w = p.type === 'character' ? 44 : 64;
        const el = document.createElement('div');
        el.className = 'placement-sprite';
        el.innerHTML = `<img src="${p.asset}" style="width:${w}px; height:auto; display:block; filter: drop-shadow(0 0 8px rgba(255,200,110,0.5)) drop-shadow(0 4px 5px rgba(5,8,25,0.55));">`;
        placementMarkers.push(new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([p.lng, p.lat]).addTo(map));
    });
}
window.renderPlacements = renderPlacements;

// ============ 🌗 テーマ切替（夕方 ⇔ 朝） ============
const themeBtn = document.getElementById('theme-btn');
const THEME_ICONS = { evening: '🌇', morning: '🌅', day: '☀️' };
function setTheme(t) {
    THEME = t;
    PAL = themePalette(t);
    applyBodyTheme();
    themeBtn.innerText = THEME_ICONS[t] || '🌇';
    stopEls.forEach(el => { el.innerHTML = busStopSvgHtml(); });
    map.setStyle(buildStyle());
    // レイヤーの復元は styledata → ensureRouteLayers が自動で行います
}
// 🌇 夕方 → 🌅 朝 → ☀️ 昼 → 🌇 … の順にサイクル切替
themeBtn.addEventListener('click', () => {
    const order = ['evening', 'morning', 'day'];
    const next = order[(order.indexOf(THEME) + 1) % order.length];
    setTheme(next);
    showToast({
        evening: '🌇 夕暮れのまちに切り替えました。あかりの灯る時間です。',
        morning: '🌅 朝のまちに切り替えました。すがすがしい運行をお楽しみください。',
        day:     '☀️ 昼のまちに切り替えました。'
    }[next], 3000);
});
themeBtn.innerText = THEME_ICONS[THEME] || '🌇';

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
    // ※ 開始時のvoice.wav一斉再生は廃止。音声はエディターで各区間に割り当てたものだけが流れます
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
// エディターが区間を編集した際に発火状態をリセットするためのフック
window.__narrReset = () => { narrLap = -1; narrPtr = 0; narrLastShowElapsed = -1; };
function updateNarration(lap, pos, elapsedNow) {
    if (!HAS_NARRATION) return;
    if (lap !== narrLap) { narrLap = lap; narrPtr = 0; narrLastShowElapsed = -1; }

    // イベントメッセージ表示中は発動を待機（イベント終了後に表示されます）
    if (subtitleOwner === 'event') return;

    // 発火判定: narrPtr以降で最初に半径内へ入った区間を発火する。
    // 手前の区間が未発火でも「順番待ちでブロック」せず、追い越して発火できる
    // (エディターで後方に追加した区間の動作確認や、座標の粗い区間の素通り対策)。
    let fired = false;
    for (let i = narrPtr; i < NARRATION.length; i++) {
        const n = NARRATION[i];
        if (n.lat != null && distM(pos, n) <= (ROUTE_CONFIG.narrationRadius || 8)) {
            showSubtitle(n.text || ('🎵 ' + (n.name || '区間' + (i + 1))), null, 'narration');
            // 🎵 区間音声: audio_file が指定されていれば再生(週フォルダから取得)
            if (n.audio && bgmEnabled) {
                narrAudio.src = `scenario/audio/${window.WEEK_ID}/${n.audio}`;
                narrAudio.currentTime = 0;
                narrAudio.play().catch(err => console.warn('区間音声を再生できません:', narrAudio.src, err));
            }
            narrLastShowElapsed = elapsedNow;
            narrPtr = i + 1;
            fired = true;
            break;
        }
    }
    if (!fired && narrPtr >= NARRATION.length && subtitleOwner === 'narration' && narrLastShowElapsed >= 0
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

    // 点線（GPU描画・にじみ付き）。rout未指定ならトリガー→対象建物の直行ルート
    let dashPath = (ev.routPoints || []).map(p => [p[1], p[0]]);
    if (!dashPath.length && ev.eventPoint) {
        const origin = ev.fromStop || ev.trigger; // 🚏 始点はバス停(未設定ならトリガー)
        dashPath = [[origin.lng, origin.lat]];
    }
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

    }

    clearTimeout(eventClearTimer);
    eventClearTimer = setTimeout(clearEventFx, showMs);
}
window.clearEventFx = clearEventFx;
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

function syncRunningUiState() {
    document.body.classList.toggle('bus-running', running);
    if (window.__updateMaskRegionVisibility) window.__updateMaskRegionVisibility();
}

function fmt(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 周回内時刻(秒) → 走行距離(m)
function distAtTime(tInLoop) {
    let entry = timeline[0];
    for (const e of timeline) { if (tInLoop >= e.tStart && tInLoop < e.tEnd) { entry = e; break; } }
    if (entry.type === 'dwell') return { dist: entry.dStart, entry };
    const r = (tInLoop - entry.tStart) / (entry.tEnd - entry.tStart);
    return { dist: entry.dStart + (entry.dEnd - entry.dStart) * r, entry };
}

// 区間ポイントのルート上距離(シーク時の再アーム計算用)
function pointRouteDist(p) {
    let best = 0, min = 1e18;
    for (let i = 1; i < routePoints.length; i++) {
        const A = routePoints[i - 1], B = routePoints[i];
        const dx = B.lng - A.lng, dy = B.lat - A.lat;
        const t = Math.max(0, Math.min(1, ((p.lng - A.lng) * dx + (p.lat - A.lat) * dy) / (dx * dx + dy * dy || 1)));
        const q = { lat: A.lat + dy * t, lng: A.lng + dx * t };
        const d = distM(p, q);
        if (d < min) { min = d; best = cumDist[i - 1] + distM(A, q); }
    }
    return best;
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

    const { dist, entry } = distAtTime(tInLoop);
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
        if (distM(pos, ev._trigger) <= (ev.radius || ROUTE_CONFIG.triggerRadius || 8)) {
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
    if (seekRange && !seeking) seekRange.value = tInLoop;
    if (seekTime) seekTime.innerText = fmt(tInLoop);
    statusMain.innerText = `運行中 ${fmt(tInLoop)} / ${fmt(LOOP_SEC)}`;
    statusSub.innerText = entry.type === 'dwell'
        ? `${lap + 1}周目 ・ ${ptName}に停車しております`
        : `${lap + 1}周目 ・ 次は ${ptName} です`;

    requestAnimationFrame(tick);
}

startBtn.addEventListener('click', () => {
    running = !running;
    syncRunningUiState();
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

// ⏩ シークバー(エディター表示時のみ)。ドラッグでバスを任意の時刻へワープ
const seekRange = document.getElementById('seek-range');
const seekTime = document.getElementById('seek-time');
let seeking = false;
if (seekRange) {
    seekRange.max = LOOP_SEC;
    seekRange.addEventListener('pointerdown', () => { seeking = true; });
    window.addEventListener('pointerup', () => { seeking = false; });
    seekRange.addEventListener('input', () => seekTo(Number(seekRange.value)));
}

// 指定時刻へワープ。通過済みトリガーは位置に応じて再アーム(戻れば再発動できる)
function seekTo(sec) {
    elapsed = Math.max(0, Math.min(sec, LOOP_SEC - 0.05));
    const { dist } = distAtTime(elapsed);
    firedEvents = new Set();                       // イベントは現在位置より先で再発動可能に
    narrLap = 0;
    narrPtr = 0;                                   // 区間: 現在位置より手前のものは発動済み扱い
    const list = window.NARRATION || [];
    for (let i = 0; i < list.length; i++) {
        if (list[i].lat != null && pointRouteDist(list[i]) <= dist + 1) narrPtr = i + 1; else break;
    }
    narrLastShowElapsed = elapsed;
    renderAt(elapsed);                             // 停止中でも即座に反映
}
window.seekTo = seekTo;

// 一回だけ位置・カメラ・表示を描く(時間は進めない)
function renderAt(t) {
    const tInLoop = t % LOOP_SEC;
    const { dist, entry } = distAtTime(tInLoop);
    const pos = distToLatLng(dist);
    busMarker.setLngLat([pos.lng, pos.lat]);
    if (followMode) {
        cam = { lat: pos.lat, lng: pos.lng };
        map.jumpTo({ center: [pos.lng, pos.lat], zoom: LOCK ? ZOOM : map.getZoom(), pitch: PITCH, bearing: BEAR });
    }
    if (seekTime) seekTime.innerText = fmt(tInLoop);
    if (seekRange && !seeking) seekRange.value = tInLoop;
    const ptName = routePoints[entry.ptIndex]?.name || '次の停留所';
    statusMain.innerText = `${running ? '運行中' : '位置確認'} ${fmt(tInLoop)} / ${fmt(LOOP_SEC)}`;
    statusSub.innerText = `次は ${ptName} です`;
}

// 🔁 バスを開始位置に戻す(運行のやり直し)
// 位置と時間だけ最初に戻す。再生中の音声・表示中の演出はそのまま継続する(調整作業向け)
document.getElementById('reset-btn').addEventListener('click', () => {
    lastFrame = null;
    lastLng = routePoints[0].lng;
    seekTo(0);
    setFollow(true);
    showToast('🔁 開始位置からやり直します(音声・演出は継続)。', 2500);
});

// 🧹 全リセット: 音声停止・演出消去・待機状態まで完全に初期化する
document.getElementById('clear-btn').addEventListener('click', () => {
    running = false;
    syncRunningUiState();
    startBtn.innerText = '▶ 運行スタート';
    startBtn.classList.remove('running');
    statusPanel.classList.remove('running');
    stopAudio();
    narrAudio.pause(); narrAudio.currentTime = 0;
    clearEventFx();
    hideSubtitle();
    lastFrame = null;
    lastLng = routePoints[0].lng;
    seekTo(0);
    setFollow(true);
    statusMain.innerText = '待機中';
    statusSub.innerText = 'スタートを押すと運行を開始します';
    showToast('🧹 すべてリセットしました。', 2500);
});

// 🗺️ バスの位置へ戻るボタン
document.getElementById('fit-btn').addEventListener('click', () => {
    const p = busMarker.getLngLat();
    map.easeTo({ center: [p.lng, p.lat], zoom: LOCK ? ZOOM : map.getZoom(), pitch: PITCH, bearing: BEAR, duration: 900 });
    setTimeout(() => setFollow(true), 950);
    showToast('🗺️ バスの位置に表示を戻しました。', 2000);
});

// ✏️ エディターの切替(ボタン1つでON/OFF。?edit=1でも従来どおり起動する)
const editBtn = document.getElementById('edit-btn');
editBtn.addEventListener('click', () => {
    if (document.body.classList.contains('editing')) {
        window.__setEditorActive && window.__setEditorActive(false);
        editBtn.classList.remove('active');
    } else if (window.__setEditorActive) {
        window.__setEditorActive(true);
        editBtn.classList.add('active');
    } else {
        const s = document.createElement('script');
        s.src = 'editor.js?v=7.0.8';
        s.onload = () => editBtn.classList.add('active');
        document.body.appendChild(s);
    }
});

// 起動メッセージ
const stopCount = routePoints.slice(0, -1).filter(p => p.isStop).length;
showToast(`🚌 ${window.WEEK_ID ? window.WEEK_ID + '週の放送データ' : '内蔵データ'}を読み込みました。停留所 ${stopCount} か所・全長 約${(totalDist / 1000).toFixed(1)}km です。`, 5000);
