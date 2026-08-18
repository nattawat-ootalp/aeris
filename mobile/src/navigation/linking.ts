/**
 * Deep-link / URL map (web build + `aeris://` scheme).
 *
 * On web this is what turns the app into a real website: every screen gets its own address,
 * the browser Back button works, and a reloaded or shared URL lands on the same screen.
 *
 * `/` is deliberately UNMAPPED. The root stack decides between Onboarding and Main from the
 * stored onboarding flag (App.tsx); giving `/` a path would let linking win that race and
 * show Home to someone who has never been onboarded. With no path matching, React Navigation
 * falls back to `initialRouteName` — so the stored flag stays authoritative on a bare visit.
 *
 * Only https origins the host serves are valid prefixes on web, and the browser supplies
 * those from `window.location` — so the literal list here is the native scheme alone.
 */
import type { DocumentTitleOptions, LinkingOptions, Route } from '@react-navigation/native';
import type { RootStackParamList } from './types';

/** Browser tab / bookmark labels. React Navigation otherwise writes the raw route name
 *  ("ExposureEventDetail") into document.title, which is developer vocabulary, not a page
 *  title. Anything unlisted falls back to the plain product name. */
const DOCUMENT_TITLES: Record<string, string> = {
  Onboarding: 'ยินดีต้อนรับ',

  // The tab route itself can be what's focused (switching tabs, before the inner stack
  // settles), so each tab carries the title of the screen it opens on. Without these the
  // title falls back to a bare "Aeris" on every tab press.
  HomeTab: 'หน้าแรก',
  ExposureTab: 'ไทม์ไลน์การรับสัมผัส',
  ExploreTab: 'แผนที่',
  DashboardTab: 'จำลองการรับสัมผัส',
  HistoryTab: 'ประวัติรายสัปดาห์',
  ProfileTab: 'โปรไฟล์',

  Home: 'หน้าแรก',
  CurrentExposure: 'การรับสัมผัสตอนนี้',
  DataQuality: 'คุณภาพข้อมูล',
  Notifications: 'การแจ้งเตือน',
  ExposureTimeline: 'ไทม์ไลน์การรับสัมผัส',
  ExposureEventDetail: 'รายละเอียดเหตุการณ์',
  DailySummary: 'สรุปรายวัน',
  SymptomEvent: 'บันทึกอาการ',
  ExploreMap: 'แผนที่',
  DestinationAssessment: 'ประเมินปลายทาง',
  CompareLocations: 'เปรียบเทียบสถานที่',
  ExposureSimulator: 'จำลองการรับสัมผัสตามเส้นทาง',
  TimeMachine: 'ย้อนดูข้อมูลตามเวลา',
  WeeklyHistory: 'ประวัติรายสัปดาห์',
  PersonalBaseline: 'ค่าฐานส่วนบุคคล',
  PersonalPattern: 'รูปแบบส่วนบุคคล',
  ProfileSettings: 'โปรไฟล์',
  SensorHealth: 'สถานะเซนเซอร์',
  Privacy: 'ความเป็นส่วนตัว',
  PairSensor: 'จับคู่อุปกรณ์',
  ActionPlan: 'แผนรับมือ',
  EmergencyContacts: 'ผู้ติดต่อฉุกเฉิน',
  About: 'เกี่ยวกับ NextAir',
  Sos: 'SOS',
  EmergencyBoundary: 'ขอความช่วยเหลือฉุกเฉิน',
};

/** Browser tab title, driven by the focused route (web only; a no-op on device). */
export const documentTitle: DocumentTitleOptions = {
  formatter: (_options: object | undefined, route: Route<string> | undefined) => {
    const label = route?.name ? DOCUMENT_TITLES[route.name] : undefined;
    return label ? `${label} · NextAir` : 'NextAir';
  },
};

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['aeris://'],
  config: {
    screens: {
      Onboarding: 'welcome',
      Main: {
        screens: {
          HomeTab: {
            screens: {
              Home: 'home',
              CurrentExposure: 'home/current-exposure',
              DataQuality: 'home/data-quality',
              Notifications: 'home/notifications',
            },
          },
          ExposureTab: {
            screens: {
              ExposureTimeline: 'exposure',
              ExposureEventDetail: 'exposure/event/:eventId',
              DailySummary: 'exposure/daily',
              SymptomEvent: 'exposure/symptom',
            },
          },
          ExploreTab: {
            screens: {
              ExploreMap: 'explore',
              // lat/lon live in the PATH, not the query string, because the screen reads
              // `route.params` unguarded — a bare /explore/destination would have to match
              // and then crash on undefined params. With them required, it simply doesn't
              // match, and the container falls back to the initial route. `parse` restores
              // the numbers the screen's type expects; `name` rides along as a query param.
              DestinationAssessment: {
                path: 'explore/destination/:lat/:lon',
                parse: { lat: Number, lon: Number },
                stringify: { lat: String, lon: String },
              },
              CompareLocations: 'explore/compare',
            },
          },
          // Present in the URL map on every platform: the native build never mounts the tab
          // (MainTabs gates it), so these paths simply never match there, and keeping them
          // unconditional means one config rather than two that can drift.
          DashboardTab: {
            screens: {
              ExposureSimulator: 'analyse/simulator',
              TimeMachine: 'analyse/time-machine',
            },
          },
          HistoryTab: {
            screens: {
              WeeklyHistory: 'history',
              PersonalBaseline: 'history/baseline',
              PersonalPattern: 'history/pattern',
            },
          },
          ProfileTab: {
            screens: {
              ProfileSettings: 'profile',
              SensorHealth: 'profile/sensor-health',
              Privacy: 'profile/privacy',
              PairSensor: 'profile/pair-sensor',
              Notifications: 'profile/notifications',
              ActionPlan: 'profile/action-plan',
              EmergencyContacts: 'profile/emergency-contacts',
              About: 'profile/about',
            },
          },
        },
      },
      Sos: 'sos',
      EmergencyBoundary: 'emergency',
    },
  },
};
