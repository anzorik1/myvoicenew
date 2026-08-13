import { PrismaClient } from '@prisma/client';
import { hash } from 'argon2';
import { RULES } from '@myvoice/config';

const prisma = new PrismaClient();

const IDS = {
  admin: '00000000-0000-4000-8000-000000000001',
  user1: '10000000-0000-4000-8000-000000000001',
  user2: '10000000-0000-4000-8000-000000000002',
  user3: '10000000-0000-4000-8000-000000000003',
  activeVote: '20000000-0000-4000-8000-000000000001',
  completedVote: '20000000-0000-4000-8000-000000000002',
};

async function main() {
  const adminPassword = process.env.ADMIN_SEED_PASSWORD ?? 'ChangeMe123!';
  const admin = await prisma.adminUser.upsert({
    where: { email: process.env.ADMIN_SEED_EMAIL ?? 'admin@myvoice.local' },
    // Never reset a password that an administrator changed after initial provisioning.
    update: {},
    create: {
      id: IDS.admin,
      email: process.env.ADMIN_SEED_EMAIL ?? 'admin@myvoice.local',
      passwordHash: await hash(adminPassword),
      displayName: 'MyVoice Administrator',
    },
  });

  await Promise.all(
    [
      ['SUGGESTIONS', false, RULES.SUGGESTIONS_USERS_THRESHOLD, true, 'Suggest a Vote'],
      ['EARLY_VOTE_BONUS', false, RULES.EARLY_REWARD_USERS_THRESHOLD, true, 'Early voters'],
      [
        'PREDICTION_REWARDS',
        false,
        RULES.PREDICTION_REWARDS_USERS_THRESHOLD,
        true,
        'Winner/loser rewards',
      ],
      ['TON_WALLET', false, RULES.WALLET_USERS_THRESHOLD, true, 'Future TON Wallet'],
    ].map(([key, enabled, usersThreshold, publicFlag, description]) =>
      prisma.featureFlag.upsert({
        where: { key: String(key) },
        update: {},
        create: {
          key: String(key),
          enabled: Boolean(enabled),
          usersThreshold: Number(usersThreshold),
          public: Boolean(publicFlag),
          description: String(description),
        },
      }),
    ),
  );
  await Promise.all([
    prisma.systemSetting.upsert({
      where: { key: 'CURRENT_TERMS_VERSION' },
      update: {},
      create: { key: 'CURRENT_TERMS_VERSION', value: '1.0', public: true },
    }),
    prisma.systemSetting.upsert({
      where: { key: 'CURRENT_PRIVACY_VERSION' },
      update: {},
      create: { key: 'CURRENT_PRIVACY_VERSION', value: '1.0', public: true },
    }),
    prisma.systemSetting.upsert({
      where: { key: 'REFERRAL_MIN_ACTIVITY_PERCENT' },
      update: {},
      create: { key: 'REFERRAL_MIN_ACTIVITY_PERCENT', value: 80, public: true },
    }),
    prisma.systemSetting.upsert({
      where: { key: 'SIGNUP_REWARD' },
      update: {},
      create: { key: 'SIGNUP_REWARD', value: RULES.SIGNUP_REWARD, public: true },
    }),
    prisma.systemSetting.upsert({
      where: { key: 'BASE_VOTE_REWARD' },
      update: {},
      create: { key: 'BASE_VOTE_REWARD', value: RULES.BASE_VOTE_REWARD, public: true },
    }),
  ]);
  await prisma.task.upsert({
    where: { slug: 'subscribe-myvoice-channel' },
    update: {
      rewardVox: RULES.TELEGRAM_CHANNEL_TASK_REWARD,
      targetUrl: 'https://t.me/myvoiceTGC',
      telegramChatId: '@myvoiceTGC',
    },
    create: {
      id: '30000000-0000-4000-8000-000000000001',
      slug: 'subscribe-myvoice-channel',
      type: 'TELEGRAM_CHANNEL_SUBSCRIPTION',
      status: 'PAUSED',
      rewardVox: RULES.TELEGRAM_CHANNEL_TASK_REWARD,
      targetUrl: 'https://t.me/myvoiceTGC',
      telegramChatId: '@myvoiceTGC',
      translations: {
        create: [
          {
            language: 'en',
            title: 'Join the MyVoice channel',
            description:
              'Follow project news, new votes and important updates in the official channel.',
            actionLabel: 'Open channel',
          },
          {
            language: 'ru',
            title: 'Подпишитесь на канал MyVoice',
            description:
              'Следите за новостями проекта, новыми голосованиями и важными обновлениями в официальном канале.',
            actionLabel: 'Открыть канал',
          },
        ],
      },
    },
  });

  const users = [
    {
      id: IDS.user1,
      telegramId: 900000001n,
      username: 'alice_voice',
      firstName: 'Alice',
      referralCode: 'ALICEDEMO',
      voxBalance: 65,
      ownVotesCount: 1,
      eligibleVotesCount: 1,
      completedVotesParticipated: 1,
      activityRate: 100,
    },
    {
      id: IDS.user2,
      telegramId: 900000002n,
      username: 'boris_voice',
      firstName: 'Boris',
      referralCode: 'BORISDEMO',
      voxBalance: 60,
      ownVotesCount: 1,
      eligibleVotesCount: 1,
      completedVotesParticipated: 1,
      activityRate: 100,
    },
    {
      id: IDS.user3,
      telegramId: 900000003n,
      username: 'clara_voice',
      firstName: 'Clara',
      referralCode: 'CLARADEMO',
      voxBalance: 50,
      ownVotesCount: 0,
      eligibleVotesCount: 1,
      completedVotesParticipated: 0,
      activityRate: 0,
    },
  ];
  for (const data of users) {
    await prisma.user.upsert({
      where: { id: data.id },
      update: {},
      create: {
        ...data,
        languageCode: data.id === IDS.user2 ? 'ru' : 'en',
        status: 'ACTIVE',
        registrationCompletedAt: new Date(Date.now() - 7 * 86_400_000),
      },
    });
    await prisma.userConsent.upsert({
      where: {
        userId_termsVersion_privacyVersion: {
          userId: data.id,
          termsVersion: '1.0',
          privacyVersion: '1.0',
        },
      },
      update: {},
      create: { userId: data.id, termsVersion: '1.0', privacyVersion: '1.0' },
    });
    await prisma.voxTransaction.upsert({
      where: { idempotencyKey: `seed:signup:${data.id}` },
      update: {},
      create: {
        userId: data.id,
        type: 'SIGNUP_BONUS',
        amount: RULES.SIGNUP_REWARD,
        balanceBefore: 0,
        balanceAfter: 50,
        idempotencyKey: `seed:signup:${data.id}`,
        comment: 'Seed signup reward',
      },
    });
  }
  const referral = await prisma.referral.upsert({
    where: { inviteeId: IDS.user2 },
    update: {},
    create: {
      referrerId: IDS.user1,
      inviteeId: IDS.user2,
      sourceCode: 'ALICEDEMO',
      signupRewardedAt: new Date(),
    },
  });
  await prisma.voxTransaction.upsert({
    where: { idempotencyKey: 'seed:referral:signup' },
    update: {},
    create: {
      userId: IDS.user1,
      type: 'REFERRAL_SIGNUP_REWARD',
      amount: RULES.REFERRAL_SIGNUP_REWARD,
      balanceBefore: 50,
      balanceAfter: 55,
      referralId: referral.id,
      idempotencyKey: 'seed:referral:signup',
      comment: 'Seed direct referral reward',
    },
  });

  const activeStart = new Date(Date.now() - 60 * 60 * 1000);
  const activeEnd = new Date(Date.now() + 23 * 60 * 60 * 1000);
  await prisma.vote.upsert({
    where: { id: IDS.activeVote },
    update: { startsAt: activeStart, endsAt: activeEnd, status: 'ACTIVE' },
    create: {
      id: IDS.activeVote,
      status: 'ACTIVE',
      startsAt: activeStart,
      endsAt: activeEnd,
      createdByAdminId: admin.id,
      translations: {
        create: [
          {
            language: 'en',
            title:
              'Should artificial intelligence have the right to participate in public decision-making?',
            description:
              'Consider whether AI systems should have a formal advisory or voting role in decisions affecting the public.',
          },
          {
            language: 'ru',
            title:
              'Должен ли искусственный интеллект иметь право участвовать в принятии общественных решений?',
            description:
              'Стоит ли системам ИИ предоставить формальную консультативную роль или право голоса в общественно значимых решениях?',
          },
        ],
      },
      options: {
        create: [
          {
            position: 1,
            translations: {
              create: [
                { language: 'en', text: 'Yes' },
                { language: 'ru', text: 'Да' },
              ],
            },
          },
          {
            position: 2,
            translations: {
              create: [
                { language: 'en', text: 'No' },
                { language: 'ru', text: 'Нет' },
              ],
            },
          },
        ],
      },
    },
  });

  const completed = await prisma.vote.upsert({
    where: { id: IDS.completedVote },
    update: {},
    create: {
      id: IDS.completedVote,
      status: 'COMPLETED',
      startsAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      completedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      resultPublishedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      resultStatus: 'OPTION_WIN',
      participantCount: 2,
      createdByAdminId: admin.id,
      translations: {
        create: [
          {
            language: 'en',
            title: 'Should city centers have more car-free streets?',
            description: 'A vote about pedestrian-first public space.',
          },
          {
            language: 'ru',
            title: 'Нужно ли сделать больше улиц в центре города свободными от автомобилей?',
            description: 'Голосование о приоритете пешеходных общественных пространств.',
          },
        ],
      },
      options: {
        create: [
          {
            position: 1,
            voteCount: 2,
            translations: {
              create: [
                { language: 'en', text: 'Yes' },
                { language: 'ru', text: 'Да' },
              ],
            },
          },
          {
            position: 2,
            voteCount: 0,
            translations: {
              create: [
                { language: 'en', text: 'No' },
                { language: 'ru', text: 'Нет' },
              ],
            },
          },
        ],
      },
    },
    include: { options: true },
  });
  if (!completed.winnerOptionId) {
    await prisma.vote.update({
      where: { id: completed.id },
      data: { winnerOptionId: completed.options.find((item) => item.position === 1)!.id },
    });
  }
  for (const [index, userId] of [IDS.user1, IDS.user2].entries()) {
    const userVote = await prisma.userVote.upsert({
      where: { userId_voteId: { userId, voteId: completed.id } },
      update: {},
      create: {
        userId,
        voteId: completed.id,
        optionId: completed.options.find((item) => item.position === 1)!.id,
        clientRequestId: `seed-completed-vote-${index}`,
      },
    });
    await prisma.voxTransaction.upsert({
      where: { idempotencyKey: `seed:vote:${userVote.id}` },
      update: {},
      create: {
        userId,
        voteId: completed.id,
        userVoteId: userVote.id,
        type: 'VOTE_REWARD',
        amount: RULES.BASE_VOTE_REWARD,
        balanceBefore: userId === IDS.user1 ? 55 : 50,
        balanceAfter: userId === IDS.user1 ? 65 : 60,
        idempotencyKey: `seed:vote:${userVote.id}`,
        comment: 'Seed vote reward',
      },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
