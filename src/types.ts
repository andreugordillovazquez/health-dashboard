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
  caffeineRecords: CaffeineRecord[]
  bodyRecords: BodyRecord[]
  cardioRecords: CardioRecord[]
  dailyHR: DailyHR[]
  hrTimeline: HRSample[]
  dailyAudio: DailyAudio[]
  dailyBreathing: DailyBreathing[]
  dailyDaylight: { date: string; minutes: number }[]
  gpxFiles: Map<string, File> // filename -> File
  ecgFiles: Map<string, File> // filename -> File
  exportDate: string
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
    caffeineRecords: CaffeineRecord[]
    bodyRecords: BodyRecord[]
    cardioRecords: CardioRecord[]
    dailyHR: DailyHR[]
    hrTimeline: HRSample[]
    dailyAudio: DailyAudio[]
    dailyBreathing: DailyBreathing[]
    dailyDaylight: { date: string; minutes: number }[]
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
