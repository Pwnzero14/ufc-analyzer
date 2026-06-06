# UFC Fantasy Analyzer

A Chrome extension that auto-fetches UFC fantasy prop lines from **Pick6 / DraftKings, Underdog, PrizePicks, and Betr**, pulls each fighter's real fight history from UFCStats, and ranks the strongest **Best Picks** (overs/unders) across Fantasy Points, Significant Strikes, Round-1 Significant Strikes, Takedowns, Fight Time, and Control Time.

It runs entirely in your own browser using your existing logins — there's no server and nothing is sent anywhere (except an optional AI-analysis feature you have to opt into with your own API key).

---

## What you need first

| Requirement | Why | Where to get it |
|---|---|---|
| **Google Chrome** | Runs the extension | https://www.google.com/chrome/ |
| **Node.js 18 or newer** (includes `npm`) | Used once to build the extension | https://nodejs.org/ (pick the "LTS" installer) |
| **Git** *(optional)* | To clone/update the repo. You can also just download the ZIP. | https://git-scm.com/ |

> **You must build the project before loading it.** The compiled code lives in a `dist/` folder that is **not** included in the repo, so loading the folder straight from GitHub will not work until you run the build step below.

---

## Step 1 — Get the code

**Option A — with Git (recommended, makes updates easy):**

```bash
git clone https://github.com/Pwnzero14/ufc-analzyer.git
cd ufc-analzyer
```

**Option B — without Git:**

1. On the GitHub page, click the green **Code** button → **Download ZIP**.
2. Unzip it somewhere permanent (e.g. `Documents`). Don't delete this folder later — the extension loads directly from it.
3. Open a terminal **inside** that unzipped folder.

---

## Step 2 — Build it

From inside the project folder, run:

```bash
npm install
npm run build
```

- `npm install` downloads the build tools (one-time, may take a minute).
- `npm run build` compiles the code into a new **`dist/`** folder.

When it finishes with no red errors, you're ready to load it into Chrome.

---

## Step 3 — Load it into Chrome

1. Open Chrome and go to **`chrome://extensions`** (type it in the address bar).
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the **project folder** (the one containing `manifest.json` — i.e. the folder you cloned/unzipped, *not* the `dist` folder inside it).
5. The **UFC Fantasy Lines Grabber** extension should now appear in your list.

> Tip: click the puzzle-piece icon in Chrome's toolbar and **pin** the extension so its icon is always visible.

---

## Step 4 — Use it

1. **Log in** to the fantasy sites you use in the same Chrome profile (Pick6/DraftKings, Underdog, PrizePicks, Betr). The extension reads lines through your own logged-in session.
2. Click the **extension icon** in the toolbar to open the popup, then open the **Analyzer** (it opens in its own tab).
3. Hit **Auto-Fetch Lines** (or visit the fantasy sites once with the extension active) to pull the current slate.
4. Open the **AI Best Picks** tab inside the analyzer to see the ranked overs and unders for the upcoming card.

That's it — fighter histories and line comparisons populate automatically once lines are fetched.

---

## Optional — AI analysis (Anthropic API key)

The core analyzer works fully without this. There's an extra "AI analyze" feature that calls Claude; to use it, paste your own **Anthropic API key** into the field in the analyzer's settings. The key is stored locally in Chrome storage on your machine and is only sent to Anthropic's API when you click analyze. If you don't have a key, just ignore this — everything else still works.

---

## Updating to the latest version

If you cloned with Git:

```bash
git pull
npm install
npm run build
```

Then go to **`chrome://extensions`** and click the **↻ reload** icon on the extension card (this reliably flushes the old code).

If you downloaded the ZIP, download a fresh ZIP, re-run `npm install && npm run build`, and reload the extension.

---

## Troubleshooting

- **"Manifest file is missing or unreadable" / it won't load** — You selected the wrong folder or skipped the build. Make sure you ran `npm run build` (a `dist/` folder must exist) and that you pointed *Load unpacked* at the folder containing `manifest.json`.
- **`npm` is not recognized** — Node.js isn't installed (or the terminal was open before you installed it). Install Node.js LTS, then open a fresh terminal.
- **Build shows errors** — Make sure you're on Node 18+ (`node -v`) and ran `npm install` first.
- **No lines show up** — Make sure you're logged into the fantasy sites in the same Chrome profile, then use **Auto-Fetch Lines**. Some books only post props closer to fight day.
- **Code changed but the analyzer looks the same** — Rebuild (`npm run build`) and click the **↻ reload** button on the extension card in `chrome://extensions`, then refresh the analyzer tab.

---

## Notes

- This is a personal hobby tool for analyzing publicly available fantasy lines and fight stats. It uses your own browser sessions and stores everything locally — there is no backend.
- Treat its output as research, not betting advice.
