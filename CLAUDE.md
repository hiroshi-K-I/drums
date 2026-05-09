# Drum Kit Project

## Git ワークフロー

**作業開始前に必ず確認すること:**

- 現在のブランチが `main` のままになっていないか確認する
- `main` で作業しようとしていたらリマインドして、新しいブランチを切るよう促す
- merge/PR完了後は元ブランチを捨て、`main` から新しいブランチを切る

```bash
git checkout main
git pull origin main
git checkout -b feature/xxx
```

## プロジェクト概要

ブラウザで動作するドラムシミュレータ。外部依存なし。

- `index.html` — HTML構造
- `style.css` — ダークテーマ、レスポンシブ
- `app.js` — Web Audio API合成エンジン、UI、SEQスケジューラ

## 開発サーバー

```bash
cd /home/user/drums
python3 -m http.server 8080
```

ES module は `file://` では動かないのでサーバー必須。
