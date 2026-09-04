import { main } from './static-host/start.mjs';

main({ lan: true }).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
