# App functions — software design → implementation

Maps each application function in `software_technical_design.docx` (Patient Intelligence
Center) to where it lives in this repo, and records the safety boundary each one is built
against. The data path the document describes — Exposure → Correlation → Personalized Risk →
Prediction → Alert → Feedback — runs left to right through the rows below.

| Function | Backend | Mobile | Notes |
|---|---|---|---|
| Patient Profile | `privacy_consents`, `devices` | `ProfileSettingsScreen`, `PrivacyScreen` | Context + notification/consent settings |
| Asthma Symptom Diary | `POST /symptoms` (`symptom_events.inhaler_used`) | `SymptomEventScreen` | Cough / chest tightness / wheeze / breathless + inhaler-use event |
| Exposure Timeline | `GET /devices/{id}/exposure-timeline` | `ExposureTimelineScreen`, `ExposureEventDetailScreen` | Environment before and after a recorded event |
| Correlation Analysis | `GET /devices/{id}/pattern` (`intelligence/pattern.py`) | `PersonalPatternScreen` | Observational association only, always with sample size + uncertainty |
| Personalized Risk Score | `GET /devices/{id}/risk` (`intelligence/risk.py`) | `RiskCard` on Home | Systemic aggregate of exposure, duration, personal baseline, symptom history, time of day |
| Predictive Alert | `GET /devices/{id}/forecast` (`intelligence/predict.py`) | `ForecastCard` on Home | 15–30 min horizon (default 20), environmental PM2.5 only |
| Asthma Action Plan Interface | `GET/PUT /me/action-plan` | `ActionPlanScreen` | Stored and displayed verbatim; Aeris authors nothing |
| SOS Flow | `POST /sos`, `GET /me/sos`, `/me/contacts` | `SosScreen`, `EmergencyContactsScreen`, BLE SOS characteristic | Consent-gated location; nobody is contacted automatically |

## Alert levels

The document's Green / Yellow / Red map onto the app's existing watch vocabulary, which also
carries a fourth state the colour scheme has no room for:

| Document | App | Meaning |
|---|---|---|
| Green | **Normal** | Exposure/risk low by the system's thresholds — *not* a statement that there is no medical risk |
| Yellow | **Caution** | Risk indicators increased; reduce exposure, check the environment |
| Red | **High** | High exposure or an emergency event; follow *your* action plan |
| — | **No Data** | Not enough valid, fresh data to say anything. Never rendered as Green |

"SAFE" is not in the vocabulary and is enforced absent by `mobile/scripts/check-no-safe.mjs`.

## Safety boundaries these functions are built against

Every row above obeys the same rules (TDD §1.2, §9, §14), and each is pinned by tests:

1. **No diagnosis, no prescribing.** The risk score is an engineering aggregate, never a
   probability of illness. The action plan is authored by the user or their clinician; Aeris
   stores and displays it and never generates or edits a care step.
2. **Missing data is never a low reading.** `compute_risk` returns `NO_DATA` with a null score
   whenever the §5.1 gate fails, and `forecast_pm25` returns `available: false` rather than a
   projection it cannot support.
3. **Personal history never promotes the band.** Symptom entries refine the score within the
   band the measured environment already justifies — a recorded symptom has causes this system
   cannot observe.
4. **Prediction is environmental.** The forecast projects PM2.5, never symptoms or medical
   events, and always carries its uncertainty band.
5. **SOS is user-initiated and consent-gated.** The device reports only that the button was
   pressed. Location is dropped or coarsened server-side according to
   `privacy_consents.location_sharing`, and no message is sent to anyone on the user's behalf.
6. **Health data stays private.** `symptom_events`, `action_plans`, `emergency_contacts` and
   `sos_events` are owner-only with no anon policy (`infra/supabase/003_care_and_sos.sql`).

## External context (§6 of the document)

Weather and other external variables for the prediction model are **not** implemented. The
document scopes them as a later extension, and the requirement it states — every external
value stored with its own timestamp and source, to prevent leakage and stay auditable — is a
schema decision that should be made when the feature is built, not stubbed now.

## Deployment note

`infra/supabase/003_care_and_sos.sql` must be applied in the Supabase SQL editor before the
action-plan, contacts and SOS endpoints can store anything; until then those calls fail
against a missing table rather than silently doing nothing.
