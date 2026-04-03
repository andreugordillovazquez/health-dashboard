import type {
  HealthData, DailyMetrics, Workout, SleepRecord, DailyBreathing,
  DailyHR, CardioRecord, GarminMetrics, GarminSleepScore,
} from './types'

// Garmin activity type → human-readable name
const ACTIVITY_TYPES: Record<string, string> = {
  trail_running: 'Trail Running',
  running: 'Running',
  cycling: 'Cycling',
  swimming: 'Swimming',
  open_water_swimming: 'Open Water Swimming',
  pool_swimming: 'Pool Swimming',
  hiking: 'Hiking',
  walking: 'Walking',
  strength_training: 'Strength Training',
  yoga: 'Yoga',
  elliptical: 'Elliptical',
  indoor_cycling: 'Indoor Cycling',
  virtual_ride: 'Virtual Ride',
  mountain_biking: 'Mountain Biking',
  rock_climbing: 'Climbing',
  bouldering: 'Bouldering',
  skiing: 'Skiing',
  snowboarding: 'Snowboarding',
  rowing: 'Rowing',
  indoor_rowing: 'Indoor Rowing',
  paddleboarding: 'Paddleboarding',
  fitness_equipment: 'Fitness Equipment',
  cardio: 'Cardio',
  breathwork: 'Breathwork',
  pilates: 'Pilates',
  hiit: 'HIIT',
  other: 'Other',
}

function humanizeActivityType(raw: string): string {
  return ACTIVITY_TYPES[raw] || raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function epochToDate(epoch: number): string {
  const d = new Date(epoch)
  return d.toISOString().slice(0, 10)
}

function epochToISO(epoch: number): string {
  return new Date(epoch).toISOString()
}

type FilesByPattern = Map<string, File[]>

function categorizeFiles(files: File[]): FilesByPattern {
  const map: FilesByPattern = new Map()
  const patterns = [
    'UDSFile', 'HydrationLogFile', 'sleepData', 'healthStatusData',
    'summarizedActivities', 'personalRecord', 'fitnessAgeData',
    'userBioMetrics', 'wellnessActivities',
    'TrainingReadinessDTO', 'ActivityVo2Max', 'EnduranceScore',
    'HillScore', 'MetricsAcuteTrainingLoad', 'RunRacePredictions',
    'MetricsHeatAltitudeAcclimation', 'MetricsMaxMetData', 'TrainingHistory',
  ]
  for (const p of patterns) map.set(p, [])

  for (const file of files) {
    const name = file.name
    for (const p of patterns) {
      if (name.includes(p)) {
        map.get(p)!.push(file)
        break
      }
    }
  }
  return map
}

async function readJsonFiles(files: File[]): Promise<unknown[]> {
  const results: unknown[] = []
  for (const f of files) {
    try {
      const text = await f.text()
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) results.push(...parsed)
      else results.push(parsed)
    } catch { /* skip malformed files */ }
  }
  return results
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function get(obj: any, key: string, fallback: any = null) {
  return obj[key] ?? fallback
}

function parseUDS(records: unknown[]): { metrics: Map<string, DailyMetrics>; stress: GarminMetrics['stressDaily'] } {
  const metrics = new Map<string, DailyMetrics>()
  const stress: GarminMetrics['stressDaily'] = []

  for (const r of records) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = r as any
    const date = rec.calendarDate
    if (!date || typeof date !== 'string') continue

    const dm: DailyMetrics = {
      date,
      steps: get(rec, 'totalSteps', 0),
      activeEnergy: get(rec, 'activeKilocalories', 0),
      restingHeartRate: get(rec, 'restingHeartRate'),
      hrv: null,
      vo2max: null,
      weight: null,
      sleepHours: null,
      distance: (get(rec, 'totalDistanceMeters', 0) || 0) / 1000,
      exerciseMinutes: (get(rec, 'moderateIntensityMinutes', 0) || 0) + (get(rec, 'vigorousIntensityMinutes', 0) || 0),
      standHours: 0,
      activeEnergyGoal: 0,
      exerciseGoal: get(rec, 'userIntensityMinutesGoal', 0) || 0,
      standGoal: 0,
    }
    metrics.set(date, dm)

    // Extract stress
    const stressData = rec.allDayStress
    if (stressData?.aggregatorList) {
      const total = stressData.aggregatorList.find((a: { type: string }) => a.type === 'TOTAL')
      if (total && total.averageStressLevel) {
        stress.push({
          date,
          avgStress: total.averageStressLevel,
          maxStress: total.maxStressLevel || 0,
          restDuration: total.restDuration || 0,
          stressDuration: total.stressDuration || 0,
        })
      }
    }
  }
  return { metrics, stress }
}

