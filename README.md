# Interpreter Deck

`Interpreter Deck` は、OpenAI Realtime Translation API を使ったブラウザ向けのライブ翻訳ブースです。

マイク音声やブラウザタブの音声を入力にして、翻訳音声・原文字幕・翻訳字幕をリアルタイムに表示します。海外の配信、動画、会議、イベント配信を「横に置いた通訳卓」で聞くような体験を目指した小さなデモアプリです。

## できること

- マイク音声をリアルタイム翻訳
- 選択したブラウザタブの音声をリアルタイム翻訳
- 翻訳音声をブラウザで再生
- 原文字幕と翻訳字幕を同時に表示
- 音声入力レベル、WebRTC 接続状態、イベント数を表示
- 気になった翻訳文を `Pinned Moments` に保存
- OpenAI API キーをブラウザへ渡さず、サーバー側で短命な client secret を発行

## 画面の使い方

1. `Source` で入力元を選びます。
   - `Mic`: マイク音声を翻訳します。
   - `Tab`: 選択したブラウザタブの音声を翻訳します。
2. `Target` で翻訳先の言語を選びます。
3. `Start` を押します。
4. ブラウザのマイク許可、またはタブ共有を許可します。
5. 翻訳音声と字幕が表示されます。

日本語で話す場合は、最初は `Target` を `English` にして試すと動作確認しやすいです。入力言語と出力言語が同じ場合、翻訳音声がほとんど出ないことがあります。

## セットアップ

Node.js 22 以上が必要です。

```bash
git clone https://github.com/ellrnqq/interpreter-deck.git
cd interpreter-deck
copy .env.example .env
```

`.env` に OpenAI API キーを設定します。

```env
OPENAI_API_KEY=your-openai-api-key
PORT=3000
```

起動します。

```bash
npm run dev
```

ブラウザで開きます。

```text
http://localhost:3000
```

別ポートで起動したい場合は `.env` の `PORT` を変更してください。

## 仕組み

このアプリは次の流れで動きます。

1. ブラウザがローカルサーバーの `/session` に翻訳セッション作成を依頼します。
2. サーバーが `OPENAI_API_KEY` を使って OpenAI Realtime Translation の client secret を発行します。
3. ブラウザはその短命な client secret を使い、WebRTC で OpenAI の Realtime Translation endpoint に接続します。
4. マイクまたはタブ音声を送信し、翻訳音声と transcript event を受け取ります。

API キーはサーバー側だけで使い、ブラウザの JavaScript には埋め込みません。

## 料金について

Realtime Translation API は、長時間つなぎっぱなしにすると料金が高くなりやすいです。

特に動画や配信のタブ音声を長時間流す用途では、使いすぎに注意してください。実運用する場合は、次のような制限を追加することをおすすめします。

- 1 セッションの最大時間を決める
- 無音が続いたら自動停止する
- 押している間だけ翻訳する `Hold to translate` 方式にする
- デモ用途では利用時間や回数に上限を設ける

## セキュリティ

- `.env` は `.gitignore` に含めています。
- OpenAI API キーを `public/` 配下やブラウザコードに書かないでください。
- `.env.example` には実キーを入れないでください。
- 公開サーバーに置く場合は、認証、利用制限、レート制限、ログの取り扱いを追加してください。

## 主なファイル

- `server.mjs`: 静的ファイル配信と Realtime Translation client secret 発行
- `public/app.js`: WebRTC 接続、音声入力、字幕表示、UI 制御
- `public/index.html`: 画面構造
- `public/styles.css`: UI スタイル

## 注意

このリポジトリは実験用のデモです。公開環境でそのまま不特定多数に使わせる場合は、API キーの悪用や予期しない課金を防ぐための保護を追加してください。
