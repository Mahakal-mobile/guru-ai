# Guru AI

A production-ready, dark, premium AI chat dashboard. Static frontend + one secure serverless backend function, built for zero-config deployment on Vercel.

```
guru-ai/
├── public/
│   └── index.html      # Entire frontend — UI, styling, and client logic
├── api/
│   └── chat.js          # Serverless function — talks to Gemini, keeps the key server-side
├── package.json
├── vercel.json
└── .env.example
```

## Features

- Minimal top bar with a language switcher (English, Hindi, and more) and a Settings button.
- Settings drawer with independent toggles: AI Core Engine (master), Live Web Search Grounding, Continuous Voice Agent, and Auto-Mode.
- Bottom composer with a `+` menu (Camera, Photos, Files & PDF), a voice-input mic, and a send button.
- Multimodal messages: images and PDFs are base64-encoded client-side and sent to the backend as inline data.
- Backend calls Gemini with Google Search grounding enabled, and returns cited sources alongside the reply.
- No API key ever reaches the browser — `api/chat.js` reads `GEMINI_API_KEY` from the server environment only.

## Deploy to Vercel

1. Push this folder to a Git repository (GitHub/GitLab/Bitbucket).
2. In Vercel, "Add New Project" → import the repo. No build command is needed (static `public/` + `api/` functions are auto-detected).
3. In **Project Settings → Environment Variables**, add:
   - `GEMINI_API_KEY` = your key from [Google AI Studio](https://aistudio.google.com/apikey)
4. Deploy. Your app will be live at `https://<your-project>.vercel.app`.

## Local development

```bash
npm install -g vercel
cp .env.example .env.local   # fill in GEMINI_API_KEY
vercel dev
```

This serves `public/index.html` at `/` and runs `api/chat.js` at `/api/chat`, matching production exactly.

## Notes

- The model used is `gemini-2.5-flash`. Change `GEMINI_MODEL` at the top of `api/chat.js` if you want a different Gemini model.
- Web search grounding is toggled per-request from the Settings drawer (`Live Web Search Grounding`); when off, the backend skips the search tool entirely.
- Voice input uses the browser's built-in SpeechRecognition API (Chrome/Edge/Safari); it falls back to a friendly message where unsupported.
- Attachments are capped at 15MB client-side and ~18MB base64 server-side to stay well under serverless payload limits.
