# Sentinel Machines web app

Security video review dashboard: upload recordings or monitor a live feed, and a vision-language model flags suspected incidents with timestamps. It also has a contextual assistant and an AI summary.

## Run
1. `npm install`
2. `cp .env.example .env.local`, then fill in one of:
   - **OpenRouter:** `VLM_BASE_URL=https://openrouter.ai/api/v1`, `VLM_API_KEY=sk-or-…`, `VLM_MODEL=qwen/qwen3-vl-30b-a3b-instruct`
   - **Local server on the GB10:** `VLM_BASE_URL=http://localhost:8000/v1`, `VLM_MODEL=<served model name>`, and no key
3. `npm run dev`, then open http://localhost:3000.

Without a model configured, the app runs in demo mode. Bundled samples and their detections are always simulated. AI detections are suspected until a person reviews them.

Which model to use and how it compares with HawkWatch: [model bake-off](../model/openrouter-bakeoff/README.md). See also the [project guidance](CLAUDE.md), the [model integration plan](.plans/model-integration.md) and the [roadmap](.plans/webapp-roadmap.md).
