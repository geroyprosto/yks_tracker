import test from 'node:test';
import assert from 'node:assert/strict';
import { registrationDisplayName, registrationSchema } from '../src/lib/classroom/registration';
import { POST as register } from '../src/app/api/register/route';

const valid = {
  first_name: 'Sümeyye', last_name: 'Yılmaz', email: 'sumeyye@example.test',
  password: 'OnlyForThisApp!2026', password_confirmation: 'OnlyForThisApp!2026', role: 'student',
};

test('registration preserves Turkish names and normalizes form spacing and email', () => {
  const result = registrationSchema.parse({ ...valid, first_name: '  Sümeyye   Nur  ', last_name: ' Yılmaz ', email: ' Sumeyye@Example.Test ' });
  assert.equal(result.first_name, 'Sümeyye Nur');
  assert.equal(result.last_name, 'Yılmaz');
  assert.equal(registrationDisplayName(result), 'Sümeyye Nur Yılmaz');
  assert.equal(result.email, 'sumeyye@example.test');
});

test('registration requires separate first and last names and rejects unsafe or excessive input', () => {
  for (const fields of [
    { first_name: '' }, { last_name: '   ' }, { first_name: undefined }, { last_name: undefined },
    { first_name: 'A'.repeat(51) }, { last_name: 'B'.repeat(51) },
    { first_name: 'A'.repeat(50), last_name: 'B'.repeat(50) },
    { first_name: 'Sümeyye\u0000Nur' }, { last_name: 'Yılmaz\u202e' },
  ]) assert.equal(registrationSchema.safeParse({ ...valid, ...fields }).success, false);
});

test('registration requires matching passwords without trimming or weakening the password', () => {
  for (const fields of [
    { password: undefined, password_confirmation: undefined },
    { password: 'short', password_confirmation: 'short' },
    { password: 'a'.repeat(129), password_confirmation: 'a'.repeat(129) },
    { password_confirmation: undefined }, { password_confirmation: 'SomethingDifferent!2026' },
  ]) assert.equal(registrationSchema.safeParse({ ...valid, ...fields }).success, false);
  const password = '  DeliberateSpaces  ';
  assert.equal(registrationSchema.parse({ ...valid, password, password_confirmation: password }).password, password);
});

test('registration rejects privileged fields and teacher invitations', () => {
  for (const fields of [
    { role: 'admin' }, { status: 'approved' }, { teacher_id: 'forged' },
    { name: 'Override display name' }, { email: 'not-an-email' },
    { role: 'teacher', invite_token: 'a'.repeat(64) }, { invite_token: 'invalid' },
  ]) assert.equal(registrationSchema.safeParse({ ...valid, ...fields }).success, false);
});

test('demo API registration can omit unused password credentials but still requires both names', () => {
  const demo = { first_name: 'Deniz', last_name: 'Test', email: 'deniz@example.test', role: 'student', demo: true };
  assert.equal(registrationSchema.safeParse(demo).success, true);
  assert.equal(registrationSchema.safeParse({ ...demo, last_name: '' }).success, false);
});

test('registration route rejects missing surnames and mismatched passwords before Auth', async () => {
  const previousOrigin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = 'https://study.example.com';
  try {
    for (const fields of [{ last_name: '' }, { password_confirmation: 'OtherPassword!2026' }]) {
      const response = await register(new Request('https://study.example.com/api/register', {
        method: 'POST', headers: { origin: 'https://study.example.com', 'content-type': 'application/json' },
        body: JSON.stringify({ ...valid, ...fields }),
      }));
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.error.code, 'INVALID_INPUT');
      assert.equal(JSON.stringify(body).includes(valid.password), false);
    }
  } finally {
    if (previousOrigin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previousOrigin;
  }
});
