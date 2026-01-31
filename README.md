<div align="center">
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
    <li>
      <a href="#architecture">Architecture</a>
      <ul>
        <li><a href="#system-design">System Design</a></li>
        <li><a href="#data-flow--state-management">Data Flow & State Management</a></li>
        <li><a href="#performance--reliability">Performance & Reliability</a></li>
      </ul>
    </li>
    <li><a href="#known-issues">Known Issues</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

## About The Project

Type or Die is a high-stakes multiplayer typing game combining competitive typing with Russian roulette mechanics. Players race to type randomly generated sentences within a 20-second window. A three-strike error system triggers a roulette spin, where death probability increases as the game progresses.

**Key Features:**
* **Risk/Reward Mechanics:** Survival odds start at 1/6 and improve with survival (capped at 1/2), creating dynamic tension.
* **Real-time Sync:** Supports up to 16 concurrent players with live state synchronization and ranking.
* **Spectator Mode:** Eliminated players and late joiners can observe active matches through a real-time "Target" camera system.
* **Graceful Reconnection:** A 30-second window allows players to recover sessions without losing progress.

### Tech Stack

**Monorepo Shared**
* **TypeScript**: Strict end-to-end typing for all Socket.IO events and entity states.

**Frontend**
* **Vue 3 (Composition API)** & **Vite**
* **Socket.IO Client** for low-latency updates

**Backend**
* **Node.js (ESM)** & **Express**
* **Redis (ioredis)**: Primary source of truth for room states and atomic logic
* **PostgreSQL (pg)**: Sentence pool management
* **Lua Scripts**: High-performance atomic state updates inside Redis

**Infrastructure**
* **Docker** & **Docker Compose**

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Architecture

### System Design
The project is organized as a **TypeScript Monorepo** using npm workspaces to ensure the client and server never drift out of sync.
* **`@typeordie/shared`**: Defines the shared schema for `PlayerState`, `RoomState`, and the `Socket Protocol`.
* **`@typeordie/server`**: A handler-based architecture (Connection, Room Lifecycle, Game Flow, Player Actions) that decouples networking from business logic.
* **`@typeordie/client`**: Separates UI rendering (`GameScreen.vue`) from typing logic (`GameController.js`) to allow for modularity and testing.

### Data Flow & State Management
* **Atomic Input Processing**: Character validation is offloaded to a **Redis Lua script** (`atomicCharUpdate.lua`). This prevents race conditions in high-WPM scenarios by calculating indexes, WPM, and sentence advancement in a single atomic step.
* **Distributed Locking**: Room modifications (joins, leaves, status changes) are protected by a custom **Redis-based locking mechanism** (`withLock`) to ensure data integrity during simultaneous events.
* **Event Pipeline**: To maintain strict sequence, player actions are processed through a **Promise-based Event Queue** (`queuePlayerEvent`), ensuring one input is fully resolved before the next begins for that specific player.

### Performance & Reliability
* **Bernoulli Sampling**: `sentenceService.ts` uses `TABLESAMPLE BERNOULLI` for O(1) random retrieval from the sentence pool, with a standard fallback query for small datasets.
* **Automated Janitor**: A background cleanup service in `roomManager.ts` periodically removes orphaned IP tracking and inactive rooms to keep Redis memory usage lean.
* **Rate Limiting**: Integrated **IP-based room registration** and **event rate limiting** prevent server abuse.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Known Issues

**Host Migration Context Reset**
When a host leaves a room in a `PLAYING` or `FINISHED` state, the room automatically resets to the `LOBBY` phase for the new host. While this prevents session soft-locks, it results in the current match being abandoned for remaining players.

**Sampling Imprecision**
The `TABLESAMPLE` used in sentence selection may return insufficient rows if the total sentence count in the database is small, triggering a secondary fallback query.

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