import { useState, useMemo, useRef, useEffect } from "react";

// ─── Physics Engine ───────────────────────────────────────────────
function computeRecoil(params) {
  const { projMass, chargeMass, muzzleVel, boreTime, recoilMass, strokeLength } = params;

  const gasVelFactor = 1.5;
  const impulse = projMass * muzzleVel + chargeMass * (gasVelFactor * muzzleVel);
  const V0 = impulse / recoilMass;
  const recoilEnergy = 0.5 * recoilMass * V0 * V0;

  // Rigid case (no recoil system)
  const rigidForce = impulse / boreTime;

  // Variable-orifice ideal design: avg force from work-energy theorem
  const avgForce = recoilEnergy / strokeLength;

  // Well-designed variable orifice: peak ≈ 1.12–1.18× avg (AMCP 706-342 §4-4)
  const peakToAvg = 1.15;
  const peakForce = avgForce * peakToAvg;

  // Recoil duration: approximate from avg deceleration
  // v = V0, a_avg = F_avg/M, t = V0/a_avg
  const recoilTime = (recoilMass * V0) / avgForce;

  // Force reduction vs rigid
  const forceReduction = ((rigidForce - peakForce) / rigidForce) * 100;

  // ── Generate ideal variable-orifice force profiles ──
  // Model: near-constant force with slight ramp-up and taper
  // F(t) profile shaped as: quick rise → plateau at avgForce → slight taper at end
  const dt = 0.0001;
  const steps = Math.ceil(recoilTime / dt) + 1;

  const timeData = [];
  const posData = [];
  let v = V0;
  let x = 0;

  for (let i = 0; i <= steps; i++) {
    const t = i * dt;
    if (v <= 0 || x >= strokeLength) break;

    const progress = x / strokeLength; // 0 → 1

    // Shaped profile: slight overshoot at start, plateau, taper at end
    // Mimics real variable-orifice behavior (Rheinmetall Handbook §9.3)
    let Fshape;
    if (progress < 0.03) {
      // Initial ramp-up (first 3% of stroke)
      Fshape = avgForce * (0.5 + 0.65 * (progress / 0.03));
    } else if (progress < 0.12) {
      // Slight overshoot settling to plateau
      const overshoot = 1 + 0.15 * Math.exp(-Math.pow((progress - 0.06) / 0.03, 2));
      Fshape = avgForce * overshoot;
    } else if (progress > 0.88) {
      // End taper — buffer stop region
      const taper = 1 + 0.18 * ((progress - 0.88) / 0.12);
      Fshape = avgForce * taper;
    } else {
      // Plateau region — near constant with slight ripple
      Fshape = avgForce * (1.0 + 0.02 * Math.sin(progress * Math.PI * 6));
    }

    timeData.push({ t: t * 1000, F: Fshape / 1000 });
    posData.push({ x: x * 1000, F: Fshape / 1000 });

    const a = Fshape / recoilMass;
    v = v - a * dt;
    x = x + v * dt;
    if (v < 0) v = 0;
  }

  // ── Heuristics for cylinder design ──
  // Piston area: sized so hydraulic pressure stays in practical range (10–40 MPa)
  // F = P × A_p → A_p = F / P_target
  const targetPressure = 25e6; // 25 MPa — mid-range for recoil cylinders
  const idealPistonArea = avgForce / targetPressure; // m²
  const idealPistonAreaCm2 = idealPistonArea * 1e4;
  const idealBoreDia = Math.sqrt(4 * idealPistonArea / Math.PI) * 1000; // mm

  // Orifice area at max velocity (start of stroke): A_o = A_p × V0 × sqrt(rho / (2 × Cd² × F))
  const rho = 860; // MIL-PRF-46170
  const Cd = 0.70; // sharp-edged orifice (AMCP 706-342 §4-3)
  const idealOrificeArea = idealPistonArea * V0 * Math.sqrt(rho / (2 * Cd * Cd * avgForce));
  const idealOrificeAreaCm2 = idealOrificeArea * 1e4;
  const orificeRatio = idealOrificeArea / idealPistonArea;

  // Rod diameter: ~0.5–0.7 × bore for through-rod designs (Rheinmetall §9.3)
  const idealRodDia = idealBoreDia * 0.55;

  // Overall length: stroke + 1.8× stroke for seals, accumulator, mounts
  const overallLength = strokeLength * 2.5;

  // Fluid volume displaced
  const fluidVolume = idealPistonArea * strokeLength * 1e6; // cm³

  // Working pressure range
  const minPressure = (avgForce * 0.85) / idealPistonArea / 1e6;
  const maxPressure = peakForce / idealPistonArea / 1e6;

  return {
    impulse, V0, recoilEnergy, avgForce, rigidForce,
    peakForce, recoilTime, forceReduction,
    timeData, posData, peakToAvg,
    heuristics: {
      pistonAreaCm2: idealPistonAreaCm2,
      boreDiaMm: idealBoreDia,
      orificeAreaCm2: idealOrificeAreaCm2,
      orificeRatio,
      rodDiaMm: idealRodDia,
      overallLengthMm: overallLength * 1000,
      fluidVolumeCm3: fluidVolume,
      minPressureMPa: minPressure,
      maxPressureMPa: maxPressure,
      Cd
    }
  };
}

