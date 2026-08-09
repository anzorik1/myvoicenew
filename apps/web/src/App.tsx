import { FormEvent, ReactNode, useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Check,
  Clock3,
  Copy,
  History as HistoryIcon,
  Home as HomeIcon,
  Languages,
  Lightbulb,
  ShieldCheck,
  Send,
  UserRound,
  UsersRound,
  Vote as VoteIcon,
  WalletCards,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, clearAdminToken, hasAdminToken, setAccessToken, setAdminToken } from './api';
import { hapticSuccess, telegramInitData } from './telegram';
import styles from './App.module.css';

type Me = {
  firstName: string;
  lastName?: string;
  username?: string;
  language: 'en' | 'ru';
  registeredAt: string;
  registrationComplete: boolean;
  balance: number;
  ownVotes: number;
  eligibleVotes: number;
  participatedVotes: number;
  activityRate: number;
  referralCount: number;
  referralProgramActive: boolean;
  consent?: { termsVersion: string; privacyVersion: string };
};
type Vote = {
  id: string;
  status: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  completedAt?: string;
  imageUrl?: string;
  options: { id: string; position: number; text: string; count?: number; percent?: number }[];
  hasVoted: boolean;
  selectedOptionId?: string;
  rewardState?: string;
  userReward?: number;
  participantCount?: number;
  resultStatus?: 'TIE' | 'OPTION_WIN';
  winnerOptionId?: string;
};
type Features = {
  suggestions: boolean;
  earlyVoteBonus: boolean;
  predictionRewards: boolean;
  tonWallet: false;
};

const dateTime = (value: string, language: string) =>
  new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

function ErrorState({ error }: { error: unknown }) {
  const { t } = useTranslation();
  return (
    <div className={styles.empty}>
      <strong>{t('common.error')}</strong>
      <span>{error instanceof Error ? error.message : String(error)}</span>
    </div>
  );
}

