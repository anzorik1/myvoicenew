import { Bot, InlineKeyboard } from 'grammy';
import Redis from 'ioredis';

const token = process.env.TELEGRAM_BOT_TOKEN;
const webAppUrl = process.env.WEB_APP_URL;
if (!token || !webAppUrl) {
  throw new Error('TELEGRAM_BOT_TOKEN and WEB_APP_URL are required');
}

type Language = 'en' | 'ru';
type AppRoute = '/' | '/history' | '/rating' | '/referrals' | '/profile';

const copy = {
  en: {
    start:
      '<b>MyVoice</b> is a daily collective vote. Make your choice, keep your activity rating, and earn in-app VOX points.',
    app: '<b>MyVoice is ready.</b> Choose where you want to go:',
    help: '<b>How MyVoice works</b>\n\n1. Open the app and accept the documents.\n2. Vote once in each active poll.\n3. Earn VOX and keep your activity rating.\n4. Invite direct referrals and receive bonuses when your rating is at least 80%.\n\nVOX are in-app activity points. They are not cryptocurrency and cannot be withdrawn.',
    terms: 'Read the current MyVoice Terms of Use:',
    privacy: 'Read the current MyVoice Privacy Policy:',
    channelSoon: 'The official MyVoice channel will appear here soon.',
    buttons: {
      vote: 'Vote now',
      history: 'Results',
      rating: 'My rating',
      referrals: 'Invite friends',
      profile: 'Profile',
      channel: 'MyVoice channel',
      terms: 'Read terms',
      privacy: 'Read privacy policy',
    },
  },
  ru: {
    start:
      '<b>MyVoice</b> — ежедневное коллективное голосование. Делайте свой выбор, поддерживайте рейтинг активности и получайте игровые баллы VOX.',
    app: '<b>MyVoice готов.</b> Выберите нужный раздел:',
    help: '<b>Как работает MyVoice</b>\n\n1. Откройте приложение и примите документы.\n2. Голосуйте один раз в каждом активном опросе.\n3. Получайте VOX и поддерживайте рейтинг активности.\n4. Приглашайте прямых рефералов и получайте бонусы при рейтинге от 80%.\n\nVOX — внутренние баллы активности. Это не криптовалюта, их нельзя вывести.',
    terms: 'Актуальное пользовательское соглашение MyVoice:',
    privacy: 'Актуальная политика конфиденциальности MyVoice:',
    channelSoon: 'Официальный канал MyVoice скоро появится здесь.',
    buttons: {
      vote: 'Голосовать',
      history: 'Итоги',
      rating: 'Мой рейтинг',
      referrals: 'Пригласить друзей',
      profile: 'Профиль',
      channel: 'Канал MyVoice',
      terms: 'Открыть соглашение',
      privacy: 'Открыть политику',
    },
  },
} as const;

const bot = new Bot(token);
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const languageOf = (languageCode?: string): Language =>
  languageCode?.toLowerCase().startsWith('ru') ? 'ru' : 'en';

const configuredChannelUrl = process.env.TELEGRAM_CHANNEL_URL?.trim();
const channelUrl =
  configuredChannelUrl && /^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}$/.test(configuredChannelUrl)
    ? configuredChannelUrl
    : undefined;

const appUrl = (route: AppRoute = '/', startParam?: string) => {
  const url = new URL(route, webAppUrl.endsWith('/') ? webAppUrl : `${webAppUrl}/`);
  if (startParam) url.searchParams.set('startapp', startParam);
  return url.toString();
};

const appButton = (language: Language, route: AppRoute = '/', startParam?: string) =>
  new InlineKeyboard().webApp(copy[language].buttons.vote, appUrl(route, startParam));

const navigation = (language: Language, startParam?: string) => {
  const buttons = copy[language].buttons;
  const keyboard = new InlineKeyboard()
    .webApp(buttons.vote, appUrl('/', startParam))
    .webApp(buttons.history, appUrl('/history'))
    .row()
    .webApp(buttons.rating, appUrl('/rating'))
    .webApp(buttons.referrals, appUrl('/referrals'))
    .row()
    .webApp(buttons.profile, appUrl('/profile'));
  if (channelUrl) keyboard.url(buttons.channel, channelUrl);
  return keyboard;
};

bot.command('start', async (ctx) => {
  const raw = typeof ctx.match === 'string' ? ctx.match.trim() : '';
  const referral = /^ref_[A-Za-z0-9_-]{4,20}$/.test(raw) ? raw : undefined;
  if (referral && ctx.from) {
    await redis.set(`pending-ref:${ctx.from.id}`, referral, 'EX', 30 * 24 * 60 * 60);
  }
  const language = languageOf(ctx.from?.language_code);
  await ctx.reply(copy[language].start, {
    parse_mode: 'HTML',
    reply_markup: navigation(language, referral),
  });
});

