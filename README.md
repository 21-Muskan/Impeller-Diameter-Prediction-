# Wilo 2.0 - Pump Impeller Diameter Prediction

React + FastAPI application for predicting:
- `Full_Diameter` (mm)
- `Trimmed_Diameter` (mm)

from pump configuration, operating conditions, and material inputs.

---

## 1) Project Overview

This project has two main parts:

- **Frontend (`frontend/`)**  
  React (Vite) UI where users enter pump inputs, validate MOC confirmation, run prediction, and view matching dataset rows.

- **Backend (`backend/`)**  
  Django REST Framework service that:
  - loads the trained sklearn pipeline (`pump_pipeline_v3.pkl`)
  - predicts impeller diameters
  - provides dropdown options from fitted encoder categories
  - searches dataset reference rows using exact categorical + numeric similarity matching

---

## 2) File / Folder Structure

```text
Wilo 2.0/
|-- backend/
|   |-- manage.py                  # Django CLI entry point
|   |-- requirements.txt           # Python dependencies (Django, DRF, sklearn, etc.)
|   |-- pump_project/              # Django project settings & routing
|   |-- pump_api/                  # Django app (views, serializers, ML services)
|   |-- models/                    # Location for model artifact(s)
|   |   |-- pump_pipeline_v3.pkl   # Trained ML pipeline artifact (required)
|   |   `-- model.pkl
|
|-- frontend/
|   |-- src/
|   |   |-- App.jsx                # Main UI + form + result + dataset table
|   |   |-- App.css                # Styling
|   |   |-- api.js                 # API call helpers
|   |   `-- main.jsx               # React entry point
|   |-- index.html                 # Vite HTML template
|   |-- package.json               # Frontend dependencies/scripts
|   |-- package-lock.json          # npm lock file
|   |-- vite.config.js             # Dev server + /api proxy config
|   `-- dist/                      # Production build output
|
|-- Impeller_Dataset.xlsx          # Dataset for reference row search (optional but recommended)
|-- model_v4.ipynb                 # Notebook for training/experiments
`-- README.md                      # documentation
```

---

## 3) Prerequisites

- **Python** 3.10+ (you are using 3.12, which is fine)
- **Node.js** 18+ and npm
- A Python virtual environment (recommended)

---

## 4) Model Required

Current backend requires one ML model:

- `pump_pipeline_v3.pkl`

The app will look here by default:

- `backend/models/pump_pipeline_v3.pkl`

You can also override path using environment variable:

- `PIPELINE_FILE=<absolute-or-relative-path-to-pkl>`

> Important: sklearn pickles are version-sensitive.  
> `requirements.txt` pins `scikit-learn==1.5.1` to match the training artifact and avoid unpickle errors.

---

## 5) Backend Setup & Run

From project root:

```bash
cd backend
python -m venv .venv
```

### Windows PowerShell

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python manage.py runserver 8000
```

Backend URL:
- http://127.0.0.1:8000

---

## 6) Frontend Setup & Run

Open another terminal from project root:

```bash
cd frontend
npm install
npm run dev
```

Frontend URL (default):
- http://127.0.0.1:5173

`vite.config.js` proxies `/api` calls to backend `http://127.0.0.1:8000`.

---

## 7) Environment Variables (Backend)

Optional environment variables:

- `MODEL_DIR`  
  Base directory containing model file(s). Default: `backend/models`

- `PIPELINE_FILE`  
  Full path to model pipeline file. Overrides `MODEL_DIR` default.

- `DATASET_PATH`  
  Path to `Impeller_Dataset.xlsx`.  
  Default: `<project-root>/Impeller_Dataset.xlsx`

- `CORS_ORIGINS`  
  Comma-separated allowed origins.  
  Default includes local Vite URLs.

---

## 8) Main API Endpoints

### `GET /api/health`
Shows service status, model load status, sklearn runtime version, and dataset status.

### `GET /api/options`
Returns:
- categorical feature list
- numeric feature list
- dropdown options extracted from fitted `OrdinalEncoder` categories

### `POST /api/predict`
Predicts `full_diameter_mm` and `trimmed_diameter_mm`.

Includes:
- MOC confirmation validation (first and confirm must match)
- optional pump power auto-estimation if not provided

### `POST /api/dataset-matches`
Returns dataset rows with:
- **exact categorical match** (`Pump_Type`, `Impeller_MOC`, `Diffuser_MOC`, `Special_Instruction`)
- numeric similarity scoring

Current behavior:
- per numeric column similarity (%) is computed
- mean similarity across numeric columns is used
- rows must meet threshold (default `min_numeric_match_percent = 90`)
- response includes:
  - `numeric_match_percent`
  - `numeric_match_by_column`

---

## 9) How Matching Works (Dataset Search)

1. Filter dataset rows by exact categorical match:
   - Pump type
   - Impeller MOC
   - Diffuser MOC
   - Special instruction

2. For each remaining row, compute numeric similarity for:
   - `Head_per_Chamber`
   - `Number_of_Chambers`
   - `Speed_RPM`
   - `Flow_m3h`
   - `Pump_Efficiency`
   - `Total_Head`
   - `Pump_Power`

3. Compute mean similarity (%) and keep rows above threshold.

---

## 10) Common Issues & Fixes

### A) `_RemainderColsList` / pickle load error
Cause: sklearn version mismatch during unpickle.

Fix:
The backend includes a compatibility shim in `pump_api/services.py` that allows newer `scikit-learn` versions to load older pickles, so this error should be mitigated automatically.

### B) `model not loaded` in `/api/health`
Check:
- model file path is valid
- `pump_pipeline_v3.pkl` exists in `backend/models/` or `PIPELINE_FILE` points correctly

### C) Dataset not found
Place `Impeller_Dataset.xlsx` at project root or set `DATASET_PATH`.

### D) Frontend cannot call backend
Check:
- backend is running on port 8000
- frontend on 5173
- no CORS override blocking local origin

---

## 11) Production Notes

- Build frontend:
  ```bash
  cd frontend
  npm run build
  ```
- Serve `frontend/dist` via static hosting and route API to the Django backend.
- Keep model + sklearn versions aligned.

---

## 12) Quick Start (Minimal)

```bash
# terminal 1
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python manage.py runserver 8000

# terminal 2
cd frontend
npm install
npm run dev
```

Then open: http://127.0.0.1:5173

