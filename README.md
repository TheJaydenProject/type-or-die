<!-- Improved compatibility of back to top link: See: https://github.com/othneildrew/Best-README-Template/pull/73 -->
<a id="readme-top"></a>

[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <h3 align="center">Type or Die</h3>

  <p align="center">
    Real-time multiplayer typing survival game with Russian roulette mechanics
    <br />
    <a href="https://github.com/thejaydenproject/type-or-die"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="https://github.com/thejaydenproject/type-or-die">View Demo</a>
    ·
    <a href="https://github.com/thejaydenproject/type-or-die/issues/new?labels=bug&template=bug-report---.md">Report Bug</a>
    ·
    <a href="https://github.com/thejaydenproject/type-or-die/issues/new?labels=enhancement&template=feature-request---.md">Request Feature</a>
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#game-overview">Game Overview</a></li>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#architecture">Architecture</a>
      <ul>
        <li><a href="#system-design">System Design</a></li>
        <li><a href="#data-flow">Data Flow</a></li>
        <li><a href="#performance-optimizations">Performance Optimizations</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#testing">Testing</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->
## About The Project

Type or Die is a high-stakes multiplayer typing game that combines competitive typing mechanics with Russian roulette-style survival gameplay. Players race against time to type randomly generated sentences while managing a three-strike error system. Each third mistake triggers a roulette spin where death becomes increasingly likely as the game progresses.

### Game Overview

**Core Mechanics**

The game implements a tension-driven progression system where typing accuracy and speed determine survival. Players must complete sentences within a 20-second window while avoiding mistakes. The mistake tolerance system creates strategic depth through progressive difficulty scaling.

**Three-Strike System**

Players accumulate strikes for typing errors. Upon reaching three strikes, the roulette mechanism activates. Initial survival odds start at 1/6 (one bullet, six chambers) and improve with each survived spin, creating a dynamic risk-reward balance that intensifies as players progress.

**Multiplayer Dynamics**

Real-time competitive gameplay supports up to 16 simultaneous players per room. The system tracks live progress, typing statistics, and player elimination in real-time. Spectator mode allows eliminated players and late joiners to observe ongoing matches without disrupting gameplay.

**Victory Conditions**

Games conclude when either all players are eliminated (last survivor wins) or a player completes all assigned sentences (completion victory). Final statistics include typing speed, accuracy metrics, completed sentences, and roulette survival history.

**Session Management**

Players can create or join rooms using six-character codes. Room hosts control game settings including sentence count (5-100 sentences). The system implements automatic reconnection for disconnected players with a 30-second grace period during active gameplay.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

**Frontend**

* React 19 - UI framework for component-based architecture
* Socket.IO Client - WebSocket communication with fallback support
* Zustand - Lightweight state management
* Vite - Build tool and development server
* CSS3 - Custom terminal-inspired styling with animations

**Backend**

* Node.js - JavaScript runtime environment
* Express - HTTP server and API routing
* Socket.IO - Real-time bidirectional event-based communication
* Redis - In-memory data store for room state and session management
* PostgreSQL - Relational database for sentence storage
* IORedis - Redis client with Lua scripting support

**Infrastructure**

* Docker - Containerization platform
* Docker Compose - Multi-container orchestration
* Nginx - Reverse proxy and static file serving

**Development Tools**

* ESLint - Code quality and consistency enforcement
* Nodemon - Development server auto-reload
* Concurrently - Parallel script execution

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ARCHITECTURE -->
## Architecture

### System Design

**Client Architecture**

The frontend implements a single-page application with real-time state synchronization. Component hierarchy separates concerns between game logic, UI rendering, and network communication. State management handles player progress, room status, and typing validation without prop drilling.

**Server Architecture**

The backend follows a modular handler-based pattern separating connection lifecycle, room management, game flow, and player actions. Each handler manages specific aspects of game state while maintaining loose coupling through the Socket.IO event system.

**Database Layer**

PostgreSQL stores the sentence pool with metadata including word count, character count, difficulty rating, language, and emoji flags. The sentence service implements efficient random selection using TABLESAMPLE for large datasets with fallback to standard randomization.

**Cache Layer**

Redis serves as the primary data store for active game state. Room data, player statistics, and session information persist in memory with TTL-based expiration. The system uses Redis locks to prevent race conditions during concurrent state modifications.

### Data Flow

**Room Creation Flow**

Client requests room creation with host nickname and settings. Server validates global room limits and per-IP restrictions. Atomic Lua scripts register room creation in IP tracking. Server generates unique six-character room code and initializes room state in Redis. Host receives room code and joins via Socket.IO room channel.

**Gameplay Flow**

Players emit character typed events containing character, index, and timestamp. Server validates character against expected sentence position using atomic Lua scripts. On correct input, server updates player progress and broadcasts to all room members. On incorrect input, server increments strike counter and resets sentence progress. Third strike triggers roulette mechanism with cryptographically random chamber selection.

**State Synchronization**

All players in a room receive real-time updates via Socket.IO broadcasts. Progress events include character index, sentence index, WPM calculations, and accuracy metrics. Strike events reset timers and update UI indicators. Roulette events display animated chamber selection and survival results. Game end events compile final statistics and transition all players to results screen.

**Reconnection Flow**

Disconnected players enter 30-second grace period with DISCONNECTED status. Room state persists during grace period maintaining player progress. Reconnection attempts validate session against stored player data. Successful reconnection restores player state and resumes gameplay. Expired grace periods trigger permanent player removal and potential host migration.

### Performance Optimizations

**Atomic Operations**

Critical game logic executes in Redis Lua scripts to ensure atomicity. Character validation, room registration, and lock management run server-side to prevent race conditions. Scripts reduce network round-trips by combining multiple operations into single atomic transactions.

**Event Rate Limiting**

Per-player event rate limiting prevents spam and DOS attacks. System tracks event counts with sliding window reset. Limits apply to all player action events including character typing and mistake reporting.

**Connection Pooling**

PostgreSQL connection pool maintains 5-20 active connections. Pool configuration includes aggressive timeouts to prevent zombie connections. Redis connection uses single persistent client with automatic reconnection strategy.

**Efficient Queries**

Sentence selection uses TABLESAMPLE for O(1) random sampling on large tables. Query filters apply before sampling to reduce scan overhead. Fallback query handles edge cases with small datasets.

**Memory Management**

Rate limit data cleanup runs every 60 seconds removing stale player records. Inactive room cleanup runs every 5 minutes removing rooms exceeding 1-hour inactivity threshold. TTL-based Redis expiration provides automatic memory reclamation.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- GETTING STARTED -->
## Getting Started

### Prerequisites

The following software must be installed on your development machine:

* Docker (version 20.10 or higher)
* Docker Compose (version 2.0 or higher)
* Node.js (version 18 or higher, for local development)
* npm (comes bundled with Node.js)

### Installation

**Using Docker Compose (Recommended)**

Clone the repository to your local machine

```sh
git clone https://github.com/thejaydenproject/type-or-die.git
cd type-or-die
```

Create the PostgreSQL initialization file

```sh
touch init-sentences-db.sql
```

Populate the database initialization file with your sentence data following the schema defined in the sentence service. The file should create the sentences table and insert initial data.

Start all services using Docker Compose

```sh
docker-compose -f docker-compose.local.yml up -d
```

Access the application at http://localhost:8080

**Local Development Setup**

Clone the repository

```sh
git clone https://github.com/thejaydenproject/type-or-die.git
cd type-or-die
```

Install server dependencies

```sh
npm install
```

Install client dependencies

```sh
cd client
npm install
cd ..
```

Configure environment variables by creating a .env file in the project root with the following variables:

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=typeordie_dev
DB_USER=devuser
DB_PASSWORD=devpass123
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=localdevpassword
PORT=3001
CLIENT_URL=http://localhost:5173
```

Start Redis and PostgreSQL services using Docker

```sh
docker-compose -f docker-compose.local.yml up -d redis postgres
```

Start the development servers

```sh
npm run dev:all
```

Access the application at http://localhost:5173

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- USAGE -->
## Usage

**Creating a Game**

Enter your desired nickname in the operator name field. Select sentence count using the slider (5-100 sentences in increments of 5). Click CREATE ROOM to generate a new game room. Share the displayed six-character room code with other players.

**Joining a Game**

Enter your nickname in the operator name field. Enter the six-character room code provided by the host. Click JOIN ROOM to enter the game lobby. Wait for the host to start the game or observe if joining during active gameplay.

**Gameplay**

Type the displayed sentence exactly as shown including capitalization and punctuation. Complete each sentence within the 20-second time limit. Mistakes reset your progress on the current sentence and add one strike. Three strikes trigger the roulette mechanism where survival becomes a game of chance. Continue typing sentences until either completing all assigned sentences or being eliminated.

**Host Controls**

Room hosts can adjust sentence count before starting the game. Hosts can reset the game during active play to return all players to the lobby. Only hosts can initiate game start countdown.

**Results Screen**

View your final grade based on accuracy (SS/S/A/B/C/F rating system). Review detailed statistics including completion rate, accuracy percentage, average WPM, and total errors. Compare performance against other players on the ranking tab. Examine your typing history with per-sentence metrics on the logs tab. Review all roulette events and survival outcomes on the casualty tab. Return to lobby for another game or exit to main menu.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- TESTING -->
## Testing

**Running the Test Suite**

The project includes a comprehensive Docker-based test suite covering infrastructure validation, Socket.IO communication, game logic, and room management.

Execute the complete test suite

```sh
docker-compose -f docker-compose.local.yml down -v
docker-compose -f docker-compose.local.yml --profile test up --build test
```

**Test Coverage**

Infrastructure Tests verify Redis connectivity, PostgreSQL connectivity, sentence database population, and query functionality.

Socket.IO Tests validate connection establishment, room creation, room joining, settings modification, game start mechanics, and countdown behavior.

Game Logic Tests confirm character validation, player progress tracking, mistake handling, sentence completion, and timeout mechanics.

Room Manager Tests ensure atomic room registration, global room counting, Redis persistence, IP-based rate limiting, and room cleanup on disconnection.

**Interpreting Results**

Test output displays real-time progress with pass/fail indicators. Summary statistics show total tests, passed tests, and failed tests. Failed tests include detailed error messages explaining the failure reason. Exit code 0 indicates all tests passed. Exit code 1 indicates one or more test failures.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ROADMAP -->
## Roadmap

**Planned Features**

- [ ] Status Effects System
  - [ ] Temporary typing modifiers (slowdown, reverse controls, hidden text)
  - [ ] Positive buffs (shield, time extension, strike removal)
  - [ ] Player-activated abilities with cooldowns

- [ ] Enhanced Player Interaction
  - [ ] Sabotage mechanics (deploy status effects on opponents)
  - [ ] Power-up collection from completing sentences
  - [ ] Team-based modes (cooperative survival, relay typing)
  - [ ] Voting system for sentence difficulty adjustment

- [ ] Additional Game Modes
  - [ ] Speed mode (shorter time limits, faster progression)
  - [ ] Endurance mode (unlimited sentences, survival time competition)
  - [ ] Practice mode (solo play with performance tracking)
  - [ ] Tournament brackets (automated elimination rounds)

- [ ] UI/UX Improvements
  - [ ] Customizable themes and color schemes
  - [ ] Sound effects and audio feedback
  - [ ] Replay system for completed games
  - [ ] Detailed statistics dashboard

See the [open issues](https://github.com/thejaydenproject/type-or-die/issues) for a full list of proposed features and known issues.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTRIBUTING -->
## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also simply open an issue with the tag "enhancement".

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- LICENSE -->
## License

Distributed under the MIT License. See `LICENSE` for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTACT -->
## Contact

Jayden Wong - [@thejaydenproject](https://github.com/thejaydenproject)

Project Link: [https://github.com/thejaydenproject/type-or-die](https://github.com/thejaydenproject/type-or-die)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

* [Socket.IO Documentation](https://socket.io/docs/)
* [Redis Documentation](https://redis.io/documentation)
* [React Documentation](https://react.dev/)
* [Docker Documentation](https://docs.docker.com/)
* [Best README Template](https://github.com/othneildrew/Best-README-Template)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
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