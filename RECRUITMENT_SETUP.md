# Local game and admin dashboard

Participants open the game link, type a name, and select **Join game**. There
is no invitation code, waiting room, or approval step.

## 1. Start the game server

Open PowerShell and run:

```powershell
cd "C:\Users\mrina\Documents\Codex\2026-09-23\notion-plugin-notion-openai-curated-remote\Shooting_Game\shoot_game_server"
npm install
npm start
```

Keep this window open. The server is ready when it says it is listening on
port 8082.

## 2. Start the game page

Open a second PowerShell window and run:

```powershell
cd "C:\Users\mrina\Documents\Codex\2026-09-23\notion-plugin-notion-openai-curated-remote\Shooting_Game\shoot_game"
py -m http.server 8000
```

## 3. Open the two pages

- Participants use `http://localhost:8000/`, enter a name, and select **Join game**.
- The organizer uses `http://localhost:8000/admin/` in another browser tab or window.

The admin page lists every connected participant, their zombie kills, and their
zombie points. It refreshes automatically whenever someone kills a zombie.

## 4. Stop the game

Press `Ctrl+C` in each PowerShell window.
