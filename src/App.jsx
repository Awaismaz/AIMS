import { useState, useMemo } from "react";
import Highcharts from "highcharts";
import { HighchartsReact } from "highcharts-react-official";

// kN to metric ton-force
const kNtoTon = (kN) => (kN / 9.80665).toFixed(1);

// ─── Physics Engine ───────────────────────────────────────────────
function computeRecoil(params) {
  const { projMass, chargeMass, muzzleVel, boreTime, recoilMass, strokeLength } = params;

  const gasVelFactor = 1.5;
  const impulse = projMass * muzzleVel + chargeMass * (gasVelFactor * muzzleVel);
  const V0 = impulse / recoilMass;
  const recoilEnergy = 0.5 * recoilMass * V0 * V0;

  const rigidForce = impulse / boreTime;
  const avgForce = recoilEnergy / strokeLength;

  const peakToAvg = 1.15;
  const peakForce = avgForce * peakToAvg;
  const recoilTime = (recoilMass * V0) / avgForce;
  const forceReduction = ((rigidForce - peakForce) / rigidForce) * 100;

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

    const remainingEnergy = 0.5 * recoilMass * v * v;

    timeData.push([parseFloat((t * 1000).toFixed(2)), parseFloat((Fshape / 1000).toFixed(2))]);
    posData.push({
      x: parseFloat((x * 1000).toFixed(1)),
      F: parseFloat((Fshape / 1000).toFixed(2)),
      v: parseFloat(v.toFixed(2)),
      Er: parseFloat((remainingEnergy / 1000).toFixed(2))
    });

    const a = Fshape / recoilMass;
    v = v - a * dt;
    x = x + v * dt;
    if (v < 0) v = 0;
  }

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

// ─── Slider ───────────────────────────────────────────────────────
function ParamSlider({ label, unit, value, min, max, step, onChange, description }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ marginBottom: "18px" }}>
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

