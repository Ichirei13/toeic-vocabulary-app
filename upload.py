#!/usr/bin/env python3
"""ローカルのファイルを GitHub の main に push し、Pages で公開する。

使い方:
  python3 upload.py -m "変更内容"   変更したファイルを1つのコミットにまとめて push
  python3 upload.py -n              送らずに、push される内容だけ表示
  python3 upload.py pull            GitHub の最新版をこのフォルダに取得

GitHub 側（別の PC や Claude の作業ブランチのマージなど）で更新されたファイルを、
古い手元の版で上書きしないように、最後に pull / push したときの各ファイルの sha を
.upload_state.json に記録しておく。GitHub 側がそこから変わっていたら push を止める
（先に pull するか、上書きしてよければ --force）。
"""
import argparse
import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys

REPO = "Ichirei13/toeic-vocabulary-app"
BRANCH = "main"
FILES = [
    "index.html",
    "home.css",
    "home.js",
    "data/words.js",
    "data/grammar.js",
    "manifest.webmanifest",
    "sw.js",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "icons/apple-touch-icon.png",
    "upload.py",
]
STATE_FILE = ".upload_state.json"
DEFAULT_MESSAGE = "Update TOEIC Drill"


def gh(args, payload=None):
    """gh api を実行し (returncode, stdout, stderr) を返す。"""
    proc = subprocess.run(
        ["gh", "api"] + args,
        input=json.dumps(payload).encode("utf-8") if payload is not None else None,
        capture_output=True,
    )
    return proc.returncode, proc.stdout.decode("utf-8"), proc.stderr.decode("utf-8")


def api(args, payload=None):
    """gh api を実行して JSON を返す。失敗したらそこで終了する。"""
    code, out, err = gh(args, payload)
    if code != 0:
        endpoint = next((a for a in args if a.startswith("/")), "")
        raise SystemExit("GitHub API エラー (%s): %s" % (endpoint, err.strip()))
    return json.loads(out)


def post(path, payload, method="POST"):
    return api(["-X", method, "/repos/%s/%s" % (REPO, path), "--input", "-"], payload)


def blob_sha(data):
    """git のブロブ sha。リモートの sha と突き合わせて差分判定に使う。"""
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def read(path):
    with open(path, "rb") as f:
        return f.read()


def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            state = json.load(f)
        return state if isinstance(state, dict) else {}
    except (OSError, ValueError):
        return {}


def save_state(state):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, sort_keys=True)


def remote_files():
    """main の最新コミット sha、そのツリーの sha、{パス: ブロブ sha} を返す。"""
    head = api(["/repos/%s/git/ref/heads/%s" % (REPO, BRANCH)])["object"]["sha"]
    tree_sha = api(["/repos/%s/git/commits/%s" % (REPO, head)])["tree"]["sha"]
    tree = api(["/repos/%s/git/trees/%s?recursive=1" % (REPO, tree_sha)])
    files = {t["path"]: t["sha"] for t in tree["tree"] if t["type"] == "blob"}
    return head, tree_sha, files


