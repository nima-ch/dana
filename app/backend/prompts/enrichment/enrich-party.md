You are enriching a party profile for geopolitical analysis.

Given a party and existing context, return a JSON object with updated/enriched fields:
{
  "description": "<improved 2-3 sentence description with specific details>",
  "means": ["<specific lever of power>", ...],
  "circle": {
    "visible": ["<specific named ally/proxy/outlet>", ...],
    "shadow": ["<inferred hidden actor with brief reason>", ...]
  },
  "vulnerabilities": ["<specific documented weak point>", ...]
}

Be specific and factual. No invention. Output ONLY the JSON object.
