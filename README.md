# UFC Fantasy Analyzer

A Chrome extension that auto-fetches UFC fantasy prop lines from **Pick6 / DraftKings, Underdog, PrizePicks, and Betr**, pulls each fighter's real fight history from UFCStats, and ranks the strongest **Best Picks** (overs/unders) across Fantasy Points, Significant Strikes, Round-1 Significant Strikes, Takedowns, Fight Time, and Control Time.

It runs entirely in your own browser using your existing logins — there's no server and nothing is sent anywhere (except an optional AI-analysis feature you have to opt into with your own API key).

---

## Install (the easy way — no tools needed)

You only need **Google Chrome**. The extension comes pre-built, so it's just download → unzip → load.

1. On the GitHub page, click the green **`< > Code`** button → **Download ZIP**.
2. **Unzip** it somewhere permanent (e.g. your `Documents` folder). Don't delete this folder later — Chrome loads the extension directly from it.
3. Open Chrome and go to **`chrome://extensions`** (type it in the address bar).
4. Turn on **Developer mode** (toggle in the top-right corner).
5. Click **Load unpacked**.
6. Select the **unzipped folder** — the one that contains `manifest.json` (if your unzip created a folder-inside-a-folder, pick the inner one with `manifest.json` in it).
7. **UFC Fantasy Lines Grabber** now appears in your extensions list. 🎉

> Tip: click the puzzle-piece icon in Chrome's toolbar and **pin** the extension so its icon is always visible.

---

## How to use it

1. **Log in** to the fantasy sites you use in the same Chrome profile (Pick6/DraftKings, Underdog, PrizePicks, Betr). The extension reads lines through your own logged-in session — **you must be logged into Underdog and Pick6** for their lines to come through.
2. Click the **extension icon** in the toolbar to open the popup, then open the **Analyzer** (it opens in its own tab).
3. Hit **Auto-Fetch Lines** (or just visit the fantasy sites once with the extension active) to pull the current slate.
4. Open the **AI Best Picks** tab inside the analyzer to see the ranked overs and unders for the upcoming card.

Fighter histories and cross-book line comparisons populate automatically once lines are fetched.

### ⚠️ First-time Pick6 fetch (one-time warm-up)

Pick6's **first** auto-fetch often comes back empty — its prop tabs don't load for the grabber until you've opened them once yourself. To warm it up:

1. Go to the **Pick6 UFC props** page.
2. Click through **each prop tab one by one** — Significant Strikes, Takedowns, Fantasy Points, Control Time, etc. — so each one loads.
3. After that, the **next auto-fetch works on its own**, and it keeps working automatically from then on.

You only have to do this the first time (or occasionally if Pick6 reshuffles their page).

---

## Updating to a newer version

When a new version is released, just **download a fresh ZIP, unzip it into a new folder**, and in `chrome://extensions`:

- either point **Load unpacked** at the new folder, or
- replace the old folder's contents with the new ones and click the **↻ reload** icon on the extension card.

Your saved lines and history live in Chrome's storage, so they carry over.

---

## Optional — AI analysis (Anthropic API key)

The analyzer works fully without this. There's an extra "AI analyze" feature that calls Claude; to use it, paste your own **Anthropic API key** into the field in the analyzer's settings. The key is stored locally in Chrome on your machine and is only sent to Anthropic's API when you click analyze. No key? Just ignore it — everything else still works.

---

## Troubleshooting

- **"Manifest file is missing or unreadable"** — You selected the wrong folder. Point *Load unpacked* at the folder that directly contains `manifest.json`.
- **No lines show up** — Make sure you're logged into the fantasy sites in the same Chrome profile, then use **Auto-Fetch Lines**. Some books only post props closer to fight day.
- **Underdog or Pick6 lines missing** — You're probably not logged in to that site in this Chrome profile. Log in, then re-fetch.
- **Pick6 always empty on the first try** — This is expected. Open the Pick6 UFC props page and click through each prop tab (SS, TDs, Fantasy Points, Control Time, etc.) once; the next auto-fetch will then pull Pick6 on its own. See the "First-time Pick6 fetch" note above.
- **It looks out of date after an update** — Click the **↻ reload** icon on the extension card in `chrome://extensions`, then refresh the analyzer tab.

---

## For developers (building from source)

The repo ships with the compiled `dist/` folder so end users don't need to build. If you want to modify the code:

```bash
npm install      # one-time: installs the TypeScript build tools (needs Node.js 18+)
npm run build    # compiles src/ → dist/
```

Then reload the extension in `chrome://extensions`. Source lives in `src/` (TypeScript); the build outputs to `dist/`, which the manifest and HTML pages load. After changing code, rebuild and commit the updated `dist/` so the shared/download version stays current.

---

## Notes

- This is a personal hobby tool for analyzing publicly available fantasy lines and fight stats. It uses your own browser sessions and stores everything locally — there is no backend.
- Treat its output as research, not betting advice.
