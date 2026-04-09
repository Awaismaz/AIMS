import { useState, useMemo, useCallback } from "react";
import Highcharts from "highcharts";
import { HighchartsReact } from "highcharts-react-official";

const kNtoTon = (kN) => (kN / 9.80665).toFixed(1);

// ─── Persistent state via localStorage ────────────────────────────
const STORAGE_KEY = "aims-recoil-params";

function loadParams() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveParams(params) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(params)); } catch {}
}

const DEFAULTS = {
  projMass: 15.9, chargeMass: 2.8, muzzleVel: 272,
  boreTime: 8, mortarMass: 100, additionalMass: 50,
  strokeLength: 500, elevation: 85
};

function usePersistentParam(key, fallback) {
  const saved = loadParams();
  const [val, setVal] = useState(saved && saved[key] != null ? saved[key] : fallback);
  const setter = useCallback((v) => {
    setVal(v);
    const current = loadParams() || { ...DEFAULTS };
    current[key] = v;
    saveParams(current);
  }, [key]);
  return [val, setter];
}

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
      pistonAreaCm2: idealPistonAreaCm2, boreDiaMm: idealBoreDia,
      orificeAreaCm2: idealOrificeAreaCm2, orificeRatio,
      rodDiaMm: idealRodDia, overallLengthMm: overallLength * 1000,
      fluidVolumeCm3: fluidVolume, minPressureMPa: minPressure,
      maxPressureMPa: maxPressure, Cd
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

// ─── Stat Card with formula ───────────────────────────────────────
function StatCard({ label, value, unit, tonValue, accent, bg, formula }) {
  return (
    <div style={{
      background: bg || "#f8f9fb", border: "1px solid " + (bg ? "#fecaca" : "#e2e5ea"),
      borderRadius: "8px", padding: "12px 14px"
    }}>
      <div style={{ color: "#8892a4", fontSize: "10px", fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "6px" }}>
        <span style={{ color: accent || "#1a202c", fontSize: "20px", fontFamily: MONO, fontWeight: 700 }}>
          {value} <span style={{ fontSize: "11px", color: "#a0a8b8", fontWeight: 400 }}>{unit}</span>
        </span>
        {formula && <span style={{ color: "#4a5568", fontSize: "15px", fontFamily: MONO, fontWeight: 700 }}>[{formula}]</span>}
      </div>
      {tonValue && <div style={{ color: "#6b7280", fontSize: "12px", fontFamily: MONO, fontWeight: 500, marginTop: "2px" }}>({tonValue} ton)</div>}
    </div>
  );
}

// ─── Password Gate ───────────────────────────────────────────────
const ACCESS_HASH = "fde185d0"; // hash of AIMS2026
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).slice(0, 8);
}

