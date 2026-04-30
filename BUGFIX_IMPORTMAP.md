# Three.js importmap bugfix

This build fixes the browser error:

`Uncaught TypeError: Failed to resolve module specifier "three"`

Fix applied:
- Added an import map in `public/game.html`
- Mapped `three` to `/vendor/three/build/three.module.js`
- Mapped `three/addons/` to `/vendor/three/examples/jsm/`
- Updated imports to standard Three.js module specifiers
- Added `public/favicon.ico` to remove the 404 favicon warning

Run:
```bash
npm install
npm start
```

Open:
```text
http://localhost:5000/game.html
```
