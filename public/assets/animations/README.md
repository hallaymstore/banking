# Animation GLB files

Optional animation-only `.glb` files can be placed here:

- `idle.glb`
- `walk.glb`
- `wave.glb`
- `handshake.glb`
- `sit.glb`
- `explain.glb`

The game loads these clips and maps them to actions:

- `idle` -> standing/breathing
- `walk` -> movement
- `wave` -> salomlashish
- `handshake` -> qo‘l berish
- `sit` -> o‘tirish
- `explain` -> tushuntirish / gapirish

Important: external animation clips work best when exported from the same rig/skeleton as the character models. If clips are missing or incompatible, the procedural fallback animation remains active.