function Countdown({ end }: { end: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((new Date(end).getTime() - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return (
    <span className={styles.countdown}>
      <Clock3 size={16} aria-hidden />
      {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:
      {String(secs).padStart(2, '0')}
    </span>
  );
}

function Gauge({ rate }: { rate: number }) {
  const { t } = useTranslation();
  const bounded = Math.max(0, Math.min(100, rate));
  return (
    <div className={styles.gaugeWrap}>
      <div
        className={styles.gauge}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={bounded}
        aria-label={t('home.activity')}
        style={{ '--rate': `${bounded * 1.8}deg` } as React.CSSProperties}
      >
        <div className={styles.gaugeInner}>
          <strong>{Math.round(bounded)}%</strong>
          <span>{t('home.activity')}</span>
        </div>
      </div>
    </div>
  );
}

function BackButton() {
  const navigate = useNavigate();
  useEffect(() => {
    const back = window.Telegram?.WebApp.BackButton;
    const handler = () => navigate(-1);
    back?.show();
    back?.onClick(handler);
    return () => {
      back?.offClick(handler);
      back?.hide();
    };
  }, [navigate]);
  return (
    <button className={styles.iconButton} onClick={() => navigate(-1)} aria-label="Back">
      <ArrowLeft />
    </button>
  );
}

function Shell({ children, features }: { children: ReactNode; features: Features }) {
  const { t } = useTranslation();
  const links = [
    ['/', HomeIcon, t('nav.home')],
    ['/history', HistoryIcon, t('nav.history')],
    ['/referrals', UsersRound, t('nav.referrals')],
    ['/rating', BarChart3, t('nav.rating')],
    ['/profile', UserRound, t('nav.profile')],
  ] as const;
  return (
    <div className={styles.app}>
      <main className={styles.main}>{children}</main>
      <nav className={styles.nav} aria-label="Main navigation">
        {links.map(([to, Icon, label]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? styles.activeNav : '')}>
            <Icon size={21} strokeWidth={isActiveStroke(to)} />
            <span>{label}</span>
          </NavLink>
        ))}
        {features.suggestions && (
          <NavLink to="/suggest" className={({ isActive }) => (isActive ? styles.activeNav : '')}>
            <Lightbulb size={21} />
            <span>{t('nav.suggest')}</span>
          </NavLink>
        )}
      </nav>
    </div>
  );
}

const isActiveStroke = (_to: string) => 2.1;

function Consent({ onDone, signupReward }: { onDone: () => void; signupReward: number }) {
  const { t } = useTranslation();
  const [checked, setChecked] = useState(false);
  const mutation = useMutation({
    mutationFn: () =>
      api('/me/consents', {
        method: 'POST',
        body: JSON.stringify({
          termsAccepted: true,
          privacyAccepted: true,
          termsVersion: '1.0',
          privacyVersion: '1.0',
        }),
      }),
    onSuccess: onDone,
  });
  return (
    <div className={styles.onboarding}>
      <div className={styles.brandMark}>MV</div>
      <h1>MyVoice</h1>
      <p>One thoughtful choice a day. A transparent record of collective opinion.</p>
      <div className={styles.documentLinks}>
        <a href="/terms" target="_blank">{t('auth.terms')} · v1.0</a>
        <a href="/privacy" target="_blank">{t('auth.privacy')} · v1.0</a>
      </div>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
        <span>{t('auth.accept')}</span>
      </label>
      <button className={styles.primary} disabled={!checked || mutation.isPending} onClick={() => mutation.mutate()}>
        {mutation.isPending ? t('common.loading') : t('auth.continue', { amount: signupReward })}
      </button>
      {mutation.error && <ErrorState error={mutation.error} />}
    </div>
  );
}

function Home({ me }: { me: Me }) {
  const { t, i18n } = useTranslation();
  const current = useQuery({ queryKey: ['current-vote'], queryFn: () => api<Vote | null>('/votes/current') });
  return (
    <div className={styles.stack}>
      <header className={styles.hero}>
        <span className={styles.eyebrow}>{t('home.hello', { name: me.firstName })}</span>
        <div className={styles.balanceRow}>
          <div>
            <small>{t('home.balance')}</small>
            <strong>{me.balance.toLocaleString(i18n.language)}</strong>
          </div>
          <div className={styles.voxCoin}>V</div>
        </div>
        <div className={styles.statusPill} data-active={me.referralProgramActive}>
          <Activity size={16} />
          {me.referralProgramActive ? t('home.referralOn') : t('home.referralOff')}
        </div>
      </header>

      <section className={styles.voteSpotlight}>
        <div className={styles.sectionHeading}>
          <span>{t('home.todayVote')}</span>
          {current.data && <Countdown end={current.data.endsAt} />}
        </div>
        {current.isLoading && <div className={styles.skeleton} />}
        {current.error && <ErrorState error={current.error} />}
        {current.data === null && <div className={styles.empty}>{t('home.noVote')}</div>}
        {current.data && (
          <>
            <div className={styles.voteSymbol}><VoteIcon size={30} /></div>
            <h2>{current.data.title}</h2>
            <p>{current.data.description}</p>
            <NavLink className={styles.primary} to={`/votes/${current.data.id}`}>
              {current.data.hasVoted ? t('vote.success') : t('home.openVote')}
            </NavLink>
          </>
        )}
      </section>

      <section>
        <div className={styles.sectionHeading}><span>{t('home.stats')}</span></div>
        <div className={styles.statGrid}>
          <div className={styles.card}><Gauge rate={me.activityRate} /></div>
          <div className={styles.card}>
            <div className={styles.miniStat}><VoteIcon /><strong>{me.ownVotes}</strong><span>{t('home.votes')}</span></div>
            <div className={styles.miniStat}><UsersRound /><strong>{me.referralCount}</strong><span>{t('home.referrals')}</span></div>
          </div>
        </div>
      </section>
    </div>
  );
}

function VotePage() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const vote = useQuery({ queryKey: ['vote', id], queryFn: () => api<Vote>(`/votes/${id}`) });
  const [chosen, setChosen] = useState<{ id: string; text: string } | null>(null);
  const cast = useMutation({
    mutationFn: (optionId: string) =>
      api<{ reward: number }>(`/votes/${id}/cast`, {
        method: 'POST',
        body: JSON.stringify({ optionId, idempotencyKey: crypto.randomUUID() }),
      }),
    onSuccess: () => {
      hapticSuccess();
      setChosen(null);
      void queryClient.invalidateQueries({ queryKey: ['vote', id] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      void queryClient.invalidateQueries({ queryKey: ['current-vote'] });
    },
  });
  if (vote.isLoading) return <div className={styles.page}><BackButton /><div className={styles.skeleton} /></div>;
  if (vote.error || !vote.data) return <div className={styles.page}><BackButton /><ErrorState error={vote.error} /></div>;
  const item = vote.data;
  return (
    <div className={`${styles.page} ${styles.stack}`}>
      <BackButton />
      {item.imageUrl && <img className={styles.voteImage} src={item.imageUrl} alt="" />}
      <div>
        <span className={styles.eyebrow}>{t('vote.ends', { date: dateTime(item.endsAt, i18n.language) })}</span>
        <h1>{item.title}</h1>
        <p className={styles.longCopy}>{item.description}</p>
      </div>
      <Countdown end={item.endsAt} />
      {item.hasVoted || cast.isSuccess ? (
        <div className={styles.successCard}>
          <Check size={32} />
          <strong>{t('vote.success')}</strong>
          <span>{cast.data ? t('vote.reward', { amount: cast.data.reward }) : t('vote.hidden')}</span>
        </div>
      ) : (
        <div className={styles.optionStack}>
          {item.options.map((option) => (
            <button key={option.id} className={styles.option} onClick={() => setChosen(option)}>
              <span>{option.position}</span>{option.text}
            </button>
          ))}
          <small className={styles.warning}>{t('vote.cannotChange')}</small>
        </div>
      )}
      {cast.error && <ErrorState error={cast.error} />}
      {chosen && (
        <div className={styles.modalBackdrop} role="presentation" onClick={() => setChosen(null)}>
          <div className={styles.modal} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h2>{t('vote.confirmTitle')}</h2>
            <p>{t('vote.confirmText', { option: chosen.text })}</p>
            <button className={styles.primary} disabled={cast.isPending} onClick={() => cast.mutate(chosen.id)}>{t('vote.confirm')}</button>
            <button className={styles.secondary} onClick={() => setChosen(null)}>{t('vote.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryPage() {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<'all' | 'participated' | 'missed'>('all');
  const [cursor, setCursor] = useState<string | undefined>();
  const [items, setItems] = useState<Vote[]>([]);
  const history = useQuery({
    queryKey: ['history', filter, cursor],
    queryFn: () => api<{ items: Vote[]; nextCursor?: string }>(`/votes/history?filter=${filter}${cursor ? `&cursor=${cursor}` : ''}`),
  });
  useEffect(() => {
    if (history.data) setItems((old) => (cursor ? [...old, ...history.data.items] : history.data.items));
  }, [history.data, cursor]);
  const change = (value: typeof filter) => { setItems([]); setCursor(undefined); setFilter(value); };
  return (
    <div className={`${styles.page} ${styles.stack}`}>
      <h1>{t('history.title')}</h1>
      <div className={styles.segmented}>
        {(['all', 'participated', 'missed'] as const).map((value) => (
          <button key={value} data-active={filter === value} onClick={() => change(value)}>{t(`common.${value}`)}</button>
        ))}
      </div>
      {items.map((vote) => (
        <NavLink to={`/results/${vote.id}`} key={vote.id} className={styles.historyCard}>
          <small>{dateTime(vote.completedAt ?? vote.endsAt, i18n.language)}</small>
          <h2>{vote.title}</h2>
          <div className={styles.resultBars}>
            {vote.options.map((option) => (
              <div key={option.id}>
                <span>{option.text}</span><strong>{option.percent}%</strong>
                <i style={{ width: `${option.percent}%` }} />
              </div>
            ))}
          </div>
          <span className={styles.participation}>{vote.hasVoted ? `${t('history.yourChoice')}: ${vote.options.find((x) => x.id === vote.selectedOptionId)?.text}` : t('history.didNotVote')}</span>
        </NavLink>
      ))}
      {!history.isLoading && items.length === 0 && <div className={styles.empty}>{t('history.empty')}</div>}
      {history.error && <ErrorState error={history.error} />}
      {history.data?.nextCursor && <button className={styles.secondary} onClick={() => setCursor(history.data?.nextCursor)}>Load more</button>}
    </div>
  );
}

function ResultPage() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation();
  const result = useQuery({ queryKey: ['result', id], queryFn: () => api<Vote>(`/votes/${id}/result`) });
  if (!result.data) return <div className={styles.page}><BackButton />{result.error ? <ErrorState error={result.error} /> : <div className={styles.skeleton} />}</div>;
  const vote = result.data;
  return (
    <div className={`${styles.page} ${styles.stack}`}>
      <BackButton />
      <span className={styles.eyebrow}>{dateTime(vote.completedAt ?? vote.endsAt, i18n.language)}</span>
      <h1>{vote.title}</h1>
      <div className={styles.resultHero}>
        <VoteIcon />
        <strong>{vote.resultStatus === 'TIE' ? t('vote.tie') : `${t('history.winner')}: ${vote.options.find((x) => x.id === vote.winnerOptionId)?.text}`}</strong>
        <span>{t('vote.participants', { count: vote.participantCount })}</span>
      </div>
      <div className={styles.resultBars}>
        {vote.options.map((option) => (
          <div key={option.id}><span>{option.text}</span><strong>{option.count} · {option.percent}%</strong><i style={{ width: `${option.percent}%` }} /></div>
        ))}
      </div>
      <div className={styles.card}>{vote.hasVoted ? `${t('history.yourChoice')}: ${vote.options.find((x) => x.id === vote.selectedOptionId)?.text} · +${vote.userReward ?? 0} VOX` : t('history.didNotVote')}</div>
    </div>
  );
}

function ReferralsPage({ minimumActivity }: { minimumActivity: number }) {
  const { t } = useTranslation();
  const referrals = useQuery({ queryKey: ['referrals'], queryFn: () => api<{ link: string; registered: number; active: number; earned: number; programActive: boolean }>('/me/referrals') });
  if (!referrals.data) return <div className={styles.page}>{referrals.error ? <ErrorState error={referrals.error} /> : <div className={styles.skeleton} />}</div>;
  const data = referrals.data;
  const share = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(data.link)}&text=${encodeURIComponent('Join me in MyVoice')}`;
    if (window.Telegram?.WebApp) window.Telegram.WebApp.openTelegramLink(url);
    else window.open(url, '_blank');
  };
  return (
    <div className={`${styles.page} ${styles.stack}`}>
      <h1>{t('referrals.title')}</h1>
      <p>{t('referrals.description', { minimum: minimumActivity })}</p>
      <div className={styles.referralLink}><code>{data.link}</code><button onClick={() => navigator.clipboard.writeText(data.link)} aria-label={t('common.copy')}><Copy /></button></div>
      <button className={styles.primary} onClick={share}><Send size={18} />{t('common.share')}</button>
      <div className={styles.metricGrid}>
        <div><strong>{data.registered}</strong><span>{t('referrals.registered')}</span></div>
        <div><strong>{data.active}</strong><span>{t('referrals.active')}</span></div>
        <div><strong>{data.earned}</strong><span>{t('referrals.earned')}</span></div>
      </div>
      <div className={styles.statusPanel} data-active={data.programActive}><Activity />{data.programActive ? t('referrals.programOn') : t('referrals.programOff')}</div>
    </div>
  );
}

function RatingPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const activity = useQuery({ queryKey: ['activity'], queryFn: () => api<{ rate: number; participated: number; missed: number; referralProgramActive: boolean }>('/me/activity') });
  const data = activity.data ?? { rate: me.activityRate, participated: me.participatedVotes, missed: Math.max(0, me.eligibleVotes - me.participatedVotes), referralProgramActive: me.referralProgramActive };
  return (
    <div className={`${styles.page} ${styles.stack}`}>
      <h1>{t('rating.title')}</h1>
      <div className={styles.bigGauge}><Gauge rate={data.rate} /></div>
      <div className={styles.statusPanel} data-active={data.referralProgramActive}>{data.referralProgramActive ? t('rating.on') : t('rating.off')}</div>
      <div className={styles.metricGrid}><div><strong>{data.participated}</strong><span>{t('rating.participated')}</span></div><div><strong>{data.missed}</strong><span>{t('rating.missed')}</span></div></div>
      <p className={styles.muted}>{t('rating.explain')}</p>
    </div>
  );
}

function ProfilePage({ me }: { me: Me }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const language = useMutation({
    mutationFn: (value: 'en' | 'ru') => api('/me/language', { method: 'PATCH', body: JSON.stringify({ language: value }) }),
    onSuccess: (_, value) => { void i18n.changeLanguage(value); void client.invalidateQueries({ queryKey: ['me'] }); },
  });
  return (
    <div className={`${styles.page} ${styles.stack}`}>
      <div className={styles.profileHero}><div className={styles.avatar}>{me.firstName[0]}</div><div><h1>{me.firstName} {me.lastName}</h1><span>{me.username ? `@${me.username}` : 'Telegram user'}</span></div></div>
      <div className={styles.profileList}>
        <div><WalletCards /><span>VOX</span><strong>{me.balance}</strong></div>
        <div><VoteIcon /><span>{t('home.votes')}</span><strong>{me.ownVotes}</strong></div>
        <div><Activity /><span>{t('home.activity')}</span><strong>{me.activityRate}%</strong></div>
        <div><UsersRound /><span>{t('home.referrals')}</span><strong>{me.referralCount}</strong></div>
        <div><Clock3 /><span>{t('profile.memberSince')}</span><strong>{dateTime(me.registeredAt, i18n.language)}</strong></div>
      </div>
      <label className={styles.field}><Languages /><span>{t('profile.language')}</span><select value={me.language} onChange={(event) => language.mutate(event.target.value as 'en' | 'ru')}><option value="en">{t('profile.english')}</option><option value="ru">{t('profile.russian')}</option></select></label>
      <div className={styles.card}><strong>{t('profile.documents')}</strong><span>{t('auth.terms')} v{me.consent?.termsVersion} · {t('auth.privacy')} v{me.consent?.privacyVersion}</span></div>
    </div>
  );
}

function SuggestPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const submit = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const data = new FormData(form);
      return api('/suggestions', { method: 'POST', body: JSON.stringify({ language: me.language, title: data.get('title'), description: data.get('description'), optionOne: data.get('optionOne'), optionTwo: data.get('optionTwo') }) });
    },
    onSuccess: () => setSent(true),
  });
  const onSubmit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); submit.mutate(event.currentTarget); };
  return <div className={`${styles.page} ${styles.stack}`}><h1>{t('suggest.title')}</h1><p>{t('suggest.description')}</p>{sent ? <div className={styles.successCard}><Check />{t('suggest.sent')}</div> : <form className={styles.form} onSubmit={onSubmit}><label>Title<input required minLength={10} maxLength={240} name="title" /></label><label>{t('suggest.voteDescription')}<textarea required minLength={30} maxLength={3000} name="description" /></label><label>{t('suggest.optionOne')}<input required maxLength={160} name="optionOne" /></label><label>{t('suggest.optionTwo')}<input required maxLength={160} name="optionTwo" /></label><button className={styles.primary}>{t('suggest.send')}</button></form>}{submit.error && <ErrorState error={submit.error} />}</div>;
}

function Legal({ type }: { type: 'terms' | 'privacy' }) {
  const russian = navigator.language.startsWith('ru');
  return <article className={styles.legal}><h1>{type === 'terms' ? (russian ? 'Пользовательское соглашение' : 'Terms of Use') : (russian ? 'Политика конфиденциальности' : 'Privacy Policy')}</h1><small>Version 1.0 · 2026-07-28</small><p>{russian ? 'MyVoice — сервис ежедневных коллективных голосований. VOX являются только игровыми баллами, не имеют денежной стоимости и не подлежат выводу или обмену.' : 'MyVoice is a daily collective voting service. VOX are in-app activity points only; they have no monetary value and cannot be withdrawn or exchanged.'}</p><h2>{russian ? 'Данные и использование' : 'Data and use'}</h2><p>{russian ? 'Мы обрабатываем данные профиля Telegram, голоса, активность, реферальные связи и технические журналы для работы сервиса, защиты от злоупотреблений и агрегированных результатов.' : 'We process Telegram profile data, votes, activity, referral relationships, and technical logs to operate the service, prevent abuse, and publish aggregate results.'}</p><p>{russian ? 'Выбор в голосовании нельзя изменить. Индивидуальный выбор не публикуется другим пользователям. Администраторы не могут изменять отданные голоса или удалять журнал VOX.' : 'A submitted choice cannot be changed. Individual choices are not published to other users. Administrators cannot alter submitted votes or erase the VOX ledger.'}</p></article>;
}

function AdminApp() {
  const [, refresh] = useState(0);
  const [error, setError] = useState('');
  if (!hasAdminToken()) {
    const login = async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      try {
        const result = await api<{ accessToken: string }>('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: data.get('email'), password: data.get('password') }) });
        setAdminToken(result.accessToken); refresh((x) => x + 1);
      } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    };
    return <div className={styles.adminLogin}><form className={styles.form} onSubmit={login}><div className={styles.brandMark}>MV</div><h1>MyVoice Admin</h1><label>Email<input type="email" name="email" required /></label><label>Password<input type="password" name="password" required /></label><button className={styles.primary}>Sign in</button>{error && <span className={styles.errorText}>{error}</span>}</form></div>;
  }
  return <AdminDashboard />;
}

function AdminDashboard() {
  const [tab, setTab] = useState<'metrics' | 'users' | 'votes' | 'suggestions' | 'security'>('metrics');
  const metrics = useQuery({ queryKey: ['admin-metrics'], queryFn: () => api<Record<string, number>>('/admin/metrics', {}, true) });
  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => api<{ items: Array<Record<string, any>> }>('/admin/users', {}, true) });
  const votes = useQuery({ queryKey: ['admin-votes'], queryFn: () => api<any[]>('/admin/votes', {}, true) });
  const suggestions = useQuery({ queryKey: ['admin-suggestions'], queryFn: () => api<any[]>('/admin/suggestions', {}, true) });
  const labels: Record<string, string> = { totalUsers: 'Registered users', active1d: 'Active · 24h', active7d: 'Active · 7 days', active30d: 'Active · 30 days', currentVoteParticipants: 'Current participants', currentParticipationPercent: 'Participation %', activityAtLeast80: 'Activity ≥ 80%', referrals: 'Referrals', voxAwarded: 'VOX awarded', blocked: 'Blocked' };
  return <div className={styles.admin}><aside><h1>MyVoice</h1>{(['metrics', 'users', 'votes', 'suggestions', 'security'] as const).map((value) => <button data-active={tab === value} onClick={() => setTab(value)} key={value}>{value}</button>)}</aside><main><header><span>Administration</span><strong>Secure console</strong></header>{tab === 'metrics' && <div className={styles.adminGrid}>{Object.entries(metrics.data ?? {}).map(([key, value]) => <div key={key}><span>{labels[key] ?? key}</span><strong>{value.toLocaleString()}</strong></div>)}</div>}{tab === 'users' && <div className={styles.adminTable}>{users.data?.items.map((user) => <div key={user.id}><span>{user.firstName}<small>@{user.username ?? '—'}</small></span><code>{user.telegramId}</code><strong>{user.voxBalance} VOX</strong><span>{Number(user.activityRate)}%</span><em>{user.status}</em></div>)}</div>}{tab === 'votes' && <><VoteComposer onSaved={() => void votes.refetch()} /><div className={styles.adminTable}>{votes.data?.map((vote) => <div key={vote.id}><span>{vote.translations.find((x: any) => x.language === 'en')?.title}<small>{new Date(vote.startsAt).toLocaleString()}</small></span><em>{vote.status}</em><strong>{vote.participantCount} votes</strong></div>)}</div></>}{tab === 'suggestions' && <div className={styles.adminTable}>{suggestions.data?.map((item) => <div key={item.id}><span>{item.translations[0]?.title}<small>{item.user.firstName}</small></span><em>{item.status}</em></div>)}{!suggestions.data?.length && <div className={styles.adminEmpty}>No suggestions yet.</div>}</div>}{tab === 'security' && <SecurityPanel />}</main></div>;
}

function SecurityPanel() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const data = new FormData(event.currentTarget);
    const currentPassword = String(data.get('currentPassword') ?? '');
    const newPassword = String(data.get('newPassword') ?? '');
    const confirmation = String(data.get('confirmation') ?? '');
    if (newPassword !== confirmation) {
      setError('New password and confirmation do not match.');
      return;
    }
    setSaving(true);
    try {
      await api('/admin/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      }, true);
      clearAdminToken();
      window.location.replace('/admin');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSaving(false);
    }
  };
  return <section className={styles.securityPanel}><div className={styles.securityIntro}><span className={styles.securityIcon}><ShieldCheck /></span><div><small>Permanent admin address</small><code>{window.location.origin}/admin</code></div><strong><Check size={16} />HTTPS active</strong></div><div className={styles.securityContent}><div><p className={styles.eyebrow}>Access credentials</p><h2>Change administrator password</h2><p>Use a password created only for MyVoice. After the change, this browser signs out so you can verify the new password immediately.</p></div><form className={`${styles.form} ${styles.securityForm}`} onSubmit={changePassword}><label>Current password<input type="password" name="currentPassword" autoComplete="current-password" required minLength={8} maxLength={200} /></label><label>New password<input type="password" name="newPassword" autoComplete="new-password" required minLength={12} maxLength={128} /></label><label>Confirm new password<input type="password" name="confirmation" autoComplete="new-password" required minLength={12} maxLength={128} /></label><p className={styles.securityHint}>At least 12 characters with uppercase, lowercase, a number, and a symbol.</p>{error && <span className={styles.errorText} role="alert">{error}</span>}<button className={styles.primary} disabled={saving}>{saving ? 'Changing password…' : 'Change password and sign out'}</button></form></div></section>;
}

function VoteComposer({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try {
      const vote = await api<{ id: string }>('/admin/votes', { method: 'POST', body: JSON.stringify({ startsAt: new Date(String(data.get('startsAt'))).toISOString(), endsAt: new Date(String(data.get('endsAt'))).toISOString(), translations: [{ language: 'en', title: data.get('titleEn'), description: data.get('descriptionEn') }, { language: 'ru', title: data.get('titleRu'), description: data.get('descriptionRu') }], options: [{ position: 1, translations: [{ language: 'en', text: data.get('oneEn') }, { language: 'ru', text: data.get('oneRu') }] }, { position: 2, translations: [{ language: 'en', text: data.get('twoEn') }, { language: 'ru', text: data.get('twoRu') }] }] }) }, true);
      await api(`/admin/votes/${vote.id}/schedule`, { method: 'POST' }, true); setMessage('Vote scheduled'); setOpen(false); onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  return <section className={styles.composer}><button className={styles.primary} onClick={() => setOpen(!open)}>Create vote</button>{message && <span>{message}</span>}{open && <form className={styles.form} onSubmit={save}><div className={styles.twoCols}><label>Starts (local)<input type="datetime-local" name="startsAt" required /></label><label>Ends (local)<input type="datetime-local" name="endsAt" required /></label></div><label>English title<input name="titleEn" required /></label><label>English description<textarea name="descriptionEn" required /></label><div className={styles.twoCols}><label>Option 1<input name="oneEn" required /></label><label>Option 2<input name="twoEn" required /></label></div><label>Русский заголовок<input name="titleRu" required /></label><label>Русское описание<textarea name="descriptionRu" required /></label><div className={styles.twoCols}><label>Вариант 1<input name="oneRu" required /></label><label>Вариант 2<input name="twoRu" required /></label></div><button className={styles.primary}>Create and schedule</button></form>}</section>;
}

function UserApp() {
  const { i18n, t } = useTranslation();
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState('');
  const queryClient = useQueryClient();
  const initData = telegramInitData();
  useEffect(() => {
    if (!initData) return;
    api<{ accessToken: string; language: string }>('/auth/telegram', { method: 'POST', body: JSON.stringify({ initData }) })
      .then((data) => { setAccessToken(data.accessToken); void i18n.changeLanguage(data.language); setAuthenticated(true); })
      .catch((error) => setAuthError(error instanceof Error ? error.message : String(error)));
  }, [i18n, initData]);
  const me = useQuery({ queryKey: ['me', authenticated], queryFn: () => api<Me>('/me'), enabled: authenticated });
  const features = useQuery({ queryKey: ['features'], queryFn: () => api<Features>('/system/features') });
  const settings = useQuery({
    queryKey: ['public-settings'],
    queryFn: () =>
      api<{ SIGNUP_REWARD?: number; REFERRAL_MIN_ACTIVITY_PERCENT?: number }>(
        '/system/public-settings',
      ),
  });
  const featureData = features.data ?? { suggestions: false, earlyVoteBonus: false, predictionRewards: false, tonWallet: false };
  if (!initData) return <div className={styles.centered}><div className={styles.brandMark}>MV</div><h1>MyVoice</h1><p>{t('auth.openTelegram')}</p></div>;
  if (authError) return <div className={styles.centered}><ErrorState error={authError} /></div>;
  if (!authenticated || me.isLoading) return <div className={styles.centered}><div className={styles.loader} /><span>{t('common.loading')}</span></div>;
  if (me.error || !me.data) return <div className={styles.centered}><ErrorState error={me.error} /></div>;
  if (!me.data.registrationComplete) return <Consent signupReward={settings.data?.SIGNUP_REWARD ?? 0} onDone={() => void queryClient.invalidateQueries({ queryKey: ['me'] })} />;
  return <Shell features={featureData}><Routes><Route path="/" element={<Home me={me.data} />} /><Route path="/votes/:id" element={<VotePage />} /><Route path="/history" element={<HistoryPage />} /><Route path="/results/:id" element={<ResultPage />} /><Route path="/referrals" element={<ReferralsPage minimumActivity={settings.data?.REFERRAL_MIN_ACTIVITY_PERCENT ?? 0} />} /><Route path="/rating" element={<RatingPage me={me.data} />} /><Route path="/profile" element={<ProfilePage me={me.data} />} />{featureData.suggestions && <Route path="/suggest" element={<SuggestPage me={me.data} />} />}<Route path="*" element={<Navigate to="/" replace />} /></Routes></Shell>;
}

export default function App() {
  const location = useLocation();
  if (location.pathname.startsWith('/admin')) return <AdminApp />;
  if (location.pathname === '/terms') return <Legal type="terms" />;
  if (location.pathname === '/privacy') return <Legal type="privacy" />;
  return <UserApp />;
}
