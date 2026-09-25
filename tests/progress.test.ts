import assert from "node:assert/strict";
import test from "node:test";
import {
  combinedProgress,
  elapsedSeconds,
  taskProgress,
  timeProgress,
  type ProgressTask,
} from "../src/lib/progress";

test("80 dakikalık zor görev / 400 toplam ağırlık yüzde 30 verir", () => {
  const tasks: ProgressTask[] = [
    { planned_minutes: 80, difficulty: "hard", progress: 1 },
    { planned_minutes: 280, difficulty: "easy", progress: 0 },
  ];
  assert.equal(taskProgress(tasks), 30);
});

test("görev yüzde 70 ve süre yüzde 50 ise birleşik ilerleme yüzde 64 olur", () => {
  assert.equal(combinedProgress(70, 50), 64);
});

test("6 saat hedefte 3 saat net çalışma yüzde 50 verir", () => {
  assert.equal(timeProgress(3 * 60 * 60, 6 * 60), 50);
});

test("fazla süre korunur; birleşik ilerleme süre bileşenini yüzde 100 ile sınırlar", () => {
  assert.equal(timeProgress(9 * 60 * 60, 6 * 60), 150);
  assert.ok(Math.abs(combinedProgress(0, 150)! - 30) < 1e-9);
  assert.equal(combinedProgress(100, 150), 100);
});

test("boş görev listesi tanımsızdır", () => {
  assert.equal(taskProgress([]), null);
});

test("toplam ağırlığı sıfır olan plan sahte yüzde 100 üretmez", () => {
  assert.equal(taskProgress([{ planned_minutes: 0, difficulty: "easy", progress: 1 }]), null);
});

test("sıfır süre hedefi tanımsızdır", () => {
  assert.equal(timeProgress(180, 0), null);
});

test("tanımlı hedefte hiç çalışma yapılmamışsa yüzde sıfırdır", () => {
  assert.equal(timeProgress(0, 360), 0);
});

test("görev yokken birleşik ilerleme yalnız süre bileşenini kullanır", () => {
  assert.equal(combinedProgress(null, 50), 50);
  assert.equal(combinedProgress(null, 150), 100);
});

test("süre hedefi yokken birleşik ilerleme yalnız görev bileşenini kullanır", () => {
  assert.equal(combinedProgress(70, null), 70);
});

test("iki bileşen de tanımsızsa puan oluşmaz", () => {
  assert.equal(combinedProgress(null, null), null);
});

test("tanımlı sıfır, eksik bileşen gibi değerlendirilmez", () => {
  assert.equal(combinedProgress(0, null), 0);
  assert.equal(combinedProgress(null, 0), 0);
  assert.equal(combinedProgress(0, 0), 0);
});

test("açık kısmi tamamlanma, görev ağırlığıyla çarpılır", () => {
  assert.equal(taskProgress([
    { planned_minutes: 60, difficulty: "easy", progress: 0.5 },
    { planned_minutes: 40, difficulty: "easy", progress: 0 },
  ]), 30);
});

test("özel görev ağırlığı dakika ve zorluk çarpımının yerine geçer", () => {
  assert.equal(taskProgress([
    { planned_minutes: 80, difficulty: "hard", progress: 1, weight_override: 50 },
    { planned_minutes: 50, difficulty: "easy", progress: 0 },
  ]), 50);
});

test("sıfır özel ağırlık varsayılan ağırlığa dönüşmez", () => {
  assert.equal(taskProgress([
    { planned_minutes: 80, difficulty: "hard", progress: 1, weight_override: 0 },
    { planned_minutes: 50, difficulty: "easy", progress: 0 },
  ]), 0);
});

test("kısmi tamamlanma 0 ile 1 arasında sınırlandırılır", () => {
  assert.equal(taskProgress([{ planned_minutes: 60, difficulty: "medium", progress: 2 }]), 100);
  assert.equal(taskProgress([{ planned_minutes: 60, difficulty: "medium", progress: -1 }]), 0);
});

test("özelleştirilen görev/süre payı deterministik hesaplanır", () => {
  assert.equal(combinedProgress(80, 40, 0.5), 60);
});

