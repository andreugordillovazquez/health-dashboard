import type { DailyMetrics, Workout, SleepRecord, CaffeineRecord, BodyRecord, CardioRecord, DailyHR, HRSample, DailyAudio, DailyBreathing, WristTempRecord, ParseProgress, ParseComplete, ParseError } from './types'

interface Accumulator {
  // These track per-source to deduplicate iPhone+Watch overlap
  stepsBySource: Map<string, number>
  activeEnergyBySource: Map<string, number>
  distanceBySource: Map<string, number>
  restingHR: number[]
  hrv: number[]
  vo2max: number[]
  weight: number[]
  sleepMinutes: number
}

function emptyAcc(): Accumulator {
  return {
    stepsBySource: new Map(), activeEnergyBySource: new Map(), distanceBySource: new Map(),
    restingHR: [], hrv: [], vo2max: [], weight: [], sleepMinutes: 0,
  }
}

function maxSource(map: Map<string, number>): number {
  let max = 0
  for (const v of map.values()) if (v > max) max = v
  return max
}

function avg(arr: number[]): number | null {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
}

function last(arr: number[]): number | null {
  return arr.length ? arr[arr.length - 1] : null
}

const METRIC_TYPES = new Set([
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
  'HKQuantityTypeIdentifierRestingHeartRate',
  'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  'HKQuantityTypeIdentifierVO2Max',
  'HKQuantityTypeIdentifierBodyMass',
  'HKQuantityTypeIdentifierDistanceWalkingRunning',
  'HKCategoryTypeIdentifierSleepAnalysis',
  'HKQuantityTypeIdentifierDietaryCaffeine',
  'HKQuantityTypeIdentifierBodyFatPercentage',
  'HKQuantityTypeIdentifierLeanBodyMass',
  'HKQuantityTypeIdentifierBodyMassIndex',
  'HKQuantityTypeIdentifierWalkingHeartRateAverage',
  'HKQuantityTypeIdentifierHeartRateRecoveryOneMinute',
  'HKQuantityTypeIdentifierHeartRate',
  'HKQuantityTypeIdentifierAppleSleepingWristTemperature',
  'HKQuantityTypeIdentifierHeadphoneAudioExposure',
  'HKQuantityTypeIdentifierEnvironmentalAudioExposure',
  'HKCategoryTypeIdentifierAudioExposureEvent',
  'HKQuantityTypeIdentifierAppleSleepingBreathingDisturbances',
  'HKQuantityTypeIdentifierRespiratoryRate',
  'HKQuantityTypeIdentifierOxygenSaturation',
  'HKQuantityTypeIdentifierTimeInDaylight',
])

const STAGE_MAP: Record<string, SleepRecord['stage']> = {
  HKCategoryValueSleepAnalysisAsleepCore: 'core',
  HKCategoryValueSleepAnalysisAsleepDeep: 'deep',
  HKCategoryValueSleepAnalysisAsleepREM: 'rem',
  HKCategoryValueSleepAnalysisAwake: 'awake',
  HKCategoryValueSleepAnalysisInBed: 'inbed',
  HKCategoryValueSleepAnalysisAsleepUnspecified: 'unspecified',
}

self.onmessage = async (e: MessageEvent) => {
  const file: File = e.data.file
  try {
    await parseFile(file)
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) } as ParseError)
  }
}

