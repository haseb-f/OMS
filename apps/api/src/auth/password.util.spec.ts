import {
  generateTemporaryPassword,
  hashPassword,
  normalizeEmail,
  normalizeUsername,
  verifyPassword,
} from './password.util';

describe('password.util', () => {
  it('normalizes emails by trimming and lowercasing', () => {
    expect(normalizeEmail('  Admin@Example.COM ')).toBe('admin@example.com');
  });

  it('trims usernames without changing case', () => {
    expect(normalizeUsername('  AdminUser  ')).toBe('AdminUser');
  });

  it('hashes a password with bcrypt and verifies the same plaintext', async () => {
    const plain = 'Secret123!';
    const hash = await hashPassword(plain);
    expect(hash).not.toBe(plain);
    expect(hash.startsWith('$2')).toBe(true);
    expect(await verifyPassword(plain, hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('generates unique temporary passwords that hash and verify', async () => {
    const first = generateTemporaryPassword();
    const second = generateTemporaryPassword();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(first).toMatch(/[A-Z]/);
    expect(first).toMatch(/[a-z]/);
    expect(first).toMatch(/[0-9]/);
    expect(first).toMatch(/[!@#$%]/);
    const hash = await hashPassword(first);
    expect(hash).not.toBe(first);
    expect(await verifyPassword(first, hash)).toBe(true);
  });
});
