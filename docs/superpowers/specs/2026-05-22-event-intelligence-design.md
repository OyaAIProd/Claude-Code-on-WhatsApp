# Event Intelligence + Gemini CLI Vision — Design Spec

Date: 2026-05-22
Status: Approved (pending implementation)

## Problem

Current image/search/location is inaccurate:
- Vision stored as a free-text `vision_desc`; recall is brittle FTS keyword matching. The bot can't answer "kapal sudah berangkat?" even when a photo of the ship (with a time mark + name "KM Ramli") is clearly in the group.
- Search is "dumb" keyword matching; the bot doesn't reliably pick the right tool or look at images when searching.
- Live GPS is unreliable (Baileys live-location updates rarely fire); the web admin map stays stuck on the initial point.

## Goal

Revolution, not patch: extract **structured events** from every photo/video/caption/location/tracking-message, build a per-entity **timeline**, and answer operational questions ("berangkat/sampai/dimana") by reasoning over events. Vision moves to **Gemini CLI** (subscription, no API key). Search must cover images too; RAG quality improved.

## Decisions (from brainstorming)

- Architecture: **Approach A — structured event log + hybrid retrieval** (chosen over fuzzy embeddings / full knowledge graph).
- Source of truth: **both** event-from-media (primary reasoning) and GPS (best-effort).
- Retrieval: **hybrid** — deterministic pre-resolver + Claude can Bash-SQL the event DB for complex cases.
- Arrival logic: explicit caption/text = certain; repeat-shipment photo later = "kemungkinan sampai" (labeled, with reason). Destination via route order.
- Vision engine: **Gemini CLI headless** (Antigravity CLI not installed; Gemini CLI is, auth via Google login = free). Tamed: image in workspace, model-fallback, cooldown queue.

## Components

### 1. `gemini.js` — vision engine (Gemini CLI, tamed)
- Spawn `gemini -y -o text -m <model> -p "<prompt> @<file>"` headless, **cwd = the image's folder** (Gemini rejects files outside its workspace; relative `@file` in cwd attaches as multimodal).
- **Model fallback**: ordered list (e.g. `gemini-2.5-flash`, `gemini-flash-latest`, `gemini-2.0-flash`). On `exhausted capacity` / 404 / 429 → next model.
- **Cooldown + serial queue**: if all models exhausted → enqueue and wait for cooldown (quota resets ~6s); process one image at a time so a flood of images doesn't hammer the limit.
- Prompt frames output **for Claude**: "deskripsikan + ekstrak data terstruktur supaya Claude paham" → returns structured JSON (subject, action, dari/ke/via, time-on-media, goods).
- Optional safety net: if cooldown is too long, fall back to Groq (decision pending; keep configurable).
- RISK to resolve first in implementation: confirm a clean headless image→description invocation (the `-e none` test failed to attach the image; the default mode went agentic). Nail exact flags before building the rest.

### 2. `events.js` — structured event log
Table `events`: `subject_type (kapal|orang|barang|kendaraan|lokasi|lainnya)`, `subject_name` (canonical), `action (berangkat|sampai|transit|muat|bongkar|terlihat|null)`, `dari`, `ke`, `via`, `time_on_media`, `place`, `goods_desc`, `confidence`, `source` (chat+sender), `ts`.
- `extractEvents(media|caption|text)` via `gemini.js`; caption authoritative; keep raw `vision_desc` for fallback/Read.
- **Canonicalization**: alias map so "Ramli"/"KM Ramli"/"kapal ramli" → one entity.

### 3. Shipment linking + arrival inference
- Shipment = (goods + via + origin). A "berangkat" event opens it.
- A later matching event (same via+origin, similar goods) links as progress.
- Arrival: explicit text = certain; repeat-photo = probable (labeled); destination from route order.

### 4. Retrieval (hybrid) + image-aware search
- **Pre-resolver**: detect intent (vessel/person/goods X berangkat/sampai/dimana) → SQL `events` timeline → inject a compact STATUS block + answer hint (deterministic).
- **Claude Bash-SQL**: the model may query `events` + `messages_fts` + `vision_desc` directly via Bash for complex/unmatched questions — search covers images, not just text.

### 5. RAG improvements
- Search corpus includes image/video descriptions + events (not just text).
- **Rank fusion (RRF)** combining FTS + semantic (replaces naive interleave).
- **Query expansion**: alias/synonyms (kapal=km=boat, sampai=tiba=arrived, berangkat=jalan).
- Recency boost + relevance threshold.
- Operational questions bypass fuzzy RAG → deterministic `events`.

### 6. Location / GPS
- Each new shared point → a location event (timeline). Live updates best-effort; photo events fill GPS gaps. Web admin map already exists.

## Files
- New: `gemini.js`, `events.js`.
- Changed: `vision.js` (structured JSON via Gemini), `rag.js` (RRF + expansion + image corpus), `index.js` (media/location/tracking-text → extractEvents), `ai.js` (pre-resolver + inject STATUS + allow Bash-SQL).

## Cost
- Gemini CLI = free via Google login. Pre-resolver + RRF = local SQL (0 Claude tokens). Inject only when relevant.

## Build order
1. `gemini.js` (verify headless image invocation FIRST) → 2. `events.js` → 3. shipment/arrival → 4. retrieval+pre-resolver → 5. RAG improvements → 6. location events.

## Out of scope / honest limits
- Real-time continuous live GPS (Baileys limitation) — best-effort only.
- Gemini CLI free quota is small per model; mitigated by model-fallback + cooldown queue, but heavy image bursts will process slowly.
