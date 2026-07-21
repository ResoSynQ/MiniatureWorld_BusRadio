/**
 * 🚌 オレンジゆずるバス【赤ルート】データ定義ファイル Ver 3.0
 * ============================================================
 * このファイルは xlsx から自動生成されています。
 * 再生成: python3 tools/generate_route_data.py <リスト.xlsx> route-data.js
 * 手動での座標修正・イベント追加も、もちろん可能です。
 * ============================================================
 */

const ROUTE_CONFIG = {
    loopMinutes: 30,          // 1周にかかる時間（分）
    bgmFile: 'bgm.mp3',       // ループ再生されるBGM（任意・未設置でも通知なしで動作します）
    voiceFile: 'voice.wav',   // 運行開始時に一度だけ再生される音声
    dwellSeconds: 5,          // バス停での停車時間（秒）
    busIconWidth: 34,         // バスアイコンの幅(px)
    eventIconWidth: 42,       // 目的地アイコン(cafe.png等)の幅(px)
    triggerRadius: 8,         // 🎯 イベントトリガーの判定半径(m)。ピンはルート上に吸着するため狭くてよい
    narrationRadius: 8,       // 📻 ナレーション発動の判定半径(m)。ルート吸着前提。倍速時の素通り防止で8mが下限
    narrationHoldSec: 45,     // 📻 最後の塊を表示し続ける秒数
    fixedZoom: 18.5,          // 🔍 固定するズームレベル（ベクター地図なので 18.5 のような中間値も可）
    lockZoom: true,           // true: ズーム操作を無効化し、この縮尺で固定します
    pitch: 55,                // 📐 カメラの傾き(0=真上, 60=最大)。疑似3Dの見え方を調整します
    bearing: 0,               // 🧭 地図の回転角(度)
    cameraEase: 2.8,          // 🎥 追従カメラの滑らかさ(小さいほどふわっと遅れて追従します)
    theme: 'evening',         // 🎨 'evening'=夕暮れ / 'night'=夜 / 'day'=昼(通常地図)
    nightTheme: true,         // (旧設定・themeが優先されます)
    dreamyDof: true,          // 🔍 画面のふちをぼかす被写界深度風の演出（重い端末では false 推奨）
    lampIntervalM: 130,       // 💡 街路灯を配置する間隔(m)
    // 💬 運行開始時に読み上げる音声の字幕テキスト（画面下部に表示されます）
    voiceText: 'こんにちは！オレンジゆずるバスです。本日も、まちのあかりをめぐる小さな旅へまいります。',
    // ✉️ 投稿モードの送信先メールアドレス（ご自身のアドレスに変更してください）
    postEmail: 'example@example.com',
    postSubject: '【オレンジゆずるバス】地点座標の投稿'
};

/**
 * 🛣️ ルートポイント（走行順）
 * category: 'busstop'=バス停(アイコン表示・停車) / 'corner'=経路の角(非表示・通過)
 * 最終ポイントから先頭へ自動的に接続され、周回ルートになります。
 */
