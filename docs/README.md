# 3D Shooter (Solo / P2P Battle) - HTML5 + JavaScript

## 使い方（開発）
1. VS Codeでこのフォルダを開く
2. Live Server を使って `index.html` を起動  
   - 例: 右下の “Go Live” → ブラウザで表示

## 操作
- WASD: 移動
- Space: ジャンプ
- Shift: ダッシュ
- 左クリック: 射撃
- 1〜4: 武器切り替え
- R: リロード

## BATTLE (P2P)
- Owner が **Create Room** を押す → 出てきたIDを相手に送る
- 相手がそのIDを入力して **Join Room**
- Owner が **Start Game** を押すと開始（同じ seed で同じマップを生成）

## 公開（GitHub Pages）
- このフォルダをリポジトリにそのまま置く
- GitHub Pages を有効化して `index.html` を公開  
  (Three.js / PeerJS / seedrandom はCDN読み込み)

## 注意
- PeerJS は「相手IDを見つける」ために中央サーバーが必要です。  
  このサンプルはデフォルト設定で動かします。安定させたい場合は自前の PeerServer を用意してください。
