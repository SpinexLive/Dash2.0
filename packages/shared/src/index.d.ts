export type Platform = 'steam' | 'epic';
export type RecruitStatus = 'pending' | 'accepted' | 'rejected';
export type SlotResponse = 'pending' | 'accepted' | 'declined';
/** Effective permission set computed at login and cached in Redis. */
export interface SessionUser {
    discordId: string;
    username: string;
    serverNick?: string | null;
    avatar?: string | null;
    isGuildAdmin: boolean;
    roleIds: string[];
    hasAccess: boolean;
}
/** Real-time event payloads emitted over Socket.IO. */
export type RealtimeEvent = {
    type: 'member.created';
    userId: string;
} | {
    type: 'recruit.updated';
    recruitId: string;
    status: RecruitStatus;
} | {
    type: 'roster.updated';
    rosterId: string;
    slotId: string;
    response: SlotResponse;
} | {
    type: 'briefing.tick';
    at: string;
};
export declare const REALTIME_CHANNEL = "events";
/** Protected dashboard modules that require access control. */
export declare const PROTECTED_MODULES: readonly ["members", "recruits", "roster", "matches", "briefing", "settings"];
export type ProtectedModule = (typeof PROTECTED_MODULES)[number];
