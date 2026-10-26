# Bangladesh Law Assistant

Ask legal questions (answered only from your law datasets, with sources) or anything
else (answered by Gemini). Google login, per-user chat history, dark/light theme.

```
chatbot/
├── backend/     NestJS API (router, chat, Firebase)      port 4000
├── frontend/    Next.js UI                                port 3000
├── retrieval/   Python search service (ChromaDB)          port 8000
└── firestore.rules
```

## How a question is handled

```
Question ─► Router (Gemini flash-lite) ─┬─ general ─────────► Gemini (flash-latest) ─► answer
                                        ├─ law, covered ────► search the matching vector
                                        │                     database(s) ─► Gemma (LM Studio)
                                        │                     answers ONLY from the excerpts
                                        └─ law, not covered ► "I don't have laws for that"
```

The router is told which law databases exist (read automatically from the search
service), so new datasets are picked up with no code change.

## Datasets: one .jsonl file = one law database

Put files in `backend/data/`:

```
backend/data/
├── education.jsonl      -> "Education law"
├── criminal.jsonl       -> "Criminal law"
└── land.jsonl           -> "Land law"
```

The file name is the database name. Create each file with `prepare.py`:
```
python prepare.py education_laws.json education.jsonl
```
(then move the result into `backend/data/`).

Optional `backend/data/domains.json` to improve names/descriptions (helps the router):
```json
{ "land": { "label": "Land law", "description": "Land ownership, tenancy, transfer and registration." } }
```

### Adding a new area of law later
1. Prepare `family.jsonl` and put it in `backend/data/`.
2. `cd retrieval` and run `python ingest.py` (only new/changed files are embedded).
3. That's it. The running search service and backend notice within ~15 seconds.

`python ingest.py --force` re-embeds everything (needed after changing `EMBED_MODEL`).
`python ingest.py --prune` deletes databases whose .jsonl file you removed.

## Setup (Windows)

Requirements: Node.js 18.18+, Python 3.12 (not 3.13/3.14), LM Studio.

### 1. LM Studio
Load **Gemma 4 E4B** (context 8192+), start the server in the **Developer** tab, and copy
the exact model id from http://localhost:1234/v1/models.

### 2. Search service (Python)
```
cd retrieval
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python ingest.py
python -m uvicorn server:app --port 8000      (leave running)
```
Check http://localhost:8000/health and http://localhost:8000/domains.

### 3. Backend
```
cd backend
copy .env.example .env      (edit it: see "Config")
npm install
npm run start:dev
```

### 4. Frontend
```
cd frontend
copy .env.local.example .env.local      (fill the Firebase values)
npm install
npm run dev
```
Open http://localhost:3000. Restart a server after editing its env file.

### 5. Firebase (one time)
1. https://console.firebase.google.com -> Add project (free Spark plan is enough).
2. Build -> Authentication -> Sign-in method -> **Google** -> Enable.
3. Build -> Firestore Database -> Create database (Production mode).
4. Project settings -> General -> Your apps -> Web (</>) -> copy `apiKey`, `authDomain`,
   `projectId`, `appId` into `frontend/.env.local`.
5. Project settings -> Service accounts -> Generate new private key -> save as
   `backend/firebase-service-account.json` (never commit or share it).

## Config (backend/.env)

| Variable | Default | Meaning |
|---|---|---|
| GEMINI_API_KEY | - | needed for the router and general answers |
| GENERAL_MODEL | gemini-flash-latest | answers non-legal questions (`-latest` = always the newest) |
| ROUTER_PROVIDER | gemini | `gemini` (fast) or `lmstudio` (fully local, slower) |
| ROUTER_MODEL | gemini-flash-lite-latest | model used for routing |
| LLM_PROVIDER | lmstudio | who writes legal answers: `lmstudio` or `gemini` |
| LMSTUDIO_CHAT_MODEL | - | exact Gemma id from LM Studio |
| RETRIEVAL_URL | http://localhost:8000 | Python search service |
| TOP_K / MIN_SCORE | 5 / 0 | excerpts per question / weak-match cut-off |
| FIREBASE_SERVICE_ACCOUNT_PATH | ./firebase-service-account.json | |

Python: `EMBED_MODEL` (default `BAAI/bge-small-en-v1.5`; `BAAI/bge-m3` for Bangla).

## API (all need `Authorization: Bearer <Firebase ID token>`)

| Method | Path | |
|---|---|---|
| POST | /api/chat | `{ chatId?, message }` -> `{ chatId, title, reply, sources, route }` |
| GET | /api/chats | your chats |
| GET | /api/chats/:id | one chat with messages |
| DELETE | /api/chats/:id | delete a chat |

`route` = `{ type: "law" \| "general" \| "unsupported", domains: [{id, label}] }`.

Firestore: `users/{uid}`, `users/{uid}/chats/{chatId}`, `.../messages/{id}` (role, content,
sources, route, order). Only the backend touches it; browsers are blocked by `firestore.rules`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Cannot reach the search service" | start the Python service (step 2) |
| "No law databases yet" | run `python ingest.py` |
| Every question is treated as legal | router failing: check GEMINI_API_KEY and the backend log ("Router call failed") |
| "rate limit reached" | Gemini free tier limit; wait a minute |
| A legal question says "not covered" | no database fits; add one, or improve its description in `domains.json` |
| `pip install` fails | use Python 3.12 |
