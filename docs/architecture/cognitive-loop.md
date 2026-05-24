# Cognitive Loop

The cognitive loop is the runtime unit of cognition: one `user_input` event in, one `InteractionResponseEvent` out. Everything between is a deterministic pipeline that reads from OpenSearch, calls a reasoning model, optionally executes a tool, and publishes a policy evaluation delta.

## Entry point

The orchestrator (`apps/orchestrator/src/worker.ts`) subscribes to the `experience.raw` Kafka topic. It filters for `event.type === "user_input"` and calls `loop.process(event)` for each matching message. All other event types (agent_action, tool_result, system_event) flow into the memory and reinforcement pipeline downstream without re-entering the loop.

`loop` is a `CognitiveLoop` instance from `packages/agents/src/loop.ts`. Its dependencies are injected at startup by `createSocietyLoop` in `apps/orchestrator/src/society.ts`.

## One turn: step-by-step

```
1. getCurrentPolicy()
2. getOrCreate(event, policy)         -> CognitiveSession
3. listActiveGoals(sessionId)         -> Goal[]
4. retrieve(queryText, embedding)     -> MemoryReference[]  (hybrid BM25 + kNN, top 8)
5. updateWorkingMemory(sessionId, memories)
6. build AgentContext
7. reasoningModel.reason(context)     -> ReasoningDecision
8. toolExecutor.execute(action)       -> EventResult  (skipped if no action)
9. scoreDecision()
10. policyEvaluationPublisher.publish(PolicyEvaluationInput)
```

Source: `packages/agents/src/loop.ts`, `CognitiveLoop.process`.

### Step 1 -- policy snapshot

`PolicyProvider.getCurrentPolicy()` reads the live `PolicyState` from the `InMemoryPolicyStore` (or a durable store in production). The policy vector contains seven `[0,1]` scalars:

- `retrievalBias` -- how heavily to weight memory recall vs. model priors
- `toolBias` -- preference for tool invocation over pure reasoning
- `riskTolerance` -- tolerance for uncertain or risky actions
- `memoryTrust` -- confidence weight on retrieved memories
- `explorationFactor` -- novelty seeking vs. exploitation of known patterns
- `goalPersistence` -- weight on long-horizon goals vs. immediate task
- `workingMemoryDecayRate` -- how aggressively working memory is pruned between turns

The policy shapes retrieval (via `vectorWeight` in `buildHybridQuery`) and is injected into every agent's `AgentContext`.

### Step 2 -- session

`SessionManager.getOrCreate` looks up the session by `event.context.sessionId`. If no session exists, one is created with empty `workingMemory` and `activeGoals`. The default implementation (`InMemorySessionManager`) stores sessions in process memory; production deployments substitute a durable backend.

`CognitiveSession` carries:
- `sessionId`, `traceId` -- correlation identifiers
- `workingMemory` -- `MemoryReference[]` last updated in step 5
- `activeGoals` -- populated from `GoalSystem`
- `policyState` -- snapshot at session creation
- `participatingAgents` -- defaults to `["planner", "executor"]`

### Step 3 -- goals

`GoalProvider.listActiveGoals(sessionId)` returns the `Goal[]` currently active for this session. Goals carry a multi-horizon structure (meta/long/mid/short/micro) and propagate priority multiplicatively through decomposition (`priority = root × decayFactor^depth`). The `GoalSystem` in `packages/agents/src/goal-system.ts` manages creation, progress tracking, completion cascades, and event-relevance scoring.

### Step 4 -- retrieval

`MemoryRetriever.retrieve` queries two indexes in parallel: `experience_events` and `memory_semantic`. The query is hybrid BM25 + k-NN (OpenSearch `hybrid` query type). The vector field is selected by `retrievalMode`; the default is `"efficient"` (field: `embedding_nomic`).

The loop requests `size: 8`. When a `queryEmbedding` is present on the event it is used directly; otherwise the configured `QueryEmbeddingClient` embeds the query text on the fly.

See `docs/architecture/retrieval-pipeline.md` for the full retrieval path including reranking and diversity slot.

### Step 5 -- working memory

The retrieved `MemoryReference[]` is written back onto the session via `SessionManager.updateWorkingMemory`. The session is re-read as `updatedSession` for the response payload.

### Step 6 -- AgentContext

```typescript
{
  sessionId, traceId,
  input: ExperienceEvent,
  memories: MemoryReference[],   // from step 4
  goals: Goal[],                 // from step 3
  policy: PolicyState,           // from step 1
  capabilities: ToolCapability[] // from toolExecutor.listTools()
}
```

`capabilities` is populated by calling `ToolExecutor.listTools()` at context-build time. Agents can inspect this list to scope proposals to available tools.

### Step 7 -- reasoning

