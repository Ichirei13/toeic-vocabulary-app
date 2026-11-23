#!/usr/bin/env python3
"""公開する静的サイトを 1 つのフォルダ（既定は _site/）に集める。

GitHub Actions（.github/workflows/pages.yml）が main への push のたびにこれを実行し、
集めたフォルダだけを GitHub Pages に配信する。開発用のファイル（tests/・docs/・tools/ など）は公開しない。

公開するのは、sw.js の ASSETS（オフライン用にキャッシュするファイル）と EXTRA_FILES だけ。
アプリにファイルを足したら index.html と sw.js の ASSETS に足せば、公開にも入る。

使い方:
  python3 tools/collect_site.py           _site/ に集める（前回の出力は作り直す）
  python3 tools/collect_site.py 出力先     指定したフォルダに集める
  python3 tools/collect_site.py --list    公開するファイルの一覧を表示するだけ
"""
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ASSETS には入れない（キャッシュしない）が公開するファイル
EXTRA_FILES = [
    "sw.js",                  # サービスワーカー本体（自分自身はキャッシュしない）
    "vendor/LICENSE-d3.txt",  # 同梱している d3 のライセンス表示
]


def sw_assets(root: Path = ROOT) -> list[str]:
    """sw.js の ASSETS に並ぶパス（'./' を除く）。"""
    sw = (root / "sw.js").read_text(encoding="utf-8")
    block = re.search(r"const ASSETS = \[(.*?)\];", sw, re.S)
    if not block:
        raise SystemExit("sw.js に const ASSETS = [...] が見つからない")
    return [a for a in re.findall(r"'([^']+)'", block.group(1)) if a != "./"]


def site_files(root: Path = ROOT) -> list[str]:
    """公開するファイル（重複なし・並べ替え済み）。"""
    return sorted(set(sw_assets(root)) | set(EXTRA_FILES))


def _clear_previous_output(out: Path, files: list[str], root: Path) -> None:
    """前回の出力なら消す。関係のないフォルダは消さずに止める。"""
    out_r, root_r = out.resolve(), root.resolve()
    if out_r == root_r or out_r in root_r.parents:
        raise SystemExit("出力先にプロジェクトのフォルダ（かその親）は指定できない: %s" % out)
    if not out.exists():
        return
    if not out.is_dir():
        raise SystemExit("出力先がフォルダではない: %s" % out)
    known = set(files)
    strangers = sorted(p.relative_to(out).as_posix() for p in out.rglob("*")
                       if p.is_file() and p.relative_to(out).as_posix() not in known)
    if strangers:
        raise SystemExit("出力先に公開対象でないファイルがあるので、消さずに止めた: %s（%s など）"
                         % (out, ", ".join(strangers[:3])))
    shutil.rmtree(out)


def collect(out: Path, root: Path = ROOT) -> list[str]:
    files = site_files(root)
    missing = [f for f in files if not (root / f).is_file()]
    if missing:
        raise SystemExit("公開するファイルがない（sw.js の ASSETS か EXTRA_FILES を直す）: %s" % ", ".join(missing))
    _clear_previous_output(out, files, root)
    for f in files:
        dest = out / f
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / f, dest)
    return files


def main(argv: list[str]) -> int:
    if argv[:1] == ["--list"]:
        print("\n".join(site_files()))
        return 0
    out = Path(argv[0]) if argv else ROOT / "_site"
    files = collect(out)
    print("%d ファイルを %s に集めました。" % (len(files), out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
