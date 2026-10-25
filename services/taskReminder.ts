import { settingsStorage } from './localPersistence';
export function playBatchReminder() {
  try {
    if (settingsStorage.getItem('rh_batch_reminder_enabled') !== 'true') return;
    const audioFile = settingsStorage.getItem('rh_batch_reminder_audio');
    if (audioFile) void new Audio(`/audio/${audioFile}`).play().catch(error => console.error('Failed to play completion reminder:', error));
  } catch (error) {
    console.error('Failed to play completion reminder:', error);
  }
}
