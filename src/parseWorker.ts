import type { DailyMetrics, Workout, SleepRecord, CaffeineRecord, BodyRecord, CardioRecord, DailyHR, HRSample, DailyAudio, DailyBreathing, WristTempRecord, MenstrualRecord, DailyMobility, RunningDynamicsRecord, ParseProgress, ParseComplete, ParseError } from './types'

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
  'HKCategoryTypeIdentifierMenstrualFlow',
  'HKCategoryTypeIdentifierOvulationTestResult',
  'HKCategoryTypeIdentifierCervicalMucusQuality',
  'HKQuantityTypeIdentifierBasalBodyTemperature',
  'HKCategoryTypeIdentifierSexualActivity',
  'HKCategoryTypeIdentifierIntermenstrualBleeding',
  // Mobility & Gait
  'HKQuantityTypeIdentifierWalkingSpeed',
  'HKQuantityTypeIdentifierWalkingStepLength',
  'HKQuantityTypeIdentifierWalkingDoubleSupportPercentage',
  'HKQuantityTypeIdentifierWalkingAsymmetryPercentage',
  'HKQuantityTypeIdentifierStairAscentSpeed',
  'HKQuantityTypeIdentifierStairDescentSpeed',
  'HKQuantityTypeIdentifierAppleWalkingSteadiness',
  'HKQuantityTypeIdentifierSixMinuteWalkTestDistance',
  'HKQuantityTypeIdentifierFlightsClimbed',
  // Running Dynamics
  'HKQuantityTypeIdentifierRunningPower',
  'HKQuantityTypeIdentifierRunningSpeed',
  'HKQuantityTypeIdentifierRunningVerticalOscillation',
  'HKQuantityTypeIdentifierRunningGroundContactTime',
  'HKQuantityTypeIdentifierRunningStrideLength',
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
  const menstrualAcc = new Map<string, { flow: MenstrualRecord['flow']; cervicalMucus: MenstrualRecord['cervicalMucus']; ovulationTest: MenstrualRecord['ovulationTest']; basalBodyTemp: number | null; sexualActivity: boolean; intermenstrualBleeding: boolean }>()
  const mobilityAcc = new Map<string, { walkingSpeed: number[]; stepLength: number[]; doubleSupportPct: number[]; asymmetryPct: number[]; stairAscent: number[]; stairDescent: number[]; steadiness: number[]; sixMinWalk: number[]; flights: number }>()
  const runningAcc = new Map<string, { power: number[]; speed: number[]; vertOsc: number[]; groundContact: number[]; strideLen: number[] }>()

  let profile = { dob: '', sex: '', bloodType: '' }
  let exportDate = ''
  let recordCount = 0

  const CHUNK_SIZE = 64 * 1024 * 1024
  let remainder = ''
  const totalBytes = file.size

  for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
    const slice = file.slice(offset, offset + CHUNK_SIZE)
    const text = remainder + await slice.text()
    const bytesRead = Math.min(offset + CHUNK_SIZE, totalBytes)

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

      // Menstrual cycle records
      if (type === 'HKCategoryTypeIdentifierMenstrualFlow' ||
          type === 'HKCategoryTypeIdentifierOvulationTestResult' ||
          type === 'HKCategoryTypeIdentifierCervicalMucusQuality' ||
          type === 'HKQuantityTypeIdentifierBasalBodyTemperature' ||
          type === 'HKCategoryTypeIdentifierSexualActivity' ||
          type === 'HKCategoryTypeIdentifierIntermenstrualBleeding') {
        if (!menstrualAcc.has(day)) menstrualAcc.set(day, { flow: null, cervicalMucus: null, ovulationTest: null, basalBodyTemp: null, sexualActivity: false, intermenstrualBleeding: false })
        const m = menstrualAcc.get(day)!
        if (type === 'HKCategoryTypeIdentifierMenstrualFlow') {
          const val = extractAttr(attrs, 'value')
          const flowMap: Record<string, MenstrualRecord['flow']> = {
            HKCategoryValueMenstrualFlowNone: 'none',
            HKCategoryValueMenstrualFlowLight: 'light',
            HKCategoryValueMenstrualFlowMedium: 'medium',
            HKCategoryValueMenstrualFlowHeavy: 'heavy',
            HKCategoryValueMenstrualFlowUnspecified: 'unspecified',
            HKCategoryValueVaginalBleedingNone: 'none',
            HKCategoryValueVaginalBleedingLight: 'light',
            HKCategoryValueVaginalBleedingMedium: 'medium',
            HKCategoryValueVaginalBleedingHeavy: 'heavy',
            HKCategoryValueVaginalBleedingUnspecified: 'unspecified',
          }
          m.flow = flowMap[val] || 'unspecified'
        } else if (type === 'HKCategoryTypeIdentifierCervicalMucusQuality') {
          const val = extractAttr(attrs, 'value')
          const mucusMap: Record<string, MenstrualRecord['cervicalMucus']> = {
            HKCategoryValueCervicalMucusQualityDry: 'dry',
            HKCategoryValueCervicalMucusQualitySticky: 'sticky',
            HKCategoryValueCervicalMucusQualityCreamy: 'creamy',
            HKCategoryValueCervicalMucusQualityWatery: 'watery',
            HKCategoryValueCervicalMucusQualityEggWhite: 'eggWhite',
          }
          m.cervicalMucus = mucusMap[val] || null
        } else if (type === 'HKCategoryTypeIdentifierOvulationTestResult') {
          const val = extractAttr(attrs, 'value')
          if (val.includes('Positive') || val.includes('LuteinizingSurge')) m.ovulationTest = 'positive'
          else if (val.includes('Indeterminate')) m.ovulationTest = 'indeterminate'
          else m.ovulationTest = 'negative'
        } else if (type === 'HKQuantityTypeIdentifierBasalBodyTemperature') {
          m.basalBodyTemp = value
        } else if (type === 'HKCategoryTypeIdentifierSexualActivity') {
          m.sexualActivity = true
        } else if (type === 'HKCategoryTypeIdentifierIntermenstrualBleeding') {
          m.intermenstrualBleeding = true
        }
        recordCount++
        continue
      }

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

      // Mobility & Gait
      if (type === 'HKQuantityTypeIdentifierWalkingSpeed' ||
          type === 'HKQuantityTypeIdentifierWalkingStepLength' ||
          type === 'HKQuantityTypeIdentifierWalkingDoubleSupportPercentage' ||
          type === 'HKQuantityTypeIdentifierWalkingAsymmetryPercentage' ||
          type === 'HKQuantityTypeIdentifierStairAscentSpeed' ||
          type === 'HKQuantityTypeIdentifierStairDescentSpeed' ||
          type === 'HKQuantityTypeIdentifierAppleWalkingSteadiness' ||
          type === 'HKQuantityTypeIdentifierSixMinuteWalkTestDistance' ||
          type === 'HKQuantityTypeIdentifierFlightsClimbed') {
        if (!mobilityAcc.has(day)) mobilityAcc.set(day, { walkingSpeed: [], stepLength: [], doubleSupportPct: [], asymmetryPct: [], stairAscent: [], stairDescent: [], steadiness: [], sixMinWalk: [], flights: 0 })
        const m = mobilityAcc.get(day)!
        if (type === 'HKQuantityTypeIdentifierWalkingSpeed') m.walkingSpeed.push(value)
        else if (type === 'HKQuantityTypeIdentifierWalkingStepLength') m.stepLength.push(value * 100) // m -> cm
        else if (type === 'HKQuantityTypeIdentifierWalkingDoubleSupportPercentage') m.doubleSupportPct.push(value > 1 ? value : value * 100)
        else if (type === 'HKQuantityTypeIdentifierWalkingAsymmetryPercentage') m.asymmetryPct.push(value > 1 ? value : value * 100)
        else if (type === 'HKQuantityTypeIdentifierStairAscentSpeed') m.stairAscent.push(value)
        else if (type === 'HKQuantityTypeIdentifierStairDescentSpeed') m.stairDescent.push(value)
        else if (type === 'HKQuantityTypeIdentifierAppleWalkingSteadiness') m.steadiness.push(value > 1 ? value : value * 100)
        else if (type === 'HKQuantityTypeIdentifierSixMinuteWalkTestDistance') m.sixMinWalk.push(value)
        else if (type === 'HKQuantityTypeIdentifierFlightsClimbed') m.flights += value
        recordCount++
        continue
      }

      // Running Dynamics
      if (type === 'HKQuantityTypeIdentifierRunningPower' ||
          type === 'HKQuantityTypeIdentifierRunningSpeed' ||
          type === 'HKQuantityTypeIdentifierRunningVerticalOscillation' ||
          type === 'HKQuantityTypeIdentifierRunningGroundContactTime' ||
          type === 'HKQuantityTypeIdentifierRunningStrideLength') {
        if (!runningAcc.has(day)) runningAcc.set(day, { power: [], speed: [], vertOsc: [], groundContact: [], strideLen: [] })
        const r = runningAcc.get(day)!
        if (type === 'HKQuantityTypeIdentifierRunningPower') r.power.push(value)
        else if (type === 'HKQuantityTypeIdentifierRunningSpeed') r.speed.push(value)
        else if (type === 'HKQuantityTypeIdentifierRunningVerticalOscillation') r.vertOsc.push(value * 100) // m -> cm
        else if (type === 'HKQuantityTypeIdentifierRunningGroundContactTime') r.groundContact.push(value)
        else if (type === 'HKQuantityTypeIdentifierRunningStrideLength') r.strideLen.push(value)
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
        self.postMessage({ type: 'progress', recordsProcessed: recordCount, currentDate: day, bytesRead, totalBytes } as ParseProgress)
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

    // Always emit progress at the end of a chunk so the bar advances even when
    // record density varies and we don't hit the 500k-record boundary.
    self.postMessage({ type: 'progress', recordsProcessed: recordCount, currentDate: '', bytesRead, totalBytes } as ParseProgress)
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

  // Build menstrual records
  const menstrualRecords: MenstrualRecord[] = []
  for (const [day, m] of menstrualAcc) {
    menstrualRecords.push({
      date: day,
      flow: m.flow,
      cervicalMucus: m.cervicalMucus,
      ovulationTest: m.ovulationTest,
      basalBodyTemp: m.basalBodyTemp,
      sexualActivity: m.sexualActivity,
      intermenstrualBleeding: m.intermenstrualBleeding,
    })
  }
  menstrualRecords.sort((a, b) => a.date.localeCompare(b.date))

  // Build daily mobility
  const dailyMobility: DailyMobility[] = []
  for (const [day, m] of mobilityAcc) {
    const a = (arr: number[]) => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length * 100) / 100 : null
    dailyMobility.push({
      date: day,
      walkingSpeed: a(m.walkingSpeed),
      stepLength: a(m.stepLength),
      doubleSupportPct: a(m.doubleSupportPct),
      asymmetryPct: a(m.asymmetryPct),
      stairAscentSpeed: a(m.stairAscent),
      stairDescentSpeed: a(m.stairDescent),
      walkingSteadiness: a(m.steadiness),
      sixMinWalkDistance: a(m.sixMinWalk),
      flightsClimbed: Math.round(m.flights),
    })
  }
  dailyMobility.sort((a, b) => a.date.localeCompare(b.date))

  // Build running dynamics
  const runningDynamics: RunningDynamicsRecord[] = []
  for (const [day, r] of runningAcc) {
    const a = (arr: number[]) => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length * 100) / 100 : null
    runningDynamics.push({
      date: day,
      power: a(r.power),
      speed: a(r.speed),
      verticalOscillation: a(r.vertOsc),
      groundContactTime: a(r.groundContact),
      strideLength: a(r.strideLen),
    })
  }
  runningDynamics.sort((a, b) => a.date.localeCompare(b.date))

  self.postMessage({
    type: 'complete',
    data: {
      profile,
      dailyMetrics: Array.from(dailyMetrics.entries()),
      workouts,
      sleepRecords,
      wristTempRecords,
      menstrualRecords,
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
      dailyMobility,
      runningDynamics,
      exportDate,
    },
  } as ParseComplete)
}

function extractAttr(str: string, name: string): string {
  const regex = new RegExp(`${name}="([^"]*)"`)
  const match = str.match(regex)
  return match ? match[1] : ''
}
