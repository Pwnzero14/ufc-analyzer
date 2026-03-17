# UFC Fantasy Lines Grabber v2.1 - TypeScript Refactor

## What Changed

This is a major refactor from vanilla JavaScript to TypeScript with centralized services and improved error handling.

### Architecture Improvements

**Before:**
- Mixed concerns in large files (analyzer.js 600+ lines, background.js 400+ lines)
- Global variables and scattered storage access
- Silent error handling with `.catch(() => {})`
- No type safety or validation

**After:**
- **Modular services**: `StorageService`, `ScraperService`, `StatsCalculator`, `LineDropDetector`
- **Centralized config**: All constants and selectors in one place
- **Type definitions**: Full TypeScript with strict mode enabled
- **Proper error handling**: Explicit error logging and recovery
- **Better maintainability**: Services can be tested and reused

### New File Structure

```
src/
├── types/
│   └── index.ts              # Type definitions for all data structures
├── config/
│   └── index.ts              # Central configuration (platforms, selectors, timings)
├── services/
│   ├── StorageService.ts     # Chrome storage wrapper with validation
│   ├── ScraperService.ts     # Unified DOM scraping for all platforms
│   ├── StatsCalculator.ts    # Fantasy points & stats calculations
│   ├── LineDropDetector.ts   # Line drop detection logic
│   └── index.ts              # Service exports
├── background.ts             # Service worker
├── content.ts                # Content script
├── injected.ts               # Page-context script for Underdog
└── popup.ts                  # Popup script
```

### Key Services

#### StorageService
Centralized chrome.storage access with validation:
```typescript
await StorageService.getLines('pick6');
await StorageService.setLines('underdog', fighters);
await StorageService.getLineDropState();
```

#### ScraperService
Unified DOM scraping with error handling:
```typescript
const fighters = await ScraperService.tryScrape('pick6', () => 
  ScraperService.scrapePick6()
);
```

#### StatsCalculator
Fantasy points math and fighter stats:
```typescript
const fp = StatsCalculator.calcFP(
  sigStr, totStr, ctrlSecs, kd, td, rev, won, method, round
);
```

#### LineDropDetector
Adaptive line drop monitoring:
```typescript
const schedule = LineDropDetector.getPlatformSchedule(eventDate);
const drops = LineDropDetector.detectDrops(...);
const interval = LineDropDetector.getPollIntervalMinutes(daysUntil);
```

## Build & Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Build TypeScript
```bash
npm run build
```

This generates `dist/` with compiled JavaScript files.

### 3. Load in Chrome
1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the project directory

### 4. Watch Mode (Development)
```bash
npm run watch
```

Auto-recompiles TypeScript on file changes.

## Configuration

All platforms, selectors, and timings are in `src/config/index.ts`:

```typescript
CONFIG.platforms.pick6.url         // Platform URLs
CONFIG.selectors.pick6.cardButton  // DOM selectors
CONFIG.polling.schedule            // Poll rate by days until event
CONFIG.validation.fp               // Min/max values for validation
```

## Error Handling

All services log errors with context:

```typescript
// Errors are logged to console with [UFC] prefix
console.error('[UFC] StorageService: Failed to get lines', error);
```

Optional error logging to storage:
```typescript
await StorageService.addError({
  code: 'SCRAPE_ERROR',
  message: 'Pick6 selector changed',
  platform: 'pick6',
  timestamp: Date.now(),
  severity: 'error'
});
```

## Global Exports (Debugging)

Access data from browser console:
```javascript
// In background service worker context:
chrome.runtime.sendMessage({ type: 'GET_LINES' }, (lines) => {
  console.log('Current lines:', lines);
});

// Check line drop state:
chrome.runtime.sendMessage({ type: 'GET_LINE_DROP_STATE' }, (state) => {
  console.log('Drop detection state:', state);
});
```

## Breaking Changes from v2.0

- Compiled JavaScript now in `dist/` directory
- HTML files reference `dist/popup.js`, `dist/analyzer.js`, etc.
- `manifest.json` updated to reference `dist/background.js` and `dist/content.js`
- All services must be imported from `@services`, `@config`, or `@types`
- Strict TypeScript mode enabled (no implicit any, strict null checks)

## Migration Guide for Contributors

If adding new features:

1. **Define types** in `src/types/index.ts`
2. **Use CONFIG** for constants, don't hardcode
3. **Create a service** if it's reusable business logic
4. **Call services** from scripts, don't duplicate logic
5. **Handle errors** explicitly, not with silent `.catch()`
6. **Run `npm run build`** before testing

## Performance Notes

- **DOM scraping**: Uses MutationObserver-ready patterns in `ScraperService`
- **Storage**: Chrome.storage.local used with validated schemas
- **Polling**: Adaptive rate accelerates as event approaches (60min → 5min)
- **In-memory cache**: Minimal - only current lines and stats cached

## Future Improvements

- [ ] Add unit tests for services
- [ ] Create shared test suite for scrapers
- [ ] Build UI refresh/cache layer in analyzer
- [ ] Add telemetry for scraper success/failure rates
- [ ] Migrate analyzer.ts (currently still in JavaScript)
- [ ] Support for additional platforms (PrizePicks, etc.)

---

**Version**: 2.1.0  
**TypeScript**: 5.3.3+  
**Chrome Extension Manifest**: V3
