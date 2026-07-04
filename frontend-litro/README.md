# 314 Studio — Litro Frontend (In Progress)

This is the Litro + Lit replacement for the React frontend.

## Status

**Phase 1: Foundation** — Scaffolded project structure, ported API client.

## Structure

```
frontend-litro/
├── pages/              # File-system routing (Litro)
│   └── index.ts        # Folder selector (root)
├── components/         # Reusable Lit components
├── services/
│   └── api.ts          # API client + SSE controller
├── types/
│   └── index.ts        # TypeScript interfaces
├── app.ts              # Entry point (router setup)
├── vite.config.ts      # Vite config (Litro plugin)
├── tsconfig.json
└── package.json
```

## Next Steps

1. Port remaining pages (models, workspace)
2. Port components (project-tree, file-preview, chat-panel)
3. Add CSS/styles (Shadow DOM or Light DOM)
4. Wire up SSE streaming for chat
5. Test and verify against backend

## Running

```bash
cd frontend-litro
npm install
npm run dev
```
