/**
 * 📅 週次シナリオローダー Ver 1.0
 * ============================================================
 * 1. 今日(日本時間)から「週の開始日(日曜)」を計算
 * 2. scenario/bus_radio_<日付>.xlsx を取得(無ければ過去8週へフォールバック)
 * 3. SheetJSでブラウザ内解析し、ROUTE_POINTS / EVENT_POINTS / NARRATION を上書き
 * 4. 同名の .json (エディター確定データ)があれば、さらに上書き
 * 5. 準備完了後に app.js を起動する
 * どの週も見つからない場合は route-data.js / narration.js の内蔵データで動く。
 * ============================================================
 */
(async function () {
    window.WEEK_ID = null;
    window.SCENARIO_META = {};

    // --- 日本時間で「その週の月曜」を求める(切替は日曜24時=月曜0時) ---
    // 例: bus_radio_2026-07-20.xlsx は 7/20(月)0:00 〜 7/26(日)24:00 に配信される
    function weekStartJST(offsetWeeks = 0) {
        const now = new Date(Date.now() + 9 * 3600 * 1000); // UTC→JST
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - offsetWeeks * 7); // 直近の月曜へ
        return d.toISOString().slice(0, 10);
    }

    async function tryFetch(url) {
        try {
            const r = await fetch(url + '?t=' + weekStartJST(0));
            return r.ok ? r : null;
        } catch (e) { return null; }
    }

    function sheetRows(wb, name) {
        const ws = wb.Sheets[name];
        return ws ? XLSX.utils.sheet_to_json(ws, { defval: '' }) : [];
    }

    function applyXlsx(wb) {
        const meta = {};
        sheetRows(wb, 'meta').forEach(r => { if (r.key) meta[r.key] = r.value; });
        window.SCENARIO_META = meta;
        if (meta.theme) ROUTE_CONFIG.theme = String(meta.theme);
        if (meta.loop_minutes) ROUTE_CONFIG.loopMinutes = Number(meta.loop_minutes) || ROUTE_CONFIG.loopMinutes;
        if (meta.start_voice) ROUTE_CONFIG.voiceFile = String(meta.start_voice);
        if (meta.bgm) ROUTE_CONFIG.bgmFile = String(meta.bgm);

        const route = sheetRows(wb, 'route')
            .filter(r => r.lat !== '' && r.lng !== '')
            .map(r => ({ no: r.no, name: r.name || null, category: String(r.category || 'corner'), lat: +r.lat, lng: +r.lng }));
        if (route.length >= 2) window.ROUTE_POINTS = route;

        const sections = sheetRows(wb, 'sections')
            .filter(r => r.start_lat !== '' && r.start_lng !== '')
            .map(r => ({
                name: r.name || '', lat: +r.start_lat, lng: +r.start_lng,
                endLat: r.end_lat === '' ? null : +r.end_lat,
                endLng: r.end_lng === '' ? null : +r.end_lng,
                audio: String(r.audio_file || ''), text: String(r.text || '')
            }));
        if (sections.length) window.NARRATION = sections;

        const events = sheetRows(wb, 'events')
            .filter(r => r.trigger_lat !== '' && r.trigger_lng !== '')
            .map(r => ({
                trigger: { lat: +r.trigger_lat, lng: +r.trigger_lng },
                radius: +r.radius || 30,
                message: String(r.message || ''), url: String(r.url || ''),
                routPoints: String(r.route_points || '').split(';').filter(Boolean)
                    .map(s => s.split(',').map(Number)).filter(p => p.length === 2 && !isNaN(p[0])),
                eventPoint: (r.target_lat !== '' && r.target_lng !== '') ? {
                    lat: +r.target_lat, lng: +r.target_lng,
                    action: 'luminescence', icon: String(r.icon || ''), showSeconds: 40
                } : null
            }));
        if (events.length) window.EVENT_POINTS = events;

        window.PLACEMENTS = sheetRows(wb, 'placements')
            .filter(r => r.lat !== '' && r.lng !== '')
            .map(r => ({ type: String(r.type || 'building'), lat: +r.lat, lng: +r.lng,
                         asset: String(r.asset || ''), anim: String(r.anim || ''), path: String(r.path || '') }));

        window.DECORATIONS = sheetRows(wb, 'decorations')
            .filter(r => r.lat !== '' && r.lng !== '')
            .map(r => ({ asset: String(r.asset || 'tree-round'), lat: +r.lat, lng: +r.lng,
                         scale: r.scale === '' ? 1 : (+r.scale || 1) }));
    }

    function applyJsonOverride(j) {
        // エディターの確定データ(JSON)が存在すれば、xlsxより優先する
        if (j.sections) window.NARRATION = j.sections;
        if (j.events) window.EVENT_POINTS = j.events;
        if (j.placements) window.PLACEMENTS = j.placements;
        if (j.decorations) window.DECORATIONS = j.decorations;
        if (j.meta) Object.assign(window.SCENARIO_META, j.meta);
    }

    // --- 今週→過去8週の順で探す ---
    for (let i = 0; i < 8; i++) {
        const wk = weekStartJST(i);
        const res = await tryFetch(`scenario/bus_radio_${wk}.xlsx`);
        if (res) {
            try {
                const wb = XLSX.read(await res.arrayBuffer(), { type: 'array' });
                applyXlsx(wb);
                window.WEEK_ID = wk;
                const jres = await tryFetch(`scenario/bus_radio_${wk}.json`);
                if (jres) applyJsonOverride(await jres.json());
                console.log(`📅 週次シナリオ ${wk} を読み込みました${i > 0 ? '(フォールバック: ' + i + '週前)' : ''}`);
            } catch (e) { console.warn('シナリオ解析に失敗。内蔵データで起動します。', e); }
            break;
        }
    }
    window.SCENARIO_LOADED = !!window.WEEK_ID;
    if (!window.WEEK_ID) {
        // xlsxが読めなくても「今週の日付」は必ず確定させる(音声フォルダのパス等に必要)
        window.WEEK_ID = weekStartJST(0);
        if (location.protocol === 'file:') {
            console.warn('📅 file:// で開かれているため xlsx を読み込めません。' +
                '週は日付から ' + window.WEEK_ID + ' と判定しました。' +
                'xlsxの内容を反映するには python3 -m http.server 経由で開いてください。');
        } else {
            console.log('📅 週次シナリオ未検出。内蔵データで起動します(週: ' + window.WEEK_ID + ')');
        }
    }

    // --- 準備完了 → 本体を起動 ---
    const s = document.createElement('script');
    s.src = 'app.js?v=7.0.8';
    s.onload = () => { if (location.search.includes('edit=1')) { const e = document.createElement('script'); e.src = 'editor.js?v=7.0.8'; document.body.appendChild(e); } };
    document.body.appendChild(s);
})();
