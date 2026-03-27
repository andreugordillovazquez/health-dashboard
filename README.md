# Apple Health Dashboard

A privacy-first, client-side dashboard for visualizing your Apple Health data. Upload your export, get interactive charts and insights. Nothing leaves your browser.

## How it works

1. Export your health data from iPhone: **Settings > Health > Export All Health Data**
2. Unzip the export
3. Open the dashboard and select the exported folder
4. Browse your data across 14 interactive tabs

## Features

| Tab | What it shows |
|-----|---------------|
| **Overview** | Key metrics, trend ticker, steps/sleep/HR/HRV/distance/weight charts |
| **Records** | 15 personal records — fastest km, most steps, longest sleep, etc. |
| **Yearly** | Year-over-year comparison table with % changes |
| **Calendar** | GitHub-style heatmaps for 6 metrics, per year |
| **Cardio** | VO2 Max, fitness age, resting/walking HR, HR recovery, HR range, HRV |
| **ECG** | Interactive ECG waveform viewer with drag/scroll navigation |
| **Body** | Weight, body fat %, lean mass, BMI trends |
| **Sleep** | Stage breakdown, consistency score, efficiency, bedtime/wake trends, wrist temperature, breathing disturbances, SpO2 |
| **Daylight** | Daily sunlight exposure with seasonal patterns |
| **Audio** | Headphone/environmental noise levels vs WHO safe thresholds |
| **Correlations** | 11 scatter plots with Pearson r (sleep vs HRV, exercise vs HR, etc.) |
| **Trainings** | All workouts with per-session HR chart, HR zones, km splits, GPS routes |
| **Compare** | Auto-detects repeated routes, compares pace/speed progression |
| **Heatmap** | All GPS routes overlaid on one map with frequency coloring |

## Technical highlights

- **1.4GB XML parsed in-browser** via Web Worker with 64MB streaming chunks
- **Source deduplication** — iPhone + Apple Watch step/distance/energy records deduplicated by taking max per source per day
- **Sleep deduplication** — granular Watch stages preferred over iPhone's unspecified records
- **546k HR samples** stored with timestamps for per-workout HR curves via binary search
- **Lazy loading** — each tab is code-split; Recharts and Leaflet in separate chunks
- **Privacy** — zero network requests. All parsing, analysis, and rendering happens locally.

## Stack

- React 19 + TypeScript
- Vite 8
- Recharts (charts)
- Leaflet + react-leaflet (maps)
- Tailwind CSS v4
- Lucide React (icons)

## Development

```bash
npm install
npm run dev
```

## Deploy

```bash
npm run build
# dist/ is ready for Vercel, Netlify, or any static host
```

Or connect to Vercel:

```bash
npx vercel
```

## Data format

Parses Apple Health's `export.xml` (or localized variants like `exportacion.xml`). Works with any language — all HealthKit identifiers are language-independent API constants.

Also reads:
- `electrocardiograms/*.csv` — ECG waveform data at 512Hz
- `workout-routes/*.gpx` — GPS tracks with speed/elevation

## License

MIT
