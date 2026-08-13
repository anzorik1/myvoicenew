import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Coins,
  Copy,
  ExternalLink,
  Eye,
  Flag,
  Gift,
  History as HistoryIcon,
  Home as HomeIcon,
  ImagePlus,
  Languages,
  Lightbulb,
  Megaphone,
  Play,
  Search,
  RefreshCw,
  ShieldCheck,
  Send,
  Share2,
  Trash2,
  Trophy,
  UserRound,
  UsersRound,
  Vote as VoteIcon,
  X,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import {
  ApiError,
  api,
  clearAdminToken,
  hasAdminToken,
  setAccessToken,
  setAdminToken,
} from './api';
import { hapticSuccess, telegramInitData } from './telegram';
import styles from './App.module.css';

declare global {
  interface Window {
    turnstile?: {
      render(
        container: HTMLElement,
        options: {
          sitekey: string;
          action: string;
          theme: 'auto';
          size: 'flexible';
          callback(token: string): void;
          'expired-callback'(): void;
          'error-callback'(): void;
        },
      ): string;
      reset(widgetId: string): void;
      remove(widgetId: string): void;
    };
  }
}

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
  notifications: { enabled: boolean; newVotes: boolean; voteEnding: boolean; results: boolean };
};
type Vote = {
  id: string;
  status: string;
  title: string;
  description: string;
  context?: string;
  sources?: { id: string; label: string; url: string }[];
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
  reported?: boolean;
};
type CurrentVotePayload = Vote | Vote[] | null | undefined;
type Features = {
  suggestions: boolean;
  earlyVoteBonus: boolean;
  predictionRewards: boolean;
  tonWallet: false;
};
type AdminVote = {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  imageUrl?: string;
  participantCount: number;
  winnerReward: number;
  loserReward: number;
  translations: Array<{ language: string; title: string; description: string; context?: string }>;
  options: Array<{
    id: string;
    position: number;
    translations: Array<{ language: string; text: string }>;
  }>;
  sources: Array<{ id: string; language: string; label: string; url: string; position: number }>;
};

type WeeklyRank = {
  rank: number | null;
  firstName?: string;
  username?: string;
  participations: number;
  activityRate?: number;
  isMe: boolean;
};

type VoxLedger = {
  items: Array<{
    id: string;
    type: string;
    amount: number;
    comment: string;
    createdAt: string;
  }>;
  summary: {
    registration: number;
    voting: number;
    referrals: number;
    ads: number;
    tasks: number;
    adjustments: number;
    totalEarned: number;
  };
};

type AdminVoteReport = {
  id: string;
  reason: string;
  details?: string;
  status: string;
  createdAt: string;
  user: { firstName: string; username?: string };
  vote: { translations: Array<{ language: string; title: string }> };
};
type AdPlacement = {
  id: string;
  type: 'BANNER' | 'REWARDED';
  title: string;
  description: string;
  actionLabel: string;
  imageUrl?: string;
  mediaUrl?: string;
  targetUrl?: string;
  rewardVox: number;
  minimumWatchSeconds: number;
  dailyRewardLimit: number;
  claimsToday: number;
};
type TaskItem = {
  id: string;
  type: 'TELEGRAM_CHANNEL_SUBSCRIPTION';
  title: string;
  description: string;
  actionLabel: string;
  rewardVox: number;
  targetUrl: string;
  completed: boolean;
  completedAt?: string | null;
};
type RewardSession = {
  id: string;
  watchedSeconds: number;
  minimumWatchSeconds: number;
  remainingSeconds: number;
  expiresAt: string;
  claimed: boolean;
};
type AdminUserSummary = {
  id: string;
  telegramId: string;
  username?: string;
  firstName: string;
  status: string;
  voxBalance: number;
  activityRate: number | string;
  createdAt: string;
};
type AdminVoxTransaction = {
  id: string;
  type: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  comment: string;
  createdAt: string;
};
type AdminAd = {
  id: string;
  type: 'BANNER' | 'REWARDED';
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';
  startsAt: string;
  endsAt?: string;
  imageUrl?: string;
  mediaUrl?: string;
  targetUrl?: string;
  rewardVox: number;
  minimumWatchSeconds: number;
  dailyRewardLimit: number;
  impressionCount: number;
  clickCount: number;
  rewardCount: number;
  translations: Array<{
    language: string;
    title: string;
    description: string;
    actionLabel: string;
  }>;
};

const dateTime = (value: string, language: string) =>
  new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );

const localDateTimeInput = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

export const activeVoteFrom = (payload: CurrentVotePayload) => {
  const candidates = Array.isArray(payload) ? payload : payload ? [payload] : [];
  return candidates.find((vote) => vote?.status === 'ACTIVE') ?? null;
};

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

function VoteSignal({ start, end }: { start: string; end: string }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  const duration = Math.max(1, endTime - startTime);
  const progress = Math.max(0, Math.min(100, ((now - startTime) / duration) * 100));
  const bars = [30, 55, 38, 74, 46, 88, 52, 68, 36, 62, 42, 78, 48, 58, 32];
  return (
    <div
      className={styles.arenaSignal}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress)}
      aria-label={t('vote.timeline')}
    >
      <div aria-hidden>
        {bars.map((height, index) => (
          <span key={index} style={{ '--signal-height': `${height}%` } as React.CSSProperties} />
        ))}
      </div>
      <i style={{ width: `${progress}%` }} />
    </div>
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
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => (isActive ? styles.activeNav : '')}
          >
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
        <a href="/terms" target="_blank">
          {t('auth.terms')} · v1.0
        </a>
        <a href="/privacy" target="_blank">
          {t('auth.privacy')} · v1.0
        </a>
      </div>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
        />
        <span>{t('auth.accept')}</span>
      </label>
      <button
        className={styles.primary}
        disabled={!checked || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? t('common.loading') : t('auth.continue', { amount: signupReward })}
      </button>
      {mutation.error && <ErrorState error={mutation.error} />}
    </div>
  );
}

function BannerAdCard({ ad }: { ad: AdPlacement }) {
  const { t } = useTranslation();
  const open = () => {
    void api(`/ads/${ad.id}/click`, { method: 'POST' }).catch(() => undefined);
    if (!ad.targetUrl) return;
    if (window.Telegram?.WebApp.openLink) window.Telegram.WebApp.openLink(ad.targetUrl);
    else window.open(ad.targetUrl, '_blank', 'noopener,noreferrer');
  };
  return (
    <article
      className={styles.bannerAd}
      style={
        ad.imageUrl ? ({ '--ad-image': `url("${ad.imageUrl}")` } as React.CSSProperties) : undefined
      }
    >
      <div className={styles.adLabel}>
        <Megaphone size={13} />
        {t('ads.sponsored')}
      </div>
      <div className={styles.bannerAdCopy}>
        <h3>{ad.title}</h3>
        <p>{ad.description}</p>
        <button onClick={open}>
          {ad.actionLabel}
          <ExternalLink size={15} />
        </button>
      </div>
    </article>
  );
}

function RewardedAdCard({ ad }: { ad: AdPlacement }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<RewardSession | null>(null);
  const [playing, setPlaying] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const start = useMutation({
    mutationFn: () =>
      api<RewardSession>(`/ads/${ad.id}/reward-sessions`, {
        method: 'POST',
        body: JSON.stringify({ clientRequestId: requestId.current }),
      }),
    onSuccess: setSession,
  });
  const heartbeat = useMutation({
    mutationFn: (sessionId: string) =>
      api<RewardSession>(`/ads/reward-sessions/${sessionId}/heartbeat`, { method: 'POST' }),
    onSuccess: setSession,
  });
  const claim = useMutation({
    mutationFn: (sessionId: string) =>
      api<{ claimed: boolean; reward: number; balance: number }>(
        `/ads/reward-sessions/${sessionId}/claim`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      setPlaying(false);
      hapticSuccess();
      setSession((current) => (current ? { ...current, claimed: true } : current));
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      void queryClient.invalidateQueries({ queryKey: ['ads-current'] });
    },
  });

  useEffect(() => {
    if (!playing || !session || session.claimed) return;
    const timer = window.setInterval(() => {
      if (!heartbeat.isPending) heartbeat.mutate(session.id);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [playing, session?.claimed, session?.id]);

  const limitReached = ad.claimsToday >= ad.dailyRewardLimit;
  return (
    <article className={styles.rewardAd}>
      <div className={styles.rewardAdTop}>
        <span className={styles.rewardGift}>
          <Gift />
        </span>
        <div>
          <small>{t('ads.rewarded')}</small>
          <h3>{ad.title}</h3>
        </div>
        <strong>+{ad.rewardVox} VOX</strong>
      </div>
      <p>{ad.description}</p>
      {!session && (
        <button
          className={styles.rewardStart}
          disabled={start.isPending || limitReached}
          onClick={() => start.mutate()}
        >
          <Play size={17} />
          {limitReached ? t('ads.limitReached') : ad.actionLabel}
        </button>
      )}
      {session && !session.claimed && (
        <div className={styles.rewardPlayer}>
          <video
            src={ad.mediaUrl}
            poster={ad.imageUrl}
            controls
            playsInline
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false);
              if (!heartbeat.isPending) heartbeat.mutate(session.id);
            }}
          />
          <div className={styles.watchProgress}>
            <i
              style={{
                width: `${Math.min(100, (session.watchedSeconds / Math.max(1, session.minimumWatchSeconds)) * 100)}%`,
              }}
            />
          </div>
          <div className={styles.rewardProgressText}>
            <span>
              {session.remainingSeconds > 0
                ? t('ads.watchRemaining', { seconds: session.remainingSeconds })
                : t('ads.ready')}
            </span>
            <strong>+{ad.rewardVox} VOX</strong>
          </div>
          <button
            className={styles.primary}
            disabled={session.remainingSeconds > 0 || claim.isPending}
            onClick={() => claim.mutate(session.id)}
          >
            {claim.isPending ? t('common.loading') : t('ads.claim')}
          </button>
        </div>
      )}
      {(start.error || heartbeat.error || claim.error) && (
        <ErrorState error={start.error ?? heartbeat.error ?? claim.error} />
      )}
      {(session?.claimed || claim.isSuccess) && (
        <div className={styles.rewardClaimed}>
          <Check />
          {t('ads.claimed', { amount: ad.rewardVox })}
        </div>
      )}
    </article>
  );
}

