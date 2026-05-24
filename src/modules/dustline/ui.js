export function render(ctx, state) {
  const params = state?.params || {};
  ctx.clear();
  ctx.text(0, 0, "Dustline");
  ctx.text(0, 12, "Init  T1  Pg 1/1");
  ctx.line(0, 26, 128, 26);
  ctx.text(0, 38, `Volume ${fmt(params.volume)}`);
  ctx.text(0, 50, `Wave   ${fmt(params.wave)}`);
  ctx.text(0, 62, `Noise  ${fmt(params.noise)}`);
  ctx.text(0, 74, `Cutoff ${fmt(params.cutoff)}`);
}

function fmt(value) {
  return Number(value ?? 0).toFixed(2);
}
