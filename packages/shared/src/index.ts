export const SUPPORTED_LANGUAGES = ['en', 'ru'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const normalizeLanguage = (language?: string | null): Language =>
  language?.toLowerCase().startsWith('ru') ? 'ru' : 'en';

export const VOX_TRANSACTION_TYPES = [
  'SIGNUP_BONUS',
  'VOTE_REWARD',
  'REFERRAL_SIGNUP_REWARD',
  'REFERRAL_VOTE_REWARD',
  'EARLY_VOTE_BONUS',
  'WINNER_REWARD',
  'LOSER_REWARD',
  'ADMIN_ADJUSTMENT',
] as const;

export type PublicFeatures = {
  suggestions: boolean;
  earlyVoteBonus: boolean;
  predictionRewards: boolean;
  tonWallet: false;
};

export type TelegramUser = {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
  language_code?: string;
};
