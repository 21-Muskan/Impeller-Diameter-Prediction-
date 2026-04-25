import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatApiError,
  getHealth,
  getOptions,
  postDatasetMatches,
  postPredict,
} from "./api.js";

const SPEEDS = [1450, 2900, 3000];

// ─── Validation rules ────────────────────────────────────────────────────────

const RULES = {
  pumpType: (v) => (!v ? "Select a pump type." : null),
  chambers: (v) => {
    const n = num(v);
    if (v === "" || v === null) return "Number of chambers is required.";
    if (isNaN(n) || !Number.isInteger(n)) return "Chambers must be a whole number.";
    if (n < 1) return "At least 1 chamber required.";
    if (n > 50) return "Chambers seems unusually high (> 50). Please verify.";
    return null;
  },
  headPerChamber: (v) => {
    const n = num(v);
    if (v === "" || v === null) return "Head per chamber is required.";
    if (isNaN(n)) return "Enter a valid number.";
    if (n <= 0) return "Must be greater than 0.";
    if (n > 500) return "Head per chamber > 500 m seems unusually high. Please verify.";
    return null;
  },
  flow: (v) => {
    const n = num(v);
    if (v === "" || v === null) return "Flow is required.";
    if (isNaN(n)) return "Enter a valid number.";
    if (n <= 0) return "Flow must be greater than 0.";
    if (n > 10000) return "Flow > 10,000 m³/h seems unusually high. Please verify.";
    return null;
  },
  totalHead: (v) => {
    const n = num(v);
    if (v === "" || v === null) return "Total head is required.";
    if (isNaN(n)) return "Enter a valid number.";
    if (n <= 0) return "Total head must be greater than 0.";
    if (n > 10000) return "Total head > 10,000 m seems unusually high. Please verify.";
    return null;
  },
  speed: (v) => {
    const n = num(v);
    if (v === "" || v === null) return "Speed is required.";
    if (isNaN(n)) return "Enter a valid number.";
    if (n <= 0) return "Speed must be greater than 0.";
    if (n < 100) return "Speed < 100 RPM is unusually low. Please verify.";
    if (n > 10000) return "Speed > 10,000 RPM is unusually high. Please verify.";
    return null;
  },
  efficiency: (v) => {
    const n = num(v);
    if (v === "" || v === null) return "Efficiency is required.";
    if (isNaN(n)) return "Enter a valid number.";
    if (n <= 0) return "Efficiency must be greater than 0%.";
    if (n > 100) return "Efficiency cannot exceed 100%.";
    if (n < 10) return "Efficiency < 10% is unusually low. Please verify.";
    if (n > 95) return "Efficiency > 95% is unusually high. Please verify.";
    return null;
  },
  pumpPower: (v) => {
    if (v === "" || v === null) return null; // optional
    const n = num(v);
    if (isNaN(n)) return "Enter a valid number or leave empty.";
    if (n <= 0) return "Pump power must be greater than 0 if specified.";
    if (n > 100000) return "Pump power > 100,000 kW is unusually high. Please verify.";
    return null;
  },
};

// Cross-field: head consistency warning (not a hard error)
const crossValidate = (headPerChamber, chambers, totalHead) => {
  const hpc = num(headPerChamber);
  const ch = num(chambers);
  const th = num(totalHead);
  if (!isNaN(hpc) && !isNaN(ch) && !isNaN(th) && hpc > 0 && ch > 0 && th > 0) {
    const expected = hpc * ch;
    const tolerance = expected * 0.15; // ±15%
    if (Math.abs(th - expected) > tolerance) {
      return `Total head (${th} m) differs from head/chamber × chambers (${expected.toFixed(1)} m) by more than 15%. Please verify.`;
    }
  }
  return null;
};

const num = (v) => {
  const x = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : NaN;
};

// ─── Small UI helpers ─────────────────────────────────────────────────────────

function FieldError({ msg }) {
  if (!msg) return null;
  const isWarning = msg.includes("verify") || msg.includes("unusually");
  return (
    <span className={`field-error ${isWarning ? "warning" : ""}`} role="alert">
      {isWarning ? "⚠ " : "✕ "}
      {msg}
    </span>
  );
}

