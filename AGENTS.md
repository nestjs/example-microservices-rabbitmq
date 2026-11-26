# AGENTS.md

## NestJS

This app's version of NestJS is likely newer than what you know. https://docs.nestjs.com/llms.txt indexes its documentation, with a markdown page per chapter.

The official NestJS agent skills are installed with `npx @nestjs/skills add --agent all`, which also updates them: the mistakes agents make in Nest apps, with recipes checked on the released packages. An agent loads a skill when a task matches it.

Nest has first-party packages for these, so check them before adding another library or writing your own:

- Databases: [`@nestjs/typeorm`](https://docs.nestjs.com/data/typeorm.md), [`@nestjs/drizzle`](https://docs.nestjs.com/data/drizzle.md), [`@nestjs/mongoose`](https://docs.nestjs.com/data/mongodb.md), [`@nestjs/sequelize`](https://docs.nestjs.com/data/sequelize.md).
- OpenAPI: [`@nestjs/swagger`](https://docs.nestjs.com/openapi/introduction.md). GraphQL: [`@nestjs/graphql`](https://docs.nestjs.com/graphql/quick-start.md). WebSockets: [`@nestjs/websockets`](https://docs.nestjs.com/websockets/gateways.md). Microservices: [`@nestjs/microservices`](https://docs.nestjs.com/microservices/basics.md).
- Sign-in: [`@nestjs/authentication`](https://docs.nestjs.com/security/authentication.md). Permissions: [`@nestjs/authorization`](https://docs.nestjs.com/security/authorization.md). Rate limiting: [`@nestjs/throttler`](https://docs.nestjs.com/security/rate-limiting.md).
- Configuration: [`@nestjs/config`](https://docs.nestjs.com/application/configuration.md). Caching: [`@nestjs/cache-manager`](https://docs.nestjs.com/data/caching.md). Health checks: [`@nestjs/terminus`](https://docs.nestjs.com/reliability/terminus.md). Events inside the app: [`@nestjs/event-emitter`](https://docs.nestjs.com/application/events.md).
- Email: [`@nestjs/mail`](https://docs.nestjs.com/application/mail.md). Files, S3 included: [`@nestjs/storage`](https://docs.nestjs.com/application/file-storage.md). Translations: [`@nestjs/i18n`](https://docs.nestjs.com/application/i18n.md).
- Retries, timeouts and circuit breakers: [`@nestjs/resilience`](https://docs.nestjs.com/reliability/resilience.md).
- Idempotency keys: [`@nestjs/idempotency`](https://docs.nestjs.com/reliability/idempotency.md). Transactional outbox: [`@nestjs/outbox`](https://docs.nestjs.com/reliability/outbox.md). Sending and receiving webhooks: [`@nestjs/webhooks`](https://docs.nestjs.com/http/webhooks.md).
- Queues: [`@nestjs/bullmq`](https://docs.nestjs.com/application/queues.md). Scheduled jobs: [`@nestjs/schedule`](https://docs.nestjs.com/application/task-scheduling.md).
- Running a scheduled job on one instance, and locks: [`@nestjs/locks`](https://docs.nestjs.com/reliability/locks.md). Processes that take days: [`@nestjs/workflows`](https://docs.nestjs.com/reliability/workflows.md).
- Language models, tools and agents: [`@nestjs/ai`](https://docs.nestjs.com/ai/overview.md). MCP servers: [`@nestjs/mcp`](https://docs.nestjs.com/mcp/overview.md).

Validation works with Zod, Valibot, ArkType or any other Standard Schema library, with no classes or decorator metadata: `StandardSchemaValidationPipe` with `@Body({ schema })` or `@Param('id', { schema })` (https://docs.nestjs.com/application/validation.md). `class-validator` still works, through `ValidationPipe`.

`NodeAdapter` from `@nestjs/platform-node` is the fastest HTTP adapter, ahead of Fastify (https://docs.nestjs.com/http/performance.md).

A route handler can return a web `Response`, a `ReadableStream` or an async generator, and Nest streams it as it's produced (https://docs.nestjs.com/http/streaming-responses.md).

Nest's packages are ESM only, and this project is ESM too: relative imports end in `.js`, `__dirname` doesn't exist (use `import.meta.dirname`), and tests run on Vitest, so mocks are `vi.fn()`, not `jest.fn()`.

This project is a Nest CLI monorepo (see "This project" below): each application's `apps/<name>/src/main.ts` creates it and listens on `PORT`, and its `apps/<name>/src/app.module.ts` is the root module that imports the others. The e2e tests are in `apps/<name>/test/`; Vitest runs them (`npm run test:e2e`).

When a task says how to test, follow it. When it says nothing, cover the behaviour you change with focused tests rather than adding broad e2e suites.

## Production data: NestJS Observe

This app's production telemetry - traces, errors, logs and metrics - goes to [NestJS Observe](https://observe.nestjs.com). `ObserveModule` is registered first in each application's `apps/<name>/src/app.module.ts`, with a `serviceId` of its own (`orders`, `fulfillment`), and each `main.ts` passes `instrument: ObserveInstrument`. Until the key pair (`OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET`) is set, nothing is sent: `npx @nestjs/observe link`, run in the workspace's root, writes it to the root `.env` and adds `--env-file .env` to the `nest start` scripts.

When a task depends on how the app behaves in production - an error users hit, a slow endpoint, a failing job, whether a release made things worse - work from that data, not from the code alone:

- The Observe MCP server answers those questions directly: errors with their traces and logs, slow operations, jobs, and what a release changed (`find_regressions`, `diff_release`). It is included on the Pro plan and above. In Claude Code: `claude mcp add observe --transport http https://observe-api.nestjs.com/mcp`, and the client opens a browser to approve. Other clients: https://www.observe.nestjs.com/documentation/mcp
- Without it, the user can open the request or error in the Observe dashboard and click **Copy agent prompt**, which hands over that page's trace, stack and logs as text.

## This project

A small online shop in two services that talk over RabbitMQ: an orders HTTP API and a fulfillment worker, each with its own PostgreSQL database. It is the finished app of https://docs.nestjs.com/tutorials/microservices-rabbitmq, which explains each part; follow its choices when you change the code.

- Layout: a Nest CLI monorepo. `apps/orders` (the default project: `nest start` without a name starts it), `apps/fulfillment` (`nest start fulfillment`), and `libs/contracts`, imported as `@app/contracts`. Run every command from the root: each app loads `apps/<name>/.env`, and each `drizzle.config.ts` uses paths from the root. Inside an app, one folder per feature (module, controller, service, Zod schemas).
- Each service owns its data. Never read or write the other service's tables, and never import one app's source into the other's: they share only `libs/contracts` (the orders e2e test starts a real worker from `apps/fulfillment/test/support.ts`, which is the one exception).
- Contracts: every message is a Zod schema in `libs/contracts`. The sender parses the payload against it (`orderPlacedSchema.parse()` inside the order's transaction), the receiver validates it with `StandardSchemaValidationPipe` and `@Payload({ schema })`. Add fields as optional; give a breaking change a new topic (`order.placed.v2`).
- Queue options live in `libs/contracts/src/queues.ts`, and both sides take them from there: producers and the consumer all declare the queue, and RabbitMQ refuses a declaration whose options differ (`PRECONDITION_FAILED`, the channel closes). Changing the options of an existing queue needs a new queue, not an edit.
- Events are published only through the outbox: `outbox.add(tx, ...)` inside the database transaction that makes the change, then `outbox.notify()`. Never `emit()` an event from a request handler: it could be lost, or sent for a change that rolled back.
- Event handlers (`@EventPattern`) run on the events server with `noAck: false` and carry `@UseInterceptors(RmqAckInterceptor)` (`apps/fulfillment/src/messaging/`). The interceptor acknowledges after the handler resolves; on failure it republishes a copy with `x-attempt` + 1 after a backoff, and after 5 attempts, or at once for an `InvalidMessageException`, moves it to `fulfillment.events.dead` with `x-attempts` and `x-error`. Without the interceptor, a failed event stays unacknowledged until the worker stops. Don't retry with `nack(requeue)`: RabbitMQ 4 doesn't count it against `x-delivery-limit`, so the message loops forever. The delivery limit (5) only catches an event that kills its consumer.
- The transport declares only the queue it consumes; `DeadLetterQueue` declares `fulfillment.events.dead` at bootstrap. Declare any new dead-letter target the same way, or RabbitMQ drops the dead letters.
- Handlers are idempotent: RabbitMQ delivers at least once, and two copies of an event can run at once on two instances. Write with one conditional statement (`INSERT ... ON CONFLICT DO NOTHING RETURNING` in `ShipmentsService.createFor()`), never a `SELECT` then an `INSERT`. Don't depend on the order events arrive in.
- Request-response: `ClientProxy.send()` with `timeout(REQUEST_TIMEOUT_MS)`, mapped to a 503 (`FulfillmentClient`). Requests have their own queue, with a `messageTtl` equal to the timeout, so they never wait behind events.
- HTTP validation: a global `StandardSchemaValidationPipe`, with Zod schemas passed to `@Body()` and `@Param()` with the `schema` option. The order body is derived from the event's schema, so the API can't accept an order the event would reject.
- Configuration: each app's `src/config.ts` is a Zod schema that `ConfigModule` checks at startup. A new variable goes there and in `apps/<name>/.env.example`.
- Readiness checks the service's own database, not RabbitMQ: the transport reconnects by itself, and orders keep committing during a broker outage.
- There is no sign-in, on purpose; the tutorial points to the JWT tutorial for it.
- Migrations: change `apps/<name>/src/database/schema.ts`, then `npx drizzle-kit generate --config apps/<name>/drizzle.config.ts --name=<what-changed>` (or `npm run db:generate` for both), and commit the folder it writes in `apps/<name>/drizzle/`. `npm run db:migrate` applies both services'. The outbox migrates its own schema at startup, except with `NODE_ENV=production` (then `npx @nestjs/outbox migrate`).
- Type-check with `npx tsc -p tsconfig.spec.json`: the root `tsconfig.json` has `"files": []`, so `npx tsc --noEmit` checks nothing. Build both apps with `npm run build -- --all`.
- Tests: `npm run test:e2e` against a real RabbitMQ (its own virtual host) and PostgreSQL, with `TEST_RABBITMQ_URL`, `TEST_ORDERS_DATABASE_URL` and `TEST_FULFILLMENT_DATABASE_URL` set (see the README). The files run one at a time, since they share the broker. The invariants they protect:
  - `apps/fulfillment/test/shipments.e2e-spec.ts`: two copies of one event create one shipment; a contract-breaking message is dead-lettered at once without calling the handler; a failing event is retried, and dead-lettered with its error after 5 attempts; an event whose worker crashes before acknowledging is redelivered to another worker; workers share events, each handled once; shutdown finishes the event in flight, and requeues it when the grace period runs out.
  - `apps/orders/test/orders.e2e-spec.ts`: an order reaches a shipment end to end; a rolled-back order publishes nothing; an order is accepted while the broker is unreachable and ships once it is back; `GET /orders/:id/shipment` answers 503 when the worker doesn't answer in time.
