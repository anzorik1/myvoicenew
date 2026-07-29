import { init } from '@telegram-apps/sdk-react';

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe?: { start_param?: string; user?: { language_code?: string } };
        ready(): void;
        expand(): void;
        close(): void;
        BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
        HapticFeedback?: { notificationOccurred(type: 'success' | 'error' | 'warning'): void };
        openTelegramLink(url: string): void;
      };
    };
  }
}

export function initializeTelegram() {
  try {
    init();
  } catch {
    // The browser fallback page remains useful for admin and local layout work.
  }
  window.Telegram?.WebApp.ready();
  window.Telegram?.WebApp.expand();
}

export const telegramInitData = () => window.Telegram?.WebApp.initData ?? '';
export const hapticSuccess = () =>
  window.Telegram?.WebApp.HapticFeedback?.notificationOccurred('success');
