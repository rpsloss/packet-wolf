# PACKET WOLF

One-screen arcade. You are the wolf at the firewall.

**ALLOW** green lock packets. **DROP** everything else. Timing in the center of the window is a Perfect.

## Play

**Live:** https://rpsloss.github.io/packet-wolf/

Or locally:

```bash
python3 -m http.server 8765
```

Open http://localhost:8765

| Key | Action |
|---|---|
| W / S or ↑ / ↓ | Change lane |
| 1–4 | Jump to a lane |
| F / E / Shift | Allow (stamp) |
| Space / J | Drop (claw) |
| Left click | Drop on that lane |
| Right click | Allow on that lane |
| Esc | Pause |
| M | Mute |

On-screen ALLOW / DROP buttons work too.

## Scoring

- Stamp a green lock in the window: 80 × combo (1.5× if Perfect)
- Drop a threat in the window: 100–160 × combo (1.5× if Perfect)
- Let a green lock reach the wall unstamped: +15
- Drop a green lock: false positive, combo reset
- Stamp a threat, or let a threat hit the wall: −1 integrity, combo reset
- Clean wave (no breaches): bonus
- 5 integrity. Zero is a breach cascade.

First three packets are a short tutorial. Combo 8 starts **Overclock** (2× score, packets slightly slower, gold aura). Every third wave is a burst. Last pip of integrity is a heartbeat. Top 5 runs stay on this machine.

Ranks: Intern → Analyst → Threat Hunter → CISO → Ghost Wolf.
