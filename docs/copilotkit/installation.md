# Installation

## Prerequisites
- Node.js (v18+ recommended)
- Docker (optional, for running the CopilotKit server)
- A compatible LLM provider (OpenAI, Anthropic, etc.)

## Quick Start
```bash
# Install the package
npm install @copilotkit/runtime @copilotkit/server @copilotkit/ui

# Run the server (development)
npx copilotkit@latest server

# Access the UI
open http://localhost:3000
```

## Server Setup
If you prefer Docker:
```bash
docker run -p 8080:8080 copilotkit/server:latest
```
The container exposes APIs on `http://localhost:8080`.

## Environment Variables
| Variable | Description |
|----------|-------------|
| `COPILOTKIT_SECRET_KEY` | JWT secret for signed tokens |
| `COPILOTKIT_LLM_ENDPOINT` | Base URL for the LLM provider |
| `COPILOTKIT_REDIS_URL` | Redis URL for session storage |
| `COPILOTKIT_DB_URL` | PostgreSQL connection string |

> **Tip:** Set `COPILOTKIT_LLM_ENDPOINT` to the correct endpoint for your chosen model (e.g., `https://api.openai.com/v1/chat/completions` for OpenAI).

## Client Integration
For JavaScript/TypeScript clients:
```js
import { CopilotKit } from '@copilotkit/runtime'

const client = new CopilotKit({
  apiBase: 'http://localhost:8080',
  adapter: new BrowserAdapter() // for browsers
})

await client.run('Your agent name', {
  messages: ['Hello'],
  model: 'gpt-4o-mini',
})
```

## Development Build
```bash
# Clone and build
git clone https://github.com/copilotkit/copilotkit
cd copilotkit
npm install
npm run dev
```

Proceed to the [Architecture](architecture.md) for a deeper understanding of the runtime.