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
        <li><a href="#data-flow">Data Flow</a></li>
        <li><a href="#performance-optimizations">Performance Optimizations</a></li>
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
* **Risk/Reward Mechanics:** Survival odds start at 1/6 and improve with survival, creating dynamic tension.
* **Real-time Sync:** Supports up to 16 concurrent players with live state synchronization.
* **Spectator Mode:** Eliminated players and late joiners can observe active matches.

### Tech Stack

**Frontend**
* **Vue 3** & **TypeScript**
* **Vite**
* **Socket.IO Client**
* **CSS3**

**Backend**
* **Node.js** & **Express**
* **TypeScript** (Strict typing across full stack)
* **Socket.IO** for event-based game state
* **Redis** for room state, session management, and atomic locking
* **PostgreSQL** for persistent sentence storage

**Infrastructure**
* **Docker** & **Docker Compose**

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Architecture

### System Design
The backend uses a handler-based pattern (Connection, Room, Game, Player) to decouple logic. The frontend uses a component hierarchy separating the Game Loop (`GameController.js`) from UI rendering (`GameScreen.vue`).

### Data Flow
1. **Room Creation:** Atomic Lua scripts validate IP limits and register rooms in Redis.
2. **Gameplay:** Character inputs are validated server-side using atomic Lua scripts. Correct inputs broadcast updates; mistakes trigger strike/roulette logic.
3. **State Sync:** Socket.IO broadcasts delta updates (indexes, WPM, status) to minimize bandwidth.

### Performance Optimizations
* **Atomic Operations:** Critical logic (strikes, char validation) runs in Redis Lua scripts to prevent race conditions.
* **Efficient Queries:** Sentence selection uses `TABLESAMPLE` for O(1) sampling on large datasets.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Known Issues

**Host Disconnect on End Screen**
If the Host disconnects directly from the post-game scoreboard without clicking "Return to Lobby," the room state does not reset to the lobby phase. This soft-locks the session for remaining players, requiring room recreation.

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