test("süre tick sayısından değil kalıcı başlangıç ve birikmiş saniyeden hesaplanır", () => {
  assert.equal(elapsedSeconds("2026-09-24T07:00:00.000Z", 120, Date.parse("2026-09-24T07:01:30.000Z")), 210);
});

test("gelecekteki başlangıç birikmiş süreyi azaltmaz", () => {
  assert.equal(elapsedSeconds("2026-09-24T07:00:10.000Z", 120, Date.parse("2026-09-24T07:00:00.000Z")), 120);
});


test("kullanıcının zorluk katsayıları aynı görevlerin ağırlığını değiştirir", () => {
  const tasks: ProgressTask[] = [
    { planned_minutes: 50, difficulty: "hard", progress: 1 },
    { planned_minutes: 100, difficulty: "easy", progress: 0 },
  ];
  assert.equal(taskProgress(tasks, { easy: 1, medium: 1.25, hard: 2 }), 50);
  assert.ok(Math.abs(taskProgress(tasks)! - (100 * 75 / 175)) < 1e-9);
});

test("alt adımlar ana görev ağırlığını eşit paylaşır ve ek ağırlık üretmez", () => {
  assert.equal(taskProgress([
    {
      planned_minutes: 60,
      difficulty: "easy",
      progress: 1,
      steps: [{ completed: true }, { completed: false }],
    },
    { planned_minutes: 60, difficulty: "easy", progress: 0 },
  ]), 25);
});

test("tamamlanan alt adımlar açık ilerlemenin önüne geçer", () => {
  assert.equal(taskProgress([{
    planned_minutes: 60, difficulty: "easy", progress: 0,
    steps: [{ completed: true }, { completed: true }],
  }]), 100);
});

test("boş alt adım listesi açık kısmi tamamlanmayı kullanır", () => {
  assert.equal(taskProgress([{
    planned_minutes: 60, difficulty: "easy", progress: 0.4, steps: [],
  }]), 40);
});

test("tek tanımlı bileşenin payı sıfırsa birleşik puan tanımsızdır", () => {
  assert.equal(combinedProgress(70, null, 0), null);
  assert.equal(combinedProgress(null, 50, 1), null);
});

test("sıfır payı olan bileşen diğer bileşenin puanını etkilemez", () => {
  assert.equal(combinedProgress(70, 50, 0), 50);
  assert.equal(combinedProgress(70, 50, 1), 70);
});

test("NaN görev ağırlığı veya ilerlemesi puana dönüşmez", () => {
  assert.equal(taskProgress([{ planned_minutes: NaN, difficulty: "easy", progress: 1 }]), null);
  assert.equal(taskProgress([{ planned_minutes: 60, difficulty: "easy", progress: NaN }]), null);
  assert.equal(taskProgress([{ planned_minutes: 60, difficulty: "easy", progress: 1, weight_override: Infinity }]), null);
  assert.equal(taskProgress([{ planned_minutes: 60, difficulty: "hard", progress: 1 }], { easy: 1, medium: 1.25, hard: NaN }), null);
});

test("negatif görev ağırlığı geçersiz plan olarak ele alınır", () => {
  assert.equal(taskProgress([{ planned_minutes: -1, difficulty: "easy", progress: 1 }]), null);
  assert.equal(taskProgress([{ planned_minutes: 60, difficulty: "easy", progress: 1, weight_override: -1 }]), null);
});

test("NaN ve sonsuz süre girdileri tanımsızdır", () => {
  assert.equal(timeProgress(NaN, 360), null);
  assert.equal(timeProgress(180, NaN), null);
  assert.equal(timeProgress(Infinity, 360), null);
  assert.equal(timeProgress(180, Infinity), null);
});

test("geçersiz birleşik bileşen dışlanır, kullanılabilir pay yoksa puan oluşmaz", () => {
  assert.equal(combinedProgress(NaN, null), null);
  assert.equal(combinedProgress(null, NaN), null);
  assert.equal(combinedProgress(NaN, Infinity), null);
  assert.equal(combinedProgress(NaN, 50), 50);
  assert.equal(combinedProgress(70, Infinity), 70);
});

test("geçersiz birleşik oran puan üretmez", () => {
  assert.equal(combinedProgress(70, 50, NaN), null);
  assert.equal(combinedProgress(70, 50, -0.1), null);
  assert.equal(combinedProgress(70, 50, 1.1), null);
});

