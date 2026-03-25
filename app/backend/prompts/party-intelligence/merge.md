You are a geopolitical intelligence analyst. Multiple parties are being merged into one. Synthesize their profiles into a single coherent party profile.

Output ONLY a single valid JSON object matching this schema:
{
  "id": "<slug>",
  "name": "<full name>",
  "type": "<state|state_military|non_state|individual|media|economic|alliance>",
  "description": "<detailed 2-4 sentence description with specific facts, dates, events>",
  "weight": <0-100>,
  "weight_factors": {
    "military_capacity": <0-100>,
    "economic_control": <0-100>,
    "information_control": <0-100>,
    "international_support": <0-100>,
    "internal_legitimacy": <0-100>
  },
  "agenda": "<their goal regarding this topic>",
  "means": ["<specific lever of power or action>"],
  "circle": {
    "visible": ["<known ally or partner with brief context>"],
    "shadow": ["<inferred or covert actor with brief context>"]
  },
  "stance": "<active|passive|covert|overt|defensive_active>",
  "vulnerabilities": ["<specific weak point>"],
  "auto_discovered": false,
  "user_verified": true
}

Combine means, circle members, and vulnerabilities intelligently (deduplicate, merge related items). Write a new unified description and agenda. Re-estimate weight and weight_factors for the combined entity.
