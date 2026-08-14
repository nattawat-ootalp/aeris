/** Screen 06 — Exposure Event Detail. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text } from 'react-native';
import { InfoCard, MetaRow, PrimaryButton } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { colors, type } from '../../theme';
import type { ExposureStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ExposureStackParamList, 'ExposureEventDetail'>;

export function ExposureEventDetailScreen({ route }: Props) {
  return (
    <Screen title="09:40 – 10:05" subtitle="Commute">
      <InfoCard title="Environment">
        <MetaRow label="PM2.5" value="42 µg/m³" />
        <MetaRow label="PM10" value="58 µg/m³" />
        <MetaRow label="Temperature" value="31°C" />
        <MetaRow label="Humidity" value="70%" />
      </InfoCard>
      <InfoCard title="Context">
        <MetaRow label="Duration" value="25 min" />
        <MetaRow label="Trend" value="Rising then falling" />
      </InfoCard>
      <InfoCard title="Data Quality">
        <MetaRow label="Confidence" value="HIGH" />
      </InfoCard>
      <Text style={styles.eventId}>Event #{route.params.eventId}</Text>
      <PrimaryButton label="Add activity" onPress={() => {}} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  eventId: { ...type.caption, color: colors.textMuted },
});
