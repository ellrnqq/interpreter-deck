# Interpreter Deck

A small browser-side live translation booth for `gpt-realtime-translate`.

## Run

1. Copy `.env.example` to `.env`.
2. Set `OPENAI_API_KEY`.
3. Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`, choose a source and target language, then start a session.

## Notes

- `Mic` captures microphone audio with `getUserMedia()`.
- `Tab` captures browser tab audio with `getDisplayMedia()`.
- The server creates a short-lived Realtime Translation client secret so the OpenAI API key is never sent to the browser.
- The browser sends audio through WebRTC to `https://api.openai.com/v1/realtime/translations/calls`.
