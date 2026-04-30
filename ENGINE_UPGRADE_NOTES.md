# Virtual Bank 3D Engine Upgrade

This build upgrades `/game.html` into an engine-ready Three.js simulator.

## Added

- Local Three.js module pipeline via `/vendor/three` served from `node_modules/three`.
- GLB/GLTF character loader with `GLTFLoader` and `SkeletonUtils`.
- Real character asset slots under `public/assets/models/characters`.
- Optional animation clip slots under `public/assets/animations`.
- Animation mixer with automatic action mapping for idle, walk, wave, handshake, sit, explain/talk.
- Procedural fallback characters when GLB assets are missing.
- Mouse camera controls:
  - drag to rotate the camera
  - wheel to zoom
  - double click to reset camera
- NPC A* pathfinding over the bank map.
- Animated sliding doors that open when a player or NPC approaches.
- Procedural texture system for floor, wall, and brick-like surfaces.
- Existing RBAC, queue, voice chat, multiplayer polling, and banking APIs are preserved.

## Running

```bash
npm install
npm start
```

Then open:

```text
http://localhost:5000/game.html
```

## Asset filenames

Characters:

```text
public/assets/models/characters/male_staff.glb
public/assets/models/characters/female_staff.glb
public/assets/models/characters/male_client.glb
public/assets/models/characters/female_client.glb
public/assets/models/characters/guard.glb
public/assets/models/characters/receptionist.glb
public/assets/models/characters/npc_male.glb
public/assets/models/characters/npc_female.glb
```

Animations:

```text
public/assets/animations/idle.glb
public/assets/animations/walk.glb
public/assets/animations/wave.glb
public/assets/animations/handshake.glb
public/assets/animations/sit.glb
public/assets/animations/explain.glb
```

## Notes

Licensed 3D human models are not bundled in this zip. Add your own licensed GLB/GLTF assets using the names above. The game will immediately use them without changing server code.
