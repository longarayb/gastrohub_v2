import { seedRefusal } from './seed-guard.js';

describe('seedRefusal', () => {
  it('lets the seed run on a local database in development', () => {
    expect(seedRefusal('development', 'postgresql://app:x@localhost:5433/app_db')).toBeNull();
    expect(seedRefusal(undefined, 'postgresql://app:x@127.0.0.1:5432/app_db')).toBeNull();
    expect(seedRefusal('development', 'postgresql://app:x@postgres:5432/app_db')).toBeNull();
  });

  it('refuses production and remote databases', () => {
    expect(seedRefusal('production', 'postgresql://app:x@localhost/app_db')).toMatch(/demo-reset/);
    expect(seedRefusal('development', 'postgresql://app:x@172.30.0.1:5432/app_db')).toMatch(
      /172\.30\.0\.1/,
    );
    expect(seedRefusal('development', 'postgresql://app:x@db.example.com/app_db')).toMatch(
      /banco local/,
    );
    expect(seedRefusal('development', 'não é url')).toMatch(/inválido/);
  });
});
