import { z } from 'zod';

const personName = (label: string) => z.string({ error: `${label} girin.` })
  .trim()
  .min(1, `${label} girin.`)
  .max(50, `${label} en fazla 50 karakter olabilir.`)
  .refine(value => !/[\p{Cc}\p{Cf}]/u.test(value), `${label} geçersiz karakter içeriyor.`)
  .transform(value => value.replace(/\s+/gu, ' '));

export const registrationSchema = z.object({
  first_name: personName('Adınızı'),
  last_name: personName('Soyadınızı'),
  email: z.string({ error: 'E-posta adresinizi girin.' }).trim().pipe(z.email({ error: 'Geçerli bir e-posta adresi girin.' }).max(254)).transform(value => value.toLowerCase()),
  password: z.string().min(10, 'En az 10 karakterli bir şifre girin.').max(128, 'Şifre en fazla 128 karakter olabilir.').optional(),
  password_confirmation: z.string().max(128).optional(),
  role: z.enum(['teacher', 'student'], { error: 'Öğrenci veya öğretmen rolünü seçin.' }),
  invite_token: z.string().regex(/^[a-f0-9]{64}$/, 'Davet bağlantısı geçersiz.').optional(),
  demo: z.boolean().optional(),
}).strict().superRefine((input, context) => {
  if (registrationDisplayName(input).length > 100) {
    context.addIssue({ code: 'custom', path: ['last_name'], message: 'Ad ve soyad toplamda en fazla 100 karakter olabilir.' });
  }
  if (!input.demo && !input.password) {
    context.addIssue({ code: 'custom', path: ['password'], message: 'En az 10 karakterli bir şifre girin.' });
  }
  if (input.password !== input.password_confirmation) {
    context.addIssue({ code: 'custom', path: ['password_confirmation'], message: 'Şifreler eşleşmiyor. İki alana aynı şifreyi girin.' });
  }
  if (input.role === 'teacher' && input.invite_token) {
    context.addIssue({ code: 'custom', path: ['invite_token'], message: 'Öğretmen başvurusunda öğrenci daveti kullanılamaz.' });
  }
});

export function registrationDisplayName(input: { first_name: string; last_name: string }) {
  return `${input.first_name} ${input.last_name}`;
}
