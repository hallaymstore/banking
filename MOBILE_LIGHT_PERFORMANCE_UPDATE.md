# Mobile Light Performance Update

Ushbu build mobil qurilmalarda tezroq va boshqarilishi osonroq ishlashi uchun optimallashtirildi.

## Tuzatishlar

- MOVE joystick endi viewport camera-drag eventiga aralashmaydi.
- Mobil tugmalar va joystick `stopPropagation()` bilan kamera boshqaruvini buzmaydi.
- Mobil harakat tezligi oshirildi va joystick response curve kuchaytirildi.
- LOOK joystick sezgirligi oshirildi.
- Portrait rejimdagi majburiy rotate overlay o‘chirildi, boshqaruv elementlari to‘liq ko‘rinadi.

## Performance optimizatsiya

- Mobil qurilmalarda WebGL pixel ratio 1.0 ga tushirildi.
- Mobil qurilmalarda antialias va shadow map o‘chirildi.
- Ortiqcha ultra-premium dekor, qo‘shimcha GLB load urinishlari, ko‘p plant/lamp/car obyektlari mobil rejimda yuklanmaydi.
- Minimap va nearby UI har kadrda emas, interval bilan yangilanadi.
- Render loop mobil qurilmada 42 FPS target bilan throttling qilinadi.
- API polling mobil qurilmada yengillashtirildi.

## Majburiy lite rejim

Desktopda ham yengil rejimni majburlash uchun URL oxiriga qo‘shing:

```text
/game.html?lite
```

Yoki browser console’da:

```js
localStorage.setItem('vbMobileLite', '1')
location.reload()
```
