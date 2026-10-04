# NIGHTFALL v2
Game social-deduction multiplayer browser berbahasa Indonesia, terinspirasi game Mafia/Town of Salem.

## Jalankan lokal
1. Install Node.js 18+
2. Buka terminal di folder project
3. `npm install`
4. `npm start`
5. Buka `http://localhost:3000`

## Deploy online
Cocok untuk Render, Railway, Fly.io, VPS, atau host Node.js lain.
- Build command: `npm install`
- Start command: `npm start`
- Port: otomatis memakai `process.env.PORT`

## Fitur v2
- Create / join room dengan kode 6 karakter
- Seed untuk random role yang reproducible
- 16 role klasik + emoji
- UI dan pesan game Bahasa Indonesia
- Custom jumlah setiap role + tombol Auto
- Host kick di lobby
- Reconnect setelah refresh/disconnect memakai session token lokal
- Day / night timer
- Voting + Mayor reveal (vote x3)
- All Chat, Private Chat, Mafia Chat, Dead Chat
- Jailor memilih tahanan dan mendapatkan Jail Chat privat
- Hunter revenge setelah dieksekusi voting
- Bodyguard counter-attack ketika target yang dijaga diserang
- Doctor protection, Veteran alert, Escort roleblock, Lookout, Inspector, Consigliere, Forger
- Win condition Town / Mafia / Serial Killer
- Mobile-first responsive UI

## Catatan prototype
Room disimpan di RAM server. Jika proses server restart, room aktif hilang. Untuk produksi jangka panjang, langkah berikutnya adalah database/Redis, akun, rate limiting, moderation, HTTPS reverse proxy, dan test gameplay otomatis.
