

Aeris
Technical Design Document
Personal Environmental Exposure & Decision Support

ฉบับสำหรับการพัฒนาและทดสอบต้นแบบ
ปีการศึกษา 2569

สารบัญ

1. System Overview
Aeris เป็นระบบตรวจวัดและช่วยตัดสินใจด้านสภาพแวดล้อมสำหรับผู้ป่วยโรคหอบหืด ต่อจาก AirSentinel จาก area-level monitoring ไปสู่ individual exposure tracking ประกอบด้วย Station/Portable sensing และ Mobile/Smartwatch พร้อม Data Quality, Exposure Event, Personal Baseline, Pattern Detection, Decision Engine และ Explainability
1.1 Goals
วัดสภาพแวดล้อมใกล้ผู้ใช้
ประเมิน personal exposure ตามเวลาและบริบท
ตรวจคุณภาพข้อมูลก่อนใช้ decision
สร้าง baseline เมื่อมี sample เพียงพอ
แสดงผลที่อธิบายได้
1.2 Non-goals
ไม่วินิจฉัยโรค
ไม่ยืนยันสาเหตุของอาการ
ไม่รับประกันว่าจะไม่เกิด asthma attack
ไม่สั่งยาแทนแพทย์
ไม่แปลง association เป็น medical probability โดยไม่มี validation
2. Architecture
Layer
Component
Technology
หน้าที่
Portable
ESP32-S3 + PM + T/RH
BLE
personal exposure
Station
AirSentinel Node
Wi-Fi/MQTT
area context
IoT
AWS IoT Core
MQTT/TLS
messaging
Ingestion
Lambda/Kinesis
serverless
validate/ingest
API
FastAPI/Python
REST/WebSocket
บริการระบบ
Storage
InfluxDB + PostgreSQL
DB
time-series/relational
Intelligence
Quality/Exposure/Baseline/Pattern/Decision
Python
analysis
Client
Mobile/Watch
BLE/API
decision interface
2.1 Data Flow
Portable → BLE → Smartphone Gateway → Backend → Validation → Database → Exposure → Baseline → Pattern → Decision → Explainability → Mobile/Watch; Station → MQTT/TLS → Backend → Destination Assessment
3. Portable Hardware Design
Component
Technology
Reason
MCU
ESP32-S3
reuse + BLE/Wi-Fi/TinyML
PM
PMS7003-class
PM2.5/PM10
T/RH
SCD40-class
context/compensation
Display
OLED/e-paper/RGB
local status
Battery
Li-ion/LiPo
portable
Security
ATECC608A-class
device identity
Connectivity
BLE + Wi-Fi
phone/cloud
3.1 MVP Boundary
MVP ไม่ควรเพิ่ม GPS, SpO2, microphone, heart-rate sensor หรือ actuator ทางการแพทย์โดยไม่มี use case ที่พิสูจน์แล้ว เพราะเพิ่มต้นทุน พลังงาน ความซับซ้อน และ regulatory risk
3.2 Power Management
Deep sleep
Batch telemetry
Interval BLE
ลด Wi-Fi retries
แยก battery health จาก environmental status
4. Data Contract
{"schema_version":"1.0","device_id":"P001","timestamp":"2026-08-11T14:30:00Z","pm25":34.2,"temperature":31.2,"humidity":71.4,"battery":82,"sensor_status":"OK","quality_score":0.96}
4.1 Decision Event
{"decision":"CAUTION","confidence":"MEDIUM","reason_codes":["PM25_ABOVE_PERSONAL_BASELINE","PERSONAL_EXPOSURE_ELEVATED"]}
5. Algorithms
5.1 Data Quality
ตรวจ freshness, missing/impossible values, sensor status, warm-up และ spike ก่อนใช้ข้อมูล หาก PM sensor invalid ต้องไม่สร้าง PM-based caution
5.2 Environmental State
จัดสถานะเชิงวิศวกรรม เช่น NORMAL/CAUTION/HIGH โดย threshold ต้องทดสอบได้และไม่ควรเรียกว่า medical threshold
5.3 Exposure Aggregation
รวมค่าที่ valid ตามเวลาและบริบท เช่น PM2.5 + duration + event count เพื่อไม่ให้ค่าจุดเดียวถูกตีความเป็น exposure ทั้งช่วง
5.4 Personal Baseline
เมื่อ sample เพียงพอ สร้างช่วงอ้างอิงส่วนบุคคล เช่น median และ dispersion หากข้อมูลน้อยให้ insufficient sample และยังไม่ personalize
5.5 Pattern Detection
ตรวจ association ระหว่าง exposure กับ symptom events และรายงานเป็นรูปแบบที่ควรสังเกต ไม่ใช่สาเหตุ
5.6 Decision Engine
ถ้า quality ต่ำ → NO_DATA/UNKNOWN; ถ้าค่าสูงและ persistence ผ่านเกณฑ์ → CAUTION; ถ้าสูงกว่าฐานส่วนบุคคลและ duration เพิ่มขึ้น → เพิ่มเหตุผลประกอบ; ถ้าข้อมูลปลายทางเก่า → STALE/UNAVAILABLE
5.7 Persistence/Hysteresis/Cooldown
Persistence ลด spike
Hysteresis ลดการสลับสถานะ
Cooldown ลด alert fatigue
5.8 Explainability
ทุก decision ควรมี decision, confidence, reason_codes, freshness และ sample size ที่เกี่ยวข้อง
6. Destination Assessment
รับ destination → หา AirSentinel node ที่ valid/ใกล้ → ตรวจ distance, last_seen, sensor health → อ่าน current/trend → คำนวณ caution → ส่งผลพร้อมเหตุผลและ freshness หาก node offline/stale ต้องระบุ unavailable/stale
7. Mobile/Watch
Feature
Purpose
Priority
Current Environment
local + area
MVP
Destination Assessment
ปลายทาง
MVP
Symptom Event
บันทึกอาการ
MVP
Exposure History
ย้อนหลัง
Phase 2
Personal Pattern
association
Phase 3
Device Health
battery/sensor/firmware
MVP
Privacy Control
sync/share
MVP
Watch แสดง Normal/Caution/High/No Data และควรหลีกเลี่ยงคำว่า SAFE เพราะ low concern ไม่ได้หมายความว่าปลอดภัยทางการแพทย์
8. Backend & Database
ใช้ Modular Monolith + Serverless: Lambda/Kinesis สำหรับ ingestion/alert, FastAPI สำหรับ Core API, InfluxDB สำหรับ time-series และ PostgreSQL สำหรับ users, events, privacy และ decisions
Endpoint
Purpose
GET /nodes/{id}/telemetry
ล่าสุด
GET /nodes/{id}/history
ย้อนหลัง
GET /alerts
alerts
GET /dashboard/ranking
ranking
POST /nodes/{id}/threshold
threshold
WS /ws/realtime
real-time
Table
Purpose
devices
อุปกรณ์
exposure_events
exposure
symptom_events
อาการ
personal_baseline
baseline
patterns
patterns
decision_events
decisions
users/privacy
identity/permissions
9. Security, Privacy & Medical Safety
MQTT TLS
least privilege/RLS
location minimization
ไม่ส่ง symptom ไป public dashboard
encryption at rest/in transit
retention + ถอน sync
แยก device identity
CAN
MUST NOT
environmental caution
วินิจฉัยโรค
environmental trend
รับประกันไม่เกิด attack
symptom event
ยืนยันสาเหตุ
environment comparison
สั่งยา
historical association
medical probability โดยไม่มี validation
10. Testing & Validation
10.1 Unit Tests
parser/unit conversion
threshold
persistence
hysteresis
deduplication
freshness
comparison
baseline
privacy
10.2 Integration
Personal Device → MQTT/TLS → AWS IoT → Ingestion → DB → FastAPI → Mobile และ Station → MQTT/TLS → DB → Destination API → Personal Device
10.3 Fault Injection
Fault
Expected
Internet unavailable
local sensing/caution ทำงาน
Node offline
unavailable/stale
PM invalid
ไม่สร้าง PM caution
API timeout
ไม่ใช้ข้อมูลเก่าเป็น current
Rapid spike
persistence/hysteresis
Repeated event
cooldown
Battery low
device warning
10.4 Field Validation
เปรียบเทียบ personal device กับ reference/validated monitor ในสภาพเดียวกันเพื่อประเมิน bias, drift, repeatability และ response time
10.5 User Validation
เปรียบเทียบการตัดสินใจของผู้ใช้เมื่อดูค่า PM อย่างเดียวกับเมื่อใช้ Aeris และวัดความเข้าใจสถานะ เหตุผล freshness และข้อจำกัด
11. MVP Implementation Plan
Phase
Scope
Deliverable
MVP-1
Portable + local caution
hardware/firmware
MVP-2
AirSentinel integration
destination assessment
MVP-3
Event/exposure
data pipeline
MVP-4
Personal pattern
association + confidence
Research
Predictive modeling
เมื่อมีข้อมูลและ validation เพียงพอ
12. Technical Risks & Known Flaws
Risk
Impact
Mitigation
sensor error
High
calibration/reference
area ≠ personal
High
local + area
stale data
High
data-age contract
false alerts
Medium/High
persistence/hysteresis/cooldown
alert fatigue
High
group/escalate
small dataset
High
sample size + delay
privacy leakage
High
RLS/minimization
low concern ≠ safe
Critical
avoid SAFE wording
battery/size
Medium
limit sensors/optimize
medical overclaim
Critical
non-diagnostic + validation
13. Technology Stack
Layer
Technology
Portable
ESP32-S3 + PM + T/RH
Security
ATECC608A-class
IoT
MQTT 5.0/TLS
Cloud
AWS IoT Core
Ingestion
Lambda + Kinesis
API
FastAPI/Python 3.12
Time-series
InfluxDB 2.x
Relational
PostgreSQL 16
Mobile
React Native
Web
React 18/Mapbox/Recharts
Deployment
Docker/ECR/ECS Fargate
CI/CD
GitHub Actions
Monitoring
CloudWatch/Grafana
14. Engineering Acceptance Criteria
invalid sensor data ต้องไม่สร้าง decision ที่อาศัย sensor นั้น
stale data ต้องแสดง stale/unavailable
ทุก decision ต้องมีเหตุผล
ห้ามใช้ SAFE เป็นคำรับรองทางการแพทย์
Pattern ต้องแสดง sample size/uncertainty
AI accuracy ต้องมี test set และ metric
แยก environmental status, device health และ medical boundary
15. Conclusion
Aeris ถูกกำหนดให้เป็น personal environmental exposure และ decision-support system มากกว่า personal air monitor จุดเพิ่มคุณค่าคือการเชื่อม local exposure กับ area context, duration, personal baseline, data quality และ explainable decision แต่ข้ออ้างว่าให้คุณค่ามากกว่า personal monitor ยังต้องพิสูจน์ด้วย field validation และ user study