// ─── Chart (Canvas) ───────────────────────────────────────────────
function Chart({ data, xKey, yKey, xLabel, yLabel, color, highlightY, highlightLabel, highlightY2, highlightLabel2 }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || data.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const pad = { top: 20, right: 20, bottom: 44, left: 62 };
    const pw = W - pad.left - pad.right;
    const ph = H - pad.top - pad.bottom;

    const xs = data.map(d => d[xKey]);
    const ys = data.map(d => d[yKey]);
    const xMin = 0;
    const xMax = Math.max(...xs) * 1.05 || 1;
    const maxHighlight = Math.max(highlightY || 0, highlightY2 || 0) / 1000;
    const yMin = 0;
    const yMax = Math.max(...ys, maxHighlight) * 1.15 || 1;

    const sx = v => pad.left + ((v - xMin) / (xMax - xMin)) * pw;
    const sy = v => pad.top + ph - ((v - yMin) / (yMax - yMin)) * ph;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "#e2e5ea";
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.left, pad.top, pw, ph);

    ctx.strokeStyle = "#f0f1f4";
    ctx.lineWidth = 1;
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const val = yMin + (yMax - yMin) * i / yTicks;
      const y = sy(val);
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.fillStyle = "#8892a4";
      ctx.font = "11px 'DM Mono', monospace";
      ctx.textAlign = "right";
      ctx.fillText(val.toFixed(0), pad.left - 8, y + 4);
    }
    const xTicks = 5;
    for (let i = 0; i <= xTicks; i++) {
      const val = xMin + (xMax - xMin) * i / xTicks;
      const x = sx(val);
      ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + ph); ctx.stroke();
      ctx.fillStyle = "#8892a4";
      ctx.font = "11px 'DM Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText(val.toFixed(1), x, H - pad.bottom + 16);
    }

    // Highlight lines
    const drawHighlight = (val, label, clr, side) => {
      if (!val) return;
      const hy = sy(val / 1000);
      ctx.strokeStyle = clr;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(pad.left, hy); ctx.lineTo(W - pad.right, hy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = clr;
      ctx.font = "bold 10px 'DM Mono', monospace";
      ctx.textAlign = side === "right" ? "right" : "left";
      const xPos = side === "right" ? W - pad.right - 4 : pad.left + 4;
      ctx.fillText(label || "", xPos, hy - 6);
    };
    drawHighlight(highlightY, highlightLabel, "#15803d", "left");
    drawHighlight(highlightY2, highlightLabel2, "#dc2626", "right");

    // Data line
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    data.forEach((d, i) => {
      const px = sx(d[xKey]);
      const py = sy(d[yKey]);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // Area fill
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(sx(data[0][xKey]), sy(0));
    data.forEach(d => ctx.lineTo(sx(d[xKey]), sy(d[yKey])));
    ctx.lineTo(sx(data[data.length - 1][xKey]), sy(0));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // Axis labels
    ctx.fillStyle = "#5a6478";
    ctx.font = "bold 11px 'DM Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(xLabel, pad.left + pw / 2, H - 4);
    ctx.save();
    ctx.translate(14, pad.top + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();

  }, [data, xKey, yKey, xLabel, yLabel, color, highlightY, highlightLabel, highlightY2, highlightLabel2]);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "220px", borderRadius: "8px", overflow: "hidden", border: "1px solid #e2e5ea" }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

// ─── Slider ───────────────────────────────────────────────────────
function ParamSlider({ label, unit, value, min, max, step, onChange, description }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ marginBottom: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "2px" }}>
        <span style={{ color: "#2d3748", fontSize: "12px", fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>{label}</span>
        <span style={{ color: "#1e40af", fontSize: "14px", fontFamily: "'DM Mono', monospace", fontWeight: 700 }}>{typeof step === "number" && step < 1 ? value.toFixed(1) : value.toFixed(step >= 1 ? 0 : 1)} <span style={{ color: "#8892a4", fontSize: "10px", fontWeight: 400 }}>{unit}</span></span>
      </div>
      {description && <div style={{ color: "#a0a8b8", fontSize: "10px", fontFamily: "'DM Mono', monospace", marginBottom: "4px" }}>{description}</div>}
      <div style={{ position: "relative", height: "6px", background: "#e8eaef", borderRadius: "3px" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: pct + "%", background: "linear-gradient(90deg, #1e3a5f, #2563eb)", borderRadius: "3px" }} />
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", marginTop: "-4px", opacity: 0, height: "20px", cursor: "pointer", position: "relative", zIndex: 2 }}
      />
    </div>
  );
}

