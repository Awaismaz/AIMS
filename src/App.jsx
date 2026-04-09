import { useState, useMemo, useRef, useEffect } from "react";

// kN to metric ton-force
const kNtoTf = (kN) => (kN / 9.80665).toFixed(1);

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
  const recoilTime = (recoilMass * V0) / avgForce;

  // Force reduction vs rigid
  const forceReduction = ((rigidForce - peakForce) / rigidForce) * 100;

  // ── Generate ideal variable-orifice force profiles ──
  const dt = 0.0001;
  const steps = Math.ceil(recoilTime / dt) + 1;

  const timeData = [];
  const posData = [];
  let v = V0;
  let x = 0;

  for (let i = 0; i <= steps; i++) {
    const t = i * dt;
    if (v <= 0 || x >= strokeLength) break;

    const progress = x / strokeLength;

    let Fshape;
    if (progress < 0.03) {
      Fshape = avgForce * (0.5 + 0.65 * (progress / 0.03));
    } else if (progress < 0.12) {
      const overshoot = 1 + 0.15 * Math.exp(-Math.pow((progress - 0.06) / 0.03, 2));
      Fshape = avgForce * overshoot;
    } else if (progress > 0.88) {
      const taper = 1 + 0.18 * ((progress - 0.88) / 0.12);
      Fshape = avgForce * taper;
    } else {
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
  const targetPressure = 25e6;
  const idealPistonArea = avgForce / targetPressure;
  const idealPistonAreaCm2 = idealPistonArea * 1e4;
  const idealBoreDia = Math.sqrt(4 * idealPistonArea / Math.PI) * 1000;

  const rho = 860;
  const Cd = 0.70;
  const idealOrificeArea = idealPistonArea * V0 * Math.sqrt(rho / (2 * Cd * Cd * avgForce));
  const idealOrificeAreaCm2 = idealOrificeArea * 1e4;
  const orificeRatio = idealOrificeArea / idealPistonArea;

  const idealRodDia = idealBoreDia * 0.55;
  const overallLength = strokeLength * 2.5;
  const fluidVolume = idealPistonArea * strokeLength * 1e6;

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

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'SF Mono', 'Cascadia Code', 'Consolas', 'Liberation Mono', monospace";

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
      ctx.font = "11px " + MONO;
      ctx.textAlign = "right";
      ctx.fillText(val.toFixed(0), pad.left - 8, y + 4);
    }
    const xTicks = 5;
    for (let i = 0; i <= xTicks; i++) {
      const val = xMin + (xMax - xMin) * i / xTicks;
      const x = sx(val);
      ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + ph); ctx.stroke();
      ctx.fillStyle = "#8892a4";
      ctx.font = "11px " + MONO;
      ctx.textAlign = "center";
      ctx.fillText(val.toFixed(1), x, H - pad.bottom + 16);
    }

    const drawHighlight = (val, label, clr, side) => {
      if (!val) return;
      const hy = sy(val / 1000);
      ctx.strokeStyle = clr;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(pad.left, hy); ctx.lineTo(W - pad.right, hy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = clr;
      ctx.font = "bold 10px " + FONT;
      ctx.textAlign = side === "right" ? "right" : "left";
      const xPos = side === "right" ? W - pad.right - 4 : pad.left + 4;
      ctx.fillText(label || "", xPos, hy - 6);
    };
    drawHighlight(highlightY, highlightLabel, "#15803d", "left");
    drawHighlight(highlightY2, highlightLabel2, "#dc2626", "right");

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

    ctx.globalAlpha = 0.08;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(sx(data[0][xKey]), sy(0));
    data.forEach(d => ctx.lineTo(sx(d[xKey]), sy(d[yKey])));
    ctx.lineTo(sx(data[data.length - 1][xKey]), sy(0));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#5a6478";
    ctx.font = "bold 11px " + FONT;
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
        <span style={{ color: "#2d3748", fontSize: "13px", fontFamily: FONT, fontWeight: 600 }}>{label}</span>
        <span style={{ color: "#1e40af", fontSize: "15px", fontFamily: MONO, fontWeight: 700 }}>{typeof step === "number" && step < 1 ? value.toFixed(1) : value.toFixed(step >= 1 ? 0 : 1)} <span style={{ color: "#8892a4", fontSize: "11px", fontWeight: 400 }}>{unit}</span></span>
      </div>
      {description && <div style={{ color: "#a0a8b8", fontSize: "11px", fontFamily: FONT, marginBottom: "4px" }}>{description}</div>}
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
function ResultCard({ label, value, unit, accent, small, tonValue }) {
  return (
    <div style={{
      background: "#f8f9fb", border: "1px solid #e2e5ea", borderRadius: "8px",
      padding: small ? "10px 12px" : "14px 16px", marginBottom: "8px"
    }}>
      <div style={{ color: "#8892a4", fontSize: "11px", fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>{label}</div>
      <div style={{ color: accent || "#1a202c", fontSize: small ? "18px" : "22px", fontFamily: MONO, fontWeight: 700 }}>
        {value} <span style={{ fontSize: "11px", color: "#a0a8b8", fontWeight: 400 }}>{unit}</span>
        {tonValue && <span style={{ fontSize: "12px", color: "#6b7280", fontWeight: 500 }}> ({tonValue} tf)</span>}
      </div>
    </div>
  );
}

// ─── Heuristic Row ────────────────────────────────────────────────
function HeuristicRow({ label, value, unit, ref_text }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "8px 0", borderBottom: "1px solid #f0f1f4" }}>
      <div style={{ flex: 1 }}>
        <span style={{ color: "#4a5568", fontSize: "12px", fontFamily: FONT }}>{label}</span>
        {ref_text && <div style={{ color: "#b0b8c8", fontSize: "10px", fontFamily: FONT, marginTop: "1px" }}>{ref_text}</div>}
      </div>
      <span style={{ color: "#1e3a5f", fontSize: "14px", fontFamily: MONO, fontWeight: 700, marginLeft: "12px" }}>
        {value} <span style={{ fontSize: "11px", color: "#8892a4", fontWeight: 400 }}>{unit}</span>
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
  const [mortarMass, setMortarMass] = useState(280);
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
    fontFamily: FONT, fontSize: "14px", fontWeight: 700,
    color: "#1e3a5f", textTransform: "uppercase", letterSpacing: "0.12em",
    borderBottom: "2px solid #c9a84c", paddingBottom: "10px", marginBottom: "20px"
  };

  const depVarStyle = {
    display: "flex", justifyContent: "space-between", alignItems: "baseline",
    padding: "10px 0", borderBottom: "1px solid #f0f1f4"
  };

  const rigidKN = results.rigidForce / 1000;
  const avgKN = results.avgForce / 1000;
  const peakKN = results.peakForce / 1000;

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f7", color: "#1a202c", fontFamily: FONT }}>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #1a2e4a 60%, #243b5c 100%)", borderBottom: "3px solid #c9a84c", padding: "28px 32px 20px" }}>
        <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "16px", flexWrap: "wrap" }}>
            <h1 style={{ fontFamily: FONT, fontSize: "26px", fontWeight: 800, color: "#ffffff", margin: 0 }}>AIMS Recoil Calculator</h1>
            <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "12px", letterSpacing: "0.1em" }}>120MM SMOOTH-BORE MORTAR · VARIABLE-ORIFICE BUFFER SIZING</span>
          </div>
          <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "11px", marginTop: "6px", letterSpacing: "0.05em" }}>
            Ref: Carlucci & Jacobson Ch.15 · AMCP 706-342 §4-4 · Rheinmetall Handbook §9.3 · Assumes ideal variable-orifice design
          </div>
        </div>
      </div>

      {/* Three Columns */}
      <div style={{ maxWidth: "1400px", margin: "24px auto", padding: "0 24px", display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "flex-start" }}>

        {/* ── Column 1: Independent Variables ── */}
        <div style={colStyle}>
          <h2 style={headingStyle}>① Independent Variables</h2>

          <div style={{ color: "#a0a8b8", fontSize: "10px", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "12px" }}>Ballistic Parameters</div>
          <ParamSlider label="Projectile Mass" unit="kg" value={projMass} min={8} max={20} step={0.5} onChange={setProjMass} description="HE bomb: ~13 kg · Extended range: ~16 kg" />
          <ParamSlider label="Charge Mass" unit="kg" value={chargeMass} min={0.5} max={6} step={0.1} onChange={setChargeMass} description="Zone 0: ~0.5 kg · Zone 4: ~3.5 kg" />
          <ParamSlider label="Muzzle Velocity" unit="m/s" value={muzzleVel} min={100} max={500} step={5} onChange={setMuzzleVel} description="Zone 0: ~150 m/s · Zone 4: ~320 m/s" />
          <ParamSlider label="Bore Time" unit="ms" value={boreTime} min={3} max={15} step={0.5} onChange={setBoreTime} description="Time projectile spends in barrel" />

          <div style={{ color: "#a0a8b8", fontSize: "10px", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "12px", marginTop: "24px" }}>Recoil System Parameters</div>
          <ParamSlider label="Mortar Mass (Complete)" unit="kg" value={mortarMass} min={100} max={600} step={5} onChange={setMortarMass} description="Complete weapon system mass (barrel + mount + baseplate)" />
          <ParamSlider label="Recoiling Mass" unit="kg" value={recoilMass} min={50} max={300} step={5} onChange={setRecoilMass} description="Barrel + cradle + sliding parts only" />
          <ParamSlider label="Allowed Stroke" unit="mm" value={strokeLength} min={200} max={800} step={10} onChange={setStrokeLength} description="Buffer travel length for RFQ" />

          {/* Assumptions box */}
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "8px", padding: "12px 14px", marginTop: "20px" }}>
            <div style={{ color: "#92400e", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px", fontWeight: 600 }}>Model Assumptions</div>
            <div style={{ color: "#78716c", fontSize: "11px", lineHeight: 1.6 }}>
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

          <div style={{ color: "#a0a8b8", fontSize: "10px", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "12px" }}>Momentum & Energy</div>

          <div style={depVarStyle}>
            <span style={{ color: "#4a5568", fontSize: "13px" }}>Recoil Impulse (I<sub>r</sub>)</span>
            <span style={{ color: "#1e40af", fontSize: "15px", fontWeight: 700 }}>{results.impulse.toFixed(0)} <span style={{ fontSize: "11px", color: "#a0a8b8" }}>N·s</span></span>
          </div>
          <div style={depVarStyle}>
            <span style={{ color: "#4a5568", fontSize: "13px" }}>Free Recoil Velocity (V₀)</span>
            <span style={{ color: "#1e40af", fontSize: "15px", fontWeight: 700 }}>{results.V0.toFixed(1)} <span style={{ fontSize: "11px", color: "#a0a8b8" }}>m/s</span></span>
          </div>
          <div style={depVarStyle}>
            <span style={{ color: "#4a5568", fontSize: "13px" }}>Recoil Energy (E<sub>r</sub>)</span>
            <span style={{ color: "#b45309", fontSize: "15px", fontWeight: 700 }}>{(results.recoilEnergy / 1000).toFixed(1)} <span style={{ fontSize: "11px", color: "#a0a8b8" }}>kJ</span></span>
          </div>

          {/* Rigid force */}
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "14px 16px", margin: "16px 0" }}>
            <div style={{ color: "#b91c1c", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px", fontWeight: 600 }}>Mortar Reaction Force (Rigid Mount)</div>
            <div style={{ color: "#dc2626", fontSize: "26px", fontWeight: 700 }}>
              {rigidKN.toFixed(0)} <span style={{ fontSize: "12px", color: "#ef4444" }}>kN</span>
              <span style={{ fontSize: "14px", color: "#b91c1c", fontWeight: 600 }}> ({kNtoTf(rigidKN)} tf)</span>
            </div>
            <div style={{ color: "#9ca3af", fontSize: "11px", marginTop: "4px" }}>F = I / τ = {results.impulse.toFixed(0)} / {boreTime.toFixed(1)}ms</div>
          </div>

          {/* Buffered results */}
          <div style={depVarStyle}>
            <span style={{ color: "#4a5568", fontSize: "13px" }}>Average Force (F<sub>avg</sub>)</span>
            <span style={{ color: "#15803d", fontSize: "15px", fontWeight: 700 }}>{avgKN.toFixed(1)} <span style={{ fontSize: "11px", color: "#a0a8b8" }}>kN</span> <span style={{ fontSize: "12px", color: "#6b7280", fontWeight: 500 }}>({kNtoTf(avgKN)} tf)</span></span>
          </div>
          <div style={depVarStyle}>
            <span style={{ color: "#4a5568", fontSize: "13px" }}>Peak Force (1.15 × avg)</span>
            <span style={{ color: "#c2410c", fontSize: "15px", fontWeight: 700 }}>{peakKN.toFixed(1)} <span style={{ fontSize: "11px", color: "#a0a8b8" }}>kN</span> <span style={{ fontSize: "12px", color: "#6b7280", fontWeight: 500 }}>({kNtoTf(peakKN)} tf)</span></span>
          </div>
          <div style={depVarStyle}>
            <span style={{ color: "#4a5568", fontSize: "13px" }}>Recoil Duration</span>
            <span style={{ color: "#1e40af", fontSize: "15px", fontWeight: 700 }}>{(results.recoilTime * 1000).toFixed(1)} <span style={{ fontSize: "11px", color: "#a0a8b8" }}>ms</span></span>
          </div>

          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "14px 16px", marginTop: "12px" }}>
            <div style={{ color: "#15803d", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px", fontWeight: 600 }}>Force Reduction vs Rigid</div>
            <div style={{ color: "#16a34a", fontSize: "26px", fontWeight: 700 }}>
              {results.forceReduction.toFixed(1)} <span style={{ fontSize: "12px", color: "#22c55e" }}>%</span>
            </div>
            <div style={{ color: "#9ca3af", fontSize: "11px", marginTop: "4px" }}>{rigidKN.toFixed(0)} kN ({kNtoTf(rigidKN)} tf) → {peakKN.toFixed(1)} kN ({kNtoTf(peakKN)} tf) peak</div>
          </div>

          {/* Heuristics */}
          <div style={{ color: "#a0a8b8", fontSize: "10px", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "8px", marginTop: "24px" }}>Design Heuristics</div>
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
            <ResultCard label="Peak Force" value={peakKN.toFixed(1)} unit="kN" accent="#c2410c" small tonValue={kNtoTf(peakKN)} />
            <ResultCard label="Avg Force" value={avgKN.toFixed(1)} unit="kN" accent="#15803d" small tonValue={kNtoTf(avgKN)} />
            <ResultCard label="Rigid Force" value={rigidKN.toFixed(0)} unit="kN" accent="#dc2626" small tonValue={kNtoTf(rigidKN)} />
          </div>

          <div style={{ color: "#a0a8b8", fontSize: "10px", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "8px" }}>Force vs Time (Variable Orifice — Ideal)</div>
          {results.timeData.length > 0 && (
            <Chart data={results.timeData} xKey="t" yKey="F"
              xLabel="Time (ms)" yLabel="Force (kN)" color="#1e40af"
              highlightY={results.avgForce} highlightLabel={`Avg: ${avgKN.toFixed(0)} kN (${kNtoTf(avgKN)} tf)`}
            />
          )}

          <div style={{ height: "16px" }} />

          <div style={{ color: "#a0a8b8", fontSize: "10px", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "8px" }}>Force vs Stroke (Variable Orifice — Ideal)</div>
          {results.posData.length > 0 && (
            <Chart data={results.posData} xKey="x" yKey="F"
              xLabel="Stroke (mm)" yLabel="Force (kN)" color="#c2410c"
              highlightY={results.avgForce} highlightLabel={`Avg: ${avgKN.toFixed(0)} kN (${kNtoTf(avgKN)} tf)`}
            />
          )}

          {/* RFQ Summary */}
          <div style={{ marginTop: "16px", background: "#f0f4ff", border: "1px solid #bfdbfe", borderRadius: "8px", padding: "14px 16px" }}>
            <div style={{ color: "#1e3a5f", fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "10px", fontWeight: 700 }}>RFQ Specification Summary</div>
            <div style={{ fontSize: "12px", color: "#4a5568", lineHeight: 1.8 }}>
              <div>Energy per cycle: <strong style={{ color: "#b45309" }}>{(results.recoilEnergy / 1000).toFixed(1)} kJ</strong></div>
              <div>Required stroke: <strong style={{ color: "#1e40af" }}>{strokeLength} mm</strong></div>
              <div>Peak input velocity: <strong style={{ color: "#1e40af" }}>{results.V0.toFixed(1)} m/s</strong></div>
              <div>Target avg braking force: <strong style={{ color: "#15803d" }}>{avgKN.toFixed(1)} kN ({kNtoTf(avgKN)} tf)</strong></div>
              <div>Max braking force: <strong style={{ color: "#c2410c" }}>{peakKN.toFixed(1)} kN ({kNtoTf(peakKN)} tf)</strong></div>
              <div>Recoil impulse: <strong style={{ color: "#1e40af" }}>{results.impulse.toFixed(0)} N·s</strong></div>
              <div>Mortar mass (complete): <strong style={{ color: "#1e3a5f" }}>{mortarMass} kg</strong></div>
              <div>Recoiling mass: <strong style={{ color: "#1e40af" }}>{recoilMass} kg</strong></div>
              <div>Bore: <strong style={{ color: "#1e3a5f" }}>120 mm smooth-bore mortar</strong></div>
              <div>Type: <strong style={{ color: "#1e3a5f" }}>Variable-orifice hydraulic, with return accumulator</strong></div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "1400px", margin: "8px auto 24px", padding: "0 24px", color: "#c0c5d0", fontSize: "10px", letterSpacing: "0.05em" }}>
        AIMS · Autonomous Integrated Mortar System · ARDIC Wah Cantt · Variable-Orifice Model · Carlucci & Jacobson 3rd Ed. · AMCP 706-342
      </div>
    </div>
  );
}
