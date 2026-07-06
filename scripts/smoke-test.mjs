// Local smoke test for the HLL Dashboard API.
// Exercises: unauthenticated rejection, OAuth redirect, JWT/access guard,
// settings, and the full recruit -> accept -> member (DB trigger) flow.
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const BASE = 'http://localhost:4000';
const SECRET = process.env.JWT_SECRET;
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  PASS  ${name}`);
    pass++;
  } else {
    console.log(`  FAIL  ${name} ${extra}`);
    fail++;
  }
}

// Admin session token (mirrors what /auth/discord/callback issues).
function adminToken(discordId) {
  return jwt.sign(
    {
      sub: discordId,
      discordId,
      username: 'SmokeAdmin',
      serverNick: 'SmokeAdmin',
      avatar: null,
      isGuildAdmin: true,
      roleIds: [],
      hasAccess: false,
    },
    SECRET,
    { expiresIn: 900 },
  );
}

async function main() {
  console.log('\n== 1. Unauthenticated requests are rejected ==');
  let r = await fetch(`${BASE}/members`);
  check('GET /members without cookie -> 401', r.status === 401, `got ${r.status}`);
  r = await fetch(`${BASE}/settings`);
  check('GET /settings without cookie -> 401', r.status === 401, `got ${r.status}`);

  console.log('\n== 2. Discord OAuth login redirect ==');
  r = await fetch(`${BASE}/auth/discord/login`, { redirect: 'manual' });
  const loc = r.headers.get('location') ?? '';
  check(
    'GET /auth/discord/login -> 302 to discord.com',
    (r.status === 302 || r.status === 0 || r.status === 307) &&
      loc.includes('discord.com/api'),
    `status ${r.status} loc ${loc.slice(0, 40)}`,
  );

  // Build an admin cookie.
  const adminDiscordId = '100000000000000001';
  await prisma.user.upsert({
    where: { discordId: adminDiscordId },
    create: { discordId: adminDiscordId, username: 'SmokeAdmin', isGuildAdmin: true },
    update: { isGuildAdmin: true },
  });
  const cookie = `access_token=${adminToken(adminDiscordId)}`;
  const authd = { headers: { cookie, 'content-type': 'application/json' } };

  console.log('\n== 3. Authenticated admin access ==');
  r = await fetch(`${BASE}/auth/me`, authd);
  const me = await r.json();
  check('GET /auth/me -> 200 + hasAccess(admin)', r.status === 200 && me.hasAccess === true, JSON.stringify(me));

  r = await fetch(`${BASE}/members`, authd);
  check('GET /members (admin) -> 200 array', r.status === 200 && Array.isArray(await r.json()), `got ${r.status}`);

  console.log('\n== 4. Settings configure ==');
  r = await fetch(`${BASE}/settings`, {
    method: 'PATCH',
    headers: authd.headers,
    body: JSON.stringify({ memberRoleId: 'role_member_1', rankRoles: [{ id: 'role_member_1', name: 'Member' }] }),
  });
  check('PATCH /settings (admin) -> 200', r.status === 200, `got ${r.status}`);

  console.log('\n== 5. Recruit -> Accept -> Member (DB trigger) flow ==');
  const recruitDiscordId = '200000000000000002';
  // Clean any prior run.
  await prisma.recruit.deleteMany({ where: { discordId: recruitDiscordId } });
  const existingUser = await prisma.user.findUnique({ where: { discordId: recruitDiscordId } });
  if (existingUser) {
    await prisma.member.deleteMany({ where: { userId: existingUser.id } });
    await prisma.gameAccount.deleteMany({ where: { userId: existingUser.id } });
  }
  const recruit = await prisma.recruit.create({
    data: {
      discordId: recruitDiscordId,
      messageId: `smoke-${Date.now()}`,
      extractedGameId: '76561198000000000',
      rawApplication: `### **3.** What is your Steam/EPIC ID?\n76561198000000000\nUserId: \`${recruitDiscordId}\`\nUser: @Smoke Tester`,
      status: 'pending',
      postedAt: new Date(),
    },
  });

  r = await fetch(`${BASE}/recruits?status=pending`, authd);
  const pending = await r.json();
  check('GET /recruits?status=pending shows new recruit', Array.isArray(pending) && pending.some((x) => String(x.id) === String(recruit.id)));

  r = await fetch(`${BASE}/recruits/${recruit.id}/process`, { method: 'POST', headers: authd.headers });
  const acc = await r.json();
  check('POST /recruits/:id/process -> ok', r.status === 201 || r.status === 200, JSON.stringify(acc));

  // The process transaction should have created a member + linked game id.
  r = await fetch(`${BASE}/members`, authd);
  const members = await r.json();
  const newMember = members.find((m) => m.discordId === recruitDiscordId);
  check('Member now appears in /members (auto-refresh source)', Boolean(newMember), `members=${members.length}`);
  check('Linked game id visible on member', newMember?.gameAccounts?.[0]?.gameId === '76561198000000000', JSON.stringify(newMember?.gameAccounts));

  const updated = await prisma.recruit.findUnique({ where: { id: recruit.id } });
  check('Recruit marked processed', updated?.status === 'accepted', updated?.status);

  console.log('\n== 6. Non-admin without access is forbidden ==');
  const outsiderId = '300000000000000003';
  const outsiderCookie = `access_token=${jwt.sign({ sub: outsiderId, discordId: outsiderId, username: 'Outsider', isGuildAdmin: false, roleIds: ['random_role'], hasAccess: false }, SECRET, { expiresIn: 900 })}`;
  r = await fetch(`${BASE}/members`, { headers: { cookie: outsiderCookie } });
  check('GET /members (non-admin, not allow-listed) -> 403', r.status === 403, `got ${r.status}`);

  console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('Smoke test crashed:', e);
  await prisma.$disconnect();
  process.exit(1);
});
