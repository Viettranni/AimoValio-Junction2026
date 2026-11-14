import { resetAndSeed } from '../src/db/seed';

const counts = resetAndSeed();
console.log('Seeded demo database:', counts);
