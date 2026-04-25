"""
pump_api Django app configuration.

The ``ready()`` hook pre-loads the ML pipeline and dataset on startup,
mirroring the FastAPI ``@app.on_event("startup")`` behaviour.
"""

from django.apps import AppConfig


class PumpApiConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "pump_api"
    verbose_name = "Pump Impeller Prediction API"

    def ready(self):
        from . import services

        services.load_dataset()
        try:
            services.load_artifacts()
            import sklearn

            print(f"[startup] Model loaded (scikit-learn {sklearn.__version__})")
        except (FileNotFoundError, ValueError, RuntimeError) as e:
            print(f"[startup] Model not loaded: {e}")
