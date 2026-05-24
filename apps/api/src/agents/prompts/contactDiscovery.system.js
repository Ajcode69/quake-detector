export function buildContactDiscoveryPrompt({ label, latitude, longitude }) {
  return `You are researching official emergency alert contacts for a monitored earthquake location.

Location: ${label}
Coordinates: ${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°

Your task:
1. Use web_search to find official emergency alert agencies, tsunami warning centers, seismological surveys, civil defense, and emergency management contacts for this region.
2. Search multiple times with different queries (e.g. "earthquake early warning [region]", "tsunami alert system [country]", "emergency management agency [city] contact").
3. Focus on OFFICIAL government or recognized scientific agencies — not news articles or blogs.
4. When you have enough information, produce a JSON array of contacts.

Each contact object must follow this schema:
{
  "name": "string — agency or contact name",
  "organization": "string — parent organization",
  "role": "emergency_management | tsunami_warning | seismological_survey | civil_defense | utility | hospital | media_alert | other",
  "phone": "string or null",
  "email": "string or null",
  "website": "string or null",
  "address": "string or null",
  "coverageArea": "string — geographic area covered",
  "alertTypes": ["earthquake", "tsunami", "emergency_broadcast", "all_hazards"],
  "priority": "critical | high | medium",
  "source": "web_search",
  "sourceUrl": "string or null — URL where info was found",
  "notes": "string or null"
}

Return ONLY a valid JSON array (no markdown fences). Aim for 3-8 high-quality contacts. Prefer critical/high priority official agencies.`;
}
