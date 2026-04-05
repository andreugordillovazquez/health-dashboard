export interface DailyMetrics {
  date: string // YYYY-MM-DD
  steps: number
  activeEnergy: number
  restingHeartRate: number | null
  hrv: number | null
  vo2max: number | null
  weight: number | null
  sleepHours: number | null
  distance: number // km
  exerciseMinutes: number
  standHours: number
  activeEnergyGoal: number
  exerciseGoal: number
  standGoal: number
}

export interface Workout {
  type: string
  date: string
  startDate: string
  endDate: string
  duration: number // minutes
  calories: number
  distance: number | null // km
  hrAvg: number | null
  hrMin: number | null
  hrMax: number | null
  avgMETs: number | null
  weather: string | null // temperature
  elevationAscended: number | null // meters
}

export interface SleepRecord {
  date: string // YYYY-MM-DD (night of — assigned to the day you wake up)
  stage: 'core' | 'deep' | 'rem' | 'awake' | 'inbed' | 'unspecified'
  startDate: string // ISO
  endDate: string // ISO
  minutes: number
}

export interface DailySleep {
  date: string
  core: number // minutes
  deep: number
  rem: number
  awake: number
  total: number // core + deep + rem
  bedtime: string // HH:MM
  wakeTime: string // HH:MM
}

export interface CaffeineRecord {
  date: string // YYYY-MM-DD
  time: string // HH:MM
  mg: number
}

export interface BodyRecord {
  date: string // YYYY-MM-DD
  weight: number | null // kg
  bodyFat: number | null // %
  leanMass: number | null // kg
  bmi: number | null
}

export interface CardioRecord {
  date: string
  value: number
  type: 'walkingHR' | 'hrRecovery' | 'vo2max'
}

export interface HRSample {
  t: number // ms since epoch
  v: number // bpm
}

export interface DailyHR {
  date: string
  min: number
  max: number
  avg: number
}

export interface DailyAudio {
  date: string
  headphoneAvg: number | null // dBASPL
  headphoneMax: number | null
  envAvg: number | null
  envMax: number | null
  headphoneMinutes: number
  envMinutes: number
  eventsAboveLimit: number
}

export interface DailyBreathing {
  date: string
  disturbances: number | null // count per night
  respiratoryRate: number | null // breaths/min avg
  spo2: number | null // % (0-100)
}

export interface MenstrualRecord {
  date: string // YYYY-MM-DD
  flow: 'none' | 'light' | 'medium' | 'heavy' | 'unspecified' | null
  cervicalMucus: 'dry' | 'sticky' | 'creamy' | 'watery' | 'eggWhite' | null
  ovulationTest: 'negative' | 'positive' | 'indeterminate' | null
  basalBodyTemp: number | null // degC
  sexualActivity: boolean
  intermenstrualBleeding: boolean
}

export interface WristTempRecord {
  date: string
  value: number // degC
}

export interface GpxPoint {
  lat: number
  lon: number
  ele: number
  time: string
  speed: number
}

export interface GpxRoute {
  name: string
  filename: string
  points: GpxPoint[]
  totalDistance: number // km
  totalTime: number // seconds
  elevationGain: number
  avgSpeed: number // km/h
  maxSpeed: number // km/h
  startTime: string
}

export interface GarminTrainingReadiness {
  date: string; score: number; level: string
  sleepFactor: number; recoveryTimeFactor: number; acwrFactor: number
  stressFactor: number; hrvFactor: number; sleepHistoryFactor: number
}

export interface GarminEnduranceScore {
  date: string; score: number; classification: number
  contributors: { group: number; contribution: number }[]
}

export interface GarminHillScore {
  date: string; overall: number; strength: number; endurance: number
}

export interface GarminAcuteTrainingLoad {
  date: string; acute: number; chronic: number; ratio: number; status: string
}

export interface GarminRacePrediction {
  date: string; time5k: number; time10k: number; timeHalf: number; timeMarathon: number
}

