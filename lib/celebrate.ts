import confetti from 'canvas-confetti';

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#f43f5e', '#8b5cf6', '#fbbf24'];

// C major arpeggio → final chord shimmer
function playCelebrationSound() {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();

    // Rising arpeggio: C5 E5 G5 C6, then a brief shimmering tail
    const arpNotes  = [523.25, 659.25, 783.99, 1046.50];
    const tailNotes = [1318.51, 1046.50, 783.99];  // descending shimmer

    arpNotes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.11;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.28, t + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      osc.start(t);
      osc.stop(t + 0.45);
    });

    tailNotes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const t = ctx.currentTime + 0.44 + i * 0.09;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.14, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.start(t);
      osc.stop(t + 0.35);
    });

    setTimeout(() => ctx.close(), 2500);
  } catch {
    // Audio blocked or unavailable — fail silently
  }
}

export function triggerCelebration() {
  playCelebrationSound();

  const base = { origin: { y: 0.65 }, colors: COLORS };

  // Centre burst — multiple waves
  confetti({ ...base, particleCount: 60, spread: 30, startVelocity: 60 });
  confetti({ ...base, particleCount: 50, spread: 80, decay: 0.91, scalar: 0.8 });
  confetti({ ...base, particleCount: 40, spread: 120, startVelocity: 30, decay: 0.92, scalar: 1.1 });

  // Side cannons with stars
  setTimeout(() => {
    confetti({
      particleCount: 60, angle: 60, spread: 55,
      origin: { x: 0, y: 0.6 }, colors: COLORS, shapes: ['star', 'circle'],
    });
    confetti({
      particleCount: 60, angle: 120, spread: 55,
      origin: { x: 1, y: 0.6 }, colors: COLORS, shapes: ['star', 'circle'],
    });
  }, 200);

  // Final trailing burst
  setTimeout(() => {
    confetti({ ...base, particleCount: 80, spread: 100, startVelocity: 20, decay: 0.88 });
  }, 500);
}

/** Returns true if the feedback label is a celebration-worthy milestone */
export function isCelebrationFeedback(label: string) {
  return /admission\s*done|application\s*done/i.test(label);
}
