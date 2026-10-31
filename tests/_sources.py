"""index.html と、そこから切り出した css/app.css・js/*.js をひとつの文字列にして返す。

画面の構成・関数・CSS は分割後のファイルに散らばっているので、
「アプリ本体のどこかに書いてあるか」を確かめるテストはこれを読む。
並びは index.html、css/app.css、js/*.js（index.html の <script> の順）。
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read_app_source() -> str:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    parts = [html, (ROOT / "css" / "app.css").read_text(encoding="utf-8")]
    for name in re.findall(r'<script src="(js/[^"]+)"></script>', html):
        parts.append((ROOT / name).read_text(encoding="utf-8"))
    return "\n".join(parts)
