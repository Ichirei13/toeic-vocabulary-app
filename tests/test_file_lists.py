"""ファイル一覧の食い違いを防ぐテスト。

アプリに使うファイルは 3 か所に手書きの一覧がある。
  index.html（<script>・<link>・<img>）→ sw.js の ASSETS（オフライン用キャッシュ）→ upload.py の FILES（公開）
後ろの一覧に足し忘れると、キャッシュの install が失敗したり、公開側で 404 になったりする。
"""
import ast
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _local(path: str) -> bool:
    return not re.match(r"^(https?:)?//|^data:|^#", path)


def _index_refs() -> set[str]:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    refs = set(re.findall(r'<script[^>]+src="([^"]+)"', html))
    refs |= set(re.findall(r'<link[^>]+href="([^"]+)"', html))
    refs |= set(re.findall(r'<img[^>]+src="([^"]+)"', html))
    refs |= set(re.findall(r'<source[^>]+srcset="([^"]+)"', html))
    return {r for r in refs if _local(r)}


def _sw_assets() -> set[str]:
    sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    block = re.search(r"const ASSETS = \[(.*?)\];", sw, re.S).group(1)
    return {a for a in re.findall(r"'([^']+)'", block) if a != "./"}


def _upload_files() -> set[str]:
    tree = ast.parse((ROOT / "upload.py").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "FILES" for t in node.targets):
            return set(ast.literal_eval(node.value))
    raise AssertionError("upload.py に FILES が見つからない")


def test_index_refs_are_cached_by_service_worker():
    missing = sorted(_index_refs() - _sw_assets())
    assert not missing, f"index.html が読むが sw.js の ASSETS にない: {missing}"


def test_manifest_icons_are_cached_by_service_worker():
    manifest = json.loads((ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
    icons = {i["src"] for i in manifest.get("icons", [])}
    missing = sorted(icons - _sw_assets())
    assert not missing, f"manifest のアイコンが sw.js の ASSETS にない: {missing}"


def test_service_worker_assets_exist():
    missing = sorted(a for a in _sw_assets() if not (ROOT / a).is_file())
    assert not missing, f"sw.js の ASSETS にあるがファイルがない（addAll が失敗する）: {missing}"


def test_service_worker_assets_are_uploaded():
    missing = sorted(_sw_assets() - _upload_files())
    assert not missing, f"sw.js が使うが upload.py の FILES にない（公開側で 404 になる）: {missing}"


def test_upload_files_exist():
    missing = sorted(f for f in _upload_files() if not (ROOT / f).is_file())
    assert not missing, f"upload.py の FILES にあるがファイルがない: {missing}"
