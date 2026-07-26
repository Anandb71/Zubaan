# Zubaan

Real-time compliance witness for vernacular financial sales.

Next.js 14 · Tailwind · Supabase · Sarvam only.

## Quick start

```bash
npm install
cp .env.example .env.local   # paste SARVAM_API_KEY (+ optional Supabase)
npm run dev
```

Open [http://localhost:3000/call](http://localhost:3000/call).

**Stage mode** (default): scripted Hindi sale → two live contradictions → free-look omission → Tamil customer audit. No mic required.

**Live mic**: needs `SARVAM_API_KEY`. Falls back to stage if STT session is unavailable.

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
npm run build
```

## Out of scope (by PRD)

Telephony · speaker diarization · auth · multi-tenant · real WhatsApp.
