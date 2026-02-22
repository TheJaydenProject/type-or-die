<a id="readme-top"></a>

<div align="center">

[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]

  <h3 align="center">Type or Die</h3>

  <p align="center">
    Real-time multiplayer typing survival game with Russian roulette mechanics
    <br />
    <a href="https://typeordie.org/"><strong>Play Demo »</strong></a>
    <br />
    <br />
    <a href="https://github.com/thejaydenproject/type-or-die/issues/new?labels=bug&template=bug-report---.md">Report Bug</a>
  </p>
</div>

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#tech-stack">Tech Stack</a></li>
      </ul>
    </li>
    <li><a href="#getting-started">Getting Started</a></li>
    <li><a href="#project-structure">Project Structure</a></li>
    <li>
      <a href="#architecture">Architecture</a>
      <ul>
        <li><a href="#system-design">System Design</a></li>
        <li><a href="#data-flow--state-management">Data Flow & State Management</a></li>
        <li><a href="#performance--reliability">Performance & Reliability</a></li>
      </ul>
    </li>
    <li><a href="#load-testing">Load Testing</a></li>
    <li><a href="#known-issues">Known Issues</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

## About The Project

Type or Die is a high-stakes multiplayer typing game combining competitive typing with Russian roulette mechanics. Players race to type randomly generated sentences within a 20-second window. A three-strike error system triggers a roulette spin, where death probability increases as the game progresses.

**Key Features:**
* **Risk/Reward Mechanics**: Survival odds start at 1/6 and improve with survival, creating dynamic tension.
* **Real-time Sync**: Supports up to 16 concurrent players with live state synchronization.
* **Difficulty Progression**: Sentences are split 20% Easy, 50% Medium, 30% Hard and served in order so games ramp up naturally.
* **Spectator Mode**: Eliminated players and late joiners can observe active matches.
* **Graceful Reconnection**: A 5-second grace period allows players to resume sessions after a disconnect.

### Tech Stack

**Monorepo Shared**
* **TypeScript**: Strict type safety shared across full stack.

**Frontend**
* **Vue 3** & **Vite**.
* **Socket.IO Client** for event-driven updates.
* **CSS3** with a brutalist terminal aesthetic.

**Backend**
* **Node.js (ESM)** & **Express**.
* **Redis (ioredis)** for room state, session management, and atomic locking.
* **PostgreSQL** for persistent sentence storage.
* **Lua Scripts** for atomic gameplay logic within Redis.

**Infrastructure**
* **Docker** & **Docker Compose**.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting Started

### Prerequisites
* Docker & Docker Compose
* Node.js 22+ (for local dev without Docker)

### Run with Docker (recommended)

```bash
docker compose -f docker-compose.local.yml up -d
```

| Service | URL |
|---|---|
| Frontend | http://localhost:8080 |
| Backend | http://localhost:4900 |

> After making code changes, rebuild and restart everything with:
> ```bash
> docker compose -f docker-compose.local.yml down; docker compose -f docker-compose.local.yml up --build -d
> ```

### Run without Docker (local dev)

Requires Postgres and Redis running locally. Then:

```bash
npm install
npm run dev
```

This runs the server and client in parallel via `concurrently`. Client runs on `:5173`, server on `:3001`.

### Environment variables

Copy these into a `.env` at the project root for local dev:

```env
PORT=3001
NODE_ENV=development
CLIENT_URL=http://localhost:5173

DB_HOST=localhost
DB_PORT=5432
DB_NAME=typeordie_dev
DB_USER=devuser
DB_PASSWORD=devpass123

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=localdevpassword

JWT_SECRET=local-dev-jwt-secret-change-me-12345
SESSION_SECRET=local-dev-session-secret-not-secure-12345

MAX_ROOMS_PER_IP=15
MAX_GLOBAL_ROOMS=100
MAX_ROOM_CREATIONS_PER_HOUR=20
DEFAULT_TIME_PER_SENTENCE=20
MAX_WPM_THRESHOLD=200
DISCONNECT_GRACE_PERIOD_MS=5000
ROOM_TTL_SECONDS=3600
```

### Linting & formatting