function Home({ me, voteReward }: { me: Me; voteReward: number }) {
  const { t, i18n } = useTranslation();
  const current = useQuery({
    queryKey: ['current-vote'],
    queryFn: () => api<CurrentVotePayload>('/votes/current'),
    retry: 2,
  });
  const ads = useQuery({
    queryKey: ['ads-current'],
    queryFn: () => api<{ banners: AdPlacement[]; rewarded: AdPlacement[] }>('/ads/current'),
    retry: 1,
  });
  const tasks = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api<{ items: TaskItem[] }>('/tasks'),
    retry: 1,
  });
  const activeVote = activeVoteFrom(current.data);
  const availableTask = tasks.data?.items.find((task) => !task.completed);
  const quickLinks = [
    {
      to: '/history',
      icon: HistoryIcon,
      label: t('nav.history'),
      value: me.ownVotes,
      tone: 'blue',
    },
    {
      to: '/rating',
      icon: BarChart3,
      label: t('nav.rating'),
      value: Math.round(me.activityRate) + '%',
      tone: 'teal',
    },
    {
      to: '/referrals',
      icon: UsersRound,
      label: t('nav.referrals'),
      value: me.referralCount,
      tone: 'coral',
    },
  ] as const;
  return (
    <div className={[styles.stack, styles.voiceArenaHome].join(' ')}>
      <header className={styles.arenaTopbar}>
        <NavLink to="/profile" className={styles.arenaIdentity}>
          <span>{me.firstName.slice(0, 1).toUpperCase()}</span>
          <div>
            <small>{t('home.arenaEyebrow')}</small>
            <strong>{me.firstName}</strong>
          </div>
        </NavLink>
        <div className={styles.arenaBalance}>
          <Coins size={17} />
          <strong>{me.balance.toLocaleString(i18n.language)}</strong>
          <small>VOX</small>
        </div>
      </header>

      <NavLink to="/about" className={styles.aboutLauncher}>
        <span>
          <BookOpen />
        </span>
        <div>
          <strong>{t('about.launcherTitle')}</strong>
          <small>{t('about.launcherHint')}</small>
        </div>
        <ChevronRight />
      </NavLink>

      <section className={styles.arenaStatusRail}>
        <div>
          <small>{t('home.activity')}</small>
          <strong>{Math.round(me.activityRate)}%</strong>
          <i>
            <span style={{ width: Math.round(me.activityRate) + '%' }} />
          </i>
        </div>
        <div>
          <small>{t('home.participation')}</small>
          <strong>
            {me.participatedVotes}/{me.eligibleVotes}
          </strong>
        </div>
        <div data-active={me.referralProgramActive}>
          <Activity size={16} />
          <span>{me.referralProgramActive ? t('home.referralOn') : t('home.referralOff')}</span>
        </div>
      </section>

      <section className={styles.arenaVoteCard} data-empty={!activeVote}>
        <div className={styles.arenaVoteMeta}>
          <span>
            <VoteIcon size={15} />
            {t('home.todayVote')}
          </span>
          {activeVote && <Countdown end={activeVote.endsAt} />}
        </div>

        {current.isLoading && <div className={styles.arenaSkeleton} />}

        {!current.isLoading && !activeVote && (
          <div className={styles.arenaEmpty} aria-live="polite">
            <span>
              <VoteIcon />
            </span>
            <h1>{t('home.noVote')}</h1>
            <p>{current.isError ? t('home.noVoteOffline') : t('home.noVoteHint')}</p>
            {current.isError && (
              <button onClick={() => void current.refetch()}>
                <RefreshCw size={16} />
                {t('common.retry')}
              </button>
            )}
          </div>
        )}

        {activeVote && (
          <>
            <VoteSignal start={activeVote.startsAt} end={activeVote.endsAt} />
            <article className={styles.arenaQuestion}>
              <span className={styles.arenaLiveState} data-complete={activeVote.hasVoted}>
                {activeVote.hasVoted ? <Check size={15} /> : <Activity size={15} />}
                {activeVote.hasVoted ? t('vote.success') : t('home.decisionLive')}
              </span>
              <h1>{activeVote.title}</h1>
              <p>{activeVote.description}</p>
              <div className={styles.arenaVoteFooter}>
                <span className={styles.arenaReward}>
                  <Gift size={18} />
                  {voteReward > 0
                    ? t('home.voteReward', { amount: voteReward })
                    : t('home.voxReward')}
                </span>
                <NavLink className={styles.arenaPrimary} to={'/votes/' + activeVote.id}>
                  {activeVote.hasVoted ? t('home.viewVote') : t('home.openVote')}
                </NavLink>
              </div>
            </article>
          </>
        )}
      </section>

      <section className={styles.arenaQuickSection}>
        <div className={styles.arenaSectionTitle}>
          <span>{t('home.quick')}</span>
          <small>{t('home.stats')}</small>
        </div>
        <div className={styles.arenaQuickGrid}>
          {quickLinks.map(({ to, icon: Icon, label, value, tone }) => (
            <NavLink to={to} key={to} className={styles.arenaQuickCard} data-tone={tone}>
              <span>
                <Icon />
              </span>
              <div>
                <small>{label}</small>
                <strong>{value}</strong>
              </div>
            </NavLink>
          ))}
        </div>
      </section>

      {availableTask && (
        <NavLink to="/tasks" className={styles.homeTaskCard}>
          <span className={styles.homeTaskIcon}>
            <Send />
          </span>
          <div>
            <small>{t('tasks.homeEyebrow')}</small>
            <strong>{availableTask.title}</strong>
            <span>{t('tasks.reward', { amount: availableTask.rewardVox })}</span>
          </div>
          <ExternalLink size={19} />
        </NavLink>
      )}

      {ads.data?.banners[0] && <BannerAdCard ad={ads.data.banners[0]} />}

      {Boolean(ads.data?.rewarded.length) && (
        <section className={styles.rewardSection}>
          <div className={styles.arenaSectionTitle}>
            <span>{t('ads.earn')}</span>
            <small>{t('ads.optional')}</small>
          </div>
          <div className={styles.rewardList}>
            {ads.data?.rewarded.map((ad) => (
              <RewardedAdCard key={ad.id} ad={ad} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AboutPage() {
  const { t } = useTranslation();
  const slider = useRef<HTMLDivElement>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const slides = [
    {
      key: 'why',
      image: '/about/voice-value.webp',
      tab: t('about.tabs.why'),
      eyebrow: t('about.why.eyebrow'),
      title: t('about.why.title'),
      body: t('about.why.body'),
      note: t('about.why.note'),
    },
    {
      key: 'how',
      image: '/about/ecosystem.webp',
      tab: t('about.tabs.how'),
      eyebrow: t('about.how.eyebrow'),
      title: t('about.how.title'),
      body: t('about.how.body'),
      note: t('about.how.note'),
    },
    {
      key: 'future',
      image: '/about/action.webp',
      tab: t('about.tabs.future'),
      eyebrow: t('about.future.eyebrow'),
      title: t('about.future.title'),
      body: t('about.future.body'),
      note: t('about.future.note'),
    },
  ];
  const openSlide = (index: number) => {
    const card = slider.current?.children.item(index) as HTMLElement | null;
    if (!card || !slider.current) return;
    slider.current.scrollTo({ left: card.offsetLeft, behavior: 'smooth' });
    setActiveSlide(index);
  };
  const syncActiveSlide = () => {
    const container = slider.current;
    if (!container) return;
    const cards = Array.from(container.children) as HTMLElement[];
    const closest = cards.reduce(
      (best, card, index) => {
        const distance = Math.abs(card.offsetLeft - container.scrollLeft);
        return distance < best.distance ? { index, distance } : best;
      },
      { index: 0, distance: Number.POSITIVE_INFINITY },
    );
    setActiveSlide(closest.index);
  };

  return (
    <div className={[styles.page, styles.aboutPage].join(' ')}>
      <header className={styles.aboutHeader}>
        <BackButton />
        <div>
          <small>{t('about.eyebrow')}</small>
          <strong>{t('about.title')}</strong>
        </div>
        <span>
          {activeSlide + 1}/{slides.length}
        </span>
      </header>

      <nav className={styles.aboutTabs} aria-label={t('about.tabsLabel')}>
        {slides.map((slide, index) => (
          <button
            key={slide.key}
            type="button"
            data-active={index === activeSlide}
            aria-current={index === activeSlide ? 'step' : undefined}
            onClick={() => openSlide(index)}
          >
            {slide.tab}
          </button>
        ))}
      </nav>

      <div
        className={styles.aboutSlider}
        ref={slider}
        onScroll={syncActiveSlide}
        aria-live="polite"
      >
        {slides.map((slide, index) => (
          <article className={styles.aboutSlide} key={slide.key} data-index={index + 1}>
            <div className={styles.aboutVisual}>
              <img
                src={slide.image}
                alt=""
                loading={index === 0 ? 'eager' : 'lazy'}
                fetchPriority={index === 0 ? 'high' : 'auto'}
              />
              <span>{t('about.stage', { current: index + 1, total: slides.length })}</span>
            </div>
            <div className={styles.aboutCopy}>
              <small>{slide.eyebrow}</small>
              <h1>{slide.title}</h1>
              <p>{slide.body}</p>
              <div>
                <ShieldCheck />
                <span>{slide.note}</span>
              </div>
            </div>
          </article>
        ))}
      </div>

      <footer className={styles.aboutControls}>
        <div aria-hidden>
          {slides.map((slide, index) => (
            <i key={slide.key} data-active={index === activeSlide} />
          ))}
        </div>
        <button
          type="button"
          disabled={activeSlide === slides.length - 1}
          onClick={() => openSlide(Math.min(activeSlide + 1, slides.length - 1))}
        >
          {activeSlide === slides.length - 1 ? t('about.done') : t('about.next')}
          {activeSlide < slides.length - 1 && <ChevronRight />}
        </button>
      </footer>
    </div>
  );
}

function TasksPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const tasks = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api<{ items: TaskItem[] }>('/tasks'),
  });
  const verify = useMutation({
    mutationFn: (taskId: string) =>
      api<{ completed: boolean; reward: number }>(`/tasks/${taskId}/verify`, {
        method: 'POST',
      }),
    onSuccess: () => {
      hapticSuccess();
      void client.invalidateQueries({ queryKey: ['tasks'] });
      void client.invalidateQueries({ queryKey: ['me'] });
      void client.invalidateQueries({ queryKey: ['vox-center'] });
    },
  });
  const openTask = (task: TaskItem) => {
    if (window.Telegram?.WebApp) window.Telegram.WebApp.openTelegramLink(task.targetUrl);
    else window.open(task.targetUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className={[styles.page, styles.stack, styles.tasksPage].join(' ')}>
      <BackButton />
      <section className={styles.tasksHero}>
        <span className={styles.tasksHeroMark}>
          <Gift />
        </span>
        <small>{t('tasks.eyebrow')}</small>
        <h1>{t('tasks.title')}</h1>
        <p>{t('tasks.subtitle')}</p>
      </section>

      {tasks.isLoading && <div className={styles.skeleton} />}
      {tasks.error && <ErrorState error={tasks.error} />}
      {!tasks.isLoading && !tasks.error && !tasks.data?.items.length && (
        <div className={styles.tasksEmpty}>
          <Check />
          <strong>{t('tasks.empty')}</strong>
          <span>{t('tasks.emptyHint')}</span>
        </div>
      )}

      <section className={styles.taskList}>
        {tasks.data?.items.map((task) => {
          const checking = verify.isPending && verify.variables === task.id;
          const error = verify.error && verify.variables === task.id ? verify.error : null;
          return (
            <article className={styles.taskCard} data-completed={task.completed} key={task.id}>
              <header>
                <span>{task.completed ? <Check /> : <Send />}</span>
                <div>
                  <small>{task.completed ? t('tasks.completed') : t('tasks.available')}</small>
                  <strong>{t('tasks.reward', { amount: task.rewardVox })}</strong>
                </div>
              </header>
              <h2>{task.title}</h2>
              <p>{task.description}</p>
              {task.completed ? (
                <div className={styles.taskCompleted}>
                  <ShieldCheck />
                  <span>{t('tasks.rewarded', { amount: task.rewardVox })}</span>
                </div>
              ) : (
                <div className={styles.taskActions}>
                  <button type="button" onClick={() => openTask(task)}>
                    {task.actionLabel}
                    <ExternalLink />
                  </button>
                  <button
                    type="button"
                    className={styles.taskVerify}
                    disabled={checking}
                    onClick={() => verify.mutate(task.id)}
                  >
                    {checking ? t('tasks.checking') : t('tasks.verify')}
                  </button>
                </div>
              )}
              {error && (
                <p className={styles.taskError} role="alert">
                  {error instanceof ApiError && error.status === 400
                    ? t('tasks.notSubscribed')
                    : error.message}
                </p>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}

function VotePage({ voteReward }: { voteReward: number }) {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const vote = useQuery({ queryKey: ['vote', id], queryFn: () => api<Vote>('/votes/' + id) });
  const [chosen, setChosen] = useState<{ id: string; text: string } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const cast = useMutation({
    mutationFn: (optionId: string) =>
      api<{ reward: number }>('/votes/' + id + '/cast', {
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
  const report = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const data = new FormData(form);
      return api(`/votes/${id}/reports`, {
        method: 'POST',
        body: JSON.stringify({ reason: data.get('reason'), details: data.get('details') }),
      });
    },
    onSuccess: () => {
      setReportOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['vote', id] });
    },
  });
  if (vote.isLoading)
    return (
      <div className={[styles.page, styles.arenaVotePage].join(' ')}>
        <BackButton />
        <div className={styles.arenaSkeleton} />
      </div>
    );
  if (vote.error || !vote.data)
    return (
      <div className={[styles.page, styles.arenaVotePage].join(' ')}>
        <BackButton />
        <ErrorState error={vote.error} />
      </div>
    );
  const item = vote.data;
  return (
    <div className={[styles.page, styles.stack, styles.arenaVotePage].join(' ')}>
      <BackButton />

      <section className={styles.arenaDetailCard}>
        {item.imageUrl && <img className={styles.arenaVoteImage} src={item.imageUrl} alt="" />}
        <div className={styles.arenaDetailMeta}>
          <span>
            <VoteIcon size={15} />
            {t('vote.arenaEyebrow')}
          </span>
          <Countdown end={item.endsAt} />
        </div>
        <VoteSignal start={item.startsAt} end={item.endsAt} />
        <div className={styles.arenaDetailCopy}>
          <span className={styles.arenaLiveState} data-complete={item.hasVoted}>
            {item.hasVoted ? <Check size={15} /> : <Activity size={15} />}
            {item.hasVoted ? t('vote.success') : t('home.decisionLive')}
          </span>
          <h1>{item.title}</h1>
          <p>{item.description}</p>
          {item.context && (
            <div className={styles.voteContext}>
              <BookOpen size={18} />
              <div>
                <strong>{t('vote.context')}</strong>
                <p>{item.context}</p>
              </div>
            </div>
          )}
          <div className={styles.arenaDetailFooter}>
            <small>{t('vote.ends', { date: dateTime(item.endsAt, i18n.language) })}</small>
            <span>
              <Gift size={17} />
              {voteReward > 0 ? t('vote.rewardHint', { amount: voteReward }) : t('home.voxReward')}
            </span>
          </div>
        </div>
      </section>

      {Boolean(item.sources?.length) && (
        <section className={styles.voteSources}>
          <div className={styles.arenaSectionTitle}>
            <span>{t('vote.sources')}</span>
            <small>{t('vote.sourcesHint')}</small>
          </div>
          {item.sources?.map((source) => (
            <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
              <BookOpen size={17} />
              <span>{source.label}</span>
              <ExternalLink size={15} />
            </a>
          ))}
        </section>
      )}

      <button
        className={styles.reportVoteButton}
        disabled={item.reported}
        onClick={() => setReportOpen(true)}
      >
        <Flag size={16} />
        {item.reported ? t('vote.reported') : t('vote.report')}
      </button>

      <section className={styles.arenaChoicePanel}>
        <div className={styles.arenaSectionTitle}>
          <span>{t('vote.choose')}</span>
          <small>{t('vote.decisionFinal')}</small>
        </div>
        {item.hasVoted || cast.isSuccess ? (
          <div className={styles.arenaSuccessCard}>
            <span>
              <Check size={26} />
            </span>
            <strong>{t('vote.success')}</strong>
            <p>{cast.data ? t('vote.reward', { amount: cast.data.reward }) : t('vote.hidden')}</p>
          </div>
        ) : (
          <div className={styles.arenaOptionStack}>
            {item.options.map((option) => (
              <button
                key={option.id}
                className={styles.arenaOption}
                data-position={option.position}
                onClick={() => setChosen(option)}
              >
                <span>{option.position === 1 ? 'A' : 'B'}</span>
                <div>
                  <small>{t('vote.optionNumber', { number: option.position })}</small>
                  <strong>{option.text}</strong>
                </div>
                <i aria-hidden>→</i>
              </button>
            ))}
            <small className={styles.arenaWarning}>
              <ShieldCheck size={15} />
              {t('vote.cannotChange')}
            </small>
          </div>
        )}
      </section>

      {cast.error && <ErrorState error={cast.error} />}

      {chosen && (
        <div className={styles.modalBackdrop} role="presentation" onClick={() => setChosen(null)}>
          <div
            className={[styles.modal, styles.arenaConfirmModal].join(' ')}
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <span className={styles.arenaConfirmIcon}>
              <VoteIcon />
            </span>
            <h2>{t('vote.confirmTitle')}</h2>
            <p>{t('vote.confirmText', { option: chosen.text })}</p>
            <strong className={styles.arenaConfirmChoice}>{chosen.text}</strong>
            <button
              className={styles.arenaPrimary}
              disabled={cast.isPending}
              onClick={() => cast.mutate(chosen.id)}
            >
              {cast.isPending ? t('common.loading') : t('vote.confirm')}
            </button>
            <button className={styles.secondary} onClick={() => setChosen(null)}>
              {t('vote.cancel')}
            </button>
          </div>
        </div>
      )}

      {reportOpen && (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onClick={() => setReportOpen(false)}
        >
          <form
            className={styles.modal}
            onSubmit={(event) => {
              event.preventDefault();
              report.mutate(event.currentTarget);
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <span className={styles.arenaConfirmIcon}>
              <Flag />
            </span>
            <h2>{t('vote.reportTitle')}</h2>
            <p>{t('vote.reportHint')}</p>
            <label className={styles.field}>
              <span>{t('vote.reportReason')}</span>
              <select name="reason" defaultValue="MISLEADING">
                <option value="MISLEADING">{t('vote.reportMisleading')}</option>
                <option value="BIASED">{t('vote.reportBiased')}</option>
                <option value="OFFENSIVE">{t('vote.reportOffensive')}</option>
                <option value="OTHER">{t('vote.reportOther')}</option>
              </select>
            </label>
            <textarea name="details" maxLength={1000} placeholder={t('vote.reportDetails')} />
            <button className={styles.arenaPrimary} disabled={report.isPending}>
              {report.isPending ? t('common.loading') : t('vote.reportSend')}
            </button>
            <button type="button" className={styles.secondary} onClick={() => setReportOpen(false)}>
              {t('vote.cancel')}
            </button>
            {report.error && <ErrorState error={report.error} />}
          </form>
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
    queryFn: () =>
      api<{ items: Vote[]; nextCursor?: string }>(
        `/votes/history?filter=${filter}${cursor ? `&cursor=${cursor}` : ''}`,
      ),
  });
  useEffect(() => {
    if (history.data)
      setItems((old) => (cursor ? [...old, ...history.data.items] : history.data.items));
  }, [history.data, cursor]);
  const change = (value: typeof filter) => {
    setItems([]);
    setCursor(undefined);
    setFilter(value);
  };
  return (
    <div className={`${styles.page} ${styles.stack}`}>
      <header className={styles.pageHeaderCard}>
        <span>
          <HistoryIcon />
        </span>
        <div>
          <small>{t('history.eyebrow')}</small>
          <h1>{t('history.title')}</h1>
          <p>{t('history.subtitle')}</p>
        </div>
      </header>
      <div className={styles.segmented}>
        {(['all', 'participated', 'missed'] as const).map((value) => (
          <button key={value} data-active={filter === value} onClick={() => change(value)}>
            {t(`common.${value}`)}
          </button>
        ))}
      </div>
      {items.map((vote) => (
        <NavLink to={`/results/${vote.id}`} key={vote.id} className={styles.historyCard}>
          <div className={styles.historyCardTop}>
            <small>{dateTime(vote.completedAt ?? vote.endsAt, i18n.language)}</small>
            <span data-voted={vote.hasVoted}>
              {vote.hasVoted ? t('common.participated') : t('common.missed')}
            </span>
          </div>
          <h2>{vote.title}</h2>
          <div className={styles.resultBars}>
            {vote.options.map((option) => (
              <div key={option.id}>
                <span>{option.text}</span>
                <strong>{option.percent}%</strong>
                <i style={{ width: `${option.percent}%` }} />
              </div>
            ))}
          </div>
          <span className={styles.participation} data-voted={vote.hasVoted}>
            {vote.hasVoted
              ? `${t('history.yourChoice')}: ${vote.options.find((x) => x.id === vote.selectedOptionId)?.text}`
              : t('history.didNotVote')}
          </span>
        </NavLink>
      ))}
      {!history.isLoading && items.length === 0 && (
        <div className={styles.empty}>{t('history.empty')}</div>
      )}
      {history.error && <ErrorState error={history.error} />}
      {history.data?.nextCursor && (
        <button className={styles.secondary} onClick={() => setCursor(history.data?.nextCursor)}>
          Load more
        </button>
      )}
    </div>
  );
}

function ResultPage() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation();
  const result = useQuery({
    queryKey: ['result', id],
    queryFn: () => api<Vote>(`/votes/${id}/result`),
  });
  const share = useMutation({
    mutationFn: () => api<{ url: string }>(`/votes/${id}/share`, { method: 'POST' }),
    onSuccess: ({ url }) => {
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(t('vote.shareText'))}`;
      if (window.Telegram?.WebApp) window.Telegram.WebApp.openTelegramLink(shareUrl);
      else window.open(shareUrl, '_blank');
    },
  });
  if (!result.data)
    return (
      <div className={styles.page}>
        <BackButton />
        {result.error ? <ErrorState error={result.error} /> : <div className={styles.skeleton} />}
      </div>
    );
  const vote = result.data;
  return (
    <div className={`${styles.page} ${styles.stack}`}>
      <BackButton />
      <div className={styles.resultHero}>
        <div className={styles.resultHeroTop}>
          <span>
            <Trophy />
          </span>
          <small>{dateTime(vote.completedAt ?? vote.endsAt, i18n.language)}</small>
        </div>
        <h1>{vote.title}</h1>
        <strong className={styles.resultWinner}>
          {vote.resultStatus === 'TIE'
            ? t('vote.tie')
            : `${t('history.winner')}: ${vote.options.find((x) => x.id === vote.winnerOptionId)?.text}`}
        </strong>
        <span>{t('vote.participants', { count: vote.participantCount })}</span>
      </div>
      <div className={`${styles.resultBars} ${styles.resultCard}`}>
        {vote.options.map((option) => (
          <div key={option.id}>
            <span>{option.text}</span>
            <strong>
              {option.count} · {option.percent}%
            </strong>
            <i style={{ width: `${option.percent}%` }} />
          </div>
        ))}
      </div>
      <div className={styles.yourResultCard} data-voted={vote.hasVoted}>
        <span>{vote.hasVoted ? <Check /> : <Clock3 />}</span>
        <div>
          <small>{vote.hasVoted ? t('history.yourChoice') : t('history.didNotVote')}</small>
          <strong>
            {vote.hasVoted
              ? `${vote.options.find((x) => x.id === vote.selectedOptionId)?.text} · +${vote.userReward ?? 0} VOX`
              : t('history.missedShort')}
          </strong>
        </div>
      </div>
      <button
        className={styles.resultShareButton}
        onClick={() => share.mutate()}
        disabled={share.isPending}
      >
        <Share2 size={18} />
        {share.isPending ? t('common.loading') : t('vote.shareResult')}
      </button>
      {share.error && <ErrorState error={share.error} />}
    </div>
  );
}

function ReferralsPage({ minimumActivity }: { minimumActivity: number }) {
  const { t, i18n } = useTranslation();
  const referrals = useQuery({
    queryKey: ['referrals'],
    queryFn: () =>
      api<{
        link: string;
        registered: number;
        active: number;
        earned: number;
        programActive: boolean;
        invitees: Array<{
          firstName: string;
          lastName?: string;
          username?: string;
          joinedAt: string;
          registrationCompleted: boolean;
          active: boolean;
          votes: number;
        }>;
      }>('/me/referrals'),
  });
  if (!referrals.data)
    return (
      <div className={styles.page}>
        {referrals.error ? (
          <ErrorState error={referrals.error} />
        ) : (
          <div className={styles.skeleton} />
        )}
      </div>
    );
  const data = referrals.data;
  const share = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(data.link)}&text=${encodeURIComponent('Join me in MyVoice')}`;
    if (window.Telegram?.WebApp) window.Telegram.WebApp.openTelegramLink(url);
    else window.open(url, '_blank');
  };
  return (
    <div className={`${styles.page} ${styles.stack}`}>
      <section className={styles.referralHeroCard}>
        <div className={styles.referralOrbit}>
          <UsersRound />
          <i />
          <i />
          <i />
        </div>
        <small>{t('referrals.eyebrow')}</small>
        <h1>{t('referrals.title')}</h1>
        <p>{t('referrals.description', { minimum: minimumActivity })}</p>
        <div className={styles.referralLink}>
          <code>{data.link}</code>
          <button
            onClick={() => navigator.clipboard.writeText(data.link)}
            aria-label={t('common.copy')}
          >
            <Copy />
          </button>
        </div>
        <button className={styles.referralShare} onClick={share}>
          <Send size={18} />
          {t('common.share')}
        </button>
      </section>
      <div className={styles.metricGrid}>
        <div>
          <strong>{data.registered}</strong>
          <span>{t('referrals.registered')}</span>
        </div>
        <div>
          <strong>{data.active}</strong>
          <span>{t('referrals.active')}</span>
        </div>
        <div>
          <strong>{data.earned}</strong>
          <span>{t('referrals.earned')}</span>
        </div>
      </div>
      <div className={styles.statusPanel} data-active={data.programActive}>
        <Activity />
        {data.programActive ? t('referrals.programOn') : t('referrals.programOff')}
      </div>
      <section className={styles.referralPeople}>
        <header>
          <div>
            <small>{t('referrals.peopleEyebrow')}</small>
            <h2>{t('referrals.peopleTitle')}</h2>
          </div>
          <span>{data.registered}</span>
        </header>
        {data.invitees.length ? (
          <div className={styles.referralPeopleList}>
            {data.invitees.map((person, index) => {
              const fullName = [person.firstName, person.lastName].filter(Boolean).join(' ');
              const initials = [person.firstName, person.lastName]
                .filter(Boolean)
                .map((part) => part!.slice(0, 1).toUpperCase())
                .join('')
                .slice(0, 2);
              const state = !person.registrationCompleted
                ? 'pending'
                : person.active
                  ? 'active'
                  : 'inactive';
              return (
                <article key={`${person.joinedAt}-${person.username ?? index}`}>
                  <span className={styles.referralPersonAvatar}>{initials}</span>
                  <div className={styles.referralPersonIdentity}>
                    <strong>{fullName}</strong>
                    <span>
                      {person.username ? `@${person.username}` : t('referrals.telegramMember')}
                    </span>
                    <small>
                      {t('referrals.joined', {
                        date: dateTime(person.joinedAt, i18n.language),
                      })}
                    </small>
                  </div>
                  <div className={styles.referralPersonActivity} data-state={state}>
                    <span>
                      {state === 'active'
                        ? t('referrals.personActive')
                        : state === 'pending'
                          ? t('referrals.personPending')
                          : t('referrals.personInactive')}
                    </span>
                    <small>{t('referrals.personVotes', { count: person.votes })}</small>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className={styles.referralPeopleEmpty}>
            <UserRound />
            <strong>{t('referrals.peopleEmpty')}</strong>
            <span>{t('referrals.peopleEmptyHint')}</span>
          </div>
        )}
        {data.registered > data.invitees.length && (
          <p className={styles.referralPeopleLimit}>
            {t('referrals.peopleLimit', { count: data.invitees.length })}
          </p>
        )}
      </section>
    </div>
  );
}

function RatingPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const activity = useQuery({
    queryKey: ['activity'],
    queryFn: () =>
      api<{ rate: number; participated: number; missed: number; referralProgramActive: boolean }>(
        '/me/activity',
      ),
  });
  const leaderboard = useQuery({
    queryKey: ['leaderboard-weekly'],
    queryFn: () =>
      api<{ items: WeeklyRank[]; me: WeeklyRank; periodStart: string }>('/leaderboard/weekly'),
  });
  const data = activity.data ?? {
    rate: me.activityRate,
    participated: me.participatedVotes,
    missed: Math.max(0, me.eligibleVotes - me.participatedVotes),
    referralProgramActive: me.referralProgramActive,
  };
  return (
    <div className={`${styles.page} ${styles.stack}`}>
      <section className={styles.ratingHeroCard} data-active={data.referralProgramActive}>
        <div>
          <small>{t('rating.eyebrow')}</small>
          <h1>{t('rating.title')}</h1>
          <p>{t('rating.explain')}</p>
        </div>
        <div className={styles.bigGauge}>
          <Gauge rate={data.rate} />
        </div>
        <div className={styles.ratingStatus}>
          <Activity />
          {data.referralProgramActive ? t('rating.on') : t('rating.off')}
        </div>
      </section>
      <div className={styles.metricGrid}>
        <div>
          <strong>{data.participated}</strong>
          <span>{t('rating.participated')}</span>
        </div>
        <div>
          <strong>{data.missed}</strong>
          <span>{t('rating.missed')}</span>
        </div>
      </div>
      <section className={styles.weeklyBoard}>
        <div className={styles.weeklyBoardHeader}>
          <div>
            <small>{t('rating.weeklyEyebrow')}</small>
            <h2>{t('rating.weeklyTitle')}</h2>
          </div>
          <Trophy />
        </div>
        {leaderboard.data?.me.rank ? (
          <div className={styles.myWeeklyRank}>
            <span>{t('rating.yourPlace')}</span>
            <strong>#{leaderboard.data.me.rank}</strong>
            <small>{t('rating.weeklyVotes', { count: leaderboard.data.me.participations })}</small>
          </div>
        ) : (
          <p className={styles.weeklyEmpty}>{t('rating.weeklyEmpty')}</p>
        )}
        <div className={styles.weeklyList}>
          {leaderboard.data?.items.slice(0, 20).map((row) => (
            <div key={`${row.rank}-${row.username ?? row.firstName}`} data-me={row.isMe}>
              <b>{row.rank}</b>
              <span>
                <strong>{row.firstName}</strong>
                <small>{row.username ? `@${row.username}` : t('rating.member')}</small>
              </span>
              <em>{row.participations}</em>
            </div>
          ))}
        </div>
        {leaderboard.isLoading && <div className={styles.skeleton} />}
        {leaderboard.error && <ErrorState error={leaderboard.error} />}
      </section>
    </div>
  );
}

function ProfilePage({ me }: { me: Me }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const language = useMutation({
    mutationFn: (value: 'en' | 'ru') =>
      api('/me/language', { method: 'PATCH', body: JSON.stringify({ language: value }) }),
    onSuccess: (_, value) => {
      void i18n.changeLanguage(value);
      void client.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const notificationPreferences = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => api<Me['notifications']>('/me/notifications'),
  });
  const vox = useQuery({
    queryKey: ['vox-center'],
    queryFn: () => api<VoxLedger>('/me/vox-transactions'),
  });
  const updateNotifications = useMutation({
    mutationFn: (next: Me['notifications']) =>
      api('/me/notifications', {
        method: 'PATCH',
        body: JSON.stringify({
          notificationsEnabled: next.enabled,
          notifyNewVotes: next.newVotes,
          notifyVoteEnding: next.voteEnding,
          notifyResults: next.results,
        }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['notification-preferences'] });
      void client.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const preferences = notificationPreferences.data ?? me.notifications;
  const toggle = (key: keyof Me['notifications']) => {
    updateNotifications.mutate({ ...preferences, [key]: !preferences[key] });
  };
  return (
    <div className={`${styles.page} ${styles.stack}`}>
      <div className={styles.profileHero}>
        <div className={styles.profileIdentity}>
          <div className={styles.avatar}>{me.firstName[0]}</div>
          <div>
            <small>MYVOICE MEMBER</small>
            <h1>
              {me.firstName} {me.lastName}
            </h1>
            <span>{me.username ? `@${me.username}` : 'Telegram user'}</span>
          </div>
        </div>
        <div className={styles.profileBalance}>
          <small>{t('home.balance')}</small>
          <strong>{me.balance.toLocaleString(i18n.language)}</strong>
          <span>VOX</span>
        </div>
      </div>
      <div className={styles.profileStatGrid}>
        <div>
          <VoteIcon />
          <span>{t('home.votes')}</span>
          <strong>{me.ownVotes}</strong>
        </div>
        <div>
          <Activity />
          <span>{t('home.activity')}</span>
          <strong>{me.activityRate}%</strong>
        </div>
        <div>
          <UsersRound />
          <span>{t('home.referrals')}</span>
          <strong>{me.referralCount}</strong>
        </div>
      </div>
      <div className={styles.profileList}>
        <div>
          <Clock3 />
          <span>{t('profile.memberSince')}</span>
          <strong>{dateTime(me.registeredAt, i18n.language)}</strong>
        </div>
      </div>
      <label className={styles.field}>
        <Languages />
        <span>{t('profile.language')}</span>
        <select
          value={me.language}
          onChange={(event) => language.mutate(event.target.value as 'en' | 'ru')}
        >
          <option value="en">{t('profile.english')}</option>
          <option value="ru">{t('profile.russian')}</option>
        </select>
      </label>
      <section className={styles.profileControlCenter}>
        <div className={styles.profileSectionTitle}>
          <span>
            <Bell size={19} />
            {t('profile.notifications')}
          </span>
          <small>{t('profile.notificationsHint')}</small>
        </div>
        {(
          [
            ['enabled', 'profile.notificationsAll'],
            ['newVotes', 'profile.notificationsNew'],
            ['voteEnding', 'profile.notificationsEnding'],
            ['results', 'profile.notificationsResults'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={styles.preferenceRow}
            role="switch"
            aria-checked={preferences[key]}
            disabled={updateNotifications.isPending || (key !== 'enabled' && !preferences.enabled)}
            onClick={() => toggle(key)}
          >
            <span>{t(label)}</span>
            <i data-active={preferences[key]}>
              <b />
            </i>
          </button>
        ))}
      </section>
      <section className={styles.voxCenter}>
        <div className={styles.profileSectionTitle}>
          <span>
            <Coins size={19} />
            {t('profile.voxCenter')}
          </span>
          <small>{t('profile.voxCenterHint')}</small>
        </div>
        <div className={styles.voxBreakdown}>
          {(
            [
              ['voting', 'profile.voxVoting'],
              ['referrals', 'profile.voxReferrals'],
              ['ads', 'profile.voxAds'],
              ['tasks', 'profile.voxTasks'],
              ['registration', 'profile.voxRegistration'],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <span>{t(label)}</span>
              <strong>+{vox.data?.summary[key] ?? 0}</strong>
            </div>
          ))}
        </div>
        <div className={styles.voxTimeline}>
          {vox.data?.items.slice(0, 6).map((transaction) => (
            <div key={transaction.id}>
              <span>
                <strong>{transaction.type.replaceAll('_', ' ')}</strong>
                <small>{dateTime(transaction.createdAt, i18n.language)}</small>
              </span>
              <b data-positive={transaction.amount >= 0}>
                {transaction.amount >= 0 ? '+' : ''}
                {transaction.amount}
              </b>
            </div>
          ))}
          {!vox.isLoading && !vox.data?.items.length && <p>{t('profile.voxEmpty')}</p>}
        </div>
      </section>
      <div className={styles.card}>
        <strong>{t('profile.documents')}</strong>
        <span>
          {t('auth.terms')} v{me.consent?.termsVersion} · {t('auth.privacy')} v
          {me.consent?.privacyVersion}
        </span>
      </div>
    </div>
  );
}

function SuggestPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const submit = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const data = new FormData(form);
      return api('/suggestions', {
        method: 'POST',
        body: JSON.stringify({
          language: me.language,
          title: data.get('title'),
          description: data.get('description'),
          optionOne: data.get('optionOne'),
          optionTwo: data.get('optionTwo'),
        }),
      });
    },
    onSuccess: () => setSent(true),
  });
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit.mutate(event.currentTarget);
  };
  return (
    <div className={`${styles.page} ${styles.stack}`}>
      <h1>{t('suggest.title')}</h1>
      <p>{t('suggest.description')}</p>
      {sent ? (
        <div className={styles.successCard}>
          <Check />
          {t('suggest.sent')}
        </div>
      ) : (
        <form className={styles.form} onSubmit={onSubmit}>
          <label>
            Title
            <input required minLength={10} maxLength={240} name="title" />
          </label>
          <label>
            {t('suggest.voteDescription')}
            <textarea required minLength={30} maxLength={3000} name="description" />
          </label>
          <label>
            {t('suggest.optionOne')}
            <input required maxLength={160} name="optionOne" />
          </label>
          <label>
            {t('suggest.optionTwo')}
            <input required maxLength={160} name="optionTwo" />
          </label>
          <button className={styles.primary}>{t('suggest.send')}</button>
        </form>
      )}
      {submit.error && <ErrorState error={submit.error} />}
    </div>
  );
}

function Legal({ type }: { type: 'terms' | 'privacy' }) {
  const russian = navigator.language.startsWith('ru');
  return (
    <article className={styles.legal}>
      <h1>
        {type === 'terms'
          ? russian
            ? 'Пользовательское соглашение'
            : 'Terms of Use'
          : russian
            ? 'Политика конфиденциальности'
            : 'Privacy Policy'}
      </h1>
      <small>Version 1.0 · 2026-07-28</small>
      <p>
        {russian
          ? 'MyVoice — сервис ежедневных коллективных голосований. VOX являются только игровыми баллами, не имеют денежной стоимости и не подлежат выводу или обмену.'
          : 'MyVoice is a daily collective voting service. VOX are in-app activity points only; they have no monetary value and cannot be withdrawn or exchanged.'}
      </p>
      <h2>{russian ? 'Данные и использование' : 'Data and use'}</h2>
      <p>
        {russian
          ? 'Мы обрабатываем данные профиля Telegram, голоса, активность, реферальные связи и технические журналы для работы сервиса, защиты от злоупотреблений и агрегированных результатов.'
          : 'We process Telegram profile data, votes, activity, referral relationships, and technical logs to operate the service, prevent abuse, and publish aggregate results.'}
      </p>
      <p>
        {russian
          ? 'Выбор в голосовании нельзя изменить. Индивидуальный выбор не публикуется другим пользователям. Администраторы не могут изменять отданные голоса или удалять журнал VOX.'
          : 'A submitted choice cannot be changed. Individual choices are not published to other users. Administrators cannot alter submitted votes or erase the VOX ledger.'}
      </p>
    </article>
  );
}

function TurnstileChallenge({
  siteKey,
  onToken,
  resetSignal,
}: {
  siteKey: string;
  onToken: (token: string) => void;
  resetSignal: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const render = () => {
      if (cancelled || !container.current || !window.turnstile || widgetId.current) return;
      widgetId.current = window.turnstile.render(container.current, {
        sitekey: siteKey,
        action: 'admin_login',
        theme: 'auto',
        size: 'flexible',
        callback: onToken,
        'expired-callback': () => onToken(''),
        'error-callback': () => onToken(''),
      });
    };
    const scriptId = 'myvoice-turnstile';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', render);
    render();
    return () => {
      cancelled = true;
      script?.removeEventListener('load', render);
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [onToken, siteKey]);

  useEffect(() => {
    if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
  }, [resetSignal]);

  return <div className={styles.turnstile} ref={container} aria-label="Security verification" />;
}

function AdminApp() {
  const [, refresh] = useState(0);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaConfigured, setCaptchaConfigured] = useState(false);
  const [captchaSiteKey, setCaptchaSiteKey] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaReset, setCaptchaReset] = useState(0);
  const [blockedSeconds, setBlockedSeconds] = useState(0);

  useEffect(() => {
    if (blockedSeconds <= 0) return;
    const timer = window.setInterval(
      () => setBlockedSeconds((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [blockedSeconds]);

  if (!hasAdminToken()) {
    const login = async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setPending(true);
      setError('');
      const data = new FormData(event.currentTarget);
      try {
        const result = await api<{ accessToken: string }>('/admin/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: data.get('email'),
            password: data.get('password'),
            ...(captchaToken ? { captchaToken } : {}),
          }),
        });
        setAdminToken(result.accessToken);
        refresh((x) => x + 1);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
        if (reason instanceof ApiError) {
          const required = reason.body.captchaRequired === true;
          const configured = reason.body.captchaConfigured === true;
          setCaptchaRequired(required);
          setCaptchaConfigured(configured);
          setCaptchaSiteKey(String(reason.body.captchaSiteKey ?? ''));
          setBlockedSeconds(Number(reason.body.retryAfterSeconds ?? 0));
        }
        setCaptchaToken('');
        setCaptchaReset((value) => value + 1);
        setPending(false);
      }
    };
    const needsToken = captchaRequired && captchaConfigured;
    return (
      <div className={styles.adminLogin}>
        <form className={`${styles.form} ${styles.adminLoginCard}`} onSubmit={login}>
          <div className={styles.brandMark}>MV</div>
          <div className={styles.adminLoginTitle}>
            <small>SECURE CONSOLE</small>
            <h1>MyVoice Admin</h1>
            <p>Use your administrator credentials to continue.</p>
          </div>
          <label>
            Email
            <input type="email" name="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input type="password" name="password" autoComplete="current-password" required />
          </label>
          {needsToken && captchaSiteKey && (
            <TurnstileChallenge
              siteKey={captchaSiteKey}
              onToken={setCaptchaToken}
              resetSignal={captchaReset}
            />
          )}
          {captchaRequired && !captchaConfigured && (
            <span className={styles.securityNotice}>
              CAPTCHA is not configured. Login throttling remains active.
            </span>
          )}
          {blockedSeconds > 0 && (
            <span className={styles.securityNotice}>
              Try again in {Math.ceil(blockedSeconds / 60)} min.
            </span>
          )}
          <button
            className={styles.primary}
            disabled={pending || blockedSeconds > 0 || (needsToken && !captchaToken)}
          >
            {pending ? 'Checking…' : 'Sign in'}
          </button>
          {error && (
            <span className={styles.errorText} role="alert">
              {error}
            </span>
          )}
        </form>
      </div>
    );
  }
  return <AdminDashboard />;
}

function AdminDashboard() {
  const [tab, setTab] = useState<
    'metrics' | 'users' | 'votes' | 'ads' | 'suggestions' | 'reports' | 'security'
  >('metrics');
  const metrics = useQuery({
    queryKey: ['admin-metrics'],
    queryFn: () => api<Record<string, number>>('/admin/metrics', {}, true),
  });
  const votes = useQuery({
    queryKey: ['admin-votes'],
    queryFn: () => api<AdminVote[]>('/admin/votes', {}, true),
  });
  const suggestions = useQuery({
    queryKey: ['admin-suggestions'],
    queryFn: () => api<any[]>('/admin/suggestions', {}, true),
  });
  const ads = useQuery({
    queryKey: ['admin-ads'],
    queryFn: () => api<AdminAd[]>('/admin/ads', {}, true),
  });
  const reports = useQuery({
    queryKey: ['admin-reports'],
    queryFn: () => api<AdminVoteReport[]>('/admin/reports?status=PENDING', {}, true),
  });
  const labels: Record<string, string> = {
    totalUsers: 'Registered users',
    active1d: 'Active · 24h',
    active7d: 'Active · 7 days',
    active30d: 'Active · 30 days',
    currentVoteParticipants: 'Current participants',
    currentParticipationPercent: 'Participation %',
    activityAtLeast80: 'Activity ≥ 80%',
    referrals: 'Referrals',
    voxAwarded: 'VOX awarded',
    blocked: 'Blocked',
  };
  return (
    <div className={styles.admin}>
      <aside>
        <h1>MyVoice</h1>
        {(['metrics', 'users', 'votes', 'ads', 'suggestions', 'reports', 'security'] as const).map(
          (value) => (
            <button data-active={tab === value} onClick={() => setTab(value)} key={value}>
              {value}
            </button>
          ),
        )}
      </aside>
      <main>
        <header>
          <span>Administration</span>
          <strong>Secure console</strong>
        </header>
        {tab === 'metrics' && (
          <div className={styles.adminGrid}>
            {Object.entries(metrics.data ?? {}).map(([key, value]) => (
              <div key={key}>
                <span>{labels[key] ?? key}</span>
                <strong>{value.toLocaleString()}</strong>
              </div>
            ))}
          </div>
        )}
        {tab === 'users' && <AdminUsersManager />}
        {tab === 'votes' && (
          <>
            <AdminContentCalendar votes={votes.data ?? []} />
            <VoteComposer onSaved={() => void votes.refetch()} />
            <div className={`${styles.adminTable} ${styles.adminVoteTable}`}>
              {votes.data?.map((vote) => (
                <AdminVoteRow key={vote.id} vote={vote} onDeleted={() => votes.refetch()} />
              ))}
              {!votes.data?.length && <div className={styles.adminEmpty}>No votes yet.</div>}
            </div>
          </>
        )}
        {tab === 'reports' && (
          <AdminReportsPanel
            reports={reports.data ?? []}
            onChanged={() => void reports.refetch()}
          />
        )}
        {tab === 'ads' && <AdManager ads={ads.data ?? []} onChanged={() => void ads.refetch()} />}
        {tab === 'suggestions' && (
          <div className={styles.adminTable}>
            {suggestions.data?.map((item) => (
              <div key={item.id}>
                <span>
                  {item.translations[0]?.title}
                  <small>{item.user.firstName}</small>
                </span>
                <em>{item.status}</em>
              </div>
            ))}
            {!suggestions.data?.length && (
              <div className={styles.adminEmpty}>No suggestions yet.</div>
            )}
          </div>
        )}
        {tab === 'security' && <SecurityPanel />}
      </main>
    </div>
  );
}

function AdminUsersManager() {
  const [draftSearch, setDraftSearch] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AdminUserSummary | null>(null);
  const users = useQuery({
    queryKey: ['admin-users', search],
    queryFn: () =>
      api<{ items: AdminUserSummary[] }>(
        `/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`,
        {},
        true,
      ),
  });
  const refresh = () => {
    void users.refetch();
  };
  return (
    <section className={styles.voxAdmin}>
      <div className={styles.voxAdminHero}>
        <div>
          <small>VOX CONTROL</small>
          <h2>User balances</h2>
          <p>Find a user, add or remove VOX, and inspect the immutable transaction history.</p>
        </div>
        <form
          className={styles.adminUserSearch}
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(draftSearch.trim());
          }}
        >
          <Search />
          <input
            value={draftSearch}
            onChange={(event) => setDraftSearch(event.target.value)}
            placeholder="Telegram ID, @username or UUID"
          />
          <button>Search</button>
        </form>
      </div>
      {users.isLoading && <div className={styles.skeleton} />}
      {users.error && <ErrorState error={users.error} />}
      <div className={styles.adminUserCards}>
        {users.data?.items.map((user) => (
          <article className={styles.adminUserCard} key={user.id}>
            <span className={styles.adminUserAvatar}>{user.firstName.slice(0, 1)}</span>
            <div className={styles.adminUserIdentity}>
              <small>@{user.username ?? '—'}</small>
              <strong>{user.firstName}</strong>
              <code>{user.telegramId}</code>
            </div>
            <div className={styles.adminUserBalance}>
              <small>Balance</small>
              <strong>{user.voxBalance.toLocaleString()} VOX</strong>
            </div>
            <div className={styles.adminUserMeta}>
              <span>Activity {Number(user.activityRate)}%</span>
              <em data-status={user.status}>{user.status}</em>
            </div>
            <button className={styles.manageVoxButton} onClick={() => setSelected(user)}>
              <Coins /> Manage VOX
            </button>
          </article>
        ))}
        {!users.isLoading && !users.data?.items.length && (
          <div className={styles.adminEmpty}>No users match this search.</div>
        )}
      </div>
      {selected && (
        <VoxManagerDialog
          user={selected}
          onClose={() => setSelected(null)}
          onChanged={(balance, status) => {
            setSelected((current) =>
              current
                ? { ...current, voxBalance: balance, status: status ?? current.status }
                : null,
            );
            refresh();
          }}
        />
      )}
    </section>
  );
}

function VoxManagerDialog({
  user,
  onClose,
  onChanged,
}: {
  user: AdminUserSummary;
  onClose: () => void;
  onChanged: (balance: number, status?: string) => void;
}) {
  const [mode, setMode] = useState<'ADD' | 'REMOVE'>('ADD');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const ledger = useQuery({
    queryKey: ['admin-vox-ledger', user.id],
    queryFn: () => api<AdminVoxTransaction[]>(`/admin/users/${user.id}/vox-transactions`, {}, true),
  });
  const adjust = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const absolute = Math.abs(Number(form.get('amount')));
    if (!Number.isInteger(absolute) || absolute <= 0) {
      setError('Enter a whole VOX amount greater than zero.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const transaction = await api<AdminVoxTransaction>(
        `/admin/users/${user.id}/vox-adjustment`,
        {
          method: 'POST',
          body: JSON.stringify({
            amount: mode === 'ADD' ? absolute : -absolute,
            comment: String(form.get('comment') ?? '').trim(),
            idempotencyKey: crypto.randomUUID(),
          }),
        },
        true,
      );
      setMessage(
        `${mode === 'ADD' ? 'Added' : 'Removed'} ${absolute.toLocaleString()} VOX. New balance: ${transaction.balanceAfter.toLocaleString()} VOX.`,
      );
      onChanged(transaction.balanceAfter);
      event.currentTarget.reset();
      void ledger.refetch();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };
  const toggleBlock = async () => {
    setSaving(true);
    setError('');
    try {
      const next = user.status === 'BLOCKED' ? 'ACTIVE' : 'BLOCKED';
      await api(
        `/admin/users/${user.id}/${user.status === 'BLOCKED' ? 'unblock' : 'block'}`,
        { method: 'POST' },
        true,
      );
      onChanged(user.voxBalance, next);
      setMessage(next === 'BLOCKED' ? 'User blocked.' : 'User unblocked.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };
  return createPortal(
    <div className={styles.voxDialogBackdrop} role="presentation">
      <section className={styles.voxDialog} role="dialog" aria-modal="true">
        <header>
          <div>
            <small>MANAGE USER</small>
            <h2>{user.firstName}</h2>
            <span>
              @{user.username ?? '—'} · {user.telegramId}
            </span>
          </div>
          <button onClick={onClose} aria-label="Close">
            <X />
          </button>
        </header>
        <div className={styles.voxBalancePanel}>
          <Coins />
          <div>
            <small>Current balance</small>
            <strong>{user.voxBalance.toLocaleString()} VOX</strong>
          </div>
          <button disabled={saving} onClick={() => void toggleBlock()}>
            {user.status === 'BLOCKED' ? 'Unblock' : 'Block user'}
          </button>
        </div>
        <form className={styles.voxAdjustmentForm} onSubmit={adjust}>
          <div className={styles.voxModeSwitch}>
            <button type="button" data-active={mode === 'ADD'} onClick={() => setMode('ADD')}>
              Add VOX
            </button>
            <button type="button" data-active={mode === 'REMOVE'} onClick={() => setMode('REMOVE')}>
              Remove VOX
            </button>
          </div>
          <label>
            Amount
            <input name="amount" type="number" min="1" step="1" required />
          </label>
          <label>
            Required reason
            <textarea
              name="comment"
              minLength={5}
              maxLength={500}
              placeholder="Why is this balance being changed?"
              required
            />
          </label>
          <button className={styles.primary} disabled={saving}>
            {saving ? 'Saving…' : mode === 'ADD' ? 'Add VOX' : 'Remove VOX'}
          </button>
          {message && <span className={styles.voxSuccess}>{message}</span>}
          {error && <span className={styles.errorText}>{error}</span>}
        </form>
        <div className={styles.voxLedger}>
          <div className={styles.voxLedgerHeading}>
            <strong>VOX transaction history</strong>
            <small>Immutable ledger</small>
          </div>
          {ledger.isLoading && <div className={styles.skeleton} />}
          {ledger.data?.map((transaction) => (
            <div key={transaction.id}>
              <span data-positive={transaction.amount > 0}>
                {transaction.amount > 0 ? '+' : ''}
                {transaction.amount}
              </span>
              <div>
                <strong>{transaction.type.replaceAll('_', ' ')}</strong>
                <small>{transaction.comment}</small>
              </div>
              <time>{dateTime(transaction.createdAt, 'en')}</time>
            </div>
          ))}
          {!ledger.isLoading && !ledger.data?.length && (
            <p className={styles.adminEmpty}>No VOX transactions yet.</p>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function AdminContentCalendar({ votes }: { votes: AdminVote[] }) {
  const days = new Map<string, AdminVote[]>();
  [...votes]
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .forEach((vote) => {
      const key = new Date(vote.startsAt).toLocaleDateString('en', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      days.set(key, [...(days.get(key) ?? []), vote]);
    });
  return (
    <section className={styles.contentCalendar}>
      <header>
        <span>
          <CalendarDays /> Content calendar
        </span>
        <small>{votes.length} planned and published votes</small>
      </header>
      <div>
        {[...days.entries()].slice(0, 8).map(([day, items]) => (
          <article key={day}>
            <strong>{day}</strong>
            {items.map((vote) => (
              <span key={vote.id} data-status={vote.status}>
                <time>
                  {new Date(vote.startsAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
                {vote.translations.find((row) => row.language === 'en')?.title ?? 'Untitled'}
                <em>{vote.status}</em>
              </span>
            ))}
          </article>
        ))}
        {!days.size && <p className={styles.adminEmpty}>The content calendar is empty.</p>}
      </div>
    </section>
  );
}

function AdminReportsPanel({
  reports,
  onChanged,
}: {
  reports: AdminVoteReport[];
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const decide = async (id: string, decision: 'resolve' | 'dismiss') => {
    setPending(id);
    try {
      await api(`/admin/reports/${id}/${decision}`, { method: 'POST' }, true);
      onChanged();
    } finally {
      setPending(null);
    }
  };
  return (
    <section className={styles.adminReports}>
      <header>
        <div>
          <small>TRUST & SAFETY</small>
          <h2>Vote reports</h2>
          <p>Review participant feedback without changing stored votes or completed results.</p>
        </div>
        <Flag />
      </header>
      {reports.map((report) => (
        <article key={report.id}>
          <div>
            <small>
              {report.reason.replaceAll('_', ' ')} · {dateTime(report.createdAt, 'en')}
            </small>
            <strong>
              {report.vote.translations.find((row) => row.language === 'en')?.title ?? 'Vote'}
            </strong>
            <p>{report.details || 'No additional details.'}</p>
            <span>
              From {report.user.firstName}
              {report.user.username ? ` · @${report.user.username}` : ''}
            </span>
          </div>
          <div>
            <button
              disabled={pending === report.id}
              onClick={() => void decide(report.id, 'dismiss')}
            >
              Dismiss
            </button>
            <button
              disabled={pending === report.id}
              onClick={() => void decide(report.id, 'resolve')}
            >
              Resolve
            </button>
          </div>
        </article>
      ))}
      {!reports.length && <div className={styles.adminEmpty}>No pending reports.</div>}
    </section>
  );
}

function AdminVotePreview({ vote, onClose }: { vote: AdminVote; onClose: () => void }) {
  const translation =
    vote.translations.find((row) => row.language === 'en') ?? vote.translations[0];
  return createPortal(
    <div
      className={styles.adminDialogBackdrop}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className={`${styles.adminDialog} ${styles.adminVotePreview}`}
        role="dialog"
        aria-modal="true"
      >
        <div className={styles.adminPreviewPhone}>
          <small>VOICE ARENA · PREVIEW</small>
          <h2>{translation?.title}</h2>
          <p>{translation?.description}</p>
          {translation?.context && (
            <aside>
              <BookOpen />
              {translation.context}
            </aside>
          )}
          {vote.options.map((option) => (
            <button key={option.id} type="button">
              <b>{option.position === 1 ? 'A' : 'B'}</b>
              {option.translations.find((row) => row.language === 'en')?.text}
            </button>
          ))}
          {vote.sources.length > 0 && (
            <footer>
              {vote.sources.filter((source) => source.language === 'en').length} sources attached
            </footer>
          )}
        </div>
        <button className={styles.secondary} onClick={onClose}>
          Close preview
        </button>
      </section>
    </div>,
    document.body,
  );
}

function AdminVoteRow({ vote, onDeleted }: { vote: AdminVote; onDeleted: () => Promise<unknown> }) {
  const [confirming, setConfirming] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const title =
    vote.translations.find((translation) => translation.language === 'en')?.title ??
    'Untitled vote';
  const remove = async () => {
    setDeleting(true);
    setError('');
    try {
      await api<{ deleted: boolean }>(`/admin/votes/${vote.id}`, { method: 'DELETE' }, true);
      setConfirming(false);
      await onDeleted();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setDeleting(false);
    }
  };
  return (
    <div className={styles.adminVoteRow}>
      <span>
        {title}
        <small>{new Date(vote.startsAt).toLocaleString()}</small>
        <small>
          Winner +{vote.winnerReward} · loser +{vote.loserReward} VOX
        </small>
      </span>
      <em>{vote.status}</em>
      <strong>{vote.participantCount} votes</strong>
      <button
        className={styles.previewVoteButton}
        title="Preview vote"
        onClick={() => setPreviewing(true)}
      >
        <Eye size={16} />
        Preview
      </button>
      <button
        className={styles.deleteVoteButton}
        title="Delete vote"
        onClick={() => setConfirming(true)}
      >
        <Trash2 size={16} />
        Delete
      </button>
      {confirming &&
        createPortal(
          <div
            className={styles.adminDialogBackdrop}
            onMouseDown={(event) => {
              if (event.currentTarget === event.target && !deleting) setConfirming(false);
            }}
          >
            <section
              className={styles.adminDialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby={`delete-vote-${vote.id}`}
            >
              <span className={styles.adminDialogIcon}>
                <AlertTriangle />
              </span>
              <p className={styles.eyebrow}>Permanent admin action</p>
              <h2 id={`delete-vote-${vote.id}`}>Delete this vote?</h2>
              <p>
                <strong>{title}</strong> will disappear from MyVoice. Existing votes, results, and
                the VOX ledger will remain stored for integrity.
              </p>
              {error && (
                <span className={styles.errorText} role="alert">
                  {error}
                </span>
              )}
              <div className={styles.adminDialogActions}>
                <button
                  className={styles.secondary}
                  disabled={deleting}
                  onClick={() => setConfirming(false)}
                >
                  Keep vote
                </button>
                <button
                  className={styles.confirmDeleteButton}
                  disabled={deleting}
                  onClick={() => void remove()}
                >
                  {deleting ? 'Deleting…' : 'Delete vote'}
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )}
      {previewing && <AdminVotePreview vote={vote} onClose={() => setPreviewing(false)} />}
    </div>
  );
}

function AdManager({ ads, onChanged }: { ads: AdminAd[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'BANNER' | 'REWARDED'>('BANNER');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [imagePreview, setImagePreview] = useState('');
  const [imageName, setImageName] = useState('');
  const defaultStartsAt = localDateTimeInput(new Date());
  const defaultEndsAt = localDateTimeInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000));
  useEffect(
    () => () => {
      if (imagePreview.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
    },
    [imagePreview],
  );
  const optional = (value: FormDataEntryValue | null) => {
    const text = String(value ?? '').trim();
    return text || undefined;
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    setMessage('');
    const data = new FormData(form);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const publish = submitter?.value === 'publish';
    try {
      let imageUrl = optional(data.get('imageUrl'));
      const imageFile = data.get('imageFile');
      if (imageFile instanceof File && imageFile.size > 0) {
        if (imageFile.size > 5 * 1024 * 1024) throw new Error('Image must be 5 MB or smaller.');
        const upload = new FormData();
        upload.append('image', imageFile);
        const uploaded = await api<{ url: string }>(
          '/admin/media/images',
          {
            method: 'POST',
            body: upload,
          },
          true,
        );
        imageUrl = uploaded.url;
      }
      const campaign = await api<{ id: string }>(
        '/admin/ads',
        {
          method: 'POST',
          body: JSON.stringify({
            type,
            startsAt: new Date(String(data.get('startsAt'))).toISOString(),
            endsAt: optional(data.get('endsAt'))
              ? new Date(String(data.get('endsAt'))).toISOString()
              : undefined,
            imageUrl,
            mediaUrl: optional(data.get('mediaUrl')),
            targetUrl: optional(data.get('targetUrl')),
            rewardVox: type === 'REWARDED' ? Number(data.get('rewardVox')) : 0,
            minimumWatchSeconds: type === 'REWARDED' ? Number(data.get('minimumWatchSeconds')) : 0,
            dailyRewardLimit: type === 'REWARDED' ? Number(data.get('dailyRewardLimit')) : 1,
            translations: [
              {
                language: 'en',
                title: data.get('titleEn'),
                description: data.get('descriptionEn'),
                actionLabel: data.get('actionEn'),
              },
              {
                language: 'ru',
                title: data.get('titleRu'),
                description: data.get('descriptionRu'),
                actionLabel: data.get('actionRu'),
              },
            ],
          }),
        },
        true,
      );
      if (publish) {
        await api(`/admin/ads/${campaign.id}/activate`, { method: 'POST' }, true);
      }
      setMessage(
        publish
          ? 'Campaign published. It will appear during the selected display period.'
          : 'Draft saved. Publish it when you are ready.',
      );
      setOpen(false);
      form.reset();
      setImagePreview('');
      setImageName('');
      onChanged();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className={styles.adManager}>
      <div className={styles.adManagerHead}>
        <div>
          <small>MONETIZATION</small>
          <h2>Advertising campaigns</h2>
          <p>Create native banners and optional VOX rewards for watched videos.</p>
        </div>
        <button className={styles.primary} onClick={() => setOpen((value) => !value)}>
          {open ? 'Close' : 'Create campaign'}
        </button>
      </div>
      {message && <div className={styles.adminNotice}>{message}</div>}
      {open && (
        <form className={`${styles.form} ${styles.adComposer}`} onSubmit={save}>
          <div className={styles.adTypeChoice}>
            <button type="button" data-active={type === 'BANNER'} onClick={() => setType('BANNER')}>
              <Megaphone />
              Banner<span>Image, text and link</span>
            </button>
            <button
              type="button"
              data-active={type === 'REWARDED'}
              onClick={() => setType('REWARDED')}
            >
              <Gift />
              Rewarded video<span>Watch and receive VOX</span>
            </button>
          </div>
          <div className={styles.twoCols}>
            <label>
              Starts (local)
              <input
                type="datetime-local"
                name="startsAt"
                defaultValue={defaultStartsAt}
                required
              />
            </label>
            <label>
              Ends (optional)
              <input type="datetime-local" name="endsAt" defaultValue={defaultEndsAt} />
            </label>
          </div>
          <div className={styles.adScheduleHint}>
            <Clock3 />
            <div>
              <strong>Display period</strong>
              <span>
                Times use your current local timezone. The suggested period is seven days.
              </span>
            </div>
          </div>
          <section className={styles.adArtworkUpload}>
            <div className={styles.adArtworkHeading}>
              <div>
                <small>CAMPAIGN ARTWORK</small>
                <strong>Upload a banner image</strong>
              </div>
              <span>Recommended · 16:7</span>
            </div>
            <label
              className={styles.adArtworkStage}
              data-filled={Boolean(imagePreview)}
              style={imagePreview ? { backgroundImage: `url("${imagePreview}")` } : undefined}
            >
              <input
                type="file"
                name="imageFile"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (file.size > 5 * 1024 * 1024) {
                    event.target.value = '';
                    setMessage('Image must be 5 MB or smaller.');
                    return;
                  }
                  setMessage('');
                  setImageName(file.name);
                  setImagePreview(URL.createObjectURL(file));
                }}
              />
              <span className={styles.adArtworkPrompt}>
                <ImagePlus />
                <strong>{imageName || 'Choose a photo'}</strong>
                <small>JPEG, PNG or WebP · up to 5 MB</small>
              </span>
              {imagePreview && <i>Tap to replace</i>}
            </label>
            <p>The server optimizes the image and removes hidden metadata automatically.</p>
            <details className={styles.adUrlFallback}>
              <summary>Use an existing HTTPS image instead</summary>
              <label>
                Image URL
                <input
                  type="url"
                  name="imageUrl"
                  placeholder="https://…/banner.jpg"
                  onChange={(event) => {
                    if (!imageName) setImagePreview(event.target.value.trim());
                  }}
                />
              </label>
            </details>
          </section>
          {type === 'BANNER' ? (
            <label>
              Destination URL (HTTPS)
              <input
                type="url"
                name="targetUrl"
                required
                placeholder="https://advertiser.example"
              />
            </label>
          ) : (
            <>
              <label>
                Video URL (HTTPS, MP4/WebM)
                <input type="url" name="mediaUrl" required placeholder="https://…/advert.mp4" />
              </label>
              <div className={styles.threeCols}>
                <label>
                  Reward, VOX
                  <input
                    type="number"
                    name="rewardVox"
                    min="1"
                    max="1000000"
                    defaultValue="5"
                    required
                  />
                </label>
                <label>
                  Watch seconds
                  <input
                    type="number"
                    name="minimumWatchSeconds"
                    min="5"
                    max="3600"
                    defaultValue="15"
                    required
                  />
                </label>
                <label>
                  Daily limit
                  <input
                    type="number"
                    name="dailyRewardLimit"
                    min="1"
                    max="100"
                    defaultValue="1"
                    required
                  />
                </label>
              </div>
            </>
          )}
          <div className={styles.translationPanel}>
            <strong>English</strong>
            <label>
              Title
              <input name="titleEn" minLength={2} maxLength={160} required />
            </label>
            <label>
              Description
              <textarea name="descriptionEn" minLength={2} maxLength={500} required />
            </label>
            <label>
              Button text
              <input
                name="actionEn"
                minLength={2}
                maxLength={80}
                defaultValue={type === 'BANNER' ? 'Learn more' : 'Watch and earn'}
                required
              />
            </label>
          </div>
          <div className={styles.translationPanel}>
            <strong>Русский</strong>
            <label>
              Заголовок
              <input name="titleRu" minLength={2} maxLength={160} required />
            </label>
            <label>
              Описание
              <textarea name="descriptionRu" minLength={2} maxLength={500} required />
            </label>
            <label>
              Текст кнопки
              <input
                name="actionRu"
                minLength={2}
                maxLength={80}
                defaultValue={type === 'BANNER' ? 'Подробнее' : 'Смотреть и получить'}
                required
              />
            </label>
          </div>
          <div className={styles.adPublishActions}>
            <button className={styles.secondary} name="intent" value="draft" disabled={saving}>
              Save as draft
            </button>
            <button className={styles.primary} name="intent" value="publish" disabled={saving}>
              {saving ? 'Publishing…' : 'Create and publish'}
            </button>
          </div>
        </form>
      )}
      <div className={styles.adAdminGrid}>
        {ads.map((ad) => (
          <AdminAdCard key={ad.id} ad={ad} onChanged={onChanged} />
        ))}
        {!ads.length && <div className={styles.adminEmpty}>No advertising campaigns yet.</div>}
      </div>
    </section>
  );
}

function AdminAdCard({ ad, onChanged }: { ad: AdminAd; onChanged: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const translation = ad.translations.find((item) => item.language === 'en') ?? ad.translations[0];
  const now = Date.now();
  const startsAt = new Date(ad.startsAt).getTime();
  const endsAt = ad.endsAt ? new Date(ad.endsAt).getTime() : null;
  const expired = endsAt !== null && endsAt <= now;
  const scheduled = ad.status === 'ACTIVE' && startsAt > now;
  const live = ad.status === 'ACTIVE' && startsAt <= now && !expired;
  const displayStatus = expired
    ? 'EXPIRED'
    : scheduled
      ? 'SCHEDULED'
      : live
        ? 'LIVE NOW'
        : ad.status;
  const action = async (name: 'activate' | 'pause' | 'delete') => {
    if (
      name === 'delete' &&
      !window.confirm('Delete this campaign? Its reward ledger will remain stored.')
    )
      return;
    setPending(true);
    setError('');
    try {
      await api(
        `/admin/ads/${ad.id}${name === 'delete' ? '' : `/${name}`}`,
        { method: name === 'delete' ? 'DELETE' : 'POST' },
        true,
      );
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  };
  return (
    <article className={styles.adminAdCard}>
      <div
        className={styles.adminAdPreview}
        style={ad.imageUrl ? { backgroundImage: `url("${ad.imageUrl}")` } : undefined}
      >
        <span>{ad.type === 'BANNER' ? <Megaphone /> : <Gift />}</span>
        <em data-state={live ? 'live' : expired ? 'expired' : scheduled ? 'scheduled' : 'idle'}>
          {displayStatus}
        </em>
      </div>
      <div className={styles.adminAdBody}>
        <small>{ad.type}</small>
        <h3>{translation?.title ?? 'Untitled campaign'}</h3>
        <p>{translation?.description}</p>
        <div className={styles.adScheduleSummary} data-expired={expired}>
          <Clock3 />
          <div>
            <span>
              Starts <strong>{dateTime(ad.startsAt, 'en')}</strong>
            </span>
            <span>
              Ends <strong>{ad.endsAt ? dateTime(ad.endsAt, 'en') : 'No end date'}</strong>
            </span>
          </div>
        </div>
        {ad.status === 'DRAFT' && !expired && (
          <div className={styles.adStateNotice}>Drafts are not visible until published.</div>
        )}
        {expired && (
          <div className={styles.adStateNotice} data-error="true">
            This display period has ended. Create a campaign with a future end time.
          </div>
        )}
        <div className={styles.adMetrics}>
          <span>
            Views <strong>{ad.impressionCount}</strong>
          </span>
          <span>
            Clicks <strong>{ad.clickCount}</strong>
          </span>
          <span>
            Rewards <strong>{ad.rewardCount}</strong>
          </span>
        </div>
        {ad.type === 'REWARDED' && (
          <div className={styles.rewardRule}>
            +{ad.rewardVox} VOX · {ad.minimumWatchSeconds}s · {ad.dailyRewardLimit}/day
          </div>
        )}
        {error && <span className={styles.errorText}>{error}</span>}
        <div className={styles.adminAdActions}>
          {ad.status !== 'ACTIVE' ? (
            <button disabled={pending || expired} onClick={() => void action('activate')}>
              Publish
            </button>
          ) : (
            <button disabled={pending} onClick={() => void action('pause')}>
              Pause
            </button>
          )}
          <button
            className={styles.deleteVoteButton}
            disabled={pending}
            onClick={() => void action('delete')}
          >
            <Trash2 size={15} />
            Delete
          </button>
        </div>
      </div>
    </article>
  );
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
      await api(
        '/admin/auth/change-password',
        {
          method: 'POST',
          body: JSON.stringify({ currentPassword, newPassword }),
        },
        true,
      );
      clearAdminToken();
      window.location.replace('/admin');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSaving(false);
    }
  };
  return (
    <section className={styles.securityPanel}>
      <div className={styles.securityIntro}>
        <span className={styles.securityIcon}>
          <ShieldCheck />
        </span>
        <div>
          <small>Permanent admin address</small>
          <code>{window.location.origin}/admin</code>
        </div>
        <strong>
          <Check size={16} />
          HTTPS active
        </strong>
      </div>
      <div className={styles.securityContent}>
        <div>
          <p className={styles.eyebrow}>Access credentials</p>
          <h2>Change administrator password</h2>
          <p>
            Use a password created only for MyVoice. After the change, this browser signs out so you
            can verify the new password immediately.
          </p>
        </div>
        <form className={`${styles.form} ${styles.securityForm}`} onSubmit={changePassword}>
          <label>
            Current password
            <input
              type="password"
              name="currentPassword"
              autoComplete="current-password"
              required
              minLength={8}
              maxLength={200}
            />
          </label>
          <label>
            New password
            <input
              type="password"
              name="newPassword"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              name="confirmation"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
          </label>
          <p className={styles.securityHint}>
            At least 12 characters with uppercase, lowercase, a number, and a symbol.
          </p>
          {error && (
            <span className={styles.errorText} role="alert">
              {error}
            </span>
          )}
          <button className={styles.primary} disabled={saving}>
            {saving ? 'Changing password…' : 'Change password and sign out'}
          </button>
        </form>
      </div>
    </section>
  );
}

function VoteComposer({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState({
    title: '',
    description: '',
    one: '',
    two: '',
    context: '',
  });
  const syncPreview = (event: FormEvent<HTMLFormElement>) => {
    const data = new FormData(event.currentTarget);
    setPreview({
      title: String(data.get('titleEn') ?? ''),
      description: String(data.get('descriptionEn') ?? ''),
      context: String(data.get('contextEn') ?? ''),
      one: String(data.get('oneEn') ?? ''),
      two: String(data.get('twoEn') ?? ''),
    });
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const vote = await api<{ id: string }>(
        '/admin/votes',
        {
          method: 'POST',
          body: JSON.stringify({
            startsAt: new Date(String(data.get('startsAt'))).toISOString(),
            endsAt: new Date(String(data.get('endsAt'))).toISOString(),
            winnerReward: Number(data.get('winnerReward')),
            loserReward: Number(data.get('loserReward')),
            translations: [
              {
                language: 'en',
                title: data.get('titleEn'),
                description: data.get('descriptionEn'),
                context: data.get('contextEn'),
              },
              {
                language: 'ru',
                title: data.get('titleRu'),
                description: data.get('descriptionRu'),
                context: data.get('contextRu'),
              },
            ],
            sources: [
              {
                language: 'en',
                label: data.get('sourceLabelEn'),
                url: data.get('sourceUrlEn'),
                position: 1,
              },
              {
                language: 'ru',
                label: data.get('sourceLabelRu'),
                url: data.get('sourceUrlRu'),
                position: 1,
              },
            ].filter(
              (source) => String(source.label ?? '').trim() && String(source.url ?? '').trim(),
            ),
            options: [
              {
                position: 1,
                translations: [
                  { language: 'en', text: data.get('oneEn') },
                  { language: 'ru', text: data.get('oneRu') },
                ],
              },
              {
                position: 2,
                translations: [
                  { language: 'en', text: data.get('twoEn') },
                  { language: 'ru', text: data.get('twoRu') },
                ],
              },
            ],
          }),
        },
        true,
      );
      await api(`/admin/votes/${vote.id}/schedule`, { method: 'POST' }, true);
      setMessage('Vote scheduled');
      setOpen(false);
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <section className={styles.composer}>
      <button className={styles.primary} onClick={() => setOpen(!open)}>
        Create vote
      </button>
      {message && <span>{message}</span>}
      {open && (
        <form className={styles.form} onSubmit={save} onInput={syncPreview}>
          <div className={styles.twoCols}>
            <label>
              Starts (local)
              <input type="datetime-local" name="startsAt" required />
            </label>
            <label>
              Ends (local)
              <input type="datetime-local" name="endsAt" required />
            </label>
          </div>
          <div className={styles.rewardSettings}>
            <div>
              <small>Outcome rewards</small>
              <strong>Additional VOX after the result</strong>
            </div>
            <div className={styles.twoCols}>
              <label>
                Winner reward
                <input
                  type="number"
                  name="winnerReward"
                  min="0"
                  step="1"
                  defaultValue="0"
                  required
                />
              </label>
              <label>
                Loser reward
                <input
                  type="number"
                  name="loserReward"
                  min="0"
                  step="1"
                  defaultValue="0"
                  required
                />
              </label>
            </div>
            <p>
              Every participant still receives the base +10 VOX. A tie has no additional outcome
              reward.
            </p>
          </div>
          <label>
            English title
            <input name="titleEn" required minLength={3} maxLength={240} />
          </label>
          <label>
            English description
            <textarea name="descriptionEn" required minLength={10} maxLength={3000} />
          </label>
          <label>
            English context (optional)
            <textarea
              name="contextEn"
              maxLength={3000}
              placeholder="Neutral background needed to make an informed choice"
            />
          </label>
          <div className={styles.twoCols}>
            <label>
              Source label (EN)
              <input name="sourceLabelEn" maxLength={160} placeholder="Official report" />
            </label>
            <label>
              Source URL (EN)
              <input type="url" name="sourceUrlEn" maxLength={2000} placeholder="https://…" />
            </label>
          </div>
          <div className={styles.twoCols}>
            <label>
              Option 1<input name="oneEn" required maxLength={160} />
            </label>
            <label>
              Option 2<input name="twoEn" required maxLength={160} />
            </label>
          </div>
          <label>
            Русский заголовок
            <input name="titleRu" required minLength={3} maxLength={240} />
          </label>
          <label>
            Русское описание
            <textarea name="descriptionRu" required minLength={10} maxLength={3000} />
          </label>
          <label>
            Контекст на русском (необязательно)
            <textarea
              name="contextRu"
              maxLength={3000}
              placeholder="Нейтральная справка для осознанного выбора"
            />
          </label>
          <div className={styles.twoCols}>
            <label>
              Название источника (RU)
              <input name="sourceLabelRu" maxLength={160} placeholder="Официальный отчёт" />
            </label>
            <label>
              Ссылка на источник (RU)
              <input type="url" name="sourceUrlRu" maxLength={2000} placeholder="https://…" />
            </label>
          </div>
          <div className={styles.twoCols}>
            <label>
              Вариант 1<input name="oneRu" required maxLength={160} />
            </label>
            <label>
              Вариант 2<input name="twoRu" required maxLength={160} />
            </label>
          </div>
          <section className={styles.liveVotePreview}>
            <header>
              <Eye /> Live Mini App preview
            </header>
            <small>VOICE ARENA</small>
            <h3>{preview.title || 'Your question will appear here'}</h3>
            <p>
              {preview.description || 'The full description is shown before a participant chooses.'}
            </p>
            {preview.context && (
              <aside>
                <BookOpen />
                {preview.context}
              </aside>
            )}
            <button type="button">
              <b>A</b>
              {preview.one || 'First option'}
            </button>
            <button type="button">
              <b>B</b>
              {preview.two || 'Second option'}
            </button>
          </section>
          <button className={styles.primary}>Create and schedule</button>
        </form>
      )}
    </section>
  );
}

function UserApp() {
  const { i18n, t } = useTranslation();
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState('');
  const queryClient = useQueryClient();
  const initData = telegramInitData();
  useEffect(() => {
    if (!initData) return;
    api<{ accessToken: string; language: string }>('/auth/telegram', {
      method: 'POST',
      body: JSON.stringify({ initData }),
    })
      .then((data) => {
        setAccessToken(data.accessToken);
        void i18n.changeLanguage(data.language);
        setAuthenticated(true);
      })
      .catch((error) => setAuthError(error instanceof Error ? error.message : String(error)));
  }, [i18n, initData]);
  const me = useQuery({
    queryKey: ['me', authenticated],
    queryFn: () => api<Me>('/me'),
    enabled: authenticated,
  });
  const features = useQuery({
    queryKey: ['features'],
    queryFn: () => api<Features>('/system/features'),
  });
  const settings = useQuery({
    queryKey: ['public-settings'],
    queryFn: () =>
      api<{
        SIGNUP_REWARD?: number;
        BASE_VOTE_REWARD?: number;
        REFERRAL_MIN_ACTIVITY_PERCENT?: number;
      }>('/system/public-settings'),
  });
  const featureData = features.data ?? {
    suggestions: false,
    earlyVoteBonus: false,
    predictionRewards: false,
    tonWallet: false,
  };
  if (!initData)
    return (
      <div className={styles.centered}>
        <div className={styles.brandMark}>MV</div>
        <h1>MyVoice</h1>
        <p>{t('auth.openTelegram')}</p>
      </div>
    );
  if (authError)
    return (
      <div className={styles.centered}>
        <ErrorState error={authError} />
      </div>
    );
  if (!authenticated || me.isLoading)
    return (
      <div className={styles.centered}>
        <div className={styles.loader} />
        <span>{t('common.loading')}</span>
      </div>
    );
  if (me.error || !me.data)
    return (
      <div className={styles.centered}>
        <ErrorState error={me.error} />
      </div>
    );
  if (!me.data.registrationComplete)
    return (
      <Consent
        signupReward={settings.data?.SIGNUP_REWARD ?? 0}
        onDone={() => void queryClient.invalidateQueries({ queryKey: ['me'] })}
      />
    );
  return (
    <Shell features={featureData}>
      <Routes>
        <Route
          path="/"
          element={<Home me={me.data} voteReward={settings.data?.BASE_VOTE_REWARD ?? 0} />}
        />
        <Route
          path="/votes/:id"
          element={<VotePage voteReward={settings.data?.BASE_VOTE_REWARD ?? 0} />}
        />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/results/:id" element={<ResultPage />} />
        <Route
          path="/referrals"
          element={
            <ReferralsPage minimumActivity={settings.data?.REFERRAL_MIN_ACTIVITY_PERCENT ?? 0} />
          }
        />
        <Route path="/rating" element={<RatingPage me={me.data} />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/profile" element={<ProfilePage me={me.data} />} />
        {featureData.suggestions && (
          <Route path="/suggest" element={<SuggestPage me={me.data} />} />
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

export default function App() {
  const location = useLocation();
  if (location.pathname.startsWith('/admin')) return <AdminApp />;
  if (location.pathname === '/terms') return <Legal type="terms" />;
  if (location.pathname === '/privacy') return <Legal type="privacy" />;
  return <UserApp />;
}
