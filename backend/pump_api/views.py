"""
DRF function-based views — direct 1:1 port of the four FastAPI endpoints.

Endpoint mapping:
    GET  /api/health           →  health_view
    GET  /api/options          →  options_view
    POST /api/predict          →  predict_view
    POST /api/dataset-matches  →  dataset_matches_view

Response JSON structures are identical to the FastAPI versions.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import services
from .serializers import (
    DatasetMatchRequestSerializer,
    PredictRequestSerializer,
)


# --------------------------------------------------------------------------
# GET /api/health
# --------------------------------------------------------------------------
@api_view(["GET"])
def health_view(request):
    import sklearn

    try:
        services.load_artifacts()
        model_ok = True
        model_msg = "ready"
    except (FileNotFoundError, ValueError, OSError, RuntimeError) as e:
        model_ok = False
        model_msg = str(e)

    services.load_dataset()
    ds_ok = services.get_dataset_df() is not None

    return Response({
        "status": "ok" if model_ok else "degraded",
        "model_loaded": model_ok,
        "model_message": model_msg,
        "sklearn_version_runtime": sklearn.__version__,
        "config_source": "derived_from_pipeline",
        "dataset_loaded": ds_ok,
        "dataset_path": str(services.DATASET_PATH),
        "dataset_message": None if ds_ok else (services.get_dataset_load_error() or "not loaded"),
    })


# --------------------------------------------------------------------------
# GET /api/options
# --------------------------------------------------------------------------
@api_view(["GET"])
def options_view(request):
    try:
        pipeline, meta = services.load_artifacts()
    except (FileNotFoundError, ValueError, RuntimeError) as e:
        return Response(
            {"detail": str(e)},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    cats = meta.get("categorical_features", [])
    opts = services.extract_categorical_options(pipeline, cats)

    return Response({
        "categorical_features": meta.get("categorical_features", []),
        "numeric_features": meta.get("numeric_features", []),
        "target_columns": meta.get("target_columns", []),
        "options": {
            "Pump_Type": opts.get("Pump_Type", []),
            "Impeller_MOC": opts.get("Impeller_MOC", []),
            "Diffuser_MOC": opts.get("Diffuser_MOC", []),
            "Special_Instruction": opts.get("Special_Instruction", []),
        },
    })


# --------------------------------------------------------------------------
# POST /api/predict
# --------------------------------------------------------------------------
@api_view(["POST"])
def predict_view(request):
    serializer = PredictRequestSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(
            {"detail": _format_serializer_errors(serializer.errors)},
            status=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )

    data = serializer.validated_data

    try:
        pipeline, meta = services.load_artifacts()
    except (FileNotFoundError, ValueError, RuntimeError) as e:
        return Response(
            {"detail": str(e)},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    # MOC confirmation checks (same as FastAPI)
    if data["impeller_moc"] != data["impeller_moc_confirm"]:
        return Response(
            {"detail": "Impeller MOC confirmation does not match the first selection."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if data["diffuser_moc"] != data["diffuser_moc_confirm"]:
        return Response(
            {"detail": "Diffuser MOC confirmation does not match the first selection."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    power_estimated = False
    pump_power = data.get("pump_power_kw")
    if pump_power is None or pump_power <= 0:
        try:
            pump_power = services.estimate_pump_power_kw(
                data["flow_m3h"], data["total_head"], data["pump_efficiency"]
            )
            power_estimated = True
        except ValueError as e:
            return Response(
                {"detail": str(e)},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

    row = {
        "Pump_Type": data["pump_type"],
        "Impeller_MOC": data["impeller_moc"],
        "Diffuser_MOC": data["diffuser_moc"],
        "Special_Instruction": data["special_instruction"],
        "Head_per_Chamber": data["head_per_chamber"],
        "Number_of_Chambers": data["number_of_chambers"],
        "Speed_RPM": data["speed_rpm"],
        "Flow_m3h": data["flow_m3h"],
        "Pump_Efficiency": data["pump_efficiency"],
        "Total_Head": data["total_head"],
        "Pump_Power": pump_power,
    }
    order = meta["all_input_features"]
    try:
        X = pd.DataFrame([row])[order]
        pred = pipeline.predict(X)
    except Exception as e:
        return Response(
            {"detail": f"Prediction failed: {type(e).__name__}: {e}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    full_d = float(pred[0][0])
    trim_d = float(pred[0][1])
    msg = None
    if power_estimated:
        msg = "Pump power was estimated from flow, head, and efficiency (hydraulic power / efficiency)."

    return Response({
        "full_diameter_mm": full_d,
        "trimmed_diameter_mm": trim_d,
        "pump_power_used_kw": float(pump_power),
        "pump_power_was_estimated": power_estimated,
        "message": msg,
    })


# --------------------------------------------------------------------------
# POST /api/dataset-matches
# --------------------------------------------------------------------------
@api_view(["POST"])
def dataset_matches_view(request):
    serializer = DatasetMatchRequestSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(
            {"detail": _format_serializer_errors(serializer.errors)},
            status=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )

    data = serializer.validated_data

    services.load_dataset()
    df = services.get_dataset_df()
    if df is None:
        return Response(
            {"detail": services.get_dataset_load_error() or "Dataset not available."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    power = data.get("pump_power_kw")
    if power is None or power <= 0:
        try:
            power = services.estimate_pump_power_kw(
                data["flow_m3h"], data["total_head"], data["pump_efficiency"]
            )
        except ValueError as e:
            return Response(
                {"detail": str(e)},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

    data["pump_power_kw"] = power

    try:
        cat_mask = services.exact_categorical_mask(
            df,
            pump_type=data["pump_type"],
            impeller_moc=data["impeller_moc"],
            diffuser_moc=data["diffuser_moc"],
            special_instruction=data["special_instruction"],
        )
        base = df.loc[cat_mask].copy()
        refs = services.numeric_refs_for_match(data)

        for col in services.NUMERIC_MATCH_COLUMNS:
            if col not in base.columns:
                return Response(
                    {"detail": f"Dataset is missing numeric column {col!r}."},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

        records: list[dict[str, Any]] = []
        mode = (data.get("match_mode") or "similarity").lower().strip()

        if mode == "exact":
            rtol, atol = 1e-5, 1e-4
            for _, row in base.iterrows():
                ok = True
                by_col: dict[str, float] = {}
                for col in services.NUMERIC_MATCH_COLUMNS:
                    v = float(row[col])
                    r = refs[col]
                    by_col[col] = services.numeric_pair_similarity_percent(r, v)
                    if not np.isclose(v, r, rtol=rtol, atol=atol):
                        ok = False
                        break
                if not ok:
                    continue
                mean_pct = float(np.mean(list(by_col.values()))) if by_col else 100.0
                rec = {
                    "numeric_match_percent": round(mean_pct, 2),
                    "numeric_match_by_column": {k: round(v, 2) for k, v in by_col.items()},
                }
                rec.update(row.replace({np.nan: None}).to_dict())
                records.append(rec)
        else:
            min_pct = float(data.get("min_numeric_match_percent", 90.0))
            for _, row in base.iterrows():
                by_col: dict[str, float] = {}
                for col in services.NUMERIC_MATCH_COLUMNS:
                    v = float(row[col])
                    r = refs[col]
                    by_col[col] = services.numeric_pair_similarity_percent(r, v)
                mean_pct = float(np.mean(list(by_col.values()))) if by_col else 0.0
                if mean_pct < min_pct - 1e-9:
                    continue
                rec = {
                    "numeric_match_percent": round(mean_pct, 2),
                    "numeric_match_by_column": {k: round(v, 2) for k, v in by_col.items()},
                }
                rec.update(row.replace({np.nan: None}).to_dict())
                records.append(rec)

            records.sort(key=lambda x: x["numeric_match_percent"], reverse=True)

        max_rows = 200
        total = len(records)
        truncated = total > max_rows
        records = records[:max_rows]

        return Response({
            "match_mode": mode,
            "min_numeric_match_percent": data.get("min_numeric_match_percent")
            if mode != "exact"
            else None,
            "categorical_match": "exact (Pump_Type, Impeller_MOC, Diffuser_MOC, Special_Instruction)",
            "numeric_scoring": "mean of per-column similarity; each column uses 100*(1-relative_error)",
            "count": total,
            "returned": len(records),
            "truncated": truncated,
            "rows": records,
        })
    except KeyError as e:
        return Response(
            {"detail": f"Dataset is missing expected columns: {e}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def _format_serializer_errors(errors: dict) -> list[dict]:
    """Convert DRF validation errors into FastAPI-style error detail list."""
    detail = []
    for field, messages in errors.items():
        for msg in messages:
            detail.append({
                "loc": ["body", field],
                "msg": str(msg),
                "type": "value_error",
            })
    return detail