function parseSleep(records: unknown[]): { sleepRecords: SleepRecord[]; sleepScores: GarminSleepScore[] } {
  const sleepRecords: SleepRecord[] = []
  const sleepScores: GarminSleepScore[] = []

  for (const r of records) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = r as any
    if (!rec.calendarDate) continue

    const date = rec.calendarDate
    const startDate = rec.sleepStartTimestampGMT || ''
    const endDate = rec.sleepEndTimestampGMT || ''

    // Create sleep stage records
    const stages: [string, number][] = [
      ['deep', rec.deepSleepSeconds || 0],
      ['core', rec.lightSleepSeconds || 0],
      ['rem', rec.remSleepSeconds || 0],
      ['awake', rec.awakeSleepSeconds || 0],
    ]

    for (const [stage, seconds] of stages) {
      if (seconds > 0) {
        sleepRecords.push({
          date,
          stage: stage as SleepRecord['stage'],
          startDate,
          endDate,
          minutes: seconds / 60,
        })
      }
    }

    // Extract sleep scores
    if (rec.sleepScores) {
      const s = rec.sleepScores
      sleepScores.push({
        date,
        overall: s.overallScore || 0,
        quality: s.qualityScore || 0,
        duration: s.durationScore || 0,
        recovery: s.recoveryScore || 0,
        deep: s.deepScore || 0,
        rem: s.remScore || 0,
        light: s.lightScore || 0,
        avgStress: rec.avgSleepStress || 0,
        respiration: rec.averageRespiration || 0,
      })
    }
  }

  return { sleepRecords, sleepScores }
}

function parseActivities(records: unknown[]): Workout[] {
  const workouts: Workout[] = []

  for (const r of records) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = r as any

    // Handle wrapper format: { summarizedActivitiesExport: [...] }
    if (rec.summarizedActivitiesExport) {
      for (const act of rec.summarizedActivitiesExport) {
        workouts.push(activityToWorkout(act))
      }
      continue
    }
    if (rec.activityId) {
      workouts.push(activityToWorkout(rec))
    }
  }

  return workouts.sort((a, b) => a.date.localeCompare(b.date))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function activityToWorkout(act: any): Workout {
  const startMs = act.beginTimestamp || act.startTimeGmt || 0
  const startDate = epochToISO(startMs)
  const date = epochToDate(startMs)
  const durationMs = act.duration || 0
  const endDate = epochToISO(startMs + durationMs)

  return {
    type: humanizeActivityType(act.activityType || 'other'),
    date,
    startDate,
    endDate,
    duration: durationMs / 60000,
    calories: act.calories || 0,
    distance: act.distance ? act.distance / 100000 : null,
    hrAvg: act.avgHr || null,
    hrMin: act.minHr || null,
    hrMax: act.maxHr || null,
    avgMETs: null,
    weather: null,
    elevationAscended: act.elevationGain ? act.elevationGain / 100 : null,
  }
}