var ROUTE_POINTS = [
    {
        "no": 1,
        "name": "箕面萱野駅",
        "category": "busstop",
        "lat": 34.83214655610315,
        "lng": 135.489243308793
    },
    {
        "no": 2,
        "name": null,
        "category": "corner",
        "lat": 34.832012779694494,
        "lng": 135.4894155973242
    },
    {
        "no": 3,
        "name": null,
        "category": "corner",
        "lat": 34.83163313927246,
        "lng": 135.48946822740822
    },
    {
        "no": 4,
        "name": null,
        "category": "corner",
        "lat": 34.831505067475206,
        "lng": 135.48854060519722
    },
    {
        "no": 10,
        "name": null,
        "category": "corner",
        "lat": 34.83364773416608,
        "lng": 135.4885148298627
    },
    {
        "no": 11,
        "name": null,
        "category": "corner",
        "lat": 34.83370371854563,
        "lng": 135.49167037010196
    },
    {
        "no": 12,
        "name": "白島一丁目",
        "category": "busstop",
        "lat": 34.834162183282174,
        "lng": 135.49331714265657
    },
    {
        "no": 13,
        "name": "今宮",
        "category": "busstop",
        "lat": 34.835352418671334,
        "lng": 135.49610889095365
    },
    {
        "no": 14,
        "name": null,
        "category": "corner",
        "lat": 34.83586469469668,
        "lng": 135.4976386647331
    },
    {
        "no": 15,
        "name": null,
        "category": "corner",
        "lat": 34.834133603384075,
        "lng": 135.49850351799518
    },
    {
        "no": 16,
        "name": null,
        "category": "corner",
        "lat": 34.83475285619757,
        "lng": 135.50052728370062
    },
    {
        "no": 17,
        "name": "箕面墓地前",
        "category": "busstop",
        "lat": 34.835194914819326,
        "lng": 135.50239707151624
    },
    {
        "no": 18,
        "name": "新家",
        "category": "busstop",
        "lat": 34.83554314706293,
        "lng": 135.50571190589676
    },
    {
        "no": 19,
        "name": "小野原",
        "category": "busstop",
        "lat": 34.83579380650717,
        "lng": 135.51492989773686
    },
    {
        "no": 20,
        "name": null,
        "category": "corner",
        "lat": 34.83579071571352,
        "lng": 135.51535140131372
    },
    {
        "no": 21,
        "name": null,
        "category": "corner",
        "lat": 34.838392694740264,
        "lng": 135.5147031043223
    },
    {
        "no": 22,
        "name": "尼谷",
        "category": "busstop",
        "lat": 34.83989043682353,
        "lng": 135.51545163758678
    },
    {
        "no": 23,
        "name": null,
        "category": "corner",
        "lat": 34.84056847370965,
        "lng": 135.51575740941615
    },
    {
        "no": 24,
        "name": null,
        "category": "corner",
        "lat": 34.84117826185054,
        "lng": 135.51627775795328
    },
    {
        "no": 25,
        "name": null,
        "category": "corner",
        "lat": 34.84226354147703,
        "lng": 135.51672836905885
    },
    {
        "no": 26,
        "name": null,
        "category": "corner",
        "lat": 34.842833692791146,
        "lng": 135.5162026561019
    },
    {
        "no": 27,
        "name": null,
        "category": "corner",
        "lat": 34.84292835073358,
        "lng": 135.51600149044194
    },
    {
        "no": 28,
        "name": "粟生間谷西一丁目",
        "category": "busstop",
        "lat": 34.842992189754156,
        "lng": 135.51578959592237
    },
    {
        "no": 29,
        "name": null,
        "category": "corner",
        "lat": 34.84390726040913,
        "lng": 135.51245019611835
    },
    {
        "no": 30,
        "name": "東生涯学習センター前",
        "category": "busstop",
        "lat": 34.84394688416049,
        "lng": 135.51180110158882
    },
    {
        "no": 31,
        "name": null,
        "category": "corner",
        "lat": 34.84402172897351,
        "lng": 135.5108515996621
    },
    {
        "no": 32,
        "name": null,
        "category": "corner",
        "lat": 34.844417965082656,
        "lng": 135.51035807319815
    },
    {
        "no": 33,
        "name": null,
        "category": "corner",
        "lat": 34.84401935033495,
        "lng": 135.50990920066667
    },
    {
        "no": 34,
        "name": null,
        "category": "corner",
        "lat": 34.84373924277413,
        "lng": 135.50986135528328
    },
    {
        "no": 35,
        "name": null,
        "category": "corner",
        "lat": 34.84351672685446,
        "lng": 135.50995704633692
    },
    {
        "no": 36,
        "name": null,
        "category": "corner",
        "lat": 34.84285964690902,
        "lng": 135.51066834984778
    },
    {
        "no": 37,
        "name": "豊川住宅前",
        "category": "busstop",
        "lat": 34.84217900079014,
        "lng": 135.51210690543223
    },
    {
        "no": 38,
        "name": null,
        "category": "corner",
        "lat": 34.84115181062867,
        "lng": 135.50955223069843
    },
    {
        "no": 39,
        "name": "外院の里",
        "category": "busstop",
        "lat": 34.8408239990741,
        "lng": 135.50819839604895
    },
    {
        "no": 40,
        "name": null,
        "category": "corner",
        "lat": 34.8406796678355,
        "lng": 135.50735224397866
    },
    {
        "no": 41,
        "name": null,
        "category": "corner",
        "lat": 34.840663163798155,
        "lng": 135.50543086644458
    },
    {
        "no": 42,
        "name": null,
        "category": "corner",
        "lat": 34.840366200609715,
        "lng": 135.50386900964213
    },
    {
        "no": 43,
        "name": null,
        "category": "corner",
        "lat": 34.840890671275886,
        "lng": 135.50360098859582
    },
    {
        "no": 44,
        "name": null,
        "category": "corner",
        "lat": 34.84151079801917,
        "lng": 135.5034194773369
    },
    {
        "no": 45,
        "name": null,
        "category": "corner",
        "lat": 34.84261420828857,
        "lng": 135.50340171599197
    },
    {
        "no": 46,
        "name": null,
        "category": "corner",
        "lat": 34.84296911068702,
        "lng": 135.5032879194981
    },
    {
        "no": 47,
        "name": null,
        "category": "corner",
        "lat": 34.843442311500674,
        "lng": 135.50300342827214
    },
    {
        "no": 48,
        "name": "外院",
        "category": "busstop",
        "lat": 34.84285691267708,
        "lng": 135.50166786179594
    },
    {
        "no": 49,
        "name": null,
        "category": "corner",
        "lat": 34.840887838169024,
        "lng": 135.49688791209522
    },
    {
        "no": 50,
        "name": "青松園中央",
        "category": "busstop",
        "lat": 34.84263703163473,
        "lng": 135.49661225558208
    },
    {
        "no": 51,
        "name": null,
        "category": "corner",
        "lat": 34.84290827287052,
        "lng": 135.49655821517504
    },
    {
        "no": 52,
        "name": null,
        "category": "corner",
        "lat": 34.842738293143896,
        "lng": 135.49519628387858
    },
    {
        "no": 53,
        "name": null,
        "category": "corner",
        "lat": 34.841101260151206,
        "lng": 135.49429921324
    },
    {
        "no": 54,
        "name": null,
        "category": "corner",
        "lat": 34.840685120688036,
        "lng": 135.49428417982088
    },
    {
        "no": 55,
        "name": null,
        "category": "corner",
        "lat": 34.840214588558005,
        "lng": 135.49397588959184
    },
    {
        "no": 56,
        "name": null,
        "category": "corner",
        "lat": 34.83993836427952,
        "lng": 135.49361111443085
    },
    {
        "no": 57,
        "name": null,
        "category": "corner",
        "lat": 34.839777737486,
        "lng": 135.4935568061613
    },
    {
        "no": 58,
        "name": null,
        "category": "corner",
        "lat": 34.83957410491339,
        "lng": 135.4936694589309
    },
    {
        "no": 59,
        "name": "石丸",
        "category": "busstop",
        "lat": 34.83894176999067,
        "lng": 135.4922108364929
    },
    {
        "no": 60,
        "name": null,
        "category": "corner",
        "lat": 34.8387487506246,
        "lng": 135.49165093171746
    },
    {
        "no": 61,
        "name": null,
        "category": "corner",
        "lat": 34.8386362341019,
        "lng": 135.4912362424736
    },
    {
        "no": 62,
        "name": null,
        "category": "corner",
        "lat": 34.83851802033582,
        "lng": 135.49018841209053
    },
    {
        "no": 63,
        "name": "白島北",
        "category": "busstop",
        "lat": 34.83855208105615,
        "lng": 135.4894733198152
    },
    {
        "no": 64,
        "name": null,
        "category": "corner",
        "lat": 34.83858025858747,
        "lng": 135.48863878630775
    },
    {
        "no": 65,
        "name": null,
        "category": "corner",
        "lat": 34.83791012488738,
        "lng": 135.48864745863156
    },
    {
        "no": 66,
        "name": null,
        "category": "corner",
        "lat": 34.83706007385449,
        "lng": 135.48853456159313
    },
    {
        "no": 67,
        "name": null,
        "category": "corner",
        "lat": 34.836076852414664,
        "lng": 135.48852581221934
    },
    {
        "no": 68,
        "name": "白島",
        "category": "busstop",
        "lat": 34.83491849103564,
        "lng": 135.488598383897
    },
    {
        "no": 69,
        "name": null,
        "category": "corner",
        "lat": 34.831505067475206,
        "lng": 135.48854060519722
    },
    {
        "no": 70,
        "name": null,
        "category": "corner",
        "lat": 34.83163313927246,
        "lng": 135.48946822740822
    },
    {
        "no": 71,
        "name": null,
        "category": "corner",
        "lat": 34.832012779694494,
        "lng": 135.4894155973242
    },
    {
        "no": 72,
        "name": null,
        "category": "busstop",
        "lat": 34.83214655610315,
        "lng": 135.489243308793
    }
];

/**
 * 🎉 イベント定義
 * trigger:    バスが接触すると発動する地点（地図上には表示されません）
 * routPoints: 発動時に「点線」で順に結ばれる経路ポイント
 * eventPoint: 点線の終点。action の演出が発生します
 *   action 'luminescence' = 緑の輝く輪が波紋状に広がり、icon の画像が表示されます
 * message:    発動時に画面上部へ表示される案内文（null なら既定文）
 */
var EVENT_POINTS = [
    {
        "trigger": {
            "lat": 34.833655,
            "lng": 135.49005
        },
        "routPoints": [
            [
                34.834162183282174,
                135.49331714265657
            ],
            [
                34.834135,
                135.493237
            ],
            [
                34.834034,
                135.492995
            ]
        ],
        "eventPoint": {
            "lat": 34.834985,
            "lng": 135.492695,
            "action": "luminescence",
            "icon": "cafe.png",
            "showSeconds": 40
        },
        "message": null
    }
];