// ─── Result Card ──────────────────────────────────────────────────
function ResultCard({ label, value, unit, accent, small }) {
  return (
    <div style={{
      background: "#f8f9fb", border: "1px solid #e2e5ea", borderRadius: "8px",
      padding: small ? "10px 12px" : "14px 16px", marginBottom: "8px"
    }}>
      <div style={{ color: "#8892a4", fontSize: "10px", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>{label}</div>
      <div style={{ color: accent || "#1a202c", fontSize: small ? "18px" : "22px", fontFamily: "'DM Mono', monospace", fontWeight: 700 }}>
        {value} <span style={{ fontSize: "11px", color: "#a0a8b8", fontWeight: 400 }}>{unit}</span>
      </div>
    </div>
  );
}

// ─── Heuristic Row ────────────────────────────────────────────────
function HeuristicRow({ label, value, unit, ref_text }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "8px 0", borderBottom: "1px solid #f0f1f4" }}>
      <div style={{ flex: 1 }}>
        <span style={{ color: "#4a5568", fontSize: "11px", fontFamily: "'DM Mono', monospace" }}>{label}</span>
        {ref_text && <div style={{ color: "#b0b8c8", fontSize: "9px", fontFamily: "'DM Mono', monospace", marginTop: "1px" }}>{ref_text}</div>}
      </div>
      <span style={{ color: "#1e3a5f", fontSize: "14px", fontFamily: "'DM Mono', monospace", fontWeight: 700, marginLeft: "12px" }}>
        {value} <span style={{ fontSize: "10px", color: "#8892a4", fontWeight: 400 }}>{unit}</span>
      </span>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────
export default function AIMSRecoilCalculator() {
  const [projMass, setProjMass] = useState(16);
  const [chargeMass, setChargeMass] = useState(2.8);
  const [muzzleVel, setMuzzleVel] = useState(320);
  const [boreTime, setBoreTime] = useState(8);
  const [recoilMass, setRecoilMass] = useState(120);
  const [strokeLength, setStrokeLength] = useState(500);

  const results = useMemo(() => computeRecoil({
    projMass, chargeMass, muzzleVel,
    boreTime: boreTime / 1000,
    recoilMass,
    strokeLength: strokeLength / 1000
  }), [projMass, chargeMass, muzzleVel, boreTime, recoilMass, strokeLength]);

  const h = results.heuristics;

  const colStyle = {
    flex: 1, minWidth: "300px", padding: "24px",
    background: "#ffffff", borderRadius: "12px",
    border: "1px solid #dfe2e8", boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
  };

  const headingStyle = {
    fontFamily: "'Playfair Display', Georgia, serif", fontSize: "13px", fontWeight: 700,
    color: "#1e3a5f", textTransform: "uppercase", letterSpacing: "0.15em",
    borderBottom: "2px solid #c9a84c", paddingBottom: "10px", marginBottom: "20px"
  };

  const depVarStyle = {
    display: "flex", justifyContent: "space-between", alignItems: "baseline",
    padding: "10px 0", borderBottom: "1px solid #f0f1f4"
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f7", color: "#1a202c", fontFamily: "'DM Mono', monospace" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Playfair+Display:wght@700;900&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #1a2e4a 60%, #243b5c 100%)", borderBottom: "3px solid #c9a84c", padding: "28px 32px 20px" }}>
        <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "16px", flexWrap: "wrap" }}>
            <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: "28px", fontWeight: 900, color: "#ffffff", margin: 0 }}>AIMS Recoil Calculator</h1>
            <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "11px", letterSpacing: "0.1em" }}>120MM SMOOTH-BORE MORTAR · VARIABLE-ORIFICE BUFFER SIZING</span>
          </div>
          <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "10px", marginTop: "6px", letterSpacing: "0.05em" }}>
            Ref: Carlucci & Jacobson Ch.15 · AMCP 706-342 §4-4 · Rheinmetall Handbook §9.3 · Assumes ideal variable-orifice design
          </div>
        </div>
      </div>

      {/* Three Columns */}
      <div style={{ maxWidth: "1400px", margin: "24px auto", padding: "0 24px", display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "flex-start" }}>

        {/* ── Column 1: Independent Variables ── */}
        <div style={colStyle}>
          <h2 style={headingStyle}>① Independent Variables</h2>

          <div style={{ color: "#a0a8b8", fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "12px" }}>Ballistic Parameters</div>
          <ParamSlider label="Projectile Mass" unit="kg" value={projMass} min={8} max={20} step={0.5} onChange={setProjMass} description="HE bomb: ~13 kg · Extended range: ~16 kg" />
          <ParamSlider label="Charge Mass" unit="kg" value={chargeMass} min={0.5} max={6} step={0.1} onChange={setChargeMass} description="Zone 0: ~0.5 kg · Zone 4: ~3.5 kg" />
          <ParamSlider label="Muzzle Velocity" unit="m/s" value={muzzleVel} min={100} max={500} step={5} onChange={setMuzzleVel} description="Zone 0: ~150 m/s · Zone 4: ~320 m/s" />
          <ParamSlider label="Bore Time" unit="ms" value={boreTime} min={3} max={15} step={0.5} onChange={setBoreTime} description="Time projectile spends in barrel" />

          <div style={{ color: "#a0a8b8", fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "12px", marginTop: "24px" }}>Recoil System Parameters</div>
          <ParamSlider label="Recoiling Mass" unit="kg" value={recoilMass} min={50} max={300} step={5} onChange={setRecoilMass} description="Barrel + cradle + sliding parts" />
          <ParamSlider label="Allowed Stroke" unit="mm" value={strokeLength} min={200} max={800} step={10} onChange={setStrokeLength} description="Buffer travel length for RFQ" />

          {/* Assumptions box */}
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "8px", padding: "12px 14px", marginTop: "20px" }}>
            <div style={{ color: "#92400e", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px", fontWeight: 600 }}>Model Assumptions</div>
            <div style={{ color: "#78716c", fontSize: "10px", lineHeight: 1.6 }}>
              <div>• Variable-orifice hydraulic brake</div>
              <div>• Near-constant force profile (AMCP 706-342 §4-4)</div>
              <div>• Peak/Avg ratio: 1.15:1 (well-designed system)</div>
              <div>• Gas velocity: 1.5 × muzzle vel (Rheinmetall §9.1)</div>
              <div>• Recoil oil: MIL-PRF-46170 (ρ = 860 kg/m³)</div>
            </div>
          </div>
        </div>

        {/* ── Column 2: Dependent Variables + Heuristics ── */}
        <div style={colStyle}>
          <h2 style={headingStyle}>② Dependent Variables</h2>

          <div style={{ color: "#a0a8b8", fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "12px" }}>Momentum & Energy</div>

          <div style={depVarStyle}>
            <span style={{ color: "#4a5568", fontSize: "12px" }}>Recoil Impulse (I<sub>r</sub>)</span>
            <span style={{ color: "#1e40af", fontSize: "15px", fontWeight: 700 }}>{results.impulse.toFixed(0)} <span style={{ fontSize: "10px", color: "#a0a8b8" }}>N·s</span></span>
          </div>
          <div style={depVarStyle}>
            <span style={{ color: "#4a5568", fontSize: "12px" }}>Free Recoil Velocity (V₀)</span>
            <span style={{ color: "#1e40af", fontSize: "15px", fontWeight: 700 }}>{results.V0.toFixed(1)} <span style={{ fontSize: "10px", color: "#a0a8b8" }}>m/s</span></span>
          </div>
          <div style={depVarStyle}>
            <span style={{ color: "#4a5568", fontSize: "12px" }}>Recoil Energy (E<sub>r</sub>)</span>
            <span style={{ color: "#b45309", fontSize: "15px", fontWeight: 700 }}>{(results.recoilEnergy / 1000).toFixed(1)} <span style={{ fontSize: "10px", color: "#a0a8b8" }}>kJ</span></span>
          </div>

          {/* Rigid force */}
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "14px 16px", margin: "16px 0" }}>
            <div style={{ color: "#b91c1c", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px", fontWeight: 600 }}>Mortar Reaction Force (Rigid Mount)</div>
            <div style={{ color: "#dc2626", fontSize: "26px", fontWeight: 700 }}>
              {(results.rigidForce / 1000).toFixed(0)} <span style={{ fontSize: "12px", color: "#ef4444" }}>kN</span>
            </div>
            <div style={{ color: "#9ca3af", fontSize: "10px", marginTop: "4px" }}>F = I / τ = {results.impulse.toFixed(0)} / {boreTime.toFixed(1)}ms</div>
          </div>

          {/* Buffered results */}
          <div style={depVarStyle}>
            <span style={{ color: "#4a5568", fontSize: "12px" }}>Average Force (F<sub>avg</sub>)</span>
            <span style={{ color: "#15803d", fontSize: "15px", fontWeight: 700 }}>{(results.avgForce / 1000).toFixed(1)} <span style={{ fontSize: "10px", color: "#a0a8b8" }}>kN</span></span>
          </div>
          <div style={depVarStyle}>
            <span style={{ color: "#4a5568", fontSize: "12px" }}>Peak Force (1.15 × avg)</span>
            <span style={{ color: "#c2410c", fontSize: "15px", fontWeight: 700 }}>{(results.peakForce / 1000).toFixed(1)} <span style={{ fontSize: "10px", color: "#a0a8b8" }}>kN</span></span>
          </div>
          <div style={depVarStyle}>
            <span style={{ color: "#4a5568", fontSize: "12px" }}>Recoil Duration</span>
            <span style={{ color: "#1e40af", fontSize: "15px", fontWeight: 700 }}>{(results.recoilTime * 1000).toFixed(1)} <span style={{ fontSize: "10px", color: "#a0a8b8" }}>ms</span></span>
          </div>

          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "14px 16px", marginTop: "12px" }}>
            <div style={{ color: "#15803d", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px", fontWeight: 600 }}>Force Reduction vs Rigid</div>
            <div style={{ color: "#16a34a", fontSize: "26px", fontWeight: 700 }}>
              {results.forceReduction.toFixed(1)} <span style={{ fontSize: "12px", color: "#22c55e" }}>%</span>
            </div>
            <div style={{ color: "#9ca3af", fontSize: "10px", marginTop: "4px" }}>{(results.rigidForce / 1000).toFixed(0)} kN → {(results.peakForce / 1000).toFixed(1)} kN peak</div>
          </div>

          {/* Heuristics */}
          <div style={{ color: "#a0a8b8", fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "8px", marginTop: "24px" }}>Design Heuristics</div>
          <div style={{ background: "#f8f9fb", border: "1px solid #e2e5ea", borderRadius: "8px", padding: "12px 14px" }}>
            <HeuristicRow label="Piston Area (Ap)" value={h.pistonAreaCm2.toFixed(1)} unit="cm²" ref_text="Sized for ~25 MPa working pressure" />
            <HeuristicRow label="Bore Diameter" value={h.boreDiaMm.toFixed(0)} unit="mm" ref_text="√(4·Ap / π)" />
            <HeuristicRow label="Max Orifice Area (Ao)" value={h.orificeAreaCm2.toFixed(2)} unit="cm²" ref_text="At V₀, start of stroke (AMCP 706-342)" />
            <HeuristicRow label="Orifice Ratio (Ao/Ap)" value={(h.orificeRatio * 100).toFixed(1)} unit="%" ref_text="Varies along stroke for const. force" />
            <HeuristicRow label="Rod Diameter" value={h.rodDiaMm.toFixed(0)} unit="mm" ref_text="~0.55 × bore (Rheinmetall §9.3)" />
            <HeuristicRow label="Est. Overall Length" value={(h.overallLengthMm).toFixed(0)} unit="mm" ref_text="~2.5 × stroke (incl. seals + accumulator)" />
            <HeuristicRow label="Fluid Displaced" value={h.fluidVolumeCm3.toFixed(0)} unit="cm³" ref_text="Ap × stroke" />
            <HeuristicRow label="Working Pressure" value={`${h.minPressureMPa.toFixed(0)}–${h.maxPressureMPa.toFixed(0)}`} unit="MPa" ref_text="Plateau to peak range" />
            <HeuristicRow label="Discharge Coeff (Cd)" value={h.Cd.toFixed(2)} unit="" ref_text="Sharp-edged orifice assumption" />
          </div>
        </div>

        {/* ── Column 3: Results / Charts ── */}
        <div style={colStyle}>
          <h2 style={headingStyle}>③ Results</h2>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "16px" }}>
            <ResultCard label="Recoil Energy" value={(results.recoilEnergy / 1000).toFixed(1)} unit="kJ" accent="#b45309" small />
            <ResultCard label="Peak Force" value={(results.peakForce / 1000).toFixed(1)} unit="kN" accent="#c2410c" small />
            <ResultCard label="Avg Force" value={(results.avgForce / 1000).toFixed(1)} unit="kN" accent="#15803d" small />
            <ResultCard label="Rigid Force" value={(results.rigidForce / 1000).toFixed(0)} unit="kN" accent="#dc2626" small />
          </div>

          <div style={{ color: "#a0a8b8", fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "8px" }}>Force vs Time (Variable Orifice — Ideal)</div>
          {results.timeData.length > 0 && (
            <Chart data={results.timeData} xKey="t" yKey="F"
              xLabel="Time (ms)" yLabel="Force (kN)" color="#1e40af"
              highlightY={results.avgForce} highlightLabel={`Avg: ${(results.avgForce/1000).toFixed(0)} kN`}
            />
          )}

          <div style={{ height: "16px" }} />

          <div style={{ color: "#a0a8b8", fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "8px" }}>Force vs Stroke (Variable Orifice — Ideal)</div>
          {results.posData.length > 0 && (
            <Chart data={results.posData} xKey="x" yKey="F"
              xLabel="Stroke (mm)" yLabel="Force (kN)" color="#c2410c"
              highlightY={results.avgForce} highlightLabel={`Avg: ${(results.avgForce/1000).toFixed(0)} kN`}
            />
          )}

          {/* RFQ Summary */}
          <div style={{ marginTop: "16px", background: "#f0f4ff", border: "1px solid #bfdbfe", borderRadius: "8px", padding: "14px 16px" }}>
            <div style={{ color: "#1e3a5f", fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "10px", fontWeight: 700 }}>RFQ Specification Summary</div>
            <div style={{ fontSize: "11px", color: "#4a5568", lineHeight: 1.8 }}>
              <div>Energy per cycle: <strong style={{ color: "#b45309" }}>{(results.recoilEnergy / 1000).toFixed(1)} kJ</strong></div>
              <div>Required stroke: <strong style={{ color: "#1e40af" }}>{strokeLength} mm</strong></div>
              <div>Peak input velocity: <strong style={{ color: "#1e40af" }}>{results.V0.toFixed(1)} m/s</strong></div>
              <div>Target avg braking force: <strong style={{ color: "#15803d" }}>{(results.avgForce / 1000).toFixed(1)} kN</strong></div>
              <div>Max braking force: <strong style={{ color: "#c2410c" }}>{(results.peakForce / 1000).toFixed(1)} kN</strong></div>
              <div>Recoil impulse: <strong style={{ color: "#1e40af" }}>{results.impulse.toFixed(0)} N·s</strong></div>
              <div>Recoiling mass: <strong style={{ color: "#1e40af" }}>{recoilMass} kg</strong></div>
              <div>Bore: <strong style={{ color: "#1e3a5f" }}>120 mm smooth-bore mortar</strong></div>
              <div>Type: <strong style={{ color: "#1e3a5f" }}>Variable-orifice hydraulic, with return accumulator</strong></div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "1400px", margin: "8px auto 24px", padding: "0 24px", color: "#c0c5d0", fontSize: "9px", letterSpacing: "0.05em" }}>
        AIMS · Autonomous Integrated Mortar System · ARDIC Wah Cantt · Variable-Orifice Model · Carlucci & Jacobson 3rd Ed. · AMCP 706-342
      </div>
    </div>
  );
}
