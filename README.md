# Ironclad TD

## Run the game

```bash
cd "/Users/will/Documents/Coding Projects/tower-defense"
npm start
```

- Mobile preview: http://127.0.0.1:3002/?mobile=1
- Laptop layout: http://127.0.0.1:3002/?laptop=1

Mobile-only layout rules live under `body.mobile-layout` in `styles.css`, so they do not alter the laptop layout.

## Upload to itch.io

Upload `Ironclad-TD-itch.zip` as an HTML game and enable **This file will be played in the browser**. The ZIP has `index.html` at its root and runs in offline/static mode on itch.io. Progress is stored in the browser. Multiplayer and server accounts are available only when running the included Node server locally.
