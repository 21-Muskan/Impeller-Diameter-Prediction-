"""
Business logic and ML artifact management for the Pump Impeller Prediction API.

This module is a direct port of the helper functions from the FastAPI ``main.py``.
All algorithms, column names, and caching behaviour are preserved unchanged.

Only one artifact is required:
    pump_pipeline_v3.pkl — sklearn Pipeline (preprocessor + model), saved with joblib.

Feature names and column order are read from the fitted ColumnTransformer inside
that pipeline (same information the old model_config_v3.pkl duplicated).

Optional: Impeller_Dataset.xlsx at DATASET_PATH for reference row lookup.
"""

from __future__ import annotations

import os
import pickle
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Scikit-Learn Compatibility Shim
# ---------------------------------------------------------------------------
# The pipeline was exported with sklearn 1.5.1, which used _RemainderColsList.
# Newer versions of sklearn removed it, breaking unpickling. This shim patches
# the module so joblib.load can succeed on sklearn 1.8+.
try:
    import sklearn.compose._column_transformer as ct
    if not hasattr(ct, '_RemainderColsList'):
        class _RemainderColsList(list):
            pass
        ct._RemainderColsList = _RemainderColsList
except ImportError:
    pass

# ---------------------------------------------------------------------------
# Paths — identical logic to the original FastAPI main.py
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_DIR = Path(os.environ.get("MODEL_DIR", str(BASE_DIR / "models")))
PIPELINE_PATH = Path(
    os.environ.get("PIPELINE_FILE", str(MODEL_DIR / "pump_pipeline_v3.pkl"))
)
DATASET_PATH = Path(
    os.environ.get(
        "DATASET_PATH",
        str(BASE_DIR.parent / "Impeller_Dataset.xlsx"),
    )
)

# ---------------------------------------------------------------------------
# Module-level caches (same as the FastAPI global variables)
# ---------------------------------------------------------------------------
_pipeline: Any = None
_feature_meta: dict[str, Any] | None = None
_dataset_df: pd.DataFrame | None = None
_dataset_load_error: str | None = None

# ---------------------------------------------------------------------------
# Numeric columns used for dataset matching
# ---------------------------------------------------------------------------
NUMERIC_MATCH_COLUMNS = [
    "Head_per_Chamber",
    "Number_of_Chambers",
    "Speed_RPM",
    "Flow_m3h",
    "Pump_Efficiency",
    "Total_Head",
    "Pump_Power",
]


# ---------------------------------------------------------------------------
# Pipeline introspection helpers
# ---------------------------------------------------------------------------
def _find_column_transformer(pipeline: Any) -> Any:
    """Locate the sklearn ColumnTransformer used as preprocessing."""
    if not hasattr(pipeline, "named_steps"):
        raise ValueError("Loaded object is not a sklearn Pipeline.")
    for name in ("preprocessor", "prep", "column_transformer", "transformer"):
        step = pipeline.named_steps.get(name)
        if step is not None and hasattr(step, "transformers_"):
            return step
    for _, step in pipeline.named_steps.items():
        if hasattr(step, "transformers_") and hasattr(step, "named_transformers_"):
            return step
    raise ValueError(
        "Could not find a ColumnTransformer (no step with transformers_). "
        "Expected a step named 'preprocessor' or similar."
    )


def derive_feature_layout(pipeline: Any) -> dict[str, Any]:
    """
    Reconstruct feature lists from the fitted pipeline (matches training notebook:
    categoricals first in the input DataFrame, then numerics).
    """
    ct = _find_column_transformer(pipeline)
    cat_cols: list[str] = []
    num_cols: list[str] = []

    for name, _trans, cols in ct.transformers_:
        if name == "remainder" or cols is None:
            continue
        cols_list = list(cols)
        if name == "cat":
            cat_cols = cols_list
        elif name == "num":
            num_cols = cols_list

    if not cat_cols and not num_cols:
        raise ValueError(
            "ColumnTransformer has no 'cat' / 'num' branches with column names. "
            "Check that the saved pipeline matches the v3 notebook structure."
        )

    all_input = cat_cols + num_cols
    return {
        "categorical_features": cat_cols,
        "numeric_features": num_cols,
        "all_input_features": all_input,
        # Targets are not stored on the regressor; names match the training notebook.
        "target_columns": ["Full_Diameter", "Trimmed_Diameter"],
    }


def extract_categorical_options(
    pipeline: Any, categorical_features: list[str]
) -> dict[str, list[str]]:
    """Read OrdinalEncoder category lists from the fitted preprocessing step."""
    try:
        ct = _find_column_transformer(pipeline)
        enc = ct.named_transformers_.get("cat")
        if enc is None or not hasattr(enc, "categories_"):
            return {c: [] for c in categorical_features}
        out: dict[str, list[str]] = {}
        for i, col in enumerate(categorical_features):
            if i >= len(enc.categories_):
                out[col] = []
                continue
            cats = enc.categories_[i]
            out[col] = [str(x) for x in cats]
        return out
    except Exception:
        return {c: [] for c in categorical_features}


