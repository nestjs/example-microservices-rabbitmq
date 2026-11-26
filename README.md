# Microservices with RabbitMQ in NestJS

This is the finished application of the tutorial [Build microservices in Node.js with RabbitMQ](https://docs.nestjs.com/tutorials/microservices-rabbitmq) in the NestJS documentation. The tutorial builds it step by step and explains every decision; this repository is the result, ready to clone.

A small online shop split in two services, in one Nest CLI monorepo:

- **orders** (`apps/orders`): an HTTP API that takes orders and keeps them in its own PostgreSQL database. Each order is announced with an `order.placed` event, written in the order's transaction with the transactional outbox (`@nestjs/outbox`) and published to RabbitMQ with publisher confirms. An order is accepted even while RabbitMQ is down; its event goes out when the broker is back.
- **fulfillment** (`apps/fulfillment`): a worker with its own database, which prepares a shipment for every order. It acknowledges an event only after handling it, tries a failing event 5 times with a backoff, then moves it to a dead-letter queue (a message that breaks its contract goes there at once), and handles each event once although RabbitMQ delivers at least once. It also answers `shipment.find` requests from the orders service.
- **contracts** (`libs/contracts`, imported as `@app/contracts`): the messages as Zod schemas, and the queues' options, shared by both services.

## Run it

You need Node.js 22 or later, and Docker for RabbitMQ and PostgreSQL.

```bash
git clone https://github.com/nestjs/example-microservices-rabbitmq.git
cd example-microservices-rabbitmq
npm install
cp apps/orders/.env.example apps/orders/.env
cp apps/fulfillment/.env.example apps/fulfillment/.env
docker compose up -d
npm run db:migrate
npm run start                  # the orders service, on http://localhost:3000
npm run start -- fulfillment   # in another terminal: the worker, on http://localhost:3001
```

`docker compose` starts RabbitMQ 4 with its management UI (http://localhost:15672, user `guest`, password `guest`) and PostgreSQL 17 with one database per service. `npm run db:migrate` applies both services' migrations; the outbox creates its own schema (`nest_outbox`) when the orders service starts. Swagger UI is at http://localhost:3000/docs.

Place an order, then ask for its shipment with the `id` it returns:

```bash
curl localhost:3000/orders --json '{"customerEmail":"grace@example.com","shippingAddress":"7 Compiler Street, Arlington","items":[{"sku":"KB-01","quantity":1}]}'
curl localhost:3000/orders/<id>/shipment
```

Start a second worker with `PORT=3002 npm run start -- fulfillment`: the two share the events. The tutorial's [Try it](https://docs.nestjs.com/tutorials/microservices-rabbitmq#try-it) section goes on with a broker outage, a stopped worker and a message that breaks its contract.

## Endpoints

The orders service:

| Endpoint | Section |
| --- | --- |
| `POST /orders`, `GET /orders/:id` | [Build the orders API](https://docs.nestjs.com/tutorials/microservices-rabbitmq#build-the-orders-api) |
| `GET /orders/:id/shipment` (503 when the fulfillment service doesn't answer within 3 seconds) | [Ask another service with request-response](https://docs.nestjs.com/tutorials/microservices-rabbitmq#ask-another-service-with-request-response) |
| `GET /health/live`, `GET /health/ready`, `GET /docs` (Swagger UI) | [Build the orders API](https://docs.nestjs.com/tutorials/microservices-rabbitmq#build-the-orders-api) |

The fulfillment service serves `GET /health/live` and `GET /health/ready` only ([Start the worker](https://docs.nestjs.com/tutorials/microservices-rabbitmq#start-the-worker)).

The messages between the services:

| Message | Style | Queue | Section |
| --- | --- | --- | --- |
| `order.placed` | Event, from orders to fulfillment | `fulfillment.events` (quorum, dead letters to `fulfillment.events.dead`) | [Publish events with the transactional outbox](https://docs.nestjs.com/tutorials/microservices-rabbitmq#publish-events-with-the-transactional-outbox), [Consume events in the fulfillment worker](https://docs.nestjs.com/tutorials/microservices-rabbitmq#consume-events-in-the-fulfillment-worker) |
| `shipment.find` | Request-response, from orders to fulfillment | `fulfillment.requests` | [Ask another service with request-response](https://docs.nestjs.com/tutorials/microservices-rabbitmq#ask-another-service-with-request-response) |

## Layout

| Path | What it holds |
| --- | --- |
| `libs/contracts/src/` | the `order.placed` event and its outbox envelope, the `shipment.find` request and reply (Zod), the queue names and options |
| `apps/orders/src/main.ts` | bootstrap on the Node adapter, security headers, CORS, JSON logs in production, Swagger UI |
| `apps/orders/src/app.module.ts` | Observe, config, database, the outbox with its RabbitMQ client, the validation pipe |
| `apps/orders/src/orders/` | the orders endpoints, the service that writes an order and its event in one transaction, the `shipment.find` client |
| `apps/fulfillment/src/main.ts` | the hybrid app: an HTTP server for health checks, and the events and requests RabbitMQ servers |
| `apps/fulfillment/src/messaging/` | the RabbitMQ server options, the interceptor that acknowledges, retries and dead-letters, the dead-letter queue declaration |
| `apps/fulfillment/src/shipments/` | the `order.placed` and `shipment.find` handlers, the idempotent shipment insert |
| `apps/*/src/config.ts` | each service's environment, as a Zod schema checked at startup |
| `apps/*/src/database/schema.ts`, `apps/*/drizzle/` | each service's Drizzle tables and migrations |
| `apps/*/src/health/` | liveness, and readiness (the service's database) |
| `apps/*/test/` | the e2e tests, against a real RabbitMQ and PostgreSQL |

## Tests

The tests use a RabbitMQ virtual host and two databases of their own, since they purge the queues and truncate the tables. `docker compose` creates the `orders_test` and `fulfillment_test` databases; create the virtual host once:

```bash
docker compose exec rabbitmq rabbitmqctl add_vhost test
docker compose exec rabbitmq rabbitmqctl set_permissions -p test guest ".*" ".*" ".*"
```

Then:

```bash
export TEST_RABBITMQ_URL=amqp://guest:guest@localhost:5672/test
export TEST_ORDERS_DATABASE_URL=postgres://postgres:shop@localhost:5432/orders_test
export TEST_FULFILLMENT_DATABASE_URL=postgres://postgres:shop@localhost:5432/fulfillment_test
npm run test:e2e
```

12 tests in 2 files, which take about 20 seconds: a worker crash, redeliveries, duplicates, retries and dead letters, competing workers, graceful shutdown, a rollback, a broker outage, and a request timeout. Set `TEST_LOGS=1` to see the services' logs. The tutorial's [Test it](https://docs.nestjs.com/tutorials/microservices-rabbitmq#test-it) section explains each test.

`npm run build -- --all` builds both services. `npx tsc -p tsconfig.spec.json` type-checks everything, tests included (the root `tsconfig.json` only references the projects, so `npx tsc --noEmit` checks nothing).

## Stack

[NestJS](https://nestjs.com) 12 on the Node adapter, the [RabbitMQ transport](https://docs.nestjs.com/microservices/rabbitmq) of `@nestjs/microservices` with RabbitMQ 4 and quorum queues, the [transactional outbox](https://docs.nestjs.com/reliability/outbox) `@nestjs/outbox`, [Drizzle](https://docs.nestjs.com/data/drizzle) and PostgreSQL, [Zod](https://zod.dev) validation, [`@nestjs/config`](https://docs.nestjs.com/application/configuration), [`@nestjs/swagger`](https://docs.nestjs.com/openapi/introduction), [`@nestjs/terminus`](https://docs.nestjs.com/reliability/terminus), [NestJS Observe](https://docs.nestjs.com/observability/overview), and Vitest.

## In production

Read the tutorial's production checklist first: https://docs.nestjs.com/tutorials/microservices-rabbitmq#production-checklist. It covers the migrations as a release step (the outbox's included), a three-node RabbitMQ cluster, a broker user per service, and alerting on the dead-letter queue.

Both services are wired to [NestJS Observe](https://docs.nestjs.com/observability/overview), each under its own service name (`orders` and `fulfillment`), and the RabbitMQ transport carries the trace id in each message's headers, so a request and the worker's answer show up as one trace. Until the key pair is set, the SDK sends nothing. `npx @nestjs/observe link`, run in the repository's root, writes `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` into a root `.env` and adds `--env-file .env` to the `nest start` scripts. In production, set the two variables in each service's environment.

## License

MIT
