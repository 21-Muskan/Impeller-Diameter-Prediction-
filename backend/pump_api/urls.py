"""
URL routing for the pump_api app.

Mounted at ``/api/`` by the project-level urls.py, so these become:
    GET  /api/health
    GET  /api/options
    POST /api/predict
    POST /api/dataset-matches
"""

from django.urls import path

from . import views

urlpatterns = [
    path("health", views.health_view, name="health"),
    path("options", views.options_view, name="options"),
    path("predict", views.predict_view, name="predict"),
    path("dataset-matches", views.dataset_matches_view, name="dataset-matches"),
]
