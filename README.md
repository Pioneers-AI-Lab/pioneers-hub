# Pioneers Hub

Founders, startups and events of the Pioneers batches.

## Run locally

```bash
npm install && npm --prefix functions install
cp .env.example .env.local
npm run emulators   # terminal 1
npm run seed        # terminal 2 (fictional demo data)
npm run dev         # terminal 2
```

Open http://localhost:3000. Emulator accounts: `staff@pioneers.test` (staff), `ada@pioneers.test` (founder).

Architecture and conventions: [CLAUDE.md](CLAUDE.md).
