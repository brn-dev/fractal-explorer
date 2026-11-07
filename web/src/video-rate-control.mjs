// Moderate constant quality may fall back to an explicit, moderate VBR target.
// Maximum remains strict in the browser: no hidden bitrate substitution.
export async function selectVideoRateControl(options, supports) {
  const dynamic = options.quantizer > 0 && Number.isFinite(options.bitrate);
  const choices = dynamic ? [
    { quantizer: options.quantizer, bitrate: null, qualityMode: 'dynamic-quantizer' },
    { quantizer: null, bitrate: options.bitrate, qualityMode: 'dynamic-vbr' },
  ] : [{ quantizer: options.quantizer ?? null, bitrate: options.bitrate,
    qualityMode: options.quantizer == null ? 'vbr' : options.quantizer === 0 ? 'maximum-quantizer' : 'dynamic-quantizer' }];
  for (const choice of choices) if (await supports(choice)) return { supported: true, ...choice };
  return { supported: false };
}

export function videoRateDescription(info) {
  if (['maximum-cq', 'maximum-quantizer'].includes(info.qualityMode)) return 'maximum quality · dynamic bitrate';
  if (info.qualityMode === 'dynamic-cq') return 'constant quality · dynamic bitrate (device scale)';
  if (info.qualityMode === 'dynamic-quantizer') return `constant quality · dynamic bitrate (QP ${info.quantizer})`;
  if (info.qualityMode === 'maximum-vbr') return `maximum variable bitrate · up to ${(info.bitrate / 1e6).toFixed(1)} Mbps`;
  return `variable bitrate · target ${(info.bitrate / 1e6).toFixed(1)} Mbps${info.qualityMode === 'dynamic-vbr' ? ' (quality-mode fallback)' : ''}`;
}