// ─── Stat Card ────────────────────────────────────────────────────
function StatCard({ label, value, unit, tonValue, accent, bg }) {
  return (
    <div style={{
      background: bg || "#f8f9fb", border: "1px solid " + (bg ? "#fecaca" : "#e2e5ea"),
      borderRadius: "8px", padding: "12px 14px"
    }}>
      <div style={{ color: "#8892a4", fontSize: "10px", fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>{label}</div>
      <div style={{ color: accent || "#1a202c", fontSize: "20px", fontFamily: MONO, fontWeight: 700 }}>
        {value} <span style={{ fontSize: "11px", color: "#a0a8b8", fontWeight: 400 }}>{unit}</span>
      </div>
      {tonValue && <div style={{ color: "#6b7280", fontSize: "12px", fontFamily: MONO, fontWeight: 500, marginTop: "2px" }}>({tonValue} ton)</div>}
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
  const [elevation, setElevation] = useState(70);

  const results = useMemo(() => computeRecoil({
    projMass, chargeMass, muzzleVel,
    boreTime: boreTime / 1000,
    recoilMass,
    strokeLength: strokeLength / 1000
  }), [projMass, chargeMass, muzzleVel, boreTime, recoilMass, strokeLength]);

  const h = results.heuristics;
  const rigidKN = results.rigidForce / 1000;
  const avgKN = results.avgForce / 1000;
  const peakKN = results.peakForce / 1000;

  // Vertical components at given elevation
  const sinEl = Math.sin(elevation * Math.PI / 180);
  const verticalPeakKN = peakKN * sinEl;
  const verticalAvgKN = avgKN * sinEl;

  const sectionHeading = {
    fontFamily: FONT, fontSize: "13px", fontWeight: 700,
    color: "#1e3a5f", textTransform: "uppercase", letterSpacing: "0.12em",
    borderBottom: "2px solid #c9a84c", paddingBottom: "8px", marginBottom: "16px", marginTop: 0
  };

  const cardStyle = {
    background: "#ffffff", borderRadius: "12px",
    border: "1px solid #dfe2e8", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    padding: "20px 24px"
  };

  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  // ── Highcharts: Force vs Time ──
  const forceTimeOptions = {
    chart: { type: "areaspline", height: 300, style: { fontFamily: FONT } },
    title: { text: null },
    credits: { enabled: false },
    xAxis: { title: { text: "Time (ms)" }, labels: { style: { fontFamily: MONO, fontSize: "10px" } } },
    yAxis: { title: { text: "Force (kN)" }, labels: { style: { fontFamily: MONO, fontSize: "10px" } },
      plotLines: [{ value: avgKN, color: "#15803d", dashStyle: "Dash", width: 1.5,
        label: { text: `Avg: ${avgKN.toFixed(0)} kN (${kNtoTon(avgKN)} ton)`, style: { color: "#15803d", fontSize: "10px", fontWeight: "bold" } }
      }]
    },
    tooltip: {
      shared: true, crosshairs: true,
      headerFormat: "<b>t = {point.x:.1f} ms</b><br/>",
      pointFormat: '<span style="color:{series.color}">\u25CF</span> {series.name}: <b>{point.y:.1f} kN ({point.ton} ton)</b><br/>',
      style: { fontFamily: FONT }
    },
    legend: { enabled: false },
    plotOptions: { areaspline: { fillOpacity: 0.06, lineWidth: 2.5, marker: { enabled: false } } },
    series: [{
      name: "Force",
      color: "#1e40af",
      data: results.timeData.map(([t, F]) => ({ x: t, y: F, ton: kNtoTon(F) }))
    }]
  };

  // ── Highcharts: Force + Velocity + Energy vs Stroke ──
  const strokeForceData = results.posData.map(d => ({ x: d.x, y: d.F, ton: kNtoTon(d.F) }));
  const strokeVelData = results.posData.map(d => [d.x, d.v]);
  const strokeEnergyData = results.posData.map(d => [d.x, d.Er]);

  const forceStrokeOptions = {
    chart: { height: 300, style: { fontFamily: FONT } },
    title: { text: null },
    credits: { enabled: false },
    xAxis: { title: { text: "Stroke (mm)" }, labels: { style: { fontFamily: MONO, fontSize: "10px" } } },
    yAxis: [
      {
        title: { text: "Force (kN)", style: { color: "#c2410c" } },
        labels: { style: { fontFamily: MONO, fontSize: "10px", color: "#c2410c" } },
        plotLines: [{ value: avgKN, color: "#15803d", dashStyle: "Dash", width: 1.5,
          label: { text: `Avg: ${avgKN.toFixed(0)} kN (${kNtoTon(avgKN)} ton)`, style: { color: "#15803d", fontSize: "10px", fontWeight: "bold" } }
        }]
      },
      {
        title: { text: "Velocity (m/s) / Energy (kJ)", style: { color: "#6b7280" } },
        labels: { style: { fontFamily: MONO, fontSize: "10px", color: "#6b7280" } },
        opposite: true
      }
    ],
    tooltip: {
      shared: true, crosshairs: true,
      style: { fontFamily: FONT }
    },
    legend: { align: "left", verticalAlign: "top", floating: true, y: -5, itemStyle: { fontFamily: FONT, fontSize: "11px", fontWeight: "600" } },
    plotOptions: {
      areaspline: { fillOpacity: 0.06, lineWidth: 2.5, marker: { enabled: false } },
      spline: { lineWidth: 2, marker: { enabled: false } }
    },
    series: [
      {
        name: "Force (kN)",
        type: "areaspline",
        color: "#c2410c",
        data: strokeForceData,
        tooltip: { pointFormat: '<span style="color:{series.color}">\u25CF</span> Force: <b>{point.y:.1f} kN ({point.ton} ton)</b><br/>' },
        yAxis: 0
      },
      {
        name: "Velocity (m/s)",
        type: "spline",
        color: "#0891b2",
        dashStyle: "Dash",
        data: strokeVelData,
        tooltip: { pointFormat: '<span style="color:{series.color}">\u25CF</span> Velocity: <b>{point.y:.1f} m/s</b><br/>' },
        yAxis: 1
      },
      {
        name: "Rem. Energy (kJ)",
        type: "spline",
        color: "#d97706",
        dashStyle: "ShortDot",
        data: strokeEnergyData,
        tooltip: { pointFormat: '<span style="color:{series.color}">\u25CF</span> Energy: <b>{point.y:.1f} kJ</b><br/>' },
        yAxis: 1
      }
    ]
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f7", color: "#1a202c", fontFamily: FONT }}>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #1a2e4a 60%, #243b5c 100%)", borderBottom: "3px solid #c9a84c", padding: "22px 32px 16px" }}>
        <div style={{ maxWidth: "1440px", margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "16px", flexWrap: "wrap" }}>
            <h1 style={{ fontFamily: FONT, fontSize: "24px", fontWeight: 800, color: "#ffffff", margin: 0 }}>AIMS Recoil Calculator</h1>
            <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "12px", letterSpacing: "0.1em" }}>120MM SMOOTH-BORE MORTAR · VARIABLE-ORIFICE BUFFER SIZING</span>
          </div>
          <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "11px", marginTop: "4px", letterSpacing: "0.05em" }}>
            Ref: Carlucci & Jacobson Ch.15 · AMCP 706-342 §4-4 · Rheinmetall Handbook §9.3
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "1440px", margin: "0 auto", padding: "20px 24px 32px" }}>

        {/* ════════ ROW 1: Inputs + Key Results ════════ */}
        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "20px", marginBottom: "20px" }}>

          {/* ── Inputs ── */}
          <div style={cardStyle}>
            <h2 style={sectionHeading}>Inputs</h2>

            <div style={{ color: "#a0a8b8", fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "10px" }}>Ballistic</div>
            <ParamSlider label="Projectile Mass" unit="kg" value={projMass} min={8} max={20} step={0.5} onChange={setProjMass} description="HE: ~13 kg · ER: ~16 kg" />
            <ParamSlider label="Charge Mass" unit="kg" value={chargeMass} min={0.5} max={6} step={0.1} onChange={setChargeMass} description="Zone 0: ~0.5 kg · Zone 4: ~3.5 kg" />
            <ParamSlider label="Muzzle Velocity" unit="m/s" value={muzzleVel} min={100} max={500} step={5} onChange={setMuzzleVel} description="Zone 0: ~150 · Zone 4: ~320 m/s" />
            <ParamSlider label="Bore Time" unit="ms" value={boreTime} min={3} max={15} step={0.5} onChange={setBoreTime} />

            <div style={{ color: "#a0a8b8", fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "10px", marginTop: "16px" }}>Recoil System</div>
            <ParamSlider label="Recoiling Mass" unit="kg" value={recoilMass} min={50} max={300} step={5} onChange={setRecoilMass} description="Barrel + cradle + sliding parts" />
            <ParamSlider label="Allowed Stroke" unit="mm" value={strokeLength} min={200} max={800} step={10} onChange={setStrokeLength} description="Buffer travel length" />
            <ParamSlider label="Elevation Angle" unit="°" value={elevation} min={45} max={85} step={1} onChange={setElevation} description="Mortar tube elevation above horizontal" />

            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "6px", padding: "10px 12px", marginTop: "12px" }}>
              <div style={{ color: "#92400e", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px", fontWeight: 600 }}>Assumptions</div>
              <div style={{ color: "#78716c", fontSize: "10.5px", lineHeight: 1.5 }}>
                Variable-orifice brake · Peak/Avg 1.15:1 · Gas vel 1.5×V<sub>muz</sub> · MIL-PRF-46170 oil (ρ=860)
              </div>
            </div>
          </div>

          {/* ── Key Results Dashboard ── */}
          <div style={cardStyle}>
            <h2 style={sectionHeading}>Results</h2>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "16px" }}>
              <StatCard label="Recoil Impulse" value={results.impulse.toFixed(0)} unit="N·s" accent="#1e40af" />
              <StatCard label="Free Recoil Velocity" value={results.V0.toFixed(1)} unit="m/s" accent="#1e40af" />
              <StatCard label="Recoil Energy" value={(results.recoilEnergy / 1000).toFixed(1)} unit="kJ" accent="#b45309" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "12px", marginBottom: "16px" }}>
              <StatCard label="Rigid Force (no buffer)" value={rigidKN.toFixed(0)} unit="kN" accent="#dc2626" tonValue={kNtoTon(rigidKN)} bg="#fef2f2" />
              <StatCard label="Avg Buffered Force" value={avgKN.toFixed(1)} unit="kN" accent="#15803d" tonValue={kNtoTon(avgKN)} />
              <StatCard label="Peak Buffered Force" value={peakKN.toFixed(1)} unit="kN" accent="#c2410c" tonValue={kNtoTon(peakKN)} />
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "12px 14px" }}>
                <div style={{ color: "#8892a4", fontSize: "10px", fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Force Reduction</div>
                <div style={{ color: "#16a34a", fontSize: "20px", fontFamily: MONO, fontWeight: 700 }}>
                  {results.forceReduction.toFixed(1)}<span style={{ fontSize: "12px" }}>%</span>
                </div>
                <div style={{ color: "#9ca3af", fontSize: "10px", marginTop: "2px" }}>Duration: {(results.recoilTime * 1000).toFixed(1)} ms</div>
              </div>
            </div>

            {/* ── Vertical Load on Vehicle Chassis ── */}
            <div style={{ background: "#fef3c7", border: "2px solid #f59e0b", borderRadius: "8px", padding: "14px 18px", marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
                <div>
                  <div style={{ color: "#92400e", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px", fontWeight: 700 }}>Vertical Load on Vehicle Chassis</div>
                  <div style={{ color: "#78716c", fontSize: "11px" }}>
                    At elevation {elevation}° (sin {elevation}° = {sinEl.toFixed(3)})
                  </div>
                </div>
                <div style={{ display: "flex", gap: "24px" }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: "#92400e", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Peak Vertical</div>
                    <div style={{ color: "#b45309", fontSize: "22px", fontFamily: MONO, fontWeight: 700 }}>
                      {verticalPeakKN.toFixed(1)} <span style={{ fontSize: "12px" }}>kN</span>
                      <span style={{ fontSize: "13px", fontWeight: 600, color: "#92400e" }}> ({kNtoTon(verticalPeakKN)} ton)</span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: "#92400e", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Avg Vertical</div>
                    <div style={{ color: "#b45309", fontSize: "22px", fontFamily: MONO, fontWeight: 700 }}>
                      {verticalAvgKN.toFixed(1)} <span style={{ fontSize: "12px" }}>kN</span>
                      <span style={{ fontSize: "13px", fontWeight: 600, color: "#92400e" }}> ({kNtoTon(verticalAvgKN)} ton)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Cylinder heuristics — compact table */}
            <div style={{ color: "#a0a8b8", fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "8px" }}>Buffer Cylinder Heuristics</div>
            <div style={{ background: "#f8f9fb", border: "1px solid #e8eaef", borderRadius: "8px", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", fontFamily: FONT }}>
                <tbody>
                  <tr>
                    {[
                      ["Bore Dia", h.boreDiaMm.toFixed(0) + " mm"],
                      ["Piston Area", h.pistonAreaCm2.toFixed(1) + " cm²"],
                      ["Rod Dia", h.rodDiaMm.toFixed(0) + " mm"],
                      ["Orifice Area", h.orificeAreaCm2.toFixed(1) + " cm²"],
                      ["Orifice Ratio", (h.orificeRatio * 100).toFixed(1) + "%"],
                    ].map(([lbl, val], i) => (
                      <td key={i} style={{ padding: "8px 10px", borderRight: i < 4 ? "1px solid #e8eaef" : "none", borderBottom: "1px solid #e8eaef" }}>
                        <div style={{ color: "#8892a4", fontSize: "10px", marginBottom: "2px" }}>{lbl}</div>
                        <div style={{ color: "#1e3a5f", fontFamily: MONO, fontWeight: 700 }}>{val}</div>
                      </td>
                    ))}
                  </tr>
                  <tr>
                    {[
                      ["Overall Length", h.overallLengthMm.toFixed(0) + " mm"],
                      ["Fluid Volume", h.fluidVolumeCm3.toFixed(0) + " cm³"],
                      ["Pressure Range", h.minPressureMPa.toFixed(0) + "–" + h.maxPressureMPa.toFixed(0) + " MPa"],
                      ["Cd (orifice)", h.Cd.toFixed(2)],
                      ["Oil Spec", "MIL-PRF-46170"],
                    ].map(([lbl, val], i) => (
                      <td key={i} style={{ padding: "8px 10px", borderRight: i < 4 ? "1px solid #e8eaef" : "none" }}>
                        <div style={{ color: "#8892a4", fontSize: "10px", marginBottom: "2px" }}>{lbl}</div>
                        <div style={{ color: "#1e3a5f", fontFamily: MONO, fontWeight: 700, fontSize: "12px" }}>{val}</div>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ════════ ROW 2: Charts side-by-side ════════ */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>
          <div style={cardStyle}>
            <div style={{ color: "#a0a8b8", fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "6px" }}>Force vs Time (Ideal Variable-Orifice)</div>
            <HighchartsReact highcharts={Highcharts} options={forceTimeOptions} />
          </div>
          <div style={cardStyle}>
            <div style={{ color: "#a0a8b8", fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "6px" }}>Force, Velocity & Energy vs Stroke</div>
            <HighchartsReact highcharts={Highcharts} options={forceStrokeOptions} />
          </div>
        </div>

        {/* ════════ ROW 3: RFQ Email Draft ════════ */}
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h2 style={{ ...sectionHeading, marginBottom: 0, borderBottom: "none", paddingBottom: 0 }}>RFQ Email Draft</h2>
            <button
              onClick={() => {
                const el = document.getElementById("rfq-email-body");
                if (el) {
                  navigator.clipboard.writeText(el.innerText);
                  const btn = document.getElementById("rfq-copy-btn");
                  if (btn) { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Copy to Clipboard"; }, 2000); }
                }
              }}
              id="rfq-copy-btn"
              style={{
                background: "#1e3a5f", color: "#fff", border: "none", borderRadius: "6px",
                padding: "8px 16px", fontSize: "12px", fontFamily: FONT, fontWeight: 600,
                cursor: "pointer", letterSpacing: "0.05em"
              }}
            >Copy to Clipboard</button>
          </div>

          <div style={{ borderBottom: "2px solid #c9a84c", marginBottom: "16px" }} />

          <div id="rfq-email-body" style={{ background: "#fafbfc", border: "1px solid #e8eaef", borderRadius: "8px", padding: "24px 28px", fontSize: "13px", lineHeight: 1.75, color: "#374151" }}>

            <div style={{ marginBottom: "16px" }}>
              <div style={{ color: "#8892a4", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Subject</div>
              <div style={{ fontWeight: 600, color: "#1e3a5f" }}>
                RFQ — Heavy-Duty Hydraulic Shock Absorber for 120mm Mortar Recoil System (AIMS Programme)
              </div>
            </div>

            <div style={{ borderBottom: "1px solid #e8eaef", margin: "12px 0 16px" }} />

            <p>Dear Sir/Madam,</p>

            <p>
              We are writing from <strong>ARDIC (Advance Research, Development and Innovation Center)</strong>, Wah Cantt, Pakistan. We are currently executing the <strong>AIMS (Autonomous Integrated Mortar System)</strong> programme — an 18-month R&D effort integrating a 120mm smooth-bore mortar onto a Toyota Land Cruiser 79 platform.
            </p>

            <p>
              As part of this programme, we require an <strong>off-the-shelf heavy-duty hydraulic shock absorber</strong> (variable-orifice type, with integrated return mechanism) to serve as the primary recoil buffer. We understand the <strong>Enidine HD/HDN Series</strong> heavy-duty industrial shock absorbers may be suitable for this application and would appreciate a formal quotation based on the following specifications.
            </p>

            <p style={{ fontWeight: 600, color: "#1e3a5f", marginTop: "20px", marginBottom: "8px" }}>1. Application Overview</p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", marginBottom: "16px" }}>
              <tbody>
                {[
                  ["Weapon System", "120mm smooth-bore mortar (vehicle-mounted)"],
                  ["Platform", "Toyota Land Cruiser 79 (4×4)"],
                  ["Firing Cycle", "Repetitive, up to 6–8 rounds per minute"],
                  ["Operating Environment", "Desert & mountain terrain, −10°C to +55°C ambient"],
                  ["Mounting Orientation", `Near-vertical (elevation ${elevation}° typical, range 45°–85°), with lateral loads during traverse`],
                ].map(([lbl, val], i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #e8eaef" }}>
                    <td style={{ padding: "6px 12px 6px 0", color: "#6b7280", fontWeight: 500, width: "200px" }}>{lbl}</td>
                    <td style={{ padding: "6px 0", color: "#1a202c" }}>{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p style={{ fontWeight: 600, color: "#1e3a5f", marginBottom: "8px" }}>2. Recoil Buffer Requirements</p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", marginBottom: "16px" }}>
              <tbody>
                {[
                  ["Recoil Energy per Cycle", `${(results.recoilEnergy / 1000).toFixed(1)} kJ`],
                  ["Peak Input Velocity", `${results.V0.toFixed(1)} m/s`],
                  ["Required Stroke", `${strokeLength} mm`],
                  ["Recoiling Mass", `${recoilMass} kg`],
                  ["Recoil Impulse", `${results.impulse.toFixed(0)} N·s`],
                  ["Target Avg Braking Force", `${avgKN.toFixed(1)} kN (${kNtoTon(avgKN)} ton)`],
                  ["Max Allowable Peak Force", `${peakKN.toFixed(1)} kN (${kNtoTon(peakKN)} ton)`],
                  ["Recoil Duration", `${(results.recoilTime * 1000).toFixed(1)} ms`],
                  ["Force Profile", "Near-constant (variable-orifice preferred)"],
                  ["Return Mechanism", "Required — spring or gas-assisted accumulator"],
                ].map(([lbl, val], i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #e8eaef" }}>
                    <td style={{ padding: "6px 12px 6px 0", color: "#6b7280", fontWeight: 500, width: "240px" }}>{lbl}</td>
                    <td style={{ padding: "6px 0", color: "#1a202c", fontWeight: 600 }}>{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p style={{ fontWeight: 600, color: "#1e3a5f", marginBottom: "8px" }}>3. Estimated Cylinder Sizing (for reference)</p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", marginBottom: "16px" }}>
              <tbody>
                {[
                  ["Bore Diameter", `~${h.boreDiaMm.toFixed(0)} mm`],
                  ["Rod Diameter", `~${h.rodDiaMm.toFixed(0)} mm`],
                  ["Overall Length (est.)", `~${h.overallLengthMm.toFixed(0)} mm`],
                  ["Working Pressure Range", `${h.minPressureMPa.toFixed(0)}–${h.maxPressureMPa.toFixed(0)} MPa`],
                  ["Hydraulic Fluid", "MIL-PRF-46170 compatible (ρ ≈ 860 kg/m³)"],
                ].map(([lbl, val], i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #e8eaef" }}>
                    <td style={{ padding: "6px 12px 6px 0", color: "#6b7280", fontWeight: 500, width: "240px" }}>{lbl}</td>
                    <td style={{ padding: "6px 0", color: "#1a202c" }}>{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p style={{ fontWeight: 600, color: "#1e3a5f", marginBottom: "8px" }}>4. Information Requested</p>
            <ol style={{ paddingLeft: "20px", marginBottom: "16px" }}>
              <li>Recommended model(s) from your HD/HDN product line that meet or exceed the above specifications.</li>
              <li>Unit pricing for quantities of 2 (prototype) and 10 (low-rate initial production).</li>
              <li>Lead time for prototype delivery.</li>
              <li>Certified force-displacement and force-velocity characterization data for the recommended model.</li>
              <li>Mounting interface drawings and envelope dimensions.</li>
              <li>Service life rating (number of full-energy cycles before rebuild/replacement).</li>
              <li>Availability of customization (stroke length, mounting, return spring rate).</li>
            </ol>

            <p style={{ fontWeight: 600, color: "#1e3a5f", marginBottom: "8px" }}>5. Timeline</p>
            <p>
              We intend to finalize vendor selection within <strong>30 days</strong> of this enquiry. Prototype units are required within <strong>90 days</strong> of order placement. Early engagement on technical feasibility is highly appreciated.
            </p>

            <p>
              Please do not hesitate to contact us for any clarification or additional technical data. We are happy to arrange a technical call to discuss the application in further detail.
            </p>

            <div style={{ marginTop: "24px" }}>
              <p style={{ marginBottom: "4px" }}>Best regards,</p>
              <p style={{ marginBottom: "2px" }}><strong>Maj Awais Mazahir</strong></p>
              <p style={{ marginBottom: "2px", color: "#6b7280" }}>Officer in Charge — Design</p>
              <p style={{ marginBottom: "2px", color: "#6b7280" }}>ARDIC (Advance Research, Development and Innovation Center)</p>
              <p style={{ color: "#6b7280" }}>Wah Cantt, Pakistan</p>
            </div>

            <div style={{ borderTop: "1px solid #e8eaef", marginTop: "16px", paddingTop: "8px", color: "#9ca3af", fontSize: "10px" }}>
              Generated {today} · AIMS Recoil Calculator · Values derived from Carlucci & Jacobson 3rd Ed., AMCP 706-342 §4-4
            </div>
          </div>
        </div>

        <div style={{ color: "#c0c5d0", fontSize: "10px", letterSpacing: "0.05em", marginTop: "16px", textAlign: "center" }}>
          AIMS · Autonomous Integrated Mortar System · ARDIC Wah Cantt · Carlucci & Jacobson 3rd Ed. · AMCP 706-342
        </div>
      </div>
    </div>
  );
}
