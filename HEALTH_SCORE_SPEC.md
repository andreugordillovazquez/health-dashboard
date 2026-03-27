# Composite Health Score Specification

## Part 1: Research Summary

### 1.1 Existing Commercial Scoring Systems

#### WHOOP Recovery Score (0-100%)
- **Metrics**: HRV (dominant factor), resting heart rate, respiratory rate, sleep performance, skin temperature, blood oxygen
- **Weights**: HRV is by far the biggest input; RHR and sleep are "most of the time redundant to the information provided by HRV"
- **Scale**: 0-100% (Green 67-100, Yellow 34-66, Red 0-33)
- **Approach**: Personalized baselines; compares each night's readings to your own rolling averages
- **Limitation**: Purely a recovery/readiness score, not a comprehensive health score
- **Sources**: [WHOOP Recovery 101](https://www.whoop.com/us/en/thelocker/how-does-whoop-recovery-work-101/), [WHOOP Developer Docs](https://developer.whoop.com/docs/whoop-101/)

#### Oura Readiness Score (0-100)
- **Metrics**: Resting HR, HRV balance (14-day weighted avg vs 2-month baseline), body temperature, sleep quality/duration, activity balance
- **Weights**: Proprietary; "balance" metrics use 14-day weighted averages with recent 2-5 days weighted more heavily
- **Scale**: 0-100 (contributors shown individually)
- **Approach**: Compares short-term (overnight) and long-term (14-day) patterns against personal 2-month baselines
- **Sources**: [Oura Readiness Score](https://ouraring.com/blog/readiness-score/), [Readiness Contributors](https://support.ouraring.com/hc/en-us/articles/360057791533-Readiness-Contributors)

#### Garmin Body Battery (0-100)
- **Metrics**: HRV (RMSSD), stress levels derived from HRV, sleep quality/duration, activity/exercise drain
- **Weights**: Proprietary (Firstbeat Analytics algorithm); VO2max affects drain rate during exercise
- **Scale**: 0-100 (energy model: charges during sleep/rest, drains during activity/stress)
- **Approach**: Real-time energy model rather than a morning snapshot
- **Sources**: [Garmin Body Battery](https://www.garmin.com/en-US/garmin-technology/health-science/body-battery/), [Body Battery FAQ](https://support.garmin.com/en-US/?faq=VOFJAsiXut9K19k1qEn5W5)

#### Apple Vitals (no composite score)
- **Metrics**: Overnight HR, respiratory rate, wrist temperature, blood oxygen, sleep duration
- **Approach**: No single score; alerts when multiple metrics are outside your typical range simultaneously
- **Sources**: [Apple Vitals](https://support.apple.com/guide/watch/vitals-apd15aa7ed96/watchos), [Cardio Fitness](https://support.apple.com/en-us/108790)

### 1.2 Key Differences: Recovery Score vs Health Score

All commercial systems above are **daily recovery/readiness scores** -- they answer "how ready am I to perform today?" Our goal is different: a **composite health score** that answers "how healthy am I overall?" This requires incorporating:
- Long-term fitness markers (VO2max, resting HR trends)
- Body composition
- Sleep architecture (not just duration)
- Activity/exercise habits (not just yesterday)
- Clinical risk thresholds (not just personal baselines)

### 1.3 Metrics Most Predictive of All-Cause Mortality (Ranked by Evidence Strength)

| Rank | Metric | Mortality Association | Key Finding |
|------|--------|----------------------|-------------|
| 1 | **VO2 Max / CRF** | Strongest independent predictor | Each 1-MET increase = 13-15% mortality reduction. Top 25% fitness = ~70% lower mortality vs bottom quartile. Stronger predictor than smoking, diabetes, or CVD. |
| 2 | **Resting Heart Rate** | Strong, continuous | Risk increases continuously above 60 bpm. RHR >= 90 bpm associated with significantly higher all-cause mortality. J-shaped: very low (<45) may also signal risk. |
| 3 | **HRV (SDNN)** | Strong for cardiac risk | SDNN < 50ms = unhealthy, 50-100ms = compromised, >100ms = healthy (24-hr). Patients with SDNN > 100ms had 5.3x lower mortality risk than <50ms. |
| 4 | **Sleep Duration** | U-shaped | Optimal ~7 hours. Short (<6h): +14% mortality risk. Long (>9h): +34% mortality risk. Sleep regularity may be even more predictive than duration. |
| 5 | **Daily Steps** | Inverse, non-linear | Inflection at ~7,000-8,000 steps/day. Each 1,000-step increment = ~15% mortality reduction. Benefits plateau at ~10,000-12,000 steps. Age-dependent: 6,000-8,000 for 60+, 8,000-10,000 for <60. |
| 6 | **Exercise Minutes** | Dose-response with plateau | 150-300 min/week moderate = 21-31% mortality reduction. Benefits plateau beyond 300 min/week. Going from 0 to any exercise = largest single reduction. |
| 7 | **BMI** | U-shaped | Lowest mortality at BMI 22-25 (general population). Risk increases below 18.5 and above 30. For elderly: risk begins below BMI 20. |
| 8 | **SpO2** | Threshold-based | Normal: 95-100%. Below 94% = mild hypoxemia concern. Below 90% = clinically significant. |
| 9 | **Sleep Architecture** | Emerging evidence | Deep sleep ~20-25% of total, REM ~20-25% of total. Deep sleep declines ~2% per decade after age 20. |

**Key citations:**
- Mandsager et al. (2018): 122,000+ subjects, CRF is strongest predictor of mortality (JAMA Network Open)
- Kokkinos et al.: 750,000+ veterans, each 1-MET = 13-15% mortality reduction
- MESA study (PMC5010946): HRV reference ranges for cardiovascular-disease-free adults
- Meta-analysis (PMC4754196): RHR and all-cause mortality, continuous risk above 60 bpm
- Meta-analysis (PMC9289978): Steps and mortality across 15 international cohorts
- Sleep regularity study (Oxford SLEEP, zsad253): Regularity stronger predictor than duration

---

## Part 2: Proposed Scoring System

### 2.1 Architecture Overview

```
Total Health Score (0-100)
├── Cardio Score (0-100)     weight: 35%
│   ├── VO2 Max              weight: 40% of cardio
│   ├── Resting Heart Rate   weight: 25% of cardio
│   ├── HRV (SDNN)           weight: 25% of cardio
│   └── Walking Heart Rate   weight: 10% of cardio
│
├── Sleep Score (0-100)      weight: 25%
│   ├── Duration             weight: 30% of sleep
│   ├── Deep Sleep %         weight: 20% of sleep
│   ├── REM Sleep %          weight: 20% of sleep
│   ├── Consistency          weight: 15% of sleep
│   └── Breathing Quality    weight: 15% of sleep
│       (disturbances + SpO2 + resp rate)
│
├── Activity Score (0-100)   weight: 25%
│   ├── Daily Steps          weight: 35% of activity
│   ├── Exercise Minutes     weight: 35% of activity
│   ├── Active Energy        weight: 15% of activity
│   └── Daylight Exposure    weight: 15% of activity
│
└── Body Score (0-100)       weight: 15%
    ├── BMI                  weight: 50% of body
    └── Weight Trend         weight: 50% of body
```

### 2.2 Rationale for Top-Level Weights

| Sub-score | Weight | Rationale |
|-----------|--------|-----------|
| Cardio | 35% | VO2max and resting HR are the strongest independent predictors of all-cause mortality. CRF alone is a stronger predictor than smoking, diabetes, or CVD diagnosis. |
| Sleep | 25% | Sleep duration and regularity are independently associated with mortality, cognitive decline, and metabolic health. Architecture (deep/REM) affects recovery and immune function. |
| Activity | 25% | Steps and exercise minutes have strong dose-response mortality relationships. Going from sedentary to moderately active is the single largest modifiable risk reduction. |
| Body | 15% | BMI has a U-shaped mortality curve but is a weaker independent predictor than fitness. Weight trend captures trajectory which matters more than static weight. |

### 2.3 Individual Metric Scoring Functions

Each metric is scored 0-100 using **piecewise linear functions** anchored to clinical thresholds, not arbitrary percentiles. The functions are designed so that:
- 0 = clinically dangerous / severely deficient
- 50 = minimum adequate / borderline
- 75 = meets clinical guidelines / good health
- 100 = optimal / elite health

#### 2.3.1 VO2 Max Score (age- and sex-adjusted)

Uses Cooper Institute / ACSM normative data:

```
Reference table (ml/kg/min):
Males:
  Age   VeryPoor  Poor    Fair    Good    Excellent  Superior
  20-29  <33.0   33-36.4  36.5-42.4  42.5-46.4  46.5-52.4  >52.4
  30-39  <31.5   31.5-35.4  35.5-40.9  41.0-44.9  45.0-49.4  >49.4
  40-49  <30.2   30.2-33.5  33.6-38.9  39.0-43.7  43.8-48.0  >48.0
  50-59  <26.1   26.1-30.9  31.0-35.7  35.8-40.9  41.0-45.3  >45.3
  60-69  <20.5   20.5-26.0  26.1-32.2  32.3-36.4  36.5-44.2  >44.2

Females:
  Age   VeryPoor  Poor    Fair    Good    Excellent  Superior
  20-29  <23.6   23.6-28.9  29.0-32.9  33.0-36.9  37.0-41.0  >41.0
  30-39  <22.8   22.8-26.9  27.0-31.4  31.5-35.6  35.7-40.0  >40.0
  40-49  <21.0   21.0-24.4  24.5-28.9  29.0-32.8  32.9-36.9  >36.9
  50-59  <20.2   20.2-22.7  22.8-26.9  27.0-31.4  31.5-35.7  >35.7
  60+    <17.5   17.5-20.1  20.2-24.4  24.5-30.2  30.3-31.4  >31.4

Scoring mapping:
  VeryPoor boundary → score 10
  Poor boundary     → score 30
  Fair boundary     → score 50
  Good boundary     → score 70
  Excellent boundary→ score 85
  Superior boundary → score 100
  Below 18 ml/kg/min (functional independence threshold) → score 0

Linear interpolation between boundaries.
```

#### 2.3.2 Resting Heart Rate Score

Based on meta-analyses showing continuous risk increase above 60 bpm:

```
RHR (bpm)    Score    Clinical basis
≤ 50          95      Elite athlete range (if asymptomatic)
  55         100      Optimal (well-trained, healthy autonomic function)
  60          90      Excellent (low cardiovascular risk)
  65          80      Good
  70          70      Average; risk begins increasing
  75          55      Below average
  80          40      Elevated risk threshold (population studies)
  85          25      High risk threshold
  90          15      Significantly elevated risk (meta-analysis cutoff)
  100          5      Tachycardia threshold
  ≤ 40          70      Very low — possible bradycardia concern (J-curve)

Linear interpolation between points.
Note: RHR < 45 is flagged but not penalized heavily unless symptomatic
(many fit individuals have RHR 45-55).
```

#### 2.3.3 HRV (SDNN) Score

Based on clinical stratification and age-adjusted norms. Apple Watch measures overnight SDNN which corresponds roughly to short-term recordings (not 24-hr). Thresholds adjusted accordingly:

```
Overnight SDNN (ms)  Score   Clinical basis
< 20                   5     Severely depressed autonomic function
  20                  15     Very low
  30                  30     Low (clinical concern)
  50                  50     Borderline (24-hr "compromised" threshold, adjusted for overnight)
  70                  70     Adequate
  100                 85     Good (24-hr "healthy" threshold)
  130                 95     Excellent
  ≥ 150              100     Superior

Age adjustment: multiply raw SDNN thresholds by age factor:
  Age 20-29: 1.0 (reference)
  Age 30-39: 0.95
  Age 40-49: 0.88
  Age 50-59: 0.80
  Age 60-69: 0.72
  Age 70-79: 0.65

This means a 60-year-old with SDNN 72ms scores the same as a
30-year-old with SDNN 100ms (both map to ~85).
```

#### 2.3.4 Walking Heart Rate Score

Relative to age-predicted maximum heart rate (220 - age):

```
Walking HR as % of max HR    Score    Clinical basis
< 40%                         100     Very efficient (highly fit)
  40-45%                       90     Excellent
  45-50%                       80     Good
  50-55%                       70     Average
  55-60%                       55     Below average
  60-65%                       40     Elevated for walking
  65-70%                       25     Poor cardiovascular efficiency
  > 70%                        10     Significantly impaired

Formula: walkingHR_pct = walkingHR / (220 - age)
Linear interpolation between points.
```

#### 2.3.5 Sleep Duration Score

Based on meta-analyses showing U-shaped mortality curve with optimum at ~7 hours:

```
Hours       Score    Clinical basis
< 4           5     Severe deprivation; major health risk
  4.5        15     Very short; significant mortality risk
  5          30     Short; +30-40% mortality risk increase
  5.5        45     Moderately short
  6          65     Slightly short; +14% mortality risk
  6.5        80     Near optimal
  7          100    Optimal (lowest all-cause mortality)
  7.5        95     Excellent
  8          85     Good
  8.5        70     Slightly long
  9          55     Long; +13% mortality risk per hour above 7
  9.5        35     Very long; +34% mortality risk
  ≥ 10       15     Excessively long; may indicate underlying condition

Linear interpolation between points.
```

#### 2.3.6 Deep Sleep Percentage Score

Based on clinical norms (~20-25% of total sleep) adjusted for age:

```
Deep sleep % of total    Score    Clinical basis
< 5%                      10     Severely deficient
  5%                      25     Very low
  10%                     50     Low (below clinical norm)
  15%                     75     Adequate
  20%                     90     Good (lower bound of clinical target)
  25%                    100     Optimal
  ≥ 30%                  100     Excellent (cap at 100)

Age adjustment: expected deep sleep % declines ~2% per decade after 20.
  Age 20-29: thresholds as above
  Age 30-39: multiply thresholds by 0.92
  Age 40-49: multiply thresholds by 0.84
  Age 50-59: multiply thresholds by 0.76
  Age 60-69: multiply thresholds by 0.70
  Age 70+:   multiply thresholds by 0.64

Example: A 55-year-old with 15% deep sleep scores higher than a 25-year-old
with the same percentage, because less deep sleep is expected.
```

#### 2.3.7 REM Sleep Percentage Score

```
REM % of total    Score    Clinical basis
< 5%               10     Severely deficient
  10%              35     Low
  15%              60     Below normal
  20%              85     Good (lower bound of clinical target: 20-25%)
  25%             100     Optimal
  30%              90     Slightly high
  ≥ 35%            75     Unusually high (possible measurement artifact)
```

#### 2.3.8 Sleep Consistency Score

Based on research showing sleep regularity is a stronger mortality predictor than duration:

```
Metric: standard deviation of bedtime over the past 14 days (in minutes)

Bedtime SD (min)    Score    Clinical basis
≤ 15                 100     Highly consistent
  30                  85     Good consistency
  45                  70     Moderate consistency
  60                  50     Variable
  90                  30     Highly variable
  ≥ 120               10     Severely irregular

Additional penalty: if wake-time SD > 60 min, subtract 10 points.
```

#### 2.3.9 Breathing Quality Score (composite of 3 sub-metrics)

```
Sub-metric 1: Breathing Disturbances (40% of breathing quality)
  Disturbances/night    Score
  0                      100
  1-4                    85     Normal range
  5-14                   55     Mild concern (AHI mild equivalent)
  15-29                  25     Moderate concern (AHI moderate equivalent)
  ≥ 30                    5     Severe concern (AHI severe equivalent)

Sub-metric 2: SpO2 (40% of breathing quality)
  SpO2 %      Score
  ≥ 97          100
  96            90
  95            80     Lower bound of normal
  94            60     Mild concern
  93            40
  92            25     Hypoxemia threshold
  ≤ 90           5     Clinically significant hypoxemia

Sub-metric 3: Respiratory Rate (20% of breathing quality)
  Breaths/min    Score
  12-16          100     Optimal range
  16-18           85
  18-20           70     Upper normal limit
  10-12           80     Lower normal limit
  8-10            50     Low (possible central apnea)
  20-22           45
  > 22            20     Tachypnea concern
  < 8             20     Bradypnea concern
```

#### 2.3.10 Daily Steps Score

Based on 2024 meta-analyses with age-adjusted inflection points:

```
Age < 60:
  Steps       Score    Clinical basis
  < 2000       10     Severely sedentary
  3000         25     Minimal protective threshold (HR 0.91 per 1000 steps)
  5000         45     Moderately active
  7000         65     Clinically meaningful inflection point
  8000         75     Approaching optimal
  10000        90     Guideline target; near full benefit
  12000       100     Optimal (lowest observed mortality risk)
  > 12000     100     Benefits plateau

Age ≥ 60:
  Steps       Score    Clinical basis
  < 2000       10     Severely sedentary
  3000         30     Minimal protective threshold
  4000         45
  6000         70     Inflection point for 60+ (meta-analysis)
  8000         90     Near optimal for age group
  10000       100     Full benefit
  > 10000     100     Benefits plateau
```

#### 2.3.11 Exercise Minutes Score

Based on WHO guidelines (150-300 min/week moderate) and dose-response data:

```
Convert to weekly rolling average (past 7 days).

Minutes/week    Score    Clinical basis
  0               5     Completely sedentary
  30             20     Minimal
  75             40     Half of minimum guideline
  150            70     Meets WHO minimum (21-23% mortality reduction)
  300            90     Meets WHO upper target (26-31% mortality reduction)
  450            97     1.5x upper target; near maximum benefit
  ≥ 600         100     Benefits fully plateaued

Daily input: exerciseMinutes from DailyMetrics
Converted: sum of past 7 days
```

#### 2.3.12 Active Energy Score

Based on ~400-600 kcal/day active energy meeting WHO guidelines:

```
Active Energy (kcal/day)    Score    Clinical basis
< 50                          5     Nearly immobile
  100                        20
  200                        40
  400                        70     Lower bound of WHO guideline equivalent
  600                        85     Upper bound of WHO guideline equivalent
  800                        95
  ≥ 1000                    100     Very active (plateau)
```

#### 2.3.13 Daylight Exposure Score

Based on circadian health research and PNAS 2024 study on light exposure and mortality:

```
Minutes of outdoor daylight    Score    Clinical basis
  0                              5     No daylight; circadian disruption risk
  5                             20     Minimal (insufficient for circadian entrainment)
  10                            40     Sunny day minimum per Huberman et al.
  20                            60     Overcast day adequate threshold
  30                            75     Recommended morning exposure duration
  60                            90     Good daily target
  ≥ 90                         100     Excellent outdoor time

Daylight data from: dailyDaylight[].minutes
```

#### 2.3.14 BMI Score

Based on U-shaped mortality curve from meta-analyses:

```
BMI         Score    Clinical basis
< 16          5     Severely underweight; high mortality risk
  16         15
  17         30
  18.5       55     Lower normal boundary
  20         75
  22         95     Center of optimal range
  24.5      100     Often lowest mortality in meta-analyses
  25         95     Upper normal boundary
  27         75     Overweight
  30         50     Obesity class I threshold
  32         35
  35         20     Obesity class II threshold
  ≥ 40        5     Obesity class III; very high risk

Age adjustment for 65+: shift optimal range up by 1-2 BMI points
(evidence shows slightly higher BMI is protective in elderly).
  65+: optimal center = 25.5, score 100 at BMI 25-27
```

#### 2.3.15 Weight Trend Score

Captures trajectory over past 30 days, rewarding stability or intentional loss if overweight:

```
Metric: 30-day weight change as % of body weight

If current BMI > 27 (overweight):
  -2% to -0.5%  → 100  (healthy weight loss pace)
  -0.5% to 0%   → 85   (stable, slightly losing)
  0% to +1%     → 60   (stable but not losing when should)
  > +1%         → 30   (gaining when overweight)
  < -2%         → 60   (losing too fast)

If current BMI 18.5-27 (normal):
  -0.5% to +0.5% → 100  (stable — ideal)
  +0.5% to +1.5% → 70
  -0.5% to -1.5% → 70
  > +1.5%        → 40
  < -1.5%        → 40

If current BMI < 18.5 (underweight):
  +0.5% to +2%  → 100  (healthy weight gain)
  -0.5% to +0.5%→ 60   (stable when should gain)
  < -0.5%       → 20   (losing when underweight)
  > +2%         → 70   (gaining fast)

If no weight data in 30 days: use neutral score of 70 (no penalty for missing data).
```

### 2.4 Handling Missing Data

On any given day, not all metrics will be available. The system handles this gracefully:

```
Rules:
1. Each sub-score is computed from available metrics only.
2. Missing metric weights are redistributed proportionally to present metrics
   within the same sub-score category.
3. A sub-score requires at least ONE metric present to be computed.
4. If a sub-score has zero metrics, its weight is redistributed to other sub-scores.
5. Minimum data for a total score: at least 2 of 4 sub-score categories must
   have data. Otherwise, display "Insufficient data" rather than a misleading score.

Staleness rules for infrequently-measured metrics:
  - VO2 Max: use most recent value within 30 days (Apple Watch measures infrequently)
  - Weight/BMI: use most recent value within 14 days
  - All other metrics: use same-day data only

Example: A day with only steps (8000), sleep (7.2h), and RHR (58):
  - Cardio: only RHR available → cardio = RHR score (redistributed to 100% weight)
  - Sleep: only duration available → sleep = duration score
  - Activity: only steps available → activity = steps score
  - Body: no data → weight redistributed (Cardio 41%, Sleep 29%, Activity 29%)
```

### 2.5 Smoothing and Display

```
Daily Score: Raw computation from that day's data (or most recent where applicable).
7-Day Average: Rolling 7-day mean of daily scores. This is the PRIMARY displayed score.
30-Day Trend: Arrow indicator showing direction of 7-day average over past 30 days.

Rationale: A single day's score can be noisy (e.g., bad sleep one night).
The 7-day average is more stable and clinically meaningful. The daily score
is still available for drill-down.
```

### 2.6 Score Interpretation Scale

```
Score     Label          Color      Interpretation
90-100    Excellent      #22c55e    Metrics consistently at or above clinical optimal
80-89     Very Good      #4ade80    Most metrics in healthy range
70-79     Good           #86efac    Meeting guidelines; room for improvement
60-69     Fair           #fbbf24    Some metrics below clinical thresholds
50-59     Needs Work     #f97316    Multiple metrics below guidelines
40-49     Poor           #ef4444    Several metrics in clinical concern range
< 40      Critical       #dc2626    Significant health risk indicators; consult physician
```

### 2.7 Implementation Data Sources (from types.ts)

| Metric | Data Source | Field(s) |
|--------|------------|----------|
| Steps | DailyMetrics | `steps` |
| Active Energy | DailyMetrics | `activeEnergy` |
| Exercise Minutes | DailyMetrics | `exerciseMinutes` |
| Resting Heart Rate | DailyMetrics | `restingHeartRate` |
| HRV (SDNN) | DailyMetrics | `hrv` |
| VO2 Max | DailyMetrics + CardioRecord | `vo2max` / cardioRecords where type='vo2max' |
| Walking HR | CardioRecord | where `type='walkingHR'` |
| Weight | BodyRecord | `weight` |
| BMI | BodyRecord | `bmi` |
| Sleep Duration | DailySleep | `total` (minutes → hours) |
| Deep Sleep % | DailySleep | `deep / total` |
| REM Sleep % | DailySleep | `rem / total` |
| Sleep Consistency | DailySleep (14-day window) | std dev of `bedtime` |
| Breathing Disturbances | DailyBreathing | `disturbances` |
| SpO2 | DailyBreathing | `spo2` |
| Respiratory Rate | DailyBreathing | `respiratoryRate` |
| Daylight | dailyDaylight | `minutes` |
| Age | profile | computed from `dob` |
| Sex | profile | `sex` |

### 2.8 Algorithm Pseudocode

```typescript
function computeHealthScore(date: string, data: HealthData): HealthScore {
  const age = yearsFromDob(data.profile.dob, date);
  const sex = data.profile.sex; // 'Male' | 'Female'

  // --- Cardio Sub-score ---
  const vo2 = getMostRecent(data, 'vo2max', date, 30); // within 30 days
  const rhr = getDayValue(data.dailyMetrics, date, 'restingHeartRate');
  const hrv = getDayValue(data.dailyMetrics, date, 'hrv');
  const walkHR = getDayCardio(data.cardioRecords, date, 'walkingHR');

  const cardioScores = weightedAvgOfPresent([
    { score: scoreVO2(vo2, age, sex),    weight: 0.40 },
    { score: scoreRHR(rhr),              weight: 0.25 },
    { score: scoreHRV(hrv, age),         weight: 0.25 },
    { score: scoreWalkingHR(walkHR, age), weight: 0.10 },
  ]);

  // --- Sleep Sub-score ---
  const sleep = getDailySleep(data, date);
  const sleepConsistency = computeBedtimeSD(data, date, 14); // 14-day window
  const breathing = getDayBreathing(data, date);

  const sleepScores = weightedAvgOfPresent([
    { score: scoreSleepDuration(sleep?.total),          weight: 0.30 },
    { score: scoreDeepSleep(sleep?.deep, sleep?.total, age), weight: 0.20 },
    { score: scoreREMSleep(sleep?.rem, sleep?.total),   weight: 0.20 },
    { score: scoreSleepConsistency(sleepConsistency),   weight: 0.15 },
    { score: scoreBreathingQuality(breathing),          weight: 0.15 },
  ]);

  // --- Activity Sub-score ---
  const steps = getDayValue(data.dailyMetrics, date, 'steps');
  const exerciseWeekly = sumPast7Days(data.dailyMetrics, date, 'exerciseMinutes');
  const activeEnergy = getDayValue(data.dailyMetrics, date, 'activeEnergy');
  const daylight = getDayDaylight(data, date);

  const activityScores = weightedAvgOfPresent([
    { score: scoreSteps(steps, age),             weight: 0.35 },
    { score: scoreExerciseMinutes(exerciseWeekly), weight: 0.35 },
    { score: scoreActiveEnergy(activeEnergy),    weight: 0.15 },
    { score: scoreDaylight(daylight),            weight: 0.15 },
  ]);

  // --- Body Sub-score ---
  const body = getMostRecentBody(data.bodyRecords, date, 14);
  const weightTrend = computeWeightTrend(data.bodyRecords, date, 30);

  const bodyScores = weightedAvgOfPresent([
    { score: scoreBMI(body?.bmi, age),            weight: 0.50 },
    { score: scoreWeightTrend(weightTrend, body?.bmi), weight: 0.50 },
  ]);

  // --- Composite ---
  const total = weightedAvgOfPresent([
    { score: cardioScores,   weight: 0.35 },
    { score: sleepScores,    weight: 0.25 },
    { score: activityScores, weight: 0.25 },
    { score: bodyScores,     weight: 0.15 },
  ]);

  return {
    date,
    total: Math.round(total),
    cardio: Math.round(cardioScores),
    sleep: Math.round(sleepScores),
    activity: Math.round(activityScores),
    body: Math.round(bodyScores),
    // Individual metric scores for drill-down
    metrics: { vo2, rhr, hrv, walkHR, sleepDuration, deepPct, remPct, ... }
  };
}

function weightedAvgOfPresent(items: {score: number|null, weight: number}[]): number|null {
  const present = items.filter(i => i.score !== null);
  if (present.length === 0) return null;
  const totalWeight = present.reduce((sum, i) => sum + i.weight, 0);
  return present.reduce((sum, i) => sum + i.score! * (i.weight / totalWeight), 0);
}
```

### 2.9 Suggested TypeScript Interface

```typescript
export interface HealthScore {
  date: string;
  total: number;          // 0-100
  cardio: number | null;  // 0-100
  sleep: number | null;   // 0-100
  activity: number | null;// 0-100
  body: number | null;    // 0-100
  confidence: number;     // 0-1, based on data completeness
  metricsUsed: number;    // count of metrics that had data
  metricsTotal: number;   // total possible metrics (15)
}
```

---

## Part 3: Scientific Backing Summary

### Why these weights and thresholds?

1. **VO2 Max at 40% of Cardio (14% of total)**: CRF is the single strongest predictor of all-cause mortality, stronger than traditional risk factors. The Mandsager 2018 JAMA study and Kokkinos veteran study provide the strongest evidence base.

2. **RHR at 25% of Cardio (8.75% of total)**: Continuous, independent predictor in multiple meta-analyses. The PMC4754196 meta-analysis establishes the dose-response above 60 bpm.

3. **HRV at 25% of Cardio (8.75% of total)**: SDNN is the "gold standard" for cardiac risk stratification (PMC5624990). The 5.3x mortality difference between >100ms and <50ms groups is striking.

4. **Sleep Duration at 30% of Sleep (7.5% of total)**: The U-shaped curve is one of the most replicated findings in sleep epidemiology, confirmed across multiple meta-analyses with millions of participants.

5. **Steps at 35% of Activity (8.75% of total)**: The 2024 umbrella review (ScienceDirect S0091743524002020) and 15-cohort meta-analysis (PMC9289978) establish the non-linear dose-response with clear inflection points.

6. **BMI at 50% of Body (7.5% of total)**: Lower weight than fitness metrics because BMI is a weaker independent predictor when CRF is accounted for. The U-shaped curve is well-established but the "obesity paradox" in older adults requires age adjustment.

### Limitations and Caveats

1. **Consumer wearable accuracy**: Apple Watch VO2max has ~15 ml/kg/min limits of agreement for resting-based methods. HRV from wrist-based PPG has wider confidence intervals than chest-strap ECG.

2. **Population bias**: Clinical thresholds derived primarily from Western populations. May need adjustment for other demographics.

3. **Missing confounders**: This score cannot account for blood pressure, lipid panels, glucose levels, family history, smoking status, or medication use -- all important health determinants.

4. **Correlation between metrics**: HRV, RHR, and VO2max are partially correlated. The weighting accounts for this by not over-weighting the cardio category despite its individual metrics being strong predictors.

5. **Not a diagnostic tool**: This score is for personal health awareness. It should never replace medical evaluation or clinical decision-making.
