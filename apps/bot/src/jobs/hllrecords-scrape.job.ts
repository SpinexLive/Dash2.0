import axios from 'axios';
import { prisma } from '@hll/db';

const BASE_URL = 'https://hllrecords.com/profiles';
const PERIOD = process.env.HLLRECORDS_PERIOD ?? '90d';

// A recognizable, project-specific UA is required by HLLRecords' firewall.
const USER_AGENT =
  process.env.HLLRECORDS_USER_AGENT ??
  '331-Clan-Dashboard/1.0 (+https://github.com/331-dashboard)';

// Be nice: their limit is 10 page requests / 10s. We pace one request/sec.
const REQUEST_DELAY_MS = 1_200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Steam64 ids are 17 digits starting 765; Epic ids are 32 hex (unsupported). */
function isSteamId(gameId: string): boolean {
  return /^\d{17}$/.test(gameId) && gameId.startsWith('765');
}

interface ScrapedStats {
  kpm: number | null;
  kdr: number | null;
  duelStrength: number | null;
}

/**
 * The radar chart data is embedded in the streamed React payload as objects
 * like: {"area\":\"KPM\",\"rawValue\":0.79,...,\"type\":\"kpm\"}.
 * We pull the rawValue for the kpm / kdr / killElo entries.
 */
export function parseProfileStats(html: string): ScrapedStats {
  const pick = (type: string): number | null => {
    const re = new RegExp(
      `"rawValue\\\\":([0-9.]+)(?:(?!"rawValue)[\\s\\S])*?"type\\\\":\\\\"${type}\\\\"`,
    );
    const m = html.match(re);
    return m ? Number(m[1]) : null;
  };

  return {
    kpm: pick('kpm'),
    kdr: pick('kdr'),
    duelStrength: pick('killElo'),
  };
}

async function fetchProfile(gameId: string): Promise<string | null> {
  try {
    const { data } = await axios.get<string>(`${BASE_URL}/${gameId}`, {
      params: { period: PERIOD },
      timeout: 20_000,
      responseType: 'text',
      headers: {
        'X-HLLRecords-Bot-Detection': 'bypass',
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
      },
    });
    return data;
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    console.error(`[hllrecords] fetch failed for ${gameId} (status ${status})`);
    return null;
  }
}

/**
 * Scrapes hllrecords.com for every member that has a Steam account and stores
 * KPM, KDR and Duel strength. Epic-only members are skipped.
 */
export async function scrapeHllRecords(): Promise<{
  scanned: number;
  updated: number;
}> {
  const accounts = await prisma.gameAccount.findMany({
    where: { platform: 'steam' },
    select: { userId: true, gameId: true },
  });

  // One Steam id per user (first wins).
  const byUser = new Map<bigint, string>();
  for (const a of accounts) {
    if (isSteamId(a.gameId) && !byUser.has(a.userId)) {
      byUser.set(a.userId, a.gameId);
    }
  }

  let updated = 0;
  const targets = [...byUser.entries()];
  console.log(`[hllrecords] scraping ${targets.length} steam profiles…`);

  for (const [userId, gameId] of targets) {
    const html = await fetchProfile(gameId);
    if (html) {
      const stats = parseProfileStats(html);
      if (
        stats.kpm !== null ||
        stats.kdr !== null ||
        stats.duelStrength !== null
      ) {
        await prisma.hllRecordStat.upsert({
          where: { userId },
          create: {
            userId,
            gameId,
            kpm: stats.kpm,
            kdr: stats.kdr,
            duelStrength:
              stats.duelStrength !== null
                ? Math.round(stats.duelStrength)
                : null,
            fetchedAt: new Date(),
          },
          update: {
            gameId,
            kpm: stats.kpm,
            kdr: stats.kdr,
            duelStrength:
              stats.duelStrength !== null
                ? Math.round(stats.duelStrength)
                : null,
            fetchedAt: new Date(),
          },
        });
        updated++;
      }
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(
    `[hllrecords] done — scanned=${targets.length} updated=${updated}`,
  );
  return { scanned: targets.length, updated };
}
