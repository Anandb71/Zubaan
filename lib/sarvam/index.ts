/**
 * Server-side Sarvam facade. Import AI surfaces from here.
 *
 * The browser STT client lives in ./stt-client and is imported directly by
 * client components — it must never be pulled into server code, and this
 * barrel deliberately does not re-export it.
 */

export * from "./types";
export { chat, chatJson, extractJson, chatAvailable } from "./chat";
export { synthesize } from "./tts";
export { translate } from "./translate";
export { extractDocumentText, docAiAvailable } from "./docai";
export { buildSttSession, type SttSession } from "./stt";
export { poolHealth, pools } from "./pools";
