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
        sections: (window.NARRATION || []).map(n => ({ ...n, _status: 'copy' })),
        events: (window.EVENT_POINTS || []).map(e => ({
            trigger: { ...e.trigger }, radius: e.radius || 30, message: e.message || '', url: e.url || '',
            routPoints: (e.routPoints || []).map(p => [...p]),
            eventPoint: e.eventPoint ? { ...e.eventPoint } : null, _status: 'copy'
        })),
        placements: (window.PLACEMENTS || []).map(p => ({ ...p, _status: 'copy' }))
    };
    let mode = 'audio'; // 'audio' | 'event'
    let selected = null; // {kind:'section'|'event', idx}
    const markers = [];

    // 🔄 ライブ同期: エディターの編集内容を、動作中のプレビュー(app.js)へ即時反映する。
    // route-data.js/narration.js は var 宣言のため、window.X への代入がそのまま
    // app.js側の裸の変数参照にも反映される(constだとこれが効かないので要注意)。
    function syncLivePreview() {
        window.NARRATION = S.sections.map(n => ({ lat: n.lat, lng: n.lng, text: n.text, audio: n.audio, name: n.name }));
        window.EVENT_POINTS = S.events.map(e => ({
            trigger: { lat: e.trigger.lat, lng: e.trigger.lng }, message: e.message, url: e.url,
            routPoints: e.routPoints, eventPoint: e.eventPoint,
            _trigger: { lat: e.trigger.lat, lng: e.trigger.lng } // app.js起動後の追加分は_triggerも直接持たせる
        }));
        // app.jsのEVENT_POINTS.forEach(ev=>{ev._trigger=...}) 初期化は起動時のみ実行されるため、
        // ライブ追加したイベントにも _trigger を明示的に持たせておく(上でセット済み)。
    }

    // ============ UI 構築 ============
    const bar = document.createElement('div');
    bar.id = 'editor-bar';
    bar.innerHTML = `
      <div id="ed-title">🛠 エディター <b>${WEEK}</b>週</div>
      <div id="ed-tabs">
        <button id="ed-tab-audio" class="ed-tab active">🎙 音声</button>
        <button id="ed-tab-event" class="ed-tab">🎪 イベント</button>
      </div>
      <div id="ed-hint">🎙: 地図クリックで区間開始点を追加 / ピンはドラッグで移動</div>
      <div id="ed-list"></div>
      <div id="ed-form"></div>
      <div id="ed-actions">
        <button id="ed-save">💾 保存 (JSON)</button>
        <button id="ed-load">📂 読込</button>
      </div>`;
    document.body.appendChild(bar);
    const listEl = bar.querySelector('#ed-list');
    const formEl = bar.querySelector('#ed-form');

    bar.querySelector('#ed-tab-audio').onclick = () => setMode('audio');
    bar.querySelector('#ed-tab-event').onclick = () => setMode('event');
    function setMode(m) {
        mode = m; selected = null;
        bar.querySelector('#ed-tab-audio').classList.toggle('active', m === 'audio');
        bar.querySelector('#ed-tab-event').classList.toggle('active', m === 'event');
        bar.querySelector('#ed-hint').innerText = m === 'audio'
            ? '🎙: 地図クリックで区間開始点を追加 / ピンはドラッグで移動'
            : '🎪: 地図クリックでイベントを追加 / ピンはドラッグで移動';
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
            if (distToRoute(item) > 60) return '🔴';
        } else {
            if (distToRoute(item.trigger) > 45) return '🔴';
            if (!item.message) return '🔴';
        }
        return item._status === 'edited' ? '🟢' : '🟡';
    }
    function warnText(item, kind) {
        const w = [];
        if (kind === 'section') {
            if (!item.audio) w.push('音声未割当');
            const d = distToRoute(item);
            if (d > 60) w.push(`ルートから${d.toFixed(0)}m`);
        } else {
            const d = distToRoute(item.trigger);
            if (d > 45) w.push(`ルートから${d.toFixed(0)}m(素通りの恐れ)`);
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
            mk.on('dragend', () => { const p = mk.getLngLat(); n.lat = p.lat; n.lng = p.lng; n._status = 'edited'; syncLivePreview(); render(); });
            el.onclick = (ev) => { ev.stopPropagation(); selected = { kind: 'section', idx: i }; renderForm(); renderList(); };
            markers.push(mk);
        });
        S.events.forEach((e, i) => {
            const el = pinEl(`${badge(e, 'event')} イベント${i + 1}`, '#2ecc71', mode !== 'event');
            const mk = new maplibregl.Marker({ element: el, draggable: mode === 'event', anchor: 'bottom' })
                .setLngLat([e.trigger.lng, e.trigger.lat]).addTo(map);
            mk.on('dragend', () => { const p = mk.getLngLat(); e.trigger.lat = p.lat; e.trigger.lng = p.lng; e._status = 'edited'; syncLivePreview(); render(); });
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
        } else {
            html = S.events.map((e, i) => {
                const w = warnText(e, 'event');
                return `<div class="ed-item ${selected && selected.kind === 'event' && selected.idx === i ? 'sel' : ''}" data-k="event" data-i="${i}">
                    ${badge(e, 'event')} <b>イベント${i + 1}</b> ${e.message ? '「' + e.message.slice(0, 12) + '…」' : ''}
                    ${w ? `<div class="ed-warn">⚠ ${w}</div>` : ''}</div>`;
            }).join('');
        }
        listEl.innerHTML = html || '<div style="color:#999;padding:8px;">項目がありません。地図をクリックして追加してください。</div>';
        listEl.querySelectorAll('.ed-item').forEach(div => {
            div.onclick = () => { selected = { kind: div.dataset.k, idx: +div.dataset.i }; renderForm(); renderList(); };
            // 🎵 音声ファイルのドロップ割当(ファイル名を登録。実ファイルは scenario/audio/<週>/ に配置)
            div.ondragover = ev => { ev.preventDefault(); div.classList.add('drag'); };
            div.ondragleave = () => div.classList.remove('drag');
            div.ondrop = ev => {
                ev.preventDefault(); div.classList.remove('drag');
                const f = ev.dataTransfer.files[0];
                if (!f || div.dataset.k !== 'section') return;
                const n = S.sections[+div.dataset.i];
                n.audio = f.name; n._status = 'edited';
                syncLivePreview();
                showEditorToast(`🎵「${f.name}」を割り当てました。プレビューに反映済みです。\nファイル本体は scenario/audio/${WEEK}/ フォルダに置くと実際に再生されます。`);
                render();
            };
        });
    }

    function renderForm() {
        if (!selected) { formEl.innerHTML = '<div style="color:#999;padding:6px;">項目を選択すると内容を編集できます。</div>'; return; }
        if (selected.kind === 'section') {
            const n = S.sections[selected.idx];
            formEl.innerHTML = `
                <label>区間名 <input id="f-name" value="${n.name || ''}"></label>
                <label>音声ファイル名 <input id="f-audio" value="${n.audio || ''}" placeholder="01_kayano.wav"></label>
                <label>台本テキスト <textarea id="f-text" rows="5">${n.text || ''}</textarea></label>
                <button id="f-del" class="ed-danger">🗑 この区間を削除</button>`;
            formEl.querySelector('#f-name').oninput = e => { n.name = e.target.value; n._status = 'edited'; syncLivePreview(); };
            formEl.querySelector('#f-audio').oninput = e => { n.audio = e.target.value; n._status = 'edited'; syncLivePreview(); };
            formEl.querySelector('#f-text').oninput = e => { n.text = e.target.value; n._status = 'edited'; syncLivePreview(); };
            formEl.querySelector('#f-del').onclick = () => { S.sections.splice(selected.idx, 1); selected = null; syncLivePreview(); render(); };
        } else {
            const e0 = S.events[selected.idx];
            formEl.innerHTML = `
                <label>メッセージ <textarea id="f-msg" rows="2">${e0.message || ''}</textarea></label>
                <label>リンクURL <input id="f-url" value="${e0.url || ''}" placeholder="https://..."></label>
                <label>目的地アイコン画像 <input id="f-icon" value="${(e0.eventPoint && e0.eventPoint.icon) || ''}" placeholder="cafe.png"></label>
                <label>判定半径(m) <input id="f-rad" type="number" value="${e0.radius || 30}"></label>
                <button id="f-del" class="ed-danger">🗑 このイベントを削除</button>`;
            formEl.querySelector('#f-msg').oninput = ev => { e0.message = ev.target.value; e0._status = 'edited'; syncLivePreview(); };
            formEl.querySelector('#f-url').oninput = ev => { e0.url = ev.target.value; e0._status = 'edited'; syncLivePreview(); };
            formEl.querySelector('#f-icon').oninput = ev => {
                if (!e0.eventPoint) e0.eventPoint = { lat: e0.trigger.lat, lng: e0.trigger.lng, action: 'luminescence', icon: '', showSeconds: 40 };
                e0.eventPoint.icon = ev.target.value; e0._status = 'edited'; syncLivePreview();
            };
            formEl.querySelector('#f-rad').oninput = ev => { e0.radius = +ev.target.value || 30; e0._status = 'edited'; syncLivePreview(); };
            formEl.querySelector('#f-del').onclick = () => { S.events.splice(selected.idx, 1); selected = null; syncLivePreview(); render(); };
        }
    }

    // ============ 地図クリックで追加 ============
    map.on('click', (ev) => {
        if (ev.originalEvent.target.closest('#editor-bar') || ev.originalEvent.target.closest('.ed-pin')) return;
        if (mode === 'audio') {
            S.sections.push({ name: '区間' + (S.sections.length + 1), lat: ev.lngLat.lat, lng: ev.lngLat.lng,
                              endLat: null, endLng: null, audio: '', text: '', _status: 'edited' });
        } else {
            S.events.push({ trigger: { lat: ev.lngLat.lat, lng: ev.lngLat.lng }, radius: 30, message: '', url: '',
                            routPoints: [], eventPoint: null, _status: 'edited' });
        }
        syncLivePreview();
        render();
    });

    // ============ 保存 / 読込 ============
    function exportJson() {
        const clean = o => { const c = { ...o }; delete c._status; return c; };
        return JSON.stringify({
            meta: { week: WEEK, savedAt: new Date().toISOString() },
            sections: S.sections.map(clean),
            events: S.events.map(clean),
            placements: S.placements.map(clean)
        }, null, 2);
    }
    bar.querySelector('#ed-save').onclick = async () => {
        const name = `bus_radio_${WEEK}.json`, data = exportJson();
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
            if (j.sections) S.sections = j.sections.map(n => ({ ...n, _status: 'copy' }));
            if (j.events) S.events = j.events.map(e => ({ ...e, _status: 'copy' }));
            if (j.placements) S.placements = j.placements.map(p => ({ ...p, _status: 'copy' }));
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