function parseHealthStatus(records: unknown[]): { breathing: DailyBreathing[]; dailyHR: DailyHR[]; cardio: CardioRecord[] } {
  const breathing: DailyBreathing[] = []
  const dailyHR: DailyHR[] = []
  const cardio: CardioRecord[] = []

  for (const r of records) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = r as any
    if (!rec.calendarDate || !rec.metrics) continue

    const date = rec.calendarDate
    let spo2: number | null = null
    let resp: number | null = null
    let hr: number | null = null

    for (const m of rec.metrics) {
      if (m.type === 'SPO2' && m.value) spo2 = m.value
      if (m.type === 'RESPIRATION' && m.value) resp = m.value
      if (m.type === 'HRV' && m.value) {
        cardio.push({ date, value: m.value, type: 'vo2max' })
      }
      if (m.type === 'HR' && m.value) hr = m.value
    }

    breathing.push({ date, disturbances: null, respiratoryRate: resp, spo2 })
    if (hr) {
      dailyHR.push({ date, min: hr, max: hr, avg: hr })
    }
  }

  return { breathing, dailyHR, cardio }
}

function parseTrainingReadiness(records: unknown[]): GarminMetrics['trainingReadiness'] {
  const result: GarminMetrics['trainingReadiness'] = []
  const seen = new Set<string>()

  for (const r of records) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = r as any
    const date = rec.calendarDate
    if (!date || typeof date !== 'string' || seen.has(date)) continue
    seen.add(date)

    result.push({
      date,
      score: rec.score || 0,
      level: rec.level || '',
      sleepFactor: rec.sleepScoreFactorPercent || 0,
      recoveryTimeFactor: rec.recoveryTimeFactorPercent || 0,
      acwrFactor: rec.acwrFactorPercent || 0,
      stressFactor: rec.stressHistoryFactorPercent || 0,
      hrvFactor: rec.hrvFactorPercent || 0,
      sleepHistoryFactor: rec.sleepHistoryFactorPercent || 0,
    })
  }
  return result.sort((a, b) => a.date.localeCompare(b.date))
}

function parseVo2Max(records: unknown[]): GarminMetrics['vo2max'] {
  const result: GarminMetrics['vo2max'] = []
  for (const r of records) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = r as any
    if (!rec.calendarDate || !rec.vo2MaxValue) continue
    const date = typeof rec.calendarDate === 'string' ? rec.calendarDate : epochToDate(rec.calendarDate)
    result.push({ date, value: rec.vo2MaxValue, sport: rec.sport || 'RUNNING' })
  }
  return result.sort((a, b) => a.date.localeCompare(b.date))
}

function parseEnduranceScore(records: unknown[]): GarminMetrics['enduranceScore'] {
  const result: GarminMetrics['enduranceScore'] = []
  const seen = new Set<string>()
  for (const r of records) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = r as any
    if (!rec.calendarDate) continue
    const date = typeof rec.calendarDate === 'string' ? rec.calendarDate : epochToDate(rec.calendarDate)
    if (seen.has(date)) continue
    seen.add(date)
    result.push({
      date,
      score: rec.overallScore || 0,
      classification: rec.classification || 0,
      contributors: (rec.enduranceScoreContributor || []).map((c: { group: number; contribution: number }) => ({
        group: c.group,
        contribution: c.contribution,
      })),
    })
  }
  return result.sort((a, b) => a.date.localeCompare(b.date))
}

function parseHillScore(records: unknown[]): GarminMetrics['hillScore'] {
  const result: GarminMetrics['hillScore'] = []
  const seen = new Set<string>()
  for (const r of records) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = r as any
    if (!rec.calendarDate) continue
    const date = typeof rec.calendarDate === 'string' ? rec.calendarDate : epochToDate(rec.calendarDate)
    if (seen.has(date)) continue
    seen.add(date)
    result.push({
      date,
      overall: rec.overallScore || 0,
      strength: rec.strengthScore || 0,
      endurance: rec.enduranceScore || 0,
    })
  }
  return result.sort((a, b) => a.date.localeCompare(b.date))
}

function parseAcuteTrainingLoad(records: unknown[]): GarminMetrics['acuteTrainingLoad'] {
  const result: GarminMetrics['acuteTrainingLoad'] = []
  const seen = new Set<string>()
  for (const r of records) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = r as any
    if (!rec.calendarDate) continue
    const date = typeof rec.calendarDate === 'string' ? rec.calendarDate : epochToDate(rec.calendarDate)
    if (seen.has(date) || !rec.dailyTrainingLoadAcute) continue
    seen.add(date)
    result.push({
      date,
      acute: rec.dailyTrainingLoadAcute || 0,
      chronic: rec.dailyTrainingLoadChronic || 0,
      ratio: rec.dailyAcuteChronicWorkloadRatio || 0,
      status: rec.acwrStatus || 'UNKNOWN',
    })
  }
  return result.sort((a, b) => a.date.localeCompare(b.date))
}