def push(message, force, dry_run):
    print("push 先: %s (%s)" % (REPO, BRANCH))
    state = load_state()
    head, tree_sha, remote = remote_files()

    changes = []    # (パス, 中身, GitHub 側の sha)
    conflicts = []  # (パス, 理由)
    for path in FILES:
        if not os.path.exists(path):
            print("  %s: ローカルに無いのでスキップ" % path)
            continue
        raw = read(path)
        local = blob_sha(raw)
        remote_sha = remote.get(path)
        synced = state.get(path)  # 最後に pull / push した版

        if remote_sha == local:
            state[path] = local
        elif remote_sha is not None and synced == local:
            print("  %s: GitHub 側だけ更新されています（pull で取得できます）" % path)
        elif remote_sha is None or synced == remote_sha:
            changes.append((path, raw, remote_sha))
        elif synced is None:
            conflicts.append((path, "このフォルダで pull / push した記録がなく、GitHub の最新版を元に編集したか確認できません"))
        else:
            conflicts.append((path, "最後に pull / push したあとで GitHub 側も更新されています"))

    if conflicts and not force:
        print("\n次のファイルは、push すると GitHub 側の変更を上書きするおそれがあるので止めました:", file=sys.stderr)
        for path, reason in conflicts:
            print("  %s: %s" % (path, reason), file=sys.stderr)
        print("手元の変更を退避して `python3 upload.py pull` で最新を取得してから編集し直すか、"
              "上書きしてよければ --force を付けて実行してください。", file=sys.stderr)
        save_state(state)
        return 1
    changes += [(path, read(path), remote.get(path)) for path, _ in conflicts]

    if not changes:
        save_state(state)
        print("push する変更はありません。")
        publish(changed=False)
        return 0

    for path, raw, remote_sha in changes:
        print("  %s: %s (%s bytes)" % (path, "更新" if remote_sha else "新規", format(len(raw), ",")))
    if dry_run:
        print("（-n のため送信していません）")
        return 0

    # 変更したファイルをまとめて1つのコミットにする
    tree_items = []
    for path, raw, _ in changes:
        blob = post("git/blobs", {"content": base64.b64encode(raw).decode("ascii"), "encoding": "base64"})
        tree_items.append({"path": path, "mode": "100644", "type": "blob", "sha": blob["sha"]})
    tree = post("git/trees", {"base_tree": tree_sha, "tree": tree_items})
    commit = post("git/commits", {"message": message, "tree": tree["sha"], "parents": [head]})

    # force: false なので、送信中に main が進んでいたら失敗する（その場合も上書きはしない）
    code, _, err = gh(["-X", "PATCH", "/repos/%s/git/refs/heads/%s" % (REPO, BRANCH), "--input", "-"],
                      {"sha": commit["sha"], "force": False})
    if code != 0:
        print("main を更新できませんでした（送信中に GitHub 側が更新された可能性があります）: %s" % err.strip(),
              file=sys.stderr)
        return 1

    for path, raw, _ in changes:
        state[path] = blob_sha(raw)
    save_state(state)
    print("コミット %s を push しました。" % commit["sha"][:7])
    publish(changed=True)
    return 0


def pull():
    print("取得元: %s (%s)" % (REPO, BRANCH))
    state = load_state()
    _, _, remote = remote_files()
    for path in FILES:
        remote_sha = remote.get(path)
        if remote_sha is None:
            print("  %s: GitHub に無いのでスキップ" % path)
            continue
        local = blob_sha(read(path)) if os.path.exists(path) else None
        if local == remote_sha:
            state[path] = remote_sha
            print("  %s: 最新" % path)
            continue
        if local is not None and state.get(path) != local:
            # まだ push していない手元の編集かもしれないので消さずに残しておく
            shutil.copyfile(path, path + ".bak")
            print("  %s: 手元の版を %s.bak に退避しました" % (path, path))
        blob = api(["/repos/%s/git/blobs/%s" % (REPO, remote_sha)])
        if os.path.dirname(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(base64.b64decode(blob["content"]))
        state[path] = remote_sha
        print("  %s: 取得しました" % path)
    save_state(state)
    return 0


def publish(changed):
    # Pages は有効化済みなら 409 が返るだけなので、そこは失敗扱いにしない。
    code, _, err = gh(["-X", "POST", "/repos/%s/pages" % REPO, "--input", "-"],
                      {"source": {"branch": BRANCH, "path": "/"}})
    if code != 0 and "already enabled" not in err:
        print("Pages 設定の警告: %s" % err.strip(), file=sys.stderr)

    code, out, _ = gh(["/repos/%s/pages" % REPO, "--jq", ".html_url"])
    if code == 0 and out.strip():
        print("公開URL: %s" % out.strip())
        if changed:
            print("反映まで1分ほどかかることがあります。")


def main():
    parser = argparse.ArgumentParser(description="TOEIC Drill のファイルを GitHub に push / pull する")
    parser.add_argument("command", nargs="?", choices=["push", "pull"], default="push")
    parser.add_argument("-m", "--message", default=DEFAULT_MESSAGE, help="コミットメッセージ")
    parser.add_argument("-n", "--dry-run", action="store_true", help="送らずに push される内容だけ表示")
    parser.add_argument("--force", action="store_true", help="GitHub 側の変更を上書きしてでも push する")
    args = parser.parse_args()

    # どこから実行しても、このスクリプトのあるフォルダを基準にする
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    if args.command == "pull":
        return pull()
    return push(args.message, args.force, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
