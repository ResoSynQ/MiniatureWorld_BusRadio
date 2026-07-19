#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
バスルートxlsx → route-data.js 変換スクリプト
使い方: python3 generate_route_data.py <バスルート.xlsx> <出力先route-data.js>
リストを更新したらこれを実行するだけで route-data.js が再生成されます。
"""
import sys, json, re
import pandas as pd

def parse_coord(v):
    if pd.isna(v): return None
    m = re.findall(r'-?\d+\.\d+', str(v))
    if len(m) < 2: return None
    return [float(m[0]), float(m[1])]

def main(src, dst):
    df = pd.read_excel(src)
    df.columns = [str(c).strip() for c in df.columns]
    route, events, cur = [], [], None
    for _, r in df.iterrows():
        cat = str(r.get('Category')).strip().lower() if pd.notna(r.get('Category')) else ''
        pos = parse_coord(r.get('Latitude and longitude'))
        rout = parse_coord(r.get('rout'))
        evp = parse_coord(r.get('event point'))
        action = str(r.get('action')).strip() if pd.notna(r.get('action')) else None
        icon = str(r.get('icon')).strip() if pd.notna(r.get('icon')) else None
        name = str(r.get('name')).strip() if pd.notna(r.get('name')) else None

        if cat in ('busstop', 'corner') and pos:
            route.append({'no': int(r['no']), 'name': name, 'category': cat, 'lat': pos[0], 'lng': pos[1]})
        elif cat == 'event' and pos:
            cur = {'trigger': {'lat': pos[0], 'lng': pos[1]}, 'routPoints': [], 'eventPoint': None, 'message': None}
            if rout: cur['routPoints'].append(rout)
            events.append(cur)
        elif cur is not None and rout and not evp:
            cur['routPoints'].append(rout)
        elif cur is not None and evp:
            cur['eventPoint'] = {'lat': evp[0], 'lng': evp[1], 'action': action or 'luminescence',
                                 'icon': icon, 'showSeconds': 40}
            cur = None

    js = f"""/**
 * 🚌 オレンジゆずるバス【赤ルート】データ定義ファイル Ver 3.0
 * ============================================================
 * このファイルは xlsx から自動生成されています。
 * 再生成: python3 tools/generate_route_data.py <リスト.xlsx> route-data.js
 * 手動での座標修正・イベント追加も、もちろん可能です。
 * ============================================================
 */

const ROUTE_CONFIG = {{
    loopMinutes: 30,          // 1周にかかる時間（分）
    bgmFile: 'bgm.mp3',       // ループ再生されるBGM（任意・未設置でも通知なしで動作します）
    voiceFile: 'voice.wav',   // 運行開始時に一度だけ再生される音声
    dwellSeconds: 5,          // バス停での停車時間（秒）
    busIconWidth: 34,         // バスアイコンの幅(px)
    eventIconWidth: 42,       // 目的地アイコン(cafe.png等)の幅(px)
    triggerRadius: 30,        // 🎯 イベントトリガーの判定半径(m)
    narrationRadius: 45,      // 📻 ナレーション発動の判定半径(m)。広めに取ってあります
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
}};

/**
 * 🛣️ ルートポイント（走行順）
 * category: 'busstop'=バス停(アイコン表示・停車) / 'corner'=経路の角(非表示・通過)
 * 最終ポイントから先頭へ自動的に接続され、周回ルートになります。
 */
var ROUTE_POINTS = {json.dumps(route, ensure_ascii=False, indent=4)};

/**
 * 🎉 イベント定義
 * trigger:    バスが接触すると発動する地点（地図上には表示されません）
 * routPoints: 発動時に「点線」で順に結ばれる経路ポイント
 * eventPoint: 点線の終点。action の演出が発生します
 *   action 'luminescence' = 緑の輝く輪が波紋状に広がり、icon の画像が表示されます
 * message:    発動時に画面上部へ表示される案内文（null なら既定文）
 */
var EVENT_POINTS = {json.dumps(events, ensure_ascii=False, indent=4)};
"""
    with open(dst, 'w', encoding='utf-8') as f:
        f.write(js)
    print(f"✅ 生成完了: ルート点 {len(route)} / イベント {len(events)}")
    for e in events:
        print('   event trigger:', e['trigger'], '→ rout', len(e['routPoints']), '点 → eventPoint:', e['eventPoint'])

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
