# AGENTS.md — Coding Guidelines for this Repository

These rules are read by AI coding agents (and humans) before working here.
Follow them without exception.

## Empty / filler output is a bug
- Never emit repeated placeholder tokens, stray words, or filler like repeated
  keystrokes (cuen, etc.) before, between, or after real actions.
- A single tool call to solve a step is correct. Repeating near-identical
  output in a loop is a malfunction — stop it immediately.
- If you catch yourself producing redundant output, halt, make the intended
  single tool call (or write your answer), and move on. Do not loop.

## Keep it concise
- Respond in short, direct messages. No preamble or postamble.
- Do not repeat the same summary multiple times.

## This project
- Static web app (no build step). Open `index.html` / `decks.html` to run.
- Card images: resolve via the direct CDN URL fast path in `api.js`
  (`https://images.pokemontcg.io/<setid>/<number>_hires.png`), not the
  rate-limited search API. Use `createCardImg()` for image elements.
- Card storage and saved decks live in the user's browser localStorage.
- Commit and push to `main` (this repo is served via GitHub Pages).
