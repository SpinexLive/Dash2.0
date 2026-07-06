import axios from 'axios';

/** Minimal RaidHelper API client to read event signups for roster building. */
export class RaidHelperService {
  private base = 'https://raid-helper.xyz/api/v4';
  private auth = { headers: { Authorization: process.env.RAIDHELPER_API_KEY ?? '' } };

  async getEvent(eventId: string): Promise<{
    channelId?: string;
    description?: string | null;
    startTime?: string | number | null;
    signUps?: { userId: string; name: string; className?: string }[];
  } | null> {
    try {
      const { data } = await axios.get(`${this.base}/events/${eventId}`, this.auth);
      return data;
    } catch {
      return null;
    }
  }
}

export const raidHelper = new RaidHelperService();