bot.command('app', async (ctx) => {
  const language = languageOf(ctx.from?.language_code);
  await ctx.reply(copy[language].app, {
    parse_mode: 'HTML',
    reply_markup: navigation(language),
  });
});

bot.command('today', async (ctx) => {
  const language = languageOf(ctx.from?.language_code);
  await ctx.reply(copy[language].start, {
    parse_mode: 'HTML',
    reply_markup: appButton(language),
  });
});

bot.command('history', async (ctx) => {
  const language = languageOf(ctx.from?.language_code);
  await ctx.reply(copy[language].app, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().webApp(copy[language].buttons.history, appUrl('/history')),
  });
});

bot.command('rating', async (ctx) => {
  const language = languageOf(ctx.from?.language_code);
  await ctx.reply(copy[language].app, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().webApp(copy[language].buttons.rating, appUrl('/rating')),
  });
});

bot.command('referrals', async (ctx) => {
  const language = languageOf(ctx.from?.language_code);
  await ctx.reply(copy[language].app, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().webApp(
      copy[language].buttons.referrals,
      appUrl('/referrals'),
    ),
  });
});

bot.command('channel', async (ctx) => {
  const language = languageOf(ctx.from?.language_code);
  if (!channelUrl) {
    await ctx.reply(copy[language].channelSoon);
    return;
  }
  await ctx.reply(copy[language].buttons.channel, {
    reply_markup: new InlineKeyboard().url(copy[language].buttons.channel, channelUrl),
  });
});

bot.command('help', async (ctx) => {
  const language = languageOf(ctx.from?.language_code);
  await ctx.reply(copy[language].help, {
    parse_mode: 'HTML',
    reply_markup: navigation(language),
  });
});

bot.command('terms', async (ctx) => {
  const language = languageOf(ctx.from?.language_code);
  await ctx.reply(copy[language].terms, {
    reply_markup: new InlineKeyboard().url(
      copy[language].buttons.terms,
      new URL('/terms', webAppUrl).toString(),
    ),
  });
});

bot.command('privacy', async (ctx) => {
  const language = languageOf(ctx.from?.language_code);
  await ctx.reply(copy[language].privacy, {
    reply_markup: new InlineKeyboard().url(
      copy[language].buttons.privacy,
      new URL('/privacy', webAppUrl).toString(),
    ),
  });
});

bot.catch((error) => console.error('Bot update failed', error.error));

const englishCommands = [
  { command: 'start', description: 'Start MyVoice' },
  { command: 'today', description: "Open today's vote" },
  { command: 'history', description: 'View completed votes' },
  { command: 'rating', description: 'View activity rating' },
  { command: 'referrals', description: 'Invite friends' },
  { command: 'app', description: 'Open all app sections' },
  { command: 'channel', description: 'Open the MyVoice channel' },
  { command: 'help', description: 'How MyVoice works' },
  { command: 'terms', description: 'Terms of Use' },
  { command: 'privacy', description: 'Privacy Policy' },
];
const russianCommands = [
  { command: 'start', description: 'Запустить MyVoice' },
  { command: 'today', description: 'Открыть голосование дня' },
  { command: 'history', description: 'Посмотреть завершённые голосования' },
  { command: 'rating', description: 'Посмотреть рейтинг активности' },
  { command: 'referrals', description: 'Пригласить друзей' },
  { command: 'app', description: 'Открыть все разделы приложения' },
  { command: 'channel', description: 'Открыть канал MyVoice' },
  { command: 'help', description: 'Как работает MyVoice' },
  { command: 'terms', description: 'Пользовательское соглашение' },
  { command: 'privacy', description: 'Политика конфиденциальности' },
];

await bot.api.setMyCommands(englishCommands);
await bot.api.setMyCommands(russianCommands, { language_code: 'ru' });
await bot.api.setMyDescription(
  'Daily collective votes, activity rating, referrals, and in-app VOX points.',
);
await bot.api.setMyDescription(
  'Ежедневные коллективные голосования, рейтинг активности, рефералы и игровые баллы VOX.',
  { language_code: 'ru' },
);
await bot.api.setMyShortDescription('Make your choice. Every voice matters.');
await bot.api.setMyShortDescription('Делайте свой выбор. Каждый голос важен.', {
  language_code: 'ru',
});
await bot.api.setChatMenuButton({
  menu_button: { type: 'web_app', text: 'MyVoice', web_app: { url: appUrl() } },
});

process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());
void bot.start({ onStart: (info) => console.log(`@${info.username} is running`) });
