# CLAUDE.md

## Project overview
Apple Health Dashboard — a React app that parses Apple Health XML exports (1GB+) client-side and renders interactive health visualizations. Everything runs in the browser, no server.

## Build & run
```bash
npm install
npm run dev      # dev server on localhost:5173
npm run build    # production build to dist/
```

## Architecture

### Data flow
1. User selects folder via `App.tsx` (drag-drop or file picker)
2. XML file + GPX/ECG files collected from the folder
3. `parseWorker.ts` (Web Worker) streams the XML in 64MB chunks using regex extraction
4. Parsed data sent to main thread → stored in `HealthData` (see `types.ts`)
5. `Dashboard.tsx` renders tabs, each lazy-loaded

### Key files
- `src/types.ts` — all TypeScript interfaces (DailyMetrics, Workout, SleepRecord, etc.)
- `src/parseWorker.ts` — streaming XML parser in a Web Worker. Handles deduplication (sleep stages, step sources)
- `src/analysis.ts` — trend computation, grouped averages. Exports `Granularity` type
- `src/ui.tsx` — shared components (StatBox, ChartCard, Legend) and constants (COLORS, tooltipStyle, chartMargin). All components import from here instead of defining their own
- `src/Dashboard.tsx` — main layout with tab navigation, time range, and granularity controls
- `src/App.tsx` — upload screen and folder/file collection logic

### Component files (one per tab)
`Cardio.tsx`, `ECGViewer.tsx`, `BodyComposition.tsx`, `SleepAnalysis.tsx`, `Breathing.tsx`, `Daylight.tsx`, `AudioExposure.tsx`, `Correlations.tsx`, `TrainingViewer.tsx`, `RouteComparison.tsx`, `RouteHeatmap.tsx`, `PersonalRecords.tsx`, `YearInReview.tsx`, `CalendarHeatmap.tsx`

### Data deduplication
- **Steps/distance/energy**: tracked per-source per-day (`stepsBySource` Map in Accumulator), then `maxSource()` picks the highest source's daily total. Prevents iPhone+Watch double-counting.
- **Sleep**: if a day has granular Watch stages (Core/Deep/REM), iPhone's `AsleepUnspecified` records are ignored. Uses `daysWithStages` Set + deferred `unspecifiedSleep` Map.
- **Body fat / SpO2**: `value > 1 ? value : value * 100` handles both decimal (0.15) and percentage (15) formats.

### Charts
All charts use Recharts. Shared config:
- `chartMargin = { top: 5, right: 5, bottom: 0, left: -15 }` (tight Y-axis)
- `tooltipStyle` with #101014 background
- `ResponsiveContainer` with `minWidth={0} debounce={1}`
- Gradient fills on all area charts (defs + linearGradient pattern)

### Maps
Leaflet with CARTO dark tiles. CSS override forces `z-index: 1` on all leaflet panes so the sticky header stays above maps.

## Code conventions
- Shared UI in `ui.tsx` — don't create local StatBox/ChartCard/Legend/tooltipStyle in component files
- Colors from `COLORS` object in `ui.tsx` — don't hardcode hex values
- Component-specific color aliases (e.g., `SLEEP_COLORS`) are OK when extending the shared palette
- Chart heights: `h-56` standard, `h-64` for tall/important charts, `h-80` for maps
- All dates as `YYYY-MM-DD` strings throughout
- Granularity (`daily`/`weekly`/`monthly`) passed as prop to tabs that support time filtering

## Apple Health XML format
- Record types are HealthKit API constants (always English regardless of phone language)
- `<Record>` elements: self-closing (`/>`) or with children (`>...<MetadataEntry/>...</Record>`)
- `<Workout>` blocks contain `<WorkoutStatistics>` (HR avg/min/max, calories, distance) and `<MetadataEntry>` (METs, weather, elevation)
- Sleep records can overlap (iPhone InBed + Watch stages) — must deduplicate
- Distance units vary: `km` for running, `m` for swimming — check the `unit` attribute
- Body fat stored as decimal fraction (0.15 = 15%) with `unit="%"`