export interface GarminHeatAltitude {
  date: string; heatPercent: number; altitudeAcclimation: number
}

export interface GarminFitnessAge {
  date: string; fitnessAge: number; chronologicalAge: number; vo2max: number
}

export interface GarminSleepScore {
  date: string; overall: number; quality: number; duration: number
  recovery: number; deep: number; rem: number; light: number
  avgStress: number; respiration: number
}

export interface GarminMetrics {
  trainingReadiness: GarminTrainingReadiness[]
  vo2max: { date: string; value: number; sport: string }[]
  enduranceScore: GarminEnduranceScore[]
  hillScore: GarminHillScore[]
  acuteTrainingLoad: GarminAcuteTrainingLoad[]
  racePredictions: GarminRacePrediction[]
  heatAltitude: GarminHeatAltitude[]
  fitnessAge: GarminFitnessAge[]
  stressDaily: { date: string; avgStress: number; maxStress: number; restDuration: number; stressDuration: number }[]
  hydration: { date: string; intakeMl: number; sweatLossMl: number }[]
  sleepScores: GarminSleepScore[]
}

export interface DailyMobility {
  date: string
  walkingSpeed: number | null // km/h
  stepLength: number | null // cm
  doubleSupportPct: number | null // %
  asymmetryPct: number | null // %
  stairAscentSpeed: number | null // m/s
  stairDescentSpeed: number | null // m/s
  walkingSteadiness: number | null // % (0-100)
  sixMinWalkDistance: number | null // meters
  flightsClimbed: number
}

export interface RunningDynamicsRecord {
  date: string
  power: number | null // watts
  speed: number | null // m/s
  verticalOscillation: number | null // cm
  groundContactTime: number | null // ms
  strideLength: number | null // meters
}

export interface HealthData {
  profile: {
    dob: string
    sex: string
    bloodType: string
  }
  dailyMetrics: Map<string, DailyMetrics>
  workouts: Workout[]
  sleepRecords: SleepRecord[]
  wristTempRecords: WristTempRecord[]
  menstrualRecords: MenstrualRecord[]
  caffeineRecords: CaffeineRecord[]
  bodyRecords: BodyRecord[]
  cardioRecords: CardioRecord[]
  dailyHR: DailyHR[]
  hrTimeline: HRSample[]
  dailyAudio: DailyAudio[]
  dailyBreathing: DailyBreathing[]
  dailyDaylight: { date: string; minutes: number }[]
  dailyMobility: DailyMobility[]
  runningDynamics: RunningDynamicsRecord[]
  gpxFiles: Map<string, File> // filename -> File
  ecgFiles: Map<string, File> // filename -> File
  exportDate: string
  sourceMode?: 'apple' | 'garmin'
  garminMetrics?: GarminMetrics
}

export interface ParseProgress {
  type: 'progress'
  recordsProcessed: number
  currentDate: string
}

export interface ParseComplete {
  type: 'complete'
  data: {
    profile: HealthData['profile']
    dailyMetrics: [string, DailyMetrics][]
    workouts: Workout[]
    sleepRecords: SleepRecord[]
    wristTempRecords: WristTempRecord[]
    menstrualRecords: MenstrualRecord[]
    caffeineRecords: CaffeineRecord[]
    bodyRecords: BodyRecord[]
    cardioRecords: CardioRecord[]
    dailyHR: DailyHR[]
    hrTimeline: HRSample[]
    dailyAudio: DailyAudio[]
    dailyBreathing: DailyBreathing[]
    dailyDaylight: { date: string; minutes: number }[]
    dailyMobility: DailyMobility[]
    runningDynamics: RunningDynamicsRecord[]
    exportDate: string
  }
}

export interface ParseError {
  type: 'error'
  message: string
}

export type WorkerMessage = ParseProgress | ParseComplete | ParseError

export interface TrendInsight {
  metric: string
  direction: 'up' | 'down'
  positive: boolean
  recentAvg: number
  previousAvg: number
  changePercent: number
  unit: string
}