function parseRacePredictions(records: unknown[]): GarminMetrics['racePredictions'] {
  const result: GarminMetrics['racePredictions'] = []
  const seen = new Set<string>()
  for (const r of records) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = r as any
    if (!rec.calendarDate) continue
    const date = typeof rec.calendarDate === 'string' ? rec.calendarDate : epochToDate(rec.calendarDate)
    if (seen.has(date)) continue
    seen.add(date)
    if (rec.raceTime5K || rec.raceTime10K) {
      result.push({
        date,
        time5k: rec.raceTime5K || 0,
        time10k: rec.raceTime10K || 0,
        timeHalf: rec.raceTimeHalf || 0,
        timeMarathon: rec.raceTimeMarathon || 0,
      })
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date))
}

function parseHeatAltitude(records: unknown[]): GarminMetrics['heatAltitude'] {
  const result: GarminMetrics['heatAltitude'] = []
  const seen = new Set<string>()
  for (const r of records) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = r as any
    if (!rec.calendarDate) continue
    const date = typeof rec.calendarDate === 'string' ? rec.calendarDate : epochToDate(rec.calendarDate)
    if (seen.has(date)) continue
    seen.add(date)
    result.push({
      date,
      heatPercent: (rec.heatAcclimationPercentage || 0) * 100,
      altitudeAcclimation: rec.altitudeAcclimation || 0,
    })
  }
  return result.sort((a, b) => a.date.localeCompare(b.date))
}

function parseFitnessAge(records: unknown[]): GarminMetrics['fitnessAge'] {
  const result: GarminMetrics['fitnessAge'] = []
  for (const r of records) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = r as any
    const date = rec.asOfDateGmt?.slice(0, 10) || rec.calendarDate
    if (!date || !rec.currentBioAge) continue
    result.push({
      date,
      fitnessAge: rec.currentBioAge,
      chronologicalAge: rec.chronologicalAge || 0,
      vo2max: rec.biometricVo2Max || 0,
    })
  }
  return result.sort((a, b) => a.date.localeCompare(b.date))
}

