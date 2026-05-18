/**
 * Helper to clamp a value between min and max
 */
function clamp(val, min, max) {
  if (val == null || isNaN(val)) return 0;
  return Math.max(min, Math.min(max, val));
}

/**
 * Calculate the confidence score of an earthquake event.
 * Represents: How much do I trust this event record?
 */
export function calculateConfidenceScore(properties) {
  const { status, nst, rms, gap, dmin } = properties;

  const status_score = status === "reviewed" ? 1 : status === "automatic" ? 0.6 : 0;
  const station_score = clamp((nst || 0) / 20, 0, 1);
  const rms_score = 1 - clamp((rms || 0) / 0.5, 0, 1);
  const gap_score = 1 - clamp((gap || 0) / 180, 0, 1);
  const dmin_score = 1 - clamp((dmin || 0) / 5, 0, 1);

  const score = 100 * (
    0.35 * status_score +
    0.20 * station_score +
    0.20 * rms_score +
    0.15 * gap_score +
    0.10 * dmin_score
  );

  return Math.round(score);
}

/**
 * Calculate the impact score of an earthquake event.
 * Represents: How much operational attention should this quake get?
 */
export function calculateImpactScore(properties, depth) {
  const { tsunami, alert, mag, felt, cdi, mmi, sig } = properties;

  let hard_override = 0;
  if (tsunami === 1) hard_override = 50;
  else if (alert === "red") hard_override = 40;
  else if (alert === "orange") hard_override = 30;

  const mag_score = clamp(((mag || 0) - 2.5) / 3.5, 0, 1);
  const depth_score = 1 - clamp((depth || 0) / 300, 0, 1);
  
  const felt_val = felt || 0;
  const felt_score = clamp(Math.log10(felt_val + 1) / 3, 0, 1);
  
  const cdi_score = cdi != null ? clamp((cdi - 1) / 9, 0, 1) : 0;
  const mmi_score = mmi != null ? clamp((mmi - 1) / 11, 0, 1) : 0;
  const sig_score = clamp((sig || 0) / 1000, 0, 1);

  const base_impact = 
    25 * mag_score +
    15 * depth_score +
    15 * felt_score +
    10 * cdi_score +
    10 * mmi_score +
    25 * sig_score;

  const score = Math.min(100, hard_override + base_impact);
  return Math.round(score);
}

/**
 * Determine the event class of an earthquake event.
 * Represents: What kind of operational situation is this?
 */
export function determineEventClass(properties, impactScore, confidenceScore) {
  const { tsunami, status, mmi, cdi, felt } = properties;

  if (tsunami === 1) return "tsunami_risk";
  if (status === "automatic" && confidenceScore < 40) return "data_unverified";
  if (impactScore >= 75) return "major_quake";
  if ((mmi != null && mmi >= 7) || (cdi != null && cdi >= 7)) return "strong_shaking";
  if ((felt != null && felt > 0) || (cdi != null && cdi >= 3)) return "felt_quake";
  return "routine_quake";
}

/**
 * Calculates all three scores for an event.
 */
export function calculateAllScores(properties, depth) {
  const confidenceScore = calculateConfidenceScore(properties);
  const impactScore = calculateImpactScore(properties, depth);
  const eventClass = determineEventClass(properties, impactScore, confidenceScore);

  return { confidenceScore, impactScore, eventClass };
}