async function parseFile(file: File) {
  const dailyMetrics = new Map<string, DailyMetrics>()
  const dailyAcc = new Map<string, Accumulator>()
  const activitySummaries = new Map<string, { exercise: number; stand: number; activeEnergy: number; activeEnergyGoal: number; exerciseGoal: number; standGoal: number }>()
  const workouts: Workout[] = []
  const sleepRecords: SleepRecord[] = []
  const caffeineRecords: CaffeineRecord[] = []
  const bodyAcc = new Map<string, { weight: number[]; bodyFat: number[]; leanMass: number[]; bmi: number[] }>()
  const cardioRecords: CardioRecord[] = []
  // Track days that have granular sleep stages (Core/Deep/REM) to avoid double-counting with Unspecified
  const daysWithStages = new Set<string>()
  const unspecifiedSleep = new Map<string, number>() // day -> minutes of unspecified sleep
  const wristTempRecords: WristTempRecord[] = []
  const dailyHRAcc = new Map<string, { min: number; max: number; sum: number; count: number }>()
  const hrTimeline: HRSample[] = []
  const audioAcc = new Map<string, { hpVals: number[]; hpMins: number; envVals: number[]; envMins: number; events: number }>()
  const breathingAcc = new Map<string, { disturbances: number[]; respRate: number[]; spo2: number[] }>()
  const daylightAcc = new Map<string, number>()
  let profile = { dob: '', sex: '', bloodType: '' }
  let exportDate = ''
  let recordCount = 0

  const CHUNK_SIZE = 64 * 1024 * 1024
  let remainder = ''

  for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
    const slice = file.slice(offset, offset + CHUNK_SIZE)
    const text = remainder + await slice.text()

    const splitPoint = text.lastIndexOf('<')
    const processText = splitPoint > 0 ? text.substring(0, splitPoint) : text
    remainder = splitPoint > 0 ? text.substring(splitPoint) : ''

    if (!profile.dob) {
      const meMatch = processText.match(/<Me\s[^>]*>/)
      if (meMatch) {
        const me = meMatch[0]
        profile.dob = extractAttr(me, 'HKCharacteristicTypeIdentifierDateOfBirth') || ''
        profile.sex = extractAttr(me, 'HKCharacteristicTypeIdentifierBiologicalSex') || ''
        profile.bloodType = extractAttr(me, 'HKCharacteristicTypeIdentifierBloodType') || ''
      }
    }

    if (!exportDate) {
      const edMatch = processText.match(/<ExportDate\s+value="([^"]+)"/)
      if (edMatch) exportDate = edMatch[1]
    }

    // Parse <Record> elements (both self-closing /> and open <Record ...>)
    const recordRegex = /<Record\s+([^>]+?)(?:\/>|>)/g
    let match
    while ((match = recordRegex.exec(processText)) !== null) {
      const attrs = match[1]
      const type = extractAttr(attrs, 'type')
      if (!type || !METRIC_TYPES.has(type)) continue

      const startDate = extractAttr(attrs, 'startDate')
      if (!startDate) continue
      const day = startDate.substring(0, 10)
      const value = parseFloat(extractAttr(attrs, 'value') || '0')

      // Daylight
      if (type === 'HKQuantityTypeIdentifierTimeInDaylight') {
        daylightAcc.set(day, (daylightAcc.get(day) || 0) + value)
        recordCount++
        continue
      }

      // Breathing/respiratory
      if (type === 'HKQuantityTypeIdentifierAppleSleepingBreathingDisturbances' ||
          type === 'HKQuantityTypeIdentifierRespiratoryRate' ||
          type === 'HKQuantityTypeIdentifierOxygenSaturation') {
        if (!breathingAcc.has(day)) breathingAcc.set(day, { disturbances: [], respRate: [], spo2: [] })
        const b = breathingAcc.get(day)!
        if (type === 'HKQuantityTypeIdentifierAppleSleepingBreathingDisturbances') {
          b.disturbances.push(value)
        } else if (type === 'HKQuantityTypeIdentifierRespiratoryRate') {
          b.respRate.push(value)
        } else {
          b.spo2.push(value > 1 ? value : value * 100) // Convert 0.98 to 98%
        }
        recordCount++
        continue
      }

      // Audio exposure
      if (type === 'HKQuantityTypeIdentifierHeadphoneAudioExposure' || type === 'HKQuantityTypeIdentifierEnvironmentalAudioExposure') {
        if (!audioAcc.has(day)) audioAcc.set(day, { hpVals: [], hpMins: 0, envVals: [], envMins: 0, events: 0 })
        const a = audioAcc.get(day)!
        const endDate = extractAttr(attrs, 'endDate') || startDate
        const mins = (new Date(endDate).getTime() - new Date(startDate).getTime()) / 60000
        if (type === 'HKQuantityTypeIdentifierHeadphoneAudioExposure') {
          a.hpVals.push(value)
          if (mins > 0 && mins < 1440) a.hpMins += mins
        } else {
          a.envVals.push(value)
          if (mins > 0 && mins < 1440) a.envMins += mins
        }
        recordCount++
        continue
      }
      if (type === 'HKCategoryTypeIdentifierAudioExposureEvent') {
        if (!audioAcc.has(day)) audioAcc.set(day, { hpVals: [], hpMins: 0, envVals: [], envMins: 0, events: 0 })
        audioAcc.get(day)!.events++
        recordCount++
        continue
      }

      // Caffeine
      if (type === 'HKQuantityTypeIdentifierDietaryCaffeine') {
        caffeineRecords.push({
          date: day,
          time: startDate.substring(11, 16),
          mg: value,
        })
        recordCount++
        continue
      }

      // Sleep — collect individual stage records
      if (type === 'HKCategoryTypeIdentifierSleepAnalysis') {
        const val = extractAttr(attrs, 'value')
        const stage = STAGE_MAP[val]
        if (stage) {
          const endDate = extractAttr(attrs, 'endDate') || startDate
          const start = new Date(startDate)
          const end = new Date(endDate)
          const mins = (end.getTime() - start.getTime()) / 60000
          if (mins > 0 && mins < 1440) {
            // Assign to the date of the end time (the day you wake up)
            const assignedDay = endDate.substring(0, 10)

            sleepRecords.push({
              date: assignedDay,
              stage,
              startDate,
              endDate,
              minutes: mins,
            })

            // Accumulate total sleep for DailyMetrics (use assignedDay, not startDate day)
            if (stage !== 'inbed' && stage !== 'awake') {
              if (stage === 'unspecified') {
                // Defer unspecified — only count if no granular stages exist for this day
                unspecifiedSleep.set(assignedDay, (unspecifiedSleep.get(assignedDay) || 0) + mins)
              } else {
                // Granular stage (core/deep/rem)
                daysWithStages.add(assignedDay)
                if (!dailyAcc.has(assignedDay)) dailyAcc.set(assignedDay, emptyAcc())
                dailyAcc.get(assignedDay)!.sleepMinutes += mins
              }
            }
          }
        }
        recordCount++
        continue
      }

      if (!dailyAcc.has(day)) dailyAcc.set(day, emptyAcc())
      const acc = dailyAcc.get(day)!

      // Extract source for deduplication of steps/energy/distance
      const source = extractAttr(attrs, 'sourceName') || 'unknown'

      switch (type) {
        case 'HKQuantityTypeIdentifierStepCount':
          acc.stepsBySource.set(source, (acc.stepsBySource.get(source) || 0) + value)
          break
        case 'HKQuantityTypeIdentifierActiveEnergyBurned':
          acc.activeEnergyBySource.set(source, (acc.activeEnergyBySource.get(source) || 0) + value)
          break
        case 'HKQuantityTypeIdentifierRestingHeartRate':
          acc.restingHR.push(value)
          break
        case 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN':
          acc.hrv.push(value)
          break
        case 'HKQuantityTypeIdentifierVO2Max':
          acc.vo2max.push(value)
          cardioRecords.push({ date: day, value, type: 'vo2max' })
          break
        case 'HKQuantityTypeIdentifierWalkingHeartRateAverage':
          cardioRecords.push({ date: day, value, type: 'walkingHR' })
          break
        case 'HKQuantityTypeIdentifierHeartRateRecoveryOneMinute':
          cardioRecords.push({ date: day, value, type: 'hrRecovery' })
          break
        case 'HKQuantityTypeIdentifierHeartRate': {
          const hr = dailyHRAcc.get(day)
          if (hr) {
            if (value < hr.min) hr.min = value
            if (value > hr.max) hr.max = value
            hr.sum += value
            hr.count++
          } else {
            dailyHRAcc.set(day, { min: value, max: value, sum: value, count: 1 })
          }
          hrTimeline.push({ t: new Date(startDate).getTime(), v: Math.round(value) })
          break
        }
        case 'HKQuantityTypeIdentifierAppleSleepingWristTemperature':
          wristTempRecords.push({ date: day, value: Math.round(value * 100) / 100 })
          break
        case 'HKQuantityTypeIdentifierBodyMass':
          acc.weight.push(value)
          if (!bodyAcc.has(day)) bodyAcc.set(day, { weight: [], bodyFat: [], leanMass: [], bmi: [] })
          bodyAcc.get(day)!.weight.push(value)
          break
        case 'HKQuantityTypeIdentifierBodyFatPercentage':
          if (!bodyAcc.has(day)) bodyAcc.set(day, { weight: [], bodyFat: [], leanMass: [], bmi: [] })
          bodyAcc.get(day)!.bodyFat.push(value > 1 ? value : value * 100) // Convert 0.xx to %
          break
        case 'HKQuantityTypeIdentifierLeanBodyMass':
          if (!bodyAcc.has(day)) bodyAcc.set(day, { weight: [], bodyFat: [], leanMass: [], bmi: [] })
          bodyAcc.get(day)!.leanMass.push(value)
          break
        case 'HKQuantityTypeIdentifierBodyMassIndex':
          if (!bodyAcc.has(day)) bodyAcc.set(day, { weight: [], bodyFat: [], leanMass: [], bmi: [] })
          bodyAcc.get(day)!.bmi.push(value)
          break
        case 'HKQuantityTypeIdentifierDistanceWalkingRunning':
          acc.distanceBySource.set(source, (acc.distanceBySource.get(source) || 0) + value)
          break
      }

      recordCount++
      if (recordCount % 500000 === 0) {
        self.postMessage({ type: 'progress', recordsProcessed: recordCount, currentDate: day } as ParseProgress)
      }
    }

    // Parse <Workout> elements (full blocks including inner stats)
    const workoutBlockRegex = /<Workout\s+([^>]+?)(?:\/>|>([\s\S]*?)<\/Workout>)/g
    while ((match = workoutBlockRegex.exec(processText)) !== null) {
      const attrs = match[1]
      const inner = match[2] || ''
      const activityType = extractAttr(attrs, 'workoutActivityType') || ''
      const startDate = extractAttr(attrs, 'startDate') || ''
      const endDate = extractAttr(attrs, 'endDate') || ''
      const duration = parseFloat(extractAttr(attrs, 'duration') || '0')
      const durationUnit = extractAttr(attrs, 'durationUnit') || 'min'
      const durationMins = durationUnit === 's' ? duration / 60 : duration
      const totalEnergy = parseFloat(extractAttr(attrs, 'totalEnergyBurned') || '0')
      const totalDistRaw = parseFloat(extractAttr(attrs, 'totalDistance') || '0')
      const totalDistUnit = extractAttr(attrs, 'totalDistanceUnit') || 'km'
      const totalDist = totalDistUnit === 'm' ? totalDistRaw / 1000 : totalDistRaw

      // Extract WorkoutStatistics
      let hrAvg: number | null = null, hrMin: number | null = null, hrMax: number | null = null
      let activeEnergy = 0, distance = totalDist

      const statsRegex = /<WorkoutStatistics\s+([^>]+?)\/>/g
      let sm
      while ((sm = statsRegex.exec(inner)) !== null) {
        const sa = sm[1]
        const statType = extractAttr(sa, 'type')
        if (statType === 'HKQuantityTypeIdentifierHeartRate') {
          hrAvg = parseFloat(extractAttr(sa, 'average') || '') || null
          hrMin = parseFloat(extractAttr(sa, 'minimum') || '') || null
          hrMax = parseFloat(extractAttr(sa, 'maximum') || '') || null
        } else if (statType === 'HKQuantityTypeIdentifierActiveEnergyBurned') {
          activeEnergy = parseFloat(extractAttr(sa, 'sum') || '0')
        } else if (statType.includes('Distance')) {
          const d = parseFloat(extractAttr(sa, 'sum') || '0')
          if (d > 0) {
            const unit = extractAttr(sa, 'unit')
            distance = unit === 'm' ? d / 1000 : d
          }
        }
      }

      // Extract metadata
      let avgMETs: number | null = null
      let weather: string | null = null
      let elevationAscended: number | null = null

      const metaRegex = /<MetadataEntry\s+key="([^"]+)"\s+value="([^"]+)"\/>/g
      const seenMeta = new Set<string>()
      while ((sm = metaRegex.exec(inner)) !== null) {
        const key = sm[1], val = sm[2]
        if (seenMeta.has(key)) continue
        seenMeta.add(key)
        if (key === 'HKAverageMETs') avgMETs = parseFloat(val) || null
        else if (key === 'HKWeatherTemperature') {
          const degF = parseFloat(val)
          weather = !isNaN(degF) ? `${Math.round((degF - 32) * 5 / 9)}°C` : null
        }
        else if (key === 'HKElevationAscended') {
          const cm = parseFloat(val)
          elevationAscended = !isNaN(cm) ? Math.round(cm / 100) : null
        }
      }

      workouts.push({
        type: activityType.replace('HKWorkoutActivityType', ''),
        date: startDate.substring(0, 10),
        startDate,
        endDate,
        duration: Math.round(durationMins),
        calories: Math.round(activeEnergy || totalEnergy),
        distance: distance || null,
        hrAvg: hrAvg ? Math.round(hrAvg) : null,
        hrMin: hrMin ? Math.round(hrMin) : null,
        hrMax: hrMax ? Math.round(hrMax) : null,
        avgMETs,
        weather,
        elevationAscended,
      })
    }

    // Parse <ActivitySummary> elements
    const activityRegex = /<ActivitySummary\s+([^>]+?)\/>/g
    while ((match = activityRegex.exec(processText)) !== null) {
      const attrs = match[1]
      const date = extractAttr(attrs, 'dateComponents')
      if (!date) continue
      activitySummaries.set(date, {
        exercise: parseFloat(extractAttr(attrs, 'appleExerciseTime') || '0'),
        stand: parseFloat(extractAttr(attrs, 'appleStandHours') || '0'),
        activeEnergy: parseFloat(extractAttr(attrs, 'activeEnergyBurned') || '0'),
        activeEnergyGoal: parseFloat(extractAttr(attrs, 'activeEnergyBurnedGoal') || '0'),
        exerciseGoal: parseFloat(extractAttr(attrs, 'appleExerciseTimeGoal') || '30'),
        standGoal: parseFloat(extractAttr(attrs, 'appleStandHoursGoal') || '12'),
      })
    }
  }

  // Add unspecified sleep only for days without granular stage data
  for (const [day, mins] of unspecifiedSleep) {
    if (!daysWithStages.has(day)) {
      if (!dailyAcc.has(day)) dailyAcc.set(day, emptyAcc())
      dailyAcc.get(day)!.sleepMinutes += mins
    }
  }

  // Build final daily metrics
  for (const [day, acc] of dailyAcc) {
    const activity = activitySummaries.get(day)
    dailyMetrics.set(day, {
      date: day,
      steps: Math.round(maxSource(acc.stepsBySource)),
      activeEnergy: Math.round(maxSource(acc.activeEnergyBySource)),
      restingHeartRate: avg(acc.restingHR),
      hrv: avg(acc.hrv),
      vo2max: last(acc.vo2max),
      weight: last(acc.weight),
      sleepHours: acc.sleepMinutes > 0 ? Math.round(acc.sleepMinutes / 60 * 10) / 10 : null,
      distance: Math.round(maxSource(acc.distanceBySource) * 100) / 100,
      exerciseMinutes: activity?.exercise ?? 0,
      standHours: activity?.stand ?? 0,
      activeEnergyGoal: activity?.activeEnergyGoal ?? 0,
      exerciseGoal: activity?.exerciseGoal ?? 30,
      standGoal: activity?.standGoal ?? 12,
    })
  }

  // Build body records
  const bodyRecords: BodyRecord[] = []
  for (const [day, ba] of bodyAcc) {
    bodyRecords.push({
      date: day,
      weight: last(ba.weight),
      bodyFat: last(ba.bodyFat),
      leanMass: last(ba.leanMass),
      bmi: last(ba.bmi),
    })
  }
  bodyRecords.sort((a, b) => a.date.localeCompare(b.date))

  // Build daily HR stats
  const dailyHR: DailyHR[] = []
  for (const [day, hr] of dailyHRAcc) {
    dailyHR.push({
      date: day,
      min: Math.round(hr.min),
      max: Math.round(hr.max),
      avg: Math.round(hr.sum / hr.count),
    })
  }
  dailyHR.sort((a, b) => a.date.localeCompare(b.date))
  hrTimeline.sort((a, b) => a.t - b.t)

  // Build daily audio
  const dailyAudio: DailyAudio[] = []
  for (const [day, a] of audioAcc) {
    const hpAvg = a.hpVals.length ? a.hpVals.reduce((s, v) => s + v, 0) / a.hpVals.length : null
    const hpMax = a.hpVals.length ? Math.max(...a.hpVals) : null
    const envAvg = a.envVals.length ? a.envVals.reduce((s, v) => s + v, 0) / a.envVals.length : null
    const envMax = a.envVals.length ? Math.max(...a.envVals) : null
    dailyAudio.push({
      date: day,
      headphoneAvg: hpAvg ? Math.round(hpAvg * 10) / 10 : null,
      headphoneMax: hpMax ? Math.round(hpMax * 10) / 10 : null,
      envAvg: envAvg ? Math.round(envAvg * 10) / 10 : null,
      envMax: envMax ? Math.round(envMax * 10) / 10 : null,
      headphoneMinutes: Math.round(a.hpMins),
      envMinutes: Math.round(a.envMins),
      eventsAboveLimit: a.events,
    })
  }
  dailyAudio.sort((a, b) => a.date.localeCompare(b.date))

  // Build daily breathing
  const dailyBreathing: DailyBreathing[] = []
  for (const [day, b] of breathingAcc) {
    const distAvg = b.disturbances.length ? b.disturbances.reduce((s, v) => s + v, 0) / b.disturbances.length : null
    const rrAvg = b.respRate.length ? b.respRate.reduce((s, v) => s + v, 0) / b.respRate.length : null
    const spo2Avg = b.spo2.length ? b.spo2.reduce((s, v) => s + v, 0) / b.spo2.length : null
    dailyBreathing.push({
      date: day,
      disturbances: distAvg !== null ? Math.round(distAvg * 100) / 100 : null,
      respiratoryRate: rrAvg !== null ? Math.round(rrAvg * 10) / 10 : null,
      spo2: spo2Avg !== null ? Math.round(spo2Avg * 10) / 10 : null,
    })
  }
  dailyBreathing.sort((a, b) => a.date.localeCompare(b.date))

  self.postMessage({
    type: 'complete',
    data: {
      profile,
      dailyMetrics: Array.from(dailyMetrics.entries()),
      workouts,
      sleepRecords,
      wristTempRecords,
      caffeineRecords,
      bodyRecords,
      cardioRecords,
      dailyHR,
      hrTimeline,
      dailyAudio,
      dailyBreathing,
      dailyDaylight: Array.from(daylightAcc.entries())
        .map(([date, minutes]) => ({ date, minutes: Math.round(minutes) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      exportDate,
    },
  } as ParseComplete)
}

function extractAttr(str: string, name: string): string {
  const regex = new RegExp(`${name}="([^"]*)"`)
  const match = str.match(regex)
  return match ? match[1] : ''
}
