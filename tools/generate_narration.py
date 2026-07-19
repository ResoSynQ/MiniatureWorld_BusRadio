#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ナレーション台本txt → narration.js 変換スクリプト (Ver 3: 位置トリガー方式)
台本は「空行」区切りの塊で、各塊の1行目に発動座標「lat, lng」を記述します。
バスがその座標に接触すると、続く行のテキストがまるごと表示されます。
使い方: python3 tools/generate_narration.py <台本.txt> <出力narration.js>
"""
import sys, json, re

def main(src, dst):
    with open(src, encoding='utf-8') as f:
        content = f.read().lstrip('\ufeff')
    blocks = [b.strip() for b in content.replace('\r\n', '\n').split('\n\n') if b.strip()]
    items = []
    for b in blocks:
        lines = [l for l in b.split('\n') if l.strip()]
        m = re.match(r'^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$', lines[0])
        if m:
            lat, lng = float(m.group(1)), float(m.group(2))
            text = '\n'.join(lines[1:]).strip()
        else:
            lat, lng, text = None, None, '\n'.join(lines).strip()
        if text:
            items.append({'lat': lat, 'lng': lng, 'text': text})

    js = f"""/**
 * 📻 箱庭ラジオ ナレーション定義（台本txtから自動生成・位置トリガー方式）
 * ============================================================
 * lat, lng: この座標にバスが接触すると text が表示されます
 *           （判定の広さは route-data.js の narrationRadius で調整）
 * text:     表示する文章の塊（改行はそのまま・左揃えで表示）
 * 表示は次の塊が発動するまで続き、最後の塊は narrationHoldSec 秒後に消えます。
 * 塊は台本の順番どおりに1つずつ発動します（周回ごとに最初から）。
 * 再生成: python3 tools/generate_narration.py <台本.txt> narration.js
 * ============================================================
 */
var NARRATION = {json.dumps(items, ensure_ascii=False, indent=4)};
"""
    with open(dst, 'w', encoding='utf-8') as f:
        f.write(js)
    print(f"✅ 生成完了: {len(items)}塊")
    for i, it in enumerate(items):
        first = it['text'].split(chr(10))[0]
        print(f"   塊{i+1}: ({it['lat']}, {it['lng']}) 「{first[:22]}…」")

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
