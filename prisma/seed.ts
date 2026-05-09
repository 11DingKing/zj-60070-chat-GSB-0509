import { PrismaClient, GroupRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const password = await bcrypt.hash('pass123', 10);

  const user1 = await prisma.user.upsert({
    where: { username: 'user1' },
    update: {},
    create: {
      username: 'user1',
      password,
      nickname: '张三',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=user1',
      signature: '今天也要开心！',
    },
  });

  const user2 = await prisma.user.upsert({
    where: { username: 'user2' },
    update: {},
    create: {
      username: 'user2',
      password,
      nickname: '李四',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=user2',
      signature: '生活不止眼前的苟且',
    },
  });

  const user3 = await prisma.user.upsert({
    where: { username: 'user3' },
    update: {},
    create: {
      username: 'user3',
      password,
      nickname: '王五',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=user3',
      signature: '代码改变世界',
    },
  });

  console.log('Created users:');
  console.log('  - user1 (张三) - password: pass123');
  console.log('  - user2 (李四) - password: pass123');
  console.log('  - user3 (王五) - password: pass123');

  await prisma.friendship.upsert({
    where: {
      user1Id_user2Id: {
        user1Id: user1.id,
        user2Id: user2.id,
      },
    },
    update: {},
    create: {
      user1Id: user1.id,
      user2Id: user2.id,
    },
  });

  await prisma.friendship.upsert({
    where: {
      user1Id_user2Id: {
        user1Id: user1.id,
        user2Id: user3.id,
      },
    },
    update: {},
    create: {
      user1Id: user1.id,
      user2Id: user3.id,
    },
  });

  console.log('Created friendships:');
  console.log('  - user1 <-> user2');
  console.log('  - user1 <-> user3');

  const group = await prisma.group.upsert({
    where: { id: 'example-group-1' },
    update: {},
    create: {
      id: 'example-group-1',
      name: '快乐讨论群',
      avatar: 'https://api.dicebear.com/7.x/shapes/svg?seed=group1',
      description: '这是一个示例群聊，用于测试群聊功能',
      ownerId: user1.id,
    },
  });

  await prisma.groupMember.upsert({
    where: {
      groupId_userId: {
        groupId: group.id,
        userId: user1.id,
      },
    },
    update: {},
    create: {
      groupId: group.id,
      userId: user1.id,
      role: GroupRole.OWNER,
    },
  });

  await prisma.groupMember.upsert({
    where: {
      groupId_userId: {
        groupId: group.id,
        userId: user2.id,
      },
    },
    update: {},
    create: {
      groupId: group.id,
      userId: user2.id,
      role: GroupRole.MEMBER,
    },
  });

  await prisma.groupMember.upsert({
    where: {
      groupId_userId: {
        groupId: group.id,
        userId: user3.id,
      },
    },
    update: {},
    create: {
      groupId: group.id,
      userId: user3.id,
      role: GroupRole.MEMBER,
    },
  });

  console.log('Created group:');
  console.log('  - 快乐讨论群 (owner: user1, members: user1, user2, user3)');

  const groupConversation = await prisma.conversation.upsert({
    where: { id: 'group-conv-1' },
    update: {},
    create: {
      id: 'group-conv-1',
      type: 'group',
      groupId: group.id,
    },
  });

  await prisma.conversationUser.upsert({
    where: {
      conversationId_userId: {
        conversationId: groupConversation.id,
        userId: user1.id,
      },
    },
    update: {},
    create: {
      conversationId: groupConversation.id,
      userId: user1.id,
    },
  });

  await prisma.conversationUser.upsert({
    where: {
      conversationId_userId: {
        conversationId: groupConversation.id,
        userId: user2.id,
      },
    },
    update: {},
    create: {
      conversationId: groupConversation.id,
      userId: user2.id,
    },
  });

  await prisma.conversationUser.upsert({
    where: {
      conversationId_userId: {
        conversationId: groupConversation.id,
        userId: user3.id,
      },
    },
    update: {},
    create: {
      conversationId: groupConversation.id,
      userId: user3.id,
    },
  });

  console.log('Created group conversation.');

  const privateConv1 = await prisma.conversation.upsert({
    where: { id: 'private-conv-1' },
    update: {},
    create: {
      id: 'private-conv-1',
      type: 'private',
    },
  });

  await prisma.conversationUser.upsert({
    where: {
      conversationId_userId: {
        conversationId: privateConv1.id,
        userId: user1.id,
      },
    },
    update: {},
    create: {
      conversationId: privateConv1.id,
      userId: user1.id,
    },
  });

  await prisma.conversationUser.upsert({
    where: {
      conversationId_userId: {
        conversationId: privateConv1.id,
        userId: user2.id,
      },
    },
    update: {},
    create: {
      conversationId: privateConv1.id,
      userId: user2.id,
    },
  });

  console.log('Created private conversation between user1 and user2.');

  console.log('\nSeeding completed!');
  console.log('\nTest Accounts:');
  console.log('  Username: user1 | Password: pass123');
  console.log('  Username: user2 | Password: pass123');
  console.log('  Username: user3 | Password: pass123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