function parseHydration(records: unknown[]): GarminMetrics['hydration'] {
  // Group by date, sum intake and sweat loss
  const byDate = new Map<string, { intake: number; sweat: number }>()
  for (const r of records) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = r as any
    if (!rec.calendarDate) continue
    const date = rec.calendarDate
    const existing = byDate.get(date) || { intake: 0, sweat: 0 }
    existing.intake += rec.valueInML || 0
    existing.sweat += rec.estimatedSweatLossInML || 0
    byDate.set(date, existing)
  }
  return Array.from(byDate.entries())
    .map(([date, v]) => ({ date, intakeMl: v.intake, sweatLossMl: v.sweat }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function parseGarminExport(
  files: File[],
  onProgress?: (msg: string) => void,
): Promise<HealthData> {
  onProgress?.('Categorizing files...')

  // Collect only JSON files from DI_CONNECT subdirectories
  const jsonFiles = files.filter(f => f.name.endsWith('.json'))
  const categorized = categorizeFiles(jsonFiles)

  // Parse all file categories in parallel
  onProgress?.('Reading JSON files...')
  const [
    udsRecords, sleepRecords, activityRecords, healthStatusRecords,
    trainingReadinessRecords, vo2maxRecords, enduranceRecords,
    hillRecords, acuteLoadRecords, raceRecords,
    heatAltRecords, fitnessAgeRecords, hydrationRecords,
  ] = await Promise.all([
    readJsonFiles(categorized.get('UDSFile') || []),
    readJsonFiles(categorized.get('sleepData') || []),
    readJsonFiles(categorized.get('summarizedActivities') || []),
    readJsonFiles(categorized.get('healthStatusData') || []),
    readJsonFiles(categorized.get('TrainingReadinessDTO') || []),
    readJsonFiles(categorized.get('ActivityVo2Max') || []),
    readJsonFiles(categorized.get('EnduranceScore') || []),
    readJsonFiles(categorized.get('HillScore') || []),
    readJsonFiles(categorized.get('MetricsAcuteTrainingLoad') || []),
    readJsonFiles(categorized.get('RunRacePredictions') || []),
    readJsonFiles(categorized.get('MetricsHeatAltitudeAcclimation') || []),
    readJsonFiles(categorized.get('fitnessAgeData') || []),
    readJsonFiles(categorized.get('HydrationLogFile') || []),
  ])

  onProgress?.('Processing daily summaries...')
  const { metrics: dailyMetrics, stress } = parseUDS(udsRecords)

  onProgress?.('Processing sleep data...')
  const { sleepRecords: parsedSleep, sleepScores } = parseSleep(sleepRecords)

  // Update dailyMetrics with sleep hours
  for (const sr of parsedSleep) {
    const dm = dailyMetrics.get(sr.date)
    if (dm && sr.stage !== 'awake') {
      dm.sleepHours = (dm.sleepHours || 0) + sr.minutes / 60
    }
  }

  onProgress?.('Processing activities...')
  const workouts = parseActivities(activityRecords)

  // Update dailyMetrics with VO2 max from activities
  for (const r of activityRecords) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = r as any
    const acts = rec.summarizedActivitiesExport || (rec.activityId ? [rec] : [])
    for (const act of acts) {
      if (act.vO2MaxValue && act.beginTimestamp) {
        const date = epochToDate(act.beginTimestamp || act.startTimeGmt || 0)
        const dm = dailyMetrics.get(date)
        if (dm) dm.vo2max = act.vO2MaxValue
      }
    }
  }

  onProgress?.('Processing health status...')
  const { breathing: dailyBreathing, dailyHR, cardio: cardioRecords } = parseHealthStatus(healthStatusRecords)

  // Update dailyMetrics with HRV from health status
  for (const hr of dailyHR) {
    const dm = dailyMetrics.get(hr.date)
    if (dm) {
      // Find HRV for this date from health status
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hsRec = healthStatusRecords.find((r: any) => r.calendarDate === hr.date)
      if (hsRec) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hrvMetric = (hsRec as any).metrics?.find((m: { type: string }) => m.type === 'HRV')
        if (hrvMetric?.value) dm.hrv = hrvMetric.value
      }
    }
  }

  onProgress?.('Processing Garmin metrics...')
  const garminMetrics: GarminMetrics = {
    trainingReadiness: parseTrainingReadiness(trainingReadinessRecords),
    vo2max: parseVo2Max(vo2maxRecords),
    enduranceScore: parseEnduranceScore(enduranceRecords),
    hillScore: parseHillScore(hillRecords),
    acuteTrainingLoad: parseAcuteTrainingLoad(acuteLoadRecords),
    racePredictions: parseRacePredictions(raceRecords),
    heatAltitude: parseHeatAltitude(heatAltRecords),
    fitnessAge: parseFitnessAge(fitnessAgeRecords),
    stressDaily: stress,
    hydration: parseHydration(hydrationRecords),
    sleepScores,
  }

  // Determine export date from most recent data
  const dates = Array.from(dailyMetrics.keys()).sort()
  const exportDate = dates[dates.length - 1] || new Date().toISOString().slice(0, 10)

  onProgress?.('Done!')

  return {
    profile: { dob: '', sex: '', bloodType: '' },
    dailyMetrics,
    workouts,
    sleepRecords: parsedSleep,
    wristTempRecords: [],
    menstrualRecords: [],
    caffeineRecords: [],
    bodyRecords: [],
    cardioRecords,
    dailyHR,
    hrTimeline: [],
    dailyAudio: [],
    dailyBreathing,
    dailyDaylight: [],
    gpxFiles: new Map(),
    ecgFiles: new Map(),
    exportDate,
    sourceMode: 'garmin',
    garminMetrics,
  }
}
