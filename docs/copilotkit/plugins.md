# Plugins

Plugins extend CopilotKit with additional capabilities such as LLM providers, vector stores, databases, and auth integrations.

## Plugin Manifest
A plugin must include a `manifest.json` at its root folder:
```json
{
  "name": "copilotkit-redis",
  "version": "1.0.0",
  "author": "CopilotKit Team",
  "description": "Redis-backed session and caching plugin for state management",
  "entrypoint": "index.js",
  "hooks": {
    "onInitialize": "./src/init.ts",
    "onRun": "./src/beforeRun.ts"
  }
}
```

## Implementing a Plugin
- Extend the `Plugin` class from `@copilotkit/runtime`.
- Implement callbacks: `init()`, `beforeRun(context)`, `afterRun(result)`.
- Register resources in `resources/` folder (e.g., `redis.ts`).

### Example: Simple Logger Plugin (adds structured logs)
```ts
import { Plugin } from '@copilotkit/runtime'

export class LoggerPlugin extends Plugin {
  name = 'logger'

  async init() {
    console.log(`[${this.name}] plugin loaded`)
  }

  async beforeRun(ctx) {
    const { runId, agent } = ctx
    this.context.logs.add({
      level: 'info',
      message: `Run ${runId} for ${agent.id} started`,
      timestamp: new Date().toISOString()
    })
  }

  async afterRun(ctx, result) {
    this.context.logs.add({
      level: 'info',
      message: `Run ${ctx.runId} completed with status ${result.status}`,
      timestamp: new Date().toISOString()
    })
  }
}
```

## Built‑in Plugins
| Plugin | Description |
|------|-------------|
| `copilotkit-redis` | Stores agent state in Redis; reduces DB writes. |
| `copilotkit-openai` | Default provider for OpenAI models; configurable via env vars. |
| `copilotkit-pg` | PostgreSQL storage plugin; handles migrations. |
| `copilotkit-auth` | JWT auth for protected endpoints; supports Google OAuth. |

## Loading Plugins
When building the CopilotKit server (`@copilotkit/server`), plugins can be auto‑loaded from a local directory via `--plugins ./plugins`. Each plugin's manifest is read, the entrypoint module exported is instantiated, and its hooks are registered.

## Plugin Development Workflow
1. Scaffold a new plugin: `npx @copilotkit/cli plugin init my-plugin`.
2. Implement hooks as needed.
3. Test with `npx copilotkit serve --plugins ./my-plugin`.
4. Publish to npm with `npm publish` or keep in a monorepo.

## Compatibility
Plugins must be compatible with the **Copier Runtime**:
- Use ES modules (`.mjs` or `"type": "module"` in package.json).
- Do not import the server itself; the runtime injects a `context` object with `logger`, `db`, `cache`, and `metrics`.

## Security
- Do not expose secrets in the plugin; rely on environment variables.
- Plugins run in the same process as the server but are sandboxed via `vm2` when using the `isolated` mode.
- Validate any external data from plugins before persisting.

Proceed to the [Storage] section for details on how state persists across runs.