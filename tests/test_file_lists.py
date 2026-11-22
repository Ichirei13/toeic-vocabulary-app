"""ファイル一覧の食い違いを防ぐテストと、公開用のファイル集め（tools/collect_site.py）のテスト。

アプリに使うファイルは 2 か所に手書きの一覧がある。
  index.html（<script>・<link>・<img>）→ sw.js の ASSETS（オフライン用キャッシュ）
公開するファイルは ASSETS に tools/collect_site.py の EXTRA_FILES を足したもので、
GitHub Actions（.github/workflows/pages.yml）がそれだけを _site/ に集めて Pages に配信する。
ASSETS に足し忘れると、キャッシュの install が失敗したり、公開側で 404 になったりする。
"""
import importlib.util
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

_spec = importlib.util.spec_from_file_location("collect_site", ROOT / "tools" / "collect_site.py")
collect_site = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(collect_site)


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
    return set(collect_site.sw_assets())


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


def test_site_files_are_assets_plus_extras():
    files = set(collect_site.site_files())
    assert _sw_assets() <= files, "sw.js が使うファイルは全部公開する"
    assert files - _sw_assets() == set(collect_site.EXTRA_FILES)
    assert "sw.js" in files and "index.html" in files


def test_site_files_exist():
    missing = sorted(f for f in collect_site.site_files() if not (ROOT / f).is_file())
    assert not missing, f"公開するファイルがない: {missing}"


def test_development_files_are_not_published():
    files = collect_site.site_files()
    for f in files:
        assert not f.startswith(("next/", "tests/", "docs/", "tools/", "scripts/", "archive/", ".")), f
    for name in ("CLAUDE.md", "AGENTS.md", "README.md", "preview.html", "upload.py"):
        assert name not in files


def test_collect_copies_exactly_the_site_files(tmp_path):
    out = tmp_path / "_site"
    collect_site.collect(out)
    copied = sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file())
    assert copied == sorted(collect_site.site_files())
    assert (out / "index.html").read_bytes() == (ROOT / "index.html").read_bytes()


def test_collect_rebuilds_a_previous_output(tmp_path):
    out = tmp_path / "_site"
    collect_site.collect(out)
    (out / "index.html").write_text("古い版", encoding="utf-8")
    collect_site.collect(out)
    assert (out / "index.html").read_bytes() == (ROOT / "index.html").read_bytes()


def test_collect_refuses_to_clear_an_unrelated_directory(tmp_path):
    out = tmp_path / "work"
    out.mkdir()
    (out / "大事なメモ.md").write_text("消してはいけない", encoding="utf-8")
    with pytest.raises(SystemExit):
        collect_site.collect(out)
    assert (out / "大事なメモ.md").read_text(encoding="utf-8") == "消してはいけない"


def test_collect_refuses_the_project_root():
    with pytest.raises(SystemExit):
        collect_site.collect(ROOT)
    with pytest.raises(SystemExit):
        collect_site.collect(ROOT.parent)


def test_pages_workflow_publishes_the_collected_site():
    wf = (ROOT / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
    assert "python3 tools/collect_site.py _site" in wf
    assert "actions/upload-pages-artifact@" in wf
    assert "path: _site" in wf
    assert "actions/deploy-pages@" in wf
    assert "branches: [main]" in wf


def test_upload_script_is_gone():
    # 公開は git push → Actions に一本化した（upload.py の API 直書きは履歴が二重になるのでやめた）
    assert not (ROOT / "upload.py").exists()