This project uses [Biome](https://biomejs.dev/). Run from the root:

```bash
npx biome check .        # check for issues
npx biome check --write .  # auto-fix
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Project Structure

```
type-or-die/
├── client/          # Vue 3 frontend (Vite)
├── server/          # Node.js + Socket.IO backend
│   └── src/
│       ├── handlers/        # Socket event handlers
│       ├── services/        # roomManager, sentenceService
│       ├── lua/             # Atomic Redis Lua scripts
│       └── utils/
├── shared/          # Shared TypeScript types (monorepo)
├── load-tests/      # Load test suite
├── init-sentences-db.sql   # DB schema + seed data
└── docker-compose.local.yml
```

**Key server files:**

| File | Purpose |
|---|---|
| `handlers/gameFlowHandlers.ts` | Countdown, game start/end |
| `handlers/playerActionHandlers.ts` | Typing input, mistype, timeout |
| `handlers/roomLifecycleHandlers.ts` | Room create/join/leave/settings |
| `services/roomManager.ts` | Room state, distributed locking, janitor |
| `services/sentenceService.ts` | Sentence fetching by difficulty tier |
| `lua/atomicCharUpdate.lua` | Atomic char validation + WPM calc in Redis |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Architecture

### System Design
The project is organized as a **TypeScript Monorepo** using npm workspaces.
* **`@typeordie/shared`**: Central source of truth for interfaces and Socket.IO protocols.
* **`@typeordie/server`**: Uses a handler-based pattern to decouple socket events from business logic.
* **`@typeordie/client`**: Separates typing logic (`GameController.js`) from the Vue rendering layer.

### Data Flow & State Management

* **Atomic Input Processing**: Character validation is processed via a **Redis Lua script** (`atomicCharUpdate.lua`). This calculates WPM and advancements in a single atomic step to prevent race conditions.
* **Concurrency Control**: Room states are protected by a **distributed locking mechanism** in `roomManager.ts`.
* **Event Pipeline**: Player actions are managed through a **Promise-based Event Queue** to ensure sequential execution.

### Performance & Reliability
* **Sentence Selection**: `sentenceService.ts` runs 3 parallel queries (one per difficulty tier) with `ORDER BY RANDOM()` to serve a fresh, balanced set each game.
* **Rate Limiting**: Integrated **IP-based room registration** and event rate limits protect against server abuse.
* **Janitor Service**: Background processes in `roomManager.ts` automatically clean up inactive rooms and orphaned IP tracking.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Load Testing

Simulates 16 players at ~140 WPM with random disconnects. See `testing.md` for full details.

```powershell
cd load-tests
$env:TARGET_URL="http://localhost:4900"; npx ts-node loadtest.ts
```

### Integration test suite

Runs a suite of automated socket-level tests against a live stack:

```bash
docker compose -f docker-compose.local.yml --profile test run test
```

Tests cover: room creation, joining, game flow, sentence completion, roulette, reconnection, and rate limiting.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Known Issues


<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

Distributed under the MIT License. See `LICENSE` for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contact

Jayden Wong - [@thejaydenproject](https://github.com/thejaydenproject)

Project Link: [https://github.com/thejaydenproject/type-or-die](https://github.com/thejaydenproject/type-or-die)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Acknowledgments

* Inspired by **Final Sentence** on Steam.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

[contributors-shield]: https://img.shields.io/github/contributors/thejaydenproject/type-or-die.svg?style=for-the-badge
[contributors-url]: https://github.com/thejaydenproject/type-or-die/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/thejaydenproject/type-or-die.svg?style=for-the-badge
[forks-url]: https://github.com/thejaydenproject/type-or-die/network/members
[stars-shield]: https://img.shields.io/github/stars/thejaydenproject/type-or-die.svg?style=for-the-badge
[stars-url]: https://github.com/thejaydenproject/type-or-die/stargazers
[issues-shield]: https://img.shields.io/github/issues/thejaydenproject/type-or-die.svg?style=for-the-badge
[issues-url]: https://github.com/thejaydenproject/type-or-die/issues
[license-shield]: https://img.shields.io/github/license/thejaydenproject/type-or-die.svg?style=for-the-badge
[license-url]: https://github.com/thejaydenproject/type-or-die/blob/master/LICENSE