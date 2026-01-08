# P2P Invite Chat (GitHub Pages /docs 対応)

これは「招待URLで友達と1対1チャット」を WebRTC(PeerJS) の P2P で行う最小プロジェクトです。
GitHub Pages の **Deploy from a branch** で **/docs** を公開フォルダにできる形にしてあります。

## GitHub Pages で公開する（友達と外から使う）
1. このリポジトリの Settings → Pages を開く
2. Source: Deploy from a branch
3. Branch: main / Folder: /docs を選んで Save
4. 公開URLが `https://<user>.github.io/<repo>/` の形で出ます

⚠️ `localhost` は自分のPCを指すので、友達は入れません。公開URLを送ってください。

## 使い方（招待URL）
- まず自分が公開URLを開く → 画面に「自分のID」と「招待URL」が出ます
- その招待URLを友達に送る
- 友達が開くと `?connect_to=...` により自動で接続を試みます

## ローカルで試す
- Windows: `play.cmd` をダブルクリック（http://localhost:8000 で開きます）
- ローカル起動でもP2P接続自体は可能ですが、友達に送るなら公開URLが必要です。

## 技術メモ
- PeerJSは `peer.connect()` と `peer.on('connection')` で DataConnection を張れます。
- WebRTCのデータ通信は DataChannel を使います（PeerJSが内部でラップ）。
