# CEVORYN

AI Chief of Staff for companies with 2–20 employees.

## Tech Stack

- **Framework:** Next.js 15, React 19, TypeScript
- **Styling:** Tailwind CSS, shadcn/ui
- **Database:** PostgreSQL via Prisma
- **Auth:** Supabase Auth
- **AI:** OpenAI (GPT-4o / GPT-4o-mini), streaming via SSE
- **Hosting:** Vercel

## Getting Started

```bash
git clone https://github.com/your-org/atlas.git && cd atlas
npm install
cp .env.example .env.local   # fill in Supabase + OpenAI keys
npx prisma generate
npx prisma db push
npm run dev
```

## Architecture

```
src/
├── app/              # Next.js App Router
├── components/       # Shared UI (shadcn/ui, layout)
├── features/
│   ├── ai/           # Chat engine, streaming, providers
│   ├── auth/         # Authentication
│   ├── brain/        # CEVORYN Brain (Sprint 004)
│   │   ├── core/     # Module registry, engine, types
│   │   ├── memory/   # Company Memory
│   │   ├── insights/ # Insight Engine
│   │   ├── pulse/    # Company Pulse
│   │   └── brief/    # CEO Brief
│   └── onboarding/
├── hooks/
├── lib/              # Auth, RBAC, Prisma, constants
├── server/services/  # Business logic
└── types/
```

## Brain API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/brain/memories` | GET/POST/DELETE | Company memory CRUD |
| `/api/brain/insights` | GET/POST/PATCH | Insight generation & management |
| `/api/brain/pulse` | GET | Real-time company metrics |
| `/api/brain/brief` | GET/POST | CEO brief generation & history |

## Sprint History

- **001** — Project bootstrap
- **002** — Auth, multi-tenant RBAC, onboarding, dashboard
- **003** — AI chat engine, OpenAI streaming, conversations
- **003.1** — Repository cleanup
- **004** — CEVORYN Brain: Memory, Insights, Pulse, CEO Brief

## Deployment

Production deployments are handled automatically by Vercel from the `main` branch.

Last rebuild trigger: 2026-07-23.

## License

Proprietary. All rights reserved.