# ---------------------------------------------------------------------------
# Artifact & dataset loading
# ---------------------------------------------------------------------------
def load_artifacts() -> tuple[Any, dict[str, Any]]:
    global _pipeline, _feature_meta
    if _pipeline is not None and _feature_meta is not None:
        return _pipeline, _feature_meta
    if not PIPELINE_PATH.is_file():
        raise FileNotFoundError(
            f"Missing pipeline file: {PIPELINE_PATH}. "
            "Copy pump_pipeline_v3.pkl into backend 2/models/ (or set PIPELINE_FILE)."
        )
    _pickle_version_hint = (
        " Joblib/sklearn pickles are not portable across sklearn versions. "
        "From the backend 2 folder run: pip install -r requirements.txt "
        "(pins scikit-learn to the training version), or re-export the model "
        "using the same sklearn you have in production."
    )
    try:
        loaded = joblib.load(PIPELINE_PATH)
    except (AttributeError, ModuleNotFoundError, pickle.UnpicklingError) as e:
        raise RuntimeError(
            f"Failed to load pipeline pickle ({type(e).__name__}: {e}).{_pickle_version_hint}"
        ) from e
    except Exception as e:
        if "_RemainderColsList" in str(e) or "Can't get attribute" in str(e):
            raise RuntimeError(
                f"Failed to load pipeline pickle ({type(e).__name__}: {e}).{_pickle_version_hint}"
            ) from e
        raise
    _feature_meta = derive_feature_layout(loaded)
    _pipeline = loaded
    return _pipeline, _feature_meta


def load_dataset() -> None:
    global _dataset_df, _dataset_load_error
    if _dataset_df is not None or _dataset_load_error is not None:
        return
    if not DATASET_PATH.is_file():
        _dataset_load_error = f"No dataset file at {DATASET_PATH}"
        return
    try:
        df = pd.read_excel(DATASET_PATH)
        if "Special_Instruction" in df.columns:
            df["Special_Instruction"] = df["Special_Instruction"].fillna("NONE")
        _dataset_df = df
    except Exception as e:
        _dataset_load_error = str(e)


def get_dataset_df() -> pd.DataFrame | None:
    """Accessor so views can read the cached dataset."""
    return _dataset_df


def get_dataset_load_error() -> str | None:
    """Accessor for dataset loading error message."""
    return _dataset_load_error


# ---------------------------------------------------------------------------
# Utility calculations
# ---------------------------------------------------------------------------
def estimate_pump_power_kw(
    flow_m3h: float, total_head_m: float, pump_efficiency_pct: float
) -> float:
    """Hydraulic power / efficiency as a kW estimate when shaft power is unknown."""
    if pump_efficiency_pct <= 0:
        raise ValueError("Pump efficiency must be positive.")
    q_m3s = flow_m3h / 3600.0
    p_hyd_kw = 1000.0 * 9.81 * q_m3s * total_head_m / 1000.0
    return float(p_hyd_kw / (pump_efficiency_pct / 100.0))


# ---------------------------------------------------------------------------
# Dataset matching helpers
# ---------------------------------------------------------------------------
def numeric_pair_similarity_percent(ref: float, val: float) -> float:
    """
    Single-column similarity in [0, 100]: 100 = identical.
    Uses relative error: similarity = 100 * (1 - min(1, |a-b| / max(|a|,|b|, eps))).
    """
    ref = float(ref)
    val = float(val)
    if np.isnan(ref) or np.isnan(val):
        return 0.0
    if ref == val:
        return 100.0
    denom = max(abs(ref), abs(val), 1e-12)
    rel_err = abs(ref - val) / denom
    rel_err = min(1.0, rel_err)
    return float(100.0 * (1.0 - rel_err))


def exact_categorical_mask(df: pd.DataFrame, pump_type: str, impeller_moc: str,
                           diffuser_moc: str, special_instruction: str) -> pd.Series:
    """Exact string match on pump type, both MOCs, and special instruction."""
    mask = (
        (df["Pump_Type"].astype(str) == str(pump_type))
        & (df["Impeller_MOC"].astype(str) == str(impeller_moc))
        & (df["Diffuser_MOC"].astype(str) == str(diffuser_moc))
    )
    if "Special_Instruction" in df.columns:
        mask = mask & (
            df["Special_Instruction"].fillna("NONE").astype(str)
            == str(special_instruction)
        )
    return mask


def numeric_refs_for_match(data: dict) -> dict[str, float]:
    return {
        "Head_per_Chamber": float(data["head_per_chamber"]),
        "Number_of_Chambers": float(data["number_of_chambers"]),
        "Speed_RPM": float(data["speed_rpm"]),
        "Flow_m3h": float(data["flow_m3h"]),
        "Pump_Efficiency": float(data["pump_efficiency"]),
        "Total_Head": float(data["total_head"]),
        "Pump_Power": float(data["pump_power_kw"]),
    }
