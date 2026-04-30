# Virtual Bank 3D Training Simulator

Bu versiyada bank simulator `game.html` sahifasida brauzerda ishlaydigan virtual filialga aylantirildi.

## Ishga tushirish

```bash
npm install
npm start
```

Keyin brauzerda:

- `http://localhost:5000/login.html`
- Mijoz yoki xodim bo‘lib kiring
- `game.html` virtual filial sahifasi avtomatik ochiladi yoki URL orqali kiriladi

## Demo mijoz loginlari

- `client1 / Client@123`
- `client2 / Client@123`
- `client3 / Client@123`
- `vipclient / Client@123`

## Yangi o‘yin funksiyalari

### Third-person personaj boshqaruvi

- `W` yoki `↑` — oldinga yurish
- `S` yoki `↓` — orqaga yurish
- `A` / `D` yoki `←` / `→` — chap/o‘ng burilish
- `Q` / `E` — yon yurish
- `Shift` — sekin yurish
- `F` — yaqin personajga salom berish
- `Space` — qo‘l ko‘tarib salom berish
- `X` — qo‘l bilan tushuntirish animatsiyasi
- `H` — qo‘l uzatish / handshake animatsiyasi
- `V` — push-to-talk ovozli chat

### Multiplayer holat

Har bir login serverga o‘zining koordinatasi, burilishi, pose/gesture holatini yuboradi. Boshqa loginlar buni polling orqali ko‘radi. Bu WebSocket talab qilmaydi, Express + MongoDB loyihasining mavjud tuzilmasini buzmaydi.

### Ovozli chat

Mikrofon orqali qisqa audio chunklar `/api/game/voice` endpointiga yuboriladi. Boshqa foydalanuvchilar `Audio eshitishni yoqish` tugmasini bosgan bo‘lsa, ular ovozni eshitadi. Ovoz proximity-based: personajlar juda uzoq bo‘lsa, audio eshitilmaydi yoki pastroq eshitiladi.

> Eslatma: bu WebRTC/Discord darajasidagi uzluksiz voice emas, lekin o‘quv simulatori uchun server orqali ishlaydigan push-to-talk real-time voice prototipidir. Browser mikrofon ruxsati odatda `localhost` yoki HTTPS’da ishlaydi.

### RBAC saqlangan

Xodimlar virtual sahifada ham roliga tegishli xizmatlarni ko‘radi:

- Kassir: kassa navbati
- Kredit mutaxassisi: kredit navbati
- Karta operatori: karta navbati
- Valyuta operatori: valyuta navbati
- Mijozlar menejeri: mijoz/account/consulting navbati

Backend ham tekshiradi, shuning uchun UI orqali yashirish bilan cheklanmagan.


## 3D Engine Upgrade

This version supports real GLB/GLTF characters, optional Mixamo-style animation clips, mouse-controlled third-person camera, NPC A* pathfinding, animated doors, and procedural premium building textures. See `ENGINE_UPGRADE_NOTES.md` and the README files inside `public/assets/` for model and animation filenames.

Run with:

```bash
npm install
npm start
```

Open `/game.html`.
