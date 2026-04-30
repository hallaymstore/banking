# Character GLB/GLTF assets

Place real humanoid `.glb` / `.gltf` models in this folder using these exact filenames:

- `male_staff.glb`
- `female_staff.glb`
- `male_client.glb`
- `female_client.glb`
- `guard.glb`
- `receptionist.glb`
- `npc_male.glb`
- `npc_female.glb`

The game automatically tries to load these files. If a file is missing, it uses the built-in procedural 3D fallback character.

Recommended model sources/workflow:

1. Create/export characters from Ready Player Me, Character Creator, Blender, or another licensed source.
2. Export as `.glb` with a humanoid skeleton.
3. Keep scale close to human height, but the engine auto-normalizes to approximately 2.35 scene units.
4. Put the files in this folder and refresh `/game.html`.

Recommended animation setup:

- Best result: characters and animation files should use the same humanoid rig naming.
- Mixamo-style animation names are automatically mapped if clips include words like `walk`, `idle`, `wave`, `handshake`, `sit`, `talk`, or `explain`.
