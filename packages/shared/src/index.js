"use strict";
// Shared DTOs and constants used by the API, bot, and web app.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROTECTED_MODULES = exports.REALTIME_CHANNEL = void 0;
exports.REALTIME_CHANNEL = 'events';
/** Protected dashboard modules that require access control. */
exports.PROTECTED_MODULES = [
    'members',
    'recruits',
    'roster',
    'matches',
    'briefing',
    'settings',
];
