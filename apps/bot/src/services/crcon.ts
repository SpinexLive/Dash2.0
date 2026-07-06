import axios from 'axios';

/** Thin client for the Hell Let Loose Community RCON (CRCON) HTTP API. */
export class CrconService {
  private base = process.env.CRCON_BASE_URL ?? '';
  private auth = { headers: { Authorization: `Bearer ${process.env.CRCON_API_KEY}` } };

  async getPlayers(): Promise<{ name: string; steam_id_64: string }[]> {
    if (!this.base) return [];
    const { data } = await axios.get(`${this.base}/api/get_players`, this.auth);
    return data?.result?.players ?? [];
  }

  /** Pull the latest match scoreboard for ingestion into match_player_stats. */
  async getScoreboard(): Promise<unknown> {
    if (!this.base) return null;
    const { data } = await axios.get(`${this.base}/api/get_live_scoreboard`, this.auth);
    return data?.result ?? null;
  }
}

export const crcon = new CrconService();
