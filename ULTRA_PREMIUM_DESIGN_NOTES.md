# Ultra Premium Design Upgrade

Bu versiyada `public/game.html` sahna dizayni jiddiy qayta ishlangan:

- Sofroq premium HUD va panel dizayni: ortiqcha vizual shovqin kamaytirildi.
- Three.js renderer sozlamalari yaxshilandi: ACES tone mapping, yumshoqroq fog, kuchliroq lekin tabiiyroq yoritish.
- Bank ichki muhiti realroq qilindi:
  - marble lobby floor va brass inlay chiziqlar;
  - wall paneling va sertifikatlar;
  - jonli navbat LED board;
  - queue rope/stanchion tizimi;
  - teller glass partitions;
  - vault/safe door;
  - premium columns, lobby plants, reception va xizmat zonalari.
- Personaj fallback ko‘rinishi boyitildi:
  - ID badge, lapel pin, jacket buttons, belt, pocket detail;
  - yuzga yumshoq cheek detail;
  - GLB asset topilsa avtomatik GLB model ishlaydi, topilmasa procedural premium fallback ishlaydi.
- Mavjud funksiyalar saqlandi:
  - RBAC;
  - multiplayer state polling;
  - voice chat;
  - queue/ticket workflow;
  - WASD/QE movement va pointer-lock mouse look.

Real AAA darajadagi odam modeli uchun `public/assets/models/characters/*.glb` va `public/assets/animations/*.glb` ichiga litsenziyali GLB/Mixamo assetlar qo‘yish kerak. Engine bunga tayyor.