function Field({ label, hint, children, error }) {
  return (
    <label className={`field ${error ? (error.includes("verify") || error.includes("unusually") ? "field-warn" : "field-invalid") : ""}`}>
      <span className="field-label">
        {label}
        {hint ? <span className="field-hint">{hint}</span> : null}
      </span>
      {children}
      <FieldError msg={error} />
    </label>
  );
}

function Section({ icon, title, tint, children }) {
  return (
    <section className={`form-section tint-${tint}`}>
      <h3 className="section-title">
        <span className="section-icon" aria-hidden>
          {icon}
        </span>
        {title}
      </h3>
      <div className="section-grid">{children}</div>
    </section>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [health, setHealth] = useState(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState(null);
  const [pumpTypes, setPumpTypes] = useState([]);
  const [impellerMocs, setImpellerMocs] = useState([]);
  const [diffuserMocs, setDiffuserMocs] = useState([]);
  const [specials, setSpecials] = useState([]);

  const [pumpType, setPumpType] = useState("");
  const [headPerChamber, setHeadPerChamber] = useState("");
  const [chambers, setChambers] = useState("");
  const [flow, setFlow] = useState("");
  const [totalHead, setTotalHead] = useState("");
  const [speed, setSpeed] = useState("");
  const [efficiency, setEfficiency] = useState("");
  const [pumpPower, setPumpPower] = useState("");
  const [special, setSpecial] = useState("NONE");

  // Track which fields have been touched (blurred) for progressive validation
  const [touched, setTouched] = useState({});

  const touch = (field) => setTouched((prev) => ({ ...prev, [field]: true }));
  const touchAll = () =>
    setTouched({
      pumpType: true, chambers: true, headPerChamber: true,
      flow: true, totalHead: true, speed: true, efficiency: true, pumpPower: true,
    });

  const [impellerFirst, setImpellerFirst] = useState("");
  const [impellerConfirm, setImpellerConfirm] = useState("");
  const [impellerLocked, setImpellerLocked] = useState(false);

  const [diffuserFirst, setDiffuserFirst] = useState("");
  const [diffuserConfirm, setDiffuserConfirm] = useState("");
  const [diffuserLocked, setDiffuserLocked] = useState(false);

  const [mocError, setMocError] = useState(null);
  const [predictLoading, setPredictLoading] = useState(false);
  const [predictError, setPredictError] = useState(null);
  const [result, setResult] = useState(null);

  const [datasetLoading, setDatasetLoading] = useState(false);
  const [datasetError, setDatasetError] = useState(null);
  const [datasetRows, setDatasetRows] = useState(null);

  // ── Field-level errors (computed live) ──────────────────────────────────────
  const fieldErrors = useMemo(() => ({
    pumpType:       RULES.pumpType(pumpType),
    chambers:       RULES.chambers(chambers),
    headPerChamber: RULES.headPerChamber(headPerChamber),
    flow:           RULES.flow(flow),
    totalHead:      RULES.totalHead(totalHead),
    speed:          RULES.speed(speed),
    efficiency:     RULES.efficiency(efficiency),
    pumpPower:      RULES.pumpPower(pumpPower),
  }), [pumpType, chambers, headPerChamber, flow, totalHead, speed, efficiency, pumpPower]);

  const crossWarn = useMemo(
    () => crossValidate(headPerChamber, chambers, totalHead),
    [headPerChamber, chambers, totalHead]
  );

  const hasErrors = Object.values(fieldErrors).some(Boolean);

  // Visible error = only if field touched or submit attempted
  const visibleError = (field) =>
    touched[field] ? fieldErrors[field] : null;

  // ── Health polling ───────────────────────────────────────────────────────────
  const refreshHealth = useCallback(async () => {
    const { ok, data } = await getHealth();
    if (ok) setHealth(data);
    else setHealth({ status: "error", model_message: formatApiError(data) });
  }, []);
// ─── Full diameter mapping ────────────────────────────────────────────────────
const FULL_DIAMETER_MAP = {
  "RN 80":  216,
  "RN 100": 250,
  "RN 32":  140,
  "RN 125" :300,
  "RN 100A":280,
  "RN 40" :135,
  "RN 65":200,
  "RN 50A":160,
  "RN 50":160,
  "RN 125A":300,
  "RN 150A" :354, 
  // add more mappings here
};

const getFullDiameter = (pumpType) => {
  if (!pumpType) return null;
  // Try exact match first, then try matching the start of the pump type string
  if (FULL_DIAMETER_MAP[pumpType] != null) return FULL_DIAMETER_MAP[pumpType];
  const key = Object.keys(FULL_DIAMETER_MAP).find((k) => pumpType.startsWith(k));
  return key ? FULL_DIAMETER_MAP[key] : null;
};
  useEffect(() => {
    refreshHealth();
    const id = setInterval(refreshHealth, 30000);
    return () => clearInterval(id);
  }, [refreshHealth]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setOptionsLoading(true);
      setOptionsError(null);
      const { ok, data } = await getOptions();
      if (cancelled) return;
      if (!ok) {
        setOptionsError(formatApiError(data));
        setOptionsLoading(false);
        return;
      }
      const o = data.options || {};
      setPumpTypes(o.Pump_Type || []);
      setImpellerMocs(o.Impeller_MOC || []);
      setDiffuserMocs(o.Diffuser_MOC || []);
      setSpecials(o.Special_Instruction || []);
      setOptionsLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // ── MOC validation ────────────────────────────────────────────────────────────
  const validateMoc = useCallback(() => {
    if (!impellerFirst) {
      setMocError("Select an Impeller MOC material.");
      return false;
    }
    if (!impellerLocked) {
      setMocError("Lock the Impeller MOC before predicting.");
      return false;
    }
    if (!impellerConfirm) {
      setMocError("Confirm the Impeller MOC by selecting it again.");
      return false;
    }
    if (impellerFirst !== impellerConfirm) {
      setMocError("Impeller MOC confirmation does not match the first selection.");
      return false;
    }
    if (!diffuserFirst) {
      setMocError("Select a Diffuser MOC material.");
      return false;
    }
    if (!diffuserLocked) {
      setMocError("Lock the Diffuser MOC before predicting.");
      return false;
    }
    if (!diffuserConfirm) {
      setMocError("Confirm the Diffuser MOC by selecting it again.");
      return false;
    }
    if (diffuserFirst !== diffuserConfirm) {
      setMocError("Diffuser MOC confirmation does not match the first selection.");
      return false;
    }
    setMocError(null);
    return true;
  }, [impellerLocked, diffuserLocked, impellerFirst, impellerConfirm, diffuserFirst, diffuserConfirm]);

  // ── Build payload ─────────────────────────────────────────────────────────────
  const buildPayload = useCallback(() => ({
    pump_type: pumpType,
    impeller_moc: impellerFirst,
    impeller_moc_confirm: impellerConfirm,
    diffuser_moc: diffuserFirst,
    diffuser_moc_confirm: diffuserConfirm,
    special_instruction: special || "NONE",
    head_per_chamber: num(headPerChamber),
    number_of_chambers: num(chambers),
    speed_rpm: num(speed),
    flow_m3h: num(flow),
    pump_efficiency: num(efficiency),
    total_head: num(totalHead),
    pump_power_kw: pumpPower.trim() === "" ? null : num(pumpPower),
  }), [pumpType, impellerFirst, impellerConfirm, diffuserFirst, diffuserConfirm,
       special, headPerChamber, chambers, flow, totalHead, speed, efficiency, pumpPower]);

  // ── Submit ────────────────────────────────────────────────────────────────────
  const handlePredict = async (e) => {
    e.preventDefault();
    touchAll();
    setPredictError(null);
    setResult(null);

    if (hasErrors) {
      setPredictError("Please fix the highlighted errors before predicting.");
      return;
    }
    if (!validateMoc()) return;

    const p = buildPayload();
    setPredictLoading(true);
    try {
      const { ok, data } = await postPredict({ ...p });
      if (!ok) { setPredictError(formatApiError(data)); return; }
      setResult(data);
    } catch (err) {
      setPredictError(err?.message || String(err));
    } finally {
      setPredictLoading(false);
    }
  };

  // ── Dataset lookup ────────────────────────────────────────────────────────────
  const handleDatasetLookup = async () => {
    touchAll();
    setDatasetError(null);
    setDatasetRows(null);
    if (!validateMoc()) return;
    const p = buildPayload();
    if (isNaN(p.head_per_chamber) || isNaN(p.flow_m3h) || isNaN(p.total_head)) {
      setDatasetError("Fill numeric operating fields before searching the dataset.");
      return;
    }
    setDatasetLoading(true);
    try {
      const { ok, data } = await postDatasetMatches({
        ...p,
        match_mode: "similarity",
        min_numeric_match_percent: 90,
      });
      if (!ok) { setDatasetError(formatApiError(data)); return; }
      setDatasetRows(data);
    } catch (err) {
      setDatasetError(err?.message || String(err));
    } finally {
      setDatasetLoading(false);
    }
  };

  // ── Table ────────────────────────────────────────────────────────────────────
  const tableColumns = useMemo(() => {
    if (!datasetRows?.rows?.length) return [];
    const keys = Object.keys(datasetRows.rows[0]);
    const priority = ["numeric_match_percent", "numeric_match_by_column"];
    const rest = keys.filter((k) => !priority.includes(k));
    return [...priority.filter((k) => keys.includes(k)), ...rest];
  }, [datasetRows]);

  const formatNumericBreakdown = (obj) => {
    if (!obj || typeof obj !== "object") return "—";
    return Object.entries(obj).map(([k, v]) => `${k}: ${v}%`).join(" · ");
  };

  // ── Health badge ─────────────────────────────────────────────────────────────
  const healthBadge = () => {
    if (!health) return { text: "Checking API…", className: "badge neutral" };
    if (health.model_loaded) return { text: "Model ready", className: "badge ok" };
    return { text: "Model unavailable", className: "badge warn" };
  };
  const hb = healthBadge();

  // ── MOC step indicator ────────────────────────────────────────────────────────
  const impellerStep = !impellerFirst ? 1 : !impellerLocked ? 2 : !impellerConfirm ? 3 : impellerFirst !== impellerConfirm ? "err" : "done";
  const diffuserStep  = !diffuserFirst  ? 1 : !diffuserLocked  ? 2 : !diffuserConfirm  ? 3 : diffuserFirst  !== diffuserConfirm  ? "err" : "done";

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="page">
      <header className="hero">
        <div className="hero-inner">
          <p className="eyebrow">Wilo · ML-assisted design</p>
          <h1>Pump impeller diameter</h1>
          <p className="sub">
            Predict full and trimmed impeller diameters from your operating case.
            Material selections are confirmed twice before prediction.
          </p>
          <div className="hero-badges">
            <span className={hb.className}>{hb.text}</span>
            {health?.dataset_loaded ? (
              <span className="badge ok">Dataset loaded</span>
            ) : (
              <span className="badge neutral" title={health?.dataset_message || ""}>
                Dataset optional
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="layout">
        <form className="card form-card" onSubmit={handlePredict} noValidate>
          <div className="card-head">
            <h2>Pump design inputs</h2>
            {optionsLoading ? (
              <p className="muted">Loading categories…</p>
            ) : optionsError ? (
              <p className="error-inline">{optionsError}</p>
            ) : null}
          </div>

          {/* ── Configuration ── */}
          <Section icon="⚙" title="Configuration" tint="blue">
            <Field label="Pump type" error={visibleError("pumpType")}>
              <select
                value={pumpType}
                onChange={(e) => { setPumpType(e.target.value); touch("pumpType"); }}
                onBlur={() => touch("pumpType")}
                disabled={!!optionsError || pumpTypes.length === 0}
                className={visibleError("pumpType") ? "input-error" : ""}
              >
                <option value="">Select pump type</option>
                {pumpTypes.map((x) => (
                  <option key={x} value={x}>{x}</option>
                ))}
              </select>
            </Field>

            <Field label="Chambers" error={visibleError("chambers")}>
              <input
                type="number"
                min={1}
                step={1}
                value={chambers}
                onChange={(e) => setChambers(e.target.value)}
                onBlur={() => touch("chambers")}
                placeholder="e.g. 10"
                className={visibleError("chambers") ? "input-error" : ""}
              />
            </Field>

            <Field label="Head per chamber (m)" error={visibleError("headPerChamber")}>
              <input
                type="number"
                min={0}
                step="any"
                value={headPerChamber}
                onChange={(e) => setHeadPerChamber(e.target.value)}
                onBlur={() => touch("headPerChamber")}
                placeholder="m"
                className={visibleError("headPerChamber") ? "input-error" : ""}
              />
            </Field>
          </Section>

          {/* ── Operating conditions ── */}
          <Section icon="◎" title="Operating conditions" tint="green">
            <Field label="Flow (m³/h)" error={visibleError("flow")}>
              <input
                type="number"
                min={0}
                step="any"
                value={flow}
                onChange={(e) => setFlow(e.target.value)}
                onBlur={() => touch("flow")}
                className={visibleError("flow") ? "input-error" : ""}
              />
            </Field>

            <Field
              label="Total head (m)"
              error={visibleError("totalHead") || (touched.totalHead && touched.headPerChamber && touched.chambers ? crossWarn : null)}
            >
              <input
                type="number"
                min={0}
                step="any"
                value={totalHead}
                onChange={(e) => setTotalHead(e.target.value)}
                onBlur={() => touch("totalHead")}
                className={
                  visibleError("totalHead") ? "input-error"
                  : (touched.totalHead && touched.headPerChamber && touched.chambers && crossWarn) ? "input-warn"
                  : ""
                }
              />
            </Field>

            <Field label="Speed (RPM)" error={visibleError("speed")}>
              <div className="speed-row">
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={speed}
                  onChange={(e) => setSpeed(e.target.value)}
                  onBlur={() => touch("speed")}
                  className={visibleError("speed") ? "input-error" : ""}
                />
                <div className="pill-group" role="group" aria-label="Common speeds">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`pill ${num(speed) === s ? "pill-active" : ""}`}
                      onClick={() => { setSpeed(String(s)); touch("speed"); }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </Field>

            <Field label="Pump efficiency (%)" error={visibleError("efficiency")}>
              <div className="input-with-indicator">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  value={efficiency}
                  onChange={(e) => setEfficiency(e.target.value)}
                  onBlur={() => touch("efficiency")}
                  className={visibleError("efficiency") ? "input-error" : ""}
                />
                {efficiency !== "" && !isNaN(num(efficiency)) && !fieldErrors.efficiency && (
                  <div className="efficiency-bar">
                    <div
                      className="efficiency-fill"
                      style={{ width: `${Math.min(num(efficiency), 100)}%` }}
                    />
                  </div>
                )}
              </div>
            </Field>

            <Field label="Pump power (kW)" hint="Optional — estimated from duty if empty" error={visibleError("pumpPower")}>
              <input
                type="number"
                min={0}
                step="any"
                value={pumpPower}
                onChange={(e) => setPumpPower(e.target.value)}
                onBlur={() => touch("pumpPower")}
                placeholder="Auto from flow, head, η if empty"
                className={visibleError("pumpPower") ? "input-error" : ""}
              />
            </Field>
          </Section>

          {/* ── Material of construction ── */}
          <Section icon="◆" title="Material of construction" tint="purple">
            <div className="moc-block full-span">
              <p className="moc-help">
                Select each material once, then <strong>confirm</strong> with a second matching
                selection. The first dropdown is hidden after you lock your choice.
              </p>

              {/* Impeller */}
              <div className={`moc-pair ${impellerStep === "done" ? "moc-done" : impellerStep === "err" ? "moc-err" : ""}`}>
                <div className="moc-pair-header">
                  <span className="moc-label">Impeller MOC</span>
                  <MocStepBadge step={impellerStep} />
                </div>

                {!impellerLocked ? (
                  <select
                    value={impellerFirst}
                    onChange={(e) => { setImpellerFirst(e.target.value); setImpellerConfirm(""); }}
                    className="moc-first"
                  >
                    <option value="">Choose impeller material</option>
                    {impellerMocs.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                ) : (
                  <div className="moc-locked">
                    <span className="moc-chip">{impellerFirst}</span>
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => { setImpellerLocked(false); setImpellerConfirm(""); }}
                    >
                      Change
                    </button>
                  </div>
                )}

                {impellerFirst && !impellerLocked ? (
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={() => setImpellerLocked(true)}
                  >
                    Lock choice
                  </button>
                ) : null}

                {impellerLocked ? (
                  <>
                    <select
                      value={impellerConfirm}
                      onChange={(e) => setImpellerConfirm(e.target.value)}
                      className={
                        impellerConfirm && impellerConfirm !== impellerFirst ? "mismatch" : ""
                      }
                    >
                      <option value="">Confirm impeller MOC (must match)</option>
                      {impellerMocs.map((x) => <option key={x} value={x}>{x}</option>)}
                    </select>
                    {impellerConfirm && impellerConfirm !== impellerFirst && (
                      <span className="field-error">
                        ✕ Does not match "{impellerFirst}". Select the same material.
                      </span>
                    )}
                    {impellerConfirm && impellerConfirm === impellerFirst && (
                      <span className="moc-match-ok">✓ Confirmed</span>
                    )}
                  </>
                ) : null}
              </div>

              {/* Diffuser */}
              <div className={`moc-pair ${diffuserStep === "done" ? "moc-done" : diffuserStep === "err" ? "moc-err" : ""}`}>
                <div className="moc-pair-header">
                  <span className="moc-label">Diffuser MOC</span>
                  <MocStepBadge step={diffuserStep} />
                </div>

                {!diffuserLocked ? (
                  <select
                    value={diffuserFirst}
                    onChange={(e) => { setDiffuserFirst(e.target.value); setDiffuserConfirm(""); }}
                    className="moc-first"
                  >
                    <option value="">Choose diffuser material</option>
                    {diffuserMocs.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                ) : (
                  <div className="moc-locked">
                    <span className="moc-chip">{diffuserFirst}</span>
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => { setDiffuserLocked(false); setDiffuserConfirm(""); }}
                    >
                      Change
                    </button>
                  </div>
                )}

                {diffuserFirst && !diffuserLocked ? (
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={() => setDiffuserLocked(true)}
                  >
                    Lock choice
                  </button>
                ) : null}

                {diffuserLocked ? (
                  <>
                    <select
                      value={diffuserConfirm}
                      onChange={(e) => setDiffuserConfirm(e.target.value)}
                      className={
                        diffuserConfirm && diffuserConfirm !== diffuserFirst ? "mismatch" : ""
                      }
                    >
                      <option value="">Confirm diffuser MOC (must match)</option>
                      {diffuserMocs.map((x) => <option key={x} value={x}>{x}</option>)}
                    </select>
                    {diffuserConfirm && diffuserConfirm !== diffuserFirst && (
                      <span className="field-error">
                        ✕ Does not match "{diffuserFirst}". Select the same material.
                      </span>
                    )}
                    {diffuserConfirm && diffuserConfirm === diffuserFirst && (
                      <span className="moc-match-ok">✓ Confirmed</span>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          </Section>

          {/* ── Special instruction ── */}
          <Section icon="✦" title="Special instruction" tint="amber">
            <Field label="Special instruction" hint="Use NONE when not applicable">
              <select
                value={special}
                onChange={(e) => setSpecial(e.target.value)}
                disabled={specials.length === 0}
              >
                {specials.length === 0 ? (
                  <option value="NONE">NONE</option>
                ) : (
                  specials.map((x) => <option key={x} value={x}>{x}</option>)
                )}
              </select>
            </Field>
          </Section>

          {/* ── Cross-field warning ── */}
          {crossWarn && touched.totalHead && touched.headPerChamber && touched.chambers && (
            <div className="form-warning" role="alert">⚠ {crossWarn}</div>
          )}

          {mocError ? <p className="form-error">{mocError}</p> : null}
          {predictError ? <p className="form-error">{predictError}</p> : null}

          <div className="form-actions">
            <button
              type="submit"
              className="btn primary"
              disabled={predictLoading || !!optionsError}
            >
              {predictLoading ? "Predicting…" : "Predict design"}
            </button>
          </div>
        </form>

        {/* ── Results ── */}
        <aside className="card results-card">
          <h2>Predicted diameters</h2>
          {!result && !predictLoading ? (
            <p className="muted">
              Submit the form to see <strong>full</strong> and <strong>trimmed</strong> impeller
              diameters (mm).
            </p>
          ) : null}
          {predictLoading ? <p className="muted">Running pipeline…</p> : null}
          {/* {result ? (
            <>
              <div className="result-hero">
                <div className="result-big">
                  <span className="result-label">Full diameter</span>
                  <span className="result-value">{result.full_diameter_mm.toFixed(2)} mm</span>
                </div>
                <div className="result-big secondary">
                  <span className="result-label">Trimmed diameter</span>
                  <span className="result-value">{result.trimmed_diameter_mm.toFixed(2)} mm</span>
                </div>
              </div>
              <div className="result-meta">
                <div>
                  <span className="meta-k">Pump power used</span>
                  <span className="meta-v">{result.pump_power_used_kw.toFixed(3)} kW</span>
                </div>
                {result.pump_power_was_estimated ? (
                  <p className="note">{result.message}</p>
                ) : null}
              </div>
            </>
          ) : null} */}
        {result ? (
  <>
    <div className="result-hero">
      {(() => {
        const fullDia = getFullDiameter(pumpType);
        return (
          <>
            <div className="result-big">
              <span className="result-label">Full diameter</span>
              {fullDia != null ? (
                <span className="result-value">{fullDia} mm</span>
              ) : (
                <span className="result-value muted" style={{ fontSize: "0.9em" }}>
                  — (no mapping for "{pumpType}")
                </span>
              )}
            </div>
            <div className="result-big secondary">
              <span className="result-label">Trimmed diameter</span>
              <span className="result-value">{result.trimmed_diameter_mm.toFixed(2)} mm</span>
            </div>
          </>
        );
      })()}
    </div>
    <div className="result-meta">
      <div>
        <span className="meta-k">Pump power used</span>
        <span className="meta-v">{result.pump_power_used_kw.toFixed(3)} kW</span>
      </div>
      {result.pump_power_was_estimated ? (
        <p className="note">{result.message}</p>
      ) : null}
    </div>
  </>
) : null}
          {/* ── Dataset ── */}
          <div className="dataset-block">
            <h3>Dataset reference</h3>
            <p className="muted small">
              Rows from <code>Impeller_Dataset.xlsx</code>: exact match on pump type and both MOCs
              (and special instruction); numeric fields use mean similarity ≥ 90% vs your inputs.
              Requires the Excel file beside the API.
            </p>
            <button
              type="button"
              className="btn secondary"
              onClick={handleDatasetLookup}
              disabled={datasetLoading}
            >
              {datasetLoading ? "Searching…" : "Find matching rows"}
            </button>
            {datasetError ? <p className="form-error">{datasetError}</p> : null}
            {datasetRows ? (
              <>
                <p className="muted small">
                  {datasetRows.count} match{datasetRows.count === 1 ? "" : "es"}
                  {datasetRows.truncated ? " (showing first 200)" : ""}
                  {datasetRows.min_numeric_match_percent != null ? (
                    <> · threshold: mean numeric ≥ {datasetRows.min_numeric_match_percent}%</>
                  ) : null}
                </p>
                {datasetRows.rows?.length ? (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          {tableColumns.map((c) => (
                            <th key={c}>
                              {c === "numeric_match_percent"
                                ? "Match % (mean)"
                                : c === "numeric_match_by_column"
                                ? "Per-column %"
                                : c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {datasetRows.rows.map((row, i) => (
                          <tr key={i}>
                            {tableColumns.map((c) => (
                              <td
                                key={c}
                                title={
                                  c === "numeric_match_percent" && row.numeric_match_by_column
                                    ? formatNumericBreakdown(row.numeric_match_by_column)
                                    : undefined
                                }
                              >
                                {c === "numeric_match_by_column"
                                  ? formatNumericBreakdown(row[c])
                                  : c === "numeric_match_percent" && row[c] != null
                                  ? `${row[c]}%`
                                  : row[c] == null
                                  ? "—"
                                  : String(row[c])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted">No matching rows for this input set.</p>
                )}
              </>
            ) : null}
          </div>
        </aside>
      </main>

      <footer className="footer">
        <p>
          Backend: FastAPI + scikit-learn pipeline · Frontend: React · Place{" "}
          <code>pump_pipeline_v3.pkl</code> in <code>backend/models/</code>
        </p>
      </footer>
    </div>
  );
}

// ─── MOC step badge ───────────────────────────────────────────────────────────
function MocStepBadge({ step }) {
  const map = {
    1: { label: "Step 1: Select", cls: "step-pending" },
    2: { label: "Step 2: Lock", cls: "step-pending" },
    3: { label: "Step 3: Confirm", cls: "step-pending" },
    err:  { label: "Mismatch", cls: "step-error" },
    done: { label: "✓ Verified", cls: "step-done" },
  };
  const { label, cls } = map[step] || map[1];
  return <span className={`moc-step-badge ${cls}`}>{label}</span>;
}