`ReasoningModel.reason(context)` returns a `ReasoningDecision`:

```typescript
{
  proposal: string,
  reasoning?: string,
  confidence: number,  // [0, 1]
  riskScore: number,   // [0, 1]
  action?: { tool: string, parameters?: Record<string, unknown> }
}
```

The default reasoning model is `MultiAgentReasoningModel` which delegates to `MultiAgentRuntime`.

### Step 8 -- tool execution

If `decision.action` is present, `ToolExecutor.execute(action, context)` is called. The built-in executor (`packages/tool-executor`) dispatches to WebFetch, MemorySearch, WriteExperience, or MCP-backed tools. If no action is requested, a no-op result `{ output: "No action requested", success: true }` is returned.

### Steps 9 -- 10 -- scoring and policy evaluation

`scoreDecision` blends confidence, risk, and action outcome into a `[0,1]` score:

```
score = clamp(confidence - riskScore × 0.25 + (action.success ? 0.2 : -0.2))
```

A `PolicyEvaluationInput` is assembled from the loop result and published (typically onto the `policy.evaluation` Kafka topic). The policy worker downstream consumes this and applies a clamped EMA update to the live `PolicyState`.

## Multi-agent runtime

When `MultiAgentReasoningModel` is wired in, step 7 fans out to a debate:

```
MultiAgentRuntime.run(context)
  -> agents.map(a => a.run(context))  // parallel
  -> arbitrate(results)               // select winner
  -> activityStore.record(traces)     // async
```

`arbitrate` scores each `AgentResult` on four dimensions (weights sum to 1.0):

| Dimension | Weight | Formula |
|-----------|--------|---------|
| coherence | 0.25 | 1.0 if proposal + reasoning present, else 0.6 |
| predictedReward | 0.30 | confidence (blended with forecast.confidence×0.35 if available) |
| memoryAlignment | 0.25 | min(1, retrievedMemories.length / 5) |
| riskPenalty | 0.20 | 1 - riskScore (blended with forecast.riskScore×0.45 if available) |

The winner's `proposal` becomes the response. The critic agent's annotation (if any) is copied onto the winning result.

Default agents (`createDefaultAgents` in `packages/agents/src/specialized-agents.ts`) are deterministic stubs. Production deployments replace these via:
- `EnginePlugin` (selected by `CS_ENGINE=<name>` env var) for the reasoning model
- `ToolExecutorPlugin` for additional tools

## Post-turn work

After the loop result is returned, the orchestrator performs two additional steps outside `CognitiveLoop.process`:

1. **Agent-action event**: `AgentActionPublisher.publish` emits an `agent_action` `ExperienceEvent` onto `experience.raw` so that the LLM decision feeds back into the reinforcement and consolidation pipeline.

2. **Introspection**: `ReflectionEngine`, `CalibrationMonitor`, and `IntrospectionEngine` assess the loop result. If a coverage gap is detected and `ConstitutionEngine` approves the proposal, it is saved via `ProposalStore` to the `self_modifications` index.

The loop itself never triggers consolidation or decay -- those run on separate workers (see `docs/architecture/memory-lifecycle.md`).

## Response event

A successful turn produces an `InteractionResponseEvent` published to the `interaction.response` Kafka topic:

```typescript
{
  eventId, sessionId, traceId, timestamp,
  status: "complete",
  responseText: agentResult.proposal,
  confidence, riskScore,
  retrievedMemories,
  policySnapshot,
  agentResult,
  session
}
```

Errors produce the same shape with `status: "failed"`, empty `responseText`, `confidence: 0`, and `riskScore: 1`.

## Dependency injection map

`CognitiveLoopConfig` (defined in `packages/agents/src/types.ts`) is the wiring bundle:

| Field | Interface | Default implementation | Production swap |
|-------|-----------|----------------------|-----------------|
| `sessionManager` | `SessionManager` | `InMemorySessionManager` | Durable Postgres/OpenSearch store |
| `goalProvider` | `GoalProvider` | `EmptyGoalProvider` | `GoalSystem` |
| `policyProvider` | `PolicyProvider` | `StaticPolicyProvider` | `LivePolicyProvider` reading `InMemoryPolicyStore` |
| `memoryRetriever` | `MemoryRetrieverPort` | `StubMemoryRetriever` | `MemoryRetriever` with OpenSearch client |
| `reasoningModel` | `ReasoningModel` | `EchoReasoningModel` | `MultiAgentReasoningModel` or LLM-backed model |
| `toolExecutor` | `ToolExecutor` | `LocalToolExecutor` | `CompositeToolExecutor` with built-in + plugin tools |
| `policyEvaluationPublisher` | `PolicyEvaluationPublisher` | `NoopPolicyEvaluationPublisher` | Kafka-backed publisher |
