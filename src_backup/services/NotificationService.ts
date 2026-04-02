import notifee, {
  AndroidImportance,
  AndroidStyle,
  AuthorizationStatus,
} from '@notifee/react-native';
import { Reading } from '../types';

const CHANNEL_ID = 'glasses_readings';

export async function setupNotifications(): Promise<void> {
  const settings = await notifee.requestPermission();
  if (settings.authorizationStatus < AuthorizationStatus.AUTHORIZED) {
    console.warn('Notification permission denied');
  }

  await notifee.createChannel({
    id: CHANNEL_ID,
    name: 'Glasses Readings',
    importance: AndroidImportance.HIGH,
    sound: 'default',
  });
}

export async function showReadingNotification(reading: Reading): Promise<void> {
  const body = reading.isQuestion && reading.aiAnswer
    ? `Q: ${reading.cleanedText}\nA: ${reading.aiAnswer}`
    : reading.cleanedText;

  await notifee.displayNotification({
    title: 'Glasses Reading',
    body,
    android: {
      channelId: CHANNEL_ID,
      importance: AndroidImportance.HIGH,
      style: {
        type: AndroidStyle.BIGTEXT,
        text: body,
      },
      smallIcon: 'ic_notification',
    },
    ios: {
      sound: 'default',
    },
  });
}