function PasswordGate({ children }) {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem("aims-auth") === "1");
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState(false);

  if (authed) return children;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (simpleHash(pwd) === ACCESS_HASH) {
      sessionStorage.setItem("aims-auth", "1");
      setAuthed(true);
    } else {
      setError(true);
      setPwd("");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f7", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
      <div style={{ background: "#fff", borderRadius: "12px", border: "1px solid #dfe2e8", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", padding: "40px 48px", textAlign: "center", maxWidth: "400px" }}>
        <div style={{ background: "linear-gradient(135deg, #1e3a5f, #243b5c)", borderRadius: "8px", padding: "16px", marginBottom: "24px" }}>
          <div style={{ color: "#fff", fontSize: "20px", fontWeight: 800 }}>AIMS Recoil Calculator</div>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "11px", letterSpacing: "0.1em", marginTop: "4px" }}>RESTRICTED ACCESS</div>
        </div>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={pwd}
            onChange={e => { setPwd(e.target.value); setError(false); }}
            placeholder="Enter access code"
            autoFocus
            style={{
              width: "100%", padding: "12px 16px", fontSize: "15px", fontFamily: MONO,
              border: "2px solid " + (error ? "#ef4444" : "#dfe2e8"), borderRadius: "8px",
              outline: "none", boxSizing: "border-box", marginBottom: "12px",
              textAlign: "center", letterSpacing: "0.15em"
            }}
          />
          {error && <div style={{ color: "#ef4444", fontSize: "12px", marginBottom: "8px" }}>Invalid access code</div>}
          <button type="submit" style={{
            width: "100%", padding: "12px", fontSize: "13px", fontWeight: 700,
            background: "#1e3a5f", color: "#fff", border: "none", borderRadius: "8px",
            cursor: "pointer", letterSpacing: "0.08em", fontFamily: FONT
          }}>Access Dashboard</button>
        </form>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────
export default function AIMSRecoilCalculator() {
  const [projMass, setProjMass] = usePersistentParam("projMass", DEFAULTS.projMass);
  const [chargeMass, setChargeMass] = usePersistentParam("chargeMass", DEFAULTS.chargeMass);
  const [muzzleVel, setMuzzleVel] = usePersistentParam("muzzleVel", DEFAULTS.muzzleVel);
  const [boreTime, setBoreTime] = usePersistentParam("boreTime", DEFAULTS.boreTime);
  const [mortarMass, setMortarMass] = usePersistentParam("mortarMass", DEFAULTS.mortarMass);
  const [additionalMass, setAdditionalMass] = usePersistentParam("additionalMass", DEFAULTS.additionalMass);
  const [strokeLength, setStrokeLength] = usePersistentParam("strokeLength", DEFAULTS.strokeLength);
  const [elevation, setElevation] = usePersistentParam("elevation", DEFAULTS.elevation);

  const recoilMass = mortarMass + additionalMass;

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

  // ── Chart configs ──
  const chartBase = { style: { fontFamily: FONT } };
  const axisLabelStyle = { fontFamily: MONO, fontSize: "10px" };

  const forceTimeOptions = {
    chart: { ...chartBase, type: "areaspline", height: 300 },
    title: { text: null }, credits: { enabled: false },
    xAxis: { title: { text: "Time (ms)" }, labels: { style: axisLabelStyle } },
    yAxis: { title: { text: "Force (kN)" }, labels: { style: axisLabelStyle },
      plotLines: [{ value: avgKN, color: "#15803d", dashStyle: "Dash", width: 1.5,
        label: { text: `F_avg: ${avgKN.toFixed(0)} kN (${kNtoTon(avgKN)} ton)`, style: { color: "#15803d", fontSize: "10px", fontWeight: "bold" } }
      }]
    },
    tooltip: { shared: true, crosshairs: true, style: { fontFamily: FONT },
      headerFormat: "<b>t = {point.x:.1f} ms</b><br/>",
      pointFormat: '<span style="color:{series.color}">\u25CF</span> {series.name}: <b>{point.y:.1f} kN ({point.ton} ton)</b><br/>'
    },
    legend: { enabled: false },
    plotOptions: { areaspline: { fillOpacity: 0.06, lineWidth: 2.5, marker: { enabled: false } } },
    series: [{ name: "Force", color: "#1e40af", data: results.timeData.map(([t, F]) => ({ x: t, y: F, ton: kNtoTon(F) })) }]
  };

  const forceStrokeOptions = {
    chart: { ...chartBase, type: "areaspline", height: 300 },
    title: { text: null }, credits: { enabled: false },
    xAxis: { title: { text: "Stroke (mm)" }, labels: { style: axisLabelStyle } },
    yAxis: { title: { text: "Force (kN)" }, labels: { style: axisLabelStyle },
      plotLines: [{ value: avgKN, color: "#15803d", dashStyle: "Dash", width: 1.5,
        label: { text: `F_avg: ${avgKN.toFixed(0)} kN (${kNtoTon(avgKN)} ton)`, style: { color: "#15803d", fontSize: "10px", fontWeight: "bold" } }
      }]
    },
    tooltip: { shared: true, crosshairs: true, style: { fontFamily: FONT },
      headerFormat: "<b>x = {point.x:.1f} mm</b><br/>",
      pointFormat: '<span style="color:{series.color}">\u25CF</span> Force: <b>{point.y:.1f} kN ({point.ton} ton)</b><br/>'
    },
    legend: { enabled: false },
    plotOptions: { areaspline: { fillOpacity: 0.06, lineWidth: 2.5, marker: { enabled: false } } },
    series: [{ name: "Force", color: "#c2410c", data: results.posData.map(d => ({ x: d.x, y: d.F, ton: kNtoTon(d.F) })) }]
  };

  const velocityStrokeOptions = {
    chart: { ...chartBase, type: "areaspline", height: 300 },
    title: { text: null }, credits: { enabled: false },
    xAxis: { title: { text: "Stroke (mm)" }, labels: { style: axisLabelStyle } },
    yAxis: { title: { text: "Velocity (m/s)" }, labels: { style: axisLabelStyle } },
    tooltip: { shared: true, crosshairs: true, style: { fontFamily: FONT },
      headerFormat: "<b>x = {point.x:.1f} mm</b><br/>",
      pointFormat: '<span style="color:{series.color}">\u25CF</span> Velocity: <b>{point.y:.1f} m/s</b><br/>'
    },
    legend: { enabled: false },
    plotOptions: { areaspline: { fillOpacity: 0.08, lineWidth: 2.5, marker: { enabled: false } } },
    series: [{ name: "Velocity", color: "#0891b2", data: results.posData.map(d => [d.x, d.v]) }]
  };

  const energyStrokeOptions = {
    chart: { ...chartBase, type: "areaspline", height: 300 },
    title: { text: null }, credits: { enabled: false },
    xAxis: { title: { text: "Stroke (mm)" }, labels: { style: axisLabelStyle } },
    yAxis: { title: { text: "Kinetic Energy (kJ)" }, labels: { style: axisLabelStyle } },
    tooltip: { shared: true, crosshairs: true, style: { fontFamily: FONT },
      headerFormat: "<b>x = {point.x:.1f} mm</b><br/>",
      pointFormat: '<span style="color:{series.color}">\u25CF</span> KE: <b>{point.y:.1f} kJ</b><br/>'
    },
    legend: { enabled: false },
    plotOptions: { areaspline: { fillOpacity: 0.08, lineWidth: 2.5, marker: { enabled: false } } },
    series: [{ name: "Kinetic Energy", color: "#d97706", data: results.posData.map(d => [d.x, d.Er]) }]
  };

  return (
    <PasswordGate>
    <div style={{ minHeight: "100vh", background: "#f3f4f7", color: "#1a202c", fontFamily: FONT }}>

      <style>{`
        .aims-row-top { display: grid; grid-template-columns: 1fr 1fr 3fr; gap: 20px; margin-bottom: 20px; }
        .aims-row-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
        .aims-results-grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
        .aims-results-grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
        @media (max-width: 1100px) {
          .aims-row-top { grid-template-columns: 1fr 1fr !important; }
          .aims-results-grid4 { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 768px) {
          .aims-row-top { grid-template-columns: 1fr !important; }
          .aims-row-charts { grid-template-columns: 1fr !important; }
          .aims-results-grid3 { grid-template-columns: 1fr !important; }
          .aims-results-grid4 { grid-template-columns: 1fr 1fr !important; }
          .aims-heuristics-table td { display: block !important; border-right: none !important; }
          .aims-heuristics-table tr { display: flex; flex-wrap: wrap; }
          .aims-heuristics-table td { flex: 1 1 45%; min-width: 120px; }
        }
        html, body { overflow-x: hidden; }
        .highcharts-container, .highcharts-root { max-width: 100% !important; }
        .aims-chart-card { overflow: hidden; min-width: 0; }
      `}</style>

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

        {/* ════════ ROW 1: Inputs (2 cols) + Results ════════ */}
        <div className="aims-row-top">

          {/* ── Ballistic Inputs ── */}
          <div style={cardStyle}>
            <h2 style={sectionHeading}>Ballistic</h2>
            <ParamSlider label="Projectile Mass" unit="kg" value={projMass} min={8} max={20} step={0.5} onChange={setProjMass} description="HE: ~13 kg · ER: ~16 kg" />
            <ParamSlider label="Charge Mass" unit="kg" value={chargeMass} min={0.5} max={6} step={0.1} onChange={setChargeMass} description="Zone 0: ~0.5 · Zone 4: ~3.5 kg" />
            <ParamSlider label="Muzzle Velocity" unit="m/s" value={muzzleVel} min={100} max={500} step={5} onChange={setMuzzleVel} description="Zone 0: ~150 · Zone 4: ~320" />
            <ParamSlider label="Bore Time" unit="ms" value={boreTime} min={3} max={15} step={0.5} onChange={setBoreTime} description="Projectile time in barrel" />

            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "6px", padding: "10px 12px", marginTop: "8px" }}>
              <div style={{ color: "#92400e", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px", fontWeight: 600 }}>Assumptions</div>
              <div style={{ color: "#78716c", fontSize: "10px", lineHeight: 1.5 }}>
                Variable-orifice brake · Peak/Avg 1.15:1 · Gas vel 1.5×V<sub>muz</sub> · MIL-PRF-46170 (ρ=860)
              </div>
            </div>
          </div>

          {/* ── Recoil System Inputs ── */}
          <div style={cardStyle}>
            <h2 style={sectionHeading}>Recoil System</h2>
            <ParamSlider label="Mortar Mass" unit="kg" value={mortarMass} min={50} max={250} step={5} onChange={setMortarMass} description="Complete mortar assembly" />
            <ParamSlider label="Additional Mass" unit="kg" value={additionalMass} min={10} max={150} step={5} onChange={setAdditionalMass} description="Cradle + sliding + recoil mech" />
            <div style={{ background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: "6px", padding: "8px 12px", marginBottom: "18px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ color: "#4338ca", fontSize: "12px", fontWeight: 600 }}>Recoiling Mass (M)</span>
              <span style={{ color: "#4338ca", fontSize: "16px", fontFamily: MONO, fontWeight: 700 }}>{recoilMass} <span style={{ fontSize: "11px", fontWeight: 400 }}>kg</span></span>
            </div>
            <ParamSlider label="Allowed Stroke" unit="mm" value={strokeLength} min={200} max={800} step={10} onChange={setStrokeLength} description="Buffer travel length" />
            <ParamSlider label="Elevation Angle" unit="°" value={elevation} min={45} max={85} step={1} onChange={setElevation} description="Tube elevation above horizontal" />
          </div>

          <div style={cardStyle}>
            <h2 style={sectionHeading}>Results</h2>

            <div className="aims-results-grid3">
              <StatCard label="Recoil Impulse" value={results.impulse.toFixed(0)} unit="N·s" accent="#1e40af"
                formula={<>I = m<sub>p</sub>V + m<sub>c</sub>·1.5V</>} />
              <StatCard label="Free Recoil Velocity" value={results.V0.toFixed(1)} unit="m/s" accent="#1e40af"
                formula={<>V<sub>0</sub> = I / M</>} />
              <StatCard label="Recoil Energy" value={(results.recoilEnergy / 1000).toFixed(1)} unit="kJ" accent="#b45309"
                formula={<>E = ½MV<sub>0</sub>²</>} />
            </div>

            <div className="aims-results-grid4">
              <StatCard label="Rigid Force (no buffer)" value={rigidKN.toFixed(0)} unit="kN" accent="#dc2626" tonValue={kNtoTon(rigidKN)} bg="#fef2f2"
                formula={<>F = I / τ</>} />
              <StatCard label="Avg Buffered Force" value={avgKN.toFixed(1)} unit="kN" accent="#15803d" tonValue={kNtoTon(avgKN)}
                formula={<>F<sub>avg</sub> = E / s</>} />
              <StatCard label="Peak Buffered Force" value={peakKN.toFixed(1)} unit="kN" accent="#c2410c" tonValue={kNtoTon(peakKN)}
                formula={<>F<sub>peak</sub> = 1.15 × F<sub>avg</sub></>} />
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "12px 14px" }}>
                <div style={{ color: "#8892a4", fontSize: "10px", fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Force Reduction</div>
                <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "6px" }}>
                  <span style={{ color: "#16a34a", fontSize: "20px", fontFamily: MONO, fontWeight: 700 }}>
                    {results.forceReduction.toFixed(1)}<span style={{ fontSize: "12px" }}>%</span>
                  </span>
                  <span style={{ color: "#4a5568", fontSize: "14px", fontFamily: MONO, fontWeight: 600 }}>[(F<sub>rigid</sub> − F<sub>peak</sub>) / F<sub>rigid</sub>]</span>
                </div>
                <div style={{ color: "#9ca3af", fontSize: "10px", marginTop: "2px" }}>Duration: {(results.recoilTime * 1000).toFixed(1)} ms</div>
              </div>
            </div>

            {/* Vertical Load */}
            <div style={{ background: "#fef3c7", border: "2px solid #f59e0b", borderRadius: "8px", padding: "14px 18px", marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
                <div>
                  <div style={{ color: "#92400e", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px", fontWeight: 700 }}>Vertical Load on Vehicle Chassis</div>
                  <div style={{ color: "#78716c", fontSize: "11px" }}>
                    At elevation {elevation}° — F<sub>vert</sub> = F × sin({elevation}°)
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

            {/* Heuristics */}
            <div style={{ color: "#a0a8b8", fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "8px" }}>Buffer Cylinder Heuristics</div>
            <div style={{ background: "#f8f9fb", border: "1px solid #e8eaef", borderRadius: "8px", overflow: "hidden" }}>
              <table className="aims-heuristics-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", fontFamily: FONT }}>
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

        {/* ════════ ROW 2: Force Charts ════════ */}
        <div className="aims-row-charts">
          <div className="aims-chart-card" style={cardStyle}>
            <div style={{ color: "#a0a8b8", fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "6px" }}>Force vs Time (Ideal Variable-Orifice)</div>
            <HighchartsReact highcharts={Highcharts} options={forceTimeOptions} containerProps={{ style: { width: "100%", maxWidth: "100%" } }} />
          </div>
          <div className="aims-chart-card" style={cardStyle}>
            <div style={{ color: "#a0a8b8", fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "6px" }}>Force vs Stroke</div>
            <HighchartsReact highcharts={Highcharts} options={forceStrokeOptions} containerProps={{ style: { width: "100%", maxWidth: "100%" } }} />
          </div>
        </div>

        {/* ════════ ROW 3: Velocity + Energy Charts ════════ */}
        <div className="aims-row-charts">
          <div className="aims-chart-card" style={cardStyle}>
            <div style={{ color: "#a0a8b8", fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "6px" }}>Recoil Velocity vs Stroke</div>
            <HighchartsReact highcharts={Highcharts} options={velocityStrokeOptions} containerProps={{ style: { width: "100%", maxWidth: "100%" } }} />
          </div>
          <div className="aims-chart-card" style={cardStyle}>
            <div style={{ color: "#a0a8b8", fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "6px" }}>Remaining Kinetic Energy vs Stroke</div>
            <HighchartsReact highcharts={Highcharts} options={energyStrokeOptions} containerProps={{ style: { width: "100%", maxWidth: "100%" } }} />
          </div>
        </div>

        {/* ════════ ROW 4: RFQ Email Draft ════════ */}
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
                RFQ — Industrial Heavy-Duty Hydraulic Recoil Brake / Shock Absorber
              </div>
            </div>

            <div style={{ borderBottom: "1px solid #e8eaef", margin: "12px 0 16px" }} />

            <p>Dear Sir/Madam,</p>

            <p>
              We are writing from <strong>MHIL (Margalla Heavy Industries Limited)</strong>, Taxila, Pakistan. We are currently sourcing an <strong>industrial-grade heavy-duty hydraulic recoil brake</strong> for an R&D application involving high-impulse repetitive loading.
            </p>

            <p>
              We require an <strong>off-the-shelf unit available for immediate delivery</strong> from your current product range. We are open to either a <strong>single or dual absorber configuration</strong> — whichever best meets the requirements below. Please advise on the most suitable product from your catalogue.
            </p>

            <p style={{ fontWeight: 600, color: "#1e3a5f", marginTop: "20px", marginBottom: "8px" }}>Operating Requirements</p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", marginBottom: "16px" }}>
              <tbody>
                {[
                  ["Energy per Cycle", `${(results.recoilEnergy / 1000).toFixed(1)} kJ`],
                  ["Peak Input Velocity", `${results.V0.toFixed(1)} m/s`],
                  ["Stroke (Travel)", "400–500 mm preferred"],
                  ["Moving Mass", `${recoilMass} kg`],
                  ["Force Profile", "Constant force / near-constant (variable-orifice type preferred)"],
                  ["Return Mechanism", "Required — spring or gas-assisted (must fully reset between cycles)"],
                  ["Duty Cycle", "Repetitive impulse, up to 6–8 cycles per minute"],
                  ["Configuration", "Single or dual unit — please advise best option"],
                  ["Operating Temp", "−10°C to +55°C ambient"],
                  ["Mounting", "Near-vertical orientation (45°–85° from horizontal)"],
                ].map(([lbl, val], i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #e8eaef" }}>
                    <td style={{ padding: "6px 12px 6px 0", color: "#6b7280", fontWeight: 500, width: "220px" }}>{lbl}</td>
                    <td style={{ padding: "6px 0", color: "#1a202c", fontWeight: 600 }}>{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p style={{ fontWeight: 600, color: "#1e3a5f", marginBottom: "8px" }}>What We Need From You</p>
            <ol style={{ paddingLeft: "20px", marginBottom: "16px" }}>
              <li>Recommended product model(s) from your <strong>available inventory</strong> that meet or exceed the above requirements.</li>
              <li>Whether a single unit or dual-unit configuration is recommended for this energy level.</li>
              <li>Unit pricing for quantities of 2 (prototype evaluation) and 10 (initial procurement).</li>
              <li>Delivery lead time — <strong>immediate availability is strongly preferred</strong>.</li>
              <li>Force-displacement and force-velocity characterization data (if available).</li>
              <li>Mounting interface drawings and overall envelope dimensions.</li>
              <li>Service life rating (number of full-energy cycles before rebuild).</li>
            </ol>

            <p>
              We are looking to finalize procurement quickly. Please respond at your earliest convenience with available options and pricing. We are happy to arrange a technical call if needed.
            </p>

            <div style={{ marginTop: "24px" }}>
              <p style={{ marginBottom: "4px" }}>Best regards,</p>
              <p style={{ marginBottom: "2px" }}><strong>Awais Mazahir</strong></p>
              <p style={{ marginBottom: "2px", color: "#6b7280" }}>Design Department</p>
              <p style={{ marginBottom: "2px", color: "#6b7280" }}>MHIL (Margalla Heavy Industries Limited)</p>
              <p style={{ color: "#6b7280" }}>Taxila, Pakistan</p>
            </div>

            <div style={{ borderTop: "1px solid #e8eaef", marginTop: "16px", paddingTop: "8px", color: "#9ca3af", fontSize: "10px" }}>
              Generated {today}
            </div>
          </div>
        </div>

        <div style={{ color: "#c0c5d0", fontSize: "10px", letterSpacing: "0.05em", marginTop: "16px", textAlign: "center" }}>
          AIMS Recoil Calculator · Carlucci & Jacobson 3rd Ed. · AMCP 706-342 · Rheinmetall Handbook
        </div>
      </div>
    </div>
    </PasswordGate>
  );
}
