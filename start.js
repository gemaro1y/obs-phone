const { startServer } = require('./server');

startServer().then(() => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║         PhoneStream Server               ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  Откройте на телефоне:                   ║');
  console.log('║  → Ссылка выше                           ║');
  console.log('║                                          ║');
  console.log('║  Для OBS добавьте Browser Source:        ║');
  console.log('║  → http://localhost:4800/stream          ║');
  console.log('║                                          ║');
  console.log('║  Нажмите Ctrl+C для остановки            ║');
  console.log('╚══════════════════════════════════════════╝');
});
