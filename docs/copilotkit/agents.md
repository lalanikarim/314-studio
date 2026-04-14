# Agents

Agents are the programmable building blocks of AI applications in CopilotKit. They consist of one or more **actions** (functions) and optional **tools** that can call external services.

## Defining an Agent

```ts
import { Agent, Tool } from '@copilotkit/runtime'

class MyAgent extends Agent {
  id = 'my-agent'

  async onInitialize() {
    // Called when the agent is first instantiated
    this.logger.info('Agent initialized')
  }

  // Example action (callable by the runtime)
  async fetchWeather({ location }: { location: string }) {
    const response = await WeatherAPI.get(location)
    return { temperature: response.temp, condition: response.cond }
  }

  // Declare tools that can be used from other agents or UI
  static tools = {
    calendar: new Tool('getEvents', async (params) => {
      const events = await GoogleCalendar.getUpcoming()
      return events
    })
  }

  async onRun(input: any) {
    switch (input.topic) {
      case 'weather': return this.fetchWeather(input)
      case 'calendar': return this.tools.calendar.getEvents()
        .then(events => ({ events }))
      default:
        throw new Error('Unsupported topic')
    }
  }
}

export default MyAgent
```

### Core Agent Types
- **Function Agent** – a single `handle(input)` function.
- **Pipeline Agent** – multiple steps orchestrated in order.
- **Reactive Agent** – listens to events (e.g., new email) and auto‑executes.

## Permissions
Agents optionally define a **permission matrix** (`allowed: [['read','write'],['read']]`) to protect sensitive resources.

## Testing Agents
```bash
# Run a single step locally
npx copilotkit test my-agent.fetchWeather --data '{"location":"Paris"}'
```
The CLI returns the raw output and logs.

## Debugging
- Enable the **Lens UI** (`/lens`) to see a visual call graph.
- Logs are stored in Postgres; query `select * from agent_runs where agent_id='my-agent'` for history.
- Use `post` with `debug=true` in the request header to get raw traces.

## Scaling
- Agents are stateless and can be horizontally scaled; the server caches the run id.
- For high‑throughput, pin agents to dedicated workers via `agent.poolId`.

## Example Pipelines
1. **Chatbot with Retrieval**:
   - `ChatAgent` -> `VectorSearchAgent` -> `AnswerAgent`
2. **Workflow Automation**:
   - `TriggerAgent` (on webhook) -> `ProcessorAgent` (business logic) -> `NotifierAgent`.

See the [Examples](examples.md) folder for full pipeline code.

Now we provide a quick reference of common built‑in agents:
- `copilotkit.agents.conversation.ChatAgent`
- `copilotkit.agents.reminders.RemindersAgent`
- `copilotkit.agents.analytics.AnalyticsAgent`

All agents inherit from `AgentBase` which implements standard metadata (runId, timestamps, etc.).

---

**Tip**: Keep each agent **single‑purpose**. This makes debugging and permission scoping easier.

Proceed to [Plugins](plugins.md) for extending the platform with external services.