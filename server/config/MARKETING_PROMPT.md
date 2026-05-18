# Elite Edge Sports Tips — Marketing Content Engine Prompt

This is the reference strategy document for the marketing content engine.
The engine at `server/services/marketingEngine.js` implements this.
Event config at `server/config/events/*.json` drives the campaign.

## How to use

1. Set `ENABLE_MARKETING=true` in Railway
2. Set `MARKETING_EVENT=worldcup2026` (or any event config filename)
3. Engine auto-loads and creates tables on deploy
4. Admin endpoints:
   - `POST /api/marketing/generate` — generate today's content pack
   - `GET /api/marketing/today` — review generated content
   - `POST /api/marketing/post/:fixtureId` — approve + post to Telegram
   - `GET /api/marketing/classify?date=YYYY-MM-DD` — see tier classification

## Swapping events

Create a new JSON file in `server/config/events/`:
- `euros2028.json`
- `championsleague2027.json`
- `premierleague2026.json`

Change `MARKETING_EVENT` env var. No code changes needed.

## Full strategy prompt

See the complete Hero/Hub/Hygiene framework, audience segmentation,
viral mechanics, conversion funnel, and all other sections in the
project memory at `memory/project_marketing_prompt.md`.
