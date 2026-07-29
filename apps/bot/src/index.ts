import { Bot, InlineKeyboard } from 'grammy';
import Redis from 'ioredis';

const token = process.env.TELEGRAM_BOT_TOKEN;
const webAppUrl = process.env.WEB_APP_URL;
if (!token || !webAppUrl) {
  throw new Error('TELEGRAM_BOT_TOKEN and WEB_APP_URL are required');
}

const bot = new Bot(token);
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const appButton = (startParam?: string) => {
  const url = new URL(webAppUrl);
  if (startParam) url.searchParams.set('startapp', startParam);
  return new InlineKeyboard().webApp('Open MyVoice', url.toString());
};

bot.command('start', async (ctx) => {
  const raw = typeof ctx.match === 'string' ? ctx.match.trim() : '';
  const referral = /^ref_[A-Za-z0-9_-]{4,20}$/.test(raw) ? raw : undefined;
  if (referral && ctx.from) {
    await redis.set(`pending-ref:${ctx.from.id}`, referral, 'EX', 30 * 24 * 60 * 60);
  }
  const language = ctx.from?.language_code?.startsWith('ru') ? 'ru' : 'en';
  const text =
    language === 'ru'
      ? 'MyVoice — одно коллективное голосование в день. Участвуйте, поддерживайте рейтинг активности и получайте игровые баллы VOX.'
      : 'MyVoice is one collective vote a day. Participate, maintain your activity rating, and earn in-app VOX points.';
  await ctx.reply(text, { reply_markup: appButton(referral) });
});

bot.command('app', (ctx) => ctx.reply('MyVoice', { reply_markup: appButton() }));
bot.command('help', async (ctx) => {
  await ctx.reply(
    'Commands:\n/start — introduction\n/app — open MyVoice\n/terms — Terms of Use\n/privacy — Privacy Policy\n/help — this message',
  );
});
bot.command('terms', (ctx) =>
  ctx.reply('Terms of Use', {
    reply_markup: new InlineKeyboard().url('Read terms', `${webAppUrl}/terms`),
  }),
);
bot.command('privacy', (ctx) =>
  ctx.reply('Privacy Policy', {
    reply_markup: new InlineKeyboard().url('Read privacy policy', `${webAppUrl}/privacy`),
  }),
);

bot.catch((error) => console.error('Bot update failed', error.error));

await bot.api.setMyCommands([
  { command: 'start', description: 'Start MyVoice' },
  { command: 'app', description: 'Open Mini App' },
  { command: 'help', description: 'Help' },
  { command: 'terms', description: 'Terms of Use' },
  { command: 'privacy', description: 'Privacy Policy' },
]);
await bot.api.setChatMenuButton({
  menu_button: { type: 'web_app', text: 'MyVoice', web_app: { url: webAppUrl } },
});

process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());
void bot.start({ onStart: (info) => console.log(`@${info.username} is running`) });
