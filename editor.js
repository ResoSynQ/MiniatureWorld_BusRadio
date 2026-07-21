/**
 * 🛠 週次シナリオエディター MVP Ver 1.0 (URLに ?edit=1 を付けると起動)
 * ============================================================
 * できること(今回のMVP範囲):
 *  ・🎙 音声モード: ルート上クリックで区間開始点を追加/ドラッグ移動/
 *    台本テキスト・音声ファイル名の編集/音声ファイルのドロップ割当(名前登録)
 *  ・🎪 イベントモード: クリックでイベント追加/ドラッグ移動/メッセージ・URL・画像
 *  ・状態バッジ 🟢編集済 🟡前週コピーのまま 🔴問題あり(音声未割当・ルートから遠い等)
 *  ・bus_radio_<週>.json として保存(File System Access API / 非対応時はダウンロード)
 * 次回以降: WAV→MP3自動変換 / シークバー試聴 / 建物差し替えマスク / 公開前フルチェック
 * ============================================================
 */
(function () {
    const WEEK = window.WEEK_ID || '未設定週';
    // 編集対象データ(読み込まれた週データを起点にする)
    const S = {
        regions: (window.MASK_REGIONS || []).map(r => ({ ...r, _status: 'copy' })),
        sections: (window.NARRATION || []).map(n => ({ ...n, _status: 'copy' })),
        events: (window.EVENT_POINTS || []).map(e => ({
            trigger: { ...e.trigger }, radius: e.radius || 30, message: e.message || '', url: e.url || '',
            routPoints: (e.routPoints || []).map(p => [...p]),
            eventPoint: e.eventPoint ? { ...e.eventPoint } : null, _status: 'copy'
        })),
        placements: (window.PLACEMENTS || []).map(p => ({ ...p, _status: 'copy' })),
        decorations: (window.DECORATIONS || []).map(d => ({
            asset: d.asset || 'tree-round', lat: +d.lat, lng: +d.lng,
            scale: +(d.scale || 1), _status: 'copy'
        }))
    };
    let mode = 'audio'; // 'audio' | 'event' | 'building' | 'decor'
    let pendingBuildingPick = null; // 「対象建物を指定」待ちのイベントindex
    let pendingPathDraw = null;     // 「経路の手描き」中のイベントindex
    let pendingStopPick = null;     // 「バス停を選択」待ちのイベントindex
    let draftPoints = [];           // 作成中のマスク多角形の頂点
    const REGION_MAX_POINTS = 6;    // この点数で自動確定

    function updateMaskDraft() {
        if (!map.getSource('mask-draft')) return;
        const feats = draftPoints.map(p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p } }));
        if (draftPoints.length >= 2) {
            const line = draftPoints.length >= 3 ? [...draftPoints, draftPoints[0]] : draftPoints;
            feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: line } });
        }
        if (draftPoints.length >= 3) {
            feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...draftPoints, draftPoints[0]]] } });
        }
        map.getSource('mask-draft').setData({ type: 'FeatureCollection', features: feats });
    }
    function commitRegion() {
        if (draftPoints.length < 3) { showEditorToast('⚠ マスク領域は3点以上必要です。'); return; }
        pushUndo();
        S.regions.push({ points: draftPoints.slice(), _status: 'edited' });
        draftPoints = [];
        updateMaskDraft();
        syncLivePreview(); render();
        showEditorToast('🏠 マスク領域を追加しました。領域内の建物が非表示になります。');
    }
    // ダブルクリックで即確定
    map.on('dblclick', (ev) => {
        if (mode === 'building' && document.body.classList.contains('editing') && draftPoints.length >= 3) {
            ev.preventDefault();
            commitRegion();
        }
    });
    let savedPitch = null;          // 建物指定前のカメラ傾きを退避

    // 🏠 建物指定の開始/終了: 斜めカメラだとクリック位置が奥へズレる(視差)ため、
    // 指定中だけ真上からの表示(pitch 0)に切り替えて正確に選べるようにする
    function beginBuildingPick(idx) {
        pendingBuildingPick = idx;
        if (savedPitch === null) savedPitch = map.getPitch();
        map.easeTo({ pitch: 0, duration: 500 });
        showEditorToast('🏠 真上からの表示に切り替えました。差し替えたい建物をクリックしてください。');
    }
    function endBuildingPick() {
        pendingBuildingPick = null;
        if (savedPitch !== null) { map.easeTo({ pitch: savedPitch, duration: 500 }); savedPitch = null; }
    }
    let selected = null; // {kind:'section'|'event', idx}
    const markers = [];
    const DECOR_LIB = window.DECORATION_LIBRARY || [
        { id: 'tree-round', label: '🌳 樹木A', scale: 1 },
        { id: 'sakura', label: '🌸 桜', scale: 1 },
        { id: 'pine', label: '🌲 針葉樹', scale: 1 },
        { id: 'hedge', label: '🌿 植込み', scale: 0.8 }
    ];
    const DECOR_BY_ID = Object.fromEntries(DECOR_LIB.map(d => [d.id, d]));
    function decorLabel(id) { return (DECOR_BY_ID[id] && DECOR_BY_ID[id].label) || id || '装飾'; }
    function decorOptions(value) {
        return DECOR_LIB.map(d => `<option value="${d.id}"${d.id === value ? ' selected' : ''}>${d.label}</option>`).join('');
    }

    function updateMaskRegionVisibility() {
        const showEditorMasks = document.body.classList.contains('editing')
            && !document.body.classList.contains('bus-running');
        ['mask-regions-fill', 'mask-regions-line'].forEach(id => {
            try { map.setLayoutProperty(id, 'visibility', showEditorMasks ? 'visible' : 'none'); } catch (err) {}
        });
        ['mask-draft-fill', 'mask-draft-line', 'mask-draft-pt'].forEach(id => {
            try { map.setLayoutProperty(id, 'visibility', showEditorMasks && mode === 'building' ? 'visible' : 'none'); } catch (err) {}
        });
    }
    window.__updateMaskRegionVisibility = updateMaskRegionVisibility;

    // 🔛 エディターのON/OFF切替(✏️ボタン / ?edit=1 の両方から使う)
    window.__setEditorActive = function (on) {
        document.body.classList.toggle('editing', on);
        try {
            if (on) {
                map.setMinZoom(1); map.setMaxZoom(20);
                map.scrollZoom.enable(); map.doubleClickZoom.enable();
                map.touchZoomRotate.enable(); map.touchZoomRotate.disableRotation();
                map.keyboard.enable();
            } else {
                // 閲覧モードのズーム固定に戻す
                if (ROUTE_CONFIG.lockZoom) {
                    const z = ROUTE_CONFIG.fixedZoom || 18.5;
                    map.setMinZoom(z); map.setMaxZoom(z);
                    map.scrollZoom.disable(); map.doubleClickZoom.disable();
                    map.touchZoomRotate.disable(); map.keyboard.disable();
                }
                endBuildingPick();
                pendingPathDraw = null;
                pendingStopPick = null;
            }
        } catch (err) {}
        updateMaskRegionVisibility();
        if (window.updateRegionOutlines) window.updateRegionOutlines();
        const eb = document.getElementById('edit-btn');
        if (eb) eb.classList.toggle('active', on);
    };
    window.__setEditorActive(true); // 読み込み時はONで開始

    // 🎚 WAV→MP3変換ライブラリ(lamejs)を読み込む
    const lameScript = document.createElement('script');
    lameScript.src = 'https://unpkg.com/lamejs@1.2.0/lame.min.js'; // ※1.2.1はMPEGMode未定義バグがあるため1.2.0を使用
    document.body.appendChild(lameScript);

    // 📁 フォルダ接続(File System Access API)。接続するとMP3の自動保存が有効になる
    let dirHandle = null;
    async function writeFile(pathParts, blob) {
        let d = dirHandle;
        for (const p of pathParts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
        const fh = await d.getFileHandle(pathParts[pathParts.length - 1], { create: true });
        const w = await fh.createWritable(); await w.write(blob); await w.close();
    }
    const audioWeekDir = () => /\d{4}-\d{2}-\d{2}/.test(WEEK) ? WEEK : 'local';

    // 🎚 WAV → MP3 (モノラル44.1kHz/128kbps)。1ファイル数秒で完了する
    async function wavToMp3(file) {
        const buf = await file.arrayBuffer();
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const decoded = await ac.decodeAudioData(buf); ac.close();
        const rate = 44100;
        const oc = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
        const src = oc.createBufferSource(); src.buffer = decoded; src.connect(oc.destination); src.start();
        const mono = (await oc.startRendering()).getChannelData(0);
        const pcm = new Int16Array(mono.length);
        for (let i = 0; i < mono.length; i++) { const v = Math.max(-1, Math.min(1, mono[i])); pcm[i] = v < 0 ? v * 32768 : v * 32767; }
        const enc = new lamejs.Mp3Encoder(1, rate, 128);
        const out = [];
        for (let i = 0; i < pcm.length; i += 1152) { const d = enc.encodeBuffer(pcm.subarray(i, i + 1152)); if (d.length) out.push(d); }
        const tail = enc.flush(); if (tail.length) out.push(tail);
        return new Blob(out, { type: 'audio/mpeg' });
    }

    // 🛣 道路に沿った経路の自動取得(OSRM)。取得結果はJSONに保存され、閲覧側は描くだけ
    async function fetchRoadRoute(e0) {
        if (!e0.eventPoint) return false;
        const a = e0.fromStop || e0.trigger, b = e0.eventPoint; // 🚏 始点はバス停優先
        const straight = dM(a, { lat: b.lat, lng: b.lng });
        // 徒歩ルート(FOSSGIS)を優先し、ダメなら車ルート(OSRM)で再試行
        const urls = [
            `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`,
            `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`
        ];
        for (const url of urls) {
            try {
                const res = await fetch(url);
                const j = await res.json();
                const coords = j.routes && j.routes[0] && j.routes[0].geometry.coordinates;
                if (!coords || coords.length < 2) continue;
                // 経路長を検算: 直線距離の3倍を超える大回りは不採用(一方通行の迂回など)
                let len = 0;
                for (let i = 1; i < coords.length; i++) {
                    len += dM({ lat: coords[i-1][1], lng: coords[i-1][0] }, { lat: coords[i][1], lng: coords[i][0] });
                }
                console.log('🛣[診断]', url.includes('routed-foot') ? '徒歩' : '車', 'ルート:',
                            '直線', straight.toFixed(0) + 'm', '/ 経路', len.toFixed(0) + 'm');
                if (len > Math.max(straight * 3, straight + 300)) continue; // 大回りは次の候補へ
                e0.routPoints = coords.map(c => [c[1], c[0]]); // [lat,lng]で保存
                e0._status = 'edited';
                return true;
            } catch (err) { console.warn('経路取得失敗:', url, err); }
        }
        return false;
    }

    // 📐 点がリング(多角形)の内側にあるか判定(レイキャスティング法)
    function pointInRing(pt, ring) { // pt=[lng,lat], ring=[[lng,lat],...]
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
            if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
    }
    // 建物ジオメトリから外周リング一覧を取り出す
    function ringsOf(g) {
        if (g.type === 'Polygon') return [g.coordinates[0]];
        if (g.type === 'MultiPolygon') return g.coordinates.map(p => p[0]);
        return [];
    }
    // クリック地点を含む建物リングを選ぶ。複数棟の建物(MultiPolygon)でも
    // 「実際にクリックした棟」だけを正しく掴む
    function pickBuildingRing(feats, lngLat) {
        const pt = [lngLat.lng, lngLat.lat];
        for (const f of feats) {
            for (const r of ringsOf(f.geometry)) {
                if (pointInRing(pt, r)) return r;
            }
        }
        // 内包で見つからない場合(境界クリック等)は、中心が最も近いリングを採用
        let best = null, min = 1e18;
        for (const f of feats) {
            for (const r of ringsOf(f.geometry)) {
                const c = r.reduce((s, p) => [s[0] + p[0] / r.length, s[1] + p[1] / r.length], [0, 0]);
                const d = dM({ lat: lngLat.lat, lng: lngLat.lng }, { lat: c[1], lng: c[0] });
                if (d < min) { min = d; best = r; }
            }
        }
        return best;
    }

    // 🔎 建物選択の前提チェック: ズームが低いと建物が「結合ブロック」になっており、
    // 1軒のつもりで区画ごとマスクされてしまう。個別データになるズーム(16以上)まで自動で寄せる。
    function ensurePickZoom(ev, feats) {
        const z = map.getZoom();
        const merged = feats && feats[0] && feats[0].geometry.type === 'MultiPolygon' && feats[0].geometry.coordinates.length > 3;
        if (z < 15.8 || merged) {
            map.easeTo({ center: ev.lngLat, zoom: Math.max(17, z), duration: 600 });
            showEditorToast('🔎 建物を1軒ずつ選べる縮尺まで拡大しました。もう一度、対象の建物をクリックしてください。');
            console.log('🏠[診断] ズーム不足or結合ブロックのため拡大(zoom:', z.toFixed(1), '/ 結合:', !!merged, ')');
            return false;
        }
        return true;
    }

    // 📐 点がポリゴン(リング)の内側にあるか判定
    function pointInRing(lng, lat, ring) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
            if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
    }
    // 🏠 クリック地点に対して正しい建物リングを選ぶ:
    //  1. クリック点を「実際に含む」リングを最優先(マルチポリゴンの別棟誤選択を防ぐ)
    //  2. 無ければ中心がクリック点に最も近いリング
    function pickBuildingRing(feats, lngLat) {
        const candidates = [];
        feats.slice(0, 6).forEach(f => {
            const g = f.geometry;
            const polys = g.type === 'Polygon' ? [g.coordinates] : (g.type === 'MultiPolygon' ? g.coordinates : []);
            polys.forEach(poly => { if (poly[0] && poly[0].length >= 4) candidates.push(poly[0]); });
        });
        if (!candidates.length) return null;
        for (const ring of candidates) {
            if (pointInRing(lngLat.lng, lngLat.lat, ring)) {
                console.log('🏠[診断] クリック点を含むリングを採用(候補' + candidates.length + '件)');
                return ring;
            }
        }
        let best = candidates[0], min = 1e18;
        for (const ring of candidates) {
            const c = ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length], [0, 0]);
            const d = dM({ lat: lngLat.lat, lng: lngLat.lng }, { lat: c[1], lng: c[0] });
            if (d < min) { min = d; best = ring; }
        }
        console.log('🏠[診断] 含有リングなし。最寄りリングを採用(ずれ ' + min.toFixed(1) + 'm / 候補' + candidates.length + '件)');
        return best;
    }

    // 🧲 ルート吸着: 任意の座標を、ルート線上の最も近い点へスナップする
    function snapToRoute(p) {
        const pts = (window.ROUTE_POINTS || []).map(r => ({ lat: r.lat, lng: r.lng }));
        if (pts.length < 2) return { lat: p.lat, lng: p.lng };
        pts.push(pts[0]);
        let best = { lat: p.lat, lng: p.lng }, min = 1e18;
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i];
            const dx = b.lng - a.lng, dy = b.lat - a.lat;
            const t = Math.max(0, Math.min(1, ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / (dx * dx + dy * dy || 1)));
            const q = { lat: a.lat + dy * t, lng: a.lng + dx * t };
            const d = dM(p, q);
            if (d < min) { min = d; best = q; }
        }
        return best;
    }

    // ↩ アンドゥ: 変更前スナップショットを積む(最大30段)。Ctrl+Z対応
    const undoStack = [];
    let lastUndoKey = null;
    function snapshot() { return JSON.parse(JSON.stringify({ regions: S.regions, sections: S.sections, events: S.events, placements: S.placements, decorations: S.decorations })); }
    function pushUndo(key) {
        if (key && key === lastUndoKey) return; // 同一フィールド連続入力は1回だけ積む
        lastUndoKey = key || null;
        undoStack.push(snapshot());
        if (undoStack.length > 30) undoStack.shift();
    }
    function doUndo() {
        if (!undoStack.length) { showEditorToast('↩ これ以上取り消せる操作はありません。'); return; }
        const s0 = undoStack.pop();
        S.regions = s0.regions || S.regions; S.sections = s0.sections; S.events = s0.events; S.placements = s0.placements; S.decorations = s0.decorations || S.decorations;
        lastUndoKey = null; selected = null;
        if (window.clearEventFx) window.clearEventFx();
        syncLivePreview(); render();
        showEditorToast('↩ 1つ前の状態に戻しました。');
    }
    document.addEventListener('keydown', ev => {
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); doUndo(); }
    });

    function refreshMasks() { if (window.forceRebuildMasks) window.forceRebuildMasks(); if (window.updateRegionOutlines) window.updateRegionOutlines(); }
    // 🔄 ライブ同期: エディターの編集内容を、動作中のプレビュー(app.js)へ即時反映する。
    // route-data.js/narration.js は var 宣言のため、window.X への代入がそのまま
    // app.js側の裸の変数参照にも反映される(constだとこれが効かないので要注意)。
    function syncLivePreview() {
        window.NARRATION = S.sections.map(n => ({ lat: n.lat, lng: n.lng, text: n.text, audio: n.audio, name: n.name, _previewUrl: n._previewUrl || null }));
        window.EVENT_POINTS = S.events.map(e => ({
            trigger: { lat: e.trigger.lat, lng: e.trigger.lng }, message: e.message, url: e.url,
            radius: e.radius, routPoints: e.routPoints, eventPoint: e.eventPoint,
            fromStop: e.fromStop || null, mask: e.mask || null, maskIds: e.maskIds || null,
            _iconPreviewUrl: e._iconPreviewUrl || null,
            _trigger: { lat: e.trigger.lat, lng: e.trigger.lng } // app.js起動後の追加分は_triggerも直接持たせる
        }));
        // app.jsのEVENT_POINTS.forEach(ev=>{ev._trigger=...}) 初期化は起動時のみ実行されるため、
        // ライブ追加したイベントにも _trigger を明示的に持たせておく(上でセット済み)。
        window.MASK_REGIONS = S.regions.map(r => ({ points: r.points }));
        refreshMasks();
        window.PLACEMENTS = S.placements.map(p => ({ type: p.type, lat: p.lat, lng: p.lng, asset: p.asset, anim: p.anim }));
        window.DECORATIONS = S.decorations.map(d => ({ asset: d.asset || 'tree-round', lat: d.lat, lng: d.lng, scale: +(d.scale || 1) }));
        if (window.applyBuildingMasks) window.applyBuildingMasks();
        if (window.renderPlacements) window.renderPlacements();
        if (window.renderDecorations) window.renderDecorations();
    }

    // ============ UI 構築 ============
    const bar = document.createElement('div');
    bar.id = 'editor-bar';
    bar.innerHTML = `
      <div id="ed-title-row">
        <div id="ed-title">🛠 エディター <b>${WEEK}</b>週</div>
        <button id="ed-exit" title="編集を閉じて閲覧に戻る">▶ 閲覧に戻る</button>
      </div>
      <div id="ed-tabs">
        <button id="ed-tab-audio" class="ed-tab active">🎙 音声</button>
        <button id="ed-tab-event" class="ed-tab">🎪 イベント</button>
        <button id="ed-tab-building" class="ed-tab">🏠 建物マスク</button>
        <button id="ed-tab-decor" class="ed-tab">🌿 植栽</button>
      </div>
      <button id="ed-connect">📁 フォルダ接続(MP3自動保存)</button>
      <div id="ed-hint">🎙: 地図クリックで区間開始点を追加 / ピンはドラッグで移動</div>
      <div id="ed-list"></div>
      <div id="ed-form"></div>
      <div id="ed-actions">
        <button id="ed-undo" title="Ctrl+Z">↩ 取り消し</button>
        <button id="ed-save">💾 保存 (JSON)</button>
        <button id="ed-load">📂 読込</button>
      </div>
      <button id="ed-clear-all" class="ed-danger">🗑 音声・イベントを全消去</button>`;
    document.body.appendChild(bar);
    const listEl = bar.querySelector('#ed-list');
    const formEl = bar.querySelector('#ed-form');

    bar.querySelector('#ed-tab-audio').onclick = () => setMode('audio');
    bar.querySelector('#ed-tab-event').onclick = () => setMode('event');
    bar.querySelector('#ed-tab-building').onclick = () => setMode('building');
    bar.querySelector('#ed-tab-decor').onclick = () => setMode('decor');
    bar.querySelector('#ed-exit').onclick = () => {
        if (window.__setEditorActive) window.__setEditorActive(false);
        showEditorToast('▶ 閲覧モードに戻りました。');
    };
    bar.querySelector('#ed-connect').onclick = async () => {
        try {
            dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            bar.querySelector('#ed-connect').innerText = '📁 接続済み: ' + dirHandle.name;
            showEditorToast('📁 フォルダに接続しました。以後、WAVドロップでMP3が自動保存されます。');
        } catch (err) {
            if (err && err.name !== 'AbortError') showEditorToast('📁 このブラウザ/開き方ではフォルダ接続が使えません。変換後のMP3はダウンロードされます。');
        }
    };
    function setMode(m) {
        if (m !== 'building') { draftPoints = []; try { map.getSource('mask-draft').setData({ type: 'FeatureCollection', features: [] }); } catch (e) {} }
        // 🏠 建物マスクモード中は真上視点(視差防止)。抜けたら元に戻す
        if (m === 'building' && savedPitch === null) { savedPitch = map.getPitch(); map.easeTo({ pitch: 0, duration: 500 }); }
        if (m !== 'building' && mode === 'building' && pendingBuildingPick === null && savedPitch !== null) {
            map.easeTo({ pitch: savedPitch, duration: 500 }); savedPitch = null;
        }
        mode = m; selected = null;
        bar.querySelector('#ed-tab-audio').classList.toggle('active', m === 'audio');
        bar.querySelector('#ed-tab-event').classList.toggle('active', m === 'event');
        bar.querySelector('#ed-tab-building').classList.toggle('active', m === 'building');
        bar.querySelector('#ed-tab-decor').classList.toggle('active', m === 'decor');
        updateMaskRegionVisibility();
        bar.querySelector('#ed-hint').innerText = m === 'audio'
            ? '🎙: 地図クリックで区間開始点を追加 / ピンはドラッグで移動'
            : m === 'event'
            ? '🎪: 地図クリックでイベントを追加 / ピンはドラッグで移動'
            : m === 'building'
            ? '🏠: 消したい範囲の角を順にクリック(6点で自動確定 / ダブルクリックで即確定)。領域内の建物が消えます'
            : '🌿: 地図クリックで植栽・街具を配置 / ピンはドラッグで移動。種類とサイズは右下フォームで変更できます';
        render();
    }

    // ============ 判定ユーティリティ ============
    function dM(a, b) {
        const R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180,
            dLng = (b.lng - a.lng) * Math.PI / 180 * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180);
        return R * Math.hypot(dLat, dLng);
    }
    function distToRoute(p) {
        const pts = (window.ROUTE_POINTS || []).map(r => ({ lat: r.lat, lng: r.lng }));
        if (pts.length < 2) return 0;
        pts.push(pts[0]);
        let min = 1e9;
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i];
            const dx = b.lng - a.lng, dy = b.lat - a.lat;
            const t = Math.max(0, Math.min(1, ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / (dx * dx + dy * dy || 1)));
            min = Math.min(min, dM(p, { lat: a.lat + dy * t, lng: a.lng + dx * t }));
        }
        return min;
    }
    function badge(item, kind) {
        if (kind === 'section') {
            if (!item.audio) return '🔴';
            if (distToRoute(item) > 15) return '🔴';
        } else {
            if (distToRoute(item.trigger) > 15) return '🔴';
            if (!item.message) return '🔴';
        }
        return item._status === 'edited' ? '🟢' : '🟡';
    }
    function warnText(item, kind) {
        const w = [];
        if (kind === 'section') {
            if (!item.audio) w.push('音声未割当');
            const d = distToRoute(item);
            if (d > 15) w.push(`ルートから${d.toFixed(0)}m`);
        } else {
            const d = distToRoute(item.trigger);
            if (d > 15) w.push(`ルートから${d.toFixed(0)}m(素通りの恐れ)`);
            if (!item.message) w.push('メッセージ未入力');
        }
        return w.join(' / ');
    }

    // ============ マーカー描画 ============
    function clearMarkers() { markers.forEach(m => m.remove()); markers.length = 0; }
    function pinEl(label, color, dim) {
        const d = document.createElement('div');
        d.className = 'ed-pin' + (dim ? ' dim' : '');
        d.innerHTML = `<div class="ed-pin-dot" style="background:${color}"></div><div class="ed-pin-label">${label}</div>`;
        return d;
    }
    function render() {
        clearMarkers();
        S.sections.forEach((n, i) => {
            const el = pinEl(`${badge(n, 'section')} ${n.name || '区間' + (i + 1)}${n.audio ? ' 🎵' + n.audio : ''}`, '#3f7bde', mode !== 'audio');
            const mk = new maplibregl.Marker({ element: el, draggable: mode === 'audio', anchor: 'bottom' })
                .setLngLat([n.lng, n.lat]).addTo(map);
            mk.on('dragstart', () => pushUndo());
            mk.on('dragend', () => { const p = snapToRoute(mk.getLngLat()); mk.setLngLat([p.lng, p.lat]); n.lat = p.lat; n.lng = p.lng; n._status = 'edited'; syncLivePreview(); render(); });
            el.onclick = (ev) => { ev.stopPropagation(); selected = { kind: 'section', idx: i }; renderForm(); renderList(); };
            markers.push(mk);
        });
        S.placements.forEach((p, i) => {
            const el = pinEl(`${p._status === 'edited' ? '🟢' : '🟡'} 🏠${p.asset || '(画像未設定)'}`, '#e67e22', mode !== 'building');
            const mk = new maplibregl.Marker({ element: el, draggable: mode === 'building', anchor: 'bottom' })
                .setLngLat([p.lng, p.lat]).addTo(map);
            mk.on('dragstart', () => pushUndo());
            mk.on('dragend', () => { const q = mk.getLngLat(); p.lat = q.lat; p.lng = q.lng; p._status = 'edited'; syncLivePreview(); render(); });
            el.onclick = (ev) => { ev.stopPropagation(); selected = { kind: 'placement', idx: i }; renderForm(); renderList(); };
            markers.push(mk);
        });
        S.decorations.forEach((d, i) => {
            const el = pinEl(`${d._status === 'edited' ? '🟢' : '🟡'} ${decorLabel(d.asset)}`, '#5fbf68', mode !== 'decor');
            const mk = new maplibregl.Marker({ element: el, draggable: mode === 'decor', anchor: 'bottom' })
                .setLngLat([d.lng, d.lat]).addTo(map);
            mk.on('dragstart', () => pushUndo());
            mk.on('dragend', () => {
                const q = mk.getLngLat();
                d.lat = q.lat; d.lng = q.lng; d._status = 'edited';
                syncLivePreview(); render();
            });
            el.onclick = (ev) => { ev.stopPropagation(); selected = { kind: 'decoration', idx: i }; renderForm(); renderList(); };
            markers.push(mk);
        });
        // 🏠 対象建物のピン(設定済みイベントのみ)。ドラッグで発光・画像の位置を微調整できる
        S.events.forEach((e, i) => {
            if (!e.eventPoint) return;
            const el = pinEl(`🏠 対象${i + 1}`, '#b06ae0', mode !== 'event');
            const mk = new maplibregl.Marker({ element: el, draggable: mode === 'event', anchor: 'bottom' })
                .setLngLat([e.eventPoint.lng, e.eventPoint.lat]).addTo(map);
            mk.on('dragstart', () => pushUndo());
            mk.on('dragend', () => {
                const q = mk.getLngLat();
                e.eventPoint.lat = q.lat; e.eventPoint.lng = q.lng;
                e._status = 'edited'; syncLivePreview(); render();
            });
            el.onclick = (ev) => { ev.stopPropagation(); selected = { kind: 'event', idx: i }; renderForm(); renderList(); };
            markers.push(mk);
        });
        // 🏠 各イベントの「対象建物」ピン(ドラッグで発光・画像の位置を微調整できる)
        S.events.forEach((e, i) => {
            if (!e.eventPoint) return;
            const el = pinEl(`🏠 対象${i + 1}`, '#f1c40f', mode !== 'event');
            const mk = new maplibregl.Marker({ element: el, draggable: mode === 'event', anchor: 'bottom' })
                .setLngLat([e.eventPoint.lng, e.eventPoint.lat]).addTo(map);
            mk.on('dragstart', () => pushUndo());
            mk.on('dragend', () => {
                const q = mk.getLngLat();
                e.eventPoint.lat = q.lat; e.eventPoint.lng = q.lng;
                e._status = 'edited';
                syncLivePreview(); render();
            });
            el.onclick = (ev) => { ev.stopPropagation(); selected = { kind: 'event', idx: i }; renderForm(); renderList(); };
            markers.push(mk);
        });
        S.events.forEach((e, i) => {
            const el = pinEl(`${badge(e, 'event')} イベント${i + 1}`, '#2ecc71', mode !== 'event');
            const mk = new maplibregl.Marker({ element: el, draggable: mode === 'event', anchor: 'bottom' })
                .setLngLat([e.trigger.lng, e.trigger.lat]).addTo(map);
            mk.on('dragstart', () => pushUndo());
            mk.on('dragend', () => { const p = snapToRoute(mk.getLngLat()); mk.setLngLat([p.lng, p.lat]); e.trigger.lat = p.lat; e.trigger.lng = p.lng; e._status = 'edited'; syncLivePreview(); render(); });
            el.onclick = (ev) => { ev.stopPropagation(); selected = { kind: 'event', idx: i }; renderForm(); renderList(); };
            markers.push(mk);
        });
        renderList(); renderForm();
    }

    function renderList() {
        let html = '';
        if (mode === 'audio') {
            html = S.sections.map((n, i) => {
                const w = warnText(n, 'section');
                return `<div class="ed-item ${selected && selected.kind === 'section' && selected.idx === i ? 'sel' : ''}" data-k="section" data-i="${i}">
                    ${badge(n, 'section')} <b>${n.name || '区間' + (i + 1)}</b> ${n.audio ? '🎵' : ''}<span class="ed-drop">⬇ 音声をここにドロップ</span>
                    ${w ? `<div class="ed-warn">⚠ ${w}</div>` : ''}</div>`;
            }).join('');
        } else if (mode === 'building') {
            const regs = S.regions.map((r, i) => `
                <div class="ed-item ${selected && selected.kind === 'region' && selected.idx === i ? 'sel' : ''}" data-k="region" data-i="${i}">
                    ${r._status === 'edited' ? '🟢' : '🟡'} <b>📐 マスク領域${i + 1}</b>
                </div>`).join('');
            const pls = S.placements.map((p, i) => `
                <div class="ed-item ${selected && selected.kind === 'placement' && selected.idx === i ? 'sel' : ''}" data-k="placement" data-i="${i}">
                    ${p._status === 'edited' ? '🟢' : '🟡'} <b>🖼 スプライト${i + 1}</b> ${p.asset || '⚠画像未設定'}
                </div>`).join('');
            html = regs + pls;
        } else if (mode === 'decor') {
            html = S.decorations.map((d, i) => `
                <div class="ed-item ${selected && selected.kind === 'decoration' && selected.idx === i ? 'sel' : ''}" data-k="decoration" data-i="${i}">
                    ${d._status === 'edited' ? '🟢' : '🟡'} <b>${decorLabel(d.asset)} ${i + 1}</b>
                    <div style="opacity:.72;">サイズ ${(+d.scale || 1).toFixed(2)}</div>
                </div>`).join('');
        } else {
            html = S.events.map((e, i) => {
                const w = warnText(e, 'event');
                const steps = `${e.eventPoint ? '🏠✓' : '🏠…'} ${e.eventPoint && e.eventPoint.icon ? '🖼✓' : '🖼…'} ${e.fromStop ? '🚏✓' : '🚏…'}`;
                return `<div class="ed-item ${selected && selected.kind === 'event' && selected.idx === i ? 'sel' : ''}" data-k="event" data-i="${i}">
                    ${badge(e, 'event')} <b>イベント${i + 1}</b> ${steps}<span class="ed-drop">⬇ 建物画像をドロップ</span>
                    ${e.message ? '<div style="opacity:.7;">「' + e.message.slice(0, 14) + '…」</div>' : ''}
                    ${w ? `<div class="ed-warn">⚠ ${w}</div>` : ''}</div>`;
            }).join('');
        }
        listEl.innerHTML = html || '<div style="color:#999;padding:8px;">項目がありません。地図をクリックして追加してください。</div>';
        listEl.querySelectorAll('.ed-item').forEach(div => {
            div.onclick = () => { selected = { kind: div.dataset.k, idx: +div.dataset.i }; renderForm(); renderList(); };
            // 🎵 音声ファイルのドロップ割当(ファイル名を登録。実ファイルは scenario/audio/<週>/ に配置)
            div.ondragover = ev => { ev.preventDefault(); div.classList.add('drag'); };
            div.ondragleave = () => div.classList.remove('drag');
            div.ondrop = async ev => {
                ev.preventDefault(); div.classList.remove('drag');
                const f = ev.dataTransfer.files[0];
                if (!f) return;
                // 🖼 イベントへの画像ドロップ(建物の見た目を指定)
                if (div.dataset.k === 'event') {
                    if (!/\.(png|jpe?g|webp|gif|svg)$/i.test(f.name)) { showEditorToast('🖼 画像ファイル(png/jpg/webp等)をドロップしてください。'); return; }
                    const e0 = S.events[+div.dataset.i];
                    if (!e0.eventPoint) { showEditorToast('先に「🏠 対象の建物を指定」を行ってください。'); return; }
                    pushUndo();
                    e0.eventPoint.icon = f.name;
                    e0._iconPreviewUrl = URL.createObjectURL(f); // その場でプレビュー表示
                    e0._status = 'edited';
                    try {
                        if (dirHandle) { await writeFile([f.name], f); showEditorToast(`🖼「${f.name}」を保存し、建物に適用しました。`); }
                        else showEditorToast(`🖼「${f.name}」を適用しました(プレビュー)。\nファイル本体はindex.htmlと同じフォルダに置いてください。`);
                    } catch (err) { showEditorToast('⚠ 画像の保存に失敗: ' + err); }
                    syncLivePreview(); render();
                    return;
                }
                if (div.dataset.k !== 'section') return;
                const n = S.sections[+div.dataset.i];
                pushUndo();
                const isWav = /\.wav$/i.test(f.name);
                const mp3Name = f.name.replace(/\.wav$/i, '.mp3');
                n.audio = isWav ? mp3Name : f.name;
                n._previewUrl = URL.createObjectURL(f); // 🎧 配置前でもその場で試聴再生できる
                n._status = 'edited';
                syncLivePreview(); render();
                try {
                    let mp3Blob = null;
                    if (isWav) {
                        showEditorToast('🎚 MP3へ変換中…');
                        try {
                            mp3Blob = await wavToMp3(f);
                        } catch (convErr) {
                            // 変換に失敗してもWAVのまま割当・保存して音は必ず鳴らす
                            console.warn('MP3変換失敗。WAVのまま使用します:', convErr);
                            n.audio = f.name;
                            syncLivePreview(); render();
                            if (dirHandle) { await writeFile(['scenario', 'audio', audioWeekDir(), f.name], f); }
                            showEditorToast(`⚠ MP3変換に失敗したため、WAVのまま割り当てました(再生は可能です)。\n${dirHandle ? '保存済み: scenario/audio/' + audioWeekDir() + '/' : 'scenario/audio/' + audioWeekDir() + '/ に置いてください。'}`);
                            return;
                        }
                    }
                    if (dirHandle) {
                        const wk = audioWeekDir();
                        if (mp3Blob) {
                            await writeFile(['scenario', 'audio', wk, mp3Name], mp3Blob);
                            await writeFile(['wav_master', wk, f.name], f); // 元WAVも保管
                            showEditorToast(`✅「${mp3Name}」に変換し、scenario/audio/${wk}/ へ自動保存しました。\n(元のWAVは wav_master/${wk}/ に保管)`);
                        } else {
                            await writeFile(['scenario', 'audio', wk, f.name], f);
                            showEditorToast(`✅「${f.name}」を scenario/audio/${wk}/ へ自動保存しました。`);
                        }
                    } else if (mp3Blob) {
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(mp3Blob); a.download = mp3Name; a.click();
                        showEditorToast(`🎚「${mp3Name}」に変換しました(ダウンロード)。\nscenario/audio/${audioWeekDir()}/ に置いてください。\n※📁フォルダ接続を使うと自動保存になります。`);
                    } else {
                        showEditorToast(`🎵「${f.name}」を割り当てました。scenario/audio/${audioWeekDir()}/ に置いてください。`);
                    }
                } catch (err) {
                    showEditorToast('⚠ 変換/保存に失敗しました: ' + err);
                }
            };
        });
    }

    function renderForm() {
        if (!selected) { formEl.innerHTML = '<div style="color:#999;padding:6px;">項目を選択すると内容を編集できます。</div>'; return; }
        if (selected.kind === 'region') {
            formEl.innerHTML = `
                <div style="font-size:12px; color:#c9b58a;">📐 マスク領域${selected.idx + 1}(領域内の建物を非表示)</div>
                <button id="f-del" class="ed-danger">🗑 この領域を削除(建物が元に戻ります)</button>`;
            formEl.querySelector('#f-del').onclick = () => {
                pushUndo();
                S.regions.splice(selected.idx, 1);
                selected = null;
                syncLivePreview(); render();
            };
            return;
        }
        if (selected.kind === 'placement') {
            const p0 = S.placements[selected.idx];
            formEl.innerHTML = `
                <label>画像ファイル名 <input id="f-asset" value="${p0.asset || ''}" placeholder="cafe.png"></label>
                <label>種別 <select id="f-ptype"><option value="building"${p0.type==='building'?' selected':''}>建物差し替え</option><option value="character"${p0.type==='character'?' selected':''}>キャラクター</option></select></label>
                <button id="f-del" class="ed-danger">🗑 この配置を削除(建物が元に戻ります)</button>`;
            formEl.querySelector('#f-asset').oninput = ev => { pushUndo('pl-asset-' + selected.idx); p0.asset = ev.target.value; p0._status = 'edited'; syncLivePreview(); };
            formEl.querySelector('#f-ptype').onchange = ev => { pushUndo(); p0.type = ev.target.value; p0._status = 'edited'; syncLivePreview(); render(); };
            formEl.querySelector('#f-del').onclick = () => { pushUndo(); S.placements.splice(selected.idx, 1); selected = null; syncLivePreview(); render(); };
            return;
        }
        if (selected.kind === 'decoration') {
            const d0 = S.decorations[selected.idx];
            formEl.innerHTML = `
                <label>種類 <select id="f-decor">${decorOptions(d0.asset || 'tree-round')}</select></label>
                <label>サイズ <input id="f-scale" type="number" min="0.35" max="2.2" step="0.05" value="${+(d0.scale || 1)}"></label>
                <div style="font-size:11px; color:#c9b58a;">GeoJSONポイントとして保存され、MapLibreのスプライトで軽量に描画されます。</div>
                <button id="f-del" class="ed-danger">🗑 この植栽・街具を削除</button>`;
            formEl.querySelector('#f-decor').onchange = ev => {
                pushUndo();
                d0.asset = ev.target.value;
                d0.scale = d0.scale || ((DECOR_BY_ID[d0.asset] && DECOR_BY_ID[d0.asset].scale) || 1);
                d0._status = 'edited';
                syncLivePreview(); render();
            };
            formEl.querySelector('#f-scale').oninput = ev => {
                pushUndo('decor-scale-' + selected.idx);
                d0.scale = Math.max(0.35, Math.min(2.2, +ev.target.value || 1));
                d0._status = 'edited';
                syncLivePreview();
            };
            formEl.querySelector('#f-del').onclick = () => { pushUndo(); S.decorations.splice(selected.idx, 1); selected = null; syncLivePreview(); render(); };
            return;
        }
        if (selected.kind === 'section') {
            const n = S.sections[selected.idx];
            formEl.innerHTML = `
                <label>区間名 <input id="f-name" value="${n.name || ''}"></label>
                <label>音声ファイル名 <input id="f-audio" value="${n.audio || ''}" placeholder="01_kayano.wav"></label>
                <label>台本テキスト <textarea id="f-text" rows="5">${n.text || ''}</textarea></label>
                <button id="f-del" class="ed-danger">🗑 この区間を削除</button>`;
            formEl.querySelector('#f-name').oninput = e => { pushUndo('sec-name-' + selected.idx); n.name = e.target.value; n._status = 'edited'; syncLivePreview(); };
            formEl.querySelector('#f-audio').oninput = e => { pushUndo('sec-audio-' + selected.idx); n.audio = e.target.value; n._status = 'edited'; syncLivePreview(); };
            formEl.querySelector('#f-text').oninput = e => { pushUndo('sec-text-' + selected.idx); n.text = e.target.value; n._status = 'edited'; syncLivePreview(); };
            formEl.querySelector('#f-del').onclick = () => { pushUndo(); S.sections.splice(selected.idx, 1); selected = null; syncLivePreview(); render(); };
        } else {
            const e0 = S.events[selected.idx];
            formEl.innerHTML = `
                <button id="f-pick" style="padding:9px; border-radius:10px; border:2px solid ${e0.mask ? '#6ff2ae' : '#e8b86d'}; background:transparent; color:${e0.mask ? '#8fa' : '#ffd98a'}; font-family:inherit; font-weight:700; cursor:pointer;">
                    ${e0.mask ? '🏠 対象建物: 設定済み(再指定する)' : '🏠 対象の建物を指定(押してから建物をクリック)'}
                </button>
                <button id="f-stop" class="ed-mini" style="width:100%;">🚏 ラインの始点バス停: ${e0.fromStop ? e0.fromStop.name : '未設定'}(押して変更)</button>
                <div style="display:flex; gap:5px;">
                    <button id="f-road"  class="ed-mini">🛣 道なり再取得</button>
                    <button id="f-draw"  class="ed-mini">${pendingPathDraw === selected.idx ? '✅ 手描きを終了' : '✏ 経路を手描き'}</button>
                    <button id="f-clearpath" class="ed-mini">✖ 経路クリア</button>
                </div>
                <label>メッセージ <textarea id="f-msg" rows="2">${e0.message || ''}</textarea></label>
                <label>リンクURL <input id="f-url" value="${e0.url || ''}" placeholder="https://..."></label>
                <label>目的地アイコン画像 <input id="f-icon" value="${(e0.eventPoint && e0.eventPoint.icon) || ''}" placeholder="cafe.png"></label>
                <label>判定半径(m) <input id="f-rad" type="number" value="${e0.radius || 8}"></label>
                <button id="f-del" class="ed-danger">🗑 このイベントを削除</button>`;
            formEl.querySelector('#f-pick').onclick = () => beginBuildingPick(selected.idx);
            formEl.querySelector('#f-stop').onclick = () => {
                pendingStopPick = selected.idx;
                showEditorToast('🚏 始点にしたいバス停(の近く)を地図上でクリックしてください。');
            };
            formEl.querySelector('#f-road').onclick = async () => {
                if (!e0.eventPoint) { showEditorToast('先に「🏠 対象の建物を指定」を行ってください。'); return; }
                pushUndo();
                showEditorToast('🛣 道なり経路を取得中…');
                const ok = await fetchRoadRoute(e0);
                syncLivePreview(); render();
                showEditorToast(ok ? '🛣 道路に沿った経路を設定しました。' : '⚠ 経路を取得できませんでした(オフライン?)。✏手描きをどうぞ。');
            };
            formEl.querySelector('#f-draw').onclick = () => {
                if (pendingPathDraw === selected.idx) {
                    pendingPathDraw = null;
                    showEditorToast('✏ 手描きを終了しました。');
                } else {
                    pushUndo();
                    e0.routPoints = [];
                    pendingPathDraw = selected.idx;
                    showEditorToast('✏ 手描き開始: トリガーから建物へ向かって、曲がり角を順にクリックしてください。');
                }
                renderForm();
            };
            formEl.querySelector('#f-clearpath').onclick = () => {
                pushUndo();
                e0.routPoints = [];
                pendingPathDraw = null;
                e0._status = 'edited';
                syncLivePreview(); render();
                showEditorToast('✖ 経路をクリアしました(直線表示に戻ります)。');
            };
            formEl.querySelector('#f-msg').oninput = ev => { pushUndo('ev-msg-' + selected.idx); e0.message = ev.target.value; e0._status = 'edited'; syncLivePreview(); };
            formEl.querySelector('#f-url').oninput = ev => { pushUndo('ev-url-' + selected.idx); e0.url = ev.target.value; e0._status = 'edited'; syncLivePreview(); };
            formEl.querySelector('#f-icon').oninput = ev => {
                if (!e0.eventPoint) e0.eventPoint = { lat: e0.trigger.lat, lng: e0.trigger.lng, action: 'luminescence', icon: '', showSeconds: 40 };
                e0.eventPoint.icon = ev.target.value; e0._status = 'edited'; syncLivePreview();
            };
            formEl.querySelector('#f-rad').oninput = ev => { pushUndo('ev-rad-' + selected.idx); e0.radius = +ev.target.value || 8; e0._status = 'edited'; syncLivePreview(); };
            formEl.querySelector('#f-del').onclick = () => { S.events.splice(selected.idx, 1); selected = null; syncLivePreview(); render(); };
        }
    }

    // ============ 地図クリックで追加 ============
    map.on('click', (ev) => {
        if (!document.body.classList.contains('editing')) return; // エディターOFF中は何もしない
        if (ev.originalEvent.target.closest('#editor-bar') || ev.originalEvent.target.closest('.ed-pin')) return;
        // 🚏 バス停選択中: クリック位置に最も近いバス停をラインの始点にする
        if (pendingStopPick !== null) {
            const stops = (window.ROUTE_POINTS || []).filter(r => r.category === 'busstop');
            let near = null, nmin = 1e18;
            stops.forEach(st => { const d = dM({ lat: ev.lngLat.lat, lng: ev.lngLat.lng }, st); if (d < nmin) { nmin = d; near = st; } });
            if (!near || nmin > 120) { showEditorToast('🚏 近くにバス停がありません。バス停の近くをクリックしてください。'); return; }
            pushUndo();
            const e0 = S.events[pendingStopPick];
            e0.fromStop = { name: near.name || 'バス停', lat: near.lat, lng: near.lng };
            e0._status = 'edited';
            pendingStopPick = null;
            showEditorToast(`🚏 始点を「${e0.fromStop.name}」に設定しました。🛣 経路を再計算中…`);
            fetchRoadRoute(e0).then(() => { syncLivePreview(); render(); });
            return;
        }
        // ✏ 経路の手描き中: クリックで点を追加していく
        if (pendingPathDraw !== null) {
            const e0 = S.events[pendingPathDraw];
            if (!e0.routPoints) e0.routPoints = [];
            if (!e0.routPoints.length) { const o = e0.fromStop || e0.trigger; e0.routPoints.push([o.lat, o.lng]); }
            e0.routPoints.push([ev.lngLat.lat, ev.lngLat.lng]);
            e0._status = 'edited';
            syncLivePreview();
            showEditorToast(`✏ 経路: ${e0.routPoints.length}点。「手描きを終了」で確定します。`);
            return;
        }
        // 🏠 イベントの「対象建物を指定」モード: 次のクリックで建物を取得してイベントに紐づける
        if (pendingBuildingPick !== null) {
            const feats = map.queryRenderedFeatures(ev.point, { layers: ['building-3d'] });
            if (!feats.length) { showEditorToast('🏠 建物が見つかりません。建物の上をクリックしてください。'); return; }
            const ring = pickBuildingRing(feats, ev.lngLat); // クリックした棟そのものを選ぶ
            if (!ring) { showEditorToast('🏠 建物の形状を取得できませんでした。'); return; }
            const c = ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length], [0, 0]);
            const buffered = ring.map(p => {
                const dx = p[0] - c[0], dy = p[1] - c[1];
                const dm = Math.hypot(dy * 111320, dx * 111320 * Math.cos(c[1] * Math.PI / 180)) || 1;
                return [c[0] + dx * (1 + 3 / dm), c[1] + dy * (1 + 3 / dm)];
            });
            console.log('🏠[診断] クリック地点:', ev.lngLat.lat.toFixed(6), ev.lngLat.lng.toFixed(6),
                        '/ 選択建物の中心:', c[1].toFixed(6), c[0].toFixed(6),
                        '/ ずれ(m):', dM({lat: ev.lngLat.lat, lng: ev.lngLat.lng}, {lat: c[1], lng: c[0]}).toFixed(1),
                        '/ 建物ID:', feats[0].id);
            pushUndo();
            const e0 = S.events[pendingBuildingPick];
            // 対象建物=ラインの終点として登録(マスクは「🏠建物マスク」モードで別途作成)
            e0.eventPoint = { lat: c[1], lng: c[0], action: 'luminescence',
                              icon: (e0.eventPoint && e0.eventPoint.icon) || '', showSeconds: 40 };
            e0._status = 'edited';
            // 🚏 最寄りバス停をラインの始点として自動設定(あとから変更可)
            const stops = (window.ROUTE_POINTS || []).filter(r => r.category === 'busstop');
            let near = null, nmin = 1e18;
            stops.forEach(st => { const d = dM({ lat: c[1], lng: c[0] }, st); if (d < nmin) { nmin = d; near = st; } });
            if (near) e0.fromStop = { name: near.name || 'バス停', lat: near.lat, lng: near.lng };
            endBuildingPick();
            selected = { kind: 'event', idx: S.events.indexOf(e0) };
            syncLivePreview(); render();
            showEditorToast(`🏠 対象建物(終点)を設定しました。始点は最寄りの「${near ? (near.name || 'バス停') : '—'}」に自動設定。🛣 道なり経路を取得中…`);
            fetchRoadRoute(e0).then(ok => {
                syncLivePreview(); render();
                showEditorToast(ok
                    ? '🛣 バス停→建物の道なり経路を設定しました。画像ドロップと🚏バス停の変更もできます。'
                    : '⚠ 道なり経路を取得できませんでした(オフライン?)。直線表示のままか、✏手描きで経路を描けます。');
            });
            return;
        }
        if (mode === 'building') {
            draftPoints.push([ev.lngLat.lng, ev.lngLat.lat]);
            updateMaskDraft();
            if (draftPoints.length >= REGION_MAX_POINTS) {
                commitRegion();
            } else {
                showEditorToast(`📐 ${draftPoints.length}点目。あと${REGION_MAX_POINTS - draftPoints.length}点(またはダブルクリックで確定)。`);
            }
            return;
        }
        if (mode === 'decor') {
            pushUndo();
            const asset = (DECOR_LIB[0] && DECOR_LIB[0].id) || 'tree-round';
            const base = DECOR_BY_ID[asset] || { scale: 1 };
            S.decorations.push({
                asset,
                lat: ev.lngLat.lat,
                lng: ev.lngLat.lng,
                scale: base.scale || 1,
                _status: 'edited'
            });
            selected = { kind: 'decoration', idx: S.decorations.length - 1 };
            syncLivePreview();
            render();
            return;
        }
        pushUndo();
        const sp = snapToRoute(ev.lngLat); // 🧲 どこをクリックしてもルート上に吸着
        if (mode === 'audio') {
            S.sections.push({ name: '区間' + (S.sections.length + 1), lat: sp.lat, lng: sp.lng,
                              endLat: null, endLng: null, audio: '', text: '', _status: 'edited' });
        } else {
            S.events.push({ trigger: { lat: sp.lat, lng: sp.lng }, radius: 8, message: '', url: '',
                            routPoints: [], eventPoint: null, _status: 'edited' });
        }
        syncLivePreview();
        render();
    });

    // ============ 保存 / 読込 ============
    function exportJson() {
        const clean = o => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));
        return JSON.stringify({
            meta: { week: WEEK, savedAt: new Date().toISOString() },
            maskRegions: S.regions.map(clean),
            sections: S.sections.map(clean),
            events: S.events.map(clean),
            placements: S.placements.map(clean),
            decorations: S.decorations.map(clean)
        }, null, 2);
    }
    bar.querySelector('#ed-undo').onclick = doUndo;
    bar.querySelector('#ed-clear-all').onclick = () => {
        if (!S.sections.length && !S.events.length) { showEditorToast('消去する音声・イベントがありません。'); return; }
        if (!confirm(`音声区間 ${S.sections.length}件・イベント ${S.events.length}件をすべて消去します。よろしいですか？\n(↩取り消し / Ctrl+Z で戻せます)`)) return;
        pushUndo();
        S.sections = [];
        S.events = [];
        selected = null; pendingPathDraw = null; pendingBuildingPick = null;
        if (window.clearEventFx) window.clearEventFx(); // 表示中の発光・点線も消す
        syncLivePreview(); render();
        showEditorToast('🗑 音声・イベントをすべて消去しました。↩で取り消せます。');
    };
    bar.querySelector('#ed-save').onclick = async () => {
        const name = `bus_radio_${WEEK}.json`, data = exportJson();
        // 🏠 マスク領域マップは週と独立の正本(maskmap.json)としても保存する
        if (dirHandle) {
            try {
                await writeFile(['scenario', 'maskmap.json'],
                    new Blob([JSON.stringify({ regions: S.regions.map(r => ({ points: r.points })) }, null, 2)], { type: 'application/json' }));
                console.log('🏠 maskmap.json を保存しました');
            } catch (err) { console.warn('maskmap保存失敗:', err); }
        }
        try {
            if (window.showSaveFilePicker) {
                const h = await showSaveFilePicker({ suggestedName: name, types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
                const w = await h.createWritable(); await w.write(data); await w.close();
                alert(`保存しました: ${name}\nscenario フォルダに置くと配信に反映されます。`);
            } else { throw 0; }
        } catch (e) {
            if (e && e.name === 'AbortError') return;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
            a.download = name; a.click();
        }
    };
    bar.querySelector('#ed-load').onclick = () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.json';
        inp.onchange = async () => {
            const j = JSON.parse(await inp.files[0].text());
            if (j.maskRegions) S.regions = j.maskRegions.map(r => ({ ...r, _status: 'copy' }));
            if (j.sections) S.sections = j.sections.map(n => ({ ...n, _status: 'copy' }));
            if (j.events) S.events = j.events.map(e => ({ ...e, _status: 'copy' }));
            if (j.placements) S.placements = j.placements.map(p => ({ ...p, _status: 'copy' }));
            if (j.decorations) S.decorations = j.decorations.map(d => ({ ...d, _status: 'copy' }));
            selected = null; syncLivePreview(); render();
        };
        inp.click();
    };

    function showEditorToast(msg) {
        let t = document.getElementById('ed-toast');
        if (!t) { t = document.createElement('div'); t.id = 'ed-toast'; document.body.appendChild(t); }
        t.textContent = msg; t.classList.add('show');
        clearTimeout(showEditorToast._tm);
        showEditorToast._tm = setTimeout(() => t.classList.remove('show'), 4000);
    }

    syncLivePreview(); // 起動時点の内容(前週コピー等)を最初からプレビューに反映
    render();
    console.log('🛠 エディターMVP 起動 (週:', WEEK, ')。編集内容はその場でプレビューに反映されます。');
})();
