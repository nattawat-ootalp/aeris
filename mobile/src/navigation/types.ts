/** Route param lists for each stack + the root navigator (UX §4 Information Architecture). */
export type RootStackParamList = {
  Onboarding: undefined;
  Main: undefined;
  EmergencyBoundary: { severity: 'severe' } | undefined;
  /** SOS raised in-app, or forwarded from the portable's own button over BLE. */
  Sos: { source?: 'app' | 'portable'; deviceId?: string } | undefined;
};

export type HomeStackParamList = {
  Home: undefined;
  CurrentExposure: undefined;
  DataQuality: undefined;
  Notifications: undefined;
};

export type ExposureStackParamList = {
  ExposureTimeline: undefined;
  ExposureEventDetail: { eventId: string };
  DailySummary: undefined;
  SymptomEvent: undefined;
};

export type ExploreStackParamList = {
  ExploreMap: undefined;
  DestinationAssessment: { name: string; lat: number; lon: number };
  CompareLocations: undefined;
};

export type HistoryStackParamList = {
  WeeklyHistory: undefined;
  PersonalBaseline: undefined;
  PersonalPattern: undefined;
};

export type ProfileStackParamList = {
  ProfileSettings: undefined;
  SensorHealth: undefined;
  Privacy: undefined;
  PairSensor: undefined;
  Notifications: undefined;
  About: undefined;
  ActionPlan: undefined;
  EmergencyContacts: undefined;
};
