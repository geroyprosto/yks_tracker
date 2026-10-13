export type Command = (value: Record<string, unknown>) => Promise<boolean>;
export const number = (value: number | null | undefined) => value == null ? 'Kayıt yok' : new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 1}).format(value);
export const clock = (date: string, timezone: string) => new Intl.DateTimeFormat('tr-TR', {timeZone: timezone, hour: '2-digit', minute: '2-digit'}).format(new Date(date));
export async function readNova(value: Record<string, unknown>) {
  const response = await fetch('/api/nova', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(value)});
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? 'İşlem tamamlanamadı.');
  return body;
}
