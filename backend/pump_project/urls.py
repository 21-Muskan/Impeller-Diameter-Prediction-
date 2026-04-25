"""
Root URL configuration for pump_project.

All API endpoints live under /api/ and are handled by the pump_api app.
"""

from django.urls import include, path

urlpatterns = [
    path("api/", include("pump_api.urls")),
]
