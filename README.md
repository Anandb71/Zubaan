# Zubaan

Evidence-backed compliance for multilingual sales and support conversations
across voice, WhatsApp, email, chat, tickets, and imported transcripts.

Next.js 16 · React 19 · Tailwind · Supabase · Sarvam

## Quick start

```bash
npm install
cp .env.example .env.local   # paste SARVAM_API_KEY (+ optional Supabase)
npm run db:dry-run            # inspect pending Supabase migrations
npm run db:push               # apply after setting SUPABASE_DB_PASSWORD
npm run dev
```

Open [http://localhost:3000/call](http://localhost:3000/call).

**Stage mode** (default): scripted Hindi sale → two live contradictions → free-look omission → Tamil customer audit. No mic required.

**Live mic**: needs `SARVAM_API_KEY`. Browser audio uses a same-origin relay;
the Sarvam key never reaches browser code, URLs, or reconnect state.

**Multichannel**: `/import` accepts transcripts, WhatsApp exports, email, and
generic JSON. `/inbox` shows the normalized evidence and policy findings.

## Demo script (3 min)

1. Pitch: agent sells in Hindi; English PDF says otherwise.
2. `/call` → Stage → Start recording.
3. Watch two red contradiction cards (`guaranteed 12%`, understated lock-in).
4. End call → omission (free-look) → open customer audit in Tamil.
5. `/compliance` for agent ranking + false promises by language.

Say out loud: **Sarvam-30B on the live path, Sarvam-105B at end of call.**

## Verify

```bash
npm test
npm run type-check
npm run verify
```

## Architecture invariants

- Adapters parse only. They never call models, persist records, or send replies.
- Every write is organization-scoped and idempotent.
- Message writes use optimistic conversation revisions.
- Findings must link trigger messages and written policy evidence.
- Uncertain speakers, internal notes, and customer messages cannot create agent violations.
- Object storage is private; clients receive short-lived signed URLs.

## Deliberate limits

Telephony transport, automatic speaker diarization, and production auth are not
part of the hackathon path. The schema and RLS are organization-aware; the
current deployment uses one explicit `ZUBAAN_ORGANIZATION_ID` until auth is enabled.
