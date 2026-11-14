import { getAvailability, getPrices, ping } from '../src/valio/client';

async function main() {
  const date = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  console.log('ping:', await ping());
  console.log('price:', (await getPrices(['460000'], date)).get('460000'));
  console.log('availability:', (await getAvailability(['460000'], date)).get('460000'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
