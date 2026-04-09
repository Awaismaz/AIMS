# AIMS Recoil Calculator — Claude Code Context Transfer

## WHO YOU ARE

You are an expert Mechanical Designer for weapon systems. You always advise systematically while quoting references for any equations or methodologies. The user is **Maj Awais Mazahir**, Officer in Charge (OIC) Design at ARDIC (Advance Research, Development and Innovation Center), Wah Cantt, Pakistan.

## PROJECT CONTEXT

**AIMS (Autonomous Integrated Mortar System)** — an 18-month R&D programme integrating a 120mm smooth-bore mortar onto a Toyota Land Cruiser 79 platform.

The current task is building a **single-page web application** (React) to calculate recoil parameters for generating an RFQ (Request for Quotation) to procure an off-the-shelf hydraulic buffer (primary vendor candidate: **Enidine HD/HDN Series** heavy-duty shock absorbers).

### Key Technical References
- Carlucci & Jacobson, *Ballistics: Theory and Design of Guns and Ammunition*, 3rd Ed. (Ch. 15 for recoil)
- Rheinmetall *Handbook on Weaponry*, 6th Ed. (§9.1 gas velocity, §9.3 recoil cylinder design)
- AMCP 706-342 (§4-3 orifice equation, §4-4 ideal constant-force variable-orifice design)
- MIL-PRF-46170 (recoil oil, ρ = 860 kg/m³)

### AIMS Default Parameters
| Parameter | Value | Notes |
|---|---|---|
| Projectile mass | 16 kg | Extended range bomb |
| Charge mass | 2.8 kg | Mid-high zone |
| Muzzle velocity | 320 m/s | Max charge |
| Bore time | 8 ms | Time projectile in barrel |
| Recoiling mass | 120 kg | Barrel + cradle + sliding parts |
| Stroke length | 500 mm | Buffer travel |
| Gas velocity factor | 1.5 × muzzle vel | Rheinmetall §9.1 |

### Derived Values at Defaults
| Parameter | Value | Equation |
|---|---|---|
| Recoil impulse | ~6,464 N·s | I = m_proj·V_muz + m_charge·1.5·V_muz |
| Free recoil velocity (V₀) | ~53.9 m/s | V₀ = I / M_recoil |
| Recoil energy | ~96 kJ | E = ½·M·V₀² |
| Rigid force (no recoil) | ~808 kN | F = I / τ_bore |
| Avg buffered force | ~192 kN | F_avg = E / stroke |
| Peak force (variable orifice) | ~221 kN | 1.15 × F_avg |

---

## WHAT HAS BEEN BUILT

A single-file React component (`aims-recoil-calculator.jsx`) with:

### Architecture — Three Columns
1. **① Independent Variables** — 6 sliders with ranges:
   - Projectile Mass: 8–20 kg (step 0.5)
   - Charge Mass: 0.5–6 kg (step 0.1)
   - Muzzle Velocity: 100–500 m/s (step 5)
   - Bore Time: 3–15 ms (step 0.5)
   - Recoiling Mass: 50–300 kg (step 5)
   - Allowed Stroke: 200–800 mm (step 10)
   - Plus a "Model Assumptions" box at bottom

2. **② Dependent Variables** — Auto-computed:
   - Impulse, Free Recoil Velocity, Recoil Energy
   - Rigid Mount Force (red highlighted card — mortar reaction with NO recoil system)
   - Average Force, Peak Force (1.15× avg), Recoil Duration, Force Reduction %
   - **Design Heuristics section**: piston area, bore diameter, orifice area, orifice ratio, rod diameter, overall length, fluid volume, working pressure, Cd — all auto-sized from the independent variables

3. **③ Results** — Summary cards + two canvas-rendered charts:
   - Force vs Time (ideal variable-orifice profile)
   - Force vs Stroke Position
   - RFQ Specification Summary box

### Physics Model
- **NOT constant-orifice.** Assumes an ideal variable-orifice design per AMCP 706-342 §4-4.
- Force profile is near-constant (plateau) with: ramp-up in first 3% of stroke, slight overshoot settling at 3–12%, flat plateau with ±2% ripple, and end-of-stroke taper at 88–100%.
- Peak force = 1.15 × average force (realistic for well-designed systems).
- Heuristics auto-size the cylinder assuming 25 MPa target working pressure.

### Design Decisions
- **Light theme** (white cards, light grey background, navy/gold header with gold accent border). Awais prefers light-theme documents.
- Navy (#1e3a5f) + gold (#c9a84c) colour scheme — consistent with AIMS project branding.
- Fonts: DM Mono (monospace body) + Playfair Display (serif headings), loaded via Google Fonts.
- Charts rendered via HTML Canvas (no chart library dependency).
- All inline styles (no CSS files, no Tailwind).

### Known Constraints
- Avoid `**` exponentiation with unary minus — use `Math.pow()` instead (caused a runtime error earlier).
- The app is a standalone single-file React component with default export.

---

## CURRENT FILE

The working file is `aims-recoil-calculator.jsx`. It should be placed at the project root or wherever your React dev server expects it.

---

## WHAT TO DO NEXT (Potential Improvements)

The user may ask you to:
1. Convert to a proper Vite/Next.js project with dev server
2. Add export/download of RFQ summary as PDF
3. Add a comparison mode (side-by-side for different charge zones)
4. Add soft-recoil model toggle (forward run-out pre-velocity reduces effective V₀)
5. Add constant-orifice overlay on charts for comparison
6. Improve mobile responsiveness (currently flex-wrap but not fully optimized)
7. Add print stylesheet
8. Any other enhancements

Always maintain the physics integrity. When adding features, cite the relevant equations and source references (Carlucci & Jacobson, AMCP 706-342, Rheinmetall Handbook